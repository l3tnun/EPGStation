import 'reflect-metadata';

import type { ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as apid from '../../../api';
import type IEncodeEvent from '../../../src/model/event/IEncodeEvent';
import type { FinishEncodeInfo } from '../../../src/model/event/IEncodeEvent';
import type { EncodeOption, EncodeProgressInfo } from '../../../src/model/service/encode/IEncoderModel';
import type { ManagedProcessHandle } from '../../../src/model/service/encode/IEncodeProcessManageModel';
import { createDeferred, type Deferred } from '../harness/async';
import { createSyntheticMedia, FFMPEG, FFPROBE, runProcess } from '../harness/synthetic-media';

interface SyntheticEncoder {
    cancel(): Promise<void>;
    finish(): void;
    finishCallback: ((isError: boolean, outputFilePath: string | null) => void) | null;
    getEncodeId(): number | null;
    getEncodeOption(): EncodeOption | null;
    getProgressInfo(): EncodeProgressInfo | null;
    setOnFinish(callback: (isError: boolean, outputFilePath: string | null) => void): void;
    setOption(option: EncodeOption): void;
    start(): Promise<void>;
    startGate: Deferred<void>;
}

interface EncodeManageRuntime {
    admissionReservations: number;
    push(option: apid.AddEncodeProgramOption): Promise<number>;
    getQueuedAndRunningRecordedIds():
        { status: 'known'; recordedIds: ReadonlySet<apid.RecordedId> } | { status: 'unknown' };
    getEncodeInfo(): {
        runningQueue: Array<{ id: number; mode: string; recordedId: number }>;
        waitQueue: Array<{ id: number; mode: string; recordedId: number }>;
    };
}

interface EncodeManageConstructor {
    new (...dependencies: unknown[]): EncodeManageRuntime;
}

interface EncoderRuntime {
    cancel(): Promise<void>;
    childProcess: ChildProcess | null;
    getEncodeId(): number | null;
    getEncodeOption(): EncodeOption | null;
    getProgressInfo(): EncodeProgressInfo | null;
    setOnFinish(callback: (isError: boolean, outputFilePath: string | null) => void): void;
    setOption(option: EncodeOption): void;
    start(): Promise<void>;
}

interface EncoderConstructor {
    new (...dependencies: unknown[]): EncoderRuntime;
}

interface ProcessManagerRuntime {
    childs: unknown[];
    reservations: Set<object>;
    create(option: {
        cmd: string;
        input: string | null;
        output: string | null;
        priority: number;
        spawnOption?: Record<string, unknown>;
    }): Promise<ChildProcess>;
    createManaged(option: {
        cmd: string;
        input: string | null;
        output: string | null;
        priority: number;
        spawnOption?: Record<string, unknown>;
    }): Promise<{ child: ChildProcess; handle: ManagedProcessHandle }>;
    requestStop(handle: ManagedProcessHandle): Promise<unknown>;
}

interface ProcessManagerConstructor {
    new (...dependencies: unknown[]): ProcessManagerRuntime;
}

interface FileManagerRuntime {
    usedFileNameIndex: Record<string, boolean>;
    getFilePath(outputDirPath: string, inputFilePath: string, suffix: string): Promise<string>;
    release(filePath: string): void;
}

interface FileManagerConstructor {
    new (): FileManagerRuntime;
}

interface EncodeApiRuntime {
    add(option: apid.AddManualEncodeProgramOption): Promise<number>;
    cancel(id: number): Promise<void>;
    getAll(isHalfWidth: boolean): Promise<apid.EncodeInfo>;
}

interface EncodeApiConstructor {
    new (...dependencies: unknown[]): EncodeApiRuntime;
}

interface EncodeEventConstructor {
    new (...dependencies: unknown[]): IEncodeEvent;
}

interface EncodeFinishConstructor {
    new (...dependencies: unknown[]): { finishEncode(info: FinishEncodeInfo): Promise<void>; set(): void };
}

interface HttpOperation {
    (req: Record<string, unknown>, res: Record<string, unknown>): Promise<void>;
}

interface ModelContainerRuntime {
    get(identifier: string): unknown;
}

interface IpcClientRuntime {
    readonly encodeEvent: {
        emitFinishEncode(info: { recordedId: number; videoFileId: number | null; mode: string }): Promise<void>;
    };
    readonly recorded: {
        addVideoFile(info: {
            recordedId: number;
            parentDirectoryName: string;
            type: 'encoded';
            name: string;
            filePath: string;
        }): Promise<number>;
        deleteVideoFile(videoFileId: number, isIgnoreProtection?: boolean): Promise<void>;
        updateVideoFileSize(videoFileId: number): Promise<void>;
    };
}

interface IpcServerRuntime {
    readonly encodeCompletionSinkRegistrationPort: {
        register(sink: {
            accept(info: { recordedId: number; videoFileId: number | null; mode: string }): Promise<void>;
        }): void;
    };
    initialize(): Promise<void>;
    register(child: ChildProcess): void;
}

interface IpcClientCleanupRuntime {
    readonly allocationWaiters: unknown[];
    readonly pending: Map<unknown, unknown>;
    readonly recordedUseReleasePending: Map<unknown, unknown>;
}

interface IpcServerCleanupRuntime {
    readonly child: ChildProcess | null;
    readonly currentPeer: unknown | null;
}

interface ExecutionHandle {
    id: string;
    gate: Deferred<string>;
}

interface RecordedResourceUsePort {
    acquire(recordedId: apid.RecordedId, kind: 'encoding'): Promise<{ token: object }>;
    release(token: object): Promise<void>;
}

interface LifecycleJob extends SyntheticEncoder {
    complete(isError: boolean, outputFilePath: string | null): void;
    expireTimer(): void;
    reportProgress(percent: number, log: string): void;
}

interface LifecycleResources {
    managedHandles: Set<object>;
    outputReservations: Set<string>;
    sharedSlotRequests: number[];
    stopRequests: object[];
    timers: Set<object>;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const EncodeManageModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeManageModel.js')) as {
        default: EncodeManageConstructor;
    }
).default;
const EncodeApiModel = (
    require(join(compiledSnapshot, 'model', 'api', 'encode', 'EncodeApiModel.js')) as {
        default: EncodeApiConstructor;
    }
).default;
const EncodeEvent = (
    require(join(compiledSnapshot, 'model', 'event', 'EncodeEvent.js')) as { default: EncodeEventConstructor }
).default;
const EncoderModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncoderModel.js')) as {
        default: EncoderConstructor;
    }
).default;
const EncodeProcessManageModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeProcessManageModel.js')) as {
        default: ProcessManagerConstructor;
    }
).default;
const EncodeFileManageModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeFileManageModel.js')) as {
        default: FileManagerConstructor;
    }
).default;
const EncodeFinishModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeFinishModel.js')) as {
        default: EncodeFinishConstructor;
    }
).default;
const encodeHttp = require(join(compiledSnapshot, 'model', 'service', 'api', 'encode.js')) as {
    get: HttpOperation;
    post: HttpOperation;
};
const encodeIdHttp = require(join(compiledSnapshot, 'model', 'service', 'api', 'encode', '{encodeId}.js')) as {
    del: HttpOperation;
};
const modelContainer = (
    require(join(compiledSnapshot, 'model', 'ModelContainer.js')) as { default: ModelContainerRuntime }
).default;
const IPCClient = (
    require(join(compiledSnapshot, 'model', 'ipc', 'IPCClient.js')) as {
        default: new (...dependencies: unknown[]) => IpcClientRuntime;
    }
).default;
const IPCServer = (
    require(join(compiledSnapshot, 'model', 'ipc', 'IPCServer.js')) as {
        default: new (...dependencies: unknown[]) => IpcServerRuntime;
    }
).default;
const ProcessUtil = (
    require(join(compiledSnapshot, 'util', 'ProcessUtil.js')) as {
        default: { ROOT_PATH: string; kill(child: ChildProcess): Promise<void> };
    }
).default;
const Util = (
    require(join(compiledSnapshot, 'util', 'Util.js')) as {
        default: { sleep(milliseconds: number): Promise<void> };
    }
).default;

const flushEventLoop = async (): Promise<void> => {
    await new Promise<void>(resolve => setImmediate(resolve));
};

const ENCODE_ENV_KEYS = [
    'RECORDEDID',
    'INPUT',
    'OUTPUT',
    'DIR',
    'SUBDIR',
    'FFMPEG',
    'FFPROBE',
    'NAME',
    'HALF_WIDTH_NAME',
    'DESCRIPTION',
    'HALF_WIDTH_DESCRIPTION',
    'EXTENDED',
    'HALF_WIDTH_EXTENDED',
    'VIDEOTYPE',
    'VIDEORESOLUTION',
    'VIDEOSTREAMCONTENT',
    'VIDEOCOMPONENTTYPE',
    'AUDIOSAMPLINGRATE',
    'AUDIOCOMPONENTTYPE',
    'CHANNELID',
    'CHANNELNAME',
    'HALF_WIDTH_CHANNELNAME',
    'GENRE1',
    'SUBGENRE1',
    'GENRE2',
    'SUBGENRE2',
    'GENRE3',
    'SUBGENRE3',
    'START_AT',
    'END_AT',
    'DROPLOG_ID',
    'DROPLOG_PATH',
    'ERROR_CNT',
    'DROP_CNT',
    'SCRAMBLING_CNT',
] as const;
const parentMarkerKey = 'EPGSTATION_SYNTHETIC_PARENT_MARKER';

const request = (recordedId: number): apid.AddManualEncodeProgramOption => ({
    directory: 'synthetic-subdirectory',
    mode: 'synthetic-mode',
    parentDir: 'synthetic-parent',
    recordedId,
    removeOriginal: false,
    sourceVideoFileId: recordedId + 10_000,
});

describe('Tasks 4.3 and 5.1 boundary characterization', () => {
    it('[EN-INTEGRATION-FS-PARTIAL-CLEANUP] removes only the owned abnormal output and survives unlink failure', async () => {
        vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-partial-cleanup-'));
        temporaryRoots.add(root);
        const child = makeSyntheticChild();
        const processManager = makeProcessManagerStub(async () => child);
        const actual = makeActualEncoder(root, processManager, { suffix: '.mp4' });
        await writeFile(actual.inputPath, 'synthetic input');
        const unrelated = join(root, 'unrelated.mp4');
        const output = join(root, 'input.mp4');
        await actual.model.start();
        await Promise.all([writeFile(output, 'partial output'), writeFile(unrelated, 'unrelated output')]);
        const finish = waitForEncoderFinish(actual.model);
        child.emit('exit', 1, null);

        await expect(finish).resolves.toEqual({ isError: true, output });
        await expect(readFile(output)).rejects.toThrow();
        await expect(readFile(actual.inputPath, 'utf8')).resolves.toBe('synthetic input');
        await expect(readFile(unrelated, 'utf8')).resolves.toBe('unrelated output');
        expect(actual.fileManager.usedFileNameIndex).toEqual({});

        const failedRoot = await mkdtemp(join(tmpdir(), 'epgstation-encoding-partial-cleanup-failure-'));
        temporaryRoots.add(failedRoot);
        const failedChild = makeSyntheticChild();
        const failed = makeActualEncoder(
            failedRoot,
            makeProcessManagerStub(async () => failedChild),
            { suffix: '.mp4' },
        );
        await writeFile(failed.inputPath, 'synthetic input');
        await failed.model.start();
        const failedFinish = waitForEncoderFinish(failed.model);
        failedChild.emit('exit', 1, null);

        await expect(failedFinish).resolves.toEqual({ isError: true, output: join(failedRoot, 'input.mp4') });
        expect(failed.logger.encode.error).toHaveBeenCalledWith(
            `delete encode output file failed: ${join(failedRoot, 'input.mp4')}`,
        );
        await expect(readFile(failed.inputPath, 'utf8')).resolves.toBe('synthetic input');
        expect(failed.fileManager.usedFileNameIndex).toEqual({});

        const orphan = join(failedRoot, 'restart-orphan.mp4');
        await writeFile(orphan, 'orphan from an earlier instance');
        const restartedCreate = vi.fn();
        makeActualEncoder(failedRoot, makeProcessManagerStub(restartedCreate), { deferOption: true, suffix: '.mp4' });
        await expect(readFile(orphan, 'utf8')).resolves.toBe('orphan from an earlier instance');
        expect(restartedCreate).not.toHaveBeenCalled();
    });

    it('[EN-INTEGRATION-FS-CLEANUP-QUEUE] advances the running queue after owned-output unlink fails', async () => {
        vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-cleanup-queue-'));
        temporaryRoots.add(root);
        const child = makeSyntheticChild();
        const processManager = makeProcessManagerStub(async () => child);
        const actual = makeActualEncoder(root, processManager, { deferOption: true, suffix: '.mp4' });
        await writeFile(actual.inputPath, 'synthetic input');
        const next = makeEncoder();
        next.startGate.resolve(undefined);
        const logger = {
            encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { error: vi.fn() },
        };
        const event = new EncodeEvent({ getLogger: () => logger });
        let executionId = 0;
        const execution = {
            getExecution: vi.fn(async () => `synthetic-execution-${++executionId}`),
            unLockExecution: vi.fn(),
        };
        const provider = vi.fn().mockResolvedValueOnce(actual.model).mockResolvedValueOnce(next);
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 4 }) },
            execution,
            provider,
            event,
            {
                acquire: vi.fn(async () => ({ token: {} })),
                release: vi.fn(async () => undefined),
            },
        );
        const manageEmitter = (manage as unknown as { listener: EventEmitter }).listener;
        const eventEmitter = (event as unknown as { emitter: EventEmitter }).emitter;

        await manage.push(request(13_001) as apid.AddEncodeProgramOption);
        await vi.waitFor(() => expect(processManager.createManaged).toHaveBeenCalledOnce());
        await manage.push(request(13_002) as apid.AddEncodeProgramOption);
        await vi.waitFor(() => {
            expect(manage.getEncodeInfo()).toMatchObject({ runningQueue: [{ id: 1 }], waitQueue: [{ id: 2 }] });
        });

        child.exitCode = 1;
        child.emit('exit', 1, null);
        await vi.waitFor(() => {
            expect(next.start).toHaveBeenCalledOnce();
            expect(manage.getEncodeInfo()).toMatchObject({ runningQueue: [{ id: 2 }], waitQueue: [] });
        });
        expect(actual.logger.encode.error).toHaveBeenCalledWith(
            `delete encode output file failed: ${join(root, 'synthetic-subdirectory', 'input.mp4')}`,
        );
        await expect(readFile(actual.inputPath, 'utf8')).resolves.toBe('synthetic input');

        next.finish();
        await vi.waitFor(() => expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }));
        manageEmitter.removeAllListeners();
        eventEmitter.removeAllListeners();
    });

    it('[EN-INTEGRATION-RECORDED-RESULT] connects successful result reflection to the recorded-content port', async () => {
        const logger = { encode: { error: vi.fn() }, system: { error: vi.fn() } };
        const event = new EncodeEvent({ getLogger: () => logger });
        const calls: string[] = [];
        const registration = createDeferred<number>();
        const addVideoFile = vi.fn((info: { filePath: string }) => {
            calls.push('add');
            return registration.promise;
        });
        const deleteVideoFile = vi.fn(async (id: number) => calls.push(`delete:${id}`));
        const notifyClient = vi.fn(() => calls.push('ui'));
        const emitFinishEncode = vi.fn(async (info: { mode: string; recordedId: number; videoFileId: number }) => {
            calls.push(`complete:${info.recordedId}:${info.videoFileId}:${info.mode}`);
        });
        const finish = new EncodeFinishModel(
            { getLogger: () => logger },
            { notifyClient, notifyUpdateEncodeProgress: vi.fn() },
            {
                encodeEvent: {
                    emitFinishEncode,
                },
                recorded: {
                    addVideoFile,
                    deleteVideoFile,
                    updateVideoFileSize: vi.fn(async () => undefined),
                },
            },
            event,
        );
        finish.set();

        const settling = finish.finishEncode(resultInfo({ removeOriginal: true }));
        await flushEventLoop();

        expect(addVideoFile).toHaveBeenCalledWith({
            recordedId: 12_001,
            parentDirectoryName: 'synthetic-parent',
            type: 'encoded',
            name: 'synthetic-mode',
            filePath: 'synthetic-output.mp4',
        });
        expect(calls).toEqual(['add']);
        expect(deleteVideoFile).not.toHaveBeenCalled();
        expect(notifyClient).not.toHaveBeenCalled();
        expect(emitFinishEncode).not.toHaveBeenCalled();

        registration.resolve(12_007);
        await settling;

        expect(calls).toEqual(['add', 'delete:12003', 'ui', 'complete:12001:12007:synthetic-mode']);
        expect(logger.system.error).not.toHaveBeenCalled();
        (event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
    });

    it('[EN-INTEGRATION-RECORDED-RESULT-FAILURE] retains the source when size reflection rejects', async () => {
        const logger = { encode: { error: vi.fn() }, system: { error: vi.fn() } };
        const event = new EncodeEvent({ getLogger: () => logger });
        const calls: string[] = [];
        const reflectionError = new Error('synthetic size reflection failure');
        const updateVideoFileSize = vi.fn(async () => {
            calls.push('size');
            throw reflectionError;
        });
        const deleteVideoFile = vi.fn(async () => calls.push('delete'));
        const notifyClient = vi.fn(() => calls.push('ui'));
        const emitFinishEncode = vi.fn(
            async (info: { mode: string; recordedId: number; videoFileId: number | null }) => {
                calls.push(`complete:${info.recordedId}:${String(info.videoFileId)}:${info.mode}`);
            },
        );
        const finish = new EncodeFinishModel(
            { getLogger: () => logger },
            { notifyClient, notifyUpdateEncodeProgress: vi.fn() },
            {
                encodeEvent: { emitFinishEncode },
                recorded: { addVideoFile: vi.fn(), deleteVideoFile, updateVideoFileSize },
            },
            event,
        );
        finish.set();

        await finish.finishEncode(resultInfo({ filePath: null, fullOutputPath: null, removeOriginal: true }));

        expect(calls).toEqual(['size', 'ui', 'complete:12001:null:synthetic-mode']);
        expect(deleteVideoFile).not.toHaveBeenCalled();
        expect(logger.encode.error).toHaveBeenCalledWith(reflectionError);
        expect(logger.system.error).not.toHaveBeenCalled();
        (event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
    });
});

