import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeReserve, makeSetter } from '../_harness';

const HOLD_LIMIT_MS = 10 * 60 * 1000;

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const deleteDiff = (reserves: unknown[]) => ({ insert: [], update: [], delete: reserves, isSuppressLog: false });

describe('EventSetter held reserve deletion', () => {
    it.each([
        ['ended before now', 1_999, true],
        ['ends exactly now', 2_000, true],
        ['ends after now', 2_001, false],
    ] as const)(
        '[EH-3.3] holds the deletion command of a recording reservation that %s only when its end time has been reached',
        (_label, endAt, expectedHeld) => {
            vi.useFakeTimers();
            vi.setSystemTime(2_000);
            const harness = makeSetter();
            harness.recordingManage.hasReserve.mockReturnValue(true);
            harness.setter.set();
            const reserve = makeReserve({ id: 401, endAt });

            harness.callbacks.reserve.setUpdated(deleteDiff([reserve]));

            expect(harness.recordingManage.hasReserve).toHaveBeenCalledTimes(expectedHeld ? 1 : 0);
            expect(harness.externalCommandManage.addUpdateReseves).toHaveBeenCalledExactlyOnceWith(
                deleteDiff(expectedHeld ? [] : [reserve]),
            );
            expect(vi.getTimerCount()).toBe(expectedHeld ? 1 : 0);
        },
    );

    it('[EH-3.3] does not keep the process alive for a pending hold', () => {
        const unref = vi.fn();
        vi.spyOn(globalThis, 'setTimeout').mockImplementation((() => ({ unref })) as never);
        const harness = makeSetter();
        harness.recordingManage.hasReserve.mockReturnValue(true);
        harness.setter.set();

        harness.callbacks.reserve.setUpdated(deleteDiff([makeReserve({ id: 402, endAt: 1_000 })]));

        expect(unref).toHaveBeenCalledOnce();
    });

    it('[EH-3.3] stops the hold timer when the held deletion is released by the recording result', () => {
        vi.useFakeTimers();
        const harness = makeSetter();
        harness.recordingManage.hasReserve.mockReturnValue(true);
        harness.setter.set();
        const reserve = makeReserve({ id: 403, endAt: 1_000 });

        harness.callbacks.reserve.setUpdated(deleteDiff([reserve]));
        expect(vi.getTimerCount()).toBe(1);
        harness.callbacks.recording.setCancelPrepRecording(reserve);

        expect(vi.getTimerCount()).toBe(0);
        expect(harness.externalCommandManage.addUpdateReseves).toHaveBeenLastCalledWith(deleteDiff([reserve]));
        const calls = harness.externalCommandManage.addUpdateReseves.mock.calls.length;
        vi.advanceTimersByTime(HOLD_LIMIT_MS);
        expect(harness.externalCommandManage.addUpdateReseves.mock.calls).toHaveLength(calls);
    });
});
