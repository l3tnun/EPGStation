import 'reflect-metadata';

import {
    chmod,
    copyFile,
    link,
    lstat,
    mkdir,
    mkdtemp,
    open,
    readFile,
    realpath,
    rm,
    rmdir,
    stat,
    symlink,
    unlink,
    writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
const RecordedManageModel = load<{ prototype: Record<string, unknown> }>(
    'model/operator/recorded/RecordedManageModel.js',
);
const RecordedUploadAdoptionModel = load<
    new (uploadRoot: string) => {
        adopt(filePath: string): Promise<string>;
        initialize(): Promise<void>;
    }
>('model/operator/recorded/RecordedUploadAdoptionModel.js');
const FileUtil = require(join(snapshot, 'util', 'FileUtil.js')).default;

afterEach(() => vi.restoreAllMocks());

const subject = () => {
    const value: any = Object.create(RecordedManageModel.prototype);
    value.log = { system: { info: vi.fn(), error: vi.fn() } };
    value.videoFileDB = { insertOnce: vi.fn(async () => 412) };
    value.recordedEvent = { emitAddVideoFile: vi.fn() };
    value.videoUtil = { getParentDirPath: vi.fn(() => 'synthetic-storage-root') };
    return value;
};

describe('recorded upload implementation characterization', () => {
    it('reject-invalid-time-range', async () => {
        const target = subject();
        target.recordedDB = { insertOnce: vi.fn() };
        target.recordedEvent = { emitCreateNewRecorded: vi.fn() };

        await expect(
            target.createNewRecorded({ channelId: 401, startAt: 0, endAt: 0, name: 'Synthetic invalid range' }),
        ).rejects.toThrow('TimeRangeError');

        expect(target.recordedDB.insertOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitCreateNewRecorded).not.toHaveBeenCalled();
    });

    it('resolve-concurrent-name-collision', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recorded-upload-collision-'));
        const storage = join(root, 'storage');
        const sourceOne = join(root, 'adopted', 'token-one', 'payload');
        const sourceTwo = join(root, 'adopted', 'token-two', 'payload');
        const unrelated = join(root, 'adopted', 'unrelated-token', 'payload');
        const target: any = Object.create(RecordedManageModel.prototype);

        try {
            await Promise.all([
                mkdir(storage),
                mkdir(join(root, 'adopted', 'token-one'), { recursive: true }),
                mkdir(join(root, 'adopted', 'token-two'), { recursive: true }),
                mkdir(join(root, 'adopted', 'unrelated-token'), { recursive: true }),
            ]);
            await Promise.all([
                writeFile(sourceOne, 'first-upload-bytes'),
                writeFile(sourceTwo, 'second-upload-bytes'),
                writeFile(unrelated, 'unrelated-bytes'),
            ]);
            target.log = { system: { info: vi.fn(), error: vi.fn() } };
            target.recordedDB = { findId: vi.fn(async () => ({ thumbnails: [] })) };
            target.videoFileDB = { insertOnce: vi.fn(async () => 412) };
            target.recordedEvent = { emitAddVideoFile: vi.fn(), emitAddUploadedVideoFile: vi.fn() };
            target.videoUtil = { getParentDirPath: vi.fn(() => storage) };
            target.recordingUtilModel = { formatFilePathString: vi.fn(async (value: string) => value) };
            target.uploadFileSystem = { copyFile, link, lstat, mkdir, open, realpath, rmdir, stat, unlink };

            await Promise.all([
                target.addUploadedVideoFile({
                    recordedId: 401,
                    parentDirectoryName: 'synthetic-storage',
                    viewName: 'Concurrent upload one',
                    fileType: 'ts',
                    fileName: 'name.ts',
                    filePath: sourceOne,
                }),
                target.addUploadedVideoFile({
                    recordedId: 402,
                    parentDirectoryName: 'synthetic-storage',
                    viewName: 'Concurrent upload two',
                    fileType: 'ts',
                    fileName: 'name.ts',
                    filePath: sourceTwo,
                }),
            ]);

            const payloads = await Promise.all([
                readFile(join(storage, 'name.ts'), 'utf8'),
                readFile(join(storage, 'name(1).ts'), 'utf8'),
            ]);
            expect(payloads.sort()).toEqual(['first-upload-bytes', 'second-upload-bytes']);
            await expect(lstat(sourceOne)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(lstat(sourceTwo)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(lstat(join(root, 'adopted', 'token-one'))).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(lstat(join(root, 'adopted', 'token-two'))).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(unrelated, 'utf8')).resolves.toBe('unrelated-bytes');
            expect(target.videoFileDB.insertOnce).toHaveBeenCalledTimes(2);
            expect(target.recordedEvent.emitAddUploadedVideoFile).toHaveBeenCalledTimes(2);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('reject-root-escape-and-link', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recorded-upload-path-'));
        const outside = join(root, 'outside');
        const incoming = join(root, 'incoming');
        const linkedToken = join(incoming, 'linked');
        const adoption = new RecordedUploadAdoptionModel(root);

        try {
            await Promise.all([mkdir(outside), mkdir(incoming)]);
            await writeFile(join(outside, 'payload'), 'outside-bytes');
            await symlink(outside, linkedToken, 'dir');
            await adoption.initialize();

            await expect(adoption.adopt(join(outside, 'payload'))).rejects.toThrow('UploadPathError');
            await expect(adoption.adopt('incoming/linked/payload')).rejects.toThrow('UploadPathError');

            await expect(readFile(join(outside, 'payload'), 'utf8')).resolves.toBe('outside-bytes');
            await expect(lstat(join(root, 'adopted', 'linked'))).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('[Task 3.1/RC-4.12] preserves both payloads when the parent adoption token is already occupied', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-recorded-upload-imp-'));
        const incomingPayload = join(uploadRoot, 'incoming', 'occupied-token', 'payload');
        const adoptedPayload = join(uploadRoot, 'adopted', 'occupied-token', 'payload');

        try {
            await mkdir(join(uploadRoot, 'incoming', 'occupied-token'), { recursive: true });
            await writeFile(incomingPayload, 'incoming-owned-bytes');
            const adoption = new RecordedUploadAdoptionModel(uploadRoot);
            await adoption.initialize();
            await mkdir(join(uploadRoot, 'adopted', 'occupied-token'), { recursive: true });
            await writeFile(adoptedPayload, 'existing-parent-owned-bytes');

            await expect(adoption.adopt(incomingPayload)).rejects.toMatchObject({ code: 'EEXIST' });
            await expect(readFile(incomingPayload, 'utf8')).resolves.toBe('incoming-owned-bytes');
            await expect(readFile(adoptedPayload, 'utf8')).resolves.toBe('existing-parent-owned-bytes');
        } finally {
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it('[Task gap] swallows a follow-up rmdir failure after a rejected adoption rename', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-recorded-upload-rmdir-'));
        const incomingPayload = join(uploadRoot, 'incoming', 'stray-token', 'payload');

        try {
            await mkdir(join(uploadRoot, 'incoming', 'stray-token'), { recursive: true });
            await writeFile(incomingPayload, 'incoming-bytes');
            const renameFailure = new Error('synthetic rename failure');
            const fileSystem = {
                rename: vi.fn(async (_source: string, destination: string) => {
                    // leave the just-created adopted token directory non-empty so the
                    // rollback rmdir() in the catch block also rejects (ENOTEMPTY).
                    await writeFile(join(dirname(destination), 'stray-leftover'), 'x');
                    throw renameFailure;
                }),
            };
            const adoption = new (RecordedUploadAdoptionModel as any)(uploadRoot, fileSystem);
            await adoption.initialize();

            await expect(adoption.adopt(incomingPayload)).rejects.toBe(renameFailure);

            await expect(
                readFile(join(uploadRoot, 'adopted', 'stray-token', 'stray-leftover'), 'utf8'),
            ).resolves.toBe('x');
        } finally {
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it('[Task gap] tolerates a stale adopted token whose payload is missing and directory is non-empty', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-recorded-upload-stale-'));

        try {
            await mkdir(join(uploadRoot, 'adopted', 'stale-token', 'unexpected-subdir'), { recursive: true });
            const adoption = new RecordedUploadAdoptionModel(uploadRoot);

            await expect(adoption.initialize()).resolves.toBeUndefined();

            await expect(
                readFile(join(uploadRoot, 'adopted', 'stale-token', 'unexpected-subdir')),
            ).rejects.toBeDefined();
        } finally {
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it('[Task gap] tolerates a stray non-directory entry under adopted that cannot be unlinked', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-recorded-upload-strayfile-'));
        const adoptedRoot = join(uploadRoot, 'adopted');

        try {
            await mkdir(adoptedRoot, { recursive: true });
            await writeFile(join(adoptedRoot, 'stray-file'), 'x');
            await chmod(adoptedRoot, 0o500);
            const adoption = new RecordedUploadAdoptionModel(uploadRoot);

            await expect(adoption.initialize()).resolves.toBeUndefined();
        } finally {
            await chmod(adoptedRoot, 0o700);
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it('selects the Linux descriptor-relative directory path', () => {
        const target = subject();

        expect(target.getUploadDescriptorPath(41, 'linux')).toBe('/proc/self/fd/41');
    });

    it.each(['darwin', 'win32', 'freebsd'])(
        'has no descriptor-relative directory path on %s (the checked path is used instead)',
        platform => {
            const target = subject();

            expect(() => target.getUploadDescriptorPath(43, platform)).toThrow('UploadPathError');
        },
    );

    it('swallows a failed child close after failing to close the still-open parent directory', async () => {
        const target = subject();
        const parentCloseFailure = new Error('synthetic parent close failure');
        const childCloseFailure = new Error('synthetic child close failure');
        const parent = {
            logicalPath: 'synthetic-root',
            descriptorPath: '/proc/self/fd/81',
            close: vi.fn(async () => Promise.reject(parentCloseFailure)),
        };
        const child = {
            logicalPath: 'synthetic-root/sub',
            descriptorPath: '/proc/self/fd/82',
            close: vi.fn(async () => Promise.reject(childCloseFailure)),
        };
        target.ensureUploadDirectory = vi.fn(async () => undefined);
        target.openPinnedUploadDirectory = vi.fn().mockResolvedValueOnce(parent).mockResolvedValueOnce(child);

        await expect(target.prepareUploadDirectory('synthetic-root', 'sub')).rejects.toBe(parentCloseFailure);

        expect(child.close).toHaveBeenCalledOnce();
    });

    it('closes the opened descriptor when it fails the pinned directory type check', async () => {
        const target = subject();
        const statFailure = new Error('synthetic stat failure');
        const closeFailure = new Error('synthetic close failure');
        const handle = {
            fd: 55,
            stat: vi.fn(async () => Promise.reject(statFailure)),
            close: vi.fn(async () => Promise.reject(closeFailure)),
        };
        target.uploadPlatform = 'linux';
        target.uploadFileSystem = { open: vi.fn(async () => handle) };

        await expect(target.openPinnedUploadDirectory('synthetic-logical', 'synthetic-access')).rejects.toBe(
            statFailure,
        );

        expect(handle.close).toHaveBeenCalledOnce();
    });

    it('[RC-4.3-UNKNOWN-STORAGE] refuses an unknown storage before touching the file or database', async () => {
        const target = subject();
        target.videoUtil.getParentDirPath.mockReturnValue(null);
        const size = vi.spyOn(FileUtil, 'getFileSize');

        await expect(
            target.addVideoFile({
                recordedId: 411,
                parentDirectoryName: 'synthetic-unknown-storage',
                filePath: 'synthetic-existing.ts',
                type: 'ts',
                name: 'Synthetic existing file',
            }),
        ).rejects.toThrow('ParentDirectoryIsNull');
        expect(size).not.toHaveBeenCalled();
        expect(target.videoFileDB.insertOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitAddVideoFile).not.toHaveBeenCalled();
    });

    it('[RC-4.3-MISSING-FILE] propagates stat failure before relation persistence or notification', async () => {
        const target = subject();
        const failure = new Error('SYNTHETIC_MISSING_EXISTING_FILE');
        vi.spyOn(FileUtil, 'getFileSize').mockRejectedValue(failure);

        await expect(
            target.addVideoFile({
                recordedId: 411,
                parentDirectoryName: 'synthetic-storage',
                filePath: 'synthetic-missing.ts',
                type: 'ts',
                name: 'Synthetic missing file',
            }),
        ).rejects.toBe(failure);
        expect(target.videoFileDB.insertOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitAddVideoFile).not.toHaveBeenCalled();
    });

    it('[RC-4.3-PERSISTENCE-FAILURE] does not notify when relation persistence fails', async () => {
        const target = subject();
        const failure = new Error('SYNTHETIC_VIDEO_RELATION_REJECTION');
        vi.spyOn(FileUtil, 'getFileSize').mockResolvedValue(512);
        target.videoFileDB.insertOnce.mockRejectedValue(failure);

        await expect(
            target.addVideoFile({
                recordedId: 411,
                parentDirectoryName: 'synthetic-storage',
                filePath: 'synthetic-existing.ts',
                type: 'ts',
                name: 'Synthetic existing file',
            }),
        ).rejects.toBe(failure);
        expect(target.recordedEvent.emitAddVideoFile).not.toHaveBeenCalled();
    });
});
