import { afterEach, describe, expect, it, vi } from 'vitest';

import { deferred, flushImmediate, load, makeReserve } from './_harness';

const RecordingManageModel = load<{ prototype: Record<string, unknown> }>(
    'model',
    'operator',
    'recording',
    'RecordingManageModel.js',
);

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real RecordingManageModel.applyScheduleRemoval with injected recordingIndex recorder.
 * Skip/overlap update and normal cancel await/catch residual (L733–744).
 */
const makeSubject = () => {
    const manager: any = Object.create(RecordingManageModel.prototype);
    manager.recordingIndex = Object.create(null);
    manager.recordingSessionTokens = new Map();
    manager.deletionStops = new Set();
    manager.log = {
        system: {
            debug: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
        },
    };
    return manager;
};

describe('RecordingManageModel.applyScheduleRemoval (unittest/imp)', () => {
    it('[R2-APPLY-SCHEDULE-REMOVAL] skip reservation awaits recorder.update before settling', async () => {
        const manager = makeSubject();
        const reserve = makeReserve({ id: 701, isSkip: true, isOverlap: false });
        const updateResult = deferred<void>();
        const update = vi.fn(() => updateResult.promise);
        const cancel = vi.fn(async () => undefined);
        manager.recordingIndex[reserve.id] = { update, cancel };
        let settled = false;

        const removing = manager
            .applyScheduleRemoval({
                reservationId: reserve.id,
                reservation: reserve,
                isSuppressLog: true,
            })
            .then(() => {
                settled = true;
            });

        await vi.waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith(reserve, true));
        await flushImmediate();
        expect(settled).toBe(false);
        expect(cancel).not.toHaveBeenCalled();

        updateResult.resolve();
        await removing;
        expect(settled).toBe(true);
        expect(manager.recordingIndex[reserve.id]).toBeUndefined();
        expect(manager.log.system.error).not.toHaveBeenCalled();
    });

    it('[R2-APPLY-SCHEDULE-REMOVAL] normal reservation awaits recorder.cancel(false) before settling', async () => {
        const manager = makeSubject();
        const reserve = makeReserve({ id: 702, isSkip: false, isOverlap: false });
        const cancelResult = deferred<void>();
        const update = vi.fn(async () => undefined);
        const cancel = vi.fn(() => cancelResult.promise);
        manager.recordingIndex[reserve.id] = { update, cancel };
        let settled = false;

        const removing = manager
            .applyScheduleRemoval({
                reservationId: reserve.id,
                reservation: reserve,
                isSuppressLog: false,
            })
            .then(() => {
                settled = true;
            });

        await vi.waitFor(() => expect(cancel).toHaveBeenCalledExactlyOnceWith(false));
        await flushImmediate();
        expect(settled).toBe(false);
        expect(update).not.toHaveBeenCalled();
        expect(manager.log.system.debug).toHaveBeenCalledWith(`delete recording: ${reserve.id}`);

        cancelResult.resolve();
        await removing;
        expect(settled).toBe(true);
        expect(manager.recordingIndex[reserve.id]).toBeUndefined();
    });

    it('[R2-APPLY-SCHEDULE-REMOVAL] logs when recorder.update rejects on skip path', async () => {
        const manager = makeSubject();
        const reserve = makeReserve({ id: 703, isSkip: false, isOverlap: true });
        const boom = new Error('synthetic-update-failure');
        const update = vi.fn(async () => {
            throw boom;
        });
        manager.recordingIndex[reserve.id] = { update, cancel: vi.fn(async () => undefined) };

        await expect(
            manager.applyScheduleRemoval({
                reservationId: reserve.id,
                reservation: reserve,
                isSuppressLog: false,
            }),
        ).resolves.toBeUndefined();

        expect(update).toHaveBeenCalledExactlyOnceWith(reserve, false);
        expect(manager.log.system.error.mock.calls).toEqual([
            [`update recording error: ${reserve.id}`],
            [boom],
        ]);
    });

    it('[R2-APPLY-SCHEDULE-REMOVAL] logs when recorder.cancel rejects on normal path', async () => {
        const manager = makeSubject();
        const reserve = makeReserve({ id: 704, isSkip: false, isOverlap: false });
        const boom = new Error('synthetic-cancel-failure');
        const cancel = vi.fn(async () => {
            throw boom;
        });
        manager.recordingIndex[reserve.id] = { update: vi.fn(async () => undefined), cancel };

        await expect(
            manager.applyScheduleRemoval({
                reservationId: reserve.id,
                reservation: reserve,
                isSuppressLog: false,
            }),
        ).resolves.toBeUndefined();

        expect(cancel).toHaveBeenCalledExactlyOnceWith(false);
        expect(manager.log.system.error.mock.calls).toEqual([
            [`delete recording error: ${reserve.id}`],
            [boom],
        ]);
    });
});
