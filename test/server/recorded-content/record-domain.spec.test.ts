import 'reflect-metadata';

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
const RecordedManageModel = load<{ prototype: Record<string, unknown> }>(
    'model/operator/recorded/RecordedManageModel.js',
);
const RecorderModel = load<{ prototype: Record<string, unknown> }>('model/operator/recording/RecorderModel.js');
const RecordingUtilModel = load<{ prototype: Record<string, unknown> }>(
    'model/operator/recording/RecordingUtilModel.js',
);
const RecordedItemUtil = load<new () => any>('model/api/RecordedItemUtil.js');
const FileUtil = require(join(snapshot, 'util', 'FileUtil.js')).default;
afterEach(() => {
    vi.restoreAllMocks();
});

const managementSubject = () => {
    const value: any = Object.create(RecordedManageModel.prototype);
    value.log = { system: { info: vi.fn(), error: vi.fn() } };
    value.recordedDB = { insertOnce: vi.fn(async () => 401) };
    value.videoFileDB = { insertOnce: vi.fn(async () => 402) };
    value.recordedEvent = { emitCreateNewRecorded: vi.fn(), emitAddVideoFile: vi.fn() };
    value.videoUtil = { getParentDirPath: vi.fn(() => 'synthetic-storage-root') };
    return value;
};

const recorderSubject = () => {
    const value: any = Object.create(RecorderModel.prototype);
    value.log = {
        stream: { fatal: vi.fn() },
        system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
    };
    value.reserve = {
        audioComponentType: 4,
        audioSamplingRate: 48_000,
        channelId: 101,
        description: 'Synthetic description',
        endAt: 2_000,
        extended: 'Synthetic extended',
        genre1: 1,
        genre2: 2,
        genre3: 3,
        halfWidthDescription: 'Synthetic description',
        halfWidthExtended: 'Synthetic extended',
        halfWidthName: 'Synthetic programme',
        id: 91,
        isEventRelay: false,
        isTimeSpecified: false,
        name: 'Synthetic programme',
        programId: 92,
        rawExtended: null,
        rawHalfWidthExtended: null,
        ruleId: 93,
        startAt: 1_000,
        subGenre1: 11,
        subGenre2: 12,
        subGenre3: 13,
        videoComponentType: 5,
        videoResolution: '1080i',
        videoStreamContent: 6,
        videoType: 'mpeg2',
    };
    value.isPlanToDelete = false;
    value.isRecording = true;
    value.recordedId = null;
    value.videoFileId = null;
    value.videoFileFulPath = null;
    value.dropLogFileId = null;
    value.pendingRegistrationResources = null;
    value.destroyStream = vi.fn();
    value.recordedDB = { insertOnce: vi.fn(async () => 94) };
    value.videoFileDB = { insertOnce: vi.fn(async () => 95) };
    return value;
};

