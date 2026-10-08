import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, logger, makeReserve, makeStreamCreator } from './_harness';

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('recording stream allocation boundary', () => {
    it('[Task 3.2][Packet A] reports the exact fallback diagnostic when no logical tuner is available', async () => {
        const stream = new PassThrough();
        const harness = makeStreamCreator({
            tunerServerAccess: {
                openProgramStream: vi.fn(async () => ({ stream, close: vi.fn() })),
            },
        });
        const reserve = makeReserve({ id: 491 });

        await expect(harness.model.create(reserve)).resolves.toBe(stream);

        expect(logger.system.warn.mock.calls).toEqual([[`TunerAssignmentError programId: ${reserve.id}`]]);
        expect(harness.model.tuners).toEqual([]);
        stream.destroy();
    });

    it.each(['end', 'error'] as const)(
        '[Tasks 3.2/3.5][Packet A] removes a tracked reservation on stream %s',
        async terminal => {
            const stream = new PassThrough();
            const harness = makeStreamCreator({
                tunerServerAccess: {
                    openProgramStream: vi.fn(async () => ({ stream, close: vi.fn() })),
                },
            });
            harness.model.tuners = [{ types: ['GR'], programs: [] }];
            const reserve = makeReserve({ id: terminal === 'end' ? 492 : 493 });
            await expect(harness.model.create(reserve)).resolves.toBe(stream);
            expect(harness.model.tuners[0].programs).toHaveLength(1);

            if (terminal === 'end') {
                stream.resume();
                stream.end();
            } else {
                stream.destroy(new Error('synthetic tracked stream failure'));
            }
            await new Promise(resolve => setImmediate(resolve));

            expect(harness.model.tuners[0].programs).toEqual([]);
            expect(logger.system.debug.mock.calls).toEqual([[`delete stream: ${reserve.id}`]]);
            expect(logger.system.error.mock.calls).toEqual(
                terminal === 'error' ? [[`RecordingStreamCreator stream error: ${reserve.id}`]] : [],
            );
        },
    );

    it('[Task 3.5][Packet A] removes the provisional tuner entry when stream opening rejects', async () => {
        const opening = deferred<any>();
        const failure = new Error('synthetic tracked stream-open failure');
        const harness = makeStreamCreator({
            tunerServerAccess: { openProgramStream: vi.fn(() => opening.promise) },
        });
        harness.model.tuners = [{ types: ['GR'], programs: [] }];
        const reserve = makeReserve({ id: 494 });
        const creation = harness.model.create(reserve);
        const observed = creation.catch((error: unknown) => error);
        await new Promise(resolve => setImmediate(resolve));
        expect(harness.model.tuners[0].programs).toHaveLength(1);

        opening.reject(failure);

        await expect(observed).resolves.toBe(failure);
        expect(harness.model.tuners[0].programs).toEqual([]);
        expect(logger.system.debug.mock.calls).toEqual([[`delete stream: ${reserve.id}`]]);
    });

    it.each(['idle tuner', 'occupied eligible tuner'] as const)(
        '[Task 3.2][Packet B] rejects a mismatched broadcast type during %s selection',
        async tunerState => {
            vi.useFakeTimers();
            vi.setSystemTime(1_000_000);
            const currentStream = tunerState === 'occupied eligible tuner' ? new PassThrough() : null;
            const nextStream = new PassThrough();
            const currentReserve = makeReserve({
                id: 495,
                channel: 'synthetic-bs-current',
                channelType: 'BS',
                programId: null,
                isTimeSpecified: true,
                allowEndLack: true,
                endAt: 1_015_000,
            });
            const harness = makeStreamCreator({
                tunerServerAccess: {
                    openProgramStream: vi.fn(async () => ({ stream: nextStream, close: vi.fn() })),
                    getProgram: vi.fn(),
                },
            });
            harness.model.tuners = [
                {
                    types: ['BS'],
                    programs: currentStream === null ? [] : [{ reserve: currentReserve, stream: currentStream }],
                },
            ];
            const nextReserve = makeReserve({
                id: 496,
                channel: 'synthetic-gr-next',
                channelType: 'GR',
            });

            await expect(harness.model.create(nextReserve)).resolves.toBe(nextStream);

            expect(logger.system.warn.mock.calls).toEqual([[`TunerAssignmentError programId: ${nextReserve.id}`]]);
            expect(harness.model.tuners[0].programs.map((program: any) => program.reserve.id)).toEqual(
                currentStream === null ? [] : [currentReserve.id],
            );
            if (currentStream !== null) {
                expect(currentStream.destroyed).toBe(false);
            }
            expect(harness.tunerServerAccess.getProgram).not.toHaveBeenCalled();
            currentStream?.destroy();
            nextStream.destroy();
        },
    );

    it.each(['live stream', 'pending stream'] as const)(
        '[Task 3.2][Packet B] skips metadata for an eligible time-specified reservation with a %s',
        async streamState => {
            vi.useFakeTimers();
            vi.setSystemTime(1_000_000);
            const currentStream = streamState === 'live stream' ? new PassThrough() : null;
            const nextStream = new PassThrough();
            const currentReserve = makeReserve({
                id: streamState === 'live stream' ? 497 : 498,
                channel: 'synthetic-current',
                programId: null,
                isTimeSpecified: true,
                allowEndLack: true,
                endAt: 1_015_000,
            });
            const harness = makeStreamCreator({
                tunerServerAccess: {
                    openProgramStream: vi.fn(async () => ({ stream: nextStream, close: vi.fn() })),
                    getProgram: vi.fn(async () => {
                        throw new Error('time-specified metadata must not be requested');
                    }),
                },
            });
            harness.model.tuners = [
                {
                    types: ['GR'],
                    programs: [{ reserve: currentReserve, stream: currentStream }],
                },
            ];
            const nextReserve = makeReserve({ id: 499, channel: 'synthetic-next' });

            await expect(harness.model.create(nextReserve)).resolves.toBe(nextStream);

            expect(harness.tunerServerAccess.getProgram).not.toHaveBeenCalled();
            if (currentStream !== null) {
                expect(currentStream.destroyed).toBe(true);
            }
            expect(harness.model.tuners[0].programs.map((program: any) => program.reserve.id)).toEqual([
                nextReserve.id,
            ]);
            nextStream.destroy();
        },
    );

    it('[Task 3.2][Packet B] treats metadata ending at the preparation boundary as no extension', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const currentStream = new PassThrough();
        const nextStream = new PassThrough();
        const currentReserve = makeReserve({
            id: 500,
            channel: 'synthetic-current',
            allowEndLack: true,
            endAt: 1_015_000,
        });
        const harness = makeStreamCreator({
            tunerServerAccess: {
                openProgramStream: vi.fn(async () => ({ stream: nextStream, close: vi.fn() })),
                getProgram: vi.fn(async () => ({ startAt: 1_000_000, duration: 15_000 })),
            },
        });
        harness.model.tuners = [
            {
                types: ['GR'],
                programs: [{ reserve: currentReserve, stream: currentStream }],
            },
        ];
        const nextReserve = makeReserve({ id: 501, channel: 'synthetic-next' });

        await expect(harness.model.create(nextReserve)).resolves.toBe(nextStream);

        expect(harness.tunerServerAccess.getProgram).toHaveBeenCalledWith(currentReserve.programId);
        expect(currentStream.destroyed).toBe(true);
        expect(harness.model.tuners[0].programs.map((program: any) => program.reserve.id)).toEqual([nextReserve.id]);
        nextStream.destroy();
    });

    it('[RE-3.6][Task 3.2][Packet B] records the exact diagnostic when metadata lookup fails before reassignment', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const currentStream = new PassThrough();
        const nextStream = new PassThrough();
        const currentReserve = makeReserve({
            id: 502,
            channel: 'synthetic-current',
            allowEndLack: true,
            endAt: 1_015_000,
        });
        const harness = makeStreamCreator({
            tunerServerAccess: {
                openProgramStream: vi.fn(async () => ({ stream: nextStream, close: vi.fn() })),
                getProgram: vi.fn(async () => {
                    throw new Error('synthetic tuner metadata failure');
                }),
            },
        });
        harness.model.tuners = [
            {
                types: ['GR'],
                programs: [{ reserve: currentReserve, stream: currentStream }],
            },
        ];
        const nextReserve = makeReserve({ id: 503, channel: 'synthetic-next' });

        await expect(harness.model.create(nextReserve)).resolves.toBe(nextStream);

        expect(logger.system.warn.mock.calls).toEqual([[`tuner program get error: ${currentReserve.id}`]]);
        expect(currentStream.destroyed).toBe(true);
        expect(harness.model.tuners[0].programs.map((program: any) => program.reserve.id)).toEqual([nextReserve.id]);
        nextStream.destroy();
    });

    it.each(['matching live stream', 'unrelated live stream', 'matching pending stream'] as const)(
        '[Task 1.9][Packet D] clears the owned end timer and selects only the reservation stream: %s',
        scenario => {
            vi.useFakeTimers();
            const targetReserve = makeReserve({ id: 504 });
            const unrelatedStream = new PassThrough();
            const targetStream = scenario === 'matching live stream' ? new PassThrough() : null;
            const harness = makeStreamCreator();
            const programs =
                scenario === 'unrelated live stream'
                    ? [{ reserve: makeReserve({ id: 505 }), stream: unrelatedStream }]
                    : [
                          { reserve: makeReserve({ id: 505 }), stream: unrelatedStream },
                          { reserve: targetReserve, stream: targetStream },
                      ];
            harness.model.tuners = [{ types: ['GR'], programs }];
            const legacyEnd = vi.fn();
            harness.model.timerIndex[targetReserve.id] = setTimeout(legacyEnd, 60_000);

            expect(() => harness.model.destroyStream(targetReserve)).not.toThrow();

            expect(harness.model.timerIndex).toEqual({});
            expect(vi.getTimerCount()).toBe(0);
            expect(legacyEnd).not.toHaveBeenCalled();
            expect(unrelatedStream.destroyed).toBe(false);
            if (targetStream !== null) {
                expect(targetStream.destroyed).toBe(true);
            }
            unrelatedStream.destroy();
        },
    );

    it('[Task 1.9][Packet D] releases only the target legacy end callback and tolerates a repeated release', async () => {
        vi.useFakeTimers();
        const reserveId = 506;
        const otherReserveId = 507;
        const legacyEnd = vi.fn();
        const otherEnd = vi.fn();
        const harness = makeStreamCreator();
        harness.model.timerIndex[reserveId] = setTimeout(legacyEnd, 60_000);
        harness.model.timerIndex[otherReserveId] = setTimeout(otherEnd, 60_000);

        harness.model.releaseTimeSpecifiedEnd(reserveId);
        expect(() => harness.model.releaseTimeSpecifiedEnd(reserveId)).not.toThrow();
        expect(harness.model.timerIndex).toEqual({ [otherReserveId]: expect.anything() });
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(60_000);

        expect(harness.model.timerIndex).toEqual({ [otherReserveId]: expect.anything() });
        expect(vi.getTimerCount()).toBe(0);
        expect(legacyEnd).not.toHaveBeenCalled();
        expect(otherEnd).toHaveBeenCalledOnce();
        delete harness.model.timerIndex[otherReserveId];
    });
});
