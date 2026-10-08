import 'reflect-metadata';

import { mkdtemp, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { silentLoggerModel } from '../harness/silent-logger-model';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RecordedManageModel = (
    require(join(snapshot, 'model/operator/recorded/RecordedManageModel.js')) as {
        default: { prototype: Record<string, unknown> };
    }
).default;
const VideoUtil = (require(join(snapshot, 'model/api/video/VideoUtil.js')) as { default: { prototype: object } })
    .default;
const FileUtil = require(join(snapshot, 'util', 'FileUtil.js')).default;
const Recorded = (require(join(snapshot, 'db/entities/Recorded.js')) as { default: new () => any }).default;
const VideoFile = (require(join(snapshot, 'db/entities/VideoFile.js')) as { default: new () => any }).default;
const Thumbnail = (require(join(snapshot, 'db/entities/Thumbnail.js')) as { default: new () => any }).default;
const DropLogFile = (require(join(snapshot, 'db/entities/DropLogFile.js')) as { default: new () => any }).default;
const RecordedTag = (require(join(snapshot, 'db/entities/RecordedTag.js')) as { default: new () => any }).default;
const RecordedDB = (require(join(snapshot, 'model/db/RecordedDB.js')) as { default: new (...args: any[]) => any })
    .default;
const VideoFileDB = (
    require(join(snapshot, 'model/db/VideoFileDB.js')) as {
        default: new (...args: any[]) => any;
    }
).default;
const ThumbnailDB = (
    require(join(snapshot, 'model/db/ThumbnailDB.js')) as {
        default: new (...args: any[]) => any;
    }
).default;
const DropLogFileDB = (
    require(join(snapshot, 'model/db/DropLogFileDB.js')) as {
        default: new (...args: any[]) => any;
    }
).default;
const RecordedTagDB = (
    require(join(snapshot, 'model/db/RecordedTagDB.js')) as {
        default: new (...args: any[]) => any;
    }
).default;

const temporaryRoots: string[] = [];

afterEach(async () => {
    vi.restoreAllMocks();
    const { rm } = await import('node:fs/promises');
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const subject = (recordedRoot: string, thumbnailRoot: string, dropLogRoot: string) => {
    const value: any = Object.create(RecordedManageModel.prototype);
    value.log = { system: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    value.config = {
        recorded: [{ name: 'main', path: recordedRoot }],
        thumbnail: thumbnailRoot,
        dropLog: dropLogRoot,
    };
    value.videoUtil = Object.create(VideoUtil.prototype, { config: { get: () => value.config } });
    value.videoFileDB = { deleteOnce: vi.fn(async () => undefined), deleteRecordedId: vi.fn() };
    value.thumbnailDB = { deleteOnce: vi.fn(async () => undefined) };
    value.dropLogFileDB = { deleteOnce: vi.fn(async () => undefined) };
    value.recordedDB = { deleteOnce: vi.fn(async () => undefined) };
    value.recordedEvent = { emitDeleteRecorded: vi.fn(), emitDeleteVideoFile: vi.fn() };
    return value;
};

describe('recorded deletion filesystem integration', () => {
    it('does not follow outside or intermediate links and unlinks only a final link entry', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-delete-'));
        temporaryRoots.push(root);
        const recordedRoot = join(root, 'recorded');
        const recordedRealRoot = join(root, 'recorded-real');
        const thumbnailRoot = join(root, 'thumbnail');
        const dropLogRoot = join(root, 'drop-log');
        const outsideRoot = join(root, 'outside');
        await Promise.all([mkdir(recordedRealRoot), mkdir(thumbnailRoot), mkdir(dropLogRoot), mkdir(outsideRoot)]);

        const outsideVideo = join(outsideRoot, 'outside.ts');
        const outsideThumbnail = join(outsideRoot, 'outside.jpg');
        const finalLinkTarget = join(outsideRoot, 'final-target.log');
        const safeVideo = join(recordedRealRoot, 'safe.ts');
        await Promise.all([
            writeFile(outsideVideo, 'outside-video'),
            writeFile(outsideThumbnail, 'outside-thumbnail'),
            writeFile(finalLinkTarget, 'final-target'),
            writeFile(safeVideo, 'safe-video'),
            symlink(recordedRealRoot, recordedRoot),
            symlink(outsideRoot, join(recordedRealRoot, 'linked-directory')),
            symlink(finalLinkTarget, join(dropLogRoot, 'final-link.log')),
        ]);

        const target = subject(recordedRoot, thumbnailRoot, dropLogRoot);
        const recorded = {
            id: 871,
            isProtected: false,
            videoFiles: [
                { id: 872, parentDirectoryName: 'main', filePath: '../outside/outside.ts' },
                { id: 873, parentDirectoryName: 'main', filePath: 'linked-directory/outside.ts' },
                { id: 876, parentDirectoryName: 'main', filePath: 'safe.ts' },
            ],
            thumbnails: [{ id: 874, filePath: '../outside/outside.jpg' }],
            dropLogFile: { id: 875, filePath: 'final-link.log' },
        };

        await target.deleteExactRecordedResources(recorded);

        await expect(readFile(outsideVideo, 'utf8')).resolves.toBe('outside-video');
        await expect(readFile(outsideThumbnail, 'utf8')).resolves.toBe('outside-thumbnail');
        await expect(readFile(finalLinkTarget, 'utf8')).resolves.toBe('final-target');
        const { lstat } = await import('node:fs/promises');
        await expect(lstat(safeVideo)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(lstat(join(dropLogRoot, 'final-link.log'))).rejects.toMatchObject({ code: 'ENOENT' });
        expect(target.videoFileDB.deleteOnce.mock.calls).toEqual([[872], [873], [876]]);
        expect(target.thumbnailDB.deleteOnce).toHaveBeenCalledWith(874);
        expect(target.dropLogFileDB.deleteOnce).toHaveBeenCalledWith(875);
        expect(target.recordedDB.deleteOnce).toHaveBeenCalledWith(871);
        expect(target.recordedEvent.emitDeleteRecorded).toHaveBeenCalledOnce();
    });

    it('settles delegated whole, individual, and storage deletions against final SQLite relations', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-delete-db-'));
        temporaryRoots.push(root);
        const recordedRoot = join(root, 'recorded');
        const thumbnailRoot = join(root, 'thumbnail');
        const dropLogRoot = join(root, 'drop-log');
        await Promise.all([mkdir(recordedRoot), mkdir(thumbnailRoot), mkdir(dropLogRoot)]);
        await Promise.all([
            writeFile(join(recordedRoot, 'target.ts'), 'target'),
            writeFile(join(recordedRoot, 'late.ts'), 'late'),
            writeFile(join(recordedRoot, 'other.ts'), 'other'),
            writeFile(join(recordedRoot, 'other-second.ts'), 'other-second'),
            writeFile(join(recordedRoot, 'storage.ts'), 'storage'),
            writeFile(join(thumbnailRoot, 'target.jpg'), 'thumbnail'),
            writeFile(join(dropLogRoot, 'target.log'), 'drop'),
        ]);

        const source = new DataSource({
            type: 'better-sqlite3',
            database: join(root, 'recorded.db'),
            entities: [join(snapshot, 'db', 'entities', '*.js')],
            logging: false,
            synchronize: true,
        });
        await source.initialize();
        try {
            const operator = { getConnection: async () => source, getLikeStr: () => 'like' };
            const retry = { run: <T>(operation: () => Promise<T>): Promise<T> => operation() };
            const recordedDB = new RecordedDB(silentLoggerModel, operator, retry);
            const videoFileDB = new VideoFileDB(silentLoggerModel, operator, retry);
            const thumbnailDB = new ThumbnailDB(silentLoggerModel, operator, retry);
            const dropLogFileDB = new DropLogFileDB(silentLoggerModel, operator, retry);
            const recordedTagDB = new RecordedTagDB(silentLoggerModel, operator, retry);
            const baseRecorded = (name: string) =>
                Object.assign(new Recorded(), {
                    reserveId: null,
                    ruleId: null,
                    programId: null,
                    channelId: 101,
                    isProtected: false,
                    startAt: 1_700_000_000_000,
                    endAt: 1_700_000_060_000,
                    duration: 60_000,
                    name,
                    halfWidthName: name,
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
                });
            const dropLogId = await dropLogFileDB.insertOnce(
                Object.assign(new DropLogFile(), {
                    errorCnt: 0,
                    dropCnt: 0,
                    scramblingCnt: 0,
                    filePath: 'target.log',
                }),
            );
            const targetId = await recordedDB.insertOnce(
                Object.assign(baseRecorded('Synthetic Deletion Target'), { dropLogFileId: dropLogId }),
            );
            const otherId = await recordedDB.insertOnce(baseRecorded('Synthetic Unchanged Aggregate'));
            const storageId = await recordedDB.insertOnce(baseRecorded('Synthetic Storage Aggregate'));
            const targetVideoId = await videoFileDB.insertOnce(
                Object.assign(new VideoFile(), {
                    parentDirectoryName: 'main',
                    filePath: 'target.ts',
                    type: 'ts',
                    name: 'Synthetic Target Video',
                    size: 6,
                    recordedId: targetId,
                }),
            );
            const otherVideoId = await videoFileDB.insertOnce(
                Object.assign(new VideoFile(), {
                    parentDirectoryName: 'main',
                    filePath: 'other.ts',
                    type: 'ts',
                    name: 'Synthetic Other Video',
                    size: 5,
                    recordedId: otherId,
                }),
            );
            const otherSecondVideoId = await videoFileDB.insertOnce(
                Object.assign(new VideoFile(), {
                    parentDirectoryName: 'main',
                    filePath: 'other-second.ts',
                    type: 'ts',
                    name: 'Synthetic Other Second Video',
                    size: 12,
                    recordedId: otherId,
                }),
            );
            const storageVideoId = await videoFileDB.insertOnce(
                Object.assign(new VideoFile(), {
                    parentDirectoryName: 'main',
                    filePath: 'storage.ts',
                    type: 'ts',
                    name: 'Synthetic Storage Video',
                    size: 7,
                    recordedId: storageId,
                }),
            );
            const targetThumbnailId = await thumbnailDB.insertOnce(
                Object.assign(new Thumbnail(), { filePath: 'target.jpg', recordedId: targetId }),
            );
            const tagId = await recordedTagDB.insertOnce(
                Object.assign(new RecordedTag(), {
                    name: 'Synthetic Deletion Tag',
                    halfWidthName: 'Synthetic Deletion Tag',
                    color: '#123456',
                }),
            );
            await recordedTagDB.setRelation(tagId, targetId);
            const target = subject(recordedRoot, thumbnailRoot, dropLogRoot);
            target.recordedDB = recordedDB;
            target.videoFileDB = videoFileDB;
            target.thumbnailDB = thumbnailDB;
            target.dropLogFileDB = dropLogFileDB;
            const preparation = await target.prepareUserDeletion(targetId);
            expect(preparation.status).toBe('prepared');
            const lateVideoId = await videoFileDB.insertOnce(
                Object.assign(new VideoFile(), {
                    parentDirectoryName: 'main',
                    filePath: 'late.ts',
                    type: 'ts',
                    name: 'Synthetic Late Video',
                    size: 4,
                    recordedId: targetId,
                }),
            );
            await target.deletePrepared(preparation.token);

            await expect(recordedDB.findId(targetId)).resolves.toBeNull();
            await expect(videoFileDB.findId(targetVideoId)).resolves.toBeNull();
            await expect(videoFileDB.findId(lateVideoId)).resolves.toBeNull();
            await expect(thumbnailDB.findId(targetThumbnailId)).resolves.toBeNull();
            await expect(dropLogFileDB.findId(dropLogId)).resolves.toBeNull();
            await expect(recordedDB.findId(otherId)).resolves.toMatchObject({ id: otherId });
            await expect(videoFileDB.findId(otherVideoId)).resolves.toMatchObject({ id: otherVideoId });
            await expect(recordedTagDB.findId(tagId)).resolves.toMatchObject({ id: tagId });
            expect(target.recordedEvent.emitDeleteRecorded).toHaveBeenCalledOnce();

            const individualPreparation = await target.prepareVideoFileDeletion(otherVideoId);
            expect(individualPreparation.status).toBe('prepared');
            await expect(target.deletePreparedVideoFile(individualPreparation.token)).resolves.toEqual({
                status: 'video-file-deleted',
            });
            await expect(videoFileDB.findId(otherVideoId)).resolves.toBeNull();
            await expect(videoFileDB.findId(otherSecondVideoId)).resolves.toMatchObject({ id: otherSecondVideoId });
            expect(target.recordedEvent.emitDeleteVideoFile).toHaveBeenCalledOnce();
            expect(target.recordedEvent.emitDeleteVideoFile).toHaveBeenCalledWith(otherVideoId);

            await expect(target.prepareVideoFileDeletion(otherSecondVideoId)).resolves.toEqual({
                status: 'whole-recorded-deletion-required',
                recordedId: otherId,
            });
            const wholePreparation = await target.prepareUserDeletion(otherId);
            expect(wholePreparation.status).toBe('prepared');
            const notificationFailure = new Error('synthetic notification failure');
            target.recordedEvent.emitDeleteRecorded.mockImplementationOnce(() => {
                throw notificationFailure;
            });
            await expect(target.deletePrepared(wholePreparation.token)).rejects.toBe(notificationFailure);
            await expect(recordedDB.findId(otherId)).resolves.toBeNull();
            await expect(videoFileDB.findId(otherSecondVideoId)).resolves.toBeNull();
            expect(target.recordedEvent.emitDeleteRecorded).toHaveBeenCalledTimes(2);
            await expect(target.deletePrepared(wholePreparation.token)).rejects.toThrow('token-replayed');

            const failingRecordedId = await recordedDB.insertOnce(baseRecorded('Synthetic Failed Aggregate'));
            await writeFile(join(recordedRoot, 'failing.ts'), 'failing');
            const failingVideoId = await videoFileDB.insertOnce(
                Object.assign(new VideoFile(), {
                    parentDirectoryName: 'main',
                    filePath: 'failing.ts',
                    type: 'ts',
                    name: 'Synthetic Failing Video',
                    size: 7,
                    recordedId: failingRecordedId,
                }),
            );
            const failingPreparation = await target.prepareUserDeletion(failingRecordedId);
            expect(failingPreparation.status).toBe('prepared');
            const canonicalFailure = new Error('synthetic canonical failure');
            const deleteOnce = recordedDB.deleteOnce.bind(recordedDB);
            target.recordedDB.deleteOnce = vi.fn(async (recordedId: number) => {
                if (recordedId === failingRecordedId) {
                    throw canonicalFailure;
                }
                return deleteOnce(recordedId);
            });
            await expect(target.deletePrepared(failingPreparation.token)).rejects.toBe(canonicalFailure);
            await expect(recordedDB.findId(failingRecordedId)).resolves.toMatchObject({ id: failingRecordedId });
            await expect(videoFileDB.findId(failingVideoId)).resolves.toBeNull();
            expect(target.recordedEvent.emitDeleteRecorded).toHaveBeenCalledTimes(2);
            await expect(target.deletePrepared(failingPreparation.token)).rejects.toThrow('token-replayed');

            const storagePreparation = await target.prepareStorageDeletion(storageId, 'main');
            expect(storagePreparation.status).toBe('prepared');
            await expect(target.deletePreparedForStorage(storagePreparation.token)).resolves.toBe('deleted');
            await expect(readFile(join(recordedRoot, 'storage.ts'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(recordedDB.findId(storageId)).resolves.toBeNull();
            await expect(videoFileDB.findId(storageVideoId)).resolves.toBeNull();
            expect(target.recordedEvent.emitDeleteRecorded).toHaveBeenCalledTimes(3);
            expect(target.recordedEvent.emitDeleteRecorded).toHaveBeenLastCalledWith(
                expect.objectContaining({ id: storageId }),
            );
            await expect(target.deletePreparedForStorage(storagePreparation.token)).rejects.toThrow('token-replayed');
            expect(target.resourceMutationLock.tails.size).toBe(0);
        } finally {
            await source.destroy();
        }
    });

    it('keeps unlink bound to a pinned parent when the logical directory is replaced after validation', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-delete-race-'));
        temporaryRoots.push(root);
        const recordedRoot = join(root, 'recorded');
        const parent = join(recordedRoot, 'parent');
        const movedParent = join(recordedRoot, 'validated-parent');
        const outsideRoot = join(root, 'outside');
        const outsideVictim = join(outsideRoot, 'victim.ts');
        await Promise.all([mkdir(parent, { recursive: true }), mkdir(outsideRoot)]);
        await Promise.all([writeFile(join(parent, 'victim.ts'), 'managed'), writeFile(outsideVictim, 'outside')]);

        const target = subject(recordedRoot, join(root, 'thumbnail'), join(root, 'drop-log'));
        const originalUnlink = FileUtil.unlink.bind(FileUtil);
        vi.spyOn(FileUtil, 'unlink').mockImplementation(async (filePath: string) => {
            await rename(parent, movedParent);
            await symlink(outsideRoot, parent);
            await originalUnlink(filePath);
        });

        await target.deleteExactRecordedResources({
            id: 877,
            isProtected: false,
            videoFiles: [{ id: 878, parentDirectoryName: 'main', filePath: 'parent/victim.ts' }],
            thumbnails: [],
            dropLogFile: null,
        });

        await expect(readFile(outsideVictim, 'utf8')).resolves.toBe('outside');
        const { lstat } = await import('node:fs/promises');
        await expect(lstat(join(movedParent, 'victim.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    });
});