describe('recorded content domain specification', () => {
    it('[RC-1.1] persists a recorded programme with its timing, channel, state, and searchable fields', async () => {
        const subject = managementSubject();

        await expect(
            subject.createNewRecorded({
                channelId: 101,
                description: 'Ｓｙｎｔｈｅｔｉｃ description',
                endAt: 2_500,
                extended: 'Ｓｙｎｔｈｅｔｉｃ extended',
                genre1: 1,
                genre2: 2,
                genre3: 3,
                name: 'Ｓｙｎｔｈｅｔｉｃ programme',
                ruleId: 41,
                startAt: 1_000,
                subGenre1: 11,
                subGenre2: 12,
                subGenre3: 13,
            }),
        ).resolves.toBe(401);

        expect(subject.recordedDB.insertOnce).toHaveBeenCalledWith(
            expect.objectContaining({
                channelId: 101,
                description: 'Ｓｙｎｔｈｅｔｉｃ description',
                duration: 1_500,
                endAt: 2_500,
                extended: 'Ｓｙｎｔｈｅｔｉｃ extended',
                genre1: 1,
                genre2: 2,
                genre3: 3,
                halfWidthDescription: 'Synthetic description',
                halfWidthExtended: 'Synthetic extended',
                halfWidthName: 'Synthetic programme',
                isProtected: false,
                isRecording: false,
                name: 'Ｓｙｎｔｈｅｔｉｃ programme',
                ruleId: 41,
                startAt: 1_000,
                subGenre1: 11,
                subGenre2: 12,
                subGenre3: 13,
            }),
        );
    });

    it('[RC-1.2] projects zero, one, and multiple video-file relations for the same recorded programme', () => {
        const itemUtil = new RecordedItemUtil();
        const base = {
            channelId: 101,
            endAt: 2_000,
            halfWidthName: 'Synthetic programme',
            id: 44,
            isProtected: false,
            isRecording: false,
            name: 'Synthetic programme',
            programId: null,
            ruleId: null,
            startAt: 1_000,
        };

        expect(itemUtil.convertRecordedToRecordedItem({ ...base, videoFiles: [] }, false).videoFiles).toEqual([]);
        expect(
            itemUtil.convertRecordedToRecordedItem(
                {
                    ...base,
                    videoFiles: [{ filePath: 'synthetic-one.ts', id: 45, name: 'Synthetic one', size: 10, type: 'ts' }],
                },
                false,
            ).videoFiles,
        ).toEqual([{ filename: 'synthetic-one.ts', id: 45, name: 'Synthetic one', size: 10, type: 'ts' }]);
        expect(
            itemUtil.convertRecordedToRecordedItem(
                {
                    ...base,
                    videoFiles: [
                        { filePath: 'nested/synthetic-a.ts', id: 46, name: 'Synthetic A', size: 11, type: 'ts' },
                        { filePath: 'nested/synthetic-b.mp4', id: 47, name: 'Synthetic B', size: 12, type: 'mp4' },
                    ],
                },
                false,
            ).videoFiles,
        ).toEqual([
            { filename: 'synthetic-a.ts', id: 46, name: 'Synthetic A', size: 11, type: 'ts' },
            { filename: 'synthetic-b.mp4', id: 47, name: 'Synthetic B', size: 12, type: 'mp4' },
        ]);
    });

    it('[RC-1.3] projects the drop log, thumbnails, tags, and reservation-rule relation with a recorded programme', () => {
        const item = new RecordedItemUtil().convertRecordedToRecordedItem(
            {
                channelId: 101,
                dropLogFile: { dropCnt: 2, errorCnt: 1, id: 51, scramblingCnt: 3 },
                endAt: 2_000,
                halfWidthName: 'Synthetic programme',
                id: 50,
                isProtected: false,
                isRecording: false,
                name: 'Synthetic programme',
                programId: null,
                ruleId: 52,
                startAt: 1_000,
                tags: [{ color: '#010203', id: 53, name: 'Synthetic tag' }],
                thumbnails: [{ id: 54 }],
            },
            false,
        );

        expect(item).toMatchObject({
            dropLogFile: { dropCnt: 2, errorCnt: 1, id: 51, scramblingCnt: 3 },
            ruleId: 52,
            tags: [{ color: '#010203', id: 53, name: 'Synthetic tag' }],
            thumbnails: [54],
        });
    });

    it('[RC-1.4] persists storage, relative name, type, display name, and measured size for a video file', async () => {
        const subject = managementSubject();
        vi.spyOn(FileUtil, 'getFileSize').mockResolvedValue(4_096);

        await expect(
            subject.addVideoFile({
                filePath: 'nested/synthetic-existing.ts',
                name: 'Synthetic existing file',
                parentDirectoryName: 'synthetic-storage',
                recordedId: 55,
                type: 'ts',
            }),
        ).resolves.toBe(402);

        expect(FileUtil.getFileSize).toHaveBeenCalledWith(
            join('synthetic-storage-root', 'nested/synthetic-existing.ts'),
        );
        expect(subject.videoFileDB.insertOnce).toHaveBeenCalledWith(
            expect.objectContaining({
                filePath: 'nested/synthetic-existing.ts',
                name: 'Synthetic existing file',
                parentDirectoryName: 'synthetic-storage',
                recordedId: 55,
                size: 4_096,
                type: 'ts',
            }),
        );
    });

    it('[RC-1.5] starts one notification after persistence success and none after persistence failure', async () => {
        const ledger: string[] = [];
        const subject: any = Object.create(RecordedManageModel.prototype);
        subject.log = { system: { info: vi.fn(), error: vi.fn() } };
        subject.recordedDB = {
            insertOnce: vi.fn(async () => {
                ledger.push('persisted');
                return 46;
            }),
        };
        subject.recordedEvent = { emitCreateNewRecorded: vi.fn(() => ledger.push('event-started')) };
        const option = { channelId: 101, startAt: 1_000, endAt: 2_000, name: 'Synthetic Programme' };

        await expect(subject.createNewRecorded(option)).resolves.toBe(46);
        expect(ledger).toEqual(['persisted', 'event-started']);
        expect(subject.recordedEvent.emitCreateNewRecorded).toHaveBeenCalledOnce();

        const failure = new Error('SYNTHETIC_RECORDED_INSERT_REJECTION');
        subject.recordedDB.insertOnce = vi.fn(async () => {
            throw failure;
        });
        await expect(subject.createNewRecorded(option)).rejects.toBe(failure);
        expect(ledger).toEqual(['persisted', 'event-started']);
        expect(subject.recordedEvent.emitCreateNewRecorded).toHaveBeenCalledOnce();
    });

    it('[RC-3.1] builds and persists an active recorded result from the post-start reservation fields', async () => {
        const subject = recorderSubject();

        await expect(
            subject.addRecorded({
                fileName: 'synthetic-record.ts',
                fullPath: 'synthetic-root/synthetic-record.ts',
                parendDir: { name: 'synthetic-storage' },
                subDir: 'nested',
            }),
        ).resolves.toMatchObject({
            channelId: 101,
            endAt: 2_000,
            id: 94,
            isRecording: true,
            name: 'Synthetic programme',
            reserveId: 91,
            ruleId: 93,
            startAt: 1_000,
        });

        expect(subject.recordedDB.insertOnce).toHaveBeenCalledWith(
            expect.objectContaining({
                channelId: 101,
                duration: 1_000,
                isRecording: true,
                programId: 92,
                reserveId: 91,
                ruleId: 93,
            }),
        );
    });

    it('[RC-3.2] associates the received recording file with only the newly persisted recorded result', async () => {
        const subject = recorderSubject();
        subject.createRecorded = vi.fn(async () => ({ id: 0 }));

        await expect(
            subject.addRecorded({
                fileName: 'synthetic-record.ts',
                fullPath: 'synthetic-root/synthetic-record.ts',
                parendDir: { name: 'synthetic-storage' },
                subDir: 'nested',
            }),
        ).resolves.toMatchObject({ id: 94 });

        expect(subject.videoFileDB.insertOnce).toHaveBeenCalledWith(
            expect.objectContaining({
                filePath: 'nested/synthetic-record.ts',
                name: 'TS',
                parentDirectoryName: 'synthetic-storage',
                recordedId: 94,
                type: 'ts',
            }),
        );
        expect(subject.videoFileDB.insertOnce.mock.calls[0][0].recordedId).not.toBe(91);
    });

    it('[RC-3.3] associates a drop-log relation only when the recording has an active drop-log id', async () => {
        const subject = recorderSubject();
        subject.dropLogFileId = 96;

        await expect(subject.createRecorded()).resolves.toMatchObject({ dropLogFileId: 96 });

        subject.dropLogFileId = null;
        await expect(subject.createRecorded()).resolves.not.toHaveProperty('dropLogFileId');
    });

    it('[RC-3.4] moves a completed temporary recording and updates its storage relation to the moved path', async () => {
        const ledger: string[] = [];
        const destinationHandle = {
            stat: vi.fn(async () => ({ dev: 1, ino: 2 })),
            close: vi.fn(async () => undefined),
        };
        const subject: any = Object.create(RecordingUtilModel.prototype);
        subject.log = { system: { debug: vi.fn(), error: vi.fn(), info: vi.fn() } };
        subject.config = { recordedTmp: 'synthetic-incoming' };
        subject.videoUtil = { getFullFilePathFromId: vi.fn(async () => 'synthetic-incoming/record.ts') };
        subject.getRecPath = vi.fn(async () => ({
            fileName: 'record.ts',
            fullPath: 'synthetic-output/nested/record.ts',
            parendDir: { name: 'synthetic-storage', path: 'synthetic-output' },
            subDir: 'nested',
            fileHandle: destinationHandle,
        }));
        subject.videoFileDB = { updateFilePath: vi.fn(async () => ledger.push('path-updated')) };
        vi.spyOn(fs.promises, 'rename').mockImplementation(async () => {
            ledger.push('moved');
        });

        await expect(subject.movingFromTmp({}, 97)).resolves.toBe('synthetic-output/nested/record.ts');
        expect(ledger).toEqual(['moved', 'path-updated']);
        expect(destinationHandle.close).toHaveBeenCalledOnce();
        expect(subject.videoFileDB.updateFilePath).toHaveBeenCalledWith({
            filePath: 'nested/record.ts',
            parentDirectoryName: 'synthetic-storage',
            videoFileId: 97,
        });
    });

    it('[RC-3.5] clears active recording state and requests the final file-size update at recording completion', async () => {
        const subject: any = Object.create(RecorderModel.prototype);
        subject.log = { system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() }, stream: { fatal: vi.fn() } };
        subject.config = {};
        subject.deletionStop = null;
        subject.destroyStream = vi.fn();
        subject.dropCheckerStopLifetime = null;
        subject.dropLogFileId = null;
        subject.eventRelayTimerId = null;
        subject.finalizationContinuations = new Set();
        subject.finalizationLifetime = null;
        subject.isDropCheckerActive = false;
        subject.isNeedDeleteReservation = false;
        subject.isPlanToDelete = false;
        subject.isRecording = true;
        subject.pendingRegistrationResources = null;
        subject.preparationLifetime = null;
        subject.recFileCloseTerminal = null;
        subject.recordedId = 98;
        subject.recordedHistoryDB = { insertOnce: vi.fn() };
        subject.recordedDB = {
            findId: vi.fn(async () => ({ channelId: 101, endAt: 2_000, halfWidthName: 'Synthetic' })),
            removeRecording: vi.fn(async () => undefined),
        };
        subject.recordingEvent = { emitFinishRecording: vi.fn() };
        subject.recordingUtil = { updateVideoFileSize: vi.fn(async () => undefined) };
        subject.reserve = { id: 99, isEventRelay: false, isTimeSpecified: false, ruleId: null };
        subject.retryAttempt = null;
        subject.retryLifecycleToken = 0n;
        subject.retryTimerId = null;
        subject.scheduleBinding = null;
        subject.updateDropFileLog = vi.fn(async () => undefined);
        subject.videoFileFulPath = 'synthetic-output/record.ts';
        subject.videoFileId = 100;

        await subject.recEnd();

        expect(subject.recordedDB.removeRecording).toHaveBeenCalledWith(98);
        expect(subject.recordingUtil.updateVideoFileSize).toHaveBeenCalledWith(100);
        expect(subject.recordingEvent.emitFinishRecording).toHaveBeenCalledWith(
            subject.reserve,
            expect.objectContaining({ channelId: 101 }),
            false,
        );
    });
});
