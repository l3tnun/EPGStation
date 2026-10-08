import 'reflect-metadata';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStorageManager, diskusageDispatch } from './_storage-harness';

afterEach(() => {
    // diskusageDispatch は vi.fn() なので、resetAllMocks で既定（実のdiskusage）の実装へ戻す。
    vi.resetAllMocks();
});

describe('[SM-6.2] free size reading', () => {
    it('resolves the available byte count that the disk usage reports for the storage path', async () => {
        diskusageDispatch.mockImplementation((_dirPath, callback) => {
            callback(null, { available: 4_096 });
        });
        const { manager } = createStorageManager({
            entries: [
                { action: 'none' as const, limitThreshold: 1, name: 'synthetic', path: 'synthetic-storage/free' },
            ],
            intervalSeconds: 1,
        });

        await expect(manager.getFreeSize('synthetic-storage/free')).resolves.toBe(4_096);

        expect(diskusageDispatch).toHaveBeenCalledTimes(1);
        expect(diskusageDispatch.mock.calls[0][0]).toBe('synthetic-storage/free');
    });
});
