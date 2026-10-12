import 'reflect-metadata';

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

afterEach(() => {
    vi.restoreAllMocks();
});

const subject = () => {
    const value: any = Object.create(RecordedManageModel.prototype);
    value.log = { system: { info: vi.fn(), error: vi.fn() } };
    value.recordedDB = { insertOnce: vi.fn(async () => 401) };
    value.videoFileDB = { insertOnce: vi.fn(async () => 402) };
    value.recordedEvent = { emitCreateNewRecorded: vi.fn(), emitAddVideoFile: vi.fn() };
    value.videoUtil = { getParentDirPath: vi.fn(() => 'synthetic-storage-root') };
    return value;
};

const uploadedSubject = () => {
    const value: any = Object.create(RecordedManageModel.prototype);
    const directory = {
        close: vi.fn(async () => undefined),
        descriptorPath: 'synthetic-descriptor-root/nested',
        logicalPath: 'synthetic-storage-root/nested',
    };
    const fileSystem = {
        copyFile: vi.fn(),
        link: vi.fn(),
        lstat: vi.fn(),
        mkdir: vi.fn(),
        open: vi.fn(),
        realpath: vi.fn(async (filePath: string) => filePath),
        rmdir: vi.fn(async () => undefined),
        stat: vi.fn(async () => ({ size: 8_192 })),
        unlink: vi.fn(async () => undefined),
    };
    value.log = { system: { error: vi.fn(), info: vi.fn() } };
    value.recordedDB = { findId: vi.fn(async () => ({ thumbnails: [] })) };
    value.recordedEvent = { emitAddUploadedVideoFile: vi.fn(), emitAddVideoFile: vi.fn() };
    value.recordingUtilModel = { formatFilePathString: vi.fn(async () => 'nested') };
    value.uploadFileSystem = fileSystem;
    value.videoUtil = { getParentDirPath: vi.fn(() => 'synthetic-storage-root') };
    value.prepareUploadDirectory = vi.fn(async () => directory);
    value.placeUploadedFile = vi.fn(async () => ({
        descriptorPath: 'synthetic-descriptor-root/nested/synthetic-upload.ts',
        logicalPath: 'synthetic-storage-root/nested/synthetic-upload.ts',
    }));
    value.assertPinnedUploadDirectory = vi.fn(async () => undefined);
    value.cleanAdoptedDirectory = vi.fn(async () => undefined);
    value.insertVideoFile = vi.fn(async () => 405);
    return { fileSystem, value };
};

const uploadedOption = () => ({
    fileName: 'synthetic-upload.ts',
    filePath: 'adopted/synthetic-token/payload',
    fileType: 'ts',
    parentDirectoryName: 'synthetic-storage',
    recordedId: 403,
    subDirectory: 'nested',
    viewName: 'Synthetic upload',
});

