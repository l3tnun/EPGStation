import 'reflect-metadata';

import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { cleanupInOrder } from '../persistence/harness';
import { provisionMariaDb, type MariaDbRuntime, type MysqlSchema } from '../persistence/mysql-runtime';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;

const Recorded = load<new () => any>('db/entities/Recorded.js');
const VideoFile = load<new () => any>('db/entities/VideoFile.js');
const DropLogFile = load<new () => any>('db/entities/DropLogFile.js');
const Thumbnail = load<new () => any>('db/entities/Thumbnail.js');
const RecordedTag = load<new () => any>('db/entities/RecordedTag.js');
const RecordedHistory = load<new () => any>('db/entities/RecordedHistory.js');
const RecordedDB = load<new (...args: any[]) => any>('model/db/RecordedDB.js');
const VideoFileDB = load<new (...args: any[]) => any>('model/db/VideoFileDB.js');
const DropLogFileDB = load<new (...args: any[]) => any>('model/db/DropLogFileDB.js');
const ThumbnailDB = load<new (...args: any[]) => any>('model/db/ThumbnailDB.js');
const RecordedTagDB = load<new (...args: any[]) => any>('model/db/RecordedTagDB.js');
const RecordedHistoryDB = load<new (...args: any[]) => any>('model/db/RecordedHistoryDB.js');
const RecordedApiModel = load<new (...args: any[]) => any>('model/api/recorded/RecordedApiModel.js');
const RecordedItemUtil = load<new () => any>('model/api/RecordedItemUtil.js');

interface DatabaseHarness {
    readonly source: DataSource;
    readonly recordedDB: any;
    readonly videoFileDB: any;
    readonly dropLogFileDB: any;
    readonly thumbnailDB: any;
    readonly recordedTagDB: any;
    readonly recordedHistoryDB: any;
    readonly api: any;
}

const retry = { run: <T>(operation: () => Promise<T>): Promise<T> => operation() };

function createHarness(source: DataSource): DatabaseHarness {
    const operator = { getConnection: async () => source, getLikeStr: () => 'like' };
    const recordedDB = new RecordedDB(operator, retry);
    return {
        source,
        recordedDB,
        videoFileDB: new VideoFileDB(operator, retry),
        dropLogFileDB: new DropLogFileDB(operator, retry),
        thumbnailDB: new ThumbnailDB(operator, retry),
        recordedTagDB: new RecordedTagDB(operator, retry),
        recordedHistoryDB: new RecordedHistoryDB(operator, retry),
        api: new RecordedApiModel({}, recordedDB, { getRecordedIndex: () => ({}) }, new RecordedItemUtil()),
    };
}

async function withSource(
    options: DataSourceOptions,
    operation: (harness: DatabaseHarness) => Promise<void>,
): Promise<void> {
    const source = new DataSource(options);
    try {
        await source.initialize();
        await operation(createHarness(source));
    } finally {
        if (source.isInitialized) {
            await source.destroy();
        }
    }
}

async function forEachDatabase(operation: (name: string, harness: DatabaseHarness) => Promise<void>): Promise<void> {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-recorded-baseline-'));
    const common = { entities: [join(snapshot, 'db', 'entities', '*.js')], logging: false, synchronize: true };
    let mariaDb: MariaDbRuntime | undefined;
    let schema: MysqlSchema | undefined;
    try {
        await withSource({ ...common, type: 'better-sqlite3', database: join(temporaryRoot, 'recorded.db') }, harness =>
            operation('sqlite', harness),
        );

        mariaDb = await provisionMariaDb();
        schema = await mariaDb.createSchema();
        const mariaDbOptions: Record<string, unknown> = {
            ...common,
            type: 'mysql',
            host: schema.config.host,
            port: schema.config.port,
            database: schema.config.database,
            charset: 'utf8mb4',
            bigNumberStrings: false,
        };
        mariaDbOptions.username = schema.config.user;
        mariaDbOptions.password = schema.config.password;
        await withSource(mariaDbOptions as DataSourceOptions, harness => operation('mariadb', harness));
    } finally {
        await cleanupInOrder([
            async () => schema?.cleanup(),
            async () => mariaDb?.cleanup(),
            async () => rm(temporaryRoot, { force: true, recursive: true }),
        ]);
    }
}

