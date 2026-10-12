import 'reflect-metadata';

import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { silentLoggerModel } from '../harness/silent-logger-model';

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

const retry = { run: <T>(operation: () => Promise<T>): Promise<T> => operation() };

const recordedEntity = (overrides: Record<string, unknown> = {}): any =>
    Object.assign(new Recorded(), {
        reserveId: null,
        ruleId: null,
        programId: 7_401,
        channelId: 101,
        isProtected: false,
        startAt: 1_700_000_000_000,
        endAt: 1_700_000_060_000,
        duration: 60_000,
        name: 'Task 7.4 database boundary',
        halfWidthName: 'Task 7.4 database boundary',
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

describe('recorded content database integration', () => {
    it('upload-commit-and-delete-relations', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recorded-task-7-4-db-'));
        const source = new DataSource({
            type: 'better-sqlite3',
            database: join(root, 'recorded.db'),
            entities: [join(snapshot, 'db', 'entities', '*.js')],
            logging: false,
            synchronize: true,
        });

        try {
            await source.initialize();
            const operator = { getConnection: async () => source, getLikeStr: () => 'like' };
            const recordedDB = new RecordedDB(silentLoggerModel, operator, retry);
            const videoFileDB = new VideoFileDB(silentLoggerModel, operator, retry);
            const dropLogFileDB = new DropLogFileDB(silentLoggerModel, operator, retry);
            const thumbnailDB = new ThumbnailDB(silentLoggerModel, operator, retry);
            const recordedTagDB = new RecordedTagDB(silentLoggerModel, operator, retry);
            const recordedHistoryDB = new RecordedHistoryDB(silentLoggerModel, operator, retry);

            const dropLogFileId = await dropLogFileDB.insertOnce(
                Object.assign(new DropLogFile(), {
                    errorCnt: 1,
                    dropCnt: 2,
                    scramblingCnt: 3,
                    filePath: 'task-7-4.log',
                }),
            );
            const recordedId = await recordedDB.insertOnce(recordedEntity({ dropLogFileId }));
            const uploadedVideoFileId = await videoFileDB.insertOnce(
                Object.assign(new VideoFile(), {
                    parentDirectoryName: 'main',
                    filePath: 'task-7-4.ts',
                    type: 'ts',
                    name: 'Task 7.4 upload',
                    size: 4_096,
                    recordedId,
                }),
            );
            await thumbnailDB.insertOnce(
                Object.assign(new Thumbnail(), { filePath: 'task-7-4.jpg', recordedId }),
            );
            const tagId = await recordedTagDB.insertOnce(
                Object.assign(new RecordedTag(), {
                    color: '#123456',
                    halfWidthName: 'Task 7.4 tag',
                    name: 'Task 7.4 tag',
                }),
            );
            await recordedTagDB.setRelation(tagId, recordedId);

            await expect(recordedDB.findId(recordedId)).resolves.toMatchObject({
                dropLogFile: { id: dropLogFileId, filePath: 'task-7-4.log' },
                id: recordedId,
                programId: 7_401,
                tags: [{ id: tagId, name: 'Task 7.4 tag' }],
                thumbnails: [{ filePath: 'task-7-4.jpg', recordedId }],
                videoFiles: [{ id: uploadedVideoFileId, filePath: 'task-7-4.ts', recordedId }],
            });

            await videoFileDB.deleteOnce(uploadedVideoFileId);
            await expect(videoFileDB.findId(uploadedVideoFileId)).resolves.toBeNull();
            await expect(recordedDB.findId(recordedId)).resolves.toMatchObject({
                id: recordedId,
                videoFiles: [],
            });

            const cutoff = 1_800_000_000_000;
            await Promise.all([
                recordedHistoryDB.insertOnce(
                    Object.assign(new RecordedHistory(), { channelId: 1, endAt: cutoff - 1, name: 'expired' }),
                ),
                recordedHistoryDB.insertOnce(
                    Object.assign(new RecordedHistory(), { channelId: 2, endAt: cutoff, name: 'retained-at-cutoff' }),
                ),
            ]);
            await recordedHistoryDB.delete(cutoff);
            expect((await recordedHistoryDB.findAll()).map((history: any) => Number(history.endAt))).toEqual([cutoff]);

            const rollbackFailure = new Error('synthetic transaction failure');
            await expect(
                source.transaction(async manager => {
                    await manager.getRepository(RecordedTag).save(
                        Object.assign(new RecordedTag(), {
                            color: '#654321',
                            halfWidthName: 'rolled-back-tag',
                            name: 'rolled-back-tag',
                        }),
                    );
                    throw rollbackFailure;
                }),
            ).rejects.toBe(rollbackFailure);
            await expect(recordedTagDB.findAll({ name: 'rolled-back-tag' })).resolves.toEqual([[], 0]);
        } finally {
            if (source.isInitialized) await source.destroy();
            await rm(root, { force: true, recursive: true });
        }

        expect(source.isInitialized).toBe(false);
    });
});
