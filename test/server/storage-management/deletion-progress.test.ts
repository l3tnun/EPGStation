import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    deferred,
    RecordedStorageDeletionPortDouble,
    createStorageManager,
    settleMicrotasks,
} from './_storage-harness';

const progressEntry = {
    action: 'remove' as const,
    limitThreshold: 3,
    name: 'progress-storage',
    path: 'synthetic-storage/progress',
};

afterEach(() => {
    vi.useRealTimers();
});

describe('storage deletion port preparation: attempted ID guard and no progress, MB conversion and threshold before, at, and above', () => {
    it.each(['deleted', 'not-deleted'] as const)(
        '[SM-4.8-PORT-PREP] keeps the %s outcome without adding a deletion attempt',
        async result => {
            const deleteForStoragePressure = vi.fn(async () => result);
            const port = new RecordedStorageDeletionPortDouble(deleteForStoragePressure);

            await expect(port.deleteForStoragePressure(92, 'progress-storage')).resolves.toBe(result);

            expect(deleteForStoragePressure).toHaveBeenCalledOnce();
            expect(port.requests).toEqual([{ recordedId: 92, storageName: 'progress-storage' }]);
            expect(port.settlements).toEqual([{ recordedId: 92, storageName: 'progress-storage', outcome: result }]);
        },
    );

    it('[SM-4.8-PORT-PREP] propagates a deletion rejection without a second port call', async () => {
        const rejection = new Error('synthetic storage deletion rejection');
        const deleteForStoragePressure = vi.fn(async () => {
            throw rejection;
        });
        const port = new RecordedStorageDeletionPortDouble(deleteForStoragePressure);

        await expect(port.deleteForStoragePressure(93, 'progress-storage')).rejects.toBe(rejection);

        expect(deleteForStoragePressure).toHaveBeenCalledOnce();
        expect(port.requests).toEqual([{ recordedId: 93, storageName: 'progress-storage' }]);
        expect(port.settlements).toEqual([{ recordedId: 93, storageName: 'progress-storage', error: rejection }]);
    });

    it.each([
        ['same', 1024 * 1024],
        ['lower', 512 * 1024],
    ] as const)(
        '[SM-4.8] stops after a %s raw-byte progress result without another candidate or deletion',
        async (_label, nextBytes) => {
            const { candidateRequests, deletionPort, manager } = createStorageManager({
                findOld: vi
                    .fn<() => Promise<{ id: number } | null>>()
                    .mockResolvedValueOnce({ id: 91 })
                    .mockResolvedValueOnce({ id: 92 }),
            });
            const reads = vi
                .fn<(path: string) => Promise<number>>()
                .mockResolvedValueOnce(1024 * 1024)
                .mockResolvedValueOnce(nextBytes);
            manager.getFreeSize = reads;

            await manager.check([progressEntry]);

            expect(candidateRequests).toHaveBeenCalledOnce();
            expect(deletionPort.requests).toEqual([{ recordedId: 91, storageName: progressEntry.name }]);
            expect(reads).toHaveBeenCalledTimes(2);
        },
    );

    it('[SM-4.8] never deletes the same ID twice when the candidate port re-presents it', async () => {
        vi.useFakeTimers();
        const { candidateRequests, deletionPort, manager } = createStorageManager({
            findOld: async () => ({ id: 91 }),
        });
        manager.getFreeSize = vi
            .fn<(path: string) => Promise<number>>()
            .mockResolvedValueOnce(1024 * 1024)
            .mockResolvedValueOnce(2 * 1024 * 1024);

        const check = manager.check([progressEntry]);
        await settleMicrotasks();
        await settleMicrotasks();
        await vi.advanceTimersByTimeAsync(100);
        await check;

        expect(candidateRequests).toHaveBeenCalledTimes(2);
        expect(candidateRequests.mock.calls[1]?.[0]).toMatchObject({
            excludedRecordedIds: new Set([91]),
            storageName: progressEntry.name,
        });
        expect(deletionPort.requests).toEqual([{ recordedId: 91, storageName: progressEntry.name }]);
    });

    it('[SM-4.8] advances to a different candidate when post-delete capacity equals the MB threshold', async () => {
        vi.useFakeTimers();
        const { candidateRequests, deletionPort, manager } = createStorageManager({
            findOld: vi
                .fn<() => Promise<{ id: number } | null>>()
                .mockResolvedValueOnce({ id: 91 })
                .mockResolvedValueOnce({ id: 92 }),
        });
        manager.getFreeSize = vi
            .fn<(path: string) => Promise<number>>()
            .mockResolvedValueOnce(1024 * 1024)
            .mockResolvedValueOnce(3 * 1024 * 1024)
            .mockResolvedValueOnce(4 * 1024 * 1024);

        const check = manager.check([progressEntry]);
        await settleMicrotasks();
        await settleMicrotasks();

        await vi.advanceTimersByTimeAsync(100);
        await check;

        expect(candidateRequests).toHaveBeenCalledTimes(2);
        expect(deletionPort.requests).toEqual([
            { recordedId: 91, storageName: progressEntry.name },
            { recordedId: 92, storageName: progressEntry.name },
        ]);
    });

    it('[SM-4.8] ends without another candidate or wait when first byte progress exceeds the MB threshold', async () => {
        vi.useFakeTimers();
        const { candidateRequests, deletionPort, manager } = createStorageManager({
            findOld: async () => ({ id: 91 }),
        });
        const postRead = deferred<number>();
        manager.getFreeSize = vi
            .fn<(path: string) => Promise<number>>()
            .mockResolvedValueOnce(1024 * 1024)
            .mockReturnValueOnce(postRead.promise);

        let settled = false;
        const check = manager.check([progressEntry]).then(() => {
            settled = true;
        });
        await settleMicrotasks();
        await settleMicrotasks();
        await settleMicrotasks();
        expect(manager.getFreeSize).toHaveBeenCalledTimes(2);

        postRead.resolve(4 * 1024 * 1024);
        await settleMicrotasks();
        await settleMicrotasks();

        expect(candidateRequests).toHaveBeenCalledOnce();
        expect(deletionPort.requests).toEqual([{ recordedId: 91, storageName: progressEntry.name }]);
        expect(settled).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        await check;
    });

    it('[SM-4.8] waits 100 ms before deleting a different candidate after byte progress remains below the MB threshold', async () => {
        vi.useFakeTimers();
        const { deletionPort, manager } = createStorageManager({
            findOld: vi
                .fn<() => Promise<{ id: number } | null>>()
                .mockResolvedValueOnce({ id: 91 })
                .mockResolvedValueOnce({ id: 92 }),
        });
        manager.getFreeSize = vi
            .fn<(path: string) => Promise<number>>()
            .mockResolvedValueOnce(1024 * 1024)
            .mockResolvedValueOnce(2 * 1024 * 1024)
            .mockResolvedValueOnce(4 * 1024 * 1024);

        const check = manager.check([progressEntry]);
        await settleMicrotasks();
        await settleMicrotasks();
        expect(deletionPort.requests).toEqual([{ recordedId: 91, storageName: progressEntry.name }]);

        await vi.advanceTimersByTimeAsync(99);
        expect(deletionPort.requests).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(1);
        await check;

        expect(deletionPort.requests).toEqual([
            { recordedId: 91, storageName: progressEntry.name },
            { recordedId: 92, storageName: progressEntry.name },
        ]);
    });
});