describe('recorded-use result-settlement integration', () => {
    it('[EN-INTEGRATION-RECORDED-USE-SETTLEMENT] releases each exact lease only after successful, reflected-failed, and delete-failed result settlement', async () => {
        const successToken = {};
        const reflectionFailureToken = {};
        const deleteFailureToken = {};
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi
                .fn()
                .mockImplementationOnce(async () => ({ token: successToken }))
                .mockImplementationOnce(async () => ({ token: reflectionFailureToken }))
                .mockImplementationOnce(async () => ({ token: deleteFailureToken }))
                .mockImplementation(async () => {
                    throw new Error('UnexpectedRecordedResourceUseAcquire');
                }),
            release: vi.fn(async () => undefined),
        };
        const logger = {
            encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { error: vi.fn() },
        };
        const event = new EncodeEvent({ getLogger: () => logger });
        const registration = createDeferred<number>();
        const reflectionError = new Error('SyntheticResultReflectionFailure');
        const deleteError = new Error('SyntheticSourceDeleteFailure');
        const addVideoFile = vi
            .fn()
            .mockImplementationOnce(() => registration.promise)
            .mockRejectedValueOnce(reflectionError)
            .mockResolvedValueOnce(13_103);
        const deleteVideoFile = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(deleteError);
        const encoders: SyntheticEncoder[] = [];
        const provider = vi.fn(async () => {
            const encoder = makeEncoder();
            encoder.startGate.resolve(undefined);
            encoders.push(encoder);
            return encoder;
        });
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 3 }) },
            { getExecution: vi.fn(async () => 'synthetic-execution'), unLockExecution: vi.fn() },
            provider,
            event,
            recordedResourceUse,
        );
        const finish = new EncodeFinishModel(
            { getLogger: () => logger },
            { notifyClient: vi.fn(), notifyUpdateEncodeProgress: vi.fn() },
            {
                encodeEvent: { emitFinishEncode: vi.fn(async () => undefined) },
                recorded: { addVideoFile, deleteVideoFile, updateVideoFileSize: vi.fn(async () => undefined) },
            },
            event,
            manage,
        );
        const manageEmitter = (manage as unknown as { listener: EventEmitter }).listener;
        const eventEmitter = (event as unknown as { emitter: EventEmitter }).emitter;
        finish.set();

        try {
            await manage.push({ ...request(13_001), removeOriginal: true });
            await vi.waitFor(() => expect(encoders[0]?.finishCallback).not.toBeNull());
            await manage.push({ ...request(13_002), removeOriginal: true });
            await manage.push({ ...request(13_003), removeOriginal: true });

            const firstTerminal = encoders[0]?.finishCallback;
            if (firstTerminal === null || firstTerminal === undefined) throw new Error('MissingFirstFinishCallback');
            firstTerminal(false, 'successful-settlement.mp4');
            await vi.waitFor(() => expect(addVideoFile).toHaveBeenCalledTimes(1));
            await vi.waitFor(() => expect(encoders[1]?.finishCallback).not.toBeNull());
            expect(recordedResourceUse.release).not.toHaveBeenCalled();

            registration.resolve(13_101);
            await vi.waitFor(() => expect(recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(successToken));

            const secondTerminal = encoders[1]?.finishCallback;
            if (secondTerminal === null || secondTerminal === undefined) throw new Error('MissingSecondFinishCallback');
            secondTerminal(false, 'reflection-failure.mp4');
            await vi.waitFor(() => expect(addVideoFile).toHaveBeenCalledTimes(2));
            await vi.waitFor(() =>
                expect(recordedResourceUse.release).toHaveBeenNthCalledWith(2, reflectionFailureToken),
            );
            await vi.waitFor(() => expect(encoders[2]?.finishCallback).not.toBeNull());

            const thirdTerminal = encoders[2]?.finishCallback;
            if (thirdTerminal === null || thirdTerminal === undefined) throw new Error('MissingThirdFinishCallback');
            thirdTerminal(false, 'delete-failure.mp4');
            await vi.waitFor(() => expect(addVideoFile).toHaveBeenCalledTimes(3));
            await vi.waitFor(() => expect(deleteVideoFile).toHaveBeenCalledTimes(2));
            await vi.waitFor(() => expect(recordedResourceUse.release).toHaveBeenNthCalledWith(3, deleteFailureToken));
            expect(logger.system.error).toHaveBeenCalledWith(deleteError);
        } finally {
            manageEmitter.removeAllListeners();
            eventEmitter.removeAllListeners();
        }
    });
});

