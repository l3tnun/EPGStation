import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { cleanupInOrder } from '../persistence/harness';
import { MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS, provisionMySql, type MySqlRuntime } from '../persistence/mysql-runtime';
import {
    createRepositoryPersistence,
    type RepositoryDialect,
    type RepositoryPersistence,
} from '../persistence/repository-harness';
import { createStorageManager, deferred, settleMicrotasks } from './_storage-harness';

let mysqlRuntime: MySqlRuntime | undefined;

beforeAll(async () => {
    mysqlRuntime = await provisionMySql();
}, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

afterAll(async () => {
    await cleanupInOrder([async () => mysqlRuntime?.cleanup()]);
});

afterEach(() => {
    vi.useRealTimers();
});

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
    videoComponentType: null,
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

const withDialect = async (
    dialect: RepositoryDialect,
    run: (fixture: RepositoryPersistence) => Promise<void>,
): Promise<void> => {
    const fixture = await createRepositoryPersistence(dialect, mysqlRuntime);
    try {
        await run(fixture);
    } finally {
        await fixture.cleanup();
    }
};

describe.each(['sqlite', 'mysql'] as const)('candidate ID, storage name, and delete result on %s', dialect => {
    it('[SM-4.1] returns one all-relation storage candidate after excluding active and attempted IDs', async () => {
        await withDialect(dialect, async fixture => {
            const archiveOnly = await addRecorded(fixture, { startAt: 1, storages: ['archive'] });
            await addRecorded(fixture, { startAt: 2, storages: ['main'], isProtected: true });
            await addRecorded(fixture, { startAt: 3, storages: [] });
            await addRecorded(fixture, { startAt: 4, storages: ['main', 'archive'] });
            const active = await addRecorded(fixture, { startAt: 5, storages: ['main'] });
            const attempted = await addRecorded(fixture, { startAt: 6, storages: ['main'] });
            const newerWithLowerId = await addRecorded(fixture, { startAt: 20, storages: ['main'] });
            const firstAtEarlierStart = await addRecorded(fixture, { startAt: 10, storages: ['main', 'main'] });
            const sameStartAt = await addRecorded(fixture, { startAt: 10, storages: ['main'] });
            const excluded = new Set([active, attempted]);

            expect(newerWithLowerId).toBeLessThan(firstAtEarlierStart);
            expect(firstAtEarlierStart).toBeLessThan(sameStartAt);
            await expect(
                fixture.db.RecordedDB.findOldestUnused({ storageName: 'main', excludedRecordedIds: excluded }),
            ).resolves.toBe(firstAtEarlierStart);
            await expect(
                fixture.db.RecordedDB.findOldestUnused({
                    storageName: 'main',
                    excludedRecordedIds: new Set([...excluded, firstAtEarlierStart]),
                }),
            ).resolves.toBe(sameStartAt);
            await expect(
                fixture.db.RecordedDB.findOldestUnused({
                    storageName: 'main',
                    excludedRecordedIds: new Set([...excluded, firstAtEarlierStart, sameStartAt]),
                }),
            ).resolves.toBe(newerWithLowerId);
            await expect(
                fixture.db.RecordedDB.findOldestUnused({
                    storageName: 'main',
                    excludedRecordedIds: new Set([...excluded, firstAtEarlierStart, sameStartAt, newerWithLowerId]),
                }),
            ).resolves.toBeNull();
            await expect(
                fixture.db.RecordedDB.findOldestUnused({ storageName: 'archive', excludedRecordedIds: new Set() }),
            ).resolves.toBe(archiveOnly);

            await fixture.source.destroy();
            await expect(
                fixture.db.RecordedDB.findOldestUnused({ storageName: 'main', excludedRecordedIds: new Set() }),
            ).rejects.toBeDefined();
        });
    }, 30_000);

    it('[STORAGE-T5.3][SM-3.4][SM-4.1][SM-4.2][SM-4.3][SM-4.5][SM-4.8] delegates real candidates through the deletion port and re-reads the same path', async () => {
        await withDialect(dialect, async fixture => {
            const firstRecordedId = await addRecorded(fixture, { startAt: 1, storages: ['main'] });
            const secondRecordedId = await addRecorded(fixture, { startAt: 2, storages: ['main'] });
            const entry = {
                action: 'remove' as const,
                limitThreshold: 2,
                name: 'main',
                path: 'synthetic-storage/main',
            };
            const candidateProvider = vi.spyOn(fixture.db.RecordedDB, 'findOldestUnused');
            const {
                deleteRecorded: directRecordedDeletion,
                deletionPort,
                manager,
            } = createStorageManager({
                candidatePort: fixture.db.RecordedDB,
                deleteForStoragePressure: async () => 'deleted',
                entries: [entry],
            });
            const reads = vi
                .fn<(path: string) => Promise<number>>()
                .mockResolvedValueOnce(1024 * 1024)
                .mockResolvedValueOnce(1.5 * 1024 * 1024)
                .mockResolvedValueOnce(3 * 1024 * 1024);
            manager.getFreeSize = reads;

            await manager.check([entry]);

            expect(deletionPort.requests).toEqual([
                { recordedId: firstRecordedId, storageName: 'main' },
                { recordedId: secondRecordedId, storageName: 'main' },
            ]);
            expect(candidateProvider).toHaveBeenCalledTimes(2);
            expect(candidateProvider.mock.calls).toEqual([
                [{ excludedRecordedIds: new Set(), storageName: 'main' }],
                [{ excludedRecordedIds: new Set([firstRecordedId]), storageName: 'main' }],
            ]);
            expect(reads.mock.calls.map(([path]) => path)).toEqual([
                'synthetic-storage/main',
                'synthetic-storage/main',
                'synthetic-storage/main',
            ]);
            expect(directRecordedDeletion).not.toHaveBeenCalled();
        });
    }, 30_000);

    it('[STORAGE-T7.4][SM-6.4] keeps candidate selection in Storage while the Persistence port exposes primitive, null, rejection, and order without deletion', async () => {
        await withDialect(dialect, async fixture => {
            const activeRecordedId = await addRecorded(fixture, { startAt: 1, storages: ['main'] });
            const oldestRecordedId = await addRecorded(fixture, { startAt: 10, storages: ['main'] });
            const sameStartRecordedId = await addRecorded(fixture, { startAt: 10, storages: ['main'] });
            const newerRecordedId = await addRecorded(fixture, { startAt: 20, storages: ['main'] });
            const entry = {
                action: 'remove' as const,
                limitThreshold: 1,
                name: 'main',
                path: 'synthetic-storage/main',
            };
            const candidateProvider = vi.spyOn(fixture.db.RecordedDB, 'findOldestUnused');
            const recordedCount = await fixture.source.getRepository(fixture.entities.Recorded).count();
            const videoCount = await fixture.source.getRepository(fixture.entities.VideoFile).count();
            const cases = [
                { candidate: oldestRecordedId, excludedRecordedIds: [activeRecordedId] },
                { candidate: sameStartRecordedId, excludedRecordedIds: [activeRecordedId, oldestRecordedId] },
                {
                    candidate: null,
                    excludedRecordedIds: [activeRecordedId, oldestRecordedId, sameStartRecordedId, newerRecordedId],
                },
            ] as const;

            expect(oldestRecordedId).toBeLessThan(sameStartRecordedId);
            for (const [index, testCase] of cases.entries()) {
                const { deletionPort, manager } = createStorageManager({
                    candidatePort: fixture.db.RecordedDB,
                    deleteForStoragePressure: async () => 'not-deleted',
                    entries: [entry],
                    getSnapshot: async () => ({
                        recordedIds: new Set(testCase.excludedRecordedIds),
                        status: 'known' as const,
                    }),
                });
                manager.getFreeSize = vi.fn(async () => 1024 * 1024);

                await manager.check([entry]);

                expect(candidateProvider).toHaveBeenCalledTimes(index + 1);
                expect(candidateProvider).toHaveBeenLastCalledWith({
                    excludedRecordedIds: new Set(testCase.excludedRecordedIds),
                    storageName: entry.name,
                });
                await expect(candidateProvider.mock.results.at(-1)?.value).resolves.toBe(testCase.candidate);
                expect(deletionPort.requests).toEqual(
                    testCase.candidate === null ? [] : [{ recordedId: testCase.candidate, storageName: entry.name }],
                );
            }

            expect(await fixture.source.getRepository(fixture.entities.Recorded).count()).toBe(recordedCount);
            expect(await fixture.source.getRepository(fixture.entities.VideoFile).count()).toBe(videoCount);

            await fixture.source.destroy();
            const { deletionPort, manager } = createStorageManager({
                candidatePort: fixture.db.RecordedDB,
                deleteForStoragePressure: async () => 'not-deleted',
                entries: [entry],
            });
            manager.getFreeSize = vi.fn(async () => 1024 * 1024);

            await manager.check([entry]);

            expect(candidateProvider).toHaveBeenCalledTimes(cases.length + 1);
            await expect(candidateProvider.mock.results.at(-1)?.value).rejects.toBeDefined();
            expect(deletionPort.requests).toEqual([]);
        });
    }, 30_000);
});

describe('storage deletion consumer fault isolation', () => {
    const entry = {
        action: 'remove' as const,
        limitThreshold: 3,
        name: 'faulted-storage',
        path: 'synthetic-storage/faulted',
    };
    const continuingEntry = {
        action: 'none' as const,
        limitThreshold: 0,
        name: 'continuing-storage',
        path: 'synthetic-storage/continuing',
    };

    it.each([
        'null candidate',
        'candidate rejection',
        'not-deleted result',
        'deletion rejection',
        'post-delete read rejection',
        'non-increasing bytes',
        'repeated candidate ID',
    ] as const)(
        '[STORAGE-T5.3][SM-4.6][SM-4.7][SM-4.8][SM-4.9] stops only the faulted entry after %s',
        async scenario => {
            const queryFailure = new Error('synthetic candidate rejection');
            const deletionFailure = new Error('synthetic deletion rejection');
            const postReadFailure = new Error('synthetic post-delete read rejection');
            const candidateProvider = vi.fn(async () => {
                if (scenario === 'null candidate') return null;
                if (scenario === 'candidate rejection') throw queryFailure;
                return 91;
            });
            const deleteForStoragePressure = vi.fn(async () => {
                if (scenario === 'deletion rejection') throw deletionFailure;
                if (scenario === 'not-deleted result') return 'not-deleted' as const;
                return 'deleted' as const;
            });
            let faultedReads = 0;
            const reads = vi.fn(async (path: string) => {
                if (path === continuingEntry.path) return 1024 * 1024;
                faultedReads += 1;
                if (scenario === 'post-delete read rejection' && faultedReads === 2) throw postReadFailure;
                if (scenario === 'non-increasing bytes') return 1024 * 1024;
                if (scenario === 'repeated candidate ID' && faultedReads === 2) return 2 * 1024 * 1024;
                return 1024 * 1024;
            });
            const {
                deleteRecorded: directRecordedDeletion,
                deletionPort,
                manager,
            } = createStorageManager({
                candidatePort: { findOldestUnused: async () => candidateProvider() },
                deleteForStoragePressure,
                entries: [entry, continuingEntry],
            });
            manager.getFreeSize = reads;

            await manager.check([entry, continuingEntry]);

            const candidateCalls = scenario === 'repeated candidate ID' ? 2 : 1;
            const deletionCalls = ['null candidate', 'candidate rejection'].includes(scenario) ? 0 : 1;
            const expectedFaultedReads = [
                'post-delete read rejection',
                'non-increasing bytes',
                'repeated candidate ID',
            ].includes(scenario)
                ? 2
                : 1;
            expect(candidateProvider).toHaveBeenCalledTimes(candidateCalls);
            expect(deletionPort.requests).toHaveLength(deletionCalls);
            expect(deleteForStoragePressure).toHaveBeenCalledTimes(deletionCalls);
            expect(reads.mock.calls.filter(([path]) => path === entry.path)).toHaveLength(expectedFaultedReads);
            expect(reads).toHaveBeenCalledWith(continuingEntry.path);
            expect(directRecordedDeletion).not.toHaveBeenCalled();
        },
    );

    it('[STORAGE-T5.3][SM-3.4] retains the command-owning entry while the other entry continues after deletion stops', async () => {
        const commandCompletion = deferred<'spawn-failure' | 'terminal'>();
        const firstEntry = {
            action: 'remove' as const,
            limitCmd: '%NODE%',
            limitThreshold: 1,
            name: 'command-owning-entry',
            path: 'synthetic-storage/command-owning',
        };
        const otherEntry = {
            action: 'remove' as const,
            limitThreshold: 1,
            name: 'other-entry',
            path: 'synthetic-storage/other',
        };
        const candidateProvider = vi.fn(async (storageName: string) => (storageName === firstEntry.name ? 91 : 92));
        const {
            deleteRecorded: directRecordedDeletion,
            deletionPort,
            manager,
        } = createStorageManager({
            candidatePort: {
                findOldestUnused: async request => candidateProvider(request.storageName),
            },
            deleteForStoragePressure: async () => 'not-deleted',
            entries: [firstEntry, otherEntry],
        });
        manager.getFreeSize = vi.fn(async () => 0);
        vi.spyOn(manager, 'launchCommand').mockReturnValue({ observationDone: commandCompletion.promise });

        const firstCheck = manager.check([firstEntry, otherEntry]);
        await settleMicrotasks();
        await settleMicrotasks();
        await settleMicrotasks();

        expect(deletionPort.requests).toEqual([
            { recordedId: 91, storageName: firstEntry.name },
            { recordedId: 92, storageName: otherEntry.name },
        ]);
        expect(manager.isRunning).toBe(true);

        await manager.check([firstEntry, otherEntry]);
        expect(deletionPort.requests).toEqual([
            { recordedId: 91, storageName: firstEntry.name },
            { recordedId: 92, storageName: otherEntry.name },
            { recordedId: 92, storageName: otherEntry.name },
        ]);

        commandCompletion.resolve('terminal');
        await firstCheck;
        expect(manager.isRunning).toBe(false);
        expect(directRecordedDeletion).not.toHaveBeenCalled();
    });
});

// The container is removed here, in a test of its own with the budget its provisioning has, rather than in
// `afterAll`: the Docker daemon answers `docker rm --force` late while it is busy (an image export holds
// it for tens of seconds), and a hook only has Vitest's default 10 s. The `afterAll` above confirms the
// container is gone and removes it itself only when this test did not run (a filtered or aborted file).
it(
    'releases the isolated MySQL fixture container after every case of the file',
    async () => {
        await mysqlRuntime?.cleanup();
    },
    MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS,
);
