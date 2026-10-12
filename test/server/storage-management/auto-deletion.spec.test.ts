import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecordedStorageDeletionPortDouble, createStorageManager, settleMicrotasks } from './_storage-harness';

const deletionEntry = {
    action: 'remove' as const,
    limitThreshold: 1,
    name: 'deletion-entry',
    path: 'synthetic-storage/deletion-entry',
};

const followingEntry = {
    ...deletionEntry,
    name: 'following-entry',
    path: 'synthetic-storage/following-entry',
};

const MEBIBYTE = 1024 * 1024;

afterEach(() => {
    vi.useRealTimers();
});

describe('storage auto-deletion characterization', () => {
    it('[SM-4.2-PORT-PREP] forwards one candidate ID and storage name to the typed deletion port', async () => {
        const deleteForStoragePressure = vi.fn(async () => 'deleted' as const);
        const port = new RecordedStorageDeletionPortDouble(deleteForStoragePressure);

        await expect(port.deleteForStoragePressure(91, deletionEntry.name)).resolves.toBe('deleted');

        expect(deleteForStoragePressure).toHaveBeenCalledOnce();
        expect(deleteForStoragePressure).toHaveBeenCalledWith(91, deletionEntry.name);
        expect(port.requests).toEqual([{ recordedId: 91, storageName: deletionEntry.name }]);
        expect(port.settlements).toEqual([{ recordedId: 91, storageName: deletionEntry.name, outcome: 'deleted' }]);
    });

    it('[SM-4.3] re-reads the same monitored path only after one deletion resolves', async () => {
        let resolveDeletion!: (outcome: 'deleted') => void;
        const deletion = new Promise<'deleted'>(resolve => {
            resolveDeletion = resolve;
        });
        const { candidateRequests, deletionPort, findOld, getSnapshot, logger, manager } = createStorageManager({
            deleteForStoragePressure: async () => deletion,
            findOld: async () => ({ id: 91 }),
        });
        const reads = vi
            .fn<(path: string) => Promise<number>>()
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(2 * 1024 * 1024);
        manager.getFreeSize = reads;

        const check = manager.check([deletionEntry]);
        await settleMicrotasks();
        await settleMicrotasks();
        expect(reads).toHaveBeenCalledOnce();
        expect(getSnapshot).toHaveBeenCalledOnce();
        expect(candidateRequests).toHaveBeenCalledOnce();
        expect(logger.system.error).not.toHaveBeenCalled();
        expect(deletionPort.requests).toEqual([{ recordedId: 91, storageName: deletionEntry.name }]);

        resolveDeletion('deleted');
        await check;

        expect(findOld).toHaveBeenCalledOnce();
        expect(reads.mock.calls.map(([path]) => path)).toEqual([
            'synthetic-storage/deletion-entry',
            'synthetic-storage/deletion-entry',
        ]);
    });

    it('[SM-4.2][SM-4.3][SM-4.5] delegates a deleted candidate, then re-reads and compares the result in MB', async () => {
        vi.useFakeTimers();
        const entry = { ...deletionEntry, limitThreshold: 1.5 };
        const { candidateRequests, deletionPort, findOld, manager } = createStorageManager({
            findOld: vi
                .fn<() => Promise<{ id: number } | null>>()
                .mockResolvedValueOnce({ id: 91 })
                .mockResolvedValueOnce(null),
        });
        const reads = vi
            .fn<(path: string) => Promise<number>>()
            .mockResolvedValueOnce(1024 * 1024)
            .mockResolvedValueOnce(1.25 * 1024 * 1024);
        manager.getFreeSize = reads;

        const check = manager.check([entry]);
        await settleMicrotasks();
        await settleMicrotasks();
        await settleMicrotasks();

        expect(candidateRequests).toHaveBeenCalledOnce();
        expect(deletionPort.requests).toEqual([{ recordedId: 91, storageName: entry.name }]);
        expect(reads).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(100);
        await check;

        expect(candidateRequests).toHaveBeenCalledTimes(2);
        expect(findOld).toHaveBeenCalledTimes(2);
        expect(deletionPort.requests).toHaveLength(1);
        expect(reads.mock.calls.map(([path]) => path)).toEqual([entry.path, entry.path]);
    });

    it.each(['not-deleted', 'rejection'] as const)(
        '[SM-4.6][SM-4.9] stops after a %s deletion result without a re-read, next candidate, or retry',
        async result => {
            const rejection = new Error('synthetic storage deletion rejection');
            const { candidateRequests, deletionPort, manager } = createStorageManager({
                deleteForStoragePressure: async () => {
                    if (result === 'rejection') throw rejection;
                    return 'not-deleted';
                },
                findOld: async () => ({ id: 92 }),
            });
            const reads = vi
                .fn<(path: string) => Promise<number>>()
                .mockResolvedValueOnce(0)
                .mockResolvedValueOnce(2 * 1024 * 1024);
            manager.getFreeSize = reads;

            await manager.check([deletionEntry]);

            expect(deletionPort.requests).toEqual([{ recordedId: 92, storageName: deletionEntry.name }]);
            expect(candidateRequests).toHaveBeenCalledOnce();
            expect(reads.mock.calls.map(([path]) => path)).toEqual([deletionEntry.path]);
        },
    );

    it.each([
        ['above', 1024 * 1024 + 1, 0],
        ['equal', 1024 * 1024, 1],
        ['below without rounding', 1024 * 1024 - 1, 1],
    ] as const)('[SM-4.4] compares initial bytes %s 1 MB after exact conversion', async (_label, bytes, queries) => {
        const { findOld, manager } = createStorageManager();
        manager.getFreeSize = vi.fn(async () => bytes);

        await manager.check([deletionEntry]);

        expect(findOld).toHaveBeenCalledTimes(queries);
    });

    it('[SM-4.7] stops the entry on a null candidate and continues with the next entry', async () => {
        const { deletionPort, findOld, manager } = createStorageManager();
        const reads = vi
            .fn<(path: string) => Promise<number>>()
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(2 * 1024 * 1024);
        manager.getFreeSize = reads;

        await manager.check([deletionEntry, followingEntry]);

        expect(findOld).toHaveBeenCalledOnce();
        expect(deletionPort.requests).toEqual([]);
        expect(reads.mock.calls.map(([path]) => path)).toEqual([
            'synthetic-storage/deletion-entry',
            'synthetic-storage/following-entry',
        ]);
    });

    it('[SM-4.6-QUERY] stops the entry on query rejection and continues with the next entry', async () => {
        const { deletionPort, findOld, manager } = createStorageManager({
            findOld: async () => {
                throw new Error('synthetic candidate query failure');
            },
        });
        const reads = vi.fn(async () => 0);
        manager.getFreeSize = reads;

        reads.mockResolvedValueOnce(0).mockResolvedValueOnce(2 * 1024 * 1024);

        await manager.check([deletionEntry, followingEntry]);

        expect(findOld).toHaveBeenCalledOnce();
        expect(deletionPort.requests).toEqual([]);
        expect(reads.mock.calls.map(([path]) => path)).toEqual([
            'synthetic-storage/deletion-entry',
            'synthetic-storage/following-entry',
        ]);
    });

    it('[SM-4.6-DELETE] stops the entry on deletion rejection and continues with the next entry', async () => {
        const { deletionPort, findOld, manager } = createStorageManager({
            deleteForStoragePressure: async () => {
                throw new Error('synthetic deletion failure');
            },
            findOld: async () => ({ id: 92 }),
        });
        const reads = vi
            .fn<(path: string) => Promise<number>>()
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(2 * 1024 * 1024);
        manager.getFreeSize = reads;

        await manager.check([deletionEntry, followingEntry]);

        expect(findOld).toHaveBeenCalledOnce();
        expect(deletionPort.requests).toEqual([{ recordedId: 92, storageName: deletionEntry.name }]);
        expect(reads.mock.calls.map(([path]) => path)).toEqual([
            'synthetic-storage/deletion-entry',
            'synthetic-storage/following-entry',
        ]);
    });

    it('[SM-4.6-RE-READ] stops the entry on re-read rejection and continues with the next entry', async () => {
        const { deletionPort, findOld, manager } = createStorageManager({
            findOld: async () => ({ id: 93 }),
        });
        let deletionEntryReads = 0;
        const reads = vi.fn<(path: string) => Promise<number>>(async path => {
            if (path === followingEntry.path) return 2 * 1024 * 1024;
            deletionEntryReads += 1;
            if (deletionEntryReads === 1) return 0;
            throw new Error('synthetic post-delete capacity failure');
        });
        manager.getFreeSize = reads;

        await manager.check([deletionEntry, followingEntry]);

        expect(findOld).toHaveBeenCalledOnce();
        expect(deletionPort.requests).toEqual([{ recordedId: 93, storageName: deletionEntry.name }]);
        expect(reads.mock.calls.map(([path]) => path)).toEqual([
            'synthetic-storage/deletion-entry',
            'synthetic-storage/following-entry',
            'synthetic-storage/deletion-entry',
        ]);
    });

    it('[SM-4.1] requests candidates for the monitored storage and excludes the already attempted ID', async () => {
        vi.useFakeTimers();
        const entry = {
            action: 'remove' as const,
            limitThreshold: 3,
            name: 'candidate-storage',
            path: 'synthetic-storage/candidate-storage',
        };
        const candidates = vi.fn().mockResolvedValueOnce(91).mockResolvedValueOnce(null);
        const { deletionPort, manager } = createStorageManager({
            candidatePort: { findOldestUnused: candidates },
            deleteForStoragePressure: async () => 'deleted',
        });
        manager.getFreeSize = vi
            .fn<(path: string) => Promise<number>>()
            .mockResolvedValueOnce(MEBIBYTE)
            .mockResolvedValueOnce(2 * MEBIBYTE);

        const check = manager.check([entry]);
        await settleMicrotasks();
        await settleMicrotasks();
        await vi.advanceTimersByTimeAsync(100);
        await check;

        expect(candidates).toHaveBeenCalledTimes(2);
        expect(candidates.mock.calls).toEqual([
            [{ excludedRecordedIds: new Set(), storageName: entry.name }],
            [{ excludedRecordedIds: new Set([91]), storageName: entry.name }],
        ]);
        expect(deletionPort.requests).toEqual([{ recordedId: 91, storageName: entry.name }]);
    });

    it('[SM-4.8] stops before a second deletion when the candidate port re-presents the attempted ID', async () => {
        vi.useFakeTimers();
        const entry = {
            action: 'remove' as const,
            limitThreshold: 3,
            name: 'repeated-storage',
            path: 'synthetic-storage/repeated-storage',
        };
        const candidates = vi.fn(async () => 91);
        const { deletionPort, manager } = createStorageManager({ candidatePort: { findOldestUnused: candidates } });
        manager.getFreeSize = vi
            .fn<(path: string) => Promise<number>>()
            .mockResolvedValueOnce(MEBIBYTE)
            .mockResolvedValueOnce(2 * MEBIBYTE);

        const check = manager.check([entry]);
        await settleMicrotasks();
        await settleMicrotasks();
        await vi.advanceTimersByTimeAsync(100);
        await check;

        expect(candidates).toHaveBeenCalledTimes(2);
        expect(deletionPort.requests).toEqual([{ recordedId: 91, storageName: entry.name }]);
    });
});
