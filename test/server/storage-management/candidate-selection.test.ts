import { describe, expect, it, vi } from 'vitest';

import { createRepositoryPersistence, type RepositoryPersistence } from '../persistence/repository-harness';
import { createStorageManager } from './_storage-harness';

const recorded = (startAt: number, isProtected: boolean = false) => ({
    reserveId: null,
    ruleId: null,
    programId: null,
    channelId: 10,
    isProtected,
    startAt,
    endAt: startAt + 1_000,
    duration: 1_000,
    name: `synthetic-recorded-${startAt}`,
    halfWidthName: `synthetic-recorded-${startAt}`,
    description: null,
    halfWidthDescription: null,
    extended: null,
    halfWidthExtended: null,
    rawExtended: null,
    rawHalfWidthExtended: null,
    genre1: null,
    subGenre1: null,
    genre2: null,
    subGenre2: null,
    genre3: null,
    subGenre3: null,
    videoType: null,
    videoResolution: null,
    videoStreamContent: null,
    audioSamplingRate: null,
    audioComponentType: null,
    isRecording: false,
    dropLogFileId: null,
});

const addRecorded = async (
    fixture: RepositoryPersistence,
    options: { readonly isProtected?: boolean; readonly startAt: number; readonly storages: readonly string[] },
): Promise<number> => {
    const id = await fixture.db.RecordedDB.insertOnce(recorded(options.startAt, options.isProtected));
    for (const [index, storageName] of options.storages.entries()) {
        await fixture.db.VideoFileDB.insertOnce({
            parentDirectoryName: storageName,
            filePath: `synthetic-${id}-${index}.ts`,
            type: 'ts',
            name: `synthetic-${id}-${index}`,
            size: 1,
            recordedId: id,
        });
    }
    return id;
};

describe('storage deletion candidate selection: zero, one, order, storage, and duplicates', () => {
    it('[SM-4.1] selects one unprotected all-main relation while excluding active and attempted IDs in stable order', async () => {
        const fixture = await createRepositoryPersistence('sqlite');
        try {
            const archiveOnly = await addRecorded(fixture, { startAt: 1, storages: ['archive'] });
            await addRecorded(fixture, { startAt: 2, storages: ['main'], isProtected: true });
            await addRecorded(fixture, { startAt: 3, storages: [] });
            await addRecorded(fixture, { startAt: 4, storages: ['main', 'archive'] });
            await addRecorded(fixture, { startAt: 5, storages: ['main', 'MAIN'] });
            await addRecorded(fixture, { startAt: 6, storages: ['main', 'main '] });
            const active = await addRecorded(fixture, { startAt: 7, storages: ['main'] });
            const attempted = await addRecorded(fixture, { startAt: 8, storages: ['main'] });
            const newerWithLowerId = await addRecorded(fixture, { startAt: 20, storages: ['main'] });
            const firstAtEarlierStart = await addRecorded(fixture, { startAt: 10, storages: ['main', 'main'] });
            const sameStartAt = await addRecorded(fixture, { startAt: 10, storages: ['main'] });
            const activeAndAttempted = new Set([active, attempted]);

            expect(newerWithLowerId).toBeLessThan(firstAtEarlierStart);
            expect(firstAtEarlierStart).toBeLessThan(sameStartAt);
            await expect(
                fixture.db.RecordedDB.findOldestUnused({
                    storageName: 'main',
                    excludedRecordedIds: activeAndAttempted,
                }),
            ).resolves.toBe(firstAtEarlierStart);
            await expect(
                fixture.db.RecordedDB.findOldestUnused({
                    storageName: 'main',
                    excludedRecordedIds: new Set([...activeAndAttempted, firstAtEarlierStart]),
                }),
            ).resolves.toBe(sameStartAt);
            await expect(
                fixture.db.RecordedDB.findOldestUnused({
                    storageName: 'main',
                    excludedRecordedIds: new Set([...activeAndAttempted, firstAtEarlierStart, sameStartAt]),
                }),
            ).resolves.toBe(newerWithLowerId);
            await expect(
                fixture.db.RecordedDB.findOldestUnused({
                    storageName: 'main',
                    excludedRecordedIds: new Set([
                        ...activeAndAttempted,
                        firstAtEarlierStart,
                        sameStartAt,
                        newerWithLowerId,
                    ]),
                }),
            ).resolves.toBeNull();
            await expect(
                fixture.db.RecordedDB.findOldestUnused({ storageName: 'archive', excludedRecordedIds: new Set() }),
            ).resolves.toBe(archiveOnly);
        } finally {
            await fixture.cleanup();
        }
    });
});

