import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStorageManager, settleMicrotasks } from './_storage-harness';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/**
 * Real StorageManageModel.start interval catch (L99–102).
 * Happy-path interval reads are covered (SM-2.x); residual is the check().catch log pair.
 * Replaces check so the outer catch is the only path under test — Object.create is forbidden.
 */
describe('StorageManageModel.start interval catch (unittest/imp)', () => {
    it('[R2-STORAGE-START-INTERVAL-CATCH] check reject logs disk check error pair and keeps interval until stop', async () => {
        vi.useFakeTimers();
        const checkFailure = new Error('SyntheticDiskCheckFailure');
        const { logger, manager } = createStorageManager({
            entries: [{ limitThreshold: 10, name: 'monitored', path: 'synthetic-storage/monitored' }],
            intervalSeconds: 1,
        });
        manager.check = vi.fn(async (_list: unknown) => {
            throw checkFailure;
        });

        manager.start();
        expect(manager.timerId).not.toBeNull();
        expect(logger.system.error).not.toHaveBeenCalled();
        expect(manager.check).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1_000);
        await settleMicrotasks();

        expect(manager.check).toHaveBeenCalledOnce();
        expect(logger.system.error).toHaveBeenCalledWith('disk check error');
        expect(logger.system.error).toHaveBeenCalledWith(checkFailure);
        expect(logger.system.error).toHaveBeenCalledTimes(2);

        manager.stop();
        expect(vi.getTimerCount()).toBe(0);
    });
});