describe('deterministic lifecycle integration', () => {
    it('[EN-INTEGRATION-LIFECYCLE-COMMIT-RACE] keeps FIFO resources and exact leases through admission, settlement, cancellation, start failure, and source deletion outcomes', async () => {
        const resources: LifecycleResources = {
            managedHandles: new Set(),
            outputReservations: new Set(),
            sharedSlotRequests: [],
            stopRequests: [],
            timers: new Set(),
        };
        const logger = {
            encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { error: vi.fn() },
        };
        const event = new EncodeEvent({ getLogger: () => logger });
        const added: number[] = [];
        const canceled: number[] = [];
        const progressEvents: number[] = [];
        const errors: number[] = [];
        event.setAddEncode(id => added.push(id));
        event.setCancelEncode(id => canceled.push(id));
        event.setUpdateEncodeProgress(() => progressEvents.push(1));
        event.setErrorEncode(() => errors.push(1));

        const registration = createDeferred<number>();
        const reflectionError = new Error('SyntheticResultReflectionFailure');
        const sourceDeleteError = new Error('SyntheticSourceDeleteFailure');
        const resultCalls: string[] = [];
        let addCall = 0;
        const addVideoFile = vi.fn((info: { recordedId: number }) => {
            resultCalls.push(`add:${info.recordedId}`);
            addCall++;
            if (addCall === 1) return registration.promise;
            if (addCall === 2) return Promise.resolve(90_002);
            return Promise.reject(reflectionError);
        });
        const updateVideoFileSize = vi.fn(async (videoFileId: number) => {
            resultCalls.push(`size:${videoFileId}`);
        });
        const deleteVideoFile = vi.fn(async (videoFileId: number) => {
            resultCalls.push(`delete:${videoFileId}`);
            if (videoFileId === 30_303) throw sourceDeleteError;
        });
        const outcomes: Array<{ recordedId: number; videoFileId: number | null; mode: string }> = [];
        const emitFinishEncode = vi.fn(
            async (info: { recordedId: number; videoFileId: number | null; mode: string }) => {
                outcomes.push(info);
            },
        );

        const firstToken = {};
        const secondToken = {};
        const thirdToken = {};
        const fourthToken = {};
        const fifthToken = {};
        const sixthToken = {};
        const seventhToken = {};
        const tokens = [firstToken, secondToken, thirdToken, fourthToken, fifthToken, sixthToken, seventhToken];
        const heldTokens = new Set<object>();
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi
                .fn()
                .mockImplementationOnce(async () => {
                    heldTokens.add(firstToken);
                    return { token: firstToken };
                })
                .mockImplementationOnce(async () => {
                    heldTokens.add(secondToken);
                    return { token: secondToken };
                })
                .mockImplementationOnce(async () => {
                    heldTokens.add(thirdToken);
                    return { token: thirdToken };
                })
                .mockImplementationOnce(async () => {
                    heldTokens.add(fourthToken);
                    return { token: fourthToken };
                })
                .mockImplementationOnce(async () => {
                    heldTokens.add(fifthToken);
                    return { token: fifthToken };
                })
                .mockImplementationOnce(async () => {
                    heldTokens.add(sixthToken);
                    return { token: sixthToken };
                })
                .mockImplementationOnce(async () => {
                    heldTokens.add(seventhToken);
                    return { token: seventhToken };
                })
                .mockImplementation(async () => {
                    throw new Error('UnexpectedRecordedResourceUseAcquire');
                }),
            release: vi.fn(async token => {
                if (heldTokens.delete(token) === false) throw new Error('DuplicateRecordedResourceUseRelease');
            }),
        };

        const first = makeLifecycleJob(event, resources);
        const second = makeLifecycleJob(event, resources);
        const third = makeLifecycleJob(event, resources);
        const waitingCancel = makeLifecycleJob(event, resources);
        const startFailure = makeLifecycleJob(event, resources, { startError: new Error('SyntheticStartFailure') });
        const deleteFailure = makeLifecycleJob(event, resources, { reservesOutput: false });
        const reflectionFailure = makeLifecycleJob(event, resources);
        const jobs = [first, second, third, waitingCancel, startFailure, deleteFailure, reflectionFailure];
        const provider = vi.fn(async () => {
            const job = jobs.shift();
            if (job === undefined) throw new Error('UnexpectedLifecycleJobRequest');
            return job;
        });
        const activeExecutions = new Set<string>();
        let executionSequence = 0;
        const execution = {
            getExecution: vi.fn(async () => {
                const id = `lifecycle-execution-${++executionSequence}`;
                activeExecutions.add(id);
                return id;
            }),
            unLockExecution: vi.fn((id: string) => activeExecutions.delete(id)),
        };
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 2 }) },
            execution,
            provider,
            event,
            recordedResourceUse,
        );
        const api = new EncodeApiModel(
            manage,
            {},
            { findIds: vi.fn(async (ids: number[]) => ids.map(id => ({ id }))) },
            { convertRecordedToRecordedItem: vi.fn((recorded: { id: number }) => ({ id: recorded.id })) },
        );
        const notifyClient = vi.fn();
        const finish = new EncodeFinishModel(
            { getLogger: () => logger },
            { notifyClient, notifyUpdateEncodeProgress: vi.fn() },
            {
                encodeEvent: { emitFinishEncode },
                recorded: { addVideoFile, deleteVideoFile, updateVideoFileSize },
            },
            event,
            manage,
        );
        const manageEmitter = (manage as unknown as { listener: EventEmitter }).listener;
        const eventEmitter = (event as unknown as { emitter: EventEmitter }).emitter;
        finish.set();
        const requestWithSource = (recordedId: number, sourceVideoFileId: number) => ({
            ...request(recordedId),
            removeOriginal: true,
            sourceVideoFileId,
        });
        const unhandledRejections: unknown[] = [];
        const observeUnhandledRejection = (reason: unknown): void => {
            unhandledRejections.push(reason);
        };
        process.on('unhandledRejection', observeUnhandledRejection);

        try {
            const firstAdmission = api.add(requestWithSource(10_101, 10_101));
            await vi.waitFor(() => expect(first.start).toHaveBeenCalledOnce());
            const secondAdmission = api.add(requestWithSource(20_202, 20_202));
            const thirdAdmission = api.add(requestWithSource(20_203, 20_202));
            await expect(api.add(requestWithSource(40_404, 40_404))).rejects.toThrow('EncodeQueueIsFull');
            await expect(Promise.all([firstAdmission, secondAdmission, thirdAdmission])).resolves.toEqual([1, 2, 3]);
            expect(manage.admissionReservations).toBe(0);
            expect(added).toEqual([1, 2, 3]);
            expect(manage.getEncodeInfo()).toEqual({
                runningQueue: [{ id: 1, mode: 'synthetic-mode', recordedId: 10_101 }],
                waitQueue: [
                    { id: 2, mode: 'synthetic-mode', recordedId: 20_202 },
                    { id: 3, mode: 'synthetic-mode', recordedId: 20_203 },
                ],
            });
            expect(resources).toMatchObject({
                managedHandles: new Set(),
                outputReservations: new Set(),
                timers: new Set(),
            });

            first.startGate.resolve(undefined);
            await vi.waitFor(() => expect(resources.managedHandles.size).toBe(1));
            expect(resources.timers.size).toBe(1);
            expect(resources.outputReservations.size).toBe(1);

            first.complete(false, 'first-output.ts');
            await vi.waitFor(() => expect(addVideoFile).toHaveBeenCalledOnce());
            await vi.waitFor(() => expect(second.start).toHaveBeenCalledOnce());
            expect(deleteVideoFile).not.toHaveBeenCalled();
            expect(recordedResourceUse.release).not.toHaveBeenCalled();
            expect(manage.getEncodeInfo()).toEqual({
                runningQueue: [{ id: 2, mode: 'synthetic-mode', recordedId: 20_202 }],
                waitQueue: [{ id: 3, mode: 'synthetic-mode', recordedId: 20_203 }],
            });

            registration.resolve(90_001);
            await vi.waitFor(() => expect(recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(tokens[0]));
            expect(deleteVideoFile).toHaveBeenCalledExactlyOnceWith(10_101, true);
            expect(outcomes).toEqual([{ recordedId: 10_101, videoFileId: 90_001, mode: 'synthetic-mode' }]);

            second.startGate.resolve(undefined);
            await vi.waitFor(() => expect(resources.managedHandles.size).toBe(1));
            second.reportProgress(42, 'half complete');
            await expect(api.getAll(false)).resolves.toEqual({
                runningItems: [
                    { id: 2, log: 'half complete', mode: 'synthetic-mode', percent: 42, recorded: { id: 20_202 } },
                ],
                waitItems: [{ id: 3, mode: 'synthetic-mode', recorded: { id: 20_203 } }],
            });
            expect(progressEvents).toEqual([1]);

            await expect(api.add(requestWithSource(31_313, 31_313))).resolves.toBe(4);
            await vi.waitFor(() =>
                expect(manage.getEncodeInfo().waitQueue).toEqual([
                    { id: 3, mode: 'synthetic-mode', recordedId: 20_203 },
                    { id: 4, mode: 'synthetic-mode', recordedId: 31_313 },
                ]),
            );
            await api.cancel(4);
            await vi.waitFor(() => expect(recordedResourceUse.release).toHaveBeenNthCalledWith(2, tokens[3]));
            expect(waitingCancel.start).not.toHaveBeenCalled();
            expect(resources.stopRequests).toEqual([]);

            second.complete(false, 'same-source-output.ts');
            await vi.waitFor(() => expect(addVideoFile).toHaveBeenCalledTimes(2));
            await vi.waitFor(() => expect(third.start).toHaveBeenCalledOnce());
            await vi.waitFor(() => expect(recordedResourceUse.release).toHaveBeenNthCalledWith(3, tokens[1]));
            expect(deleteVideoFile).toHaveBeenCalledExactlyOnceWith(10_101, true);
            expect(outcomes).toEqual([
                { recordedId: 10_101, videoFileId: 90_001, mode: 'synthetic-mode' },
                { recordedId: 20_202, videoFileId: 90_002, mode: 'synthetic-mode' },
            ]);

            third.startGate.resolve(undefined);
            await vi.waitFor(() => expect(resources.managedHandles.size).toBe(1));
            await expect(api.add(requestWithSource(40_404, 40_404))).resolves.toBe(5);
            await vi.waitFor(() =>
                expect(manage.getEncodeInfo().waitQueue).toEqual([
                    { id: 5, mode: 'synthetic-mode', recordedId: 40_404 },
                ]),
            );
            third.expireTimer();
            await vi.waitFor(() => expect(resources.stopRequests).toHaveLength(1));
            await api.cancel(3);
            expect(resources.stopRequests).toHaveLength(1);
            third.complete(true, null);
            await vi.waitFor(() => expect(startFailure.start).toHaveBeenCalledOnce());
            startFailure.startGate.resolve(undefined);
            await vi.waitFor(() => expect(recordedResourceUse.release).toHaveBeenNthCalledWith(5, tokens[4]));

            await expect(api.add(requestWithSource(30_303, 30_303))).resolves.toBe(6);
            await vi.waitFor(() => expect(deleteFailure.start).toHaveBeenCalledOnce());
            deleteFailure.startGate.resolve(undefined);
            await vi.waitFor(() => expect(resources.managedHandles.size).toBe(1));
            const notificationsBeforeDeleteFailure = notifyClient.mock.calls.length;
            deleteFailure.complete(false, null);
            await vi.waitFor(() => expect(updateVideoFileSize).toHaveBeenCalledExactlyOnceWith(30_303));
            await vi.waitFor(() => expect(deleteVideoFile).toHaveBeenNthCalledWith(2, 30_303, true));
            await vi.waitFor(() => expect(recordedResourceUse.release).toHaveBeenNthCalledWith(6, tokens[5]));
            expect(notifyClient).toHaveBeenCalledTimes(notificationsBeforeDeleteFailure);

            await expect(api.add(requestWithSource(50_505, 50_505))).resolves.toBe(7);
            await vi.waitFor(() => expect(reflectionFailure.start).toHaveBeenCalledOnce());
            reflectionFailure.startGate.resolve(undefined);
            await vi.waitFor(() => expect(resources.managedHandles.size).toBe(1));
            reflectionFailure.complete(false, 'reflection-failure.ts');
            await vi.waitFor(() => expect(addVideoFile).toHaveBeenCalledTimes(3));
            await vi.waitFor(() => expect(recordedResourceUse.release).toHaveBeenNthCalledWith(7, tokens[6]));

            expect(added).toEqual([1, 2, 3, 4, 5, 6, 7]);
            expect(canceled).toEqual([4, 3]);
            expect(errors).toHaveLength(2);
            expect(outcomes).toEqual([
                { recordedId: 10_101, videoFileId: 90_001, mode: 'synthetic-mode' },
                { recordedId: 20_202, videoFileId: 90_002, mode: 'synthetic-mode' },
                { recordedId: 50_505, videoFileId: null, mode: 'synthetic-mode' },
            ]);
            expect(logger.system.error).toHaveBeenCalledWith(sourceDeleteError);
            expect(logger.encode.error).toHaveBeenCalledWith(reflectionError);
            expect(resultCalls).toEqual([
                'add:10101',
                'delete:10101',
                'add:20202',
                'size:30303',
                'delete:30303',
                'add:50505',
            ]);
            expect(deleteVideoFile).toHaveBeenCalledTimes(2);
            expect(recordedResourceUse.acquire).toHaveBeenCalledTimes(7);
            expect(recordedResourceUse.release).toHaveBeenCalledTimes(7);
            expect(recordedResourceUse.release.mock.calls.map(([token]) => token)).toEqual([
                tokens[0],
                tokens[3],
                tokens[1],
                tokens[2],
                tokens[4],
                tokens[5],
                tokens[6],
            ]);
            expect(heldTokens).toEqual(new Set());
            expect(manage.admissionReservations).toBe(0);
            expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            expect(activeExecutions).toEqual(new Set());
            expect(resources).toEqual({
                managedHandles: new Set(),
                outputReservations: new Set(),
                sharedSlotRequests: [1, 2, 3, 5, 6, 7],
                stopRequests: [expect.any(Object)],
                timers: new Set(),
            });
            expect(
                [first, second, third, waitingCancel, startFailure, deleteFailure, reflectionFailure].every(
                    job => job.finishCallback === null,
                ),
            ).toBe(true);
            expect(unhandledRejections).toEqual([]);
        } finally {
            process.off('unhandledRejection', observeUnhandledRejection);
            manageEmitter.removeAllListeners();
            eventEmitter.removeAllListeners();
            expect(manageEmitter.eventNames()).toEqual([]);
            expect(eventEmitter.eventNames()).toEqual([]);
        }
    });

    it('[EN-INTEGRATION-LIFECYCLE-ACTUAL-DEADLINE] sends one managed stop only at the actual deadline and releases terminal process resources', async () => {
        vi.useFakeTimers();
        try {
            vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);
            const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-lifecycle-deadline-'));
            temporaryRoots.add(root);
            await writeFile(join(root, 'input.ts'), 'synthetic input');
            const logger = { encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
            const processManager = new EncodeProcessManageModel(
                { getLogger: () => logger },
                { getConfig: () => ({ encodeProcessNum: 1 }) },
            );
            const child = makeLifecycleChild();
            const spawned = createDeferred<void>();
            const spawn = vi
                .spyOn(processManager as unknown as { spawnProcess(): ChildProcess }, 'spawnProcess')
                .mockImplementation(() => {
                    spawned.resolve();
                    return child;
                });
            const createManaged = vi.spyOn(processManager, 'createManaged');
            const requestStop = vi.spyOn(processManager, 'requestStop');
            vi.spyOn(ProcessUtil, 'kill').mockResolvedValue(undefined);
            const actual = makeActualEncoder(root, processManager, { rate: 1, suffix: '.mp4' });
            const finished = waitForEncoderFinish(actual.model);

            const starting = actual.model.start();
            await spawned.promise;
            expect(spawn).toHaveBeenCalledOnce();
            child.emit('spawn');
            await starting;

            expect(createManaged).toHaveBeenCalledOnce();
            expect(processManager.childs).toHaveLength(1);
            expect(processManager.reservations.size).toBe(0);
            expect(actual.fileManager.usedFileNameIndex).toEqual({ [join(root, 'input.mp4')]: true });

            await vi.advanceTimersByTimeAsync(19_999);
            expect(requestStop).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1);
            expect(requestStop).toHaveBeenCalledOnce();
            await actual.model.cancel();
            expect(requestStop).toHaveBeenCalledOnce();
            expect(actual.model.childProcess).toBe(child);

            child.signalCode = 'SIGINT';
            child.emit('exit', null, 'SIGINT');
            await expect(finished).resolves.toEqual({ isError: true, output: join(root, 'input.mp4') });
            child.emit('close');

            expect(actual.model.childProcess).toBeNull();
            expect(actual.fileManager.usedFileNameIndex).toEqual({});
            expect(processManager.childs).toEqual([]);
            expect(processManager.reservations.size).toBe(0);
            expect(child.eventNames()).toEqual([]);
            expect((child.stdout as EventEmitter).listenerCount('data')).toBe(0);
            expect((child.stderr as EventEmitter).listenerCount('data')).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('[EN-INTEGRATION-LIFECYCLE-DEFERRED-SIZE] keeps the recorded lease while output-less result reflection is pending', async () => {
        vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-lifecycle-deferred-size-'));
        temporaryRoots.add(root);
        await writeFile(join(root, 'input.ts'), 'synthetic input');
        const logger = {
            encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { error: vi.fn() },
        };
        const processManager = new EncodeProcessManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ encodeProcessNum: 1 }) },
        );
        const child = makeLifecycleChild();
        const spawned = createDeferred<void>();
        vi.spyOn(processManager as unknown as { spawnProcess(): ChildProcess }, 'spawnProcess').mockImplementation(
            () => {
                spawned.resolve();
                return child;
            },
        );
        const actual = makeActualEncoder(root, processManager, { deferOption: true });
        const lifecycleAcquiredToken = {};
        const heldTokens = new Set<object>();
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi.fn(async () => {
                heldTokens.add(lifecycleAcquiredToken);
                return { token: lifecycleAcquiredToken };
            }),
            release: vi.fn(async released => {
                heldTokens.delete(released);
            }),
        };
        const event = new EncodeEvent({ getLogger: () => logger });
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 2 }) },
            { getExecution: vi.fn(async () => 'synthetic-execution'), unLockExecution: vi.fn() },
            vi.fn(async () => actual.model),
            event,
            recordedResourceUse,
        );
        const sizeUpdated = createDeferred<void>();
        const updateVideoFileSize = vi.fn(() => sizeUpdated.promise);
        const deleteVideoFile = vi.fn(async () => undefined);
        const notifyClient = vi.fn();
        const emitFinishEncode = vi.fn(async () => undefined);
        const finish = new EncodeFinishModel(
            { getLogger: () => logger },
            { notifyClient, notifyUpdateEncodeProgress: vi.fn() },
            {
                encodeEvent: { emitFinishEncode },
                recorded: { addVideoFile: vi.fn(), deleteVideoFile, updateVideoFileSize },
            },
            event,
            manage,
        );
        finish.set();

        try {
            await manage.push({ ...request(30_001), removeOriginal: true });
            await spawned.promise;
            child.emit('spawn');
            await vi.waitFor(() => expect(actual.model.childProcess).toBe(child));
            notifyClient.mockClear();

            child.exitCode = 0;
            child.emit('exit', 0, null);
            child.emit('close');
            await vi.waitFor(() => expect(updateVideoFileSize).toHaveBeenCalledOnce());

            expect(updateVideoFileSize).toHaveBeenCalledWith(40_001);
            expect(deleteVideoFile).not.toHaveBeenCalled();
            expect(notifyClient).not.toHaveBeenCalled();
            expect(recordedResourceUse.release).not.toHaveBeenCalled();
            expect(heldTokens).toEqual(new Set([lifecycleAcquiredToken]));
            expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });

            sizeUpdated.resolve();
            await vi.waitFor(() =>
                expect(recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(lifecycleAcquiredToken),
            );

            expect(deleteVideoFile).toHaveBeenCalledExactlyOnceWith(40_001, true);
            expect(notifyClient).toHaveBeenCalledOnce();
            expect(emitFinishEncode).toHaveBeenCalledOnce();
            expect(heldTokens).toEqual(new Set());
            expect(processManager.childs).toEqual([]);
            expect(processManager.reservations.size).toBe(0);
        } finally {
            (manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();
            (event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
        }
    });

    it('[EN-INTEGRATION-LIFECYCLE-REDISPATCH] ignores saved terminal callbacks after the next actual job has started', async () => {
        vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-lifecycle-redispatch-'));
        temporaryRoots.add(root);
        await writeFile(join(root, 'input.ts'), 'synthetic input');
        const logger = {
            encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { error: vi.fn() },
        };
        const processManager = new EncodeProcessManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ encodeProcessNum: 1 }) },
        );
        const firstChild = makeLifecycleChild();
        const secondChild = makeLifecycleChild();
        const firstSpawned = createDeferred<void>();
        const secondSpawned = createDeferred<void>();
        vi.spyOn(processManager as unknown as { spawnProcess(): ChildProcess }, 'spawnProcess')
            .mockImplementationOnce(() => {
                firstSpawned.resolve();
                return firstChild;
            })
            .mockImplementationOnce(() => {
                secondSpawned.resolve();
                return secondChild;
            });
        const createManaged = vi.spyOn(processManager, 'createManaged');
        const first = makeActualEncoder(root, processManager, { deferOption: true });
        const second = makeActualEncoder(root, processManager, { deferOption: true });
        const deferredAcquiredToken = {};
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi.fn(async () => ({ token: deferredAcquiredToken })),
            release: vi.fn(async () => undefined),
        };
        const event = new EncodeEvent({ getLogger: () => logger });
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 2 }) },
            { getExecution: vi.fn(async () => 'synthetic-execution'), unLockExecution: vi.fn() },
            vi.fn().mockResolvedValueOnce(first.model).mockResolvedValueOnce(second.model),
            event,
            recordedResourceUse,
        );
        const finish = new EncodeFinishModel(
            { getLogger: () => logger },
            { notifyClient: vi.fn(), notifyUpdateEncodeProgress: vi.fn() },
            {
                encodeEvent: { emitFinishEncode: vi.fn(async () => undefined) },
                recorded: {
                    addVideoFile: vi.fn(),
                    deleteVideoFile: vi.fn(),
                    updateVideoFileSize: vi.fn(async () => undefined),
                },
            },
            event,
            manage,
        );
        finish.set();
        const finishEncode = vi.spyOn(finish, 'finishEncode');
        const emitNeedsCheckQueue = vi.spyOn(
            manage as unknown as { emitNeedsCheckQueue(): void },
            'emitNeedsCheckQueue',
        );

        try {
            await manage.push(request(31_001) as apid.AddEncodeProgramOption);
            await firstSpawned.promise;
            firstChild.emit('spawn');
            await vi.waitFor(() => expect(first.model.childProcess).toBe(firstChild));
            await manage.push(request(31_002) as apid.AddEncodeProgramOption);
            await vi.waitFor(() =>
                expect(manage.getEncodeInfo()).toMatchObject({ runningQueue: [{ id: 1 }], waitQueue: [{ id: 2 }] }),
            );
            const savedFirstTerminalCallbacks = firstChild.listeners('exit');
            expect(savedFirstTerminalCallbacks).not.toHaveLength(0);
            createManaged.mockClear();
            recordedResourceUse.release.mockClear();
            finishEncode.mockClear();
            emitNeedsCheckQueue.mockClear();

            firstChild.exitCode = 0;
            firstChild.emit('exit', 0, null);
            await secondSpawned.promise;
            secondChild.emit('spawn');
            await vi.waitFor(() => expect(second.model.childProcess).toBe(secondChild));
            firstChild.emit('close');
            await vi.waitFor(() =>
                expect(recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(deferredAcquiredToken),
            );

            expect(finishEncode).toHaveBeenCalledOnce();
            expect(createManaged).toHaveBeenCalledOnce();
            expect(emitNeedsCheckQueue).toHaveBeenCalledOnce();

            for (const callback of savedFirstTerminalCallbacks) {
                callback(0, null);
            }
            await flushEventLoop();

            expect(finishEncode).toHaveBeenCalledOnce();
            expect(recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(deferredAcquiredToken);
            expect(createManaged).toHaveBeenCalledOnce();
            expect(emitNeedsCheckQueue).toHaveBeenCalledOnce();
            expect(manage.getEncodeInfo()).toEqual({
                runningQueue: [{ id: 2, mode: 'synthetic-mode', recordedId: 31_002 }],
                waitQueue: [],
            });

            secondChild.exitCode = 0;
            secondChild.emit('exit', 0, null);
            secondChild.emit('close');
            await vi.waitFor(() => expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }));
            expect(processManager.childs).toEqual([]);
            expect(processManager.reservations.size).toBe(0);
        } finally {
            (manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();
            (event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
        }
    });
});

const makeSyntheticChild = (): ChildProcess => {
    const child = new EventEmitter() as ChildProcess;
    Object.assign(child, {
        exitCode: null,
        pid: 73_201,
        signalCode: null,
        stderr: null,
        stdin: null,
        stdout: null,
    });
    return child;
};

const makeLifecycleChild = (): ChildProcess => {
    const child = makeSyntheticChild();
    const controlled = child as unknown as { stderr: EventEmitter; stdout: EventEmitter };
    controlled.stderr = new EventEmitter();
    controlled.stdout = new EventEmitter();
    return child;
};

const makeProcessManagerStub = (start: (option?: unknown) => Promise<ChildProcess>): ProcessManagerRuntime => {
    const handle = {} as ManagedProcessHandle;
    return {
        childs: [],
        create: vi.fn(async option => start(option)),
        createManaged: vi.fn(async option => ({ child: await start(option), handle })),
        requestStop: vi.fn(async () => ({ status: 'requested', sentSignals: ['SIGINT'] })),
        reservations: new Set<object>(),
    };
};

const waitForEncoderFinish = (model: EncoderRuntime): Promise<{ isError: boolean; output: string | null }> =>
    new Promise(resolve => {
        model.setOnFinish((isError, output) => resolve({ isError, output }));
    });

const resultInfo = (overrides: Partial<FinishEncodeInfo> = {}): FinishEncodeInfo => ({
    filePath: 'synthetic-output.mp4',
    fullOutputPath: 'synthetic-output.mp4',
    mode: 'synthetic-mode',
    parentDirName: 'synthetic-parent',
    recordedId: 12_001,
    removeOriginal: false,
    videoFileId: 12_003,
    ...overrides,
});

const makeEncoder = (): SyntheticEncoder => {
    let option: EncodeOption | null = null;
    const encoder: SyntheticEncoder = {
        cancel: vi.fn(async () => undefined),
        finish: () => {
            const callback = encoder.finishCallback;
            if (callback === null) return;
            encoder.finishCallback = null;
            callback(true, null);
        },
        finishCallback: null,
        getEncodeId: vi.fn(() => option?.encodeId ?? null),
        getEncodeOption: vi.fn(() => option),
        getProgressInfo: vi.fn(() => null),
        setOnFinish: vi.fn(callback => {
            encoder.finishCallback = callback;
        }),
        setOption: vi.fn(value => {
            option = value;
        }),
        start: vi.fn(() => encoder.startGate.promise),
        startGate: createDeferred<void>(),
    };
    return encoder;
};

const makeLifecycleJob = (
    event: IEncodeEvent,
    resources: LifecycleResources,
    options: { reservesOutput?: boolean; startError?: Error } = {},
): LifecycleJob => {
    let option: EncodeOption | null = null;
    let progress: EncodeProgressInfo | null = null;
    let managedHandle: object | null = null;
    let outputReservation: string | null = null;
    let stopRequested = false;
    let timer: object | null = null;
    const startGate = createDeferred<void>();
    const job: LifecycleJob = {
        cancel: vi.fn(async () => {
            if (managedHandle === null || stopRequested === true) return;
            stopRequested = true;
            resources.stopRequests.push(managedHandle);
        }),
        complete: (isError, outputFilePath) => {
            if (timer !== null) {
                resources.timers.delete(timer);
                timer = null;
            }
            if (managedHandle !== null) {
                resources.managedHandles.delete(managedHandle);
                managedHandle = null;
            }
            if (outputReservation !== null) {
                resources.outputReservations.delete(outputReservation);
                outputReservation = null;
            }
            const callback = job.finishCallback;
            job.finishCallback = null;
            if (callback !== null) callback(isError, outputFilePath);
        },
        expireTimer: () => {
            if (timer === null) return;
            void job.cancel();
        },
        finish: () => job.complete(true, null),
        finishCallback: null,
        getEncodeId: vi.fn(() => option?.encodeId ?? null),
        getEncodeOption: vi.fn(() => option),
        getProgressInfo: vi.fn(() => progress),
        reportProgress: (percent, log) => {
            progress = { percent, log };
            event.emitUpdateEncodeProgress();
        },
        setOnFinish: vi.fn(callback => {
            job.finishCallback = callback;
        }),
        setOption: vi.fn(value => {
            option = value;
        }),
        start: vi.fn(async () => {
            await startGate.promise;
            const encodeId = option?.encodeId;
            if (encodeId === undefined) throw new Error('MissingLifecycleEncodeId');
            resources.sharedSlotRequests.push(encodeId);
            if (options.startError !== undefined) {
                job.finishCallback = null;
                throw options.startError;
            }
            managedHandle = { encodeId };
            timer = { encodeId };
            resources.managedHandles.add(managedHandle);
            resources.timers.add(timer);
            if (options.reservesOutput !== false && option?.directory !== undefined) {
                outputReservation = `${encodeId}:${option.directory}`;
                resources.outputReservations.add(outputReservation);
            }
        }),
        startGate,
    };
    return job;
};

