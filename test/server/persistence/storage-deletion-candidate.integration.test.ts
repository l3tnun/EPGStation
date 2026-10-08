import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cleanupInOrder } from './harness';
import { MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS, provisionMySql, type MySqlRuntime } from './mysql-runtime';
import { createRepositoryPersistence, type RepositoryDialect, type RepositoryPersistence } from './repository-harness';

let mysqlRuntime: MySqlRuntime | undefined;

beforeAll(async () => {
    mysqlRuntime = await provisionMySql();
}, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

afterAll(async () => {
    await cleanupInOrder([async () => mysqlRuntime?.cleanup()]);
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

describe.each(['sqlite', 'mysql'] as const)('storage deletion candidate through real %s', dialect => {
    it('[PERSIST-2.7] selects only all-matching relations by startAt/id and preserves null, exclusion, retry, and query failure', async () => {
        await withDialect(dialect, async fixture => {
            await addRecorded(fixture, { startAt: 1, storages: ['main'], isProtected: true });
            await addRecorded(fixture, { startAt: 2, storages: [] });
            const archiveOnly = await addRecorded(fixture, { startAt: 3, storages: ['archive'] });
            await addRecorded(fixture, { startAt: 4, storages: ['main', 'archive'] });
            await addRecorded(fixture, { startAt: 5, storages: ['main', 'MAIN'] });
            await addRecorded(fixture, { startAt: 6, storages: ['main', 'main '] });
            const first = await addRecorded(fixture, { startAt: 10, storages: ['main', 'main'] });
            const sameStartAt = await addRecorded(fixture, { startAt: 10, storages: ['main'] });
            const newer = await addRecorded(fixture, { startAt: 20, storages: ['main'] });

            const recordedCount = await fixture.source.getRepository(fixture.entities.Recorded).count();
            const videoCount = await fixture.source.getRepository(fixture.entities.VideoFile).count();
            const initialRetryCalls = fixture.retry.calls;

            await expect(
                fixture.db.RecordedDB.findOldestUnused({ storageName: 'main', excludedRecordedIds: new Set() }),
            ).resolves.toBe(first);
            await expect(
                fixture.db.RecordedDB.findOldestUnused({
                    storageName: 'main',
                    excludedRecordedIds: new Set([first]),
                }),
            ).resolves.toBe(sameStartAt);
            await expect(
                fixture.db.RecordedDB.findOldestUnused({
                    storageName: 'main',
                    excludedRecordedIds: new Set([first, sameStartAt]),
                }),
            ).resolves.toBe(newer);
            await expect(
                fixture.db.RecordedDB.findOldestUnused({
                    storageName: 'main',
                    excludedRecordedIds: new Set([first, sameStartAt, newer]),
                }),
            ).resolves.toBeNull();
            await expect(
                fixture.db.RecordedDB.findOldestUnused({ storageName: 'archive', excludedRecordedIds: new Set() }),
            ).resolves.toBe(archiveOnly);

            expect(fixture.retry.calls - initialRetryCalls).toBe(5);
            expect(await fixture.source.getRepository(fixture.entities.Recorded).count()).toBe(recordedCount);
            expect(await fixture.source.getRepository(fixture.entities.VideoFile).count()).toBe(videoCount);

            await fixture.source.destroy();
            const failureRetryCalls = fixture.retry.calls;
            await expect(
                fixture.db.RecordedDB.findOldestUnused({ storageName: 'main', excludedRecordedIds: new Set() }),
            ).rejects.toBeDefined();
            expect(fixture.retry.calls - failureRetryCalls).toBeLessThanOrEqual(1);
        });
    }, 30_000);
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
