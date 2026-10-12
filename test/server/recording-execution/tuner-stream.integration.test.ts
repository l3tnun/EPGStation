import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    deferred,
    logger,
    makeRecorder,
    makeRecordingSessionBinding,
    makeReserve,
    makeStreamCreator,
} from './_harness';

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('recording tuner stream boundary', () => {
    it.each(['end', 'close', 'error'] as const)(
        '[Task 3.5] closes the canonical handle exactly once after a %s terminal event',
        async terminal => {
            const stream = new PassThrough();
            const close = vi.fn();
            const harness = makeStreamCreator({
                tunerServerAccess: { openProgramStream: vi.fn(async () => ({ stream, close })) },
            });
            const result = await harness.model.create(makeReserve({ id: 589, isConflict: true }));

            if (terminal === 'end') {
                result.resume();
                stream.end();
            } else if (terminal === 'close') {
                stream.emit('close');
            } else {
                stream.destroy(new Error('synthetic canonical stream error'));
            }

            await new Promise(resolve => setImmediate(resolve));
            expect(close).toHaveBeenCalledOnce();
        },
    );

    it('[Task 3.5] synchronously closes a logical tuner handle once when recording is cancelled', async () => {
        const stream = new PassThrough();
        const close = vi.fn();
        const harness = makeStreamCreator({
            tunerServerAccess: { openProgramStream: vi.fn(async () => ({ stream, close })) },
        });
        harness.model.tuners = [{ types: ['GR'], programs: [] }];
        const reserve = makeReserve({ id: 590 });
        await expect(harness.model.create(reserve)).resolves.toBe(stream);

        harness.model.destroyStream(reserve);
        expect(close).toHaveBeenCalledOnce();
        expect(close.mock.results).toEqual([{ type: 'return', value: undefined }]);

        harness.model.destroyStream(reserve);
        expect(close).toHaveBeenCalledOnce();
    });

    it('[Task 3.5] closes a logical tuner stream without a canonical handle', () => {
        const stream = new PassThrough();
        const harness = makeStreamCreator();
        const reserve = makeReserve({ id: 591 });
        harness.model.tuners = [{ programs: [{ reserve, stream }], types: ['GR'] }];

        expect(() => harness.model.destroyStream(reserve)).not.toThrow();
        expect(stream.destroyed).toBe(true);
    });

    it('[open-body-terminal][Task 3.2] adopts the common-port stream and closes its handle on terminal', async () => {
        const stream = new PassThrough();
        const close = vi.fn();
        const harness = makeStreamCreator({
            tunerServerAccess: { openProgramStream: vi.fn(async () => ({ stream, close })) },
        });
        const result = await harness.model.create(makeReserve({ isConflict: true }));
        expect(result).toBe(stream);
        result.resume();
        stream.end();
        await new Promise(resolve => setImmediate(resolve));
        expect(close).toHaveBeenCalledOnce();
    });

    it.each(['success', 'failure'])(
        '[Task 1.9 review] never creates a legacy time-specified end timer for external scheduling on %s',
        async outcome => {
            vi.useFakeTimers();
            vi.setSystemTime(1_000_000);
            const opening = deferred<any>();
            const stream = new PassThrough();
            const harness = makeStreamCreator({
                tunerServerAccess: { openServiceStream: vi.fn(() => opening.promise) },
            });
            const reserve = makeReserve({
                id: 478,
                isConflict: true,
                isTimeSpecified: true,
                programId: null,
                startAt: 900_000,
                endAt: 1_060_000,
            });
            const result = harness.model.create(reserve, undefined, {
                isTimeSpecifiedEndExternallyScheduled: true,
            });
            const observed = result.catch((error: unknown) => error);

            expect(harness.model.timerIndex).toEqual({});
            expect(vi.getTimerCount()).toBe(0);
            if (outcome === 'success') {
                opening.resolve({ stream, close: vi.fn() });
                await expect(result).resolves.toBe(stream);
                stream.destroy();
            } else {
                const failure = new Error('synthetic external scheduling stream failure');
                opening.reject(failure);
                await expect(observed).resolves.toBe(failure);
            }
            expect(harness.model.timerIndex).toEqual({});
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('[Task 1.9 review] keeps the legacy time-specified end timer by default and removes it at terminal', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const opening = deferred<any>();
        const stream = new PassThrough();
        const harness = makeStreamCreator({
            tunerServerAccess: { openServiceStream: vi.fn(() => opening.promise) },
        });
        const reserve = makeReserve({
            id: 479,
            isConflict: true,
            isTimeSpecified: true,
            programId: null,
            startAt: 900_000,
            endAt: 1_060_000,
        });
        const result = harness.model.create(reserve);

        expect(harness.model.timerIndex[479]).toBeDefined();
        expect(vi.getTimerCount()).toBe(1);
        opening.resolve({ stream, close: vi.fn() });
        await expect(result).resolves.toBe(stream);
        stream.emit('end');

        expect(harness.model.timerIndex).toEqual({});
        expect(vi.getTimerCount()).toBe(0);
        stream.destroy();
    });

    it('[Task 3.3] opens a time-specified stream when endAt equals the current time', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const stream = new PassThrough();
        const harness = makeStreamCreator({
            tunerServerAccess: {
                openServiceStream: vi.fn(async () => ({ stream, close: vi.fn() })),
            },
        });

        await expect(
            harness.model.create(
                makeReserve({
                    id: 484,
                    isConflict: true,
                    isTimeSpecified: true,
                    programId: null,
                    startAt: 1_000_000,
                    endAt: 1_000_000,
                }),
                undefined,
                { isTimeSpecifiedEndExternallyScheduled: true },
            ),
        ).resolves.toBe(stream);

        expect(harness.tunerServerAccess.openServiceStream).toHaveBeenCalledOnce();
        expect(harness.model.timerIndex).toEqual({});
        expect(vi.getTimerCount()).toBe(0);
        stream.destroy();
    });

    it('[Task 1.9] fires the legacy end timer at exactly endAt plus its configured margin', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const opening = deferred<any>();
        const stream = new PassThrough();
        const harness = makeStreamCreator({
            config: { timeSpecifiedEndMargin: 2 },
            tunerServerAccess: { openServiceStream: vi.fn(() => opening.promise) },
        });
        const reserve = makeReserve({
            id: 485,
            isConflict: true,
            isTimeSpecified: true,
            programId: null,
            startAt: 1_000_000,
            endAt: 1_005_000,
        });
        const creation = harness.model.create(reserve);

        expect(harness.model.timerIndex[reserve.id]).toBeDefined();
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(6_999);
        expect(harness.model.timerIndex[reserve.id]).toBeDefined();
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(harness.model.timerIndex).toEqual({});
        expect(vi.getTimerCount()).toBe(0);

        opening.resolve({ stream, close: vi.fn() });
        await expect(creation).resolves.toBe(stream);
        stream.destroy();
    });

    it('[Task 1.9] installs no legacy end listener when end scheduling is external', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const stream = new PassThrough();
        const once = vi.spyOn(stream, 'once');
        const harness = makeStreamCreator({
            tunerServerAccess: {
                openServiceStream: vi.fn(async () => ({ stream, close: vi.fn() })),
            },
        });

        await expect(
            harness.model.create(
                makeReserve({
                    id: 486,
                    isConflict: true,
                    isTimeSpecified: true,
                    programId: null,
                    startAt: 1_000_000,
                    endAt: 1_060_000,
                }),
                undefined,
                { isTimeSpecifiedEndExternallyScheduled: true },
            ),
        ).resolves.toBe(stream);

        expect(once.mock.calls.filter(([event]) => event === 'end')).toHaveLength(0);
        expect(harness.model.timerIndex).toEqual({});
        expect(vi.getTimerCount()).toBe(0);
        stream.destroy();
    });

    it.each([
        ['legacy scheduling', undefined, 1],
        ['external scheduling', { isTimeSpecifiedEndExternallyScheduled: true }, 0],
    ])(
        '[Task 3.5] preserves service-open failure diagnostics and cleanup for %s',
        async (_case, options, timerCountBeforeFailure) => {
            vi.useFakeTimers();
            vi.setSystemTime(1_000_000);
            logger.system.error.mockClear();
            const opening = deferred<any>();
            const failure = new Error('synthetic service-open failure');
            const harness = makeStreamCreator({
                tunerServerAccess: { openServiceStream: vi.fn(() => opening.promise) },
            });
            const reserve = makeReserve({
                id: 487,
                isConflict: true,
                isTimeSpecified: true,
                programId: null,
                startAt: 1_000_000,
                endAt: 1_060_000,
            });
            const creation = harness.model.create(reserve, undefined, options);
            const observed = creation.catch((error: unknown) => error);

            expect(vi.getTimerCount()).toBe(timerCountBeforeFailure);
            opening.reject(failure);
            await expect(observed).resolves.toBe(failure);
            expect(logger.system.error.mock.calls).toEqual([[`stream get error ${reserve.channelId}`], [failure]]);
            expect(harness.model.timerIndex).toEqual({});
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it.each(['reservation cancellation', 'reservation removal', 'replacement', 'retry', 'stopped handoff'] as const)(
        '[Task 9.7][RE-8.1][RE-8.2][RE-9.4] fences a stale acquired common-port stream from a successor during %s',
        async scenario => {
            const staleStream = new PassThrough();
            const successorStream = new PassThrough();
            const closeStale = vi.fn();
            const closeSuccessor = vi.fn();
            const staleData = vi.fn();
            const successorData = vi.fn();
            const findReserve = deferred<ReturnType<typeof makeReserve> | null>();
            const recording = deferred<void>();
            const original = makeReserve({ id: 9711 });
            // 'reservation cancellation'/'reservation removal'/'replacement' all
            // fence the stale attempt synchronously once findId resolves (no
            // await between that and destroyAcquiredStream()), so findId must
            // stay pending until the test has installed the successor stream;
            // otherwise the whole cleanup chain would run to completion before
            // the test gets a chance to simulate the race at all.
            const usesDeferredFindId =
                scenario === 'reservation cancellation' ||
                scenario === 'reservation removal' ||
                scenario === 'replacement';
            const openProgramStream = vi.fn(async () => ({ close: closeStale, stream: staleStream }));
            const streamCreator = makeStreamCreator({ tunerServerAccess: { openProgramStream } });
            const harness = makeRecorder({
                reserveDB: {
                    findId: usesDeferredFindId ? vi.fn(() => findReserve.promise) : vi.fn(async () => original),
                },
                streamCreator: streamCreator.model,
            });
            const session = makeRecordingSessionBinding(original, {
                generation: 1n,
                phase: 'Preparing',
                sessionToken: 1n,
            });
            if (scenario === 'replacement') session.binding.tryTransition.mockReturnValueOnce(false);
            harness.model.reserve = original;
            harness.model.bindScheduleSession(session.binding);
            harness.model.doRecord = vi.fn(() => recording.promise);
            staleStream.on('data', staleData);
            successorStream.on('data', successorData);
            successorStream.once('close', closeSuccessor);

            const preparation = harness.model.startPreparation();
            if (usesDeferredFindId) {
                await vi.waitFor(() => expect(harness.reserveDB.findId).toHaveBeenCalledOnce());
            } else {
                await vi.waitFor(() => expect(harness.model.doRecord).toHaveBeenCalledOnce());
            }

            // A successor (retry/replacement) installs its own stream into the
            // shared `stream` slot while the stale preparation above is still
            // in flight, acquired for real through `tunerServerAccess`.
            harness.model.stream = successorStream;

            if (scenario === 'reservation cancellation') {
                harness.model.isStopPrepRec = true;
                findReserve.resolve(original);
            } else if (scenario === 'reservation removal') {
                findReserve.resolve(null);
            } else if (scenario === 'replacement') {
                // tryTransition() above is already mocked to fail once, which
                // fences the stale attempt as soon as findId resolves, without
                // ever calling doRecord.
                findReserve.resolve(original);
            } else if (scenario === 'retry') {
                recording.reject(new Error('synthetic stale retry-path doRecord failure'));
            } else if (scenario === 'stopped handoff') {
                harness.model.isStopPrepRec = true;
                recording.reject(new Error('synthetic stopped stale recording handoff failure'));
            }

            await preparation;
            await new Promise(resolve => setImmediate(resolve));

            // stale: destroyed exactly once through the real tuner-access close
            // handle, listener released, no data ever delivered to it
            expect(staleStream.destroyed).toBe(true);
            expect(staleStream.listenerCount('data')).toBe(0);
            expect(staleData).not.toHaveBeenCalled();
            expect(closeStale).toHaveBeenCalledOnce();

            // successor: completely untouched, still occupies the shared slot
            expect(successorStream.destroyed).toBe(false);
            expect(successorStream.listenerCount('data')).toBe(1);
            expect(successorData).not.toHaveBeenCalled();
            expect(closeSuccessor).not.toHaveBeenCalled();
            expect(harness.model.stream).toBe(successorStream);

            // session token: the stale session settles into exactly the one
            // terminal phase this scenario implies, and stays there (a second,
            // duplicate transition attempt to the same target would be a no-op
            // on the mock, but a *different* unexpected target would show up
            // here as a wrong final phase)
            const expectedFinalPhase: Record<typeof scenario, string> = {
                'reservation cancellation': 'Cancelled',
                'reservation removal': 'Cancelled',
                replacement: 'Preparing',
                retry: 'RetryWaiting',
                'stopped handoff': 'Cancelled',
            };
            expect(session.state.phase).toBe(expectedFinalPhase[scenario]);

            // double-close: re-emitting the stale stream's terminal event a
            // second time must not invoke its close handle again
            staleStream.emit('close');
            await new Promise(resolve => setImmediate(resolve));
            expect(closeStale).toHaveBeenCalledOnce();
            harness.model.invalidateRetry();
        },
    );

    it('[Task 9.7][RE-8.2][RE-9.4] tracks a stale acquired stream termination as a finalization continuation instead of letting it settle unobserved', async () => {
        const staleStream = new PassThrough();
        const successorStream = new PassThrough();
        const closeStale = vi.fn();
        const recording = deferred<void>();
        const original = makeReserve({ id: 9751 });
        const openProgramStream = vi.fn(async () => ({ close: closeStale, stream: staleStream }));
        const streamCreator = makeStreamCreator({ tunerServerAccess: { openProgramStream } });
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => original) },
            streamCreator: streamCreator.model,
        });
        const session = makeRecordingSessionBinding(original, {
            generation: 1n,
            phase: 'Preparing',
            sessionToken: 1n,
        });
        harness.model.reserve = original;
        harness.model.bindScheduleSession(session.binding);
        harness.model.doRecord = vi.fn(() => recording.promise);

        const preparation = harness.model.startPreparation();
        await vi.waitFor(() => expect(harness.model.doRecord).toHaveBeenCalledOnce());
        harness.model.stream = successorStream;
        recording.reject(new Error('synthetic stale doRecord failure for finalization tracking'));
        await preparation;

        // the stale stream has just been destroyed by the cleanup path above,
        // but its 'close' event has not fired yet (that happens on a later
        // tick), so its termination must already be tracked here rather than
        // left to settle with nothing observing it.
        expect(staleStream.destroyed).toBe(true);
        expect(harness.model.finalizationContinuations.size).toBeGreaterThan(0);

        await new Promise(resolve => setImmediate(resolve));

        // once the stale stream has actually terminated, the tracked
        // continuation is released again
        expect(harness.model.finalizationContinuations.size).toBe(0);
    });

    it('[Task 9.7][RE-8.1][RE-9.4] acquires shared-channel programs at recording priority and a conflict program at conflict priority, closing each handle exactly once', async () => {
        const sharedFirstStream = new PassThrough();
        const sharedSecondStream = new PassThrough();
        const conflictStream = new PassThrough();
        const closeSharedFirst = vi.fn();
        const closeSharedSecond = vi.fn();
        const closeConflict = vi.fn();
        const openProgramStream = vi
            .fn()
            .mockResolvedValueOnce({ close: closeSharedFirst, stream: sharedFirstStream })
            .mockResolvedValueOnce({ close: closeSharedSecond, stream: sharedSecondStream })
            .mockResolvedValueOnce({ close: closeConflict, stream: conflictStream });
        const streamCreator = makeStreamCreator({ tunerServerAccess: { openProgramStream } });
        streamCreator.model.setTuner([{ types: ['GR'] }] as any);
        const sharedFirst = makeReserve({ channel: 'synthetic-shared-channel', id: 9721, programId: 9721 });
        const sharedSecond = makeReserve({ channel: 'synthetic-shared-channel', id: 9722, programId: 9722 });
        const conflict = makeReserve({ id: 9723, isConflict: true, programId: 9723 });
        const firstHarness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => sharedFirst) },
            streamCreator: streamCreator.model,
        });
        const secondHarness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => sharedSecond) },
            streamCreator: streamCreator.model,
        });
        const conflictHarness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => conflict) },
            streamCreator: streamCreator.model,
        });
        firstHarness.model.reserve = sharedFirst;
        secondHarness.model.reserve = sharedSecond;
        conflictHarness.model.reserve = conflict;
        firstHarness.model.doRecord = vi.fn(async () => undefined);
        secondHarness.model.doRecord = vi.fn(async () => undefined);
        conflictHarness.model.doRecord = vi.fn(async () => undefined);

        await firstHarness.model.startPreparation();
        await secondHarness.model.startPreparation();
        await conflictHarness.model.startPreparation();

        expect(
            openProgramStream.mock.calls.map(([request]: any[]) => ({
                priority: request.priority,
                programId: request.programId,
            })),
        ).toEqual([
            { priority: 2, programId: sharedFirst.programId },
            { priority: 2, programId: sharedSecond.programId },
            { priority: 9, programId: conflict.programId },
        ]);
        expect(firstHarness.model.stream).toBe(sharedFirstStream);
        expect(secondHarness.model.stream).toBe(sharedSecondStream);
        expect(conflictHarness.model.stream).toBe(conflictStream);

        // the two same-channel reservations actually share one logical tuner
        // slot (not just "happen to both succeed"); the conflict reservation
        // bypasses tuner assignment entirely and must not appear here
        expect(streamCreator.model.tuners[0].programs).toHaveLength(2);
        expect(streamCreator.model.tuners[0].programs.map((program: any) => program.reserve.id)).toEqual([
            sharedFirst.id,
            sharedSecond.id,
        ]);

        sharedFirstStream.emit('close');
        sharedSecondStream.emit('close');
        conflictStream.emit('close');
        await new Promise(resolve => setImmediate(resolve));

        expect(closeSharedFirst).toHaveBeenCalledOnce();
        expect(closeSharedSecond).toHaveBeenCalledOnce();
        expect(closeConflict).toHaveBeenCalledOnce();
        // the shared tuner slot is released once both programs terminate
        expect(streamCreator.model.tuners[0].programs).toHaveLength(0);

        // double-close: re-emitting a terminal event must not call close again
        sharedFirstStream.emit('close');
        await new Promise(resolve => setImmediate(resolve));
        expect(closeSharedFirst).toHaveBeenCalledOnce();
    });

    it('[Task 9.7][RE-8.2][RE-9.4] treats a common-port program acquisition failure as a recoverable prepare failure without ever creating a stream to close', async () => {
        const failure = new Error('synthetic program-open failure');
        const openProgramStream = vi.fn(async () => {
            throw failure;
        });
        const streamCreator = makeStreamCreator({ tunerServerAccess: { openProgramStream } });
        const reserve = makeReserve({ id: 9731 });
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => reserve) },
            streamCreator: streamCreator.model,
        });
        const session = makeRecordingSessionBinding(reserve, {
            generation: 1n,
            phase: 'Preparing',
            sessionToken: 1n,
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.doRecord = vi.fn(async () => undefined);

        await harness.model.startPreparation();
        await new Promise(resolve => setImmediate(resolve));

        expect(openProgramStream).toHaveBeenCalledOnce();
        expect(harness.model.doRecord).not.toHaveBeenCalled();
        expect(harness.model.stream).toBeNull();
        expect(harness.model.abortController).toBeNull();
        // a recoverable single failure schedules a retry rather than
        // immediately declaring the preparation failed
        expect(harness.model.retryTimerId).not.toBeNull();
        expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
    });

    it.each(['plain failure', 'cancelled'] as const)(
        '[Task 9.7][RE-8.1][RE-8.2][RE-9.4] does not destroy the successor stream when the stale attempt fails BEFORE acquiring (%s)',
        async variant => {
            const successorStream = new PassThrough();
            const successorData = vi.fn();
            const closeSuccessor = vi.fn();
            const opening = deferred<{ close: () => void; stream: PassThrough }>();
            const openProgramStream = vi.fn(() => opening.promise);
            const streamCreator = makeStreamCreator({ tunerServerAccess: { openProgramStream } });
            const reserve = makeReserve({ id: 9761 });
            const harness = makeRecorder({
                reserveDB: { findId: vi.fn(async () => reserve) },
                streamCreator: streamCreator.model,
            });
            const session = makeRecordingSessionBinding(reserve, {
                generation: 1n,
                phase: 'Preparing',
                sessionToken: 1n,
            });
            harness.model.reserve = reserve;
            harness.model.bindScheduleSession(session.binding);
            harness.model.doRecord = vi.fn(async () => undefined);
            successorStream.on('data', successorData);
            successorStream.once('close', closeSuccessor);

            const preparation = harness.model.startPreparation();
            await vi.waitFor(() => expect(openProgramStream).toHaveBeenCalledOnce());

            // A successor installs its own stream into the shared slot while
            // the stale attempt above is still awaiting its OWN acquisition
            // (i.e. before it ever reaches `acquiredStream = this.stream`).
            harness.model.stream = successorStream;

            if (variant === 'cancelled') {
                harness.model.isStopPrepRec = true;
            }
            // The stale attempt's own acquisition now fails; it never got a
            // stream of its own, so acquiredStream stays null the whole time.
            opening.reject(new Error(`synthetic pre-acquisition failure (${variant})`));
            await preparation;
            await new Promise(resolve => setImmediate(resolve));

            // the stale attempt owned nothing, so it must not touch whatever
            // now occupies the shared slot
            expect(successorStream.destroyed).toBe(false);
            expect(successorStream.listenerCount('data')).toBe(1);
            expect(successorData).not.toHaveBeenCalled();
            expect(closeSuccessor).not.toHaveBeenCalled();
            expect(harness.model.stream).toBe(successorStream);
        },
    );

    it('[Task 9.7][RE-8.1][RE-9.4] scopes a stale time-specified session release to its own attempt when a successor races in', async () => {
        const staleStream = new PassThrough();
        const successorStream = new PassThrough();
        const closeStale = vi.fn();
        const recording = deferred<void>();
        const original = makeReserve({
            endAt: Date.now() + 60_000,
            id: 9741,
            isConflict: true,
            isTimeSpecified: true,
            programId: null,
            startAt: Date.now(),
        });
        const openServiceStream = vi.fn(async () => ({ close: closeStale, stream: staleStream }));
        const streamCreator = makeStreamCreator({ tunerServerAccess: { openServiceStream } });
        const releaseTimeSpecifiedEnd = vi.spyOn(streamCreator.model, 'releaseTimeSpecifiedEnd');
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => original) },
            streamCreator: streamCreator.model,
        });
        const session = makeRecordingSessionBinding(original, {
            generation: 1n,
            phase: 'Preparing',
            sessionToken: 1n,
        });
        session.binding.tryTransition.mockReturnValueOnce(false);
        harness.model.reserve = original;
        harness.model.bindScheduleSession(session.binding);
        harness.model.doRecord = vi.fn(() => recording.promise);

        const preparation = harness.model.startPreparation();
        await vi.waitFor(() => expect(openServiceStream).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(session.binding.tryTransition).toHaveBeenCalledOnce());
        harness.model.stream = successorStream;
        await preparation;
        await new Promise(resolve => setImmediate(resolve));

        expect(staleStream.destroyed).toBe(true);
        expect(closeStale).toHaveBeenCalledOnce();
        expect(successorStream.destroyed).toBe(false);
        expect(harness.model.stream).toBe(successorStream);
        // the stale attempt never transitioned, so it must never have
        // registered (or released) a time-specified end for its own session
        expect(session.binding.registerTimeSpecifiedEnd).not.toHaveBeenCalled();
        expect(releaseTimeSpecifiedEnd).not.toHaveBeenCalled();
    });

    it('[Task 9.7][RE-8.2][RE-9.4] closes its acquired common-port stream at the five-second first-data timeout without ever starting the recording', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-tuner-first-data-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const close = vi.fn();
        const openProgramStream = vi.fn(async () => ({ close, stream }));
        const streamCreator = makeStreamCreator({ tunerServerAccess: { openProgramStream } });
        const reserve = makeReserve({ id: 9781 });
        const harness = makeRecorder({
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'synthetic.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
            },
            reserveDB: { findId: vi.fn(async () => reserve) },
            streamCreator: streamCreator.model,
        });
        harness.model.reserve = reserve;

        try {
            const preparation = harness.model.startPreparation();
            // flush the acquisition/findId/getRecPath/createWriteStream chain
            // (all plain promise resolutions, no real timers involved) before
            // the real 5-second first-data timer becomes the only thing left
            await vi.advanceTimersByTimeAsync(0);
            expect(openProgramStream).toHaveBeenCalledOnce();

            await vi.advanceTimersByTimeAsync(4_999);
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            expect(close).not.toHaveBeenCalled();
            expect(stream.destroyed).toBe(false);

            await vi.advanceTimersByTimeAsync(1);
            await preparation;

            // no first data ever arrived, so the recording never started, and
            // the acquired common-port stream was torn down through the same
            // real tuner-access close handle exercised elsewhere in this file
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            expect(stream.destroyed).toBe(true);
            expect(close).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.7][RE-8.2][RE-9.4] does not destroy the successor stream when the stale attempt overdues path selection', async () => {
        const staleStream = new PassThrough();
        const successorStream = new PassThrough();
        const closeStale = vi.fn();
        const recording = deferred<void>();
        const original = makeReserve({ id: 9791 });
        const openProgramStream = vi.fn(async () => ({ close: closeStale, stream: staleStream }));
        const streamCreator = makeStreamCreator({ tunerServerAccess: { openProgramStream } });
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => original) },
            streamCreator: streamCreator.model,
        });
        const session = makeRecordingSessionBinding(original, {
            generation: 1n,
            phase: 'Preparing',
            sessionToken: 1n,
        });
        harness.model.reserve = original;
        harness.model.bindScheduleSession(session.binding);
        harness.model.doRecord = vi.fn(() => recording.promise);

        const preparation = harness.model.startPreparation();
        await vi.waitFor(() => expect(harness.model.doRecord).toHaveBeenCalledOnce());

        // A successor installs its own stream into the shared slot while the
        // stale attempt above is still awaiting doRecord.
        harness.model.stream = successorStream;

        // The stale attempt's own doRecord now overdues path selection, which
        // routes through handlePathSelectionOverdue() instead of prepRecord's
        // generic catch cleanup.
        recording.reject(
            Object.assign(new Error('synthetic stale path selection overdue'), {
                name: 'PathSelectionOverdueError',
                terminal: Promise.resolve(),
            }),
        );
        await preparation;
        await new Promise(resolve => setImmediate(resolve));

        expect(staleStream.destroyed).toBe(true);
        expect(closeStale).toHaveBeenCalledOnce();
        expect(successorStream.destroyed).toBe(false);
        expect(harness.model.stream).toBe(successorStream);
    });
});