const makeActualEncoder = (
    root: string,
    processManager: ProcessManagerRuntime,
    options: {
        cmd?: string;
        deferOption?: boolean;
        directory?: string;
        enableProgress?: boolean;
        encodeEvent?: IEncodeEvent;
        rate?: number;
        suffix?: string;
    } = {},
) => {
    const inputPath = join(root, 'input.ts');
    const fileManager = new EncodeFileManageModel();
    const config = {
        encode: [
            {
                cmd: options.cmd ?? '%NODE%',
                name: 'synthetic-mode',
                ...(options.rate === undefined ? {} : { rate: options.rate }),
                ...(options.suffix === undefined ? {} : { suffix: options.suffix }),
            },
        ],
        ffmpeg: join(root, 'ffmpeg'),
        ffprobe: join(root, 'ffprobe'),
    };
    const logger = { encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
    const model = new EncoderModel(
        { getLogger: () => logger },
        { getConfig: () => config },
        processManager,
        fileManager,
        { findId: vi.fn(async () => ({ id: 10_502 })) },
        {
            findId: vi.fn(async () => ({
                audioComponentType: 0,
                audioSamplingRate: 48_000,
                channelId: 10_503,
                description: null,
                dropLogFile: {
                    dropCnt: 0,
                    errorCnt: 7,
                    filePath: 'drop.json',
                    id: 10_504,
                    scramblingCnt: 11,
                },
                duration: 20_000,
                endAt: 30,
                extended: null,
                genre1: 0,
                genre2: null,
                genre3: 15,
                halfWidthDescription: null,
                halfWidthExtended: null,
                halfWidthName: 'half name',
                id: 10_501,
                name: 'Synthetic recording',
                startAt: 10,
                subGenre1: 1,
                subGenre2: null,
                subGenre3: 0,
                videoComponentType: 179,
                videoResolution: null,
                videoStreamContent: 1,
                videoType: null,
            })),
        },
        { findId: vi.fn(async () => ({ halfWidthName: 'half channel', id: 10_503, name: 'Channel name' })) },
        {
            getFullFilePathFromId: vi.fn(async () => inputPath),
            getInfo: vi.fn(async () => (options.enableProgress === true ? {} : null)),
            getParentDirPath: vi.fn(() => root),
        },
        options.encodeEvent ?? {
            emitAddEncode: vi.fn(),
            emitCancelEncode: vi.fn(),
            emitErrorEncode: vi.fn(),
            emitFinishEncode: vi.fn(),
            emitUpdateEncodeProgress: vi.fn(),
        },
        { formatFilePathString: vi.fn(async (directory: string) => directory) },
    );
    if (options.deferOption !== true) {
        model.setOption({
            encodeId: 10_505,
            mode: 'synthetic-mode',
            parentDir: 'synthetic-parent',
            recordedId: 10_501,
            removeOriginal: false,
            sourceVideoFileId: 10_502,
            ...(options.directory === undefined ? {} : { directory: options.directory }),
        });
    }
    return { fileManager, inputPath, logger, model };
};

// `runActualEncoderCapture`, `writeCompletingChild`, and `writeStoppingChild` below each write a
// script to a `.cjs` file so it always runs as CommonJS regardless of the parent project's
// `"type": "module"`; each script body must therefore use `require`, not a static `import` (a
// static `import` in a `.cjs` file is a SyntaxError under CommonJS and makes the spawned encoder
// process exit before it ever writes its report file -- the cause of
// this suite's `ENOENT: no such file or directory, open '.../report.json'` and
// `expected null not to be null` / `MissingActualChild` failures for the real-child cases below).
// See the analogous, already-fixed note in
// `test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts`'s
// `[TM-2.14] passes a synthetic parent marker to the actual child process`.
const runActualEncoderCapture = async (root: string, options: { directory?: string; suffix?: string } = {}) => {
    const scriptPath = join(root, 'capture.cjs');
    const reportPath = join(root, 'report.json');
    const inputPath = join(root, 'input.ts');
    const outputPath = join(root, 'input.mp4');
    const capturedEnvKeys = [...ENCODE_ENV_KEYS, parentMarkerKey];
    await Promise.all([
        writeFile(
            scriptPath,
            [
                "const fs = require('node:fs');",
                `const keys = ${JSON.stringify(capturedEnvKeys)};`,
                'fs.writeFileSync(process.argv[2], JSON.stringify({',
                'argv: process.argv.slice(3),',
                'env: Object.fromEntries(keys.map(key => [key, process.env[key]])),',
                '}));',
            ].join(''),
        ),
        writeFile(inputPath, 'synthetic input'),
    ]);
    const manager = new EncodeProcessManageModel(
        { getLogger: () => ({ encode: { error: vi.fn(), info: vi.fn() } }) },
        { getConfig: () => ({ encodeProcessNum: 1 }) },
    );
    const create = vi.spyOn(manager, 'createManaged');
    const actual = makeActualEncoder(root, manager, {
        cmd: `%NODE% ${scriptPath} ${reportPath} %ROOT% %SPACE% %INPUT% %OUTPUT% %UNTOUCHED%`,
        ...options,
    });
    let resolveFinish: (result: { isError: boolean; output: string | null }) => void = () => {};
    const finished = new Promise<{ isError: boolean; output: string | null }>(resolve => {
        resolveFinish = resolve;
    });
    actual.model.setOnFinish((isError, output) => resolveFinish({ isError, output }));

    await actual.model.start();
    const child = actual.model.childProcess;
    if (child !== null && child.exitCode === null && child.signalCode === null) isolatedChildren.add(child);
    const finish = await finished;
    if (child !== null) isolatedChildren.delete(child);
    await flushEventLoop();
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
        argv: string[];
        env: Record<string, string | undefined>;
    };
    return { actual, child, create, finish, inputPath, manager, outputPath, report };
};

const writeCompletingChild = async (root: string) => {
    const scriptPath = join(root, 'complete-child.cjs');
    const reportPath = join(root, 'complete-report.json');
    const capturedEnvKeys = [...ENCODE_ENV_KEYS, parentMarkerKey];
    await writeFile(
        scriptPath,
        [
            "const fs = require('node:fs');",
            `const keys = ${JSON.stringify(capturedEnvKeys)};`,
            'setTimeout(() => {',
            "  if (process.env.OUTPUT !== '') fs.writeFileSync(process.env.OUTPUT, 'synthetic encoded output');",
            '  fs.writeFileSync(process.argv[2], JSON.stringify({',
            '    argv: process.argv.slice(3),',
            '    env: Object.fromEntries(keys.map(key => [key, process.env[key]])),',
            '  }));',
            "  process.stdout.write(JSON.stringify({ type: 'progress', percent: 37, log: 'synthetic progress' }) + '\\n');",
            '}, 75);',
        ].join('\n'),
    );
    return { reportPath, scriptPath };
};

const writeStoppingChild = async (root: string) => {
    const scriptPath = join(root, 'stopping-child.cjs');
    const reportPath = join(root, 'stopping-report.json');
    const stopPath = join(root, 'stop-requested');
    const terminalPath = join(root, 'terminal-permitted');
    await writeFile(
        scriptPath,
        [
            "const fs = require('node:fs');",
            "fs.writeFileSync(process.env.OUTPUT, 'synthetic partial output');",
            "fs.writeFileSync(process.argv[2], 'started');",
            'const timer = setInterval(() => {',
            '  if (!fs.existsSync(process.argv[3]) || !fs.existsSync(process.argv[4])) return;',
            '  clearInterval(timer);',
            '  process.exit(0);',
            '}, 5);',
        ].join('\n'),
    );
    return { reportPath, scriptPath, stopPath, terminalPath };
};

const removeTemporaryRoot = async (root: string): Promise<void> => {
    temporaryRoots.delete(root);
    await rm(root, { force: true, recursive: true });
    await expect(stat(root)).rejects.toThrow();
};

const fixtures: BoundaryFixture[] = [];
const temporaryRoots = new Set<string>();
const isolatedChildren = new Set<ChildProcess>();

class BoundaryFixture {
    readonly added: number[] = [];
    readonly config: { concurrentEncodeNum: number; encodeQueueLimit: number };
    readonly encoders: SyntheticEncoder[] = [];
    readonly event: IEncodeEvent;
    readonly executionHandles: ExecutionHandle[] = [];
    readonly execution = {
        getExecution: vi.fn(() => {
            const handle = {
                id: `synthetic-execution-${this.executionHandles.length + 1}`,
                gate: createDeferred<string>(),
            };
            this.executionHandles.push(handle);
            return handle.gate.promise;
        }),
        unLockExecution: vi.fn((id: string) => {
            this.activeExecutions.delete(id);
        }),
    };
    readonly manage: EncodeManageRuntime;
    readonly api: EncodeApiRuntime;
    readonly provider: ReturnType<typeof vi.fn>;
    readonly recordedResourceUse: RecordedResourceUsePort;

    private readonly activeExecutions = new Set<string>();
    private readonly eventEmitter: EventEmitter;
    private readonly manageEmitter: EventEmitter;

    constructor(
        queueLimit: number,
        options: {
            pauseQueueChecks?: boolean;
            providerFailures?: number;
            recordedResourceUse?: RecordedResourceUsePort;
        } = {},
        config?: { concurrentEncodeNum: number; encodeQueueLimit: number },
    ) {
        this.config = config ?? { concurrentEncodeNum: 1, encodeQueueLimit: queueLimit };
        const logger = {
            encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { error: vi.fn() },
        };
        this.event = new EncodeEvent({ getLogger: () => logger });
        this.recordedResourceUse = options.recordedResourceUse ?? {
            acquire: vi.fn(async () => ({ token: {} })),
            release: vi.fn(async () => undefined),
        };
        let failuresRemaining = options.providerFailures ?? 0;
        this.provider = vi.fn(async () => {
            if (failuresRemaining > 0) {
                failuresRemaining -= 1;
                throw new Error('SyntheticEncoderProviderFailure');
            }
            const encoder = makeEncoder();
            this.encoders.push(encoder);
            return encoder;
        });
        this.manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => this.config },
            this.execution,
            this.provider,
            this.event,
            this.recordedResourceUse,
        );
        this.manageEmitter = (this.manage as unknown as { listener: EventEmitter }).listener;
        this.eventEmitter = (this.event as unknown as { emitter: EventEmitter }).emitter;
        if (options.pauseQueueChecks === true) this.manageEmitter.removeAllListeners();
        this.event.setAddEncode(id => this.added.push(id));

        const recordedDB = {
            findIds: vi.fn(async (ids: number[]) => ids.map(id => ({ id }))),
        };
        this.api = new EncodeApiModel(this.manage, {}, recordedDB, {
            convertRecordedToRecordedItem: vi.fn((recorded: { id: number }) => ({ id: recorded.id })),
        });
        fixtures.push(this);
    }

    pendingExecutionCount(): number {
        return this.executionHandles.filter(handle => handle.gate.state().status === 'pending').length;
    }

    resolveNextExecution(): void {
        const handle = this.executionHandles.find(item => item.gate.state().status === 'pending');
        if (handle === undefined) throw new Error('No pending execution acquisition');
        this.activeExecutions.add(handle.id);
        handle.gate.resolve(handle.id);
    }

    resolveAllExecutions(): void {
        for (const handle of this.executionHandles) {
            if (handle.gate.state().status !== 'pending') continue;
            this.activeExecutions.add(handle.id);
            handle.gate.resolve(handle.id);
        }
    }

    resources(): Record<string, number> {
        return {
            activeExecutions: this.activeExecutions.size,
            finishCallbacks: this.encoders.filter(encoder => encoder.finishCallback !== null).length,
            pendingExecutions: this.pendingExecutionCount(),
            pendingStarts: this.encoders.filter(encoder => encoder.startGate.state().status === 'pending').length,
        };
    }

    async cleanup(): Promise<void> {
        this.manageEmitter.removeAllListeners();
        for (let attempt = 0; attempt < this.encoders.length + 8; attempt += 1) {
            this.resolveAllExecutions();
            for (const encoder of this.encoders) {
                encoder.startGate.resolve(undefined);
                encoder.finish();
            }
            await flushEventLoop();

            const queue = this.manage.getEncodeInfo();
            if (queue.waitQueue.length > 0) {
                const cancellations = queue.waitQueue.map(item => this.api.cancel(item.id));
                await flushEventLoop();
                this.resolveAllExecutions();
                await Promise.all(cancellations);
                await flushEventLoop();
            }

            const settledQueue = this.manage.getEncodeInfo();
            const resources = this.resources();
            if (
                settledQueue.runningQueue.length === 0 &&
                settledQueue.waitQueue.length === 0 &&
                resources.activeExecutions === 0 &&
                resources.finishCallbacks === 0 &&
                resources.pendingExecutions === 0
            ) {
                this.eventEmitter.removeAllListeners();
                return;
            }
        }
        throw new Error(`Encoding boundary cleanup did not settle: ${JSON.stringify(this.resources())}`);
    }

    listenerCount(): number {
        return (
            this.manageEmitter.eventNames().reduce((count, name) => count + this.manageEmitter.listenerCount(name), 0) +
            this.eventEmitter.eventNames().reduce((count, name) => count + this.eventEmitter.listenerCount(name), 0)
        );
    }
}

afterEach(async () => {
    while (fixtures.length > 0) {
        const fixture = fixtures.pop();
        if (fixture === undefined) continue;
        await fixture.cleanup();
        expect(fixture.resources()).toEqual({
            activeExecutions: 0,
            finishCallbacks: 0,
            pendingExecutions: 0,
            pendingStarts: 0,
        });
        expect(fixture.listenerCount()).toBe(0);
    }
    for (const child of isolatedChildren) {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGKILL');
            await exited;
        }
    }
    isolatedChildren.clear();
    await Promise.all([...temporaryRoots].map(root => rm(root, { force: true, recursive: true })));
    temporaryRoots.clear();
    vi.restoreAllMocks();
});

