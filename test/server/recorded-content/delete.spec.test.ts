import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
const RecordedManageModel = load<new (...args: any[]) => any>('model/operator/recorded/RecordedManageModel.js');
const VideoUtil = load<{ prototype: object }>('model/api/video/VideoUtil.js');
const FileUtil = require(join(snapshot, 'util', 'FileUtil.js')).default;

afterEach(() => {
    vi.restoreAllMocks();
});

const subject = () => {
    const value: any = Object.create(RecordedManageModel.prototype);
    value.log = { system: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    value.recordedDB = { findId: vi.fn(), deleteOnce: vi.fn(async () => undefined) };
    value.videoFileDB = { findId: vi.fn(), deleteOnce: vi.fn(), deleteRecordedId: vi.fn() };
    value.thumbnailDB = { deleteOnce: vi.fn(async () => undefined) };
    value.dropLogFileDB = { deleteOnce: vi.fn(async () => undefined) };
    // 実装の`VideoUtil.getParentDirPath`を、`value.config`をそのまま見る形で使う。
    value.videoUtil = Object.assign(Object.create(VideoUtil.prototype, { config: { get: () => value.config } }), {
        getFullFilePathFromId: vi.fn(),
    });
    value.recordedEvent = { emitDeleteRecorded: vi.fn(), emitDeleteVideoFile: vi.fn() };
    value.recordingManageModel = { hasReserve: vi.fn(), cancel: vi.fn() };
    value.config = { recorded: [], thumbnail: 'synthetic-thumbnail', dropLog: 'synthetic-drop-log' };
    return value;
};

const preparedDeletionProvider = (recorded: Record<string, unknown>) => {
    const recordedDB = {
        deleteOnce: vi.fn(async () => undefined),
        findId: vi.fn(async () => recorded),
    };
    const videoFileDB = { deleteOnce: vi.fn(async () => undefined) };
    const thumbnailDB = { deleteOnce: vi.fn(async () => undefined) };
    const dropLogFileDB = { deleteOnce: vi.fn(async () => undefined) };
    const recordedEvent = { emitDeleteRecorded: vi.fn() };
    const provider = new RecordedManageModel(
        { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }) },
        { getConfig: () => ({ dropLog: 'synthetic-drop-log', recorded: [], thumbnail: 'synthetic-thumbnail' }) },
        recordedDB,
        videoFileDB,
        thumbnailDB,
        dropLogFileDB,
        {},
        { cancel: vi.fn(), hasReserve: vi.fn() },
        recordedEvent,
        {},
        {},
    );
    return { dropLogFileDB, provider, recordedDB, recordedEvent, thumbnailDB, videoFileDB };
};