function recordedEntity(overrides: Record<string, unknown> = {}): any {
    return Object.assign(new Recorded(), {
        reserveId: null,
        ruleId: null,
        programId: null,
        channelId: 101,
        isProtected: false,
        startAt: 1_700_000_000_000,
        endAt: 1_700_000_060_000,
        duration: 60_000,
        name: 'Synthetic Baseline',
        halfWidthName: 'Synthetic Baseline',
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
        ...overrides,
    });
}

async function insertRecorded(harness: DatabaseHarness, overrides: Record<string, unknown> = {}): Promise<number> {
    return harness.recordedDB.insertOnce(recordedEntity(overrides));
}

async function insertVideo(
    harness: DatabaseHarness,
    recordedId: number,
    overrides: Record<string, unknown> = {},
): Promise<number> {
    return harness.videoFileDB.insertOnce(
        Object.assign(new VideoFile(), {
            parentDirectoryName: 'synthetic-storage',
            filePath: 'baseline.ts',
            type: 'ts',
            name: 'Synthetic TS',
            size: 4_096,
            recordedId,
            ...overrides,
        }),
    );
}

describe('recorded content production persistence baseline', () => {
    it('[RC-1.1/1.2/1.3/1.4] round-trips recorded fields and zero/multiple related resources', async () => {
        await forEachDatabase(async (_database, harness) => {
            const emptyId = await insertRecorded(harness, {
                programId: 9_001,
                channelId: 111,
                startAt: 1_700_000_100_000,
                endAt: 1_700_000_160_000,
                name: 'Synthetic Empty Relations',
                halfWidthName: 'Synthetic Empty Relations',
                isRecording: true,
                isProtected: true,
            });
            await expect(harness.recordedDB.findId(emptyId)).resolves.toMatchObject({
                channelId: 111,
                dropLogFile: null,
                endAt: 1_700_000_160_000,
                id: emptyId,
                isProtected: true,
                isRecording: true,
                programId: 9_001,
                startAt: 1_700_000_100_000,
                tags: [],
                thumbnails: [],
                videoFiles: [],
            });

            const dropLogFileId = await harness.dropLogFileDB.insertOnce(
                Object.assign(new DropLogFile(), {
                    errorCnt: 1,
                    dropCnt: 2,
                    scramblingCnt: 3,
                    filePath: 'synthetic-drop.log',
                }),
            );
            const relatedId = await insertRecorded(harness, {
                ruleId: 77,
                dropLogFileId,
                name: 'Synthetic Related Resources',
                halfWidthName: 'Synthetic Related Resources',
            });
            await insertVideo(harness, relatedId);
            await insertVideo(harness, relatedId, {
                parentDirectoryName: 'synthetic-archive',
                filePath: 'nested/baseline.mp4',
                type: 'encoded',
                name: 'Synthetic Encode',
                size: 8_192,
            });
            await harness.thumbnailDB.insertOnce(
                Object.assign(new Thumbnail(), { filePath: 'synthetic-thumbnail.jpg', recordedId: relatedId }),
            );
            const tagId = await harness.recordedTagDB.insertOnce(
                Object.assign(new RecordedTag(), {
                    name: 'Synthetic Tag',
                    halfWidthName: 'Synthetic Tag',
                    color: '#123456',
                }),
            );
            await harness.recordedTagDB.setRelation(tagId, relatedId);

            const reloaded = await harness.recordedDB.findId(relatedId);
            expect(reloaded).toMatchObject({
                dropLogFile: {
                    id: dropLogFileId,
                    errorCnt: 1,
                    dropCnt: 2,
                    scramblingCnt: 3,
                    filePath: 'synthetic-drop.log',
                },
                dropLogFileId,
                id: relatedId,
                ruleId: 77,
                tags: [{ id: tagId, name: 'Synthetic Tag', color: '#123456' }],
                thumbnails: [{ filePath: 'synthetic-thumbnail.jpg', recordedId: relatedId }],
            });
            expect(
                reloaded.videoFiles
                    .map((file: any) => ({
                        parentDirectoryName: file.parentDirectoryName,
                        filePath: file.filePath,
                        type: file.type,
                        name: file.name,
                        size: Number(file.size),
                        recordedId: file.recordedId,
                    }))
                    .sort((left: any, right: any) => left.name.localeCompare(right.name)),
            ).toEqual([
                {
                    parentDirectoryName: 'synthetic-archive',
                    filePath: 'nested/baseline.mp4',
                    type: 'encoded',
                    name: 'Synthetic Encode',
                    size: 8_192,
                    recordedId: relatedId,
                },
                {
                    parentDirectoryName: 'synthetic-storage',
                    filePath: 'baseline.ts',
                    type: 'ts',
                    name: 'Synthetic TS',
                    size: 4_096,
                    recordedId: relatedId,
                },
            ]);
        });
    }, 60_000);

    it('[RC-2.1..2.6] executes production filters, paging, detail, candidates, null, and tie behavior', async () => {
        await forEachDatabase(async (_database, harness) => {
            const alphaId = await insertRecorded(harness, {
                channelId: 101,
                ruleId: 7,
                genre1: 5,
                startAt: 4_000,
                endAt: 4_500,
                name: 'Synthetic Alpha News',
                halfWidthName: 'Synthetic Alpha News',
            });
            const alphaEncodedId = await insertRecorded(harness, {
                channelId: 102,
                genre1: 6,
                startAt: 3_000,
                endAt: 3_500,
                name: 'Synthetic Alpha Encoded',
                halfWidthName: 'Synthetic Alpha Encoded',
            });
            const betaId = await insertRecorded(harness, {
                channelId: 101,
                ruleId: 7,
                genre1: 5,
                startAt: 2_000,
                endAt: 2_500,
                name: 'Synthetic Beta News',
                halfWidthName: 'Synthetic Beta News',
            });
            const noFileId = await insertRecorded(harness, {
                channelId: 103,
                genre1: 8,
                startAt: 1_000,
                endAt: 1_500,
                name: 'Synthetic No File',
                halfWidthName: 'Synthetic No File',
            });
            await insertVideo(harness, alphaId);
            await insertVideo(harness, alphaId, {
                filePath: 'alpha.mp4',
                type: 'encoded',
                name: 'Synthetic Alpha Encode',
            });
            await insertVideo(harness, alphaEncodedId, {
                filePath: 'encoded-only.mp4',
                type: 'encoded',
                name: 'Synthetic Encoded Only',
            });
            await insertVideo(harness, betaId, { filePath: 'beta.ts', name: 'Synthetic Beta TS' });
            const detailDropId = await harness.dropLogFileDB.insertOnce(
                Object.assign(new DropLogFile(), {
                    errorCnt: 0,
                    dropCnt: 1,
                    scramblingCnt: 0,
                    filePath: 'synthetic-alpha-drop.log',
                }),
            );
            await harness.source.getRepository(Recorded).update(alphaId, { dropLogFileId: detailDropId });
            const detailThumbnailId = await harness.thumbnailDB.insertOnce(
                Object.assign(new Thumbnail(), { filePath: 'synthetic-alpha-thumbnail.jpg', recordedId: alphaId }),
            );
            const detailTagId = await harness.recordedTagDB.insertOnce(
                Object.assign(new RecordedTag(), {
                    name: 'Synthetic Alpha Tag',
                    halfWidthName: 'Synthetic Alpha Tag',
                    color: '#abcdef',
                }),
            );
            await harness.recordedTagDB.setRelation(detailTagId, alphaId);

            const ids = async (option: Record<string, unknown>) => {
                const result = await harness.api.gets({ isHalfWidth: false, ...option });
                return { ids: result.records.map((item: any) => item.id), total: result.total };
            };
            await expect(ids({ keyword: 'Alpha' })).resolves.toEqual({ ids: [alphaId, alphaEncodedId], total: 2 });
            await expect(ids({ channelId: 102 })).resolves.toEqual({ ids: [alphaEncodedId], total: 1 });
            await expect(ids({ genre: 5 })).resolves.toEqual({ ids: [alphaId, betaId], total: 2 });
            await expect(ids({ ruleId: 7 })).resolves.toEqual({ ids: [alphaId, betaId], total: 2 });
            await expect(ids({ ruleId: 0 })).resolves.toEqual({ ids: [alphaEncodedId, noFileId], total: 2 });
            await expect(ids({ offset: 1, limit: 2 })).resolves.toEqual({
                ids: [alphaEncodedId, betaId],
                total: 4,
            });
            await expect(ids({ keyword: 'Synthetic Missing Result' })).resolves.toEqual({ ids: [], total: 0 });

            const originals = await harness.api.gets({ isHalfWidth: false, hasOriginalFile: true, limit: 1 });
            expect(originals.total).toBe(2);
            expect(originals.records).toHaveLength(1);
            expect(originals.records[0].id).toBe(alphaId);
            expect(originals.records[0].videoFiles.map((file: any) => file.type).sort()).toEqual(['encoded', 'ts']);
            expect(originals.records[0]).toMatchObject({
                dropLogFile: { id: detailDropId },
                thumbnails: [detailThumbnailId],
            });

            await expect(harness.api.get(alphaId, false)).resolves.toMatchObject({
                dropLogFile: { id: detailDropId, dropCnt: 1 },
                id: alphaId,
                tags: [{ id: detailTagId, name: 'Synthetic Alpha Tag' }],
                thumbnails: [detailThumbnailId],
                videoFiles: expect.arrayContaining([
                    expect.objectContaining({ type: 'ts' }),
                    expect.objectContaining({ type: 'encoded' }),
                ]),
            });
            await expect(harness.api.get(999_999, false)).resolves.toBeNull();

            const candidates = await harness.api.getSearchOptionList();
            expect(
                candidates.channels
                    .map((candidate: any) => ({ channelId: Number(candidate.channelId), count: Number(candidate.cnt) }))
                    .sort((left: any, right: any) => left.channelId - right.channelId),
            ).toEqual([
                { channelId: 101, count: 2 },
                { channelId: 102, count: 1 },
                { channelId: 103, count: 1 },
            ]);
            expect(
                candidates.genres
                    .map((candidate: any) => ({ genre: Number(candidate.genre), count: Number(candidate.cnt) }))
                    .sort((left: any, right: any) => left.genre - right.genre),
            ).toEqual([
                { genre: 5, count: 2 },
                { genre: 6, count: 1 },
                { genre: 8, count: 1 },
            ]);

            const tiedFirst = await insertRecorded(harness, {
                channelId: 999,
                startAt: 5_000,
                endAt: 5_500,
                name: 'Synthetic Tie First',
                halfWidthName: 'Synthetic Tie First',
            });
            const tiedSecond = await insertRecorded(harness, {
                channelId: 999,
                startAt: 5_000,
                endAt: 5_600,
                name: 'Synthetic Tie Second',
                halfWidthName: 'Synthetic Tie Second',
            });
            const ties = await ids({ channelId: 999 });
            expect(ties.total).toBe(2);
            expect(new Set(ties.ids)).toEqual(new Set([tiedFirst, tiedSecond]));
        });
    }, 60_000);

    it('[RC-3.1..3.5] persists the normal recording start-to-finish registration sequence', async () => {
        await forEachDatabase(async (_database, harness) => {
            const recordedId = await insertRecorded(harness, {
                reserveId: 301,
                ruleId: 302,
                isRecording: true,
                name: 'Synthetic Active Recording',
                halfWidthName: 'Synthetic Active Recording',
            });
            await expect(harness.recordedDB.findId(recordedId)).resolves.toMatchObject({
                id: recordedId,
                isRecording: true,
                dropLogFile: null,
                dropLogFileId: null,
                videoFiles: [],
            });

            const videoFileId = await insertVideo(harness, recordedId, {
                parentDirectoryName: 'tmp',
                filePath: 'active.ts',
                name: 'TS',
                size: 0,
            });
            const withVideo = await harness.recordedDB.findId(recordedId);
            expect(withVideo).toMatchObject({
                id: recordedId,
                isRecording: true,
                dropLogFile: null,
                dropLogFileId: null,
                videoFiles: [
                    {
                        id: videoFileId,
                        parentDirectoryName: 'tmp',
                        filePath: 'active.ts',
                        recordedId,
                    },
                ],
            });
            expect(Number(withVideo.videoFiles[0].size)).toBe(0);

            const dropLogFileId = await harness.dropLogFileDB.insertOnce(
                Object.assign(new DropLogFile(), {
                    errorCnt: 0,
                    dropCnt: 4,
                    scramblingCnt: 0,
                    filePath: 'synthetic-recording-drop.log',
                }),
            );
            await harness.source.getRepository(Recorded).update(recordedId, { dropLogFileId });
            const withDrop = await harness.recordedDB.findId(recordedId);
            expect(withDrop).toMatchObject({
                id: recordedId,
                isRecording: true,
                dropLogFile: { id: dropLogFileId, dropCnt: 4 },
                videoFiles: [{ id: videoFileId, parentDirectoryName: 'tmp', filePath: 'active.ts' }],
            });
            expect(Number(withDrop.videoFiles[0].size)).toBe(0);

            await harness.recordedDB.removeRecording(recordedId);
            const stopped = await harness.recordedDB.findId(recordedId);
            expect(stopped).toMatchObject({
                id: recordedId,
                isRecording: false,
                dropLogFile: { id: dropLogFileId },
                videoFiles: [{ id: videoFileId, parentDirectoryName: 'tmp', filePath: 'active.ts' }],
            });
            expect(Number(stopped.videoFiles[0].size)).toBe(0);

            await harness.videoFileDB.updateFilePath({
                videoFileId,
                parentDirectoryName: 'synthetic-storage',
                filePath: 'finished/active.ts',
            });
            const moved = await harness.recordedDB.findId(recordedId);
            expect(moved).toMatchObject({
                id: recordedId,
                isRecording: false,
                dropLogFile: { id: dropLogFileId },
                videoFiles: [
                    {
                        id: videoFileId,
                        parentDirectoryName: 'synthetic-storage',
                        filePath: 'finished/active.ts',
                    },
                ],
            });
            expect(Number(moved.videoFiles[0].size)).toBe(0);

            await harness.videoFileDB.updateSize(videoFileId, 16_384);

            const completed = await harness.recordedDB.findId(recordedId);
            expect(completed).toMatchObject({
                id: recordedId,
                isRecording: false,
                dropLogFile: { id: dropLogFileId, dropCnt: 4 },
                videoFiles: [
                    {
                        id: videoFileId,
                        parentDirectoryName: 'synthetic-storage',
                        filePath: 'finished/active.ts',
                        type: 'ts',
                        name: 'TS',
                        recordedId,
                    },
                ],
            });
            expect(Number(completed.videoFiles[0].size)).toBe(16_384);
        });
    }, 60_000);

    it('[RC-6.4] deletes history before the retention cutoff and preserves equal and newer rows', async () => {
        await forEachDatabase(async (_database, harness) => {
            const cutoff = 1_800_000_000_000;
            await harness.recordedHistoryDB.insertOnce(
                Object.assign(new RecordedHistory(), {
                    name: 'Synthetic Before Cutoff',
                    channelId: 201,
                    endAt: cutoff - 1,
                }),
            );
            await harness.recordedHistoryDB.insertOnce(
                Object.assign(new RecordedHistory(), {
                    name: 'Synthetic At Cutoff',
                    channelId: 202,
                    endAt: cutoff,
                }),
            );
            await harness.recordedHistoryDB.insertOnce(
                Object.assign(new RecordedHistory(), {
                    name: 'Synthetic After Cutoff',
                    channelId: 203,
                    endAt: cutoff + 1,
                }),
            );

            await harness.recordedHistoryDB.delete(cutoff);

            const remaining = await harness.recordedHistoryDB.findAll();
            expect(
                remaining
                    .map((history: any) => Number(history.endAt))
                    .sort((left: number, right: number) => left - right),
            ).toEqual([cutoff, cutoff + 1]);
        });
    }, 60_000);
});