describe('encoding API to admission boundary integration', () => {
    it('keeps limit one while acquisition is pending and accepts again after the waiting job starts', async () => {
        const fixture = new BoundaryFixture(1);

        const accepted = fixture.api.add(request(101));
        const rejected = fixture.api.add(request(102));

        expect(fixture.manage.admissionReservations).toBe(1);
        expect(fixture.pendingExecutionCount()).toBe(1);
        expect(fixture.provider).not.toHaveBeenCalled();
        expect(fixture.added).toEqual([]);
        await expect(fixture.api.getAll(false)).resolves.toEqual({ runningItems: [], waitItems: [] });
        await expect(rejected).rejects.toThrow('EncodeQueueIsFull');

        fixture.resolveNextExecution();
        await expect(accepted).resolves.toBe(1);
        expect(fixture.added).toEqual([1]);
        expect(fixture.provider).toHaveBeenCalledOnce();
        expect(fixture.pendingExecutionCount()).toBe(1);

        fixture.resolveNextExecution();
        await flushEventLoop();
        const running = await fixture.api.getAll(false);
        expect(running.runningItems).toEqual([{ id: 1, mode: 'synthetic-mode', recorded: { id: 101 } }]);
        expect(running.waitItems).toEqual([]);

        const acceptedAfterStart = fixture.api.add(request(103));
        expect(fixture.manage.admissionReservations).toBe(1);
        expect(fixture.provider).toHaveBeenCalledOnce();
        fixture.resolveNextExecution();
        await expect(acceptedAfterStart).resolves.toBe(2);
        expect(fixture.added).toEqual([1, 2]);
        expect(await fixture.api.getAll(false)).toEqual({
            runningItems: [{ id: 1, mode: 'synthetic-mode', recorded: { id: 101 } }],
            waitItems: [{ id: 2, mode: 'synthetic-mode', recorded: { id: 103 } }],
        });
    });

    it('releases a failed admission so retry succeeds and only the success has an ID, job, event, and public item', async () => {
        const fixture = new BoundaryFixture(1, { pauseQueueChecks: true, providerFailures: 1 });

        const failed = fixture.api.add(request(201));
        expect(fixture.manage.admissionReservations).toBe(1);
        fixture.resolveNextExecution();
        await expect(failed).rejects.toThrow('SyntheticEncoderProviderFailure');
        expect(fixture.manage.admissionReservations).toBe(0);
        expect(fixture.provider).toHaveBeenCalledOnce();
        expect(fixture.encoders).toHaveLength(0);
        expect(fixture.added).toEqual([]);
        await expect(fixture.api.getAll(false)).resolves.toEqual({ runningItems: [], waitItems: [] });

        const retry = fixture.api.add(request(202));
        fixture.resolveNextExecution();
        await expect(retry).resolves.toBe(1);
        expect(fixture.provider).toHaveBeenCalledTimes(2);
        expect(fixture.encoders).toHaveLength(1);
        expect(fixture.added).toEqual([1]);
        await expect(fixture.api.getAll(false)).resolves.toEqual({
            runningItems: [],
            waitItems: [{ id: 1, mode: 'synthetic-mode', recorded: { id: 202 } }],
        });

        fixture.config.encodeQueueLimit = 2;
        await expect(fixture.api.add(request(203))).rejects.toThrow('EncodeQueueIsFull');

        const restarted = new BoundaryFixture(2, { pauseQueueChecks: true }, fixture.config);
        const afterRestart = [
            restarted.api.add(request(204)),
            restarted.api.add(request(205)),
            restarted.api.add(request(206)),
        ];
        expect(restarted.manage.admissionReservations).toBe(2);
        await expect(afterRestart[2]).rejects.toThrow('EncodeQueueIsFull');
        restarted.resolveAllExecutions();
        await expect(Promise.all(afterRestart.slice(0, 2))).resolves.toEqual([1, 2]);
        expect(restarted.added).toEqual([1, 2]);
    });

    it('caps same-loop admission at 1,024 and keeps admission internals out of every public DTO', async () => {
        const fixture = new BoundaryFixture(1024, { pauseQueueChecks: true });
        const additions = Array.from({ length: 1025 }, (_, index) => fixture.api.add(request(1_000 + index)));

        expect(fixture.manage.admissionReservations).toBe(1024);
        expect(fixture.pendingExecutionCount()).toBe(1024);
        expect(fixture.provider).not.toHaveBeenCalled();
        expect(fixture.added).toEqual([]);
        await expect(additions[1024]).rejects.toThrow('EncodeQueueIsFull');
        await expect(fixture.api.getAll(false)).resolves.toEqual({ runningItems: [], waitItems: [] });

        fixture.resolveAllExecutions();
        const ids = await Promise.all(additions.slice(0, 1024));
        expect(ids).toEqual(Array.from({ length: 1024 }, (_, index) => index + 1));
        expect(ids.every(id => Number.isSafeInteger(id) && id > 0)).toBe(true);
        expect(fixture.provider).toHaveBeenCalledTimes(1024);
        expect(fixture.encoders).toHaveLength(1024);
        expect(fixture.added).toEqual(ids);

        const publicInfo = await fixture.api.getAll(false);
        expect(publicInfo.runningItems).toEqual([]);
        expect(publicInfo.waitItems).toHaveLength(1024);
        expect(Object.keys(publicInfo).sort()).toEqual(['runningItems', 'waitItems']);
        expect(Object.keys(publicInfo.waitItems[0]).sort()).toEqual(['id', 'mode', 'recorded']);
        expect(JSON.stringify(publicInfo)).not.toMatch(/encodeQueueLimit|admissionReservations|reservation|token/);

        fixture.config.encodeQueueLimit = 1025;
        await expect(fixture.api.add(request(9_999))).rejects.toThrow('EncodeQueueIsFull');
    });
});

describe('recorded-use admission integration', () => {
    it('[EN-INTEGRATION-RECORDED-USE-ORDER] holds public admission at an encoding lease boundary before queue publication', async () => {
        const granted = createDeferred<{ token: object }>();
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi.fn(() => granted.promise),
            release: vi.fn(async () => undefined),
        };
        const fixture = new BoundaryFixture(3, { pauseQueueChecks: true, recordedResourceUse });

        const adding = fixture.api.add(request(10_700));
        fixture.resolveNextExecution();
        await Promise.resolve();

        expect(recordedResourceUse.acquire).toHaveBeenCalledExactlyOnceWith(10_700, 'encoding');
        expect(fixture.added).toEqual([]);
        expect(fixture.provider).not.toHaveBeenCalled();
        await expect(fixture.api.getAll(false)).resolves.toEqual({ runningItems: [], waitItems: [] });

        granted.resolve({ token: {} });
        await expect(adding).resolves.toBe(1);
        expect(fixture.added).toEqual([1]);
        expect(fixture.provider).toHaveBeenCalledOnce();
    });

    it('[EN-INTEGRATION-RECORDED-USE-REJECT] exposes no API queue or event when the lease carrier rejects', async () => {
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi.fn(async () => {
                throw new Error('RecordedResourceUseUnknown');
            }),
            release: vi.fn(async () => undefined),
        };
        const fixture = new BoundaryFixture(3, { pauseQueueChecks: true, recordedResourceUse });

        const adding = fixture.api.add(request(10_701));
        fixture.resolveNextExecution();
        await expect(adding).rejects.toThrow('RecordedResourceUseUnknown');

        expect(recordedResourceUse.acquire).toHaveBeenCalledExactlyOnceWith(10_701, 'encoding');
        expect(recordedResourceUse.release).not.toHaveBeenCalled();
        expect(fixture.added).toEqual([]);
        expect(fixture.provider).not.toHaveBeenCalled();
        await expect(fixture.api.getAll(false)).resolves.toEqual({ runningItems: [], waitItems: [] });
    });
});

describe('inactive recorded-use snapshot integration', () => {
    it('[EN-INTEGRATION-RECORDED-USE-SNAPSHOT-INACTIVE] projects queued IDs after legacy unbound admission without extra work', async () => {
        const fixture = new BoundaryFixture(3, { pauseQueueChecks: true });

        const first = fixture.api.add(request(10_701));
        const second = fixture.api.add(request(10_701));
        fixture.resolveAllExecutions();
        await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
        const before = {
            added: [...fixture.added],
            executions: fixture.execution.getExecution.mock.calls.length,
            providers: fixture.provider.mock.calls.length,
            queue: await fixture.api.getAll(false),
        };

        expect(fixture.manage.getQueuedAndRunningRecordedIds()).toEqual({
            status: 'known',
            recordedIds: new Set([10_701]),
        });
        expect({
            added: fixture.added,
            executions: fixture.execution.getExecution.mock.calls.length,
            providers: fixture.provider.mock.calls.length,
            queue: await fixture.api.getAll(false),
        }).toEqual(before);
    });
});

describe('process boundary integration', () => {
    it('[EN-INTEGRATION-PROCESS-STOP] joins one managed stop and keeps the job running until process terminal', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-managed-stop-'));
        temporaryRoots.add(root);
        await writeFile(join(root, 'input.ts'), 'synthetic input');
        const logger = { encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
        const processManager = new EncodeProcessManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ encodeProcessNum: 1 }) },
        );
        const child = makeSyntheticChild();
        const spawnProcess = vi
            .spyOn(processManager as unknown as { spawnProcess(): ChildProcess }, 'spawnProcess')
            .mockReturnValue(child);
        const stopGate = createDeferred<void>();
        const kill = vi.spyOn(ProcessUtil, 'kill').mockImplementation(() => stopGate.promise);
        const requestStop = vi.spyOn(processManager, 'requestStop');
        const actual = makeActualEncoder(root, processManager);
        const finished = waitForEncoderFinish(actual.model);

        const starting = actual.model.start();
        await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
        child.emit('spawn');
        await starting;

        const firstStop = actual.model.cancel();
        const duplicateStop = actual.model.cancel();
        await vi.waitFor(() => expect(kill).toHaveBeenCalledOnce());
        expect(requestStop).toHaveBeenCalledOnce();
        expect(actual.model.childProcess).toBe(child);
        expect(processManager.childs).toHaveLength(1);

        stopGate.resolve(undefined);
        await Promise.all([firstStop, duplicateStop]);
        expect(actual.model.childProcess).toBe(child);
        expect(processManager.childs).toHaveLength(1);

        child.signalCode = 'SIGINT';
        child.emit('exit', null, 'SIGINT');
        await expect(finished).resolves.toEqual({ isError: true, output: null });
        expect(actual.model.childProcess).toBeNull();
        expect(processManager.childs).toEqual([]);
        expect(processManager.reservations.size).toBe(0);
    });

    it('[EN-INTEGRATION-T3-1] requests the shared process port once and surfaces a refused slot as a start failure', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-shared-slot-'));
        temporaryRoots.add(root);
        const inputPath = join(root, 'input.ts');
        await writeFile(inputPath, 'synthetic input');
        const logger = { encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
        const processManager = new EncodeProcessManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ encodeProcessNum: 0 }) },
        );
        const create = vi.spyOn(processManager, 'createManaged');
        const actual = makeActualEncoder(root, processManager, { suffix: '.mp4' });
        const release = vi.spyOn(actual.fileManager, 'release');

        await expect(actual.model.start()).rejects.toThrow('EncodeProcessManageModelCreateError');

        expect(create).toHaveBeenCalledOnce();
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ priority: 10 }));
        expect(processManager.childs).toEqual([]);
        expect(processManager.reservations.size).toBe(0);
        expect(release).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledWith(join(root, 'input.mp4'));
        expect(actual.fileManager.usedFileNameIndex).toEqual({});
    });

    it('[EN-INTEGRATION-T3-1-QUEUE] connects an actual refused encoder to running removal and the next FIFO job', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-queue-refusal-'));
        temporaryRoots.add(root);
        await writeFile(join(root, 'input.ts'), 'synthetic input');
        const logger = { encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
        const processManager = new EncodeProcessManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ encodeProcessNum: 0 }) },
        );
        const create = vi.spyOn(processManager, 'createManaged');
        const actual = makeActualEncoder(root, processManager, { deferOption: true, suffix: '.mp4' });
        const release = vi.spyOn(actual.fileManager, 'release');
        const next = makeEncoder();
        const provider = vi.fn().mockResolvedValueOnce(actual.model).mockResolvedValueOnce(next);
        const activeExecutions = new Set<string>();
        let executionCount = 0;
        const execution = {
            getExecution: vi.fn(async () => {
                const id = `actual-queue-execution-${++executionCount}`;
                activeExecutions.add(id);
                return id;
            }),
            unLockExecution: vi.fn((id: string) => activeExecutions.delete(id)),
        };
        const event = {
            emitAddEncode: vi.fn(),
            emitCancelEncode: vi.fn(),
            emitErrorEncode: vi.fn(),
            emitFinishEncode: vi.fn(),
            emitUpdateEncodeProgress: vi.fn(),
        };
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 4 }) },
            execution,
            provider,
            event,
            {
                acquire: vi.fn(async () => ({ token: {} })),
                release: vi.fn(async () => undefined),
            },
        ) as EncodeManageRuntime & { checkQueue(): Promise<void>; listener: EventEmitter };
        manage.listener.removeAllListeners();

        await manage.push({ ...request(10_601), sourceVideoFileId: 10_502 });
        await manage.push(request(10_602));
        expect(manage.getEncodeInfo().waitQueue.map(item => item.id)).toEqual([1, 2]);

        await manage.checkQueue();
        await flushEventLoop();
        expect(manage.getEncodeInfo()).toEqual({
            runningQueue: [],
            waitQueue: [{ id: 2, mode: 'synthetic-mode', recordedId: 10_602 }],
        });
        expect(create).toHaveBeenCalledOnce();
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ priority: 10 }));
        expect(release).toHaveBeenCalledOnce();
        expect(actual.fileManager.usedFileNameIndex).toEqual({});
        expect(event.emitErrorEncode).toHaveBeenCalledOnce();

        next.startGate.resolve(undefined);
        await manage.checkQueue();
        expect(next.start).toHaveBeenCalledOnce();
        expect(manage.getEncodeInfo()).toEqual({
            runningQueue: [{ id: 2, mode: 'synthetic-mode', recordedId: 10_602 }],
            waitQueue: [],
        });
        expect(provider).toHaveBeenCalledTimes(2);

        next.finish();
        await flushEventLoop();
        expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
        expect(activeExecutions.size).toBe(0);
        expect(processManager.childs).toEqual([]);
        expect(processManager.reservations.size).toBe(0);
        expect(next.finishCallback).toBeNull();
        (actual.model as unknown as { listener: EventEmitter }).listener.removeAllListeners();
    });

    it('[EN-INTEGRATION-T3-3] carries argv and all 35 overlaid environment values through the actual encoder and process manager', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-command-'));
        temporaryRoots.add(root);
        const restoredEnvironment = new Map<string, string | undefined>([
            [parentMarkerKey, process.env[parentMarkerKey]],
            ['RECORDEDID', process.env.RECORDEDID],
            ['CHANNELNAME', process.env.CHANNELNAME],
            ['DIR', process.env.DIR],
        ]);
        process.env[parentMarkerKey] = 'inherited-child-marker';
        process.env.RECORDEDID = 'stale-recorded-id';
        process.env.CHANNELNAME = 'stale-channel-name';
        process.env.DIR = 'stale-directory';

        try {
            const result = await runActualEncoderCapture(root, { suffix: '.mp4' });

            expect(result.report.argv).toEqual([
                ProcessUtil.ROOT_PATH,
                ' ',
                result.inputPath,
                result.outputPath,
                '%UNTOUCHED%',
            ]);
            expect(Object.keys(result.report.env).sort()).toEqual([...ENCODE_ENV_KEYS, parentMarkerKey].sort());
            expect(ENCODE_ENV_KEYS).toHaveLength(35);
            expect(result.report.env).toMatchObject({
                RECORDEDID: '10501',
                CHANNELNAME: 'Channel name',
                DIR: result.outputPath,
                DROP_CNT: '0',
                ERROR_CNT: '7',
                GENRE1: '0',
                OUTPUT: result.outputPath,
                SCRAMBLING_CNT: '11',
                SUBDIR: '',
                [parentMarkerKey]: 'inherited-child-marker',
            });
            expect(result.finish).toEqual({ isError: false, output: result.outputPath });
            expect(result.create).toHaveBeenCalledOnce();
            expect(result.create).toHaveBeenCalledWith(expect.objectContaining({ priority: 10 }));
            expect(result.child?.exitCode).toBe(0);
            expect(result.actual.fileManager.usedFileNameIndex).toEqual({});
            expect(result.manager.childs).toEqual([]);
            expect(result.manager.reservations.size).toBe(0);
            expect(isolatedChildren.size).toBe(0);
        } finally {
            for (const [key, value] of restoredEnvironment) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    });

    it('[EN-INTEGRATION-T3-3-OUTPUT-NULL] preserves the OUTPUT token for an actual no-output process', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-command-null-'));
        temporaryRoots.add(root);
        const result = await runActualEncoderCapture(root, { directory: 'nested' });

        expect(result.report.argv).toEqual([ProcessUtil.ROOT_PATH, ' ', result.inputPath, '%OUTPUT%', '%UNTOUCHED%']);
        expect(result.report.env).toMatchObject({ DIR: 'nested', OUTPUT: '', SUBDIR: 'nested' });
        expect(result.finish).toEqual({ isError: false, output: null });
        expect(result.actual.fileManager.usedFileNameIndex).toEqual({});
        expect(result.manager.childs).toEqual([]);
        expect(result.manager.reservations.size).toBe(0);
        expect(isolatedChildren.size).toBe(0);
    });
});