describe('recorded deletion specification characterization', () => {
    it('[RC-8.1] rejects missing recorded and video-file ids without destructive effects', async () => {
        const target = subject();
        const missingRecordedId = 801;
        const missingVideoFileId = 802;
        target.recordedDB.findId.mockResolvedValue(null);
        target.videoFileDB.findId.mockResolvedValue(null);

        await expect(target.delete(missingRecordedId)).rejects.toThrow('RecordedIdIsNotFound');
        await expect(target.deleteVideoFile(missingVideoFileId)).rejects.toThrow('VideoFileIsNotFound');

        expect(target.recordedDB.findId).toHaveBeenCalledWith(missingRecordedId);
        expect(target.videoFileDB.findId).toHaveBeenCalledWith(missingVideoFileId);
        expect(target.recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.videoUtil.getFullFilePathFromId).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
    });

    it('[RC-8.2] rejects protected whole and individual user deletion for their exact ids', async () => {
        const target = subject();
        const protectedRecordedId = 811;
        const protectedVideoParentId = 812;
        const protectedVideoFileId = 813;
        target.recordedDB.findId.mockImplementation(async (recordedId: number) => ({
            id: recordedId,
            isProtected: true,
            videoFiles: recordedId === protectedVideoParentId ? [{ id: protectedVideoFileId }] : [],
        }));
        target.videoFileDB.findId.mockResolvedValue({ id: protectedVideoFileId, recordedId: protectedVideoParentId });

        await expect(target.delete(protectedRecordedId)).rejects.toThrow('RecordedIsProtected');
        await expect(target.deleteVideoFile(protectedVideoFileId)).rejects.toThrow('RecordedIsProtected');

        expect(target.recordedDB.findId).toHaveBeenCalledWith(protectedRecordedId);
        expect(target.videoFileDB.findId).toHaveBeenCalledWith(protectedVideoFileId);
        expect(target.recordedDB.findId).toHaveBeenCalledWith(protectedVideoParentId);
        expect(target.recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.videoUtil.getFullFilePathFromId).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
    });

    it('characterizes public delete side effects for a relation-bearing recorded', async () => {
        const target = subject();
        const recordedId = 821;
        const videoFileId = 822;
        const thumbnailId = 823;
        const dropLogId = 824;
        const thumbnailFile = 'synthetic-thumb.jpg';
        const dropLogFileName = 'synthetic-drop.log';
        const recorded = {
            id: recordedId,
            isProtected: false,
            isRecording: false,
            reserveId: null,
            videoFiles: [{ id: videoFileId, parentDirectoryName: 'main', filePath: 'synthetic-video.ts' }],
            thumbnails: [{ id: thumbnailId, filePath: thumbnailFile }],
            dropLogFile: { id: dropLogId, filePath: dropLogFileName },
        };
        target.config.recorded = [{ name: 'main', path: 'synthetic-storage' }];
        target.recordedDB.findId.mockResolvedValue(recorded);
        target.thumbnailDB.deleteRecordedId = vi.fn(async () => undefined);
        target.videoFileDB.deleteRecordedId = vi.fn(async () => undefined);
        target.removeManagedFile = vi.fn(async () => 'removed');

        await expect(target.delete(recordedId)).resolves.toBeUndefined();

        expect(target.removeManagedFile.mock.calls).toEqual([
            [target.config.thumbnail, thumbnailFile],
            ['synthetic-storage', 'synthetic-video.ts'],
            [target.config.dropLog, dropLogFileName],
        ]);
        expect(target.thumbnailDB.deleteRecordedId).toHaveBeenCalledOnce();
        expect(target.thumbnailDB.deleteRecordedId).toHaveBeenCalledWith(recordedId);
        expect(target.videoFileDB.deleteRecordedId).toHaveBeenCalledOnce();
        expect(target.videoFileDB.deleteRecordedId).toHaveBeenCalledWith(recordedId);
        expect(target.recordedDB.deleteOnce).toHaveBeenCalledOnce();
        expect(target.recordedDB.deleteOnce).toHaveBeenCalledWith(recordedId);
        expect(target.dropLogFileDB.deleteOnce).toHaveBeenCalledOnce();
        expect(target.dropLogFileDB.deleteOnce).toHaveBeenCalledWith(dropLogId);
        expect(target.recordedEvent.emitDeleteRecorded).toHaveBeenCalledOnce();
        expect(target.recordedEvent.emitDeleteRecorded).toHaveBeenCalledWith(recorded);
    });

    it('[RC-8.3] keeps public prepared deletion effect-free until workflow completion, then consumes its final port once', async () => {
        const recorded = {
            id: 814,
            reserveId: 815,
            isProtected: false,
            isRecording: true,
            videoFiles: [],
            thumbnails: [],
            dropLogFile: null,
        };
        const { dropLogFileDB, provider, recordedDB, recordedEvent, thumbnailDB, videoFileDB } =
            preparedDeletionProvider(recorded);
        let completeWorkflow!: () => void;
        const workflow = new Promise<void>(resolve => {
            completeWorkflow = resolve;
        });

        const preparation = await provider.prepareUserDeletion(recorded.id);
        expect(preparation).toMatchObject({
            isRecording: true,
            reserveId: recorded.reserveId,
            status: 'prepared',
        });
        if (preparation.status !== 'prepared') throw new Error('synthetic prepared deletion was rejected');

        const finalization = workflow.then(() => provider.deletePrepared(preparation.token));

        expect(recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(thumbnailDB.deleteOnce).not.toHaveBeenCalled();
        expect(dropLogFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();

        completeWorkflow();
        await expect(finalization).resolves.toBeUndefined();

        expect(recordedDB.deleteOnce).toHaveBeenCalledOnce();
        expect(recordedDB.deleteOnce).toHaveBeenCalledWith(recorded.id);
        expect(recordedEvent.emitDeleteRecorded).toHaveBeenCalledOnce();
        expect(recordedEvent.emitDeleteRecorded).toHaveBeenCalledWith(recorded);
        await expect(provider.deletePrepared(preparation.token)).rejects.toThrow('token-replayed');
        expect(recordedDB.deleteOnce).toHaveBeenCalledOnce();
        expect(recordedEvent.emitDeleteRecorded).toHaveBeenCalledOnce();
    });

    it('[RC-8.9] emits no successful deletion notification when the canonical row does not settle successfully', async () => {
        const target = subject();
        const recorded = {
            id: 816,
            reserveId: null,
            isProtected: false,
            isRecording: false,
            videoFiles: [],
            thumbnails: [],
            dropLogFile: null,
        };
        target.recordedDB.deleteOnce.mockRejectedValue(new Error('synthetic canonical failure'));

        await expect(target.deleteExactRecordedResources(recorded)).rejects.toThrow('synthetic canonical failure');

        expect(target.recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();
    });
});

describe('prepared recorded deletion providers', () => {
    it('prepares whole deletion without effects and returns typed gates', async () => {
        const target = subject();
        const recorded = {
            id: 901,
            reserveId: 902,
            isProtected: false,
            isRecording: true,
            videoFiles: [{ id: 903 }],
        };
        target.recordedDB.findId
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ ...recorded, isProtected: true })
            .mockResolvedValueOnce(recorded);

        await expect(target.prepareUserDeletion(900)).resolves.toEqual({ status: 'not-found' });
        await expect(target.prepareUserDeletion(recorded.id)).resolves.toEqual({ status: 'protected' });
        const prepared = await target.prepareUserDeletion(recorded.id);

        expect(prepared).toMatchObject({
            status: 'prepared',
            isRecording: true,
            reserveId: recorded.reserveId,
        });
        expect(Object.keys(prepared.token)).toEqual([]);
        expect(target.recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.recordingManageModel.cancel).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();
    });

    it('rereads the whole aggregate and deletes only the final exact plan', async () => {
        const target = subject();
        const preparedState = {
            id: 911,
            reserveId: null,
            isProtected: false,
            isRecording: false,
            videoFiles: [{ id: 912 }],
            thumbnails: [],
            dropLogFile: null,
        };
        const finalState = { ...preparedState, videoFiles: [{ id: 912 }, { id: 913 }] };
        target.recordedDB.findId.mockResolvedValueOnce(preparedState).mockResolvedValueOnce(finalState);
        target.deleteExactRecordedResources = vi.fn(async () => undefined);

        const preparation = await target.prepareUserDeletion(preparedState.id);
        expect(preparation.status).toBe('prepared');
        await target.deletePrepared(preparation.token);

        expect(target.deleteExactRecordedResources).toHaveBeenCalledOnce();
        expect(target.deleteExactRecordedResources).toHaveBeenCalledWith(finalState);
        expect(target.recordingManageModel.cancel).not.toHaveBeenCalled();
    });

    it('[RC-8.6] chooses direct finished-file deletion before individual effects', async () => {
        const target = subject();
        const recordedId = 921;
        const directVideo = { id: 922, recordedId: 921, parentDirectoryName: 'main', filePath: 'direct.ts' };
        const siblingVideo = { id: 923, recordedId: 921, parentDirectoryName: 'main', filePath: 'sibling.ts' };
        target.videoFileDB.findId.mockResolvedValue(directVideo);
        target.recordedDB.findId.mockResolvedValue({
            id: recordedId,
            isProtected: false,
            isRecording: false,
            videoFiles: [directVideo, siblingVideo],
        });
        target.removeManagedFile = vi.fn(async () => 'removed');

        const preparation = await target.prepareVideoFileDeletion(directVideo.id);
        expect(preparation.status).toBe('prepared');
        await expect(target.deletePreparedVideoFile(preparation.token)).resolves.toEqual({
            status: 'video-file-deleted',
        });
        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledWith(directVideo.id);
        expect(target.recordedEvent.emitDeleteVideoFile).toHaveBeenCalledWith(directVideo.id);

        target.videoFileDB.deleteOnce.mockClear();
        target.recordedEvent.emitDeleteVideoFile.mockClear();
        target.recordedDB.findId.mockResolvedValue({
            id: recordedId,
            isProtected: false,
            isRecording: true,
            videoFiles: [directVideo],
        });
        await expect(target.prepareVideoFileDeletion(directVideo.id)).resolves.toEqual({
            status: 'whole-recorded-deletion-required',
            recordedId,
        });
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
    });

    it('returns storage not-deleted reasons without effects', async () => {
        const target = subject();
        const recordedId = 931;
        target.recordedDB.findId
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: recordedId, isProtected: true, isRecording: false, videoFiles: [] })
            .mockResolvedValueOnce({ id: recordedId, isProtected: false, isRecording: true, videoFiles: [] })
            .mockResolvedValueOnce({ id: recordedId, isProtected: false, isRecording: false, videoFiles: [] })
            .mockResolvedValueOnce({
                id: recordedId,
                isProtected: false,
                isRecording: false,
                videoFiles: [{ id: 932, parentDirectoryName: 'other' }],
            });

        await expect(target.prepareStorageDeletion(recordedId, 'main')).resolves.toEqual({
            status: 'not-deleted',
            reason: 'recorded-not-found',
        });
        await expect(target.prepareStorageDeletion(recordedId, 'main')).resolves.toEqual({
            status: 'not-deleted',
            reason: 'protected',
        });
        await expect(target.prepareStorageDeletion(recordedId, 'main')).resolves.toEqual({
            status: 'not-deleted',
            reason: 'recording-active',
        });
        await expect(target.prepareStorageDeletion(recordedId, 'main')).resolves.toEqual({
            status: 'not-deleted',
            reason: 'no-video-relations',
        });
        await expect(target.prepareStorageDeletion(recordedId, 'main')).resolves.toEqual({
            status: 'not-deleted',
            reason: 'storage-mismatch',
        });
        expect(target.recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();
    });

    it('deletes eligible storage content from the final exact snapshot', async () => {
        const target = subject();
        const recordedId = 933;
        const preparedState = {
            id: recordedId,
            isProtected: false,
            isRecording: false,
            videoFiles: [{ id: 934, parentDirectoryName: 'main' }],
        };
        const finalState = {
            ...preparedState,
            videoFiles: [...preparedState.videoFiles, { id: 935, parentDirectoryName: 'main' }],
        };
        target.recordedDB.findId.mockResolvedValueOnce(preparedState).mockResolvedValueOnce(finalState);
        target.deleteExactRecordedResources = vi.fn(async () => undefined);

        const preparation = await target.prepareStorageDeletion(recordedId, 'main');
        expect(preparation.status).toBe('prepared');
        await expect(target.deletePreparedForStorage(preparation.token)).resolves.toBe('deleted');

        expect(target.deleteExactRecordedResources).toHaveBeenCalledOnce();
        expect(target.deleteExactRecordedResources).toHaveBeenCalledWith(finalState);
    });

    it('rechecks missing and protected parents before individual effects', async () => {
        const missingTarget = subject();
        const missingVideo = { id: 936, recordedId: 937 };
        missingTarget.videoFileDB.findId.mockResolvedValue(missingVideo);
        missingTarget.recordedDB.findId.mockResolvedValue(null);
        await expect(missingTarget.prepareVideoFileDeletion(missingVideo.id)).resolves.toEqual({
            status: 'not-found',
        });

        const protectedTarget = subject();
        const protectedVideo = { id: 938, recordedId: 939 };
        protectedTarget.videoFileDB.findId.mockResolvedValue(protectedVideo);
        protectedTarget.recordedDB.findId.mockResolvedValue({
            id: protectedVideo.recordedId,
            isProtected: true,
            isRecording: false,
            videoFiles: [protectedVideo, { id: 940 }],
        });
        await expect(protectedTarget.prepareVideoFileDeletion(protectedVideo.id)).resolves.toEqual({
            status: 'protected',
        });
        expect(protectedTarget.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(protectedTarget.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
    });

    it('refuses an individual snapshot whose parent relation no longer contains the target', async () => {
        const target = subject();
        const video = { id: 944, recordedId: 945 };
        target.videoFileDB.findId.mockResolvedValue(video);
        target.recordedDB.findId.mockResolvedValue({
            id: video.recordedId,
            isProtected: false,
            isRecording: false,
            videoFiles: [{ id: 946 }, { id: 947 }],
        });

        await expect(target.prepareVideoFileDeletion(video.id)).resolves.toEqual({ status: 'not-found' });
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
    });

    it('[RC-8.4] attempts each exact video, thumbnail, and drop-log file removal for a whole recorded deletion', async () => {
        const target = subject();
        target.removeManagedFile = vi.fn(async () => 'removed');
        const recorded = {
            dropLogFile: { filePath: 'synthetic-drop.log', id: 961 },
            id: 960,
            thumbnails: [{ filePath: 'synthetic-thumbnail.jpg', id: 962 }],
            videoFiles: [{ filePath: 'nested/synthetic-video.ts', id: 963, parentDirectoryName: 'main' }],
        };
        target.config = {
            dropLog: 'synthetic-drop-root',
            recorded: [{ name: 'main', path: 'synthetic-root' }],
            thumbnail: 'synthetic-thumbnail-root',
        };

        await target.removeRecordedFiles(recorded);

        expect(target.removeManagedFile.mock.calls).toEqual([
            ['synthetic-root', 'nested/synthetic-video.ts'],
            ['synthetic-thumbnail-root', 'synthetic-thumbnail.jpg'],
            ['synthetic-drop-root', 'synthetic-drop.log'],
        ]);
    });

    it('[RC-8.5] deletes only the exact video, thumbnail, drop-log, and recorded database rows after file settlement', async () => {
        const target = subject();
        target.removeManagedFile = vi.fn(async () => 'removed');
        const recorded = {
            dropLogFile: { filePath: 'synthetic-drop.log', id: 972 },
            id: 970,
            thumbnails: [{ filePath: 'synthetic-thumbnail.jpg', id: 973 }],
            videoFiles: [{ filePath: 'synthetic-video.ts', id: 971, parentDirectoryName: 'main' }],
        };

        await target.deleteExactRecordedResources(recorded);

        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledWith(971);
        expect(target.thumbnailDB.deleteOnce).toHaveBeenCalledWith(973);
        expect(target.recordedDB.deleteOnce).toHaveBeenCalledWith(970);
        expect(target.dropLogFileDB.deleteOnce).toHaveBeenCalledWith(972);
        expect(target.recordedEvent.emitDeleteRecorded).toHaveBeenCalledWith(recorded);
    });

    it('[RC-8.7] routes a recording video-file request to whole-recorded deletion without individual file effects', async () => {
        const target = subject();
        const recordedId = 981;
        const videoFileId = 982;
        target.videoFileDB.findId.mockResolvedValue({ id: videoFileId, recordedId });
        target.recordedDB.findId.mockResolvedValue({
            id: recordedId,
            isProtected: false,
            isRecording: true,
            videoFiles: [{ id: videoFileId }],
        });
        target.delete = vi.fn(async () => undefined);

        await target.deleteVideoFile(videoFileId);

        expect(target.delete).toHaveBeenCalledWith(recordedId, false);
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.videoUtil.getFullFilePathFromId).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
    });

    it('[RC-8.8] routes the exact parent to whole-recorded deletion after individual removal leaves no files', async () => {
        const target = subject();
        const recordedId = 991;
        const videoFileId = 992;
        target.config.recorded = [{ name: 'main', path: 'synthetic-storage' }];
        target.videoFileDB.findId.mockResolvedValue({
            id: videoFileId,
            recordedId,
            parentDirectoryName: 'main',
            filePath: 'synthetic-last.ts',
        });
        target.recordedDB.findId
            .mockResolvedValueOnce({
                id: recordedId,
                isProtected: false,
                isRecording: false,
                videoFiles: [{ id: videoFileId }],
            })
            .mockResolvedValueOnce({ id: recordedId, isProtected: false, isRecording: false, videoFiles: [] });
        target.removeManagedFile = vi.fn(async () => 'removed');
        target.delete = vi.fn(async () => undefined);

        await target.deleteVideoFile(videoFileId);

        expect(target.removeManagedFile.mock.calls).toEqual([['synthetic-storage', 'synthetic-last.ts']]);
        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledWith(videoFileId);
        expect(target.delete).toHaveBeenCalledWith(recordedId, false);
        expect(target.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
    });

    it('[RC-8.10] refuses root escapes and symbolic-link parent failures before any unlink attempt', async () => {
        const target = subject();
        target.uploadFileSystem = { realpath: vi.fn(async () => 'synthetic-root') };
        target.openPinnedDeletionParent = vi.fn(async () => {
            throw new Error('UploadPathError');
        });
        const unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);

        await expect(target.removeManagedFile('synthetic-root', '../synthetic-outside.ts')).resolves.toBe(
            'unsafe-path',
        );
        await expect(target.removeManagedFile('synthetic-root', 'linked/synthetic.ts')).resolves.toBe('unsafe-path');

        expect(target.openPinnedDeletionParent).toHaveBeenCalledTimes(1);
        expect(unlink).not.toHaveBeenCalled();
    });

    it('[RC-8.10] deletes a registered path with a leading separator inside the root and refuses one that leaves it', async () => {
        const target = subject();
        target.uploadPlatform = 'linux';
        const parent = { descriptorPath: '/proc/self/fd/77', close: vi.fn(async () => undefined) };
        target.uploadFileSystem = { realpath: vi.fn(async () => 'synthetic-root') };
        target.openPinnedDeletionParent = vi.fn(async () => parent);
        const unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);

        await expect(target.removeManagedFile('synthetic-root', '/anime/synthetic.ts')).resolves.toBe('removed');
        expect(target.openPinnedDeletionParent).toHaveBeenCalledWith(expect.stringMatching(/synthetic-root$/), 'anime');
        expect(unlink).toHaveBeenCalledWith('/proc/self/fd/77/synthetic.ts');

        unlink.mockClear();
        target.openPinnedDeletionParent.mockClear();
        await expect(target.removeManagedFile('synthetic-root', '/../synthetic-outside.ts')).resolves.toBe(
            'unsafe-path',
        );
        expect(target.openPinnedDeletionParent).not.toHaveBeenCalled();
        expect(unlink).not.toHaveBeenCalled();
    });

    describe('[RC-8.10] cleanup-path deletion', () => {
        const cleanupSubject = () => {
            const target = subject();
            target.thumbnailDB = { deleteRecordedId: vi.fn(async () => undefined) };
            target.videoFileDB.deleteRecordedId.mockResolvedValue(undefined);
            target.config = {
                recorded: [{ name: 'main', path: 'synthetic-main-root' }],
                recordedTmp: 'synthetic-tmp-root',
                thumbnail: 'synthetic-thumbnail-root',
                dropLog: 'synthetic-drop-log-root',
            };
            target.videoUtil = {
                getFullFilePathFromId: vi.fn(async () => 'synthetic-unmanaged/direct.ts'),
                getParentDirPath: vi.fn((name: string) =>
                    name === 'tmp' ? 'synthetic-tmp-root' : name === 'main' ? 'synthetic-main-root' : null,
                ),
            };
            target.removeManagedFile = vi.fn(async () => 'removed');
            return target;
        };

        it('routes every file of the legacy whole deletion through managed removal under its own root', async () => {
            const target = cleanupSubject();
            const unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);
            target.recordedDB.findId.mockResolvedValue({
                id: 1001,
                isProtected: false,
                isRecording: false,
                reserveId: null,
                videoFiles: [
                    { id: 1002, parentDirectoryName: 'main', filePath: 'nested/main.ts' },
                    { id: 1003, parentDirectoryName: 'tmp', filePath: 'remaining.ts' },
                    { id: 1004, parentDirectoryName: 'unconfigured', filePath: 'unknown.ts' },
                ],
                thumbnails: [{ id: 1005, filePath: 'thumb.jpg' }],
                dropLogFile: { id: 1006, filePath: 'drop.log' },
            });

            await expect(target.delete(1001)).resolves.toBeUndefined();

            expect(target.removeManagedFile.mock.calls).toEqual([
                ['synthetic-thumbnail-root', 'thumb.jpg'],
                ['synthetic-main-root', 'nested/main.ts'],
                ['synthetic-tmp-root', 'remaining.ts'],
                [undefined, 'unknown.ts'],
                ['synthetic-drop-log-root', 'drop.log'],
            ]);
            expect(unlink).not.toHaveBeenCalled();
            expect(target.recordedDB.deleteOnce).toHaveBeenCalledWith(1001);
        });

        it('routes the legacy individual deletion through managed removal under the recorded temporary root', async () => {
            const target = cleanupSubject();
            const unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);
            target.videoFileDB.findId.mockResolvedValue({
                id: 1012,
                recordedId: 1011,
                parentDirectoryName: 'tmp',
                filePath: 'remaining.ts',
            });
            target.recordedDB.findId
                .mockResolvedValueOnce({
                    id: 1011,
                    isProtected: false,
                    isRecording: false,
                    videoFiles: [{ id: 1012 }, { id: 1013 }],
                })
                .mockResolvedValueOnce({
                    id: 1011,
                    isProtected: false,
                    isRecording: false,
                    videoFiles: [{ id: 1013 }],
                });

            await expect(target.deleteVideoFile(1012)).resolves.toBeUndefined();

            expect(target.removeManagedFile.mock.calls).toEqual([['synthetic-tmp-root', 'remaining.ts']]);
            expect(unlink).not.toHaveBeenCalled();
            expect(target.videoFileDB.deleteOnce).toHaveBeenCalledWith(1012);
            expect(target.recordedEvent.emitDeleteVideoFile).toHaveBeenCalledWith(1012);
        });

        it('still removes the registration of a missing file whose path is refused', async () => {
            const target = cleanupSubject();
            target.removeManagedFile = vi.fn(async () => 'unsafe-path');
            target.videoFileDB.findId.mockResolvedValue({
                id: 1022,
                recordedId: 1021,
                parentDirectoryName: 'main',
                filePath: '../outside.ts',
            });
            target.recordedDB.findId
                .mockResolvedValueOnce({
                    id: 1021,
                    isProtected: false,
                    isRecording: false,
                    videoFiles: [{ id: 1022 }, { id: 1023 }],
                })
                .mockResolvedValueOnce({
                    id: 1021,
                    isProtected: false,
                    isRecording: false,
                    videoFiles: [{ id: 1023 }],
                });

            await expect(target.deleteVideoFile(1022)).resolves.toBeUndefined();

            expect(target.removeManagedFile).toHaveBeenCalledWith('synthetic-main-root', '../outside.ts');
            expect(target.videoFileDB.deleteOnce).toHaveBeenCalledWith(1022);
        });
    });
});
