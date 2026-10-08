import 'reflect-metadata';

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
const RecorderModel = load<{ prototype: Record<string, unknown> }>('model/operator/recording/RecorderModel.js');
const RecordingUtilModel = load<new (...args: any[]) => any>('model/operator/recording/RecordingUtilModel.js');
const RecordedEvent = load<new (logger: unknown) => any>('model/event/RecordedEvent.js');
const RecordedItemUtil = load<new () => any>('model/api/RecordedItemUtil.js');
const RecordedDB = load<new (...args: any[]) => any>('model/db/RecordedDB.js');
const EncodeManageModel = load<{ prototype: { getRecordedIndex(): Record<number, unknown[]> } }>(
    'model/service/encode/EncodeManageModel.js',
);
const FileUtil = require(join(snapshot, 'util', 'FileUtil.js')).default;
afterEach(() => {
    vi.restoreAllMocks();
});

const logger = () => {
    const value = { system: { error: vi.fn(), info: vi.fn() } };
    return { getLogger: () => value };
};

const recorded = (id: number) => ({
    id,
    ruleId: null,
    programId: null,
    channelId: 101,
    startAt: 1_000,
    endAt: 2_000,
    name: 'Synthetic',
    halfWidthName: 'Synthetic',
    description: null,
    extended: null,
    rawExtended: null,
    genre1: null,
    genre2: null,
    genre3: null,
    subGenre1: null,
    subGenre2: null,
    subGenre3: null,
    videoType: null,
    videoResolution: null,
    videoStreamContent: null,
    videoComponentType: null,
    audioSamplingRate: null,
    audioComponentType: null,
    isRecording: false,
    isProtected: false,
});

