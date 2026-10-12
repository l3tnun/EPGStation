import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, flushImmediate, logger, makeManager, makeReserve } from './_harness';

const activeManagers: any[] = [];

const makeRecorder = (overrides: Record<string, any> = {}) => ({
    bindScheduleSession: vi.fn(),
    cancel: vi.fn(async () => undefined),
    finishAtTimeSpecifiedEnd: vi.fn(),
    resetTimer: vi.fn(() => true),
    setTimer: vi.fn(() => true),
    startPreparation: vi.fn(),
    update: vi.fn(async () => undefined),
    ...overrides,
});

afterEach(() => {
    for (const manager of activeManagers.splice(0)) manager.scheduleController.stop();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('[RE-9.2] recording manager recorder bookkeeping', () => {
    it('keeps a recorder indexed when its preparation is cancelled while a planned deletion is still pending, and drops it once the deletion terminal settles', async () => {
        const terminal = deferred<void>();
        const recorder = makeRecorder({ whenDeletionTerminal: vi.fn(() => terminal.promise) });
        const harness = makeManager({ recorder });
        activeManagers.push(harness.model);
        const reserve = makeReserve({ id: 951, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        void harness.model.cancel(reserve.id, true);

        harness.callbacks.cancelPrep(reserve);

        expect(harness.model.hasReserve(reserve.id)).toBe(true);
        expect(harness.model.recordingIndex[reserve.id]).toBeDefined();

        terminal.resolve();
        await flushImmediate();

        expect(harness.model.hasReserve(reserve.id)).toBe(false);
        expect(harness.model.recordingIndex[reserve.id]).toBeUndefined();
    });

    it('logs and absorbs a recorder update failure so the queued mutation still completes', async () => {
        const failure = new Error('synthetic-update-failure');
        const recorder = makeRecorder();
        const harness = makeManager({ recorder });
        activeManagers.push(harness.model);
        const reserve = makeReserve({ id: 952, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        recorder.update.mockRejectedValueOnce(failure);
        logger.system.error.mockClear();

        await expect(
            harness.model.update({
                isSuppressLog: false,
                update: [makeReserve({ ...reserve, endAt: reserve.endAt + 30_000 })],
            }),
        ).resolves.toBeUndefined();

        expect(recorder.update).toHaveBeenCalledTimes(1);
        expect(logger.system.error.mock.calls).toEqual([[`update recording error: ${reserve.id}`], [failure]]);
        expect(harness.model.hasReserve(reserve.id)).toBe(true);
    });
});
