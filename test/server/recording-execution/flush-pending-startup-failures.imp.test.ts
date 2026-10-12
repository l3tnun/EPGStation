import { afterEach, describe, expect, it, vi } from 'vitest';

import { load, makeReserve } from './_harness';

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
 * Real RecordingManageModel.flushPendingStartupRecordingFailures with processRecordingFailure
 * spied. Non-empty pendingStartupRecordingFailures queue was not exercised, leaving L384–390 residual.
 */
const makeFlushSubject = () => {
    const manager: any = Object.create(RecordingManageModel.prototype);
    manager.pendingStartupRecordingFailures = [];
    manager.log = {
        system: {
            debug: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
        },
    };
    manager.processRecordingFailure = vi.fn(async () => undefined);
    return manager;
};

describe('RecordingManageModel.flushPendingStartupRecordingFailures (unittest/imp)', () => {
    it('[R2-RECORDINGMANAGE-FLUSH-PENDING] drains the queue and calls processRecordingFailure for each entry', async () => {
        const manager = makeFlushSubject();
        const reserveA = makeReserve({ id: 501 });
        const reserveB = makeReserve({ id: 502 });
        const failureA = { reservationId: 501, reservation: reserveA };
        const failureB = { reservationId: 502, reservation: reserveB };
        manager.pendingStartupRecordingFailures = [
            { reserve: reserveA, failure: failureA },
            { reserve: reserveB, failure: failureB },
        ];

        await expect(manager.flushPendingStartupRecordingFailures()).resolves.toBeUndefined();

        expect(manager.processRecordingFailure.mock.calls).toEqual([
            [reserveA, failureA],
            [reserveB, failureB],
        ]);
        expect(manager.pendingStartupRecordingFailures).toEqual([]);
        expect(manager.log.system.error).not.toHaveBeenCalled();
    });

    it('[R2-RECORDINGMANAGE-FLUSH-PENDING] logs and continues when processRecordingFailure rejects', async () => {
        const manager = makeFlushSubject();
        const reserve = makeReserve({ id: 601 });
        const failure = { reservationId: 601, reservation: reserve };
        const boom = new Error('synthetic-process-recording-failure');
        manager.processRecordingFailure = vi.fn(async () => {
            throw boom;
        });
        manager.pendingStartupRecordingFailures = [{ reserve, failure }];

        await expect(manager.flushPendingStartupRecordingFailures()).resolves.toBeUndefined();

        expect(manager.processRecordingFailure).toHaveBeenCalledExactlyOnceWith(reserve, failure);
        expect(manager.log.system.error).toHaveBeenCalledExactlyOnceWith(boom);
        expect(manager.pendingStartupRecordingFailures).toEqual([]);
    });
});
