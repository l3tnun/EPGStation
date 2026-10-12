import 'reflect-metadata';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStorageManager, diskusageDispatch, settleMicrotasks } from './_storage-harness';

afterEach(() => {
    vi.useRealTimers();
    // `diskusageDispatch` (from `./_storage-harness`) is a plain `vi.fn()`, not a `vi.spyOn` spy --
    // `restoreAllMocks` only restores spies, so `resetAllMocks` is used to bring back its creation-time
    // (real `diskusage-ng`) implementation and avoid leaking this test's override into later tests.
    vi.resetAllMocks();
});

/**
 * Real StorageManageModel capacity path diskusage err (L414–416).
 * Public monitoring path only: entries + start() interval → check → getFreeSize.
 * Mock diskusage-ng only; do not override getFreeSize or call private check().
 */
const installDiskusageError = (err: Error) => {
    diskusageDispatch.mockImplementation((_dirPath, cb) => {
        cb(err);
    });
};

describe('StorageManageModel.getFreeSize diskusage err (unittest/imp)', () => {
    it('[R2-STORAGE-GETFREESIZE-ERR] diskusage err rejects capacity and logs get disk info error pair', async () => {
        vi.useFakeTimers();
        const boom = new Error('SyntheticDiskUsageFailure');
        installDiskusageError(boom);
        const { logger, manager } = createStorageManager({
            entries: [
                {
                    action: 'none' as const,
                    limitThreshold: 1,
                    name: 'disk-fail',
                    path: 'synthetic-storage/disk-fail',
                },
            ],
            intervalSeconds: 1,
        });

        manager.start();
        expect(manager.timerId).not.toBeNull();

        await vi.advanceTimersByTimeAsync(1_000);
        await settleMicrotasks();

        expect(logger.system.error).toHaveBeenCalledWith('get disk info error: synthetic-storage/disk-fail');
        expect(logger.system.error).toHaveBeenCalledWith(boom);
        expect(logger.system.error).toHaveBeenCalledTimes(2);

        manager.stop();
        expect(vi.getTimerCount()).toBe(0);
    });
});