describe('storage deletion with two monitored entries where only one is below its threshold', () => {
    const MiB = 1024 * 1024;
    const belowEntry = {
        action: 'remove' as const,
        limitThreshold: 2,
        name: 'below',
        path: 'synthetic-storage/below',
    };
    const aboveEntry = {
        action: 'remove' as const,
        limitThreshold: 2,
        name: 'above',
        path: 'synthetic-storage/above',
    };

    const checkWithRealCandidates = async (
        fixture: RepositoryPersistence,
        freeBytes: {
            readonly above: number;
            readonly belowAfterDeletion: number;
            readonly belowBeforeDeletion: number;
        },
    ) => {
        const candidateProvider = vi.spyOn(fixture.db.RecordedDB, 'findOldestUnused');
        const {
            deleteRecorded: directRecordedDeletion,
            deletionPort,
            manager,
        } = createStorageManager({
            candidatePort: fixture.db.RecordedDB,
            deleteForStoragePressure: async () => 'deleted',
            entries: [belowEntry, aboveEntry],
        });
        let belowReads = 0;
        manager.getFreeSize = vi.fn(async (path: string) => {
            if (path === aboveEntry.path) return freeBytes.above;
            belowReads += 1;
            return belowReads === 1 ? freeBytes.belowBeforeDeletion : freeBytes.belowAfterDeletion;
        });

        await manager.check([belowEntry, aboveEntry]);

        return { candidateProvider, directRecordedDeletion, deletionPort };
    };

    it('[SM-4.1] deletes only a recording of the entry below its threshold and never one of the entry above it', async () => {
        const fixture = await createRepositoryPersistence('sqlite');
        try {
            // 閾値に達していない側ではなく達している側に最も古い録画を置く。保存先を見ずに最古を選ぶ実装ならこちらが選ばれる。
            const aboveOldest = await addRecorded(fixture, { startAt: 1, storages: ['above'] });
            const belowOlder = await addRecorded(fixture, { startAt: 2, storages: ['below'] });
            const aboveNewer = await addRecorded(fixture, { startAt: 3, storages: ['above'] });
            const belowNewer = await addRecorded(fixture, { startAt: 4, storages: ['below'] });

            const { candidateProvider, directRecordedDeletion, deletionPort } = await checkWithRealCandidates(fixture, {
                above: 5 * MiB,
                belowAfterDeletion: 3 * MiB,
                belowBeforeDeletion: 1 * MiB,
            });

            expect(deletionPort.requests).toEqual([{ recordedId: belowOlder, storageName: 'below' }]);
            expect(deletionPort.requests.map(request => request.recordedId)).not.toContain(aboveOldest);
            expect(deletionPort.requests.map(request => request.recordedId)).not.toContain(aboveNewer);
            expect(deletionPort.requests.map(request => request.recordedId)).not.toContain(belowNewer);
            expect(candidateProvider).toHaveBeenCalled();
            expect(candidateProvider.mock.calls.map(([request]) => request.storageName)).toEqual(
                candidateProvider.mock.calls.map(() => 'below'),
            );
            expect(directRecordedDeletion).not.toHaveBeenCalled();
        } finally {
            await fixture.cleanup();
        }
    });

    it('[SM-4.1] deletes nothing when the entry below its threshold has no recording of its own', async () => {
        const fixture = await createRepositoryPersistence('sqlite');
        try {
            const aboveOnly = await addRecorded(fixture, { startAt: 1, storages: ['above'] });
            const spanning = await addRecorded(fixture, { startAt: 2, storages: ['below', 'above'] });

            const { candidateProvider, deletionPort } = await checkWithRealCandidates(fixture, {
                above: 5 * MiB,
                belowAfterDeletion: 1 * MiB,
                belowBeforeDeletion: 1 * MiB,
            });

            expect(deletionPort.requests).toEqual([]);
            expect(deletionPort.requests.map(request => request.recordedId)).not.toContain(aboveOnly);
            expect(deletionPort.requests.map(request => request.recordedId)).not.toContain(spanning);
            expect(candidateProvider.mock.calls.map(([request]) => request.storageName)).toEqual(['below']);
            await expect(candidateProvider.mock.results[0]?.value).resolves.toBeNull();
        } finally {
            await fixture.cleanup();
        }
    });
});