describe('isolated child and filesystem integration', () => {
    it('[EN-INTEGRATION-T6-2-OUTPUT] connects an actual child command, environment, progress, output, and result registration', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-child-output-'));
        temporaryRoots.add(root);
        const { reportPath, scriptPath } = await writeCompletingChild(root);
        await writeFile(join(root, 'input.ts'), 'synthetic input');
        const restoredParentMarker = process.env[parentMarkerKey];
        process.env[parentMarkerKey] = 'task-6-2-parent-marker';
        const logger = {
            encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { error: vi.fn() },
        };
        const processManager = new EncodeProcessManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ encodeProcessNum: 1 }) },
        );
        const event = new EncodeEvent({ getLogger: () => logger });
        const actual = makeActualEncoder(root, processManager, {
            cmd: `%NODE% ${scriptPath} ${reportPath} %ROOT% %SPACE% %INPUT% %OUTPUT% %UNTOUCHED%`,
            deferOption: true,
            enableProgress: true,
            encodeEvent: event,
            suffix: '.encoded',
        });
        const addVideoFile = vi.fn(async () => 90_001);
        const updateVideoFileSize = vi.fn(async () => undefined);
        const notifyClient = vi.fn();
        const notifyUpdateEncodeProgress = vi.fn();
        const emitFinishEncode = vi.fn(async () => undefined);
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 2 }) },
            { getExecution: vi.fn(async () => 'synthetic-execution'), unLockExecution: vi.fn() },
            vi.fn(async () => actual.model),
            event,
            {
                acquire: vi.fn(async () => ({ token: {} })),
                release: vi.fn(async () => undefined),
            },
        );
        const finish = new EncodeFinishModel(
            { getLogger: () => logger },
            { notifyClient, notifyUpdateEncodeProgress },
            {
                encodeEvent: { emitFinishEncode },
                recorded: { addVideoFile, deleteVideoFile: vi.fn(), updateVideoFileSize },
            },
            event,
            manage,
        );
        finish.set();

        try {
            await manage.push({ ...request(32_001), sourceVideoFileId: 42_001 } as apid.AddEncodeProgramOption);
            await vi.waitFor(() => expect(actual.model.childProcess).not.toBeNull());
            const child = actual.model.childProcess;
            if (child === null) throw new Error('MissingActualChild');
            isolatedChildren.add(child);
            const directSignal = vi.spyOn(child, 'kill');
            notifyClient.mockClear();

            await vi.waitFor(() => expect(addVideoFile).toHaveBeenCalledOnce());
            isolatedChildren.delete(child);
            const outputPath = join(root, 'synthetic-subdirectory', 'input.encoded');
            const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
                argv: string[];
                env: Record<string, string | undefined>;
            };

            expect(report.argv).toEqual([ProcessUtil.ROOT_PATH, ' ', actual.inputPath, outputPath, '%UNTOUCHED%']);
            expect(ENCODE_ENV_KEYS).toHaveLength(35);
            expect(report.env).toEqual({
                RECORDEDID: '10501',
                INPUT: actual.inputPath,
                OUTPUT: outputPath,
                DIR: outputPath,
                SUBDIR: 'synthetic-subdirectory',
                FFMPEG: join(root, 'ffmpeg'),
                FFPROBE: join(root, 'ffprobe'),
                NAME: 'Synthetic recording',
                HALF_WIDTH_NAME: 'half name',
                DESCRIPTION: '',
                HALF_WIDTH_DESCRIPTION: '',
                EXTENDED: '',
                HALF_WIDTH_EXTENDED: '',
                VIDEOTYPE: '',
                VIDEORESOLUTION: '',
                VIDEOSTREAMCONTENT: '1',
                VIDEOCOMPONENTTYPE: '179',
                AUDIOSAMPLINGRATE: '48000',
                AUDIOCOMPONENTTYPE: '0',
                CHANNELID: '10503',
                CHANNELNAME: 'Channel name',
                HALF_WIDTH_CHANNELNAME: 'half channel',
                GENRE1: '0',
                SUBGENRE1: '1',
                GENRE2: '',
                SUBGENRE2: '',
                GENRE3: '15',
                SUBGENRE3: '0',
                START_AT: '10',
                END_AT: '30',
                DROPLOG_ID: '10504',
                DROPLOG_PATH: 'drop.json',
                DROP_CNT: '0',
                ERROR_CNT: '7',
                SCRAMBLING_CNT: '11',
                [parentMarkerKey]: 'task-6-2-parent-marker',
            });
            expect(actual.model.getProgressInfo()).toEqual({ log: 'synthetic progress', percent: 37 });
            expect(notifyUpdateEncodeProgress).toHaveBeenCalledOnce();
            await expect(readFile(outputPath, 'utf8')).resolves.toBe('synthetic encoded output');
            expect(addVideoFile).toHaveBeenCalledExactlyOnceWith({
                recordedId: 32_001,
                parentDirectoryName: 'synthetic-parent',
                type: 'encoded',
                name: 'synthetic-mode',
                filePath: 'synthetic-subdirectory/input.encoded',
            });
            expect(updateVideoFileSize).not.toHaveBeenCalled();
            expect(notifyClient).toHaveBeenCalledOnce();
            expect(emitFinishEncode).toHaveBeenCalledExactlyOnceWith({
                recordedId: 32_001,
                videoFileId: 90_001,
                mode: 'synthetic-mode',
            });
            expect(directSignal).not.toHaveBeenCalled();
            expect(child.exitCode).toBe(0);
            expect(actual.model.childProcess).toBeNull();
            expect(actual.fileManager.usedFileNameIndex).toEqual({});
            expect(processManager.childs).toEqual([]);
            expect(processManager.reservations.size).toBe(0);
            expect(child.eventNames()).toEqual([]);
            expect(child.stdout?.listenerCount('data')).toBe(0);
            expect(child.stderr?.listenerCount('data')).toBe(0);
            expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            await removeTemporaryRoot(root);
        } finally {
            if (restoredParentMarker === undefined) delete process.env[parentMarkerKey];
            else process.env[parentMarkerKey] = restoredParentMarker;
            (manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();
            (event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
        }
    });

    it('[EN-INTEGRATION-T6-2-NO-OUTPUT] connects an actual no-output child to recorded file-size reflection', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-child-no-output-'));
        temporaryRoots.add(root);
        const { reportPath, scriptPath } = await writeCompletingChild(root);
        await writeFile(join(root, 'input.ts'), 'synthetic input');
        const logger = {
            encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { error: vi.fn() },
        };
        const processManager = new EncodeProcessManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ encodeProcessNum: 1 }) },
        );
        const event = new EncodeEvent({ getLogger: () => logger });
        const actual = makeActualEncoder(root, processManager, {
            cmd: `%NODE% ${scriptPath} ${reportPath} %ROOT% %SPACE% %INPUT% %OUTPUT% %UNTOUCHED%`,
            deferOption: true,
            encodeEvent: event,
        });
        const addVideoFile = vi.fn(async () => 90_002);
        const updateVideoFileSize = vi.fn(async () => undefined);
        const notifyClient = vi.fn();
        const emitFinishEncode = vi.fn(async () => undefined);
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 2 }) },
            { getExecution: vi.fn(async () => 'synthetic-execution'), unLockExecution: vi.fn() },
            vi.fn(async () => actual.model),
            event,
            {
                acquire: vi.fn(async () => ({ token: {} })),
                release: vi.fn(async () => undefined),
            },
        );
        const finish = new EncodeFinishModel(
            { getLogger: () => logger },
            { notifyClient, notifyUpdateEncodeProgress: vi.fn() },
            {
                encodeEvent: { emitFinishEncode },
                recorded: { addVideoFile, deleteVideoFile: vi.fn(), updateVideoFileSize },
            },
            event,
            manage,
        );
        finish.set();

        try {
            await manage.push({ ...request(32_002), sourceVideoFileId: 42_002 } as apid.AddEncodeProgramOption);
            await vi.waitFor(() => expect(actual.model.childProcess).not.toBeNull());
            const child = actual.model.childProcess;
            if (child === null) throw new Error('MissingActualChild');
            isolatedChildren.add(child);
            const directSignal = vi.spyOn(child, 'kill');
            notifyClient.mockClear();

            await vi.waitFor(() => expect(updateVideoFileSize).toHaveBeenCalledExactlyOnceWith(42_002));
            isolatedChildren.delete(child);
            const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
                argv: string[];
                env: Record<string, string | undefined>;
            };

            expect(report.argv).toEqual([ProcessUtil.ROOT_PATH, ' ', actual.inputPath, '%OUTPUT%', '%UNTOUCHED%']);
            expect(report.env).toMatchObject({
                DIR: 'synthetic-subdirectory',
                OUTPUT: '',
                SUBDIR: 'synthetic-subdirectory',
            });
            expect(addVideoFile).not.toHaveBeenCalled();
            expect(notifyClient).toHaveBeenCalledOnce();
            expect(emitFinishEncode).toHaveBeenCalledExactlyOnceWith({
                recordedId: 32_002,
                videoFileId: null,
                mode: 'synthetic-mode',
            });
            expect(directSignal).not.toHaveBeenCalled();
            expect(child.exitCode).toBe(0);
            expect(actual.model.childProcess).toBeNull();
            expect(actual.fileManager.usedFileNameIndex).toEqual({});
            expect(processManager.childs).toEqual([]);
            expect(processManager.reservations.size).toBe(0);
            expect(child.eventNames()).toEqual([]);
            expect(child.stdout?.listenerCount('data')).toBe(0);
            expect(child.stderr?.listenerCount('data')).toBe(0);
            expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            await removeTemporaryRoot(root);
        } finally {
            (manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();
            (event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
        }
    });

    for (const trigger of ['cancel', 'deadline'] as const) {
        it(`[EN-INTEGRATION-T6-2-${trigger.toUpperCase()}] keeps the next job waiting until an actual partial-output child terminals and cleans up`, async () => {
            vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);
            const root = await mkdtemp(join(tmpdir(), `epgstation-encoding-child-${trigger}-`));
            temporaryRoots.add(root);
            const { reportPath, scriptPath, stopPath, terminalPath } = await writeStoppingChild(root);
            await writeFile(join(root, 'input.ts'), 'synthetic input');
            const logger = {
                encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
                system: { error: vi.fn() },
            };
            const processManager = new EncodeProcessManageModel(
                { getLogger: () => logger },
                { getConfig: () => ({ encodeProcessNum: 1 }) },
            );
            const createManaged = vi.spyOn(processManager, 'createManaged');
            const stopThroughManager = vi.spyOn(ProcessUtil, 'kill').mockImplementation(async () => {
                await writeFile(stopPath, 'requested');
            });
            const requestStop = vi.spyOn(processManager, 'requestStop');
            const actual = makeActualEncoder(root, processManager, {
                cmd: `%NODE% ${scriptPath} ${reportPath} ${stopPath} ${terminalPath}`,
                deferOption: true,
                rate: trigger === 'deadline' ? 0.01 : 1,
                suffix: '.partial',
            });
            const finished = waitForEncoderFinish(actual.model);
            const next = makeEncoder();
            const execution = {
                getExecution: vi.fn(async () => 'synthetic-execution'),
                unLockExecution: vi.fn(),
            };
            const manage = new EncodeManageModel(
                { getLogger: () => logger },
                { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 2 }) },
                execution,
                vi.fn().mockResolvedValueOnce(actual.model).mockResolvedValueOnce(next),
                {
                    emitAddEncode: vi.fn(),
                    emitCancelEncode: vi.fn(),
                    emitErrorEncode: vi.fn(),
                    emitFinishEncode: vi.fn(),
                    emitUpdateEncodeProgress: vi.fn(),
                },
                {
                    acquire: vi.fn(async () => ({ token: {} })),
                    release: vi.fn(async () => undefined),
                },
            ) as EncodeManageRuntime & { cancel(id: number): Promise<void>; listener: EventEmitter };

            try {
                await manage.push({ ...request(32_003), sourceVideoFileId: 42_003 } as apid.AddEncodeProgramOption);
                await vi.waitFor(() => expect(actual.model.childProcess).not.toBeNull());
                const child = actual.model.childProcess;
                if (child === null) throw new Error('MissingActualChild');
                isolatedChildren.add(child);
                const directSignal = vi.spyOn(child, 'kill');
                const outputPath = join(root, 'synthetic-subdirectory', 'input.partial');
                await vi.waitFor(async () =>
                    expect(await readFile(outputPath, 'utf8')).toBe('synthetic partial output'),
                );
                await manage.push(request(32_004) as apid.AddEncodeProgramOption);
                await vi.waitFor(() =>
                    expect(manage.getEncodeInfo()).toEqual({
                        runningQueue: [{ id: 1, mode: 'synthetic-mode', recordedId: 32_003 }],
                        waitQueue: [{ id: 2, mode: 'synthetic-mode', recordedId: 32_004 }],
                    }),
                );

                if (trigger === 'cancel') {
                    await manage.cancel(1);
                } else {
                    await vi.waitFor(() => expect(requestStop).toHaveBeenCalledOnce(), { timeout: 2_000 });
                }
                const started = (await createManaged.mock.results[0]?.value) as
                    { handle: ManagedProcessHandle } | undefined;
                if (started === undefined) throw new Error('MissingManagedStartResult');

                expect(createManaged).toHaveBeenCalledOnce();
                expect(requestStop).toHaveBeenCalledExactlyOnceWith(started.handle);
                expect(stopThroughManager).toHaveBeenCalledOnce();
                expect(next.start).not.toHaveBeenCalled();
                expect(manage.getEncodeInfo()).toEqual({
                    runningQueue: [{ id: 1, mode: 'synthetic-mode', recordedId: 32_003 }],
                    waitQueue: [{ id: 2, mode: 'synthetic-mode', recordedId: 32_004 }],
                });
                expect(directSignal).not.toHaveBeenCalled();

                await writeFile(terminalPath, 'permitted');
                await expect(finished).resolves.toEqual({ isError: true, output: outputPath });
                isolatedChildren.delete(child);
                await vi.waitFor(() => expect(next.start).toHaveBeenCalledOnce());

                expect(child.exitCode).toBe(0);
                await expect(readFile(outputPath)).rejects.toThrow();
                await expect(readFile(actual.inputPath, 'utf8')).resolves.toBe('synthetic input');
                await expect(readFile(reportPath, 'utf8')).resolves.toBe('started');
                expect(actual.model.childProcess).toBeNull();
                expect(actual.fileManager.usedFileNameIndex).toEqual({});
                expect(processManager.childs).toEqual([]);
                expect(processManager.reservations.size).toBe(0);
                expect(child.eventNames()).toEqual([]);
                expect(child.stdout?.listenerCount('data')).toBe(0);
                expect(child.stderr?.listenerCount('data')).toBe(0);
                expect(manage.getEncodeInfo()).toEqual({
                    runningQueue: [{ id: 2, mode: 'synthetic-mode', recordedId: 32_004 }],
                    waitQueue: [],
                });

                next.startGate.resolve(undefined);
                await vi.waitFor(() => expect(next.start).toHaveBeenCalledOnce());
                next.finish();
                await vi.waitFor(() => expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }));
                await removeTemporaryRoot(root);
            } finally {
                manage.listener.removeAllListeners();
            }
        });
    }
});

