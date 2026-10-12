import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join, posix, win32 } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
// Windows の drive 付き path は、文字と `:` を別の値にして組み立てる（保存先らしい絶対 path の literal を file に書かない）。
const winDrive = 'C:';
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
const RecordedManageModel = load<{ prototype: Record<string, unknown> }>(
    'model/operator/recorded/RecordedManageModel.js',
);
const PreparedDeletionTokenRegistry = load<
    new () => {
        prepare(kind: string, value: unknown): object;
        consume(
            kind: string,
            token: object,
        ): { type: 'consumed'; value: unknown } | { type: 'token-replayed' } | { type: 'token-stale' };
    }
>('model/operator/recorded/PreparedDeletionTokenRegistry.js');
const RecordedResourceMutationLock = load<
    new () => {
        runExclusive<T>(recordedId: number, operation: () => T | Promise<T>): Promise<T>;
    }
>('model/operator/recorded/RecordedResourceMutationLock.js');
const VideoUtil = load<{ prototype: object }>('model/api/video/VideoUtil.js');
const FileUtil = require(join(snapshot, 'util', 'FileUtil.js')).default;

afterEach(() => vi.restoreAllMocks());

/** 実装の`VideoUtil.getParentDirPath`を、`owner.config`をそのまま見る形で使う。 */
const videoUtilReadingConfig = (owner: { config: unknown }) =>
    Object.assign(Object.create(VideoUtil.prototype, { config: { get: () => owner.config } }), {
        getFullFilePathFromId: vi.fn(),
    });

const subject = () => {
    const value: any = Object.create(RecordedManageModel.prototype);
    value.log = { system: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    value.recordedDB = { findId: vi.fn() };
    value.videoFileDB = {
        findId: vi.fn(),
        deleteOnce: vi.fn(async () => undefined),
        deleteRecordedId: vi.fn(),
    };
    value.config = { recorded: [] };
    value.videoUtil = videoUtilReadingConfig(value);
    value.recordedEvent = { emitDeleteVideoFile: vi.fn() };
    return value;
};

const deletionCoreSubject = () => {
    const value = subject();
    // 固定した親のfile descriptor経由のpath（`/proc/self/fd/<n>`）を前提にするため、実行hostに依らずLinuxの経路に固定する。
    value.uploadPlatform = 'linux';
    value.thumbnailDB = { deleteOnce: vi.fn(async () => undefined) };
    value.dropLogFileDB = { deleteOnce: vi.fn(async () => undefined) };
    value.recordedDB.deleteOnce = vi.fn(async () => undefined);
    value.recordedEvent.emitDeleteRecorded = vi.fn();
    value.config = {
        recorded: [{ name: 'main', path: 'synthetic-recorded-root' }],
        recordedTmp: 'synthetic-tmp-root',
        thumbnail: 'synthetic-thumbnail-root',
        dropLog: 'synthetic-drop-log-root',
    };
    return value;
};

/**
 * Legacy public `RecordedManageModel.delete()` harness.
 * Runtime user deletion goes through ParentUserDeletionCoordinator + prepared ports;
 * these cases characterize residual edges of the legacy direct method only.
 */
const legacyPublicDeleteSubject = () => {
    const value: any = Object.create(RecordedManageModel.prototype);
    value.log = { system: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    value.recordedDB = { findId: vi.fn(), deleteOnce: vi.fn(async () => undefined) };
    value.videoFileDB = {
        findId: vi.fn(),
        deleteOnce: vi.fn(async () => undefined),
        deleteRecordedId: vi.fn(async () => undefined),
    };
    value.thumbnailDB = {
        deleteOnce: vi.fn(async () => undefined),
        deleteRecordedId: vi.fn(async () => undefined),
    };
    value.dropLogFileDB = { deleteOnce: vi.fn(async () => undefined) };
    value.videoUtil = videoUtilReadingConfig(value);
    value.recordedEvent = { emitDeleteRecorded: vi.fn(), emitDeleteVideoFile: vi.fn() };
    value.recordingManageModel = { hasReserve: vi.fn(), cancel: vi.fn() };
    value.config = {
        recorded: [],
        thumbnail: 'synthetic-thumbnail',
        dropLog: 'synthetic-drop-log',
    };
    return value;
};

interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly reject: (reason?: unknown) => void;
    readonly resolve: (value: T | PromiseLike<T>) => void;
}

const deferred = <T>(): Deferred<T> => {
    let reject!: Deferred<T>['reject'];
    let resolve!: Deferred<T>['resolve'];
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        reject = rejectPromise;
        resolve = resolvePromise;
    });
    return { promise, reject, resolve };
};

describe('legacy public RecordedManageModel.delete residual edges (unittest/imp)', () => {
    it('awaits active recording cancel as a barrier before any delete cleanup effects', async () => {
        const target = legacyPublicDeleteSubject();
        const recordedId = 831;
        const reserveId = 832;
        const recorded = {
            id: recordedId,
            isProtected: false,
            isRecording: true,
            reserveId,
            videoFiles: [],
            thumbnails: [],
            dropLogFile: null,
        };
        target.recordedDB.findId.mockResolvedValue(recorded);
        target.recordingManageModel.hasReserve.mockReturnValue(true);
        const cancel = deferred<void>();
        target.recordingManageModel.cancel.mockReturnValue(cancel.promise);

        const pendingDelete = target.delete(recordedId, false);

        await vi.waitFor(() => {
            expect(target.recordingManageModel.cancel).toHaveBeenCalledOnce();
        });
        expect(target.recordingManageModel.hasReserve).toHaveBeenCalledWith(reserveId);
        expect(target.recordingManageModel.cancel).toHaveBeenCalledWith(reserveId, true);
        expect(target.log.system.info).toHaveBeenCalledWith(
            `cancel recording by recorded manager reserveId: ${reserveId} recordedId: ${recordedId}`,
        );
        // cancel still pending → no DB / emission effects yet
        expect(target.recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.videoFileDB.deleteRecordedId).not.toHaveBeenCalled();
        expect(target.thumbnailDB.deleteRecordedId).not.toHaveBeenCalled();
        expect(target.dropLogFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();

        cancel.resolve(undefined);
        await expect(pendingDelete).resolves.toBeUndefined();

        expect(target.recordedDB.deleteOnce).toHaveBeenCalledWith(recordedId);
        expect(target.recordedEvent.emitDeleteRecorded).toHaveBeenCalledWith(recorded);
    });

    it('does not cancel recording when ignore-protection is true or reserve is absent from the manager', async () => {
        const ignoreTarget = legacyPublicDeleteSubject();
        const reserveId = 842;
        ignoreTarget.recordedDB.findId.mockResolvedValue({
            id: 841,
            isProtected: false,
            isRecording: true,
            reserveId,
            videoFiles: [],
            thumbnails: [],
            dropLogFile: null,
        });
        ignoreTarget.recordingManageModel.hasReserve.mockReturnValue(true);

        await expect(ignoreTarget.delete(841, true)).resolves.toBeUndefined();
        expect(ignoreTarget.recordingManageModel.hasReserve).not.toHaveBeenCalled();
        expect(ignoreTarget.recordingManageModel.cancel).not.toHaveBeenCalled();

        const absentTarget = legacyPublicDeleteSubject();
        absentTarget.recordedDB.findId.mockResolvedValue({
            id: 843,
            isProtected: false,
            isRecording: true,
            reserveId: 844,
            videoFiles: [],
            thumbnails: [],
            dropLogFile: null,
        });
        absentTarget.recordingManageModel.hasReserve.mockReturnValue(false);

        await expect(absentTarget.delete(843, false)).resolves.toBeUndefined();
        expect(absentTarget.recordingManageModel.hasReserve).toHaveBeenCalledWith(844);
        expect(absentTarget.recordingManageModel.cancel).not.toHaveBeenCalled();
    });

    it('contains public delete file and path failures without aborting later cleanup or emission', async () => {
        const target = legacyPublicDeleteSubject();
        const recordedId = 851;
        const thumbnailFile = 'synthetic-thumb-fail.jpg';
        const dropLogFileName = 'synthetic-drop-fail.log';
        target.config.recorded = [{ name: 'main', path: 'synthetic-storage' }];
        const recorded = {
            id: recordedId,
            isProtected: false,
            isRecording: false,
            reserveId: null,
            videoFiles: [
                { id: 852, parentDirectoryName: 'unconfigured', filePath: 'refused.ts' },
                { id: 853, parentDirectoryName: 'main', filePath: 'failed.ts' },
                { id: 854, parentDirectoryName: 'main', filePath: 'ok.ts' },
            ],
            thumbnails: [{ id: 855, filePath: thumbnailFile }],
            dropLogFile: { id: 856, filePath: dropLogFileName },
        };
        target.recordedDB.findId.mockResolvedValue(recorded);
        const results: Record<string, string> = {
            [thumbnailFile]: 'unlink-attempt-failed',
            'refused.ts': 'unsafe-path',
            'failed.ts': 'unlink-attempt-failed',
            'ok.ts': 'removed',
            [dropLogFileName]: 'unsafe-path',
        };
        target.removeManagedFile = vi.fn(
            async (_root: string | undefined, relativePath: string) => results[relativePath],
        );
        const unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);

        await expect(target.delete(recordedId)).resolves.toBeUndefined();

        expect(target.removeManagedFile.mock.calls).toEqual([
            [target.config.thumbnail, thumbnailFile],
            [undefined, 'refused.ts'],
            ['synthetic-storage', 'failed.ts'],
            ['synthetic-storage', 'ok.ts'],
            [target.config.dropLog, dropLogFileName],
        ]);
        expect(unlink).not.toHaveBeenCalled();
        expect(target.thumbnailDB.deleteRecordedId).toHaveBeenCalledWith(recordedId);
        expect(target.videoFileDB.deleteRecordedId).toHaveBeenCalledWith(recordedId);
        expect(target.recordedDB.deleteOnce).toHaveBeenCalledWith(recordedId);
        expect(target.dropLogFileDB.deleteOnce).toHaveBeenCalledWith(856);
        expect(target.recordedEvent.emitDeleteRecorded).toHaveBeenCalledWith(recorded);
    });

    it('completes public delete without awaiting thumbnail DB deletion and logs late rejection', async () => {
        const target = legacyPublicDeleteSubject();
        const recordedId = 861;
        const dropLogId = 864;
        const recorded = {
            id: recordedId,
            isProtected: false,
            isRecording: false,
            reserveId: null,
            videoFiles: [{ id: 862, parentDirectoryName: 'main', filePath: 'db-video.ts' }],
            thumbnails: [{ id: 863, filePath: 'synthetic-thumb-db.jpg' }],
            dropLogFile: { id: dropLogId, filePath: 'synthetic-drop-db.log' },
        };
        target.recordedDB.findId.mockResolvedValue(recorded);
        target.removeManagedFile = vi.fn(async () => 'removed');

        const thumbDbError = new Error('synthetic thumbnail db failure');
        const videoDbError = new Error('synthetic video db failure');
        const recordedDbError = new Error('synthetic recorded db failure');
        const dropDbError = new Error('synthetic drop-log db failure');
        const thumbnailDelete = deferred<void>();
        target.thumbnailDB.deleteRecordedId = vi.fn(() => thumbnailDelete.promise);
        target.videoFileDB.deleteRecordedId = vi.fn(async () => {
            throw videoDbError;
        });
        target.recordedDB.deleteOnce.mockRejectedValue(recordedDbError);
        target.dropLogFileDB.deleteOnce.mockRejectedValue(dropDbError);

        // outer delete settles while thumbnail DB deletion is still pending
        await expect(target.delete(recordedId)).resolves.toBeUndefined();

        expect(target.thumbnailDB.deleteRecordedId).toHaveBeenCalledWith(recordedId);
        expect(target.videoFileDB.deleteRecordedId).toHaveBeenCalledWith(recordedId);
        expect(target.recordedDB.deleteOnce).toHaveBeenCalledWith(recordedId);
        expect(target.dropLogFileDB.deleteOnce).toHaveBeenCalledWith(dropLogId);
        expect(target.recordedEvent.emitDeleteRecorded).toHaveBeenCalledWith(recorded);
        expect(target.log.system.error).toHaveBeenCalledWith(`falied to delete video data: ${recordedId}`);
        expect(target.log.system.error).toHaveBeenCalledWith(videoDbError);
        expect(target.log.system.error).toHaveBeenCalledWith(`falied to delete recorded data: ${recordedId}`);
        expect(target.log.system.error).toHaveBeenCalledWith(recordedDbError);
        expect(target.log.system.error).toHaveBeenCalledWith(`failed to delete drop log data: ${dropLogId}`);
        expect(target.log.system.error).toHaveBeenCalledWith(dropDbError);
        // fire-and-forget thumbnail rejection has not settled yet
        expect(target.log.system.error).not.toHaveBeenCalledWith(`falied to delete thumbnail data: ${recordedId}`);
        expect(target.log.system.error).not.toHaveBeenCalledWith(thumbDbError);

        thumbnailDelete.reject(thumbDbError);
        await vi.waitFor(() => {
            expect(target.log.system.error).toHaveBeenCalledWith(`falied to delete thumbnail data: ${recordedId}`);
        });
        expect(target.log.system.error).toHaveBeenCalledWith(thumbDbError);
    });
});

