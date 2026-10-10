import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createSyntheticMedia, FFMPEG, runProcess } from '../../harness/synthetic-media';
import { createRepositoryPersistence, type RepositoryPersistence } from '../../persistence/repository-harness';
import {
    cleanupHarness,
    logger,
    PromiseQueue,
    restoreSpawn,
    ThumbnailManageModel,
    useRealSpawn,
} from '../imp/_thumbnail-harness';

/*
 * thumbnail の test は FileUtil を spy に差し替え、DB を stub にする。ここでは本物の FileUtil、本物の ffmpeg、
 * 本物の sqlite（RecordedDB・VideoFileDB・ThumbnailDB）で、生成 → DB への登録 → 削除（DB の行と file）を一続きに確かめる。
 */

const DEFAULT_THUMBNAIL_CMD =
    '%FFMPEG% -ss %THUMBNAIL_POSITION% -y -i %INPUT% -vframes 1 -f image2 -s %THUMBNAIL_SIZE% %OUTPUT%';

let root: string;
let input: string;
let ffmpegPath: string;
const persistences: RepositoryPersistence[] = [];

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-real-chain-'));
    input = await createSyntheticMedia(root, 'synthetic-input.ts', 'mpegts', 4);
    ffmpegPath = (await runProcess('sh', ['-c', `command -v ${FFMPEG}`])).stdout.trim();
}, 120_000);

afterEach(async () => {
    cleanupHarness();
    for (const persistence of persistences.splice(0)) await persistence.cleanup();
});

afterAll(async () => {
    restoreSpawn();
    await rm(root, { force: true, recursive: true });
});

describe('thumbnail generation, registration, and deletion on real components', () => {
    it('[TM-REAL-CHAIN] registers a real JPEG in sqlite after real ffmpeg publishes it, then deletes both the row and the file', async () => {
        const persistence = await createRepositoryPersistence('sqlite');
        persistences.push(persistence);
        const thumbnailRoot = await mkdtemp(join(root, 'thumbnail-'));
        useRealSpawn();

        const recordedId = await persistence.db.RecordedDB.insertOnce(
            Object.assign(new persistence.entities.Recorded(), {
                channelId: 101,
                duration: 60_000,
                endAt: 1_700_000_060_000,
                halfWidthName: 'thumbnail chain',
                isProtected: false,
                isRecording: false,
                name: 'thumbnail chain',
                startAt: 1_700_000_000_000,
            }),
        );
        const videoFileId = await persistence.db.VideoFileDB.insertOnce(
            Object.assign(new persistence.entities.VideoFile(), {
                filePath: 'synthetic-input.ts',
                name: 'thumbnail chain',
                parentDirectoryName: 'synthetic-main',
                recordedId,
                size: 1,
                type: 'ts',
            }),
        );
        const log = logger();
        const thumbnailEvent = { emitAdded: vi.fn(), emitDeleted: vi.fn() };
        const queue = new PromiseQueue();
        const model = new ThumbnailManageModel(
            { getLogger: () => log },
            {
                getConfig: () => ({
                    ffmpeg: ffmpegPath,
                    thumbnail: thumbnailRoot,
                    thumbnailCmd: DEFAULT_THUMBNAIL_CMD,
                    thumbnailPosition: 1,
                    thumbnailSize: '480x270',
                }),
            },
            queue,
            persistence.db.RecordedDB,
            persistence.db.VideoFileDB,
            persistence.db.ThumbnailDB,
            thumbnailEvent,
            { getFullFilePathFromId: vi.fn(async () => input) },
        );

        model.add(videoFileId);
        await vi.waitFor(() => expect(thumbnailEvent.emitAdded).toHaveBeenCalledOnce(), {
            interval: 100,
            timeout: 30_000,
        });
        // 追加の通知は一時 directory の片付けより先に出るので、生成の job が queue で終わるまで待つ。
        await queue.add(async () => undefined);

        const thumbnails = (await persistence.db.ThumbnailDB.findAll()) as Array<{ filePath: string; id: number }>;
        expect(thumbnails).toEqual([expect.objectContaining({ filePath: `${recordedId}.jpg`, recordedId })]);
        expect(thumbnailEvent.emitAdded).toHaveBeenCalledWith(videoFileId, recordedId);
        await expect(readdir(thumbnailRoot)).resolves.toEqual([`${recordedId}.jpg`]);

        await model.delete(thumbnails[0].id);

        await expect(persistence.db.ThumbnailDB.findAll()).resolves.toEqual([]);
        await expect(readdir(thumbnailRoot)).resolves.toEqual([]);
        expect(thumbnailEvent.emitDeleted).toHaveBeenCalledOnce();
        expect(log.system.error).not.toHaveBeenCalled();
    }, 60_000);
});
