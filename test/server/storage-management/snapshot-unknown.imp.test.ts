import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStorageManager } from './_storage-harness';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/**
 * Real StorageManageModel.checkEntry snapshot unknown branch (L193–196).
 * remove + free below threshold; getSnapshot resolves { status: 'unknown' }
 * → log once and break; no findOld / deletion.
 * Object.create is forbidden — use createStorageManager / real constructor.
 */
describe('StorageManageModel.checkEntry snapshot unknown (unittest/imp)', () => {
    it('[R2-STORAGE-SNAPSHOT-UNKNOWN] getSnapshot unknown logs once and skips deletion', async () => {
        const { deletionPort, findOld, getSnapshot, logger, manager } = createStorageManager({
            getSnapshot: async () => ({ status: 'unknown' as const }),
            findOld: async () => ({ id: 92 }),
        });
        manager.getFreeSize = vi.fn(async () => 0);
        const entry = {
            action: 'remove' as const,
            limitThreshold: 1,
            name: 'snapshot-unknown',
            path: 'synthetic-storage/snapshot-unknown',
        };

        await expect(manager.check([entry])).resolves.toBeUndefined();

        expect(manager.getFreeSize).toHaveBeenCalledOnce();
        expect(getSnapshot).toHaveBeenCalledOnce();
        expect(logger.system.error).toHaveBeenCalledWith('recorded use snapshot is unknown');
        expect(logger.system.error).toHaveBeenCalledTimes(1);
        expect(findOld).not.toHaveBeenCalled();
        expect(deletionPort.requests).toEqual([]);
    });
});