describe('recorded deletion implementation characterization', () => {
    it('recording-protection-and-last-file-branches', async () => {
        const protectedTarget = subject();
        protectedTarget.videoFileDB.findId.mockResolvedValue({ id: 811, recordedId: 810 });
        protectedTarget.recordedDB.findId.mockResolvedValue({ id: 810, isProtected: true, isRecording: false });
        protectedTarget.removeManagedFile = vi.fn(async () => 'removed');

        await expect(protectedTarget.deleteVideoFile(811)).rejects.toThrow('RecordedIsProtected');
        expect(protectedTarget.removeManagedFile).not.toHaveBeenCalled();
        expect(protectedTarget.videoFileDB.deleteOnce).not.toHaveBeenCalled();

        const recordingTarget = subject();
        recordingTarget.videoFileDB.findId.mockResolvedValue({ id: 821, recordedId: 820 });
        recordingTarget.recordedDB.findId.mockResolvedValue({ id: 820, isProtected: false, isRecording: true });
        recordingTarget.delete = vi.fn(async () => undefined);
        recordingTarget.removeManagedFile = vi.fn(async () => 'removed');

        await recordingTarget.deleteVideoFile(821);
        expect(recordingTarget.removeManagedFile).not.toHaveBeenCalled();
        expect(recordingTarget.delete).toHaveBeenCalledWith(820, false);
        expect(recordingTarget.videoFileDB.deleteOnce).not.toHaveBeenCalled();

        const lastFileTarget = subject();
        lastFileTarget.config.recorded = [{ name: 'main', path: 'synthetic-storage' }];
        lastFileTarget.videoFileDB.findId.mockResolvedValue({
            id: 831,
            recordedId: 830,
            parentDirectoryName: 'main',
            filePath: 'last.ts',
        });
        lastFileTarget.recordedDB.findId
            .mockResolvedValueOnce({ id: 830, isProtected: false, isRecording: false, videoFiles: [{ id: 831 }] })
            .mockResolvedValueOnce({ id: 830, isProtected: false, isRecording: false, videoFiles: [] });
        lastFileTarget.delete = vi.fn(async () => undefined);
        lastFileTarget.removeManagedFile = vi.fn(async () => 'removed');

        await lastFileTarget.deleteVideoFile(831);
        expect(lastFileTarget.removeManagedFile.mock.calls).toEqual([['synthetic-storage', 'last.ts']]);
        expect(lastFileTarget.videoFileDB.deleteOnce).toHaveBeenCalledWith(831);
        expect(lastFileTarget.delete).toHaveBeenCalledWith(830, false);
        expect(lastFileTarget.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
    });

    it('[RC-8.7] escalates a recording video-file deletion to its exact whole recorded id', async () => {
        const target = subject();
        const recordingParentId = 821;
        const recordingVideoFileId = 822;
        target.videoFileDB.findId.mockResolvedValue({ id: recordingVideoFileId, recordedId: recordingParentId });
        target.recordedDB.findId.mockResolvedValue({
            id: recordingParentId,
            isProtected: false,
            isRecording: true,
            videoFiles: [{ id: recordingVideoFileId }],
        });
        target.delete = vi.fn(async () => undefined);
        target.removeManagedFile = vi.fn(async () => 'removed');

        await target.deleteVideoFile(recordingVideoFileId);

        expect(target.videoFileDB.findId).toHaveBeenCalledWith(recordingVideoFileId);
        expect(target.recordedDB.findId).toHaveBeenCalledWith(recordingParentId);
        expect(target.delete).toHaveBeenCalledOnce();
        expect(target.delete).toHaveBeenCalledWith(recordingParentId, false);
        expect(target.removeManagedFile).not.toHaveBeenCalled();
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
    });

    it('[RC-8.6/8.8] deletes only the requested finished file and retains a parent with one remaining file', async () => {
        const target = subject();
        const retainedParentId = 831;
        const deletedVideoFileId = 832;
        const remainingVideoFileId = 833;
        target.config.recorded = [{ name: 'main', path: 'synthetic-storage' }];
        target.videoFileDB.findId.mockResolvedValue({
            id: deletedVideoFileId,
            recordedId: retainedParentId,
            parentDirectoryName: 'main',
            filePath: 'deleted-video.ts',
        });
        target.recordedDB.findId
            .mockResolvedValueOnce({
                id: retainedParentId,
                isProtected: false,
                isRecording: false,
                videoFiles: [{ id: deletedVideoFileId }, { id: remainingVideoFileId }],
            })
            .mockResolvedValueOnce({
                id: retainedParentId,
                isProtected: false,
                isRecording: false,
                videoFiles: [{ id: remainingVideoFileId }],
            });
        target.delete = vi.fn(async () => undefined);
        target.removeManagedFile = vi.fn(async () => 'removed');

        await target.deleteVideoFile(deletedVideoFileId);

        expect(target.removeManagedFile.mock.calls).toEqual([['synthetic-storage', 'deleted-video.ts']]);
        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledOnce();
        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledWith(deletedVideoFileId);
        expect(target.recordedDB.findId).toHaveBeenNthCalledWith(2, retainedParentId);
        expect(target.delete).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteVideoFile).toHaveBeenCalledWith(deletedVideoFileId);
    });

    it('[RC-8.8] deletes the exact parent when individual deletion leaves zero files', async () => {
        const target = subject();
        const emptyParentId = 841;
        const lastVideoFileId = 842;
        target.config.recorded = [{ name: 'main', path: 'synthetic-storage' }];
        target.videoFileDB.findId.mockResolvedValue({
            id: lastVideoFileId,
            recordedId: emptyParentId,
            parentDirectoryName: 'main',
            filePath: 'last-video.ts',
        });
        target.recordedDB.findId
            .mockResolvedValueOnce({
                id: emptyParentId,
                isProtected: false,
                isRecording: false,
                videoFiles: [{ id: lastVideoFileId }],
            })
            .mockResolvedValueOnce({
                id: emptyParentId,
                isProtected: false,
                isRecording: false,
                videoFiles: [],
            });
        target.delete = vi.fn(async () => undefined);
        target.removeManagedFile = vi.fn(async () => 'removed');

        await target.deleteVideoFile(lastVideoFileId);

        expect(target.removeManagedFile.mock.calls).toEqual([['synthetic-storage', 'last-video.ts']]);
        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledOnce();
        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledWith(lastVideoFileId);
        expect(target.recordedDB.findId).toHaveBeenNthCalledWith(2, emptyParentId);
        expect(target.delete).toHaveBeenCalledOnce();
        expect(target.delete).toHaveBeenCalledWith(emptyParentId, false);
        expect(target.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
    });
});

describe('recorded exact deletion core', () => {
    it('closes an opened child descriptor when closing its parent descriptor fails', async () => {
        const target = deletionCoreSubject();
        const parentCloseFailure = new Error('synthetic parent close failure');
        const parent = {
            logicalPath: 'synthetic-root',
            descriptorPath: '/proc/self/fd/91',
            close: vi.fn(async () => Promise.reject(parentCloseFailure)),
        };
        const child = {
            logicalPath: 'synthetic-root/child',
            descriptorPath: '/proc/self/fd/92',
            close: vi.fn(async () => undefined),
        };
        target.openPinnedUploadDirectory = vi.fn().mockResolvedValueOnce(parent).mockResolvedValueOnce(child);

        await expect(target.openPinnedDeletionParent('synthetic-root', 'child')).rejects.toBe(parentCloseFailure);

        expect(parent.close).toHaveBeenCalledOnce();
        expect(child.close).toHaveBeenCalledOnce();
    });

    it('swallows a failed child close while propagating the parent close failure', async () => {
        const target = deletionCoreSubject();
        const parentCloseFailure = new Error('synthetic parent close failure');
        const childCloseFailure = new Error('synthetic child close failure');
        const parent = {
            logicalPath: 'synthetic-root',
            descriptorPath: '/proc/self/fd/93',
            close: vi.fn(async () => Promise.reject(parentCloseFailure)),
        };
        const child = {
            logicalPath: 'synthetic-root/child',
            descriptorPath: '/proc/self/fd/94',
            close: vi.fn(async () => Promise.reject(childCloseFailure)),
        };
        target.openPinnedUploadDirectory = vi.fn().mockResolvedValueOnce(parent).mockResolvedValueOnce(child);

        await expect(target.openPinnedDeletionParent('synthetic-root', 'child')).rejects.toBe(parentCloseFailure);

        expect(parent.close).toHaveBeenCalledOnce();
        expect(child.close).toHaveBeenCalledOnce();
    });

    it('swallows a failed close of the already-open parent when opening the next child fails', async () => {
        const target = deletionCoreSubject();
        const childOpenFailure = new Error('synthetic child open failure');
        const currentCloseFailure = new Error('synthetic current close failure');
        const current = {
            logicalPath: 'synthetic-root',
            descriptorPath: '/proc/self/fd/95',
            close: vi.fn(async () => Promise.reject(currentCloseFailure)),
        };
        target.openPinnedUploadDirectory = vi
            .fn()
            .mockResolvedValueOnce(current)
            .mockRejectedValueOnce(childOpenFailure);

        await expect(target.openPinnedDeletionParent('synthetic-root', 'child')).rejects.toBe(childOpenFailure);

        expect(current.close).toHaveBeenCalledOnce();
    });

    it('deletes exact relation ids without recorded-id bulk operations and settles every started DB mutation', async () => {
        const target = deletionCoreSubject();
        const recorded = {
            id: 851,
            isProtected: false,
            videoFiles: [
                { id: 852, parentDirectoryName: 'missing-storage', filePath: 'video-a.ts' },
                { id: 853, parentDirectoryName: 'missing-storage', filePath: 'video-b.ts' },
            ],
            thumbnails: [
                { id: 854, filePath: 'thumbnail-a.jpg' },
                { id: 855, filePath: 'thumbnail-b.jpg' },
            ],
            dropLogFile: { id: 856, filePath: 'drop.log' },
        };
        const settlements: Array<() => void> = [];
        target.videoFileDB.deleteOnce.mockImplementation(() => new Promise<void>(resolve => settlements.push(resolve)));
        target.thumbnailDB.deleteOnce.mockImplementation(() => new Promise<void>(resolve => settlements.push(resolve)));
        target.dropLogFileDB.deleteOnce.mockImplementation(
            () => new Promise<void>(resolve => settlements.push(resolve)),
        );

        const deletion = target.deleteExactRecordedResources(recorded);
        await vi.waitFor(() => expect(settlements).toHaveLength(4));
        expect(target.recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();

        for (const settle of [...settlements]) {
            settle();
        }
        await vi.waitFor(() => expect(settlements).toHaveLength(5));
        settlements[4]();
        await deletion;

        expect(target.videoFileDB.deleteOnce.mock.calls).toEqual([[852], [853]]);
        expect(target.thumbnailDB.deleteOnce.mock.calls).toEqual([[854], [855]]);
        expect(target.dropLogFileDB.deleteOnce).toHaveBeenCalledWith(856);
        expect(target.videoFileDB.deleteRecordedId).not.toHaveBeenCalled();
        expect(target.recordedDB.deleteOnce).toHaveBeenCalledWith(851);
        expect(target.recordedEvent.emitDeleteRecorded).toHaveBeenCalledWith(recorded);
    });

    it('attempts canonical deletion after an exact relation failure and rejects without notification', async () => {
        const target = deletionCoreSubject();
        const recorded = {
            id: 861,
            isProtected: false,
            videoFiles: [{ id: 862, parentDirectoryName: 'missing-storage', filePath: 'video.ts' }],
            thumbnails: [{ id: 863, filePath: 'thumbnail.jpg' }],
            dropLogFile: null,
        };
        target.videoFileDB.deleteOnce.mockRejectedValue(new Error('synthetic relation failure'));

        await expect(target.deleteExactRecordedResources(recorded)).rejects.toThrow('synthetic relation failure');

        expect(target.thumbnailDB.deleteOnce).toHaveBeenCalledWith(863);
        expect(target.recordedDB.deleteOnce).toHaveBeenCalledWith(861);
        expect(target.recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();
    });

    it('deletes a drop-log row only after its referencing canonical recorded row settles', async () => {
        const target = deletionCoreSubject();
        const recorded = {
            id: 864,
            isProtected: false,
            videoFiles: [],
            thumbnails: [],
            dropLogFile: { id: 865, filePath: 'drop.log' },
        };
        let settleCanonical!: () => void;
        target.recordedDB.deleteOnce.mockImplementationOnce(
            () =>
                new Promise<void>(resolve => {
                    settleCanonical = resolve;
                }),
        );

        const deletion = target.deleteExactRecordedResources(recorded);
        await vi.waitFor(() => expect(target.recordedDB.deleteOnce).toHaveBeenCalledWith(864));

        expect(target.dropLogFileDB.deleteOnce).not.toHaveBeenCalled();
        settleCanonical();
        await deletion;
        expect(target.dropLogFileDB.deleteOnce).toHaveBeenCalledWith(865);
        expect(target.recordedEvent.emitDeleteRecorded).toHaveBeenCalledWith(recorded);
    });

    it('skips drop-log deletion after canonical failure and reports drop-log deletion failure', async () => {
        const canonicalTarget = deletionCoreSubject();
        const canonicalFailure = new Error('synthetic canonical failure');
        canonicalTarget.recordedDB.deleteOnce.mockRejectedValue(canonicalFailure);
        canonicalTarget.removeManagedFile = vi.fn(async () => undefined);
        const fallbackSnapshot = {
            id: 866,
            videoFiles: undefined,
            thumbnails: undefined,
            dropLogFile: null,
        };
        await expect(canonicalTarget.deleteExactRecordedResources(fallbackSnapshot)).rejects.toBe(canonicalFailure);
        expect(canonicalTarget.removeManagedFile).not.toHaveBeenCalled();
        expect(canonicalTarget.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(canonicalTarget.thumbnailDB.deleteOnce).not.toHaveBeenCalled();

        const deletionSnapshot = {
            id: 866,
            videoFiles: [],
            thumbnails: [],
            dropLogFile: { id: 867, filePath: 'drop.log' },
        };

        await expect(canonicalTarget.deleteExactRecordedResources(deletionSnapshot)).rejects.toBe(canonicalFailure);
        expect(canonicalTarget.dropLogFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(canonicalTarget.recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();

        const dropLogTarget = deletionCoreSubject();
        const dropLogFailure = new Error('synthetic drop-log failure');
        dropLogTarget.dropLogFileDB.deleteOnce.mockRejectedValue(dropLogFailure);
        await expect(dropLogTarget.deleteExactRecordedResources(deletionSnapshot)).rejects.toBe(dropLogFailure);
        expect(dropLogTarget.recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();
    });

    it('routes every recorded file through its exact configured root', async () => {
        const target = deletionCoreSubject();
        target.config.recorded.push({ name: 'secondary', path: 'synthetic-secondary-root' });
        target.removeManagedFile = vi.fn(async () => undefined);
        const recorded = {
            videoFiles: [
                { parentDirectoryName: 'main', filePath: 'first.ts' },
                { parentDirectoryName: 'secondary', filePath: 'second.ts' },
            ],
            thumbnails: [{ filePath: 'thumbnail.jpg' }],
            dropLogFile: { filePath: 'drop.log' },
        };

        await target.removeRecordedFiles(recorded);

        expect(target.removeManagedFile.mock.calls).toEqual([
            ['synthetic-recorded-root', 'first.ts'],
            ['synthetic-secondary-root', 'second.ts'],
            ['synthetic-thumbnail-root', 'thumbnail.jpg'],
            ['synthetic-drop-log-root', 'drop.log'],
        ]);
    });

    it('routes a file left in the recorded temporary directory through the temporary root', async () => {
        const target = deletionCoreSubject();
        target.removeManagedFile = vi.fn(async () => undefined);
        const recorded = {
            videoFiles: [
                { parentDirectoryName: 'tmp', filePath: 'remaining.ts' },
                { parentDirectoryName: 'main', filePath: 'moved.ts' },
                { parentDirectoryName: 'unconfigured', filePath: 'unknown.ts' },
            ],
            thumbnails: [],
            dropLogFile: null,
        };

        await target.removeRecordedFiles(recorded);

        expect(target.removeManagedFile.mock.calls).toEqual([
            ['synthetic-tmp-root', 'remaining.ts'],
            ['synthetic-recorded-root', 'moved.ts'],
            [undefined, 'unknown.ts'],
        ]);
    });

    it('does not resolve the temporary root when none is configured', async () => {
        const target = deletionCoreSubject();
        delete target.config.recordedTmp;
        target.removeManagedFile = vi.fn(async () => undefined);

        await target.removeRecordedFiles({
            videoFiles: [{ parentDirectoryName: 'tmp', filePath: 'remaining.ts' }],
            thumbnails: [],
            dropLogFile: null,
        });

        expect(target.removeManagedFile.mock.calls).toEqual([[undefined, 'remaining.ts']]);
    });

    it('refuses missing, unresolved, root, and traversal deletion paths before unlink', async () => {
        const target = deletionCoreSubject();
        const resolveFailure = new Error('synthetic realpath failure');
        target.uploadFileSystem = Object.create(null);
        target.uploadFileSystem.realpath = vi.fn();
        target.openPinnedDeletionParent = vi.fn();

        await expect(target.removeManagedFile(undefined, 'missing.ts')).resolves.toBe('unsafe-path');
        expect(target.log.system.error).toHaveBeenNthCalledWith(
            1,
            'managed root is not found for deletion: missing.ts',
        );
        expect(target.uploadFileSystem.realpath).not.toHaveBeenCalled();

        target.uploadFileSystem.realpath.mockRejectedValueOnce(resolveFailure);
        await expect(target.removeManagedFile('synthetic-root', 'unresolved.ts')).resolves.toBe('unsafe-path');
        expect(target.log.system.error).toHaveBeenCalledWith('failed to resolve managed root: synthetic-root');
        expect(target.log.system.error).toHaveBeenCalledWith(resolveFailure);

        target.uploadFileSystem.realpath.mockResolvedValue('synthetic-root');
        for (const unsafePath of ['.', '..', '../outside.ts', '/', '//', '/../outside.ts', '/a/../../outside.ts']) {
            await expect(target.removeManagedFile('synthetic-root', unsafePath)).resolves.toBe('unsafe-path');
            expect(target.log.system.error).toHaveBeenCalledWith(`refused out-of-root deletion: ${unsafePath}`);
        }
        expect(target.openPinnedDeletionParent).not.toHaveBeenCalled();
    });

    it('resolves a registered path with leading separators relative to the root, like path.join(root, path)', async () => {
        const target = deletionCoreSubject();
        const parent = {
            descriptorPath: '/proc/self/fd/95',
            close: vi.fn(async () => undefined),
        };
        target.uploadFileSystem = Object.create(null);
        target.uploadFileSystem.realpath = vi.fn(async () => 'synthetic-root');
        target.openPinnedDeletionParent = vi.fn(async () => parent);
        const unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);

        await expect(target.removeManagedFile('synthetic-root', '/anime/nested/x.ts')).resolves.toBe('removed');
        await expect(target.removeManagedFile('synthetic-root', '//y.ts')).resolves.toBe('removed');

        expect(target.openPinnedDeletionParent.mock.calls).toEqual([
            [expect.stringMatching(/synthetic-root$/), 'anime/nested'],
            [expect.stringMatching(/synthetic-root$/), '.'],
        ]);
        expect(unlink.mock.calls).toEqual([['/proc/self/fd/95/x.ts'], ['/proc/self/fd/95/y.ts']]);
        expect(target.log.system.error).not.toHaveBeenCalled();
    });

    it('strips only the leading separators of the platform that runs the server', () => {
        const target = deletionCoreSubject();

        expect(target.stripLeadingSeparators('/anime/x.ts')).toBe('anime/x.ts');
        expect(target.stripLeadingSeparators('///anime/x.ts')).toBe('anime/x.ts');
        expect(target.stripLeadingSeparators('anime/x.ts')).toBe('anime/x.ts');
        expect(target.stripLeadingSeparators('/')).toBe('');
        expect(target.stripLeadingSeparators('\\anime/x.ts', posix)).toBe('\\anime/x.ts');
        expect(target.stripLeadingSeparators('\\anime\\x.ts', win32)).toBe('anime\\x.ts');
        expect(target.stripLeadingSeparators('/\\anime/x.ts', win32)).toBe('anime/x.ts');
        expect(target.stripLeadingSeparators('anime\\x.ts', win32)).toBe('anime\\x.ts');
        const driveFile = `${winDrive}\\anime\\x.ts`;
        expect(target.stripLeadingSeparators(driveFile, win32)).toBe(driveFile);
    });

    it('logs unsafe parent resolution and always closes a successfully pinned parent', async () => {
        const unsafeTarget = deletionCoreSubject();
        const unsafeFailure = new Error('synthetic unsafe parent');
        unsafeTarget.uploadFileSystem = Object.create(null);
        unsafeTarget.uploadFileSystem.realpath = vi.fn(async () => 'synthetic-root');
        unsafeTarget.openPinnedDeletionParent = vi.fn(async () => Promise.reject(unsafeFailure));

        await expect(unsafeTarget.removeManagedFile('synthetic-root', 'child/file.ts')).resolves.toBe('unsafe-path');
        expect(unsafeTarget.log.system.error).toHaveBeenCalledWith(
            expect.stringMatching(/refused unsafe deletion: .*synthetic-root\/child\/file\.ts$/),
        );
        expect(unsafeTarget.log.system.error).toHaveBeenCalledWith(unsafeFailure);

        const target = deletionCoreSubject();
        const unlinkFailure = new Error('synthetic unlink failure');
        const closeFailure = new Error('synthetic close failure');
        const parent = {
            descriptorPath: '/proc/self/fd/93',
            close: vi.fn(async () => Promise.reject(closeFailure)),
        };
        target.uploadFileSystem = Object.create(null);
        target.uploadFileSystem.realpath = vi.fn(async () => 'synthetic-root');
        target.openPinnedDeletionParent = vi.fn(async () => parent);
        const unlink = vi.spyOn(FileUtil, 'unlink').mockRejectedValue(unlinkFailure);

        await expect(target.removeManagedFile('synthetic-root', 'child/file.ts')).resolves.toBe(
            'unlink-attempt-failed',
        );

        expect(target.log.system.info).toHaveBeenCalledWith(
            expect.stringMatching(/delete: .*synthetic-root\/child\/file\.ts$/),
        );
        expect(unlink).toHaveBeenCalledWith('/proc/self/fd/93/file.ts');
        expect(target.log.system.error).toHaveBeenCalledWith(
            expect.stringMatching(/failed to delete .*synthetic-root\/child\/file\.ts$/),
        );
        expect(target.log.system.error).toHaveBeenCalledWith(unlinkFailure);
        expect(parent.close).toHaveBeenCalledOnce();
        expect(target.log.system.error).toHaveBeenCalledWith(
            expect.stringMatching(/failed to close deletion parent: .*synthetic-root\/child\/file\.ts$/),
        );
        expect(target.log.system.error).toHaveBeenCalledWith(closeFailure);
    });

    it('returns removed only after unlink succeeds and still closes the pinned parent', async () => {
        const target = deletionCoreSubject();
        const parent = {
            descriptorPath: '/proc/self/fd/94',
            close: vi.fn(async () => undefined),
        };
        target.uploadFileSystem = Object.create(null);
        target.uploadFileSystem.realpath = vi.fn(async () => 'synthetic-root');
        target.openPinnedDeletionParent = vi.fn(async () => parent);
        const unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);

        await expect(target.removeManagedFile('synthetic-root', 'child/file.ts')).resolves.toBe('removed');

        expect(unlink).toHaveBeenCalledOnce();
        expect(unlink).toHaveBeenCalledWith('/proc/self/fd/94/file.ts');
        expect(parent.close).toHaveBeenCalledOnce();
    });
});

describe('prepared deletion token registry', () => {
    it('consumes one opaque token once and rejects concurrent and later replay', () => {
        const registry = new PreparedDeletionTokenRegistry();
        const token = registry.prepare('recorded', { recordedId: 881 });

        expect(Object.keys(token)).toEqual([]);
        expect(Object.isFrozen(token)).toBe(true);
        expect(registry.consume('recorded', token)).toEqual({ type: 'consumed', value: { recordedId: 881 } });
        expect(registry.consume('recorded', token)).toEqual({ type: 'token-replayed' });
        expect(registry.consume('recorded', token)).toEqual({ type: 'token-replayed' });
    });

    it('rejects unknown, other-instance, and wrong-kind tokens as stale before effects', () => {
        const registry = new PreparedDeletionTokenRegistry();
        const otherRegistry = new PreparedDeletionTokenRegistry();
        const token = registry.prepare('video-file', { videoFileId: 882 });
        const effect = vi.fn();

        for (const result of [
            registry.consume('recorded', token),
            otherRegistry.consume('video-file', token),
            registry.consume('video-file', Object.freeze({})),
        ]) {
            if (result.type === 'consumed') {
                effect();
            }
            expect(result).toEqual({ type: 'token-stale' });
        }
        expect(effect).not.toHaveBeenCalled();
        expect(registry.consume('video-file', token)).toEqual({
            type: 'consumed',
            value: { videoFileId: 882 },
        });
    });

    it('does not reactivate a consumed token after synchronous throw or rejection', async () => {
        const registry = new PreparedDeletionTokenRegistry();
        const syncToken = registry.prepare('storage', { recordedId: 883 });
        const asyncToken = registry.prepare('storage', { recordedId: 884 });

        const run = async (token: object, operation: () => unknown): Promise<void> => {
            const result = registry.consume('storage', token);
            if (result.type !== 'consumed') {
                throw new Error(result.type);
            }
            await operation();
        };

        await expect(
            run(syncToken, () => {
                throw new Error('synthetic sync failure');
            }),
        ).rejects.toThrow('synthetic sync failure');
        await expect(run(asyncToken, async () => Promise.reject(new Error('synthetic rejection')))).rejects.toThrow(
            'synthetic rejection',
        );
        expect(registry.consume('storage', syncToken)).toEqual({ type: 'token-replayed' });
        expect(registry.consume('storage', asyncToken)).toEqual({ type: 'token-replayed' });
    });

    it('keeps active and consumed tokens only in weak registries without timers', () => {
        vi.useFakeTimers();
        try {
            const registry = new PreparedDeletionTokenRegistry();
            const token = registry.prepare('recorded', { recordedId: 885 });
            const registryView = registry as unknown as {
                registries: Map<string, { active: unknown; consumed: unknown }>;
            };
            const recordedRegistry = registryView.registries.get('recorded');

            expect(vi.getTimerCount()).toBe(0);
            expect(recordedRegistry?.active).toBeInstanceOf(WeakMap);
            expect(recordedRegistry?.consumed).toBeInstanceOf(WeakSet);
            expect(registry.consume('recorded', token).type).toBe('consumed');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('recorded resource mutation lock', () => {
    it('runs the same recorded id in FIFO order and removes its final entry', async () => {
        const lock = new RecordedResourceMutationLock();
        const order: string[] = [];
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>(resolve => {
            releaseFirst = resolve;
        });

        const first = lock.runExclusive(891, async () => {
            order.push('first:start');
            await firstGate;
            order.push('first:end');
        });
        const second = lock.runExclusive(891, async () => {
            order.push('second:start');
            order.push('second:end');
        });
        await vi.waitFor(() => expect(order).toEqual(['first:start']));

        releaseFirst();
        await Promise.all([first, second]);

        expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
        expect((lock as unknown as { tails: Map<number, unknown> }).tails.size).toBe(0);
    });

    it('runs different recorded ids in parallel', async () => {
        const lock = new RecordedResourceMutationLock();
        const started: number[] = [];
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const operations = [891, 892].map(recordedId =>
            lock.runExclusive(recordedId, async () => {
                started.push(recordedId);
                await gate;
            }),
        );

        await vi.waitFor(() => expect(started).toEqual([891, 892]));
        release();
        await Promise.all(operations);

        expect((lock as unknown as { tails: Map<number, unknown> }).tails.size).toBe(0);
    });

    it('keeps the newest tail registered while an earlier same-id operation releases', async () => {
        const lock = new RecordedResourceMutationLock();
        let releaseFirst!: () => void;
        let releaseSecond!: () => void;
        const firstGate = new Promise<void>(resolve => {
            releaseFirst = resolve;
        });
        const secondGate = new Promise<void>(resolve => {
            releaseSecond = resolve;
        });
        const started: string[] = [];

        const first = lock.runExclusive(895, async () => {
            started.push('first');
            await firstGate;
        });
        const second = lock.runExclusive(895, async () => {
            started.push('second');
            await secondGate;
        });
        const third = lock.runExclusive(895, () => {
            started.push('third');
        });

        await vi.waitFor(() => expect(started).toEqual(['first']));
        releaseFirst();
        await first;
        await vi.waitFor(() => expect(started).toEqual(['first', 'second']));
        expect((lock as unknown as { tails: Map<number, unknown> }).tails.has(895)).toBe(true);

        releaseSecond();
        await Promise.all([second, third]);
        expect(started).toEqual(['first', 'second', 'third']);
        expect((lock as unknown as { tails: Map<number, unknown> }).tails.size).toBe(0);
    });

    it('releases a waiting id after a synchronous throw and a rejection', async () => {
        const lock = new RecordedResourceMutationLock();
        const order: string[] = [];
        const syncFailure = lock.runExclusive(893, () => {
            order.push('sync');
            throw new Error('synthetic sync failure');
        });
        const rejection = lock.runExclusive(893, async () => {
            order.push('rejection');
            throw new Error('synthetic rejection');
        });
        const success = lock.runExclusive(893, () => {
            order.push('success');
            return { type: 'not-deleted' as const };
        });

        await expect(syncFailure).rejects.toThrow('synthetic sync failure');
        await expect(rejection).rejects.toThrow('synthetic rejection');
        await expect(success).resolves.toEqual({ type: 'not-deleted' });
        expect(order).toEqual(['sync', 'rejection', 'success']);
        expect((lock as unknown as { tails: Map<number, unknown> }).tails.size).toBe(0);
    });

    it('lets a queued final operation reread changed state before any effect', async () => {
        const lock = new RecordedResourceMutationLock();
        const preparedState = { isProtected: false, relationCount: 2 };
        let finalState = preparedState;
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>(resolve => {
            releaseFirst = resolve;
        });
        const effect = vi.fn();
        const first = lock.runExclusive(894, async () => {
            await firstGate;
            finalState = { isProtected: true, relationCount: 3 };
        });
        const second = lock.runExclusive(894, async () => {
            if (
                finalState.isProtected !== preparedState.isProtected ||
                finalState.relationCount !== preparedState.relationCount
            ) {
                return { type: 'state-changed' as const };
            }
            effect();
            return { type: 'deleted' as const };
        });

        releaseFirst();
        await first;
        await expect(second).resolves.toEqual({ type: 'state-changed' });
        expect(effect).not.toHaveBeenCalled();
        expect((lock as unknown as { tails: Map<number, unknown> }).tails.size).toBe(0);
    });
});

describe('prepared deletion provider races and lifecycle', () => {
    it('keeps each provider token kind exact across wrong-kind rejection and its one allowed effect', async () => {
        const wholeTarget = deletionCoreSubject();
        const whole = {
            id: 925,
            reserveId: null,
            isProtected: false,
            isRecording: false,
            videoFiles: [{ id: 926, parentDirectoryName: 'main' }],
        };
        wholeTarget.recordedDB.findId.mockResolvedValue(whole);
        wholeTarget.deleteExactRecordedResources = vi.fn(async () => undefined);
        const wholePreparation = await wholeTarget.prepareUserDeletion(whole.id);
        const wholeConsume = vi.spyOn(wholeTarget.preparedDeletionTokens, 'consume');

        await expect(wholeTarget.deletePreparedVideoFile(wholePreparation.token)).rejects.toThrow('token-stale');
        await expect(wholeTarget.deletePrepared(wholePreparation.token)).resolves.toBeUndefined();
        expect(wholeConsume.mock.results[1].value).toMatchObject({
            type: 'consumed',
            value: { kind: 'recorded', recordedId: whole.id },
        });
        expect(wholeTarget.deleteExactRecordedResources).toHaveBeenCalledOnce();

        const videoTarget = deletionCoreSubject();
        const video = { id: 927, recordedId: 928, parentDirectoryName: 'main', filePath: 'target.ts' };
        const sibling = { id: 929, recordedId: 928, parentDirectoryName: 'main', filePath: 'sibling.ts' };
        videoTarget.videoFileDB.findId.mockResolvedValue(video);
        videoTarget.recordedDB.findId.mockResolvedValue({
            id: video.recordedId,
            isProtected: false,
            isRecording: false,
            videoFiles: [video, sibling],
        });
        videoTarget.removeManagedFile = vi.fn(async () => 'removed');
        const videoPreparation = await videoTarget.prepareVideoFileDeletion(video.id);
        const videoConsume = vi.spyOn(videoTarget.preparedDeletionTokens, 'consume');

        await expect(videoTarget.deletePreparedForStorage(videoPreparation.token)).rejects.toThrow('token-stale');
        await expect(videoTarget.deletePreparedVideoFile(videoPreparation.token)).resolves.toEqual({
            status: 'video-file-deleted',
        });
        expect(videoConsume.mock.results[1].value).toMatchObject({
            type: 'consumed',
            value: { kind: 'video-file', recordedId: video.recordedId, videoFileId: video.id },
        });
        expect(videoTarget.videoFileDB.deleteOnce).toHaveBeenCalledWith(video.id);

        const storageTarget = deletionCoreSubject();
        const storage = {
            id: 930,
            isProtected: false,
            isRecording: false,
            videoFiles: [{ id: 931, parentDirectoryName: 'main' }],
        };
        storageTarget.recordedDB.findId.mockResolvedValue(storage);
        storageTarget.deleteExactRecordedResources = vi.fn(async () => undefined);
        const storagePreparation = await storageTarget.prepareStorageDeletion(storage.id, 'main');
        const storageConsume = vi.spyOn(storageTarget.preparedDeletionTokens, 'consume');

        await expect(storageTarget.deletePrepared(storagePreparation.token)).rejects.toThrow('token-stale');
        await expect(storageTarget.deletePreparedForStorage(storagePreparation.token)).resolves.toBe('deleted');
        expect(storageConsume.mock.results[1].value).toMatchObject({
            type: 'consumed',
            value: { kind: 'storage', recordedId: storage.id, storageName: 'main' },
        });
        expect(storageTarget.deleteExactRecordedResources).toHaveBeenCalledOnce();
    });

    it('returns not-found for a missing video before reading a parent or creating token state', async () => {
        const target = deletionCoreSubject();
        target.videoFileDB.findId.mockResolvedValue(null);

        await expect(target.prepareVideoFileDeletion(932)).resolves.toEqual({ status: 'not-found' });

        expect(target.recordedDB.findId).not.toHaveBeenCalled();
        expect(target.preparedDeletionTokens).toBeUndefined();
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
    });

    it('treats a missing preparation relation collection as exactly empty without effects', async () => {
        const target = deletionCoreSubject();
        const video = { id: 933, recordedId: 934 };
        target.videoFileDB.findId.mockResolvedValue(video);
        target.recordedDB.findId.mockResolvedValue({
            id: video.recordedId,
            isProtected: false,
            isRecording: false,
            videoFiles: undefined,
        });
        const originalSome = Array.prototype.some;
        let relationFallback: unknown;
        const some = vi.spyOn(Array.prototype, 'some').mockImplementation(function (predicate, thisArg) {
            relationFallback = this;
            return originalSome.call(this, predicate, thisArg);
        });

        const result = await target.prepareVideoFileDeletion(video.id);
        some.mockRestore();

        expect(result).toEqual({ status: 'not-found' });
        expect(relationFallback).toEqual([]);
        expect(target.preparedDeletionTokens).toBeUndefined();
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
    });

    it('rejects missing, protected, and wrong-kind whole finals before effects', async () => {
        const missingTarget = deletionCoreSubject();
        const base = { id: 936, reserveId: null, isProtected: false, isRecording: false, videoFiles: [] };
        missingTarget.recordedDB.findId.mockResolvedValueOnce(base).mockResolvedValueOnce(null);
        missingTarget.deleteExactRecordedResources = vi.fn(async () => undefined);
        const missingPreparation = await missingTarget.prepareUserDeletion(base.id);
        await expect(missingTarget.deletePrepared(missingPreparation.token)).rejects.toThrow('RecordedIdIsNotFound');
        expect(missingTarget.deleteExactRecordedResources).not.toHaveBeenCalled();

        const protectedTarget = deletionCoreSubject();
        protectedTarget.recordedDB.findId
            .mockResolvedValueOnce(base)
            .mockResolvedValueOnce({ ...base, isProtected: true });
        protectedTarget.deleteExactRecordedResources = vi.fn(async () => undefined);
        const protectedPreparation = await protectedTarget.prepareUserDeletion(base.id);
        await expect(protectedTarget.deletePrepared(protectedPreparation.token)).rejects.toThrow('RecordedIsProtected');
        expect(protectedTarget.deleteExactRecordedResources).not.toHaveBeenCalled();

        const wrongKindTarget = deletionCoreSubject();
        const video = { id: 937, recordedId: base.id };
        wrongKindTarget.videoFileDB.findId.mockResolvedValue(video);
        wrongKindTarget.recordedDB.findId.mockResolvedValue({ ...base, videoFiles: [video, { id: 938 }] });
        const videoPreparation = await wrongKindTarget.prepareVideoFileDeletion(video.id);
        await expect(wrongKindTarget.deletePrepared(videoPreparation.token)).rejects.toThrow('token-stale');
        expect(wrongKindTarget.resourceMutationLock).toBeUndefined();
    });

    it('consumes a whole token once and rejects changed terminal state before exact effects', async () => {
        const target = deletionCoreSubject();
        const prepared = {
            id: 941,
            reserveId: 942,
            isProtected: false,
            isRecording: true,
            videoFiles: [{ id: 943 }],
        };
        target.recordedDB.findId
            .mockResolvedValueOnce(prepared)
            .mockResolvedValueOnce({ ...prepared, isRecording: false });
        target.deleteExactRecordedResources = vi.fn(async () => undefined);

        const preparation = await target.prepareUserDeletion(prepared.id);
        await expect(target.deletePrepared(preparation.token)).rejects.toThrow('RecordedDeletionStateChanged');
        await expect(target.deletePrepared(preparation.token)).rejects.toThrow('token-replayed');

        expect(target.deleteExactRecordedResources).not.toHaveBeenCalled();
        expect(target.recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();
        expect(target.resourceMutationLock.tails.size).toBe(0);
    });

    it('rejects a reserve-id-only change before whole deletion effects', async () => {
        const target = deletionCoreSubject();
        const prepared = {
            id: 944,
            reserveId: 945,
            isProtected: false,
            isRecording: true,
            videoFiles: [{ id: 946 }],
        };
        target.recordedDB.findId.mockResolvedValueOnce(prepared).mockResolvedValueOnce({ ...prepared, reserveId: 947 });
        target.deleteExactRecordedResources = vi.fn(async () => undefined);

        const preparation = await target.prepareUserDeletion(prepared.id);
        await expect(target.deletePrepared(preparation.token)).rejects.toThrow('RecordedDeletionStateChanged');
        expect(target.deleteExactRecordedResources).not.toHaveBeenCalled();
        expect(target.resourceMutationLock.tails.size).toBe(0);
    });

    it('returns a final whole decision without partially deleting an individual file', async () => {
        const target = deletionCoreSubject();
        const recordedId = 951;
        const video = { id: 952, recordedId: 951, parentDirectoryName: 'main', filePath: 'target.ts' };
        const sibling = { id: 953, recordedId: 951, parentDirectoryName: 'main', filePath: 'sibling.ts' };
        target.videoFileDB.findId.mockResolvedValue(video);
        target.recordedDB.findId
            .mockResolvedValueOnce({
                id: recordedId,
                isProtected: false,
                isRecording: false,
                videoFiles: [video, sibling],
            })
            .mockResolvedValueOnce({
                id: recordedId,
                isProtected: false,
                isRecording: false,
                videoFiles: [video],
            });
        target.removeManagedFile = vi.fn(async () => undefined);

        const preparation = await target.prepareVideoFileDeletion(video.id);
        await expect(target.deletePreparedVideoFile(preparation.token)).resolves.toEqual({
            status: 'whole-recorded-deletion-required',
            recordedId,
        });

        expect(target.removeManagedFile).not.toHaveBeenCalled();
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
        expect(target.resourceMutationLock.tails.size).toBe(0);
    });

    it.each([
        ['missing parent', null, { status: 'not-found' }],
        ['protected parent', { isProtected: true, isRecording: false }, { status: 'protected' }],
        [
            'recording parent',
            { isProtected: false, isRecording: true },
            { status: 'whole-recorded-deletion-required', recordedId: 955 },
        ],
    ])('returns the typed %s final result before individual effects', async (_name, finalState, expected) => {
        const target = deletionCoreSubject();
        const recordedId = 955;
        const video = { id: 956, recordedId: 955, parentDirectoryName: 'main', filePath: 'target.ts' };
        const sibling = { id: 957, recordedId: 955, parentDirectoryName: 'main', filePath: 'sibling.ts' };
        const eligible = {
            id: recordedId,
            isProtected: false,
            isRecording: false,
            videoFiles: [video, sibling],
        };
        target.videoFileDB.findId.mockResolvedValue(video);
        target.recordedDB.findId
            .mockResolvedValueOnce(eligible)
            .mockResolvedValueOnce(finalState === null ? null : { ...eligible, ...finalState });
        target.removeManagedFile = vi.fn(async () => 'removed');

        const preparation = await target.prepareVideoFileDeletion(video.id);
        await expect(target.deletePreparedVideoFile(preparation.token)).resolves.toEqual(expected);
        expect(target.removeManagedFile).not.toHaveBeenCalled();
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
        expect(target.resourceMutationLock.tails.size).toBe(0);
    });

    it('does not expand an individual token to a file that moved to another parent', async () => {
        const target = deletionCoreSubject();
        const recordedId = 961;
        const video = { id: 962, recordedId: 961, parentDirectoryName: 'main', filePath: 'target.ts' };
        target.videoFileDB.findId.mockResolvedValue(video);
        target.recordedDB.findId
            .mockResolvedValueOnce({
                id: recordedId,
                isProtected: false,
                isRecording: false,
                videoFiles: [video, { id: 964 }],
            })
            .mockResolvedValueOnce({
                id: recordedId,
                isProtected: false,
                isRecording: false,
                videoFiles: [{ id: 964 }, { id: 965 }],
            });
        target.removeManagedFile = vi.fn(async () => undefined);

        const preparation = await target.prepareVideoFileDeletion(video.id);
        await expect(target.deletePreparedVideoFile(preparation.token)).resolves.toEqual({ status: 'not-found' });

        expect(target.removeManagedFile).not.toHaveBeenCalled();
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.resourceMutationLock.tails.size).toBe(0);
    });

    it('treats a missing final relation collection as exactly empty before individual effects', async () => {
        const target = deletionCoreSubject();
        const video = { id: 967, recordedId: 968, parentDirectoryName: 'main', filePath: 'target.ts' };
        target.videoFileDB.findId.mockResolvedValue(video);
        target.recordedDB.findId
            .mockResolvedValueOnce({
                id: video.recordedId,
                isProtected: false,
                isRecording: false,
                videoFiles: [video, { id: 969 }],
            })
            .mockResolvedValueOnce({
                id: video.recordedId,
                isProtected: false,
                isRecording: false,
                videoFiles: undefined,
            });
        target.removeManagedFile = vi.fn(async () => 'removed');

        const preparation = await target.prepareVideoFileDeletion(video.id);
        const result = await target.deletePreparedVideoFile(preparation.token);

        expect(result).toEqual({ status: 'not-found' });
        expect(target.removeManagedFile).not.toHaveBeenCalled();
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
        expect(target.resourceMutationLock.tails.size).toBe(0);
    });

    it('uses the exact configured storage name for a successful direct-file deletion', async () => {
        const target = deletionCoreSubject();
        target.config.recorded = [
            { name: 'other', path: 'synthetic-other-root' },
            { name: 'main', path: 'synthetic-main-root' },
        ];
        const video = { id: 973, recordedId: 974, parentDirectoryName: 'main', filePath: 'target.ts' };
        target.videoFileDB.findId.mockResolvedValue(video);
        target.recordedDB.findId.mockResolvedValue({
            id: video.recordedId,
            isProtected: false,
            isRecording: false,
            videoFiles: [video, { id: 975 }],
        });
        target.removeManagedFile = vi.fn(async () => 'removed');

        const preparation = await target.prepareVideoFileDeletion(video.id);
        await expect(target.deletePreparedVideoFile(preparation.token)).resolves.toEqual({
            status: 'video-file-deleted',
        });

        expect(target.removeManagedFile).toHaveBeenCalledOnce();
        expect(target.removeManagedFile).toHaveBeenCalledWith('synthetic-main-root', video.filePath);
        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledWith(video.id);
        expect(target.recordedEvent.emitDeleteVideoFile).toHaveBeenCalledWith(video.id);
    });

    it('uses only the final aggregate relation path and storage for an individual deletion', async () => {
        const target = deletionCoreSubject();
        target.config.recorded = [
            { name: 'main', path: 'synthetic-main-root' },
            { name: 'archive', path: 'synthetic-archive-root' },
        ];
        const preparedVideo = {
            id: 976,
            recordedId: 977,
            parentDirectoryName: 'main',
            filePath: 'old.ts',
        };
        const finalVideo = {
            id: 976,
            recordedId: 977,
            parentDirectoryName: 'archive',
            filePath: 'final.ts',
        };
        target.videoFileDB.findId.mockResolvedValue(preparedVideo);
        target.recordedDB.findId
            .mockResolvedValueOnce({
                id: preparedVideo.recordedId,
                isProtected: false,
                isRecording: false,
                videoFiles: [preparedVideo, { id: 978 }],
            })
            .mockResolvedValueOnce({
                id: preparedVideo.recordedId,
                isProtected: false,
                isRecording: false,
                videoFiles: [finalVideo, { id: 978 }],
            });
        target.removeManagedFile = vi.fn(async () => 'removed');

        const preparation = await target.prepareVideoFileDeletion(preparedVideo.id);
        const freeze = vi.spyOn(Object, 'freeze');
        await expect(target.deletePreparedVideoFile(preparation.token)).resolves.toEqual({
            status: 'video-file-deleted',
        });

        expect(target.videoFileDB.findId).toHaveBeenCalledOnce();
        expect(freeze).toHaveBeenCalledWith({
            id: finalVideo.id,
            parentDirectoryName: finalVideo.parentDirectoryName,
            filePath: finalVideo.filePath,
        });
        expect(target.removeManagedFile).toHaveBeenCalledOnce();
        expect(target.removeManagedFile).toHaveBeenCalledWith('synthetic-archive-root', 'final.ts');
        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledWith(preparedVideo.id);
        expect(target.recordedEvent.emitDeleteVideoFile).toHaveBeenCalledWith(preparedVideo.id);
        expect(target.resourceMutationLock.tails.size).toBe(0);
    });

    it('refuses a final parent snapshot that lost the exact target relation', async () => {
        const target = deletionCoreSubject();
        const recordedId = 965;
        const video = { id: 966, recordedId: 965, parentDirectoryName: 'main', filePath: 'target.ts' };
        target.videoFileDB.findId.mockResolvedValue(video);
        target.recordedDB.findId
            .mockResolvedValueOnce({
                id: recordedId,
                isProtected: false,
                isRecording: false,
                videoFiles: [video, { id: 967 }],
            })
            .mockResolvedValueOnce({
                id: recordedId,
                isProtected: false,
                isRecording: false,
                videoFiles: [{ id: 967 }, { id: 968 }],
            });
        target.removeManagedFile = vi.fn(async () => 'removed');

        const preparation = await target.prepareVideoFileDeletion(video.id);
        await expect(target.deletePreparedVideoFile(preparation.token)).resolves.toEqual({ status: 'not-found' });
        expect(target.removeManagedFile).not.toHaveBeenCalled();
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
    });

    it('rejects an unsafe direct-file path before its DB row or notification', async () => {
        const target = deletionCoreSubject();
        const recordedId = 969;
        const video = { id: 970, recordedId: 969, parentDirectoryName: 'missing', filePath: '../outside.ts' };
        const parent = {
            id: recordedId,
            isProtected: false,
            isRecording: false,
            videoFiles: [video, { id: 971 }],
        };
        target.videoFileDB.findId.mockResolvedValue(video);
        target.recordedDB.findId.mockResolvedValue(parent);

        const preparation = await target.prepareVideoFileDeletion(video.id);
        await expect(target.deletePreparedVideoFile(preparation.token)).rejects.toThrow('VideoFileDeletionFailed');

        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
        expect(target.resourceMutationLock.tails.size).toBe(0);
    });

    it('continues the exact DB row and notification after a safe unlink attempt fails', async () => {
        const target = deletionCoreSubject();
        const video = { id: 980, recordedId: 981, parentDirectoryName: 'main', filePath: 'target.ts' };
        target.videoFileDB.findId.mockResolvedValue(video);
        target.recordedDB.findId.mockResolvedValue({
            id: video.recordedId,
            isProtected: false,
            isRecording: false,
            videoFiles: [video, { id: 982 }],
        });
        const unlinkFailure = new Error('synthetic individual unlink failure');
        const parent = {
            descriptorPath: '/proc/self/fd/95',
            close: vi.fn(async () => undefined),
        };
        target.uploadFileSystem = Object.create(null);
        target.uploadFileSystem.realpath = vi.fn(async () => 'synthetic-recorded-root');
        target.openPinnedDeletionParent = vi.fn(async () => parent);
        const unlink = vi.spyOn(FileUtil, 'unlink').mockRejectedValue(unlinkFailure);

        const preparation = await target.prepareVideoFileDeletion(video.id);
        await expect(target.deletePreparedVideoFile(preparation.token)).resolves.toEqual({
            status: 'video-file-deleted',
        });

        expect(unlink).toHaveBeenCalledOnce();
        expect(unlink).toHaveBeenCalledWith('/proc/self/fd/95/target.ts');
        expect(target.log.system.error).toHaveBeenCalledWith(unlinkFailure);
        expect(parent.close).toHaveBeenCalledOnce();
        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledOnce();
        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledWith(video.id);
        expect(target.recordedEvent.emitDeleteVideoFile).toHaveBeenCalledOnce();
        expect(target.recordedEvent.emitDeleteVideoFile).toHaveBeenCalledWith(video.id);
        expect(target.resourceMutationLock.tails.size).toBe(0);
    });

    it('deletes an individual file left in the recorded temporary directory from the temporary root', async () => {
        const target = deletionCoreSubject();
        const video = { id: 986, recordedId: 987, parentDirectoryName: 'tmp', filePath: 'remaining.ts' };
        target.videoFileDB.findId.mockResolvedValue(video);
        target.recordedDB.findId.mockResolvedValue({
            id: video.recordedId,
            isProtected: false,
            isRecording: false,
            videoFiles: [video, { id: 988 }],
        });
        target.removeManagedFile = vi.fn(async () => 'removed');

        const preparation = await target.prepareVideoFileDeletion(video.id);
        await expect(target.deletePreparedVideoFile(preparation.token)).resolves.toEqual({
            status: 'video-file-deleted',
        });

        expect(target.removeManagedFile.mock.calls).toEqual([['synthetic-tmp-root', 'remaining.ts']]);
        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledWith(video.id);
        expect(target.recordedEvent.emitDeleteVideoFile).toHaveBeenCalledWith(video.id);
    });

    it('preserves DB rejection after a safe unlink attempt failure without notification', async () => {
        const target = deletionCoreSubject();
        const video = { id: 983, recordedId: 984, parentDirectoryName: 'main', filePath: 'target.ts' };
        target.videoFileDB.findId.mockResolvedValue(video);
        target.recordedDB.findId.mockResolvedValue({
            id: video.recordedId,
            isProtected: false,
            isRecording: false,
            videoFiles: [video, { id: 985 }],
        });
        const unlinkFailure = new Error('synthetic individual unlink failure');
        const databaseFailure = new Error('synthetic individual row failure');
        const parent = {
            descriptorPath: '/proc/self/fd/96',
            close: vi.fn(async () => undefined),
        };
        target.uploadFileSystem = Object.create(null);
        target.uploadFileSystem.realpath = vi.fn(async () => 'synthetic-recorded-root');
        target.openPinnedDeletionParent = vi.fn(async () => parent);
        vi.spyOn(FileUtil, 'unlink').mockRejectedValue(unlinkFailure);
        target.videoFileDB.deleteOnce.mockRejectedValue(databaseFailure);

        const preparation = await target.prepareVideoFileDeletion(video.id);
        await expect(target.deletePreparedVideoFile(preparation.token)).rejects.toBe(databaseFailure);

        expect(target.log.system.error).toHaveBeenCalledWith(unlinkFailure);
        expect(parent.close).toHaveBeenCalledOnce();
        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledOnce();
        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledWith(video.id);
        expect(target.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
        expect(target.resourceMutationLock.tails.size).toBe(0);
    });

    it('consumes a storage token once and returns not-deleted after a membership race', async () => {
        const target = deletionCoreSubject();
        const recordedId = 971;
        const eligible = {
            id: recordedId,
            isProtected: false,
            isRecording: false,
            videoFiles: [{ id: 972, parentDirectoryName: 'main' }],
        };
        target.recordedDB.findId.mockResolvedValueOnce(eligible).mockResolvedValueOnce({
            ...eligible,
            videoFiles: [{ id: 972, parentDirectoryName: 'other' }],
        });
        target.deleteExactRecordedResources = vi.fn(async () => undefined);

        const preparation = await target.prepareStorageDeletion(recordedId, 'main');
        await expect(target.deletePreparedForStorage(preparation.token)).resolves.toBe('not-deleted');
        await expect(target.deletePreparedForStorage(preparation.token)).rejects.toThrow('token-replayed');

        expect(target.deleteExactRecordedResources).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();
        expect(target.resourceMutationLock.tails.size).toBe(0);
    });

    describe.each([
        ['is absent', () => null],
        ['became protected', (eligible: any) => ({ ...eligible, isProtected: true })],
        ['started recording', (eligible: any) => ({ ...eligible, isRecording: true })],
        ['lost every video relation', (eligible: any) => ({ ...eligible, videoFiles: [] })],
        ['has no video relation list', (eligible: any) => ({ ...eligible, videoFiles: undefined })],
        [
            'gained a video relation in another storage',
            (eligible: any) => ({
                ...eligible,
                videoFiles: [...eligible.videoFiles, { id: 9_973, parentDirectoryName: 'other' }],
            }),
        ],
    ])('[storage-final-read] when the recorded program %s after preparation', (_case, changed) => {
        it('returns not-deleted from the final locked read without deletion effects', async () => {
            const target = deletionCoreSubject();
            const recordedId = 9_971;
            const eligible = {
                id: recordedId,
                isProtected: false,
                isRecording: false,
                videoFiles: [{ id: 9_972, parentDirectoryName: 'main' }],
            };
            target.recordedDB.findId.mockResolvedValueOnce(eligible).mockResolvedValueOnce(changed(eligible));
            target.deleteExactRecordedResources = vi.fn(async () => undefined);

            const preparation = await target.prepareStorageDeletion(recordedId, 'main');
            await expect(target.deletePreparedForStorage(preparation.token)).resolves.toBe('not-deleted');
            await expect(target.deletePreparedForStorage(preparation.token)).rejects.toThrow('token-replayed');

            expect(target.recordedDB.findId).toHaveBeenCalledTimes(2);
            expect(target.deleteExactRecordedResources).not.toHaveBeenCalled();
            expect(target.recordedDB.deleteOnce).not.toHaveBeenCalled();
            expect(target.recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();
            expect(target.resourceMutationLock.tails.size).toBe(0);
        });
    });

    describe.each([
        ['the final recorded read', 'read'],
        ['the exact resource deletion', 'delete'],
    ])('[storage-lock-release] when %s rejects', (_case, stage) => {
        it('rethrows the original error and releases the recorded-id lock', async () => {
            const target = deletionCoreSubject();
            const recordedId = 9_981;
            const eligible = {
                id: recordedId,
                isProtected: false,
                isRecording: false,
                videoFiles: [{ id: 9_982, parentDirectoryName: 'main' }],
            };
            const failure = new Error(`synthetic storage final ${stage} failure`);
            if (stage === 'read') {
                target.recordedDB.findId.mockResolvedValueOnce(eligible).mockRejectedValueOnce(failure);
                target.deleteExactRecordedResources = vi.fn(async () => undefined);
            } else {
                target.recordedDB.findId.mockResolvedValue(eligible);
                target.deleteExactRecordedResources = vi.fn(async () => Promise.reject(failure));
            }

            const preparation = await target.prepareStorageDeletion(recordedId, 'main');
            await expect(target.deletePreparedForStorage(preparation.token)).rejects.toBe(failure);

            expect(target.resourceMutationLock.tails.size).toBe(0);
            expect(target.recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();
            await expect(target.resourceMutationLock.runExclusive(recordedId, async () => 'acquired')).resolves.toBe(
                'acquired',
            );
        });
    });

    it('treats missing storage relations as empty and rejects a mixed-storage aggregate without effects', async () => {
        const target = deletionCoreSubject();
        const recordedId = 976;
        target.recordedDB.findId
            .mockResolvedValueOnce({
                id: recordedId,
                isProtected: false,
                isRecording: false,
                videoFiles: undefined,
            })
            .mockResolvedValueOnce({
                id: recordedId,
                isProtected: false,
                isRecording: false,
                videoFiles: [
                    { id: 977, parentDirectoryName: 'main' },
                    { id: 978, parentDirectoryName: 'other' },
                ],
            });
        target.deleteExactRecordedResources = vi.fn(async () => undefined);

        await expect(target.prepareStorageDeletion(recordedId, 'main')).resolves.toEqual({
            status: 'not-deleted',
            reason: 'no-video-relations',
        });
        await expect(target.prepareStorageDeletion(recordedId, 'main')).resolves.toEqual({
            status: 'not-deleted',
            reason: 'storage-mismatch',
        });

        expect(target.preparedDeletionTokens).toBeUndefined();
        expect(target.deleteExactRecordedResources).not.toHaveBeenCalled();
        expect(target.recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();
    });

    it('shares one recorded-id lock across whole and storage final operations', async () => {
        const target = deletionCoreSubject();
        const recorded = {
            id: 981,
            reserveId: null,
            isProtected: false,
            isRecording: false,
            videoFiles: [{ id: 982, parentDirectoryName: 'main' }],
        };
        target.recordedDB.findId.mockResolvedValue(recorded);
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>(resolve => {
            releaseFirst = resolve;
        });
        target.deleteExactRecordedResources = vi
            .fn()
            .mockImplementationOnce(async () => firstGate)
            .mockResolvedValueOnce(undefined);

        const whole = await target.prepareUserDeletion(recorded.id);
        const storage = await target.prepareStorageDeletion(recorded.id, 'main');
        const first = target.deletePrepared(whole.token);
        const second = target.deletePreparedForStorage(storage.token);
        await vi.waitFor(() => expect(target.deleteExactRecordedResources).toHaveBeenCalledOnce());
        expect(target.recordedDB.findId).toHaveBeenCalledTimes(3);

        releaseFirst();
        await expect(first).resolves.toBeUndefined();
        await expect(second).resolves.toBe('deleted');
        expect(target.recordedDB.findId).toHaveBeenCalledTimes(4);
        expect(target.deleteExactRecordedResources).toHaveBeenCalledTimes(2);
        expect(target.resourceMutationLock.tails.size).toBe(0);
    });
});