describe('recorded content implementation characterization', () => {
    it('zero-one-many-and-not-found', async () => {
        const query: any = {
            getMany: vi
                .fn()
                .mockResolvedValueOnce([recorded(611)])
                .mockResolvedValueOnce([recorded(612), recorded(613)])
                .mockResolvedValueOnce([]),
            leftJoinAndSelect: vi.fn(function () {
                return this;
            }),
            orderBy: vi.fn(function () {
                return this;
            }),
            where: vi.fn(function () {
                return this;
            }),
        };
        const connection = { getRepository: vi.fn(() => ({ createQueryBuilder: vi.fn(() => query) })) };
        const operator = { getConnection: vi.fn(async () => connection) };
        const retry = { run: vi.fn((operation: () => unknown) => operation()) };
        const database = new RecordedDB(operator, retry);

        await expect(database.findIds([])).resolves.toEqual([]);
        expect(operator.getConnection).not.toHaveBeenCalled();

        await expect(database.findIds([611])).resolves.toEqual([recorded(611)]);
        await expect(database.findIds([612, 613])).resolves.toEqual([recorded(612), recorded(613)]);
        await expect(database.findId(614)).resolves.toBeNull();

        expect(operator.getConnection).toHaveBeenCalledTimes(3);
        expect(query.getMany).toHaveBeenCalledTimes(3);
    });

    it('[RC-1.5-CHARACTERIZATION] starts an async subscriber synchronously without awaiting its completion', async () => {
        const event = new RecordedEvent(logger());
        let release!: () => void;
        const pending = new Promise<void>(resolve => {
            release = resolve;
        });
        const ledger: string[] = [];
        event.setCreateNewRecorded(async (id: number) => {
            ledger.push(`start:${id}`);
            await pending;
            ledger.push(`finish:${id}`);
        });

        expect(event.emitCreateNewRecorded(44)).toBeUndefined();
        expect(ledger).toEqual(['start:44']);
        release();
        await pending;
        await Promise.resolve();
        expect(ledger).toEqual(['start:44', 'finish:44']);
    });

    it('[RC-1.5-CHARACTERIZATION-REJECTION] logs subscriber rejection without propagating it to emit', async () => {
        const testLogger = logger();
        const event = new RecordedEvent(testLogger);
        const failure = new Error('SYNTHETIC_LISTENER_REJECTION');
        event.setAddVideoFile(async () => {
            throw failure;
        });

        expect(event.emitAddVideoFile(45)).toBeUndefined();
        await new Promise(resolve => setImmediate(resolve));
        expect(testLogger.getLogger().system.error).toHaveBeenCalledWith(failure);
    });

    it('[RC-2.5-CHARACTERIZATION] indexes running before waiting, skips null jobs, and projects key presence', () => {
        const encode = Object.create(EncodeManageModel.prototype) as any;
        encode.runningQueue = [
            { getEncodeOption: () => ({ recordedId: 5, encodeId: 51, mode: 'running' }) },
            { getEncodeOption: () => null },
        ];
        encode.waitQueue = [
            { getEncodeOption: () => ({ recordedId: 5, encodeId: 52, mode: 'waiting' }) },
            { getEncodeOption: () => null },
        ];

        expect(encode.getRecordedIndex()).toEqual({
            5: [
                { encodeId: 51, name: 'running' },
                { encodeId: 52, name: 'waiting' },
            ],
        });
        expect(new RecordedItemUtil().convertRecordedToRecordedItem(recorded(5), false, { 5: [] }).isEncoding).toBe(
            true,
        );
    });

    it('[RC-2.5-CHARACTERIZATION] skips null encode-option jobs in both queues when projecting encode info', () => {
        const encode = Object.create(EncodeManageModel.prototype) as any;
        encode.runningQueue = [{ getEncodeOption: () => null }];
        encode.waitQueue = [{ getEncodeOption: () => null }];

        expect(encode.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
    });

    it('[RC-2.5-CHARACTERIZATION] omits the configured directory from the finish file path when it is absent', () => {
        const encode = Object.create(EncodeManageModel.prototype) as any;

        const result = encode.createFinishEncodeInfo('output/root/synthetic.mp4', {
            encodeId: 1,
            mode: 'synthetic-mode',
            parentDir: 'synthetic-parent',
            recordedId: 71,
            removeOriginal: false,
            sourceVideoFileId: 72,
        });

        expect(result.filePath).toBe('synthetic.mp4');
    });

    it('characterizes convertRecordedToRecordedItem half-width name/description/extended/rawExtended projection', () => {
        const itemUtil = new RecordedItemUtil();
        const recorded = {
            channelId: 101,
            description: 'Ｆｕｌｌ description',
            endAt: 2_000,
            extended: 'Ｆｕｌｌ extended',
            halfWidthDescription: 'Half description',
            halfWidthExtended: 'Half extended',
            halfWidthName: 'Half programme',
            id: 60,
            isProtected: false,
            isRecording: false,
            name: 'Ｆｕｌｌ programme',
            programId: 61,
            rawExtended: JSON.stringify({ source: 'full' }),
            rawHalfWidthExtended: JSON.stringify({ source: 'half' }),
            ruleId: null,
            startAt: 1_000,
        };

        const halfWidth = itemUtil.convertRecordedToRecordedItem(recorded, true);

        expect(halfWidth).toMatchObject({
            description: 'Half description',
            extended: 'Half extended',
            id: 60,
            name: 'Half programme',
            programId: 61,
            rawExtended: { source: 'half' },
        });
        expect(halfWidth).not.toMatchObject({
            description: 'Ｆｕｌｌ description',
            extended: 'Ｆｕｌｌ extended',
            name: 'Ｆｕｌｌ programme',
            rawExtended: { source: 'full' },
        });
    });

    it('characterizes convertRecordedToRecordedItem omit of non-string half-width text and rawExtended full-width fallback', () => {
        const item = new RecordedItemUtil().convertRecordedToRecordedItem(
            {
                channelId: 101,
                description: 'Ｆｕｌｌ description',
                endAt: 2_000,
                extended: 'Ｆｕｌｌ extended',
                halfWidthDescription: null,
                halfWidthExtended: null,
                halfWidthName: 'Half programme',
                id: 62,
                isProtected: false,
                isRecording: false,
                name: 'Ｆｕｌｌ programme',
                programId: 63,
                rawExtended: JSON.stringify({ source: 'full-fallback' }),
                rawHalfWidthExtended: null,
                ruleId: null,
                startAt: 1_000,
            },
            true,
        );

        expect(item).toMatchObject({
            id: 62,
            name: 'Half programme',
            programId: 63,
            rawExtended: { source: 'full-fallback' },
        });
        expect(item).not.toHaveProperty('description');
        expect(item).not.toHaveProperty('extended');
    });

    it('[RC-3.1/3.2] deletes the created recorded row when the later non-transactional video insert fails', async () => {
        const subject: any = Object.create(RecorderModel.prototype);
        const failure = new Error('SYNTHETIC_VIDEO_INSERT_REJECTION');
        const unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);
        subject.log = { system: { info: vi.fn(), error: vi.fn() } };
        subject.reserve = { id: 91 };
        subject.recordedDB = { insertOnce: vi.fn(async () => 92), deleteOnce: vi.fn(async () => undefined) };
        subject.videoFileDB = {
            insertOnce: vi.fn(async () => {
                throw failure;
            }),
        };
        subject.createRecorded = vi.fn(async () => ({ id: 0 }));
        subject.destroyStream = vi.fn();
        subject.stream = null;

        await expect(
            subject.addRecorded({
                parendDir: { name: 'synthetic-storage' },
                subDir: 'nested',
                fileName: 'record.ts',
                fullPath: 'synthetic-owned-record.ts',
            }),
        ).rejects.toThrow('AddRecordedDBError');
        expect(subject.recordedDB.insertOnce).toHaveBeenCalledOnce();
        expect(subject.videoFileDB.insertOnce).toHaveBeenCalledOnce();
        expect(subject.recordedDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(92);
        expect(subject.recordedId).toBeNull();
        expect(unlink).toHaveBeenCalledWith('synthetic-owned-record.ts');
    });

    it('[RC-3.4] requests the moved storage and relative path before returning the destination', async () => {
        const ledger: string[] = [];
        const destinationHandle = {
            stat: vi.fn(async () => ({ dev: 1, ino: 2 })),
            close: vi.fn(async () => undefined),
        };
        const util: any = Object.create(RecordingUtilModel.prototype);
        util.log = { system: { info: vi.fn(), debug: vi.fn(), error: vi.fn() } };
        util.config = { recordedTmp: 'synthetic-incoming' };
        util.videoUtil = { getFullFilePathFromId: vi.fn(async () => 'synthetic-incoming/record.ts') };
        util.getRecPath = vi.fn(async () => ({
            parendDir: { name: 'synthetic-storage', path: 'synthetic-output' },
            subDir: 'nested',
            fileName: 'record.ts',
            fullPath: 'synthetic-output/nested/record.ts',
            fileHandle: destinationHandle,
        }));
        util.videoFileDB = { updateFilePath: vi.fn(async () => ledger.push('path-updated')) };
        vi.spyOn(fs.promises, 'rename').mockImplementation(async () => {
            ledger.push('moved');
        });

        await expect(util.movingFromTmp({}, 93)).resolves.toBe('synthetic-output/nested/record.ts');
        expect(ledger).toEqual(['moved', 'path-updated']);
        expect(destinationHandle.close).toHaveBeenCalledOnce();
        expect(util.videoFileDB.updateFilePath).toHaveBeenCalledWith({
            filePath: 'nested/record.ts',
            parentDirectoryName: 'synthetic-storage',
            videoFileId: 93,
        });
    });

    it('[RC-3.5-DEFECT] requests size without awaiting it before history and finish notification', async () => {
        const ledger: string[] = [];
        let resolveSize!: () => void;
        const sizePending = new Promise<void>(resolve => {
            resolveSize = resolve;
        });
        const subject: any = Object.create(RecorderModel.prototype);
        subject.log = { system: { info: vi.fn(), error: vi.fn(), fatal: vi.fn() }, stream: { fatal: vi.fn() } };
        subject.destroyStream = vi.fn();
        subject.scheduleBinding = null;
        subject.retryTimerId = null;
        subject.retryAttempt = null;
        subject.retryLifecycleToken = 0n;
        subject.preparationLifetime = null;
        subject.deletionStop = null;
        subject.isDropCheckerActive = false;
        subject.dropCheckerStopLifetime = null;
        subject.finalizationLifetime = null;
        subject.finalizationContinuations = new Set();
        subject.pendingRegistrationResources = null;
        subject.eventRelayTimerId = null;
        subject.isPlanToDelete = false;
        subject.recFileCloseTerminal = null;
        subject.recordedId = 94;
        subject.videoFileId = 95;
        subject.videoFileFulPath = 'synthetic-output/record.ts';
        subject.dropLogFileId = null;
        subject.config = {};
        subject.isNeedDeleteReservation = true;
        subject.reserve = { id: 96, isTimeSpecified: false, ruleId: 97, isEventRelay: false };
        subject.recordedDB = {
            removeRecording: vi.fn(async () => ledger.push('recording-removed')),
            findId: vi.fn(async () => ({ halfWidthName: 'Synthetic', channelId: 101, endAt: 20_000 })),
        };
        subject.recordingUtil = {
            updateVideoFileSize: vi.fn(() => {
                ledger.push('size-requested');
                return sizePending;
            }),
        };
        subject.updateDropFileLog = vi.fn(async () => ledger.push('drop-updated'));
        subject.recordedHistoryDB = { insertOnce: vi.fn(async () => ledger.push('history-added')) };
        subject.recordingEvent = { emitFinishRecording: vi.fn(() => ledger.push('finish-emitted')) };

        await subject.recEnd();
        expect(ledger).toEqual([
            'recording-removed',
            'size-requested',
            'drop-updated',
            'history-added',
            'finish-emitted',
        ]);
        resolveSize();
        await sizePending;
    });
});
