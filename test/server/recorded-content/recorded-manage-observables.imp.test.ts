import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;

interface RecordedRowStub {
    id: number;
    isProtected: boolean;
    isRecording: boolean;
    reserveId: number | null;
    thumbnails?: { id: number; filePath: string }[];
    videoFiles?: { id: number; filePath: string; parentDirectoryName: string }[];
    dropLogFile?: { id: number; filePath: string } | null;
}

const RecordedManageModel = (
    require(join(snapshot, 'model', 'operator', 'recorded', 'RecordedManageModel.js')) as {
        default: new (...args: unknown[]) => {
            createNewRecorded(option: Record<string, unknown>): Promise<number>;
            delete(recordedId: number, isIgnoreProtection?: boolean): Promise<void>;
            deleteVideoFile(videoFileId: number, isIgnoreProtection?: boolean): Promise<void>;
            prepareVideoFileDeletion(videoFileId: number): Promise<{ status: string; recordedId?: number }>;
            videoFileCleanup(): Promise<void>;
        };
    }
).default;
const FileUtil = (require(join(snapshot, 'util', 'FileUtil.js')) as { default: Record<string, any> }).default;

afterEach(() => {
    vi.restoreAllMocks();
});

const makeFixture = (recorded: RecordedRowStub, hasReserve: boolean = true) => {
    const systemLog = { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const recordedDB = {
        deleteOnce: vi.fn(async () => undefined),
        findId: vi.fn(async (id: number) => (id === recorded.id ? recorded : null)),
        insertOnce: vi.fn(async (_row: Record<string, unknown>) => 77),
    };
    const videoFileDB = {
        deleteOnce: vi.fn(async () => undefined),
        deleteRecordedId: vi.fn(async () => undefined),
        findAll: vi.fn(async () => [] as unknown[]),
        findId: vi.fn(async (id: number) =>
            (recorded.videoFiles ?? []).some(video => video.id === id)
                ? { id, recordedId: recorded.id, filePath: `synthetic-${id}.ts`, parentDirectoryName: 'main' }
                : null,
        ),
    };
    const thumbnailDB = { deleteRecordedId: vi.fn(async () => undefined) };
    const recordingManageModel = { cancel: vi.fn(async () => undefined), hasReserve: vi.fn(() => hasReserve) };
    const recordedEvent = {
        emitCreateNewRecorded: vi.fn(),
        emitDeleteRecorded: vi.fn(),
        emitDeleteVideoFile: vi.fn(),
    };
    const videoUtil = {
        getFullFilePathFromVideoFile: vi.fn((video: { filePath: string }) => `synthetic-root/${video.filePath}`),
        getParentDirPath: vi.fn(() => null),
    };
    const model = new RecordedManageModel(
        { getLogger: () => ({ system: systemLog }) },
        {
            getConfig: () => ({
                dropLog: 'synthetic-drop-log',
                recorded: [{ name: 'main', path: 'synthetic-root' }],
                thumbnail: 'synthetic-thumbnail',
            }),
        },
        recordedDB,
        videoFileDB,
        thumbnailDB,
        { deleteOnce: vi.fn(async () => undefined) },
        {},
        recordingManageModel,
        recordedEvent,
        videoUtil,
        {},
    );
    return { model, recordedDB, recordedEvent, recordingManageModel, thumbnailDB, videoFileDB, videoUtil };
};

const baseRow = (overrides: Partial<RecordedRowStub> = {}): RecordedRowStub => ({
    id: 10,
    isProtected: false,
    isRecording: false,
    reserveId: null,
    ...overrides,
});

const videos = (count: number): NonNullable<RecordedRowStub['videoFiles']> =>
    Array.from({ length: count }, (_value, index) => ({
        id: index + 1,
        filePath: `synthetic-${index + 1}.ts`,
        parentDirectoryName: 'main',
    }));

describe('[RC-9.8] prepared video file deletion needs whole-recorded deletion for the last or a recording file', () => {
    it('refuses a single deletion of the only video file of a finished recording', async () => {
        const fixture = makeFixture(baseRow({ videoFiles: videos(1) }));

        await expect(fixture.model.prepareVideoFileDeletion(1)).resolves.toEqual({
            status: 'whole-recorded-deletion-required',
            recordedId: 10,
        });
    });

    it('refuses a single deletion of a video file while the recording is still in progress', async () => {
        const fixture = makeFixture(baseRow({ isRecording: true, reserveId: 3, videoFiles: videos(2) }));

        await expect(fixture.model.prepareVideoFileDeletion(1)).resolves.toEqual({
            status: 'whole-recorded-deletion-required',
            recordedId: 10,
        });
    });

    it('prepares a single deletion when a finished recording has more than one video file', async () => {
        const fixture = makeFixture(baseRow({ videoFiles: videos(2) }));

        await expect(fixture.model.prepareVideoFileDeletion(2)).resolves.toMatchObject({ status: 'prepared' });
    });
});

describe('[RC-9.4] legacy whole-recorded deletion cancels a running recording only when it should', () => {
    it('cancels the reserved recording by default and does not cancel when protection is ignored', async () => {
        const cancelled = makeFixture(baseRow({ isRecording: true, reserveId: 5 }));
        await cancelled.model.delete(10);
        expect(cancelled.recordingManageModel.cancel).toHaveBeenCalledExactlyOnceWith(5, true);

        const ignored = makeFixture(baseRow({ isRecording: true, reserveId: 5 }));
        await ignored.model.delete(10, true);
        expect(ignored.recordingManageModel.cancel).not.toHaveBeenCalled();
    });

    it('does not cancel when the recording is not running, has no reserve id, or the reserve is gone', async () => {
        const notRecording = makeFixture(baseRow({ isRecording: false, reserveId: 5 }));
        await notRecording.model.delete(10);
        expect(notRecording.recordingManageModel.cancel).not.toHaveBeenCalled();

        const noReserve = makeFixture(baseRow({ isRecording: true, reserveId: null }));
        await noReserve.model.delete(10);
        expect(noReserve.recordingManageModel.hasReserve).not.toHaveBeenCalled();
        expect(noReserve.recordingManageModel.cancel).not.toHaveBeenCalled();

        const gone = makeFixture(baseRow({ isRecording: true, reserveId: 5 }), false);
        await gone.model.delete(10);
        expect(gone.recordingManageModel.cancel).not.toHaveBeenCalled();
        expect(gone.recordedDB.deleteOnce).toHaveBeenCalledWith(10);
    });

    it('skips the thumbnail and video file row deletion when the lists are empty', async () => {
        const fixture = makeFixture(baseRow({ thumbnails: [], videoFiles: [] }));

        await fixture.model.delete(10);

        expect(fixture.thumbnailDB.deleteRecordedId).not.toHaveBeenCalled();
        expect(fixture.videoFileDB.deleteRecordedId).not.toHaveBeenCalled();
        expect(fixture.recordedDB.deleteOnce).toHaveBeenCalledWith(10);
    });

    it('deletes a recorded row whose thumbnail and video file lists are absent', async () => {
        const fixture = makeFixture(baseRow());

        await fixture.model.delete(10);

        expect(fixture.thumbnailDB.deleteRecordedId).not.toHaveBeenCalled();
        expect(fixture.videoFileDB.deleteRecordedId).not.toHaveBeenCalled();
        expect(fixture.recordedDB.deleteOnce).toHaveBeenCalledWith(10);
        expect(fixture.recordedEvent.emitDeleteRecorded).toHaveBeenCalledOnce();
    });
});

describe('[RC-9.3] legacy single video file deletion', () => {
    it('removes one of several video files, keeps the recorded row and announces the video file deletion', async () => {
        const row = baseRow({ videoFiles: videos(2) });
        const fixture = makeFixture(row);
        fixture.videoFileDB.deleteOnce.mockImplementation(async () => {
            row.videoFiles = row.videoFiles!.filter(video => video.id !== 1);
        });

        await fixture.model.deleteVideoFile(1);

        expect(fixture.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(1);
        expect(fixture.recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(fixture.recordedEvent.emitDeleteVideoFile).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('deletes the recorded row together with its last video file without announcing a video file deletion', async () => {
        const row = baseRow({ videoFiles: videos(1) });
        const fixture = makeFixture(row);
        fixture.videoFileDB.deleteOnce.mockImplementation(async () => {
            row.videoFiles = [];
        });

        await fixture.model.deleteVideoFile(1);

        expect(fixture.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(10);
        expect(fixture.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
    });

    it.each([
        ['the recorded row is gone', null],
        ['the recorded row has no video file list', baseRow()],
    ])('only announces the video file deletion when %s', async (_label, afterwards) => {
        const row = baseRow({ videoFiles: videos(1) });
        const fixture = makeFixture(row);
        fixture.recordedDB.findId.mockResolvedValueOnce(row).mockResolvedValue(afterwards as RecordedRowStub);

        await fixture.model.deleteVideoFile(1);

        expect(fixture.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(1);
        expect(fixture.recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(fixture.recordedEvent.emitDeleteVideoFile).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('deletes a video file whose recorded row is gone without looking at its recording state', async () => {
        const fixture = makeFixture(baseRow({ videoFiles: videos(1) }));
        fixture.recordedDB.findId.mockResolvedValue(null as unknown as RecordedRowStub);

        await fixture.model.deleteVideoFile(1);

        expect(fixture.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(1);
        expect(fixture.recordedEvent.emitDeleteVideoFile).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('rejects a protected recorded unless protection is ignored, and always accepts an unprotected one', async () => {
        const protectedRow = baseRow({ isProtected: true, videoFiles: videos(2) });
        const rejected = makeFixture(protectedRow);
        await expect(rejected.model.deleteVideoFile(1)).rejects.toThrow('RecordedIsProtected');
        expect(rejected.videoFileDB.deleteOnce).not.toHaveBeenCalled();

        const ignored = makeFixture(baseRow({ isProtected: true, videoFiles: videos(2) }));
        await expect(ignored.model.deleteVideoFile(1, true)).resolves.toBeUndefined();
        expect(ignored.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(1);

        const open = makeFixture(baseRow({ videoFiles: videos(2) }));
        await expect(open.model.deleteVideoFile(1)).resolves.toBeUndefined();
        expect(open.videoFileDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(1);
    });
});

describe('[RC-9.2] creating a recorded row from the minimum or the full set of options', () => {
    const required = { channelId: 3, endAt: 2_000, name: 'synthetic-name', startAt: 1_000 };
    const optionalKeys = [
        'ruleId',
        'description',
        'halfWidthDescription',
        'extended',
        'halfWidthExtended',
        'genre1',
        'subGenre1',
        'genre2',
        'subGenre2',
        'genre3',
        'subGenre3',
    ];

    it('does not set any optional column that was not given', async () => {
        const fixture = makeFixture(baseRow());

        await expect(fixture.model.createNewRecorded(required)).resolves.toBe(77);

        const inserted = fixture.recordedDB.insertOnce.mock.calls[0][0];
        expect(inserted).toMatchObject({ channelId: 3, duration: 1_000, isProtected: false, isRecording: false });
        expect(optionalKeys.filter(key => Object.prototype.hasOwnProperty.call(inserted, key))).toEqual([]);
        expect(fixture.recordedEvent.emitCreateNewRecorded).toHaveBeenCalledExactlyOnceWith(77);
    });

    it('copies every optional column that was given', async () => {
        const fixture = makeFixture(baseRow());

        await fixture.model.createNewRecorded({
            ...required,
            description: 'synthetic-description',
            extended: 'synthetic-extended',
            genre1: 1,
            genre2: 2,
            genre3: 3,
            ruleId: 9,
            subGenre1: 11,
            subGenre2: 12,
            subGenre3: 13,
        });

        expect(fixture.recordedDB.insertOnce.mock.calls[0][0]).toMatchObject({
            description: 'synthetic-description',
            extended: 'synthetic-extended',
            genre1: 1,
            genre2: 2,
            genre3: 3,
            ruleId: 9,
            subGenre1: 11,
            subGenre2: 12,
            subGenre3: 13,
        });
    });
});

describe('[RC-9.9] video file cleanup removes only what is neither registered nor protected', () => {
    it('removes orphan files, then orphan directories from the deepest, and keeps directories of registered files', async () => {
        const fixture = makeFixture(baseRow());
        fixture.videoFileDB.findAll.mockResolvedValue([{ id: 1, filePath: 'keep/registered.ts' }]);
        const identity = { synthetic: 'identity' };
        vi.spyOn(FileUtil, 'stat').mockResolvedValue({});
        vi.spyOn(FileUtil, 'captureManagedRootIdentity').mockReturnValue(identity);
        vi.spyOn(FileUtil, 'getFileList').mockResolvedValue({
            directories: ['synthetic-root/a', 'synthetic-root/abc/def', 'synthetic-root/keep', 'synthetic-root/xy'],
            files: ['synthetic-root/keep/registered.ts', 'synthetic-root/orphan.ts'],
        });
        vi.spyOn(FileUtil, 'isManagedEntrySafeForRemoval').mockReturnValue(true);
        vi.spyOn(FileUtil, 'isEmptyDirectory').mockResolvedValue(true);
        const unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);
        const rmdir = vi.spyOn(FileUtil, 'rmdir').mockResolvedValue(undefined);

        await fixture.model.videoFileCleanup();

        expect(unlink.mock.calls).toEqual([['synthetic-root/orphan.ts']]);
        expect(rmdir.mock.calls).toEqual([['synthetic-root/abc/def'], ['synthetic-root/xy'], ['synthetic-root/a']]);
    });

    it('does not list anything for removal when the managed roots have no entries', async () => {
        const fixture = makeFixture(baseRow());
        vi.spyOn(FileUtil, 'captureManagedRootIdentity').mockReturnValue({});
        vi.spyOn(FileUtil, 'getFileList').mockResolvedValue({ directories: [], files: [] });
        vi.spyOn(FileUtil, 'isManagedEntrySafeForRemoval').mockReturnValue(true);
        const unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);
        const rmdir = vi.spyOn(FileUtil, 'rmdir').mockResolvedValue(undefined);

        await fixture.model.videoFileCleanup();

        expect(unlink).not.toHaveBeenCalled();
        expect(rmdir).not.toHaveBeenCalled();
    });
});
