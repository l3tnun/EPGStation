import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStorageManager } from './_storage-harness';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/**
 * Real StorageManageModel.checkEntry snapshot-reject catch (L187–191).
 * remove + free below threshold; getSnapshot rejects → log pair and break; no deletion.
 * Object.create is forbidden — use createStorageManager / real constructor.
 */
describe('StorageManageModel.checkEntry snapshot catch (unittest/imp)', () => {
    it('[R2-STORAGE-SNAPSHOT-CATCH] getSnapshot reject logs pair and skips deletion', async () => {
        const snapshotFailure = new Error('SyntheticSnapshotFailure');
        const { deletionPort, findOld, getSnapshot, logger, manager } = createStorageManager({
            getSnapshot: async () => {
                throw snapshotFailure;
            },
            findOld: async () => ({ id: 91 }),
        });
        manager.getFreeSize = vi.fn(async () => 0);
        const entry = {
            action: 'remove' as const,
            limitThreshold: 1,
            name: 'snapshot-fail',
            path: 'synthetic-storage/snapshot-fail',
        };

        await expect(manager.check([entry])).resolves.toBeUndefined();

        expect(manager.getFreeSize).toHaveBeenCalledOnce();
        expect(getSnapshot).toHaveBeenCalledOnce();
        expect(logger.system.error).toHaveBeenCalledWith('failed to get recorded use snapshot');
        expect(logger.system.error).toHaveBeenCalledWith(snapshotFailure);
        expect(findOld).not.toHaveBeenCalled();
        expect(deletionPort.requests).toEqual([]);
    });
});
