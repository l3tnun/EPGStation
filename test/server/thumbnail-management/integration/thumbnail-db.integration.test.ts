import 'reflect-metadata';

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { silentLoggerModel } from '../../harness/silent-logger-model';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');

const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
const Recorded = load<new () => Record<string, unknown>>('db/entities/Recorded.js');
const ThumbnailDB = load<new (...args: any[]) => any>('model/db/ThumbnailDB.js');

const retry = { run: <T>(operation: () => Promise<T>): Promise<T> => operation() };

const recordedRow = (): Record<string, unknown> => ({
    reserveId: null,
    ruleId: null,
    programId: null,
    channelId: 1,
    isProtected: false,
    startAt: 1_000,
    endAt: 2_000,
    duration: 1_000,
    name: 'synthetic-thumbnail-recorded',
    halfWidthName: 'synthetic-thumbnail-recorded',
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

describe('thumbnail database integration', () => {
    it('[TM-7.4-DB] insert-find-delete-and-db-failure-cleanup preserves rows across failed retry boundaries', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-db-'));
        const source = new DataSource({
            type: 'better-sqlite3',
            database: join(root, 'thumbnail.sqlite'),
            entities: [join(snapshot, 'db', 'entities', '*.js')],
            logging: false,
            synchronize: true,
        });
        try {
            await source.initialize();
            const operator = { getConnection: async () => source };
            const thumbnails = new ThumbnailDB(silentLoggerModel, operator, retry);
            const recorded = await source.getRepository(Recorded).save(Object.assign(new Recorded(), recordedRow()));

            const firstId = await thumbnails.insertOnce({ filePath: 'first.jpg', recordedId: recorded.id });
            await expect(thumbnails.findId(firstId)).resolves.toMatchObject({
                filePath: 'first.jpg',
                recordedId: recorded.id,
            });

            let releasePendingSave: (() => void) | undefined;
            const pendingRetry = {
                run: <T>(operation: () => Promise<T>): Promise<T> =>
                    new Promise<void>(resolve => {
                        releasePendingSave = resolve;
                    }).then(operation),
            };
            const pendingThumbnails = new ThumbnailDB(silentLoggerModel, operator, pendingRetry);
            const pendingInsert = pendingThumbnails.insertOnce({ filePath: 'pending.jpg', recordedId: recorded.id });
            await vi.waitFor(() => expect(releasePendingSave).toBeTypeOf('function'));
            await expect(thumbnails.findAll()).resolves.toMatchObject([{ id: firstId, filePath: 'first.jpg' }]);
            releasePendingSave?.();
            const pendingId = await pendingInsert;
            await expect(thumbnails.findId(pendingId)).resolves.toMatchObject({
                filePath: 'pending.jpg',
                recordedId: recorded.id,
            });

            const failure = new Error('synthetic thumbnail registration failure');
            const failingThumbnails = new ThumbnailDB(silentLoggerModel, operator, { run: async () => Promise.reject(failure) });
            await expect(
                failingThumbnails.insertOnce({ filePath: 'failed.jpg', recordedId: recorded.id }),
            ).rejects.toBe(failure);
            await expect(thumbnails.findAll()).resolves.toMatchObject([
                { id: firstId, filePath: 'first.jpg' },
                { id: pendingId, filePath: 'pending.jpg' },
            ]);

            await expect(failingThumbnails.deleteOnce(firstId)).rejects.toBe(failure);
            await expect(thumbnails.findId(firstId)).resolves.toMatchObject({
                filePath: 'first.jpg',
                recordedId: recorded.id,
            });

            await thumbnails.deleteOnce(firstId);
            await thumbnails.deleteOnce(pendingId);
            await expect(thumbnails.findId(firstId)).resolves.toBeNull();
            await expect(thumbnails.findAll()).resolves.toEqual([]);
        } finally {
            if (source.isInitialized) await source.destroy();
            expect(source.isInitialized).toBe(false);
            await rm(root, { force: true, recursive: true });
            await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
        }
    });
});