describe('recorded upload specification', () => {
    it('[RC-4.4] transfers an incoming payload to the parent-owned adopted path', async () => {
        const uploadRoot = await mkdtemp(join(tmpdir(), 'epgstation-recorded-upload-spec-'));
        const incomingPayload = join(uploadRoot, 'incoming', 'spec-token', 'payload');
        const adoptedPayload = join(uploadRoot, 'adopted', 'spec-token', 'payload');

        try {
            await mkdir(join(uploadRoot, 'incoming', 'spec-token'), { recursive: true });
            await writeFile(incomingPayload, 'spec-owned-bytes');
            const adoption = new RecordedUploadAdoptionModel(uploadRoot);
            await adoption.initialize();

            await expect(adoption.adopt(incomingPayload)).resolves.toBe(adoptedPayload);
            await expect(readFile(incomingPayload, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(adoptedPayload, 'utf8')).resolves.toBe('spec-owned-bytes');
        } finally {
            await rm(uploadRoot, { force: true, recursive: true });
        }
    });

    it('[RC-4.1] creates a stopped, unprotected manual recording with the derived duration', async () => {
        const target = subject();

        await expect(
            target.createNewRecorded({
                ruleId: 41,
                channelId: 101,
                startAt: 1_000,
                endAt: 2_500,
                name: 'Ｓｙｎｔｈｅｔｉｃ',
                description: 'Ｓｙｎｔｈｅｔｉｃ description',
            }),
        ).resolves.toBe(401);

        const persisted = target.recordedDB.insertOnce.mock.calls[0][0];
        expect(persisted).toMatchObject({
            ruleId: 41,
            channelId: 101,
            startAt: 1_000,
            endAt: 2_500,
            duration: 1_500,
            isRecording: false,
            isProtected: false,
            name: 'Ｓｙｎｔｈｅｔｉｃ',
            halfWidthName: 'Synthetic',
        });
        expect(target.recordedEvent.emitCreateNewRecorded).toHaveBeenCalledWith(401);
    });

    it('[RC-4.2] rejects equal and reversed time ranges before persistence or notification', async () => {
        for (const [startAt, endAt] of [
            [2_000, 2_000],
            [2_001, 2_000],
        ]) {
            const target = subject();

            await expect(
                target.createNewRecorded({ channelId: 101, startAt, endAt, name: 'Synthetic invalid range' }),
            ).rejects.toThrow('TimeRangeError');
            expect(target.recordedDB.insertOnce).not.toHaveBeenCalled();
            expect(target.recordedEvent.emitCreateNewRecorded).not.toHaveBeenCalled();
        }
    });

    it('[RC-4.3] measures and relates an existing storage file without moving it', async () => {
        const target = subject();
        vi.spyOn(FileUtil, 'getFileSize').mockResolvedValue(4_096);
        const rename = vi.spyOn(FileUtil, 'rename').mockResolvedValue(undefined);
        const move = vi.spyOn(FileUtil, 'move').mockResolvedValue(undefined);

        await expect(
            target.addVideoFile({
                recordedId: 403,
                parentDirectoryName: 'synthetic-storage',
                filePath: 'nested/synthetic-existing.ts',
                type: 'ts',
                name: 'Synthetic existing file',
            }),
        ).resolves.toBe(402);

        expect(FileUtil.getFileSize).toHaveBeenCalledWith(
            join('synthetic-storage-root', 'nested/synthetic-existing.ts'),
        );
        expect(target.videoFileDB.insertOnce.mock.calls[0][0]).toMatchObject({
            recordedId: 403,
            parentDirectoryName: 'synthetic-storage',
            filePath: 'nested/synthetic-existing.ts',
            type: 'ts',
            name: 'Synthetic existing file',
            size: 4_096,
        });
        expect(target.recordedEvent.emitAddVideoFile).toHaveBeenCalledWith(402);
        expect(rename).not.toHaveBeenCalled();
        expect(move).not.toHaveBeenCalled();
    });

    it('[RC-4.5] selects an exclusive numbered name instead of overwriting an occupied upload destination', async () => {
        const target: any = Object.create(RecordedManageModel.prototype);
        const fileSystem = {
            copyFile: vi.fn(),
            link: vi
                .fn()
                .mockRejectedValueOnce(Object.assign(new Error('occupied'), { code: 'EEXIST' }))
                .mockResolvedValueOnce(undefined),
        };
        const cleanup = { remove: vi.fn(async () => undefined) };
        target.uploadFileSystem = fileSystem;
        target.assertPinnedUploadDirectory = vi.fn(async () => undefined);

        const directory = { descriptorPath: 'synthetic-descriptor-root', logicalPath: 'synthetic-storage-root' };

        await expect(
            target.placeUploadedFile('adopted/synthetic-token/payload', directory, 'synthetic-upload.ts', cleanup),
        ).resolves.toEqual({
            directory,
            descriptorPath: 'synthetic-descriptor-root/synthetic-upload(1).ts',
            logicalPath: 'synthetic-storage-root/synthetic-upload(1).ts',
        });
        expect(fileSystem.link).toHaveBeenNthCalledWith(
            1,
            'adopted/synthetic-token/payload',
            'synthetic-descriptor-root/synthetic-upload.ts',
        );
        expect(fileSystem.link).toHaveBeenNthCalledWith(
            2,
            'adopted/synthetic-token/payload',
            'synthetic-descriptor-root/synthetic-upload(1).ts',
        );
        expect(cleanup.remove).toHaveBeenCalledWith('adopted/synthetic-token/payload');
    });

    it('[RC-4.6] registers the uploaded placement with its storage, display fields, measured size, and recorded id', async () => {
        const { value } = uploadedSubject();

        await expect(value.addUploadedVideoFile(uploadedOption())).resolves.toBeUndefined();

        expect(value.insertVideoFile).toHaveBeenCalledWith(
            {
                filePath: 'nested/synthetic-upload.ts',
                name: 'Synthetic upload',
                parentDirectoryName: 'synthetic-storage',
                recordedId: 403,
                type: 'ts',
            },
            8_192,
        );
    });

    it('[RC-4.7] rejects an upload whose recorded target is absent before destination placement', async () => {
        const { fileSystem, value } = uploadedSubject();
        value.recordedDB.findId.mockResolvedValue(null);

        await expect(value.addUploadedVideoFile(uploadedOption())).rejects.toThrow('RecordedIdIsNull');

        expect(value.prepareUploadDirectory).not.toHaveBeenCalled();
        expect(value.placeUploadedFile).not.toHaveBeenCalled();
        expect(value.insertVideoFile).not.toHaveBeenCalled();
        expect(fileSystem.unlink).toHaveBeenCalledWith('adopted/synthetic-token/payload');
    });

    it('[RC-4.8] notifies thumbnail generation after a successful uploaded-video registration', async () => {
        const { value } = uploadedSubject();
        value.recordedDB.findId.mockResolvedValue({ thumbnails: [{ id: 406 }] });

        await value.addUploadedVideoFile(uploadedOption());

        expect(value.recordedEvent.emitAddVideoFile).toHaveBeenCalledWith(405);
        expect(value.recordedEvent.emitAddUploadedVideoFile).toHaveBeenCalledWith(405, false);
    });

    it('[RC-4.9] rejects a placement failure and cleans only the parent-owned adopted payload', async () => {
        const { fileSystem, value } = uploadedSubject();
        value.placeUploadedFile.mockRejectedValue(new Error('SYNTHETIC_PLACEMENT_FAILURE'));

        await expect(value.addUploadedVideoFile(uploadedOption())).rejects.toThrow('SYNTHETIC_PLACEMENT_FAILURE');

        expect(value.insertVideoFile).not.toHaveBeenCalled();
        expect(fileSystem.unlink).toHaveBeenCalledTimes(1);
        expect(fileSystem.unlink).toHaveBeenCalledWith('adopted/synthetic-token/payload');
        expect(value.log.system.error).not.toHaveBeenCalledWith('move file error');
    });

    it('[RC-4.9-MOVE] logs the move failure and its cause when placement rejects with FileMoveError', async () => {
        const { fileSystem, value } = uploadedSubject();
        const cause = new Error('SYNTHETIC_EXDEV_COPY_FAILURE');
        value.placeUploadedFile.mockRejectedValue(new Error('FileMoveError', { cause }));

        await expect(value.addUploadedVideoFile(uploadedOption())).rejects.toThrow('FileMoveError');

        expect(fileSystem.unlink).toHaveBeenCalledWith('adopted/synthetic-token/payload');
        expect(value.log.system.error).toHaveBeenCalledWith('move file error');
        expect(value.log.system.error).toHaveBeenCalledWith(cause);
    });

    it('[RC-4.10] removes the placed file and adopted payload when relation registration fails', async () => {
        const { fileSystem, value } = uploadedSubject();
        value.insertVideoFile.mockRejectedValue(new Error('SYNTHETIC_VIDEO_INSERT_FAILURE'));

        await expect(value.addUploadedVideoFile(uploadedOption())).rejects.toThrow('SYNTHETIC_VIDEO_INSERT_FAILURE');

        expect(fileSystem.unlink).toHaveBeenNthCalledWith(1, 'synthetic-descriptor-root/nested/synthetic-upload.ts');
        expect(fileSystem.unlink).toHaveBeenNthCalledWith(2, 'adopted/synthetic-token/payload');
        expect(value.recordedEvent.emitAddVideoFile).not.toHaveBeenCalled();
    });

    it('[RC-4.11] resolves only after placement and relation registration complete, then emits the accepted upload', async () => {
        const { value } = uploadedSubject();
        const ledger: string[] = [];
        value.insertVideoFile.mockImplementation(async () => {
            ledger.push('registered');
            return 405;
        });
        value.recordedEvent.emitAddVideoFile.mockImplementation(() => ledger.push('added-notification'));
        value.recordedEvent.emitAddUploadedVideoFile.mockImplementation(() => ledger.push('upload-notification'));

        await expect(value.addUploadedVideoFile(uploadedOption())).resolves.toBeUndefined();

        expect(ledger).toEqual(['registered', 'added-notification', 'upload-notification']);
    });

    it('[RC-4.8-NOTIFY-FAILURE] keeps the registered upload when either post-registration notification throws', async () => {
        const { fileSystem, value } = uploadedSubject();
        value.recordedEvent.emitAddVideoFile.mockImplementation(() => {
            throw new Error('SYNTHETIC_ADD_NOTIFICATION_FAILURE');
        });
        value.recordedEvent.emitAddUploadedVideoFile.mockImplementation(() => {
            throw new Error('SYNTHETIC_THUMBNAIL_NOTIFICATION_FAILURE');
        });

        await expect(value.addUploadedVideoFile(uploadedOption())).resolves.toBeUndefined();

        expect(value.insertVideoFile).toHaveBeenCalledOnce();
        expect(fileSystem.unlink).not.toHaveBeenCalled();
        expect(value.log.system.error).toHaveBeenCalledWith('failed to notify added video file');
        expect(value.log.system.error).toHaveBeenCalledWith('failed to notify uploaded video file');
    });

    describe.each([
        {
            stage: 'placement',
            failure: 'SYNTHETIC_PLACEMENT_FAILURE',
            arrange: (value: any) =>
                value.placeUploadedFile.mockRejectedValue(new Error('SYNTHETIC_PLACEMENT_FAILURE')),
            cleaned: ['adopted/synthetic-token/payload'],
        },
        {
            stage: 'relation registration',
            failure: 'SYNTHETIC_VIDEO_INSERT_FAILURE',
            arrange: (value: any) =>
                value.insertVideoFile.mockRejectedValue(new Error('SYNTHETIC_VIDEO_INSERT_FAILURE')),
            cleaned: ['synthetic-descriptor-root/nested/synthetic-upload.ts', 'adopted/synthetic-token/payload'],
        },
    ])('[RC-4.12] $stage failure', ({ arrange, cleaned, failure }) => {
        it.each([
            ['when cleanup succeeds', false],
            ['when every cleanup also fails', true],
        ])(
            'never reports success and cleans only the files this request created or adopted, once each, %s',
            async (_case, cleanupFails) => {
                const { fileSystem, value } = uploadedSubject();
                arrange(value);
                if (cleanupFails) {
                    fileSystem.unlink.mockRejectedValue(new Error('SYNTHETIC_CLEANUP_FAILURE'));
                }

                await expect(value.addUploadedVideoFile(uploadedOption())).rejects.toThrow(failure);

                expect(fileSystem.unlink.mock.calls.map(([filePath]: [string]) => filePath)).toEqual(cleaned);
                expect(value.recordedEvent.emitAddVideoFile).not.toHaveBeenCalled();
                expect(value.recordedEvent.emitAddUploadedVideoFile).not.toHaveBeenCalled();
            },
        );
    });

    it('[RC-4.13] rejects an escaping subdirectory before directory creation, placement, or registration', async () => {
        const { fileSystem, value } = uploadedSubject();
        value.recordingUtilModel.formatFilePathString.mockResolvedValue('../synthetic-escape');
        delete value.prepareUploadDirectory;

        await expect(value.addUploadedVideoFile(uploadedOption())).rejects.toThrow('UploadPathError');

        expect(fileSystem.mkdir).not.toHaveBeenCalled();
        expect(fileSystem.open).not.toHaveBeenCalled();
        expect(fileSystem.link).not.toHaveBeenCalled();
        expect(value.placeUploadedFile).not.toHaveBeenCalled();
        expect(value.insertVideoFile).not.toHaveBeenCalled();
    });
});
