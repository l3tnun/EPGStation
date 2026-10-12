import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeReserve, makeStreamCreator } from './_harness';

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('[RE-9.2] time-specified stream end timer', () => {
    it('closes the assigned tuner stream and its handle when the reservation end plus margin elapses', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const stream = new PassThrough();
        const close = vi.fn();
        const harness = makeStreamCreator({
            config: { timeSpecifiedEndMargin: 2 },
            tunerServerAccess: { openServiceStream: vi.fn(async () => ({ close, stream })) },
        });
        harness.model.setTuner([{ types: ['GR'] }]);
        const reserve = makeReserve({
            channelType: 'GR',
            id: 491,
            isConflict: false,
            isTimeSpecified: true,
            programId: null,
            startAt: 999_000,
            endAt: 1_030_000,
        });

        await expect(harness.model.create(reserve)).resolves.toBe(stream);
        expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);

        await vi.advanceTimersByTimeAsync(31_999);
        expect(close).not.toHaveBeenCalled();
        expect(stream.destroyed).toBe(false);

        await vi.advanceTimersByTimeAsync(1);

        expect(close).toHaveBeenCalledTimes(1);
        expect(stream.destroyed).toBe(true);
    });
});