describe('HTTP, IPC, filesystem, and process boundary integration', () => {
    it('[EN-INTEGRATION-T6-6-HTTP-IPC-FS-PROCESS] connects HTTP list/add/cancel to IPC reflection while preserving collision and source cleanup boundaries', async () => {
        vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-task-6-6-'));
        temporaryRoots.add(root);
        const outputDirectory = join(root, 'synthetic-subdirectory');
        const inputPath = join(root, 'input.ts');
        const preexistingOutputPath = join(outputDirectory, 'input.encoded');
        await mkdir(outputDirectory, { recursive: true });
        await Promise.all([
            writeFile(inputPath, 'synthetic source'),
            writeFile(preexistingOutputPath, 'synthetic collision sentinel'),
        ]);

        const completing = await writeCompletingChild(root);
        const stopping = await writeStoppingChild(root);
        const logger = {
            encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { error: vi.fn() },
        };
        const processManager = new EncodeProcessManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ encodeProcessNum: 1 }) },
        );
        const stopThroughManager = vi.spyOn(ProcessUtil, 'kill').mockImplementation(async () => {
            await writeFile(stopping.stopPath, 'requested');
        });
        const event = new EncodeEvent({ getLogger: () => logger });
        const outputEncoder = makeActualEncoder(root, processManager, {
            cmd: `%NODE% ${completing.scriptPath} ${completing.reportPath}`,
            deferOption: true,
            encodeEvent: event,
            suffix: '.encoded',
        });
        const sizeEncoder = makeActualEncoder(root, processManager, {
            cmd: `%NODE% ${completing.scriptPath} ${completing.reportPath}`,
            deferOption: true,
            encodeEvent: event,
        });
        const partialEncoder = makeActualEncoder(root, processManager, {
            cmd: `%NODE% ${stopping.scriptPath} ${stopping.reportPath} ${stopping.stopPath} ${stopping.terminalPath}`,
            deferOption: true,
            encodeEvent: event,
            suffix: '.encoded',
        });
        const addFailureEncoder = makeActualEncoder(root, processManager, {
            cmd: `%NODE% ${completing.scriptPath} ${completing.reportPath}`,
            deferOption: true,
            encodeEvent: event,
            suffix: '.encoded',
        });
        const sizeFailureEncoder = makeActualEncoder(root, processManager, {
            cmd: `%NODE% ${completing.scriptPath} ${completing.reportPath}`,
            deferOption: true,
            encodeEvent: event,
        });
        const deleteFailureEncoder = makeActualEncoder(root, processManager, {
            cmd: `%NODE% ${completing.scriptPath} ${completing.reportPath}`,
            deferOption: true,
            encodeEvent: event,
        });
        const finishFailureEncoder = makeActualEncoder(root, processManager, {
            cmd: `%NODE% ${completing.scriptPath} ${completing.reportPath}`,
            deferOption: true,
            encodeEvent: event,
        });
        const serializationFailureEncoder = makeActualEncoder(root, processManager, {
            cmd: `%NODE% ${completing.scriptPath} ${completing.reportPath}`,
            deferOption: true,
            encodeEvent: event,
        });
        const provider = vi
            .fn()
            .mockResolvedValueOnce(outputEncoder.model)
            .mockResolvedValueOnce(sizeEncoder.model)
            .mockResolvedValueOnce(partialEncoder.model)
            .mockResolvedValueOnce(addFailureEncoder.model)
            .mockResolvedValueOnce(sizeFailureEncoder.model)
            .mockResolvedValueOnce(deleteFailureEncoder.model)
            .mockResolvedValueOnce(finishFailureEncoder.model)
            .mockResolvedValueOnce(serializationFailureEncoder.model);
        const execution = {
            getExecution: vi.fn(async () => 'synthetic-execution'),
            unLockExecution: vi.fn(),
        };
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 3 }) },
            execution,
            provider,
            event,
            {
                acquire: vi.fn(async () => ({ token: {} })),
                release: vi.fn(async () => undefined),
            },
        );
        const api = new EncodeApiModel(
            manage,
            {},
            { findIds: vi.fn(async (ids: number[]) => ids.map(id => ({ id }))) },
            { convertRecordedToRecordedItem: vi.fn((recorded: { id: number }) => ({ id: recorded.id })) },
        );
        let addFailure: Error | null = null;
        const addVideoFile = vi.fn(async () => {
            const failure = addFailure;
            addFailure = null;
            if (failure !== null) throw failure;
            return 66_101;
        });
        let sizeFailure: Error | null = null;
        const updateVideoFileSize = vi.fn(async () => {
            const failure = sizeFailure;
            sizeFailure = null;
            if (failure !== null) throw failure;
        });
        const preparedSources = new Map<object, number>();
        const prepareVideoFileDeletion = vi.fn(async (videoFileId: number) => {
            const preparedDeletionToken = {};
            preparedSources.set(preparedDeletionToken, videoFileId);
            return { status: 'prepared', token: preparedDeletionToken };
        });
        let deleteFailure: Error | null = null;
        const deletePreparedVideoFile = vi.fn(async (token: object) => {
            if (preparedSources.has(token) === false) throw new Error('UnexpectedPreparedSourceToken');
            const failure = deleteFailure;
            deleteFailure = null;
            if (failure !== null) throw failure;
            return { status: 'video-file-deleted' };
        });
        let finishFailure: Error | null = null;
        const emitFinishEncode = vi.fn(async () => {
            const failure = finishFailure;
            finishFailure = null;
            if (failure !== null) throw failure;
        });
        const existingMessageListeners = new Set(process.listeners('message'));
        const processSendDescriptor = Object.getOwnPropertyDescriptor(process, 'send');
        const ipcChild = new EventEmitter() as EventEmitter & Record<string, unknown>;
        ipcChild.connected = true;
        const unusedIpcModel = {};
        const ipcServer = new IPCServer(
            unusedIpcModel,
            {
                addVideoFile,
                deletePreparedVideoFile,
                prepareVideoFileDeletion,
                updateVideoFileSize,
            },
            unusedIpcModel,
            unusedIpcModel,
            unusedIpcModel,
            unusedIpcModel,
            { getLogger: () => logger },
            { initialize: vi.fn(async () => undefined) },
        );
        ipcServer.encodeCompletionSinkRegistrationPort.register({ accept: emitFinishEncode });
        const ipcClient = new IPCClient({ getLogger: () => logger }, { notifyClient: vi.fn() }, { push: vi.fn() });
        const clientMessageListeners = process
            .listeners('message')
            .filter(listener => existingMessageListeners.has(listener) === false);
        const deliverIpcReply = (message: unknown, callback?: (error: Error | null) => void): void => {
            void Promise.all(clientMessageListeners.map(listener => listener(message))).then(
                () => callback?.(null),
                error => callback?.(error instanceof Error ? error : new Error(String(error))),
            );
        };
        const parentReplies = vi.fn((message: unknown, callback?: (error: Error | null) => void) => {
            deliverIpcReply(message, callback);
        });
        ipcChild.send = parentReplies;
        let serializationFailure: { error: Error; func: string; model: string } | null = null;
        const childRequests = vi.fn((message: unknown, callback?: (error: Error | null) => void) => {
            const request = message as { func?: string; model?: string };
            if (
                serializationFailure !== null &&
                request.func === serializationFailure.func &&
                request.model === serializationFailure.model
            ) {
                const failure = serializationFailure.error;
                serializationFailure = null;
                throw failure;
            }
            ipcChild.emit('message', message);
            callback?.(null);
            return true;
        });
        Object.defineProperty(process, 'send', { configurable: true, value: childRequests, writable: true });
        ipcServer.register(ipcChild as unknown as ChildProcess);
        await ipcServer.initialize();
        const socket = { notifyClient: vi.fn(), notifyUpdateEncodeProgress: vi.fn() };
        const finish = new EncodeFinishModel({ getLogger: () => logger }, socket, ipcClient, event, manage);
        const containerGet = vi.spyOn(modelContainer, 'get').mockImplementation(identifier => {
            if (identifier === 'IEncodeApiModel') return api;
            throw new Error(`UnexpectedModelContainerLookup:${identifier}`);
        });
        const response = () => ({ header: vi.fn(), json: vi.fn(), status: vi.fn() });
        const requestThroughHttp = (recordedId: number, sourceVideoFileId: number) => ({
            ...request(recordedId),
            removeOriginal: true,
            sourceVideoFileId,
        });
        const manageEmitter = (manage as unknown as { listener: EventEmitter }).listener;
        const eventEmitter = (event as unknown as { emitter: EventEmitter }).emitter;
        let ipcDisconnected = false;
        let processSendRestored = false;
        finish.set();

        try {
            const rejectedAdd = response();
            await encodeHttp.post(
                {
                    body: {
                        mode: 'synthetic-mode',
                        recordedId: 66_000,
                        removeOriginal: true,
                        sourceVideoFileId: 66_002,
                    },
                },
                rejectedAdd,
            );
            expect(rejectedAdd.status).toHaveBeenCalledExactlyOnceWith(500);
            expect(rejectedAdd.json).toHaveBeenCalledExactlyOnceWith({
                code: 500,
                errors: 'OptionError',
                message: 'Internal Server Error',
            });
            expect(provider).not.toHaveBeenCalled();

            const addedOutput = response();
            await encodeHttp.post({ body: requestThroughHttp(66_001, 66_003) }, addedOutput);
            expect(addedOutput.status).toHaveBeenCalledExactlyOnceWith(201);
            expect(addedOutput.json).toHaveBeenCalledExactlyOnceWith({ encodeId: 1 });
            await vi.waitFor(() => expect(outputEncoder.model.childProcess).not.toBeNull());
            const outputChild = outputEncoder.model.childProcess;
            if (outputChild === null) throw new Error('MissingOutputChild');
            isolatedChildren.add(outputChild);

            const listedRunning = response();
            await encodeHttp.get({ query: { isHalfWidth: false } }, listedRunning);
            expect(listedRunning.status).toHaveBeenCalledExactlyOnceWith(200);
            expect(listedRunning.json).toHaveBeenCalledExactlyOnceWith({
                runningItems: [{ id: 1, mode: 'synthetic-mode', recorded: { id: 66_001 } }],
                waitItems: [],
            });

            await vi.waitFor(() => expect(addVideoFile).toHaveBeenCalledOnce());
            isolatedChildren.delete(outputChild);
            const generatedOutputPath = join(outputDirectory, 'input(1).encoded');
            expect(addVideoFile).toHaveBeenCalledExactlyOnceWith({
                recordedId: 66_001,
                parentDirectoryName: 'synthetic-parent',
                type: 'encoded',
                name: 'synthetic-mode',
                filePath: 'synthetic-subdirectory/input(1).encoded',
            });
            await expect(readFile(preexistingOutputPath, 'utf8')).resolves.toBe('synthetic collision sentinel');
            expect((await stat(generatedOutputPath)).isFile()).toBe(true);
            expect(prepareVideoFileDeletion).toHaveBeenCalledExactlyOnceWith(66_003);
            expect(deletePreparedVideoFile).toHaveBeenCalledOnce();
            expect(emitFinishEncode).toHaveBeenCalledExactlyOnceWith({
                recordedId: 66_001,
                videoFileId: 66_101,
                mode: 'synthetic-mode',
            });
            await vi.waitFor(() => expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }));

            const addedSizeOnly = response();
            await encodeHttp.post({ body: requestThroughHttp(66_002, 66_004) }, addedSizeOnly);
            expect(addedSizeOnly.status).toHaveBeenCalledExactlyOnceWith(201);
            expect(addedSizeOnly.json).toHaveBeenCalledExactlyOnceWith({ encodeId: 2 });
            await vi.waitFor(() => expect(sizeEncoder.model.childProcess).not.toBeNull());
            const sizeChild = sizeEncoder.model.childProcess;
            if (sizeChild === null) throw new Error('MissingSizeChild');
            isolatedChildren.add(sizeChild);
            await vi.waitFor(() => expect(updateVideoFileSize).toHaveBeenCalledExactlyOnceWith(66_004));
            isolatedChildren.delete(sizeChild);
            expect(prepareVideoFileDeletion).toHaveBeenNthCalledWith(2, 66_004);
            expect(deletePreparedVideoFile).toHaveBeenCalledTimes(2);
            expect(emitFinishEncode).toHaveBeenNthCalledWith(2, {
                recordedId: 66_002,
                videoFileId: null,
                mode: 'synthetic-mode',
            });
            await vi.waitFor(() => expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }));

            const addedPartial = response();
            await encodeHttp.post({ body: requestThroughHttp(66_003, 66_005) }, addedPartial);
            expect(addedPartial.status).toHaveBeenCalledExactlyOnceWith(201);
            expect(addedPartial.json).toHaveBeenCalledExactlyOnceWith({ encodeId: 3 });
            await vi.waitFor(() => expect(partialEncoder.model.childProcess).not.toBeNull());
            const partialChild = partialEncoder.model.childProcess;
            if (partialChild === null) throw new Error('MissingPartialChild');
            isolatedChildren.add(partialChild);
            const partialOutputPath = join(outputDirectory, 'input(2).encoded');
            await vi.waitFor(async () => expect((await stat(partialOutputPath)).isFile()).toBe(true));

            const listedPartial = response();
            await encodeHttp.get({ query: { isHalfWidth: false } }, listedPartial);
            expect(listedPartial.status).toHaveBeenCalledExactlyOnceWith(200);
            expect(listedPartial.json).toHaveBeenCalledExactlyOnceWith({
                runningItems: [{ id: 3, mode: 'synthetic-mode', recorded: { id: 66_003 } }],
                waitItems: [],
            });

            const canceled = response();
            await encodeIdHttp.del({ params: { encodeId: '3' } }, canceled);
            expect(canceled.status).toHaveBeenCalledExactlyOnceWith(200);
            expect(canceled.json).toHaveBeenCalledExactlyOnceWith({ code: 200 });
            expect(stopThroughManager).toHaveBeenCalledOnce();
            await writeFile(stopping.terminalPath, 'permitted');
            await vi.waitFor(() => expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }));
            isolatedChildren.delete(partialChild);

            await expect(stat(partialOutputPath)).rejects.toThrow();
            await expect(readFile(inputPath, 'utf8')).resolves.toBe('synthetic source');
            expect(prepareVideoFileDeletion).toHaveBeenCalledTimes(2);
            expect(deletePreparedVideoFile).toHaveBeenCalledTimes(2);
            expect(emitFinishEncode).toHaveBeenCalledTimes(2);
            expect(
                childRequests.mock.calls.slice(0, 6).map(([message]) => {
                    const request = message as { args?: unknown; func: string; model: string };
                    return { args: request.args, func: request.func, model: request.model };
                }),
            ).toEqual([
                {
                    args: {
                        option: {
                            filePath: 'synthetic-subdirectory/input(1).encoded',
                            name: 'synthetic-mode',
                            parentDirectoryName: 'synthetic-parent',
                            recordedId: 66_001,
                            type: 'encoded',
                        },
                    },
                    func: 'addVideoFile',
                    model: 'recorded',
                },
                { args: { videoFileId: 66_003 }, func: 'deleteVideoFile', model: 'recorded' },
                {
                    args: { info: { mode: 'synthetic-mode', recordedId: 66_001, videoFileId: 66_101 } },
                    func: 'emitFinishEncode',
                    model: 'encodeEvent',
                },
                { args: { videoFileId: 66_004 }, func: 'updateVideoFileSize', model: 'recorded' },
                { args: { videoFileId: 66_004 }, func: 'deleteVideoFile', model: 'recorded' },
                {
                    args: { info: { mode: 'synthetic-mode', recordedId: 66_002, videoFileId: null } },
                    func: 'emitFinishEncode',
                    model: 'encodeEvent',
                },
            ]);

            const notificationsBeforeAddFailure = socket.notifyClient.mock.calls.length;
            addFailure = new Error('SyntheticIpcAddFailure');
            const addedWithAddFailure = response();
            await encodeHttp.post({ body: requestThroughHttp(66_004, 66_006) }, addedWithAddFailure);
            expect(addedWithAddFailure.status).toHaveBeenCalledExactlyOnceWith(201);
            expect(addedWithAddFailure.json).toHaveBeenCalledExactlyOnceWith({ encodeId: 4 });
            await vi.waitFor(() => expect(addFailureEncoder.model.childProcess).not.toBeNull());
            const addFailureChild = addFailureEncoder.model.childProcess;
            if (addFailureChild === null) throw new Error('MissingAddFailureChild');
            isolatedChildren.add(addFailureChild);
            await vi.waitFor(() => expect(addVideoFile).toHaveBeenCalledTimes(2));
            await vi.waitFor(() => expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }));
            isolatedChildren.delete(addFailureChild);
            expect(prepareVideoFileDeletion).toHaveBeenCalledTimes(2);
            expect(deletePreparedVideoFile).toHaveBeenCalledTimes(2);
            expect(emitFinishEncode).toHaveBeenNthCalledWith(3, {
                recordedId: 66_004,
                videoFileId: null,
                mode: 'synthetic-mode',
            });
            expect(socket.notifyClient).toHaveBeenCalledTimes(notificationsBeforeAddFailure + 2);
            await expect(readFile(inputPath, 'utf8')).resolves.toBe('synthetic source');

            const notificationsBeforeSizeFailure = socket.notifyClient.mock.calls.length;
            sizeFailure = new Error('SyntheticIpcSizeFailure');
            const addedWithSizeFailure = response();
            await encodeHttp.post({ body: requestThroughHttp(66_005, 66_007) }, addedWithSizeFailure);
            expect(addedWithSizeFailure.status).toHaveBeenCalledExactlyOnceWith(201);
            expect(addedWithSizeFailure.json).toHaveBeenCalledExactlyOnceWith({ encodeId: 5 });
            await vi.waitFor(() => expect(sizeFailureEncoder.model.childProcess).not.toBeNull());
            const sizeFailureChild = sizeFailureEncoder.model.childProcess;
            if (sizeFailureChild === null) throw new Error('MissingSizeFailureChild');
            isolatedChildren.add(sizeFailureChild);
            await vi.waitFor(() => expect(updateVideoFileSize).toHaveBeenCalledTimes(2));
            await vi.waitFor(() => expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }));
            isolatedChildren.delete(sizeFailureChild);
            expect(prepareVideoFileDeletion).toHaveBeenCalledTimes(2);
            expect(deletePreparedVideoFile).toHaveBeenCalledTimes(2);
            expect(emitFinishEncode).toHaveBeenNthCalledWith(4, {
                recordedId: 66_005,
                videoFileId: null,
                mode: 'synthetic-mode',
            });
            expect(socket.notifyClient).toHaveBeenCalledTimes(notificationsBeforeSizeFailure + 2);
            await expect(readFile(inputPath, 'utf8')).resolves.toBe('synthetic source');

            const notificationsBeforeDeleteFailure = socket.notifyClient.mock.calls.length;
            deleteFailure = new Error('SyntheticIpcSourceDeleteFailure');
            const addedWithDeleteFailure = response();
            await encodeHttp.post({ body: requestThroughHttp(66_006, 66_008) }, addedWithDeleteFailure);
            expect(addedWithDeleteFailure.status).toHaveBeenCalledExactlyOnceWith(201);
            expect(addedWithDeleteFailure.json).toHaveBeenCalledExactlyOnceWith({ encodeId: 6 });
            await vi.waitFor(() => expect(deleteFailureEncoder.model.childProcess).not.toBeNull());
            const deleteFailureChild = deleteFailureEncoder.model.childProcess;
            if (deleteFailureChild === null) throw new Error('MissingDeleteFailureChild');
            isolatedChildren.add(deleteFailureChild);
            await vi.waitFor(() => expect(deletePreparedVideoFile).toHaveBeenCalledTimes(3));
            await vi.waitFor(() => expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }));
            isolatedChildren.delete(deleteFailureChild);
            expect(prepareVideoFileDeletion).toHaveBeenNthCalledWith(3, 66_008);
            expect(emitFinishEncode).toHaveBeenCalledTimes(4);
            expect(socket.notifyClient).toHaveBeenCalledTimes(notificationsBeforeDeleteFailure + 1);
            await expect(readFile(inputPath, 'utf8')).resolves.toBe('synthetic source');

            const notificationsBeforeFinishFailure = socket.notifyClient.mock.calls.length;
            finishFailure = new Error('SyntheticIpcFinishFailure');
            const addedWithFinishFailure = response();
            await encodeHttp.post({ body: requestThroughHttp(66_007, 66_009) }, addedWithFinishFailure);
            expect(addedWithFinishFailure.status).toHaveBeenCalledExactlyOnceWith(201);
            expect(addedWithFinishFailure.json).toHaveBeenCalledExactlyOnceWith({ encodeId: 7 });
            await vi.waitFor(() => expect(finishFailureEncoder.model.childProcess).not.toBeNull());
            const finishFailureChild = finishFailureEncoder.model.childProcess;
            if (finishFailureChild === null) throw new Error('MissingFinishFailureChild');
            isolatedChildren.add(finishFailureChild);
            await vi.waitFor(() => expect(emitFinishEncode).toHaveBeenCalledTimes(5));
            await vi.waitFor(() => expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }));
            isolatedChildren.delete(finishFailureChild);
            expect(prepareVideoFileDeletion).toHaveBeenNthCalledWith(4, 66_009);
            expect(deletePreparedVideoFile).toHaveBeenCalledTimes(4);
            expect(socket.notifyClient).toHaveBeenCalledTimes(notificationsBeforeFinishFailure + 2);
            await expect(readFile(inputPath, 'utf8')).resolves.toBe('synthetic source');

            const notificationsBeforeSerializationFailure = socket.notifyClient.mock.calls.length;
            serializationFailure = {
                error: new Error('SyntheticIpcSerializationFailure'),
                func: 'updateVideoFileSize',
                model: 'recorded',
            };
            const addedWithSerializationFailure = response();
            await encodeHttp.post({ body: requestThroughHttp(66_008, 66_010) }, addedWithSerializationFailure);
            expect(addedWithSerializationFailure.status).toHaveBeenCalledExactlyOnceWith(201);
            expect(addedWithSerializationFailure.json).toHaveBeenCalledExactlyOnceWith({ encodeId: 8 });
            await vi.waitFor(() => expect(serializationFailureEncoder.model.childProcess).not.toBeNull());
            const serializationFailureChild = serializationFailureEncoder.model.childProcess;
            if (serializationFailureChild === null) throw new Error('MissingSerializationFailureChild');
            isolatedChildren.add(serializationFailureChild);
            await vi.waitFor(() => expect(serializationFailure).toBeNull());
            await vi.waitFor(() => expect(emitFinishEncode).toHaveBeenCalledTimes(6));
            await vi.waitFor(() => expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }));
            isolatedChildren.delete(serializationFailureChild);
            expect(updateVideoFileSize).toHaveBeenCalledTimes(4);
            expect(prepareVideoFileDeletion).toHaveBeenCalledTimes(4);
            expect(deletePreparedVideoFile).toHaveBeenCalledTimes(4);
            expect(socket.notifyClient).toHaveBeenCalledTimes(notificationsBeforeSerializationFailure + 2);
            await expect(readFile(inputPath, 'utf8')).resolves.toBe('synthetic source');

            expect(
                childRequests.mock.calls.map(([message]) => {
                    const request = message as { func: string; model: string };
                    return { func: request.func, model: request.model };
                }),
            ).toEqual([
                { func: 'addVideoFile', model: 'recorded' },
                { func: 'deleteVideoFile', model: 'recorded' },
                { func: 'emitFinishEncode', model: 'encodeEvent' },
                { func: 'updateVideoFileSize', model: 'recorded' },
                { func: 'deleteVideoFile', model: 'recorded' },
                { func: 'emitFinishEncode', model: 'encodeEvent' },
                { func: 'addVideoFile', model: 'recorded' },
                { func: 'emitFinishEncode', model: 'encodeEvent' },
                { func: 'updateVideoFileSize', model: 'recorded' },
                { func: 'emitFinishEncode', model: 'encodeEvent' },
                { func: 'updateVideoFileSize', model: 'recorded' },
                { func: 'deleteVideoFile', model: 'recorded' },
                { func: 'updateVideoFileSize', model: 'recorded' },
                { func: 'deleteVideoFile', model: 'recorded' },
                { func: 'emitFinishEncode', model: 'encodeEvent' },
                { func: 'updateVideoFileSize', model: 'recorded' },
                { func: 'emitFinishEncode', model: 'encodeEvent' },
            ]);
            expect(containerGet).toHaveBeenCalledTimes(12);
            expect(processManager.childs).toEqual([]);
            expect(processManager.reservations.size).toBe(0);
            for (const actual of [
                outputEncoder,
                sizeEncoder,
                partialEncoder,
                addFailureEncoder,
                sizeFailureEncoder,
                deleteFailureEncoder,
                finishFailureEncoder,
                serializationFailureEncoder,
            ]) {
                expect(actual.model.childProcess).toBeNull();
                expect(actual.fileManager.usedFileNameIndex).toEqual({});
            }
            for (const child of [
                outputChild,
                sizeChild,
                partialChild,
                addFailureChild,
                sizeFailureChild,
                deleteFailureChild,
                finishFailureChild,
                serializationFailureChild,
            ]) {
                expect(child.eventNames()).toEqual([]);
                expect(child.stdout?.listenerCount('data')).toBe(0);
                expect(child.stderr?.listenerCount('data')).toBe(0);
            }

            ipcChild.emit('disconnect');
            ipcDisconnected = true;
            expect((ipcServer as unknown as IpcServerCleanupRuntime).child).toBeNull();
            expect((ipcServer as unknown as IpcServerCleanupRuntime).currentPeer).toBeNull();
            expect(ipcChild.eventNames()).toEqual([]);
            expect((ipcClient as unknown as IpcClientCleanupRuntime).pending.size).toBe(0);
            expect((ipcClient as unknown as IpcClientCleanupRuntime).allocationWaiters).toEqual([]);
            expect((ipcClient as unknown as IpcClientCleanupRuntime).recordedUseReleasePending.size).toBe(0);
            for (const listener of process.listeners('message')) {
                if (existingMessageListeners.has(listener) === false) process.removeListener('message', listener);
            }
            expect(
                process.listeners('message').filter(listener => existingMessageListeners.has(listener) === false),
            ).toEqual([]);
            if (processSendDescriptor === undefined) delete (process as { send?: unknown }).send;
            else Object.defineProperty(process, 'send', processSendDescriptor);
            processSendRestored = true;
        } finally {
            manageEmitter.removeAllListeners();
            eventEmitter.removeAllListeners();
            if (ipcDisconnected === false) ipcChild.emit('disconnect');
            for (const listener of process.listeners('message')) {
                if (existingMessageListeners.has(listener) === false) process.removeListener('message', listener);
            }
            if (processSendRestored === false) {
                if (processSendDescriptor === undefined) delete (process as { send?: unknown }).send;
                else Object.defineProperty(process, 'send', processSendDescriptor);
            }
        }
    });

    it('[EN-INTEGRATION-HTTP-CANCEL-WAITING-ID] cancels a waiting request through DELETE /encode/{encodeId} without starting it and leaves the running request untouched', async () => {
        const logger = {
            encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { error: vi.fn() },
        };
        const event = new EncodeEvent({ getLogger: () => logger });
        const runningEncoder = makeEncoder();
        const waitingEncoder = makeEncoder();
        const provider = vi.fn().mockResolvedValueOnce(runningEncoder).mockResolvedValueOnce(waitingEncoder);
        const runningToken = {};
        const waitingToken = {};
        const acquire = vi
            .fn()
            .mockResolvedValueOnce({ token: runningToken })
            .mockResolvedValueOnce({ token: waitingToken });
        const release = vi.fn(async () => undefined);
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 3 }) },
            { getExecution: vi.fn(async () => 'synthetic-execution'), unLockExecution: vi.fn() },
            provider,
            event,
            { acquire, release },
        );
        const api = new EncodeApiModel(
            manage,
            {},
            { findIds: vi.fn(async (ids: number[]) => ids.map(id => ({ id }))) },
            { convertRecordedToRecordedItem: vi.fn((recorded: { id: number }) => ({ id: recorded.id })) },
        );
        vi.spyOn(modelContainer, 'get').mockImplementation(identifier => {
            if (identifier === 'IEncodeApiModel') return api;
            throw new Error(`UnexpectedModelContainerLookup:${identifier}`);
        });
        const cancelNotifications: number[] = [];
        event.setCancelEncode(encodeId => {
            cancelNotifications.push(encodeId);
        });
        const response = () => ({ header: vi.fn(), json: vi.fn(), status: vi.fn() });
        const manageEmitter = (manage as unknown as { listener: EventEmitter }).listener;
        const eventEmitter = (event as unknown as { emitter: EventEmitter }).emitter;

        try {
            const addedRunning = response();
            await encodeHttp.post({ body: request(70_001) }, addedRunning);
            expect(addedRunning.status).toHaveBeenCalledExactlyOnceWith(201);
            expect(addedRunning.json).toHaveBeenCalledExactlyOnceWith({ encodeId: 1 });
            await vi.waitFor(() => expect(runningEncoder.start).toHaveBeenCalledOnce());

            const addedWaiting = response();
            await encodeHttp.post({ body: request(70_002) }, addedWaiting);
            expect(addedWaiting.status).toHaveBeenCalledExactlyOnceWith(201);
            expect(addedWaiting.json).toHaveBeenCalledExactlyOnceWith({ encodeId: 2 });
            await flushEventLoop();
            expect(waitingEncoder.start).not.toHaveBeenCalled();

            const listedBefore = response();
            await encodeHttp.get({ query: { isHalfWidth: false } }, listedBefore);
            expect(listedBefore.status).toHaveBeenCalledExactlyOnceWith(200);
            expect(listedBefore.json).toHaveBeenCalledExactlyOnceWith({
                runningItems: [{ id: 1, mode: 'synthetic-mode', recorded: { id: 70_001 } }],
                waitItems: [{ id: 2, mode: 'synthetic-mode', recorded: { id: 70_002 } }],
            });

            const canceledWaiting = response();
            await encodeIdHttp.del({ params: { encodeId: '2' } }, canceledWaiting);
            expect(canceledWaiting.status).toHaveBeenCalledExactlyOnceWith(200);
            expect(canceledWaiting.json).toHaveBeenCalledExactlyOnceWith({ code: 200 });
            expect(cancelNotifications).toEqual([2]);
            expect(release).toHaveBeenCalledExactlyOnceWith(waitingToken);
            await flushEventLoop();
            expect(waitingEncoder.start).not.toHaveBeenCalled();
            expect(waitingEncoder.cancel).not.toHaveBeenCalled();
            expect(runningEncoder.cancel).not.toHaveBeenCalled();
            expect(runningEncoder.start).toHaveBeenCalledOnce();
            const listedAfter = response();
            await encodeHttp.get({ query: { isHalfWidth: false } }, listedAfter);
            expect(listedAfter.json).toHaveBeenCalledExactlyOnceWith({
                runningItems: [{ id: 1, mode: 'synthetic-mode', recorded: { id: 70_001 } }],
                waitItems: [],
            });

            const canceledUnknown = response();
            await encodeIdHttp.del({ params: { encodeId: '99' } }, canceledUnknown);
            expect(canceledUnknown.status).toHaveBeenCalledExactlyOnceWith(200);
            expect(canceledUnknown.json).toHaveBeenCalledExactlyOnceWith({ code: 200 });
            expect(cancelNotifications).toEqual([2, 99]);
            await flushEventLoop();
            expect(release).toHaveBeenCalledOnce();
            expect(runningEncoder.cancel).not.toHaveBeenCalled();
            expect(manage.getEncodeInfo()).toEqual({
                runningQueue: [{ id: 1, mode: 'synthetic-mode', recordedId: 70_001 }],
                waitQueue: [],
            });

            runningEncoder.startGate.resolve();
            runningEncoder.finish();
            await vi.waitFor(() => expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }));
            expect(release).toHaveBeenCalledTimes(2);
            expect(release).toHaveBeenLastCalledWith(runningToken);
        } finally {
            manageEmitter.removeAllListeners();
            eventEmitter.removeAllListeners();
        }
    });
});

