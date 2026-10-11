import 'reflect-metadata';

import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger, makeReserve, makeStreamCreator } from './_harness';

const NOW = 1_700_000_000_000;

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
});

const timeSpecifiedReserve = (overrides: Record<string, unknown> = {}) =>
    makeReserve({
        id: 610,
        programId: null,
        isTimeSpecified: true,
        isConflict: true,
        channelId: 10,
        startAt: NOW,
        endAt: NOW + 60_000,
        ...overrides,
    });

describe('RecordingStreamCreator lifecycle details (unittest/imp)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });

    it('[RE-3.6][Task 3.2] sweeps reservations that ended over 12 hours ago every 30 minutes and no earlier', async () => {
        const { model } = makeStreamCreator();
        model.setTuner([{ types: ['GR'] }]);
        model.tuners[0].programs = [
            { reserve: makeReserve({ id: 1, endAt: NOW - 13 * 60 * 60 * 1000 }), stream: null },
            { reserve: makeReserve({ id: 2, endAt: NOW - 11 * 60 * 60 * 1000 }), stream: null },
        ];

        await vi.advanceTimersByTimeAsync(30 * 60 * 1000 - 1);
        expect(model.tuners[0].programs).toHaveLength(2);

        await vi.advanceTimersByTimeAsync(1);
        expect(model.tuners[0].programs.map((program: any) => program.reserve.id)).toEqual([2]);
    });

    it('[RE-3.6][Task 3.5] deleting a tracked reservation cancels its end timer and closes only its own stream', () => {
        const { model } = makeStreamCreator();
        const otherStream = new PassThrough();
        const targetStream = new PassThrough();
        model.tuners = [
            {
                types: ['GR'],
                programs: [
                    { reserve: makeReserve({ id: 1 }), stream: otherStream },
                    { reserve: makeReserve({ id: 2 }), stream: targetStream },
                ],
            },
        ];
        const endCallback = vi.fn();
        model.timerIndex[2] = setTimeout(endCallback, 60_000);

        model.deleteReserve(2);

        expect(vi.getTimerCount()).toBe(0);
        expect(model.timerIndex).toEqual({});
        expect(targetStream.destroyed).toBe(true);
        expect(otherStream.destroyed).toBe(false);
        expect(model.tuners[0].programs.map((program: any) => program.reserve.id)).toEqual([1]);
        expect(logger.system.debug.mock.calls).toEqual([['delete stream: 2']]);
        otherStream.destroy();
    });

    it('[RE-3.6][Task 3.5] deleting an unknown reservation leaves every tuner untouched and does not throw', () => {
        const { model } = makeStreamCreator();
        const stream = new PassThrough();
        model.tuners = [
            { types: ['GR'], programs: [{ reserve: makeReserve({ id: 1 }), stream }] },
            { types: ['GR'], programs: [] },
        ];

        expect(() => model.deleteReserve(999)).not.toThrow();

        expect(model.tuners[0].programs.map((program: any) => program.reserve.id)).toEqual([1]);
        expect(stream.destroyed).toBe(false);
        expect(logger.system.debug).not.toHaveBeenCalled();
        stream.destroy();
    });

    it('[RE-3.6][Task 3.5] deleting a reservation whose stream is still pending only removes the entry', () => {
        const { model } = makeStreamCreator();
        model.tuners = [{ types: ['GR'], programs: [{ reserve: makeReserve({ id: 3 }), stream: null }] }];

        expect(() => model.deleteReserve(3)).not.toThrow();

        expect(model.tuners[0].programs).toEqual([]);
        expect(logger.system.debug.mock.calls).toEqual([['delete stream: 3']]);
    });

    it('[RE-3.6][Task 3.5] closing a stream closes its tuner handle immediately and marks the stream as ended', async () => {
        const stream = new PassThrough();
        const close = vi.fn();
        const { model } = makeStreamCreator({
            tunerServerAccess: { openProgramStream: vi.fn(async () => ({ stream, close })) },
        });
        model.tuners = [{ types: ['GR'], programs: [] }];
        const reserve = makeReserve({ id: 4 });
        await model.create(reserve);

        model.deleteReserve(4);

        expect(close).toHaveBeenCalledTimes(1);
        expect(stream.destroyed).toBe(true);
        expect((stream as any)._readableState.ended).toBe(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('[RE-3.6][Task 3.2] logs which stream is stopped when a tuner is reassigned', async () => {
        const currentStream = new PassThrough();
        const nextStream = new PassThrough();
        const currentReserve = makeReserve({
            id: 5,
            channel: 'synthetic-current',
            allowEndLack: true,
            endAt: NOW + 15_000,
        });
        const { model } = makeStreamCreator({
            tunerServerAccess: {
                openProgramStream: vi.fn(async () => ({ stream: nextStream, close: vi.fn() })),
                getProgram: vi.fn(async () => ({ startAt: NOW, duration: 15_000 })),
            },
        });
        model.tuners = [{ types: ['GR'], programs: [{ reserve: currentReserve, stream: currentStream }] }];

        await model.create(makeReserve({ id: 6, channel: 'synthetic-next' }));

        expect(logger.system.debug.mock.calls).toEqual([['delete stream: 5']]);
        currentStream.destroy();
        nextStream.destroy();
    });

    it('[RE-3.6][Task 3.2] a conflicting reservation opens its stream without taking a tuner or reporting an assignment failure', async () => {
        const stream = new PassThrough();
        const openProgramStream = vi.fn(async () => ({ stream, close: vi.fn() }));
        const { model } = makeStreamCreator({ tunerServerAccess: { openProgramStream } });
        model.tuners = [{ types: ['GR'], programs: [] }];

        await expect(model.create(makeReserve({ id: 7, isConflict: true }))).resolves.toBe(stream);

        expect(model.tuners[0].programs).toEqual([]);
        expect(logger.system.warn).not.toHaveBeenCalled();
        expect(openProgramStream).toHaveBeenCalledWith(expect.objectContaining({ priority: 9 }));
        stream.destroy();
    });

    describe('time-specified stream', () => {
        it('[RE-2.6][Task 1.9] a failed open reports the error, cancels the owned end timer and rethrows', async () => {
            const failure = new Error('synthetic service stream failure');
            const { model } = makeStreamCreator({
                tunerServerAccess: { openServiceStream: vi.fn(async () => Promise.reject(failure)) },
            });

            await expect(model.create(timeSpecifiedReserve())).rejects.toBe(failure);

            expect(logger.system.error.mock.calls).toEqual([['stream get error 10'], [failure]]);
            expect(model.timerIndex).toEqual({});
            expect(vi.getTimerCount()).toBe(0);
        });

        it('[RE-2.6][Task 1.9] a failed open leaves an externally scheduled end timer alone', async () => {
            const failure = new Error('synthetic service stream failure');
            const { model } = makeStreamCreator({
                tunerServerAccess: { openServiceStream: vi.fn(async () => Promise.reject(failure)) },
            });
            const externalEnd = vi.fn();
            model.timerIndex[610] = setTimeout(externalEnd, 60_000);

            await expect(
                model.create(timeSpecifiedReserve(), undefined, { isTimeSpecifiedEndExternallyScheduled: true }),
            ).rejects.toBe(failure);

            expect(model.timerIndex[610]).toBeDefined();
            expect(vi.getTimerCount()).toBe(1);
        });

        it('[RE-2.6][Task 1.9] the owned end timer is released when the stream ends', async () => {
            const stream = new PassThrough();
            const { model } = makeStreamCreator({
                tunerServerAccess: { openServiceStream: vi.fn(async () => ({ stream, close: vi.fn() })) },
            });
            await model.create(timeSpecifiedReserve());
            expect(model.timerIndex[610]).toBeDefined();
            expect(vi.getTimerCount()).toBe(1);

            stream.resume();
            stream.end();
            await vi.advanceTimersByTimeAsync(0);

            expect(model.timerIndex).toEqual({});
            expect(vi.getTimerCount()).toBe(0);
        });

        it('[RE-2.6][Task 1.9] an externally scheduled end timer is not touched when the stream ends', async () => {
            const stream = new PassThrough();
            const { model } = makeStreamCreator({
                tunerServerAccess: { openServiceStream: vi.fn(async () => ({ stream, close: vi.fn() })) },
            });
            const externalEnd = vi.fn();
            model.timerIndex[610] = setTimeout(externalEnd, 60_000);
            await model.create(timeSpecifiedReserve(), undefined, { isTimeSpecifiedEndExternallyScheduled: true });

            stream.resume();
            stream.end();
            await vi.advanceTimersByTimeAsync(0);

            expect(model.timerIndex[610]).toBeDefined();
            expect(vi.getTimerCount()).toBe(1);
            expect(externalEnd).not.toHaveBeenCalled();
        });

        it('[RE-2.6][Task 1.9] changing the end time re-arms the timer at exactly the new end plus the margin', async () => {
            const marginSec = 5;
            const { model } = makeStreamCreator({ config: { timeSpecifiedEndMargin: marginSec } });
            const destroyStream = vi.spyOn(model as any, 'destroyStream');
            await model.create(timeSpecifiedReserve());
            destroyStream.mockClear();

            const changed = timeSpecifiedReserve({ endAt: NOW + 120_000 });
            model.changeEndAt(changed);
            const delay = 120_000 + 1000 * marginSec;

            await vi.advanceTimersByTimeAsync(delay - 1);
            expect(destroyStream).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(destroyStream).toHaveBeenCalledTimes(1);
        });

        it('[RE-2.6][Task 1.9] changing the end time is rejected for a program reservation even when a timer exists', () => {
            const { model } = makeStreamCreator();
            model.timerIndex[611] = setTimeout(() => undefined, 60_000);

            expect(() => model.changeEndAt(makeReserve({ id: 611, programId: 9001 }))).toThrow('StreamChangeAtError');
            expect(vi.getTimerCount()).toBe(1);
        });
    });
});
