import 'reflect-metadata';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeReserve, makeStreamCreator } from './_harness';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('RecordingStreamCreator.changeEndAt (unittest/imp)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('[R2-STREAM-CREATOR-CHANGE-END-AT] rejects when programId is not null', () => {
        const { model } = makeStreamCreator();
        const reserve = makeReserve({ id: 21, programId: 9001, isTimeSpecified: false });

        expect(() => model.changeEndAt(reserve)).toThrow('StreamChangeAtError');
    });

    it('[R2-STREAM-CREATOR-CHANGE-END-AT] rejects when no end timer is registered', () => {
        const { model } = makeStreamCreator();
        const reserve = makeReserve({
            id: 22,
            programId: null,
            isTimeSpecified: true,
            startAt: Date.now(),
            endAt: Date.now() + 60_000,
        });

        expect(() => model.changeEndAt(reserve)).toThrow('StreamChangeAtError');
    });

    it('[R2-STREAM-CREATOR-CHANGE-END-AT] clears prior end timer so only the latest end destroys once', async () => {
        const marginSec = 5;
        const now = 1_700_000_000_000;
        vi.setSystemTime(now);

        const { model, tunerServerAccess } = makeStreamCreator({
            config: {
                timeSpecifiedEndMargin: marginSec,
                timeSpecifiedStartMargin: 0,
                recPriority: 2,
                conflictPriority: 9,
            },
        });

        // Existing-timer precondition via production create → getTimeSpecifiedStream.
        const reserve = makeReserve({
            id: 23,
            programId: null,
            isTimeSpecified: true,
            isConflict: true,
            channelId: 10,
            startAt: now,
            endAt: now + 60_000,
        });
        // Call through real destroyStream (do not no-op the lifecycle under review).
        const destroyStream = vi.spyOn(model as any, 'destroyStream');
        await model.create(reserve);
        expect(tunerServerAccess.openServiceStream).toHaveBeenCalled();
        destroyStream.mockClear();

        const oldDelay = 60_000 + 1000 * marginSec;
        const newEndAt = now + 120_000;
        const newDelay = newEndAt - now + 1000 * marginSec;
        const changed = makeReserve({
            id: 23,
            programId: null,
            isTimeSpecified: true,
            isConflict: true,
            channelId: 10,
            startAt: now,
            endAt: newEndAt,
        });
        model.changeEndAt(changed);

        // Old end + margin: prior timer must not destroy (replacement owns the slot).
        await vi.advanceTimersByTimeAsync(oldDelay);
        expect(destroyStream).not.toHaveBeenCalled();

        // New end + margin: exactly one destruction with the changed reserve.
        await vi.advanceTimersByTimeAsync(newDelay - oldDelay);
        expect(destroyStream).toHaveBeenCalledTimes(1);
        expect(destroyStream).toHaveBeenCalledWith(changed);
        expect(Object.keys((model as any).timerIndex)).toHaveLength(0);
    });
});