// node の script の代わりに、同梱の encode command（config/enc.js.template）と本物の ffmpeg で、同じ queue と
// 終了の経路を流す。入力は本物の ffmpeg で作った合成の TS。
describe('node script encoder against the bundled encode command and the real ffmpeg', () => {
    const prepareRealEncodeRoot = async (seconds: number): Promise<{ root: string; script: string }> => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-real-ffmpeg-'));
        temporaryRoots.add(root);
        await createSyntheticMedia(root, 'input.ts', 'mpegts', seconds);
        const script = join(root, 'enc.mjs');
        await copyFile(join(process.cwd(), 'config', 'enc.js.template'), script);
        const ffmpegPath = (await runProcess('sh', ['-c', `command -v ${FFMPEG}`])).stdout.trim();
        // makeActualEncoder は ffmpeg を root の下に置く設定にする。そこへ本物の ffmpeg を置く。
        await symlink(ffmpegPath, join(root, 'ffmpeg'));
        return { root, script };
    };

    const wireQueue = (root: string, script: string, providerCount: { value: number }) => {
        const logger = {
            encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { error: vi.fn() },
        };
        const processManager = new EncodeProcessManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ encodeProcessNum: 2 }) },
        );
        const event = new EncodeEvent({ getLogger: () => logger });
        const encoders: Array<ReturnType<typeof makeActualEncoder>> = [];
        const provider = vi.fn(async () => {
            providerCount.value += 1;
            const actual = makeActualEncoder(root, processManager, {
                cmd: `%NODE% ${script}`,
                deferOption: true,
                encodeEvent: event,
                suffix: '.mp4',
            });
            encoders.push(actual);
            return actual.model;
        });
        let nextVideoFileId = 91_000;
        const addVideoFile = vi.fn(async () => ++nextVideoFileId);
        const emitFinishEncode = vi.fn(async () => undefined);
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 4 }) },
            { getExecution: vi.fn(async () => 'synthetic-execution'), unLockExecution: vi.fn() },
            provider,
            event,
            { acquire: vi.fn(async () => ({ token: {} })), release: vi.fn(async () => undefined) },
        );
        const finish = new EncodeFinishModel(
            { getLogger: () => logger },
            { notifyClient: vi.fn(), notifyUpdateEncodeProgress: vi.fn() },
            {
                encodeEvent: { emitFinishEncode },
                recorded: { addVideoFile, deleteVideoFile: vi.fn(), updateVideoFileSize: vi.fn(async () => undefined) },
            },
            event,
            manage,
        );
        finish.set();
        const dispose = () => {
            (manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();
            (event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
        };
        return { addVideoFile, dispose, emitFinishEncode, encoders, event, logger, manage, processManager };
    };

    const probeStreams = async (path: string): Promise<string[]> => {
        const { stdout } = await runProcess(FFPROBE, [
            '-v',
            'error',
            '-show_entries',
            'stream=codec_name',
            '-of',
            'json',
            path,
        ]);
        return (JSON.parse(stdout) as { streams: Array<{ codec_name: string }> }).streams
            .map(stream => stream.codec_name)
            .sort();
    };

    it('[EN-INTEGRATION-REAL-FFMPEG] runs two queued encodes one after another with the bundled command and registers real MP4 outputs', async () => {
        const { root, script } = await prepareRealEncodeRoot(2);
        const providerCount = { value: 0 };
        const wired = wireQueue(root, script, providerCount);
        try {
            const first = await wired.manage.push({
                ...request(32_101),
                sourceVideoFileId: 42_101,
            } as apid.AddEncodeProgramOption);
            const second = await wired.manage.push({
                ...request(32_102),
                sourceVideoFileId: 42_102,
            } as apid.AddEncodeProgramOption);
            expect(wired.manage.getEncodeInfo()).toEqual({
                runningQueue: [expect.objectContaining({ id: first, recordedId: 32_101 })],
                waitQueue: [expect.objectContaining({ id: second, recordedId: 32_102 })],
            });

            await vi.waitFor(() => expect(wired.addVideoFile).toHaveBeenCalledTimes(2), {
                timeout: 60_000,
                interval: 200,
            });
            await vi.waitFor(() => expect(wired.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }));

            expect(wired.addVideoFile.mock.calls.map(([option]) => option)).toEqual([
                expect.objectContaining({
                    recordedId: 32_101,
                    filePath: 'synthetic-subdirectory/input.mp4',
                    type: 'encoded',
                }),
                expect.objectContaining({
                    recordedId: 32_102,
                    filePath: 'synthetic-subdirectory/input(1).mp4',
                    type: 'encoded',
                }),
            ]);
            expect(wired.emitFinishEncode).toHaveBeenCalledTimes(2);
            await expect(probeStreams(join(root, 'synthetic-subdirectory', 'input.mp4'))).resolves.toEqual([
                'aac',
                'h264',
            ]);
            await expect(probeStreams(join(root, 'synthetic-subdirectory', 'input(1).mp4'))).resolves.toEqual([
                'aac',
                'h264',
            ]);
            expect(wired.processManager.childs).toEqual([]);
            expect(providerCount.value).toBe(2);
        } finally {
            wired.dispose();
        }
    }, 180_000);

    it('[EN-INTEGRATION-REAL-FFMPEG] cancels a running real ffmpeg encode, removes its partial output, and empties the queue', async () => {
        const { root, script } = await prepareRealEncodeRoot(120);
        const providerCount = { value: 0 };
        const wired = wireQueue(root, script, providerCount);
        try {
            const encodeId = await wired.manage.push({
                ...request(32_201),
                sourceVideoFileId: 42_201,
            } as apid.AddEncodeProgramOption);
            await vi.waitFor(() => expect(wired.encoders[0]?.model.childProcess ?? null).not.toBeNull(), {
                timeout: 30_000,
            });
            const child = wired.encoders[0].model.childProcess as ChildProcess;
            isolatedChildren.add(child);
            // ffmpeg が出力を書き始めるまで待ってから取り消す。
            await vi.waitFor(
                async () =>
                    expect((await stat(join(root, 'synthetic-subdirectory', 'input.mp4'))).size).toBeGreaterThan(0),
                { timeout: 30_000, interval: 100 },
            );

            await wired.manage.cancel(encodeId);
            await vi.waitFor(() => expect(wired.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }), {
                timeout: 30_000,
            });
            await vi.waitFor(() => expect(child.exitCode !== null || child.signalCode !== null).toBe(true), {
                timeout: 30_000,
            });
            isolatedChildren.delete(child);

            expect(wired.addVideoFile).not.toHaveBeenCalled();
            expect(wired.emitFinishEncode).not.toHaveBeenCalled();
            await vi.waitFor(async () =>
                expect(stat(join(root, 'synthetic-subdirectory', 'input.mp4'))).rejects.toMatchObject({
                    code: 'ENOENT',
                }),
            );
            expect(wired.processManager.childs).toEqual([]);
        } finally {
            wired.dispose();
        }
    }, 180_000);
});
