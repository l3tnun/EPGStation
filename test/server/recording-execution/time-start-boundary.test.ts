import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, load, makeReserve, makeStreamCreator } from './_harness';

const Util = load<{ sleep: (msec: number) => Promise<void> }>('util', 'Util.js');

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('time-specified stream start boundary', () => {
    it.each([
        ['before the start deadline', 4_000, 13_000],
        ['after the start deadline', 18_000, 0],
    ])('[Tasks 1.9/3.3/3.5] subtracts service-open latency %s', async (_case, openLatency, expectedRemaining) => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const opening = deferred<any>();
        const stream = new PassThrough();
        const harness = makeStreamCreator({
            config: { timeSpecifiedStartMargin: 3 },
            tunerServerAccess: { openServiceStream: vi.fn(() => opening.promise) },
        });
        const reserve = makeReserve({
            id: 481,
            isConflict: true,
            isTimeSpecified: true,
            programId: null,
            startAt: 1_020_000,
            endAt: 1_060_000,
        });
        const creation = harness.model.create(reserve, undefined, {
            isTimeSpecifiedEndExternallyScheduled: true,
        });
        let settled = false;
        void creation.then(() => {
            settled = true;
        });

        await vi.advanceTimersByTimeAsync(openLatency);
        opening.resolve({ stream, close: vi.fn() });
        await vi.advanceTimersByTimeAsync(0);

        if (expectedRemaining > 0) {
            expect(stream.listenerCount('data')).toBe(1);
            await vi.advanceTimersByTimeAsync(expectedRemaining - 1);
            expect(settled).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
        }

        expect(settled).toBe(true);
        await expect(creation).resolves.toBe(stream);
        expect(stream.listenerCount('data')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        stream.destroy();
    });

    it('[Tasks 1.9/3.5] removes only its owned drain listener after the start wait', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const stream = new PassThrough();
        const otherOwnerDataListener = vi.fn();
        stream.on('data', otherOwnerDataListener);
        const harness = makeStreamCreator({
            config: { timeSpecifiedStartMargin: 5 },
            tunerServerAccess: {
                openServiceStream: vi.fn(async () => ({ stream, close: vi.fn() })),
            },
        });
        const creation = harness.model.create(
            makeReserve({
                id: 482,
                isConflict: true,
                isTimeSpecified: true,
                programId: null,
                startAt: 1_020_000,
                endAt: 1_060_000,
            }),
            undefined,
            { isTimeSpecifiedEndExternallyScheduled: true },
        );

        await vi.advanceTimersByTimeAsync(0);
        expect(stream.listeners('data')).toContain(otherOwnerDataListener);
        expect(stream.listenerCount('data')).toBe(2);
        stream.write(Buffer.from('synthetic packet'));
        expect(otherOwnerDataListener).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(14_999);
        expect(stream.listenerCount('data')).toBe(2);
        await vi.advanceTimersByTimeAsync(1);

        await expect(creation).resolves.toBe(stream);
        expect(stream.listeners('data')).toEqual([otherOwnerDataListener]);
        expect(vi.getTimerCount()).toBe(0);
        stream.destroy();
    });

    it('[Tasks 1.9/3.5] removes its owned drain listener when the start wait rejects', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const waiting = deferred<void>();
        vi.spyOn(Util, 'sleep').mockReturnValueOnce(waiting.promise);
        const stream = new PassThrough();
        const otherOwnerDataListener = vi.fn();
        stream.on('data', otherOwnerDataListener);
        const harness = makeStreamCreator({
            config: { timeSpecifiedStartMargin: 5 },
            tunerServerAccess: {
                openServiceStream: vi.fn(async () => ({ stream, close: vi.fn() })),
            },
        });
        const creation = harness.model.create(
            makeReserve({
                id: 483,
                isConflict: true,
                isTimeSpecified: true,
                programId: null,
                startAt: 1_020_000,
                endAt: 1_060_000,
            }),
            undefined,
            { isTimeSpecifiedEndExternallyScheduled: true },
        );
        const observed = creation.catch((error: unknown) => error);

        await vi.advanceTimersByTimeAsync(0);
        expect(Util.sleep).toHaveBeenCalledWith(15_000);
        expect(stream.listeners('data')).toContain(otherOwnerDataListener);
        expect(stream.listenerCount('data')).toBe(2);
        const failure = new Error('synthetic start-wait failure');
        waiting.reject(failure);

        await expect(observed).resolves.toBe(failure);
        expect(stream.listeners('data')).toEqual([otherOwnerDataListener]);
        expect(vi.getTimerCount()).toBe(0);
        stream.destroy();
    });
});
