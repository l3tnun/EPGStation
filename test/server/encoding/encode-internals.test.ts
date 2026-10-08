import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as apid from '../../../api';
import type IEncodeEvent from '../../../src/model/event/IEncodeEvent';
import type { FinishEncodeInfo } from '../../../src/model/event/IEncodeEvent';
import type { EncodeOption, EncodeProgressInfo } from '../../../src/model/service/encode/IEncoderModel';
import { createDeferred, type Deferred } from '../harness/async';

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
    started: boolean;
}

interface EncodeManageRuntime {
    admissionReservations: number;
    cancel(encodeId: apid.EncodeId): Promise<void>;
    idCnt: number;
    runningQueue: SyntheticEncoder[];
    waitQueue: SyntheticEncoder[];
    getEncodeInfo(): Record<string, unknown>;
    getQueuedAndRunningRecordedIds():
        | { status: 'known'; recordedIds: ReadonlySet<apid.RecordedId> }
        | { status: 'unknown' };
    push(option: apid.AddEncodeProgramOption): Promise<number>;
}

interface EncodeManageConstructor {
    new (...dependencies: unknown[]): EncodeManageRuntime;
}

interface EncoderRuntime {
    getEncodeOption(): EncodeOption | null;
    setOnFinish(callback: (isError: boolean, outputFilePath: string | null) => void): void;
    setOption(option: EncodeOption): void;
    start(): Promise<void>;
    timerId: NodeJS.Timeout | null;
}

interface EncoderConstructor {
    new (...dependencies: unknown[]): EncoderRuntime;
}

interface FileManagerRuntime {
    usedFileNameIndex: Record<string, boolean>;
    getFilePath(outputDirPath: string, inputFilePath: string, suffix: string): Promise<string>;
    release(filePath: string): void;
}

interface FileManagerConstructor {
    new (): FileManagerRuntime;
}

interface EncodeEventConstructor {
    new (...dependencies: unknown[]): IEncodeEvent;
}

interface EncodeFinishConstructor {
    new (...dependencies: unknown[]): { finishEncode(info: FinishEncodeInfo): Promise<void>; set(): void };
}

interface EncodeProcessManageRuntime {
    spawnProcess(
        option: {
            cmd: string;
            input: string | null;
            output: string | null;
            priority: number;
            spawnOption?: Record<string, unknown>;
        },
        kind: 'process',
    ): SyntheticChild;
}

interface EncodeProcessManageConstructor {
    new (...dependencies: unknown[]): EncodeProcessManageRuntime;
}

interface SyntheticChild extends EventEmitter {
    exitCode: number | null;
    pid: number;
    signalCode: NodeJS.Signals | null;
    stderr: null;
    stdin: null;
    stdout: null;
}

interface QueueCheckHandle {
    executionId: string;
    lease: Deferred<string>;
    settled: Deferred<void>;
}

interface RecordedResourceUsePort {
    acquire(recordedId: apid.RecordedId, kind: 'encoding'): Promise<{ token: object }>;
    release(token: object): Promise<void>;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const EncodeManageModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeManageModel.js')) as {
        default: EncodeManageConstructor;
    }
).default;
const EncoderModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncoderModel.js')) as {
        default: EncoderConstructor;
    }
).default;
const EncodeFileManageModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeFileManageModel.js')) as {
        default: FileManagerConstructor;
    }
).default;
const ProcessUtil = (
    require(join(compiledSnapshot, 'util', 'ProcessUtil.js')) as {
        default: { ROOT_PATH: string; kill(child: SyntheticChild, wait?: number): Promise<void> };
    }
).default;
const FileUtil = (
    require(join(compiledSnapshot, 'util', 'FileUtil.js')) as {
        default: { unlink(filePath: string): Promise<void> };
    }
).default;
const Util = (
    require(join(compiledSnapshot, 'util', 'Util.js')) as {
        default: { sleep(milliseconds: number): Promise<void> };
    }
).default;
const EncodeEvent = (
    require(join(compiledSnapshot, 'model', 'event', 'EncodeEvent.js')) as { default: EncodeEventConstructor }
).default;
const EncodeFinishModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeFinishModel.js')) as {
        default: EncodeFinishConstructor;
    }
).default;
const EncodeProcessManageModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeProcessManageModel.js')) as {
        default: EncodeProcessManageConstructor;
    }
).default;

/**
 * The compiled `EncodeProcessManageModel.js` is ES modules (`import { spawn } from 'child_process'`), so
 * mutating `require('child_process').spawn` after the module has already been imported once (as it is
 * above, for the module's other tests) does not reach it: the module's own binding to `spawn` is
 * resolved once when it is first evaluated. This loader instead registers `vi.doMock` for the exact
 * specifiers the compiled module imports, drops the module registry with `vi.resetModules()`, and
 * re-imports the module fresh via a dynamic `import()`, so the caller gets an instance wired to its own
 * spawn stub.
 */
const loadEncodeProcessManageModel = async (
    spawnImplementation: (...arguments_: unknown[]) => unknown,
): Promise<EncodeProcessManageConstructor> => {
    const modulePath = join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeProcessManageModel.js');
    const actualChildProcess = await vi.importActual<Record<string, unknown>>('node:child_process');
    vi.doMock('node:child_process', () => ({ ...actualChildProcess, spawn: spawnImplementation }));
    vi.doMock('child_process', () => ({ ...actualChildProcess, spawn: spawnImplementation }));
    try {
        vi.resetModules();
        const imported = (await import(pathToFileURL(modulePath).href)) as {
            default: EncodeProcessManageConstructor;
        };
        return imported.default;
    } finally {
        vi.doUnmock('node:child_process');
        vi.doUnmock('child_process');
    }
};

const temporaryRoots = new Set<string>();
const unhandledRejectionObservers = new Set<(reason: unknown) => void>();

afterEach(async () => {
    for (const observer of unhandledRejectionObservers) process.off('unhandledRejection', observer);
    unhandledRejectionObservers.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    await Promise.all([...temporaryRoots].map(root => rm(root, { force: true, recursive: true })));
    temporaryRoots.clear();
});

describe('Tasks 4.1, 4.3, and 5.1 internal characterization', () => {
    it('[EN-IMP-R4-PROGRESS-PARSER] changes state and emits only for complete progress fields', async () => {
        const fixture = makeTerminalFixture();

        fixture.updateProgress(
            [
                JSON.stringify({ type: 'status', percent: 10, log: 'wrong type' }),
                JSON.stringify({ type: 'progress', percent: 20 }),
                JSON.stringify({ type: 'progress', log: 'missing percent' }),
            ].join('\n'),
        );
        expect(fixture.progress()).toBeNull();
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).not.toHaveBeenCalled();

        for (const completeNonObject of ['null', '42', '"complete scalar"']) {
            fixture.updateProgress(completeNonObject);
            expect(fixture.progressBuffer()).toBe('');
        }

        fixture.updateProgress(JSON.stringify({ type: 'progress', percent: 0, log: '' }));
        expect(fixture.progress()).toEqual({ percent: 0, log: '' });
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).toHaveBeenCalledOnce();

        fixture.updateProgress('invalid progress\n');
        expect(fixture.progress()).toEqual({ percent: 0, log: '' });
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).toHaveBeenCalledOnce();

        fixture.updateProgress('not-json');
        expect(fixture.progressBuffer()).toBe('not-json');
        const decoderBeforeNewlineResync = fixture.progressDecoder();
        fixture.updateProgress(`${JSON.stringify({ type: 'progress', percent: 25, log: 'newline resync' })}\n`);
        expect(fixture.progress()).toEqual({ percent: 25, log: 'newline resync' });
        expect(fixture.progressBuffer()).toBe('');
        expect(fixture.progressDecoder()).not.toBe(decoderBeforeNewlineResync);
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).toHaveBeenCalledTimes(2);

        fixture.updateProgress('not-json');
        const decoderBeforeChunkResync = fixture.progressDecoder();
        fixture.updateProgress(JSON.stringify({ type: 'progress', percent: 50, log: 'chunk resync' }));
        expect(fixture.progress()).toEqual({ percent: 50, log: 'chunk resync' });
        expect(fixture.progressBuffer()).toBe('');
        expect(fixture.progressDecoder()).not.toBe(decoderBeforeChunkResync);

        fixture.updateProgress(
            [
                JSON.stringify({ type: 'progress', percent: 75, log: 'complete line' }),
                JSON.stringify({ type: 'progress', percent: 80, log: 'complete remainder' }),
            ].join('\n'),
        );
        expect(fixture.progress()).toEqual({ percent: 80, log: 'complete remainder' });
        expect(fixture.progressBuffer()).toBe('');

        fixture.updateProgress(
            `${JSON.stringify({ type: 'progress', percent: 90, log: 'before incomplete remainder' })}\n{"type":`,
        );
        expect(fixture.progress()).toEqual({ percent: 90, log: 'before incomplete remainder' });
        expect(fixture.progressBuffer()).toBe('{"type":');
        fixture.updateProgress(Buffer.from('進', 'utf8').subarray(0, 1));
        expect(fixture.decoderEnd).not.toHaveBeenCalled();
        await fixture.end(0, false, null);
        expect(fixture.decoderEnd).toHaveBeenCalledOnce();
        expect(fixture.progressBuffer()).toBe('');
    });

    it('[EN-IMP-R4-PROGRESS-BOUND] drops oversized unterminated input and accepts the next complete record', async () => {
        vi.useFakeTimers();
        const fixture = makeTerminalFixture();
        const prefix = '{"type":"progress","log":"';
        const exactLimit = `${prefix}${'x'.repeat(64 * 1024 - Buffer.byteLength(prefix))}`;

        fixture.updateProgress(exactLimit);
        expect(Buffer.byteLength(fixture.progressBuffer(), 'utf8')).toBe(64 * 1024);
        fixture.updateProgress('x');
        expect(fixture.progressBuffer()).toBe('');

        fixture.updateProgress(JSON.stringify({ type: 'progress', percent: 73, log: 'after oversized input' }));
        expect(fixture.progress()).toEqual({ percent: 73, log: 'after oversized input' });
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).toHaveBeenCalledOnce();
        await fixture.end(0, false, null);
        expectTerminalCleanup(fixture, { isError: false, output: null });
    });

    it('[EN-IMP-R4-PROGRESS-BOUND-PENDING-UTF8] resets a pending byte after dropping oversized input', async () => {
        vi.useFakeTimers();
        const fixture = makeTerminalFixture();
        const oversized = Buffer.concat([Buffer.alloc(64 * 1024 + 1, 0x78), Buffer.from([0xe9])]);
        const decoderBeforeDrop = fixture.progressDecoder();

        fixture.updateProgress(oversized);
        expect(Buffer.byteLength(fixture.progressBuffer(), 'utf8')).toBe(0);
        expect(fixture.progressDecoder()).not.toBe(decoderBeforeDrop);

        fixture.updateProgress(
            Buffer.from(JSON.stringify({ type: 'progress', percent: 74, log: 'after pending oversized input' })),
        );
        expect(fixture.progress()).toEqual({ percent: 74, log: 'after pending oversized input' });
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).toHaveBeenCalledOnce();
        await fixture.end(0, false, null);
        expectTerminalCleanup(fixture, { isError: false, output: null });
    });

    it('[EN-IMP-R7-1-5] finalizes each terminal branch without adopting restart orphans', async () => {
        vi.useFakeTimers();
        vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);
        const unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);

        const normal = makeTerminalFixture();
        await normal.end(0, false, 'normal-output.mp4');
        expect(normal.release).toHaveBeenCalledOnce();
        expect(unlink).not.toHaveBeenCalled();
        expectTerminalCleanup(normal, { isError: false, output: 'normal-output.mp4' });

        const abnormal = makeTerminalFixture();
        await abnormal.end(1, false, 'abnormal-output.mp4');
        expect(abnormal.release).toHaveBeenCalledWith('abnormal-output.mp4');
        expect(unlink).toHaveBeenLastCalledWith('abnormal-output.mp4');
        expectTerminalCleanup(abnormal, { isError: true, output: 'abnormal-output.mp4' });

        const cancelled = makeTerminalFixture();
        await cancelled.end(0, true, 'cancelled-output.mp4');
        expect(cancelled.release).toHaveBeenCalledWith('cancelled-output.mp4');
        expect(unlink).toHaveBeenLastCalledWith('cancelled-output.mp4');
        expectTerminalCleanup(cancelled, { isError: true, output: 'cancelled-output.mp4' });

        const noOutput = makeTerminalFixture();
        await noOutput.end(1, false, null);
        expect(noOutput.release).not.toHaveBeenCalled();
        expectTerminalCleanup(noOutput, { isError: true, output: null });

        const unlinkError = new Error('synthetic unlink failure');
        unlink.mockRejectedValueOnce(unlinkError);
        const cleanupFailure = makeTerminalFixture();
        await cleanupFailure.end(1, false, 'failed-cleanup.mp4');
        expect(cleanupFailure.log.encode.error).toHaveBeenCalledWith(
            'delete encode output file failed: failed-cleanup.mp4',
        );
        expect(cleanupFailure.log.encode.error).toHaveBeenCalledWith(unlinkError);
        expectTerminalCleanup(cleanupFailure, { isError: true, output: 'failed-cleanup.mp4' });

        const callsBeforeRestart = unlink.mock.calls.length;
        const restarted = makeTerminalFixture();
        expect(unlink).toHaveBeenCalledTimes(callsBeforeRestart);
        await restarted.end(0, false, null);
        expectTerminalCleanup(restarted, { isError: false, output: null });
    });

    it('[EN-IMP-R3-5-R5-2] runs abnormal terminal cleanup and finish once under duplicate settlement', async () => {
        vi.useFakeTimers();
        vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);
        const unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);
        const fixture = makeTerminalFixture();

        await Promise.all([
            fixture.end(1, false, 'duplicate-output.mp4'),
            fixture.end(1, false, 'duplicate-output.mp4'),
        ]);

        expect(fixture.release).toHaveBeenCalledOnce();
        expect(unlink).toHaveBeenCalledOnce();
        expect(unlink).toHaveBeenCalledWith('duplicate-output.mp4');
        expectTerminalCleanup(fixture, { isError: true, output: 'duplicate-output.mp4' });
    });

    it('[EN-IMP-R5-2] shares and propagates one managed stop rejection without direct process access', async () => {
        vi.useFakeTimers();
        const fixture = makeTerminalFixture();
        const stopError = new Error('synthetic managed stop rejection');
        const handle = {};
        fixture.model.managedProcessHandle = handle;
        (fixture.model as unknown as { childProcess: { pid: number; removeListener: () => void } | null }).childProcess =
            { pid: 91_805, removeListener: vi.fn() };
        fixture.processManager.requestStop.mockRejectedValueOnce(stopError);

        const first = fixture.model.cancel();
        const duplicate = fixture.model.cancel();

        await expect(first).rejects.toBe(stopError);
        await expect(duplicate).rejects.toBe(stopError);
        expect(fixture.processManager.requestStop).toHaveBeenCalledOnce();
        expect(fixture.processManager.requestStop).toHaveBeenCalledWith(handle);
        expect(fixture.log.encode.info).toHaveBeenCalledWith('kill encode process encodeId: 805, pid: 91805');
        expect(fixture.log.encode.error).toHaveBeenCalledWith('stop encode process failed: 805');
        expect(fixture.log.encode.error).toHaveBeenCalledWith(stopError);

        await fixture.end(1, true, null);
        expectTerminalCleanup(fixture, { isError: true, output: null });
    });

    it('[EN-IMP-R6-4-5] does not enter source deletion when result registration rejects', async () => {
        const logger = { encode: { error: vi.fn() }, system: { error: vi.fn() } };
        const event = new EncodeEvent({ getLogger: () => logger });
        const socket = { notifyClient: vi.fn(), notifyUpdateEncodeProgress: vi.fn() };
        const emitFinishEncode = vi.fn();
        const reflectionError = new Error('synthetic result reflection failure');
        const addVideoFile = vi.fn(async () => {
            throw reflectionError;
        });
        const deleteVideoFile = vi.fn();
        const finish = new EncodeFinishModel(
            { getLogger: () => logger },
            socket,
            {
                encodeEvent: { emitFinishEncode },
                recorded: { addVideoFile, deleteVideoFile, updateVideoFileSize: vi.fn(async () => undefined) },
            },
            event,
        );
        finish.set();

        await finish.finishEncode(finishInfo({ removeOriginal: true }));

        expect(addVideoFile).toHaveBeenCalledOnce();
        expect(deleteVideoFile).not.toHaveBeenCalled();
        expect(logger.encode.error).toHaveBeenCalledWith(reflectionError);
        expect(socket.notifyClient).toHaveBeenCalledOnce();
        expect(emitFinishEncode).toHaveBeenCalledWith({ recordedId: 801, videoFileId: null, mode: 'synthetic-mode' });
        (event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
    });

    it('[EN-IMP-R6-8] stops UI and completion effects after source deletion rejects', async () => {
        const systemError = vi.fn();
        const logger = { encode: { error: vi.fn() }, system: { error: systemError } };
        const event = new EncodeEvent({ getLogger: () => logger });
        const socket = { notifyClient: vi.fn(), notifyUpdateEncodeProgress: vi.fn() };
        const emitFinishEncode = vi.fn();
        const addVideoFile = vi.fn(async () => 807);
        const deleteError = new Error('synthetic source deletion failure');
        const deleteVideoFile = vi.fn(async () => {
            throw deleteError;
        });
        const finish = new EncodeFinishModel(
            { getLogger: () => logger },
            socket,
            {
                encodeEvent: { emitFinishEncode },
                recorded: { addVideoFile, deleteVideoFile, updateVideoFileSize: vi.fn(async () => undefined) },
            },
            event,
        );
        finish.set();

        await expect(finish.finishEncode(finishInfo({ removeOriginal: true }))).rejects.toBe(deleteError);

        expect(addVideoFile).toHaveBeenCalledOnce();
        expect(deleteVideoFile).toHaveBeenCalledOnce();
        expect(systemError).not.toHaveBeenCalled();
        expect(socket.notifyClient).not.toHaveBeenCalled();
        expect(emitFinishEncode).not.toHaveBeenCalled();
        (event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
    });

    it.each([
        {
            expectedVideoFileId: 807,
            info: finishInfo(),
            name: 'an output file',
            reflect: 'add',
        },
        {
            expectedVideoFileId: null,
            info: finishInfo({ filePath: null, fullOutputPath: null }),
            name: 'no output file',
            reflect: 'update',
        },
    ] as const)(
        '[EN-IMP-RESULT-REFLECTION] reflects $name through the required IPC operation before completing',
        async ({ expectedVideoFileId, info, name, reflect }) => {
            const logger = { encode: { error: vi.fn() }, system: { error: vi.fn() } };
            const event = new EncodeEvent({ getLogger: () => logger });
            const socket = { notifyClient: vi.fn(), notifyUpdateEncodeProgress: vi.fn() };
            const emitFinishEncode = vi.fn();
            const addVideoFile = vi.fn(async () => 807);
            const updateVideoFileSize = vi.fn(async () => undefined);
            const deleteVideoFile = vi.fn();
            const finish = new EncodeFinishModel(
                { getLogger: () => logger },
                socket,
                {
                    encodeEvent: { emitFinishEncode },
                    recorded: { addVideoFile, deleteVideoFile, updateVideoFileSize },
                },
                event,
            );
            finish.set();

            await finish.finishEncode(info);

            expect(addVideoFile).toHaveBeenCalledTimes(reflect === 'add' ? 1 : 0);
            expect(updateVideoFileSize).toHaveBeenCalledTimes(reflect === 'update' ? 1 : 0);
            if (reflect === 'add') {
                expect(addVideoFile).toHaveBeenCalledExactlyOnceWith({
                    filePath: 'synthetic-output.mp4',
                    name: 'synthetic-mode',
                    parentDirectoryName: 'synthetic-parent',
                    recordedId: 801,
                    type: 'encoded',
                });
            } else {
                expect(updateVideoFileSize).toHaveBeenCalledExactlyOnceWith(803);
            }
            expect(deleteVideoFile).not.toHaveBeenCalled();
            expect(socket.notifyClient).toHaveBeenCalledOnce();
            expect(emitFinishEncode).toHaveBeenCalledExactlyOnceWith({
                recordedId: 801,
                videoFileId: expectedVideoFileId,
                mode: 'synthetic-mode',
            });
            (event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
        },
    );

    it('[EN-IMP-SOURCE-DELETION] deletes the source only after output reflection commits', async () => {
        const logger = { encode: { error: vi.fn() }, system: { error: vi.fn() } };
        const event = new EncodeEvent({ getLogger: () => logger });
        const socket = { notifyClient: vi.fn(), notifyUpdateEncodeProgress: vi.fn() };
        const emitFinishEncode = vi.fn();
        const reflection = createDeferred<apid.VideoFileId>();
        const addVideoFile = vi.fn(() => reflection.promise);
        const deleteVideoFile = vi.fn(async () => undefined);
        const finish = new EncodeFinishModel(
            { getLogger: () => logger },
            socket,
            {
                encodeEvent: { emitFinishEncode },
                recorded: { addVideoFile, deleteVideoFile, updateVideoFileSize: vi.fn(async () => undefined) },
            },
            event,
        );
        finish.set();

        const settling = finish.finishEncode(finishInfo({ removeOriginal: true }));
        await vi.waitFor(() => expect(addVideoFile).toHaveBeenCalledOnce());

        expect(deleteVideoFile).not.toHaveBeenCalled();
        expect(socket.notifyClient).not.toHaveBeenCalled();
        expect(emitFinishEncode).not.toHaveBeenCalled();

        reflection.resolve(807);
        await settling;

        expect(addVideoFile).toHaveBeenCalledOnce();
        expect(deleteVideoFile).toHaveBeenCalledExactlyOnceWith(803, true);
        expect(addVideoFile.mock.invocationCallOrder[0]).toBeLessThan(deleteVideoFile.mock.invocationCallOrder[0]);
        expect(socket.notifyClient).toHaveBeenCalledOnce();
        expect(emitFinishEncode).toHaveBeenCalledExactlyOnceWith({
            recordedId: 801,
            videoFileId: 807,
            mode: 'synthetic-mode',
        });
        (event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
    });
});

const finishInfo = (overrides: Partial<FinishEncodeInfo> = {}): FinishEncodeInfo => ({
    filePath: 'synthetic-output.mp4',
    fullOutputPath: 'synthetic-output.mp4',
    mode: 'synthetic-mode',
    parentDirName: 'synthetic-parent',
    recordedId: 801,
    removeOriginal: false,
    videoFileId: 803,
    ...overrides,
});

const makeTerminalFixture = () => {
    const log = { encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
    const release = vi.fn();
    const encodeEvent = {
        emitAddEncode: vi.fn(),
        emitCancelEncode: vi.fn(),
        emitErrorEncode: vi.fn(),
        emitFinishEncode: vi.fn(),
        emitUpdateEncodeProgress: vi.fn(),
    };
    const processManager = { create: vi.fn(), createManaged: vi.fn(), requestStop: vi.fn() };
    const model = new EncoderModel(
        { getLogger: () => log },
        { getConfig: () => ({ encode: [] }) },
        processManager,
        { getFilePath: vi.fn(), release },
        { findId: vi.fn() },
        { findId: vi.fn() },
        { findId: vi.fn() },
        { getFullFilePathFromId: vi.fn(), getInfo: vi.fn(), getParentDirPath: vi.fn() },
        encodeEvent,
        { formatFilePathString: vi.fn() },
    ) as EncoderRuntime & {
        childEndProcessing(code: number | null, signal: NodeJS.Signals | null, output: string | null): Promise<void>;
        getProgressInfo(): EncodeProgressInfo | null;
        isCanceld: boolean;
        listener: EventEmitter;
        managedProcessHandle: unknown;
        updateEncodingProgressInfo(data: unknown): void;
    };
    model.setOption({
        encodeId: 805,
        mode: 'synthetic-mode',
        parentDir: 'synthetic-parent',
        recordedId: 801,
        removeOriginal: false,
        sourceVideoFileId: 803,
    });
    const finishes: Array<{ isError: boolean; output: string | null }> = [];
    const decoderEnd = vi.fn();
    let trackedDecoder: { end(): string } | null = null;
    const trackCurrentDecoderEnd = (): void => {
        const decoder = (model as unknown as { progressDecoder: { end(): string } }).progressDecoder;
        if (decoder === trackedDecoder) {
            return;
        }
        trackedDecoder = decoder;
        const end = decoder.end.bind(decoder);
        vi.spyOn(decoder, 'end').mockImplementation(() => {
            decoderEnd();
            return end();
        });
    };
    trackCurrentDecoderEnd();
    model.setOnFinish((isError, output) => finishes.push({ isError, output }));
    model.timerId = setTimeout(() => undefined, 60_000);
    return {
        end: async (code: number, cancelled: boolean, output: string | null): Promise<void> => {
            trackCurrentDecoderEnd();
            model.isCanceld = cancelled;
            await model.childEndProcessing(code, null, output);
        },
        decoderEnd,
        encodeEvent,
        finishes,
        listenerCount: (): number => model.listener.listenerCount('encodeFinishEvent'),
        log,
        model,
        processManager,
        progress: (): EncodeProgressInfo | null => model.getProgressInfo(),
        progressBuffer: (): string => (model as unknown as { progressLineBuffer: string }).progressLineBuffer,
        progressDecoder: (): unknown => (model as unknown as { progressDecoder: { end(): string } }).progressDecoder,
        release,
        updateProgress: (data: unknown): void => model.updateEncodingProgressInfo(data),
    };
};

const expectTerminalCleanup = (
    fixture: ReturnType<typeof makeTerminalFixture>,
    finish: { isError: boolean; output: string | null },
): void => {
    expect(fixture.finishes).toEqual([finish]);
    expect(fixture.listenerCount()).toBe(0);
    expect(fixture.decoderEnd).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
};

const option = (recordedId = 51): apid.AddEncodeProgramOption => ({
    directory: 'synthetic-subdirectory',
    mode: 'synthetic-mode',
    parentDir: 'synthetic-parent',
    recordedId,
    removeOriginal: false,
    sourceVideoFileId: recordedId + 1,
});

const encoder = (encodeOption: EncodeOption | null, progress: EncodeProgressInfo | null): SyntheticEncoder => {
    const item: SyntheticEncoder = {
        cancel: vi.fn(async () => undefined),
        finish: () => {
            const callback = item.finishCallback;
            if (callback === null) return;
            item.finishCallback = null;
            callback(true, null);
        },
        finishCallback: null,
        getEncodeId: vi.fn(() => encodeOption?.encodeId ?? null),
        getEncodeOption: vi.fn(() => encodeOption),
        getProgressInfo: vi.fn(() => progress),
        setOnFinish: vi.fn(callback => {
            item.finishCallback = callback;
        }),
        setOption: vi.fn(value => {
            encodeOption = value;
        }),
        start: vi.fn(async () => {
            item.started = true;
        }),
        started: false,
    };
    return item;
};

const flushEventLoop = async (): Promise<void> => {
    await new Promise<void>(resolve => setImmediate(resolve));
};

const makeManage = () => {
    const checkHandles: QueueCheckHandle[] = [];
    const activeExecutions = new Set<string>();
    let executionCall = 0;
    const execution = {
        getExecution: vi.fn(() => {
            executionCall += 1;
            const executionId = `synthetic-execution-${executionCall}`;
            if (executionCall % 2 === 1) {
                activeExecutions.add(executionId);
                return Promise.resolve(executionId);
            }
            const handle = { executionId, lease: createDeferred<string>(), settled: createDeferred<void>() };
            checkHandles.push(handle);
            return handle.lease.promise.then(() => {
                activeExecutions.add(executionId);
                return executionId;
            });
        }),
        unLockExecution: vi.fn((executionId: string) => {
            activeExecutions.delete(executionId);
            checkHandles.find(handle => handle.executionId === executionId)?.settled.resolve(undefined);
        }),
    };
    const created: SyntheticEncoder[] = [];
    const manage = new EncodeManageModel(
        { getLogger: () => ({ encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }) },
        { getConfig: () => ({ concurrentEncodeNum: 1 }) },
        execution,
        vi.fn(async () => {
            const item = encoder(null, null);
            created.push(item);
            return item;
        }),
        {
            emitAddEncode: vi.fn(),
            emitCancelEncode: vi.fn(),
            emitErrorEncode: vi.fn(),
            emitFinishEncode: vi.fn(),
            emitUpdateEncodeProgress: vi.fn(),
        },
    );
    const manageEmitter = (manage as unknown as { listener: EventEmitter }).listener;

    const settleCurrentChecks = async (): Promise<void> => {
        const pending = checkHandles.filter(handle => handle.lease.state().status === 'pending');
        for (const handle of pending) handle.lease.resolve(handle.executionId);
        await Promise.all(pending.map(handle => handle.settled.promise));
    };
    const resources = () => ({
        activeExecutions: activeExecutions.size,
        finishCallbacks: created.filter(item => item.finishCallback !== null).length,
        pendingChecks: checkHandles.filter(handle => handle.lease.state().status === 'pending').length,
        unsettledChecks: checkHandles.filter(handle => handle.settled.state().status === 'pending').length,
    });
    const cleanup = async (): Promise<void> => {
        for (let attempt = 0; attempt < created.length + 4; attempt += 1) {
            await settleCurrentChecks();
            for (const item of created) {
                if (item.started) item.finish();
            }
            await flushEventLoop();
            const queue = manage.getEncodeInfo() as { runningQueue: unknown[]; waitQueue: unknown[] };
            if (
                queue.runningQueue.length === 0 &&
                queue.waitQueue.length === 0 &&
                Object.values(resources()).every(count => count === 0)
            ) {
                manageEmitter.removeAllListeners();
                return;
            }
        }
        throw new Error(`Encoding fixture cleanup did not settle: ${JSON.stringify(resources())}`);
    };
    const disposeProjection = (): void => {
        manage.runningQueue = [];
        manage.waitQueue = [];
        manageEmitter.removeAllListeners();
    };

    const listenerCount = (): number =>
        manageEmitter.eventNames().reduce((total, name) => total + manageEmitter.listenerCount(name), 0);

    return { cleanup, disposeProjection, listenerCount, manage, resources };
};

const expectCleanFixture = (fixture: ReturnType<typeof makeManage>): void => {
    expect(fixture.resources()).toEqual({
        activeExecutions: 0,
        finishCallbacks: 0,
        pendingChecks: 0,
        unsettledChecks: 0,
    });
    expect(fixture.listenerCount()).toBe(0);
};

describe('encoding memory and identifier characterization', () => {
    it.each(['execution', 'provider', 'setOption', 'queueAppend', 'log', 'event'] as const)(
        '[EN-IMP-ADMISSION-CLEANUP] releases the exact reservation and acquired lock after %s failure',
        async failure => {
            const activeExecutions = new Set<string>();
            const execution = {
                getExecution: vi.fn(async () => {
                    if (failure === 'execution') throw new Error('synthetic execution failure');
                    activeExecutions.add('synthetic-admission');
                    return 'synthetic-admission';
                }),
                unLockExecution: vi.fn((executionId: string) => {
                    activeExecutions.delete(executionId);
                }),
            };
            const item = encoder(null, null);
            if (failure === 'setOption')
                item.setOption = vi.fn(() => {
                    throw new Error('synthetic setOption failure');
                });
            const provider = vi.fn(async () => {
                if (failure === 'provider') throw new Error('synthetic provider failure');
                return item;
            });
            const event = {
                emitAddEncode: vi.fn(() => {
                    if (failure === 'event') throw new Error('synthetic event failure');
                }),
                emitCancelEncode: vi.fn(),
                emitErrorEncode: vi.fn(),
                emitFinishEncode: vi.fn(),
                emitUpdateEncodeProgress: vi.fn(),
            };
            const log = {
                encode: {
                    error: vi.fn(),
                    info: vi.fn(() => {
                        if (failure === 'log') throw new Error('synthetic log failure');
                    }),
                    warn: vi.fn(),
                },
            };
            const manage = new EncodeManageModel(
                { getLogger: () => log },
                { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: failure === 'queueAppend' ? 2 : 1 }) },
                execution,
                provider,
                event,
            );
            const emitter = (manage as unknown as { listener: EventEmitter }).listener;
            const processListenerCount = process.listenerCount('unhandledRejection');
            const existing = encoder({ ...option(61), encodeId: 99 }, null);
            if (failure === 'queueAppend') {
                manage.waitQueue.push(existing);
                manage.waitQueue.push = vi.fn(value => {
                    Array.prototype.push.call(manage.waitQueue, value);
                    throw new Error('synthetic queue append failure');
                });
            }

            await expect(manage.push(option())).rejects.toBeInstanceOf(Error);
            await flushEventLoop();

            expect(manage.runningQueue).toEqual([]);
            expect(manage.waitQueue).toEqual(failure === 'queueAppend' ? [existing] : []);
            expect(provider).toHaveBeenCalledTimes(failure === 'execution' ? 0 : 1);
            expect(execution.unLockExecution).toHaveBeenCalledTimes(failure === 'execution' ? 0 : 1);
            expect(execution.getExecution).toHaveBeenCalledTimes(1);
            expect(activeExecutions.size).toBe(0);
            expect(manage.admissionReservations).toBe(0);
            expect(manage.idCnt).toBe(1);
            expect(event.emitAddEncode).toHaveBeenCalledTimes(failure === 'event' ? 1 : 0);
            expect(item.finishCallback).toBeNull();
            expect(item.started).toBe(false);
            expect(process.listenerCount('unhandledRejection')).toBe(processListenerCount);
            expect(emitter.eventNames()).toEqual(['needsCheckQueue']);
            emitter.removeAllListeners();
            expect(emitter.eventNames()).toEqual([]);
        },
    );

    it('[EN-IMP-QUEUE-LIMIT] rejects the next admission while the first reservation is still awaiting its execution lock', async () => {
        const firstExecution = createDeferred<string>();
        const execution = {
            getExecution: vi
                .fn()
                .mockImplementationOnce(() => firstExecution.promise)
                .mockResolvedValue('unexpected-queue-check'),
            unLockExecution: vi.fn(),
        };
        const created = encoder(null, null);
        const provider = vi.fn(async () => created);
        const event = {
            emitAddEncode: vi.fn(),
            emitCancelEncode: vi.fn(),
            emitErrorEncode: vi.fn(),
            emitFinishEncode: vi.fn(),
            emitUpdateEncodeProgress: vi.fn(),
        };
        const manage = new EncodeManageModel(
            { getLogger: () => ({ encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }) },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 1 }) },
            execution,
            provider,
            event,
        );
        const emitter = (manage as unknown as { listener: EventEmitter }).listener;
        emitter.removeAllListeners('needsCheckQueue');

        const accepted = manage.push(option(91));
        await expect(manage.push(option(92))).rejects.toThrow('EncodeQueueIsFull');

        expect(execution.getExecution).toHaveBeenCalledOnce();
        expect(provider).not.toHaveBeenCalled();
        expect(manage.admissionReservations).toBe(1);
        expect(manage.waitQueue).toEqual([]);
        expect(event.emitAddEncode).not.toHaveBeenCalled();

        firstExecution.resolve('synthetic-admission');
        await expect(accepted).resolves.toBe(1);
        expect(manage.admissionReservations).toBe(0);
        expect(manage.getEncodeInfo()).toEqual({
            runningQueue: [],
            waitQueue: [{ id: 1, mode: 'synthetic-mode', recordedId: 91 }],
        });
        expect(event.emitAddEncode).toHaveBeenCalledExactlyOnceWith(1);
        emitter.removeAllListeners();
    });

    it('[EN-IMP-QUEUE-LIMIT-VALIDATION] snapshots only omitted limits to 1024 and rejects invalid explicit values', () => {
        const instances: Array<{ listener: EventEmitter }> = [];
        const create = (config: Record<string, unknown>): { encodeQueueLimit: number; listener: EventEmitter } => {
            const manage = new EncodeManageModel(
                { getLogger: () => ({ encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }) },
                { getConfig: () => config },
                { getExecution: vi.fn(), unLockExecution: vi.fn() },
                vi.fn(),
                {
                    emitAddEncode: vi.fn(),
                    emitCancelEncode: vi.fn(),
                    emitErrorEncode: vi.fn(),
                    emitFinishEncode: vi.fn(),
                    emitUpdateEncodeProgress: vi.fn(),
                },
            ) as unknown as { encodeQueueLimit: number; listener: EventEmitter };
            instances.push(manage);
            return manage;
        };

        try {
            expect(create({ concurrentEncodeNum: 1 }).encodeQueueLimit).toBe(1024);
            expect(create({}).encodeQueueLimit).toBe(1024);
            expect(create({ concurrentEncodeNum: 1, encodeQueueLimit: 1 }).encodeQueueLimit).toBe(1);
            expect(create({ concurrentEncodeNum: 1, encodeQueueLimit: Number.MAX_SAFE_INTEGER }).encodeQueueLimit).toBe(
                Number.MAX_SAFE_INTEGER,
            );

            for (const value of [null, '', '1', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
                expect(() => create({ concurrentEncodeNum: 1, encodeQueueLimit: value })).toThrow(
                    'InvalidEncodeQueueLimit',
                );
            }
        } finally {
            for (const instance of instances) instance.listener.removeAllListeners();
        }
    });

    it('[EN-IMP-START-FAILURE] finalizes a failed queued start once and leaves no runnable job behind', async () => {
        const startError = new Error('synthetic process start failure');
        const item = encoder(null, null);
        item.start = vi.fn(async () => {
            throw startError;
        });
        const event = {
            emitAddEncode: vi.fn(),
            emitCancelEncode: vi.fn(),
            emitErrorEncode: vi.fn(),
            emitFinishEncode: vi.fn(),
            emitUpdateEncodeProgress: vi.fn(),
        };
        const log = { encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
        const execution = {
            getExecution: vi.fn(async () => 'synthetic-execution'),
            unLockExecution: vi.fn(),
        };
        const manage = new EncodeManageModel(
            { getLogger: () => log },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 1 }) },
            execution,
            vi.fn(async () => item),
            event,
        );
        const emitter = (manage as unknown as { listener: EventEmitter }).listener;

        await expect(manage.push(option(93))).resolves.toBe(1);
        await vi.waitFor(() => expect(item.start).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] }));

        expect(item.setOnFinish).toHaveBeenCalledOnce();
        expect(event.emitErrorEncode).toHaveBeenCalledOnce();
        expect(log.encode.error).toHaveBeenCalledWith('create encode process error: 1');
        expect(log.encode.error).toHaveBeenCalledWith(startError);
        expect(execution.unLockExecution).toHaveBeenCalledTimes(3);
        emitter.removeAllListeners();
    });

    it('[EN-IMP-CONCURRENT-ID-ROLLBACK] does not rewind a committed identifier when a deferred peer fails', async () => {
        const executionA = createDeferred<string>();
        const executionB = createDeferred<string>();
        const executionC = createDeferred<string>();
        const executionLeases = [executionA, executionB, executionC];
        const activeExecutions = new Set<string>();
        const execution = {
            getExecution: vi.fn(() => {
                const lease = executionLeases.shift();
                if (lease === undefined) throw new Error('unexpected execution request');
                return lease.promise.then(executionId => {
                    activeExecutions.add(executionId);
                    return executionId;
                });
            }),
            unLockExecution: vi.fn((executionId: string) => {
                activeExecutions.delete(executionId);
            }),
        };
        const first = encoder(null, null);
        const second = encoder(null, null);
        second.setOption = vi.fn(() => {
            throw new Error('synthetic second setOption failure');
        });
        const third = encoder(null, null);
        const provider = vi
            .fn()
            .mockResolvedValueOnce(first)
            .mockResolvedValueOnce(second)
            .mockResolvedValueOnce(third);
        const event = {
            emitAddEncode: vi.fn(),
            emitCancelEncode: vi.fn(),
            emitErrorEncode: vi.fn(),
            emitFinishEncode: vi.fn(),
            emitUpdateEncodeProgress: vi.fn(),
        };
        const log = { encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
        const manage = new EncodeManageModel(
            { getLogger: () => log },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 3 }) },
            execution,
            provider,
            event,
        );
        const emitter = (manage as unknown as { listener: EventEmitter }).listener;
        emitter.removeAllListeners('needsCheckQueue');

        const acceptedA = manage.push(option(101));
        const rejectedB = manage.push(option(102));
        executionA.resolve('synthetic-a');
        await expect(acceptedA).resolves.toBe(1);
        executionB.resolve('synthetic-b');
        await expect(rejectedB).rejects.toThrow('synthetic second setOption failure');

        const acceptedC = manage.push(option(103));
        executionC.resolve('synthetic-c');
        await expect(acceptedC).resolves.toBe(2);

        expect(manage.getEncodeInfo()).toEqual({
            runningQueue: [],
            waitQueue: [
                { id: 1, mode: 'synthetic-mode', recordedId: 101 },
                { id: 2, mode: 'synthetic-mode', recordedId: 103 },
            ],
        });
        expect(new Set(manage.waitQueue.map(item => item.getEncodeId())).size).toBe(2);
        expect(manage.idCnt).toBe(3);
        expect(manage.admissionReservations).toBe(0);
        expect(activeExecutions.size).toBe(0);
        expect(execution.unLockExecution).toHaveBeenCalledTimes(3);
        expect(log.encode.info.mock.calls).toEqual([['add new encode: 1'], ['add new encode: 2']]);
        emitter.removeAllListeners();
    });

    it('[EN-IMP-R7-RESTART] starts every new instance with empty queues and identifier one', async () => {
        const previous = makeManage();
        await expect(previous.manage.push(option(51))).resolves.toBe(1);

        const restarted = makeManage();
        expect(restarted.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
        await expect(restarted.manage.push(option(61))).resolves.toBe(1);

        expect(previous.manage.getEncodeInfo()).toEqual({
            runningQueue: [],
            waitQueue: [{ id: 1, mode: 'synthetic-mode', recordedId: 51 }],
        });
        expect(restarted.manage.getEncodeInfo()).toEqual({
            runningQueue: [],
            waitQueue: [{ id: 1, mode: 'synthetic-mode', recordedId: 61 }],
        });
        await previous.cleanup();
        await restarted.cleanup();
        expectCleanFixture(previous);
        expectCleanFixture(restarted);
    });

    it('[EN-IMP-R7-ID-WRAP] assigns MAX_SAFE_INTEGER and then wraps the next identifier to one', async () => {
        const fixture = makeManage();
        fixture.manage.idCnt = Number.MAX_SAFE_INTEGER;

        await expect(fixture.manage.push(option(71))).resolves.toBe(Number.MAX_SAFE_INTEGER);
        await expect(fixture.manage.push(option(72))).resolves.toBe(1);

        expect(fixture.manage.getEncodeInfo()).toEqual({
            runningQueue: [],
            waitQueue: [
                { id: Number.MAX_SAFE_INTEGER, mode: 'synthetic-mode', recordedId: 71 },
                { id: 1, mode: 'synthetic-mode', recordedId: 72 },
            ],
        });
        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-IMP-R4-QUEUE-PROJECTION] separates running and waiting jobs and only projects acquired progress pairs', () => {
        const fixture = makeManage();
        fixture.manage.runningQueue = [
            encoder({ ...option(81), encodeId: 8 }, { log: 'synthetic progress', percent: 63 }),
            encoder({ ...option(82), encodeId: 9 }, null),
        ];
        fixture.manage.waitQueue = [encoder({ ...option(83), encodeId: 10 }, { log: 'ignored wait', percent: 99 })];

        expect(fixture.manage.getEncodeInfo()).toEqual({
            runningQueue: [
                { id: 8, log: 'synthetic progress', mode: 'synthetic-mode', percent: 63, recordedId: 81 },
                { id: 9, mode: 'synthetic-mode', recordedId: 82 },
            ],
            waitQueue: [{ id: 10, mode: 'synthetic-mode', recordedId: 83 }],
        });
        fixture.disposeProjection();
        expectCleanFixture(fixture);
    });

    it('[EN-IMP-RECORDED-USE-SNAPSHOT-INACTIVE] fails closed instead of returning a partial snapshot when reading a queued job throws', () => {
        const fixture = makeManage();
        const running = encoder({ ...option(84), encodeId: 11 }, null);
        const unreadable = encoder({ ...option(85), encodeId: 12 }, null);
        unreadable.getEncodeOption = vi.fn(() => {
            throw new Error('SyntheticRecordedUseSnapshotFailure');
        });
        fixture.manage.runningQueue = [running];
        fixture.manage.waitQueue = [unreadable];
        const runningBefore = fixture.manage.runningQueue;
        const waitingBefore = fixture.manage.waitQueue;

        expect(fixture.manage.getQueuedAndRunningRecordedIds()).toEqual({ status: 'unknown' });
        expect(fixture.manage.runningQueue).toBe(runningBefore);
        expect(fixture.manage.waitQueue).toBe(waitingBefore);
        expect(running.getEncodeOption).toHaveBeenCalledOnce();
        expect(unreadable.getEncodeOption).toHaveBeenCalledOnce();

        fixture.disposeProjection();
        expectCleanFixture(fixture);
    });

    it('[EN-IMP-QUEUE-REENTRY] dequeues each waiting job once and releases every execution lease once when add and finish checks overlap', async () => {
        interface HeldCheck {
            executionId: string;
            lease: Deferred<string>;
            settled: Deferred<void>;
        }
        const heldChecks: HeldCheck[] = [];
        const grantedExecutions: string[] = [];
        const activeExecutions = new Set<string>();
        let executionCall = 0;
        let reservations = (): number => 0;
        const execution = {
            // 追加の受付（予約を保持している）と最終処理（priority 3）はすぐ許可し、予約が無いときの priority 2 の
            // 要求は queue の確認なので、test が許可するまで保留する。
            getExecution: vi.fn((priority: number) => {
                executionCall += 1;
                const executionId = `synthetic-execution-${executionCall}`;
                const grant = (): string => {
                    grantedExecutions.push(executionId);
                    activeExecutions.add(executionId);
                    return executionId;
                };
                if (priority !== 2 || reservations() > 0) return Promise.resolve(grant());
                const held = { executionId, lease: createDeferred<string>(), settled: createDeferred<void>() };
                heldChecks.push(held);
                return held.lease.promise.then(grant);
            }),
            unLockExecution: vi.fn((executionId: string) => {
                activeExecutions.delete(executionId);
                heldChecks.find(held => held.executionId === executionId)?.settled.resolve(undefined);
            }),
        };
        const created: SyntheticEncoder[] = [];
        const manage = new EncodeManageModel(
            { getLogger: () => ({ encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }) },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 4 }) },
            execution,
            vi.fn(async () => {
                const item = encoder(null, null);
                created.push(item);
                return item;
            }),
            {
                emitAddEncode: vi.fn(),
                emitCancelEncode: vi.fn(),
                emitErrorEncode: vi.fn(),
                emitFinishEncode: vi.fn(),
                emitUpdateEncodeProgress: vi.fn(),
            },
        );
        reservations = () => manage.admissionReservations;
        const emitter = (manage as unknown as { listener: EventEmitter }).listener;
        const pendingChecks = (): HeldCheck[] => heldChecks.filter(held => held.lease.state().status === 'pending');
        const settlePendingChecks = async (): Promise<void> => {
            const pending = pendingChecks();
            for (const held of pending) held.lease.resolve(held.executionId);
            await Promise.all(pending.map(held => held.settled.promise));
        };
        const entry = (id: number, recordedId: number) => ({ id, mode: 'synthetic-mode', recordedId });
        const startCounts = (): number[] => created.map(item => item.start.mock.calls.length);

        try {
            // 1 件目は確認が 1 本だけで開始する。
            await manage.push(option(901));
            expect(pendingChecks()).toHaveLength(1);
            await settlePendingChecks();
            expect(manage.getEncodeInfo()).toEqual({ runningQueue: [entry(1, 901)], waitQueue: [] });
            expect(startCounts()).toEqual([1]);

            // 追加の確認（902）が保留の間に実行中の job が終わり、終了の確認も保留になる。空き枠 1 に待機 1 件。
            await manage.push(option(902));
            created[0].finish();
            await flushEventLoop();
            expect(pendingChecks()).toHaveLength(2);
            expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [entry(2, 902)] });
            await settlePendingChecks();
            expect(manage.getEncodeInfo()).toEqual({ runningQueue: [entry(2, 902)], waitQueue: [] });
            expect(startCounts()).toEqual([1, 1]);

            // 追加の確認 2 本と終了の確認 1 本が重なっても、空いた枠 1 つに待機の先頭 1 件だけが入る。
            await manage.push(option(903));
            await manage.push(option(904));
            created[1].finish();
            await flushEventLoop();
            expect(pendingChecks()).toHaveLength(3);
            expect(manage.getEncodeInfo()).toEqual({
                runningQueue: [],
                waitQueue: [entry(3, 903), entry(4, 904)],
            });
            await settlePendingChecks();
            expect(manage.getEncodeInfo()).toEqual({ runningQueue: [entry(3, 903)], waitQueue: [entry(4, 904)] });
            expect(startCounts()).toEqual([1, 1, 1, 0]);

            // 残りの待機は、次の終了の確認で 1 回だけ開始する。
            created[2].finish();
            await flushEventLoop();
            expect(pendingChecks()).toHaveLength(1);
            await settlePendingChecks();
            expect(manage.getEncodeInfo()).toEqual({ runningQueue: [entry(4, 904)], waitQueue: [] });
            expect(startCounts()).toEqual([1, 1, 1, 1]);

            created[3].finish();
            await flushEventLoop();
            expect(pendingChecks()).toHaveLength(1);
            await settlePendingChecks();
            expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            expect(startCounts()).toEqual([1, 1, 1, 1]);
            expect(pendingChecks()).toEqual([]);

            // 許可した実行権は全て 1 回ずつ解放され、残りが無い。
            expect(execution.getExecution).toHaveBeenCalledTimes(grantedExecutions.length);
            expect(execution.unLockExecution.mock.calls.map(([executionId]) => executionId).sort()).toEqual(
                [...grantedExecutions].sort(),
            );
            expect(activeExecutions.size).toBe(0);
        } finally {
            emitter.removeAllListeners();
        }
    });
});

describe('recorded-use pre-settlement internals', () => {
    it('[EN-IMP-RECORDED-USE-PRE-SETTLEMENT] releases null-option and failed-start leases before advancing the next queued job', async () => {
        const nullOptionToken = {};
        const failedStartToken = {};
        const runningToken = {};
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi
                .fn()
                .mockImplementationOnce(async () => ({ token: nullOptionToken }))
                .mockImplementationOnce(async () => ({ token: failedStartToken }))
                .mockImplementationOnce(async () => ({ token: runningToken }))
                .mockImplementation(async () => {
                    throw new Error('UnexpectedRecordedUseAcquire');
                }),
            release: vi.fn(async () => undefined),
        };
        const nullOption = encoder(null, null);
        nullOption.getEncodeOption = vi.fn(() => null);
        const failedStart = encoder(null, null);
        const startFailure = new Error('SyntheticStartFailure');
        failedStart.start = vi.fn(async () => {
            throw startFailure;
        });
        const running = encoder(null, null);
        const queued = [nullOption, failedStart, running];
        const execution = {
            getExecution: vi.fn(async () => 'synthetic-execution'),
            unLockExecution: vi.fn(),
        };
        const logger = { encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
        const event = {
            emitAddEncode: vi.fn(),
            emitCancelEncode: vi.fn(),
            emitErrorEncode: vi.fn(),
            emitFinishEncode: vi.fn(),
            emitUpdateEncodeProgress: vi.fn(),
        };
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 3 }) },
            execution,
            vi.fn(async () => {
                const next = queued.shift();
                if (next === undefined) throw new Error('UnexpectedEncoderProvider');
                return next;
            }),
            event,
            recordedResourceUse,
        ) as EncodeManageRuntime & { checkQueue(): Promise<void>; listener: EventEmitter };
        manage.listener.removeAllListeners();

        await manage.push(option(921));
        await manage.push(option(922));
        await manage.push(option(923));
        manage.listener.on('needsCheckQueue', () => {
            void manage.checkQueue();
        });

        await manage.checkQueue();
        await vi.waitFor(() => expect(running.started).toBe(true));

        expect(recordedResourceUse.acquire).toHaveBeenNthCalledWith(1, 921, 'encoding');
        expect(recordedResourceUse.acquire).toHaveBeenNthCalledWith(2, 922, 'encoding');
        expect(recordedResourceUse.acquire).toHaveBeenNthCalledWith(3, 923, 'encoding');
        expect(recordedResourceUse.release).toHaveBeenCalledTimes(2);
        expect(recordedResourceUse.release).toHaveBeenNthCalledWith(1, nullOptionToken);
        expect(recordedResourceUse.release).toHaveBeenNthCalledWith(2, failedStartToken);
        expect(logger.encode.warn).toHaveBeenCalledExactlyOnceWith('encodeOption is null');
        expect(logger.encode.error).toHaveBeenNthCalledWith(1, 'create encode process error: 2');
        expect(logger.encode.error).toHaveBeenNthCalledWith(2, startFailure);
        expect(manage.getEncodeInfo()).toEqual({
            runningQueue: [{ id: 3, mode: 'synthetic-mode', recordedId: 923 }],
            waitQueue: [],
        });

        running.finish();
        await flushEventLoop();
        manage.listener.removeAllListeners();
    });

    it('[EN-IMP-RECORDED-USE-WAIT-CANCEL] removes a waiting job through public cancellation and releases its exact lease once', async () => {
        const token = {};
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi.fn(async () => ({ token })),
            release: vi.fn(async () => undefined),
        };
        const execution = {
            getExecution: vi.fn(async () => 'synthetic-execution'),
            unLockExecution: vi.fn(),
        };
        const event = {
            emitAddEncode: vi.fn(),
            emitCancelEncode: vi.fn(),
            emitErrorEncode: vi.fn(),
            emitFinishEncode: vi.fn(),
            emitUpdateEncodeProgress: vi.fn(),
        };
        const manage = new EncodeManageModel(
            { getLogger: () => ({ encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }) },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 1 }) },
            execution,
            vi.fn(async () => encoder(null, null)),
            event,
            recordedResourceUse,
        ) as EncodeManageRuntime & { listener: EventEmitter };
        manage.listener.removeAllListeners();

        const id = await manage.push(option(924));
        await manage.cancel(id);

        expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
        expect(recordedResourceUse.acquire).toHaveBeenCalledExactlyOnceWith(924, 'encoding');
        expect(recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(token);
        expect(event.emitCancelEncode).toHaveBeenCalledExactlyOnceWith(id);
        expect(execution.unLockExecution).toHaveBeenCalledTimes(2);
        manage.listener.removeAllListeners();
    });

    it('[EN-IMP-RECORDED-USE-RELEASE-LEDGER] saves one release promise before invoking the exact token callback', async () => {
        const token = {};
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi.fn(async () => ({ token: {} })),
            release: vi.fn(async () => undefined),
        };
        const logger = { encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 1 }) },
            { getExecution: vi.fn(async () => 'synthetic-execution'), unLockExecution: vi.fn() },
            vi.fn(async () => encoder(null, null)),
            {
                emitAddEncode: vi.fn(),
                emitCancelEncode: vi.fn(),
                emitErrorEncode: vi.fn(),
                emitFinishEncode: vi.fn(),
                emitUpdateEncodeProgress: vi.fn(),
            },
            recordedResourceUse,
        ) as unknown as {
            listener: EventEmitter;
            recordedUseLeases: WeakMap<SyntheticEncoder, { port: RecordedResourceUsePort; token: object }>;
            releaseRecordedUseForEncoder(encoder: SyntheticEncoder): Promise<void>;
        };
        const item = encoder(null, null);
        manage.listener.removeAllListeners();
        manage.recordedUseLeases.set(item, { port: recordedResourceUse, token });

        await Promise.all([manage.releaseRecordedUseForEncoder(item), manage.releaseRecordedUseForEncoder(item)]);

        expect(recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(token);
    });
});

describe('recorded-use result-settlement internals', () => {
    it('[EN-IMP-RECORDED-USE-SETTLEMENT] releases an exact terminal lease once after a rejected direct settlement', async () => {
        const token = {};
        const settlementError = new Error('SyntheticResultSettlementFailure');
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi.fn(async () => ({ token })),
            release: vi.fn(async () => undefined),
        };
        const directFinish = { finishEncode: vi.fn(() => Promise.reject(settlementError)) };
        const logger = {
            encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { error: vi.fn() },
        };
        const event = {
            emitAddEncode: vi.fn(),
            emitCancelEncode: vi.fn(),
            emitErrorEncode: vi.fn(),
            emitFinishEncode: vi.fn(),
            emitUpdateEncodeProgress: vi.fn(),
        };
        const created: SyntheticEncoder[] = [];
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 1 }) },
            { getExecution: vi.fn(async () => 'synthetic-execution'), unLockExecution: vi.fn() },
            vi.fn(async () => {
                const item = encoder(null, null);
                created.push(item);
                return item;
            }),
            event,
            recordedResourceUse,
            directFinish,
        ) as EncodeManageRuntime & { listener: EventEmitter };

        try {
            await manage.push(option(925));
            await vi.waitFor(() => expect(created[0]?.finishCallback).not.toBeNull());

            const terminal = created[0]?.finishCallback;
            if (terminal === null || terminal === undefined) throw new Error('MissingSyntheticFinishCallback');
            terminal(false, 'settlement-failure.mp4');
            terminal(false, 'late-duplicate.mp4');

            await vi.waitFor(() => expect(directFinish.finishEncode).toHaveBeenCalledOnce());
            await vi.waitFor(() => expect(recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(token));
            expect(logger.system.error).toHaveBeenCalledWith(settlementError);
        } finally {
            manage.listener.removeAllListeners();
        }
    });

    it('[EN-IMP-RECORDED-USE-SETTLEMENT-LOG-FAILURE] absorbs a logger failure while reporting a rejected settlement', async () => {
        const token = {};
        const settlementError = new Error('SyntheticResultSettlementFailure');
        const loggingFailure = new Error('SyntheticSettlementLogFailure');
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi.fn(async () => ({ token })),
            release: vi.fn(async () => undefined),
        };
        const directFinish = { finishEncode: vi.fn(() => Promise.reject(settlementError)) };
        const logger = {
            encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: {
                error: vi.fn(() => {
                    throw loggingFailure;
                }),
            },
        };
        const event = {
            emitAddEncode: vi.fn(),
            emitCancelEncode: vi.fn(),
            emitErrorEncode: vi.fn(),
            emitFinishEncode: vi.fn(),
            emitUpdateEncodeProgress: vi.fn(),
        };
        const created: SyntheticEncoder[] = [];
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 1 }) },
            { getExecution: vi.fn(async () => 'synthetic-execution'), unLockExecution: vi.fn() },
            vi.fn(async () => {
                const item = encoder(null, null);
                created.push(item);
                return item;
            }),
            event,
            recordedResourceUse,
            directFinish,
        ) as EncodeManageRuntime & { listener: EventEmitter };

        try {
            await manage.push(option(926));
            await vi.waitFor(() => expect(created[0]?.finishCallback).not.toBeNull());

            const terminal = created[0]?.finishCallback;
            if (terminal === null || terminal === undefined) throw new Error('MissingSyntheticFinishCallback');
            terminal(false, 'settlement-log-failure.mp4');

            // logResultSettlementFailure (EncodeManageModel.ts:381-385) wraps its own logging call in
            // try/catch specifically so a broken logger cannot prevent the terminal lease from being
            // released -- this is what proves that swallow works, not just that the settlement error
            // itself is reported.
            await vi.waitFor(() => expect(recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(token));
            expect(logger.system.error).toHaveBeenCalledWith(settlementError);
        } finally {
            manage.listener.removeAllListeners();
        }
    });

    it('[EN-IMP-FINISH-TERMINAL-REJECTION] reports a rejected finish() through the terminal promise catch', async () => {
        // finish() (EncodeManageModel.ts:312-340) swallows a rejected settlement internally, so the
        // only way its returned `terminalPromise` itself rejects is a failure that survives its own
        // try/finally -- finalize()'s own executor-slot acquisition (CLEAR_QUEUE_PRIPORITY, 3) is such
        // a failure. That rejection is what onFinish's `terminalPromise.catch(err => ...)`
        // (EncodeManageModel.ts:309) exists to report.
        const finalizeFailure = new Error('SyntheticFinalizeExecutionFailure');
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi.fn(async () => ({ token: {} })),
            release: vi.fn(async () => undefined),
        };
        const directFinish = { finishEncode: vi.fn(() => Promise.resolve()) };
        const logger = {
            encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { error: vi.fn() },
        };
        const event = {
            emitAddEncode: vi.fn(),
            emitCancelEncode: vi.fn(),
            emitErrorEncode: vi.fn(),
            emitFinishEncode: vi.fn(),
            emitUpdateEncodeProgress: vi.fn(),
        };
        const created: SyntheticEncoder[] = [];
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 1 }) },
            {
                getExecution: vi.fn(async (priority: number) => {
                    // 3 === EncodeManageModel.CLEAR_QUEUE_PRIPORITY, the priority finalize() alone uses.
                    if (priority === 3) throw finalizeFailure;
                    return 'synthetic-execution';
                }),
                unLockExecution: vi.fn(),
            },
            vi.fn(async () => {
                const item = encoder(null, null);
                created.push(item);
                return item;
            }),
            event,
            recordedResourceUse,
            directFinish,
        ) as EncodeManageRuntime & { listener: EventEmitter };

        try {
            await manage.push(option(927));
            await vi.waitFor(() => expect(created[0]?.finishCallback).not.toBeNull());

            const terminal = created[0]?.finishCallback;
            if (terminal === null || terminal === undefined) throw new Error('MissingSyntheticFinishCallback');
            terminal(false, 'terminal-rejection.mp4');

            await vi.waitFor(() => expect(logger.system.error).toHaveBeenCalledWith(finalizeFailure));
        } finally {
            manage.listener.removeAllListeners();
        }
    });
});

describe('output reservation internals', () => {
    it('[EN-IMP-FILE-RESERVATION] skips an existing name and a simultaneous reservation, then releases the exact path', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-reservation-'));
        temporaryRoots.add(root);
        const inputPath = join(root, 'recording.ts');
        const existingPath = join(root, 'recording.mp4');
        await Promise.all([writeFile(inputPath, 'input'), writeFile(existingPath, 'existing')]);
        const manager = new EncodeFileManageModel();

        const first = await manager.getFilePath(root, inputPath, '.mp4');
        const second = await manager.getFilePath(root, inputPath, '.mp4');

        expect(first).toBe(join(root, 'recording(1).mp4'));
        expect(second).toBe(join(root, 'recording(2).mp4'));
        expect(new Set([first, second]).size).toBe(2);
        expect(Object.keys(manager.usedFileNameIndex).sort()).toEqual([first, second].sort());

        manager.release(first);
        expect(Object.keys(manager.usedFileNameIndex)).toEqual([second]);
        await expect(manager.getFilePath(root, inputPath, '.mp4')).resolves.toBe(first);
        manager.release(first);
        manager.release(second);
        expect(manager.usedFileNameIndex).toEqual({});
    });
});

describe('command replacement internals', () => {
    it.each([
        ['with an output path', 'synthetic-output.ts', 'synthetic-output.ts'],
        ['without an output path', null, '%OUTPUT%'],
    ] as const)(
        '[EN-IMP-COMMAND-REPLACEMENT] replaces input and %s only when it is available',
        async (_case, output, expectedOutput) => {
            const child = new EventEmitter() as SyntheticChild;
            child.exitCode = null;
            child.pid = 73_102;
            child.signalCode = null;
            child.stderr = null;
            child.stdin = null;
            child.stdout = null;
            const spawn = vi.fn(() => child);
            const SyntheticEncodeProcessManageModel = await loadEncodeProcessManageModel(spawn);
            const manager = new SyntheticEncodeProcessManageModel(
                { getLogger: () => ({ encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }) },
                { getConfig: () => ({ encodeProcessNum: 1 }) },
            );
            const actual = manager.spawnProcess(
                {
                    cmd: '%NODE% %ROOT% %SPACE% %INPUT% %INPUT% %OUTPUT% %OUTPUT% %UNTOUCHED%',
                    input: 'synthetic-input.ts',
                    output,
                    priority: 1,
                },
                'process',
            );

            expect(actual).toBe(child);
            expect(spawn).toHaveBeenCalledExactlyOnceWith(process.argv[0], [
                ProcessUtil.ROOT_PATH,
                ' ',
                'synthetic-input.ts',
                'synthetic-input.ts',
                expectedOutput,
                expectedOutput,
                '%UNTOUCHED%',
            ]);
        },
    );
});

describe('environment and timeout internals', () => {
    it('[EN-IMP-ENVIRONMENT] overlays all encoding variables while retaining unrelated parent variables', async () => {
        const marker = 'EPGSTATION_ENCODE_INTERNAL_PARENT_MARKER';
        const staleValues = new Map([marker, 'RECORDEDID', 'CHANNELNAME', 'DIR'].map(key => [key, process.env[key]]));
        process.env[marker] = 'inherited-by-child';
        process.env.RECORDEDID = 'stale-recorded-id';
        process.env.CHANNELNAME = 'stale-channel-name';
        process.env.DIR = 'stale-directory';
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-environment-'));
        temporaryRoots.add(root);
        const inputPath = join(root, 'recording.ts');
        await writeFile(inputPath, 'input');
        const child = new EventEmitter() as SyntheticChild;
        child.exitCode = null;
        child.pid = 73_103;
        child.signalCode = null;
        child.stderr = null;
        child.stdin = null;
        child.stdout = null;
        const createManaged = vi.fn(async () => ({ child, handle: {} }));
        const finish = vi.fn();
        const model = new EncoderModel(
            { getLogger: () => ({ encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }) },
            {
                getConfig: () => ({
                    encode: [{ cmd: '%NODE%', name: 'synthetic-mode' }],
                    ffmpeg: join(root, 'ffmpeg'),
                    ffprobe: join(root, 'ffprobe'),
                }),
            },
            { create: vi.fn(), createManaged, requestStop: vi.fn() },
            { getFilePath: vi.fn(), release: vi.fn() },
            { findId: vi.fn(async () => ({ id: 902 })) },
            {
                findId: vi.fn(async () => ({
                    audioComponentType: null,
                    audioSamplingRate: null,
                    channelId: 903,
                    description: null,
                    dropLogFile: { dropCnt: 0, errorCnt: 0, filePath: 'drop.json', id: 904, scramblingCnt: 0 },
                    duration: 9,
                    endAt: 19,
                    extended: null,
                    genre1: null,
                    genre2: 5,
                    genre3: null,
                    halfWidthDescription: null,
                    halfWidthExtended: null,
                    halfWidthName: 'half name',
                    id: 901,
                    name: 'Synthetic recording',
                    startAt: 10,
                    subGenre1: null,
                    subGenre2: 6,
                    subGenre3: null,
                    videoComponentType: null,
                    videoResolution: null,
                    videoStreamContent: null,
                    videoType: null,
                })),
            },
            { findId: vi.fn(async () => ({ halfWidthName: 'half channel', id: 903, name: 'Channel' })) },
            {
                getFullFilePathFromId: vi.fn(async () => inputPath),
                getInfo: vi.fn(async () => null),
                getParentDirPath: vi.fn(() => root),
            },
            {
                emitAddEncode: vi.fn(),
                emitCancelEncode: vi.fn(),
                emitErrorEncode: vi.fn(),
                emitFinishEncode: vi.fn(),
                emitUpdateEncodeProgress: vi.fn(),
            },
            { formatFilePathString: vi.fn(async (directory: string) => directory) },
        );
        model.setOnFinish(finish);
        model.setOption({
            directory: 'nested',
            encodeId: 906,
            mode: 'synthetic-mode',
            parentDir: 'synthetic-parent',
            recordedId: 901,
            removeOriginal: false,
            sourceVideoFileId: 902,
        });

        try {
            await model.start();

            const request = createManaged.mock.calls[0][0] as {
                output: string | null;
                spawnOption: { env: Record<string, string | undefined> };
            };
            expect(request.output).toBeNull();
            expect(request.spawnOption.env).toMatchObject({
                AUDIOCOMPONENTTYPE: '',
                AUDIOSAMPLINGRATE: '',
                CHANNELID: '903',
                CHANNELNAME: 'Channel',
                DESCRIPTION: '',
                DIR: 'nested',
                DROPLOG_ID: '904',
                DROPLOG_PATH: 'drop.json',
                DROP_CNT: '0',
                END_AT: '19',
                ERROR_CNT: '0',
                EXTENDED: '',
                FFMPEG: join(root, 'ffmpeg'),
                FFPROBE: join(root, 'ffprobe'),
                GENRE1: '',
                GENRE2: '5',
                GENRE3: '',
                HALF_WIDTH_CHANNELNAME: 'half channel',
                HALF_WIDTH_DESCRIPTION: '',
                HALF_WIDTH_EXTENDED: '',
                HALF_WIDTH_NAME: 'half name',
                INPUT: inputPath,
                NAME: 'Synthetic recording',
                OUTPUT: '',
                RECORDEDID: '901',
                SCRAMBLING_CNT: '0',
                START_AT: '10',
                SUBDIR: 'nested',
                SUBGENRE1: '',
                SUBGENRE2: '6',
                SUBGENRE3: '',
                VIDEOCOMPONENTTYPE: '',
                VIDEORESOLUTION: '',
                VIDEOSTREAMCONTENT: '',
                VIDEOTYPE: '',
                [marker]: 'inherited-by-child',
            });
            expect(request.spawnOption.env.RECORDEDID).toBe('901');
            expect(request.spawnOption.env.CHANNELNAME).toBe('Channel');
            expect(request.spawnOption.env.DIR).toBe('nested');
            expect(request.spawnOption.env[marker]).toBe('inherited-by-child');

            child.exitCode = 0;
            child.emit('exit', 0, null);
            await vi.waitFor(() => expect(finish).toHaveBeenCalledExactlyOnceWith(false, null));
        } finally {
            for (const [key, value] of staleValues) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    });

    it('[EN-IMP-ENVIRONMENT-CHANNEL-FALLBACK] falls back CHANNELID/CHANNELNAME/HALF_WIDTH_CHANNELNAME to empty strings', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-environment-channel-fallback-'));
        temporaryRoots.add(root);
        const inputPath = join(root, 'recording.ts');
        await writeFile(inputPath, 'input');
        const child = new EventEmitter() as SyntheticChild;
        child.exitCode = null;
        child.pid = 73_104;
        child.signalCode = null;
        child.stderr = null;
        child.stdin = null;
        child.stdout = null;
        const createManaged = vi.fn(async () => ({ child, handle: {} }));
        const model = new EncoderModel(
            { getLogger: () => ({ encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }) },
            {
                getConfig: () => ({
                    encode: [{ cmd: '%NODE%', name: 'synthetic-mode' }],
                    ffmpeg: join(root, 'ffmpeg'),
                    ffprobe: join(root, 'ffprobe'),
                }),
            },
            { create: vi.fn(), createManaged, requestStop: vi.fn() },
            { getFilePath: vi.fn(), release: vi.fn() },
            { findId: vi.fn(async () => ({ id: 902 })) },
            {
                findId: vi.fn(async () => ({
                    audioComponentType: null,
                    audioSamplingRate: null,
                    // channelId が number ではない場合、CHANNELID は '' にフォールバックする。
                    channelId: null,
                    description: null,
                    duration: 9,
                    endAt: 19,
                    extended: null,
                    genre1: null,
                    genre2: null,
                    genre3: null,
                    halfWidthDescription: null,
                    halfWidthExtended: null,
                    halfWidthName: 'half name',
                    id: 901,
                    name: 'Synthetic recording',
                    startAt: 10,
                    subGenre1: null,
                    subGenre2: null,
                    subGenre3: null,
                    videoComponentType: null,
                    videoResolution: null,
                    videoStreamContent: null,
                    videoType: null,
                })),
            },
            // channel.name / channel.halfWidthName が string ではない場合、それぞれ CHANNELNAME /
            // HALF_WIDTH_CHANNELNAME は '' にフォールバックする。
            { findId: vi.fn(async () => ({ id: 903 })) },
            {
                getFullFilePathFromId: vi.fn(async () => inputPath),
                getInfo: vi.fn(async () => null),
                getParentDirPath: vi.fn(() => root),
            },
            {
                emitAddEncode: vi.fn(),
                emitCancelEncode: vi.fn(),
                emitErrorEncode: vi.fn(),
                emitFinishEncode: vi.fn(),
                emitUpdateEncodeProgress: vi.fn(),
            },
            { formatFilePathString: vi.fn(async (directory: string) => directory) },
        );
        model.setOnFinish(() => {});
        model.setOption({
            directory: 'nested',
            encodeId: 907,
            mode: 'synthetic-mode',
            parentDir: 'synthetic-parent',
            recordedId: 901,
            removeOriginal: false,
            sourceVideoFileId: 902,
        });

        await model.start();

        const request = createManaged.mock.calls[0][0] as {
            spawnOption: { env: Record<string, string | undefined> };
        };
        expect(request.spawnOption.env).toMatchObject({
            CHANNELID: '',
            CHANNELNAME: '',
            HALF_WIDTH_CHANNELNAME: '',
        });

        child.exitCode = 0;
        child.emit('exit', 0, null);
        await Promise.resolve();
    });

    it.each([
        ['explicit rate', 2, 18, false],
        ['default rate four', undefined, 36, false],
        ['missing option', 2, 18, true],
    ] as const)(
        '[EN-IMP-TIMEOUT-BOUNDARY] joins the managed stop operation once at the %s deadline',
        async (_case, rate, deadline, clearOptionAtDeadline) => {
            vi.useFakeTimers();
            const unhandledRejections: unknown[] = [];
            const observeUnhandledRejection = (reason: unknown): void => {
                unhandledRejections.push(reason);
            };
            process.on('unhandledRejection', observeUnhandledRejection);
            unhandledRejectionObservers.add(observeUnhandledRejection);
            const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-timeout-'));
            temporaryRoots.add(root);
            const inputPath = join(root, 'recording.ts');
            await writeFile(inputPath, 'input');
            const child = new EventEmitter() as SyntheticChild;
            child.exitCode = null;
            child.pid = 73_101;
            child.signalCode = null;
            child.stderr = null;
            child.stdin = null;
            child.stdout = null;
            const handle = {};
            const createManaged = vi.fn(async () => ({ child, handle }));
            const stopError = new Error('synthetic deadline stop rejection');
            const requestStop = vi.fn(async () => {
                throw stopError;
            });
            const getFilePath = vi.fn();
            const release = vi.fn();
            const kill = vi.spyOn(ProcessUtil, 'kill').mockResolvedValue(undefined);
            const finish = vi.fn();
            const encodeError = vi.fn();
            const encodeInfo = vi.fn();
            const model = new EncoderModel(
                { getLogger: () => ({ encode: { debug: vi.fn(), error: encodeError, info: encodeInfo, warn: vi.fn() } }) },
                {
                    getConfig: () => ({
                        encode: [
                            {
                                cmd: '%NODE%',
                                name: 'synthetic-mode',
                                ...(rate === undefined ? {} : { rate }),
                            },
                        ],
                        ffmpeg: join(root, 'ffmpeg'),
                        ffprobe: join(root, 'ffprobe'),
                    }),
                },
                { create: vi.fn(), createManaged, requestStop },
                { getFilePath, release },
                { findId: vi.fn(async () => ({ id: 902 })) },
                {
                    findId: vi.fn(async () => ({
                        audioComponentType: null,
                        audioSamplingRate: null,
                        channelId: 903,
                        description: null,
                        dropLogFile: { dropCnt: 0, errorCnt: 0, filePath: 'drop.json', id: 904, scramblingCnt: 0 },
                        duration: 9,
                        endAt: 19,
                        extended: null,
                        genre1: null,
                        genre2: null,
                        genre3: null,
                        halfWidthDescription: null,
                        halfWidthExtended: null,
                        halfWidthName: 'half name',
                        id: 901,
                        name: 'Synthetic recording',
                        startAt: 10,
                        subGenre1: null,
                        subGenre2: null,
                        subGenre3: null,
                        videoComponentType: null,
                        videoResolution: null,
                        videoStreamContent: null,
                        videoType: null,
                    })),
                },
                { findId: vi.fn(async () => ({ halfWidthName: 'half channel', id: 903, name: 'Channel' })) },
                {
                    getFullFilePathFromId: vi.fn(async () => inputPath),
                    getInfo: vi.fn(async () => null),
                    getParentDirPath: vi.fn(() => root),
                },
                {
                    emitAddEncode: vi.fn(),
                    emitCancelEncode: vi.fn(),
                    emitErrorEncode: vi.fn(),
                    emitFinishEncode: vi.fn(),
                    emitUpdateEncodeProgress: vi.fn(),
                },
                { formatFilePathString: vi.fn(async (directory: string) => directory) },
            );
            model.setOnFinish(finish);
            model.setOption({
                directory: 'nested',
                encodeId: 905,
                mode: 'synthetic-mode',
                parentDir: 'synthetic-parent',
                recordedId: 901,
                removeOriginal: false,
                sourceVideoFileId: 902,
            });

            await model.start();
            const request = createManaged.mock.calls[0][0] as {
                output: string | null;
                spawnOption: { env: Record<string, string | undefined> };
            };
            expect(request.output).toBeNull();
            expect(request.spawnOption.env).toMatchObject({
                DIR: 'nested',
                DROP_CNT: '0',
                ERROR_CNT: '0',
                OUTPUT: '',
                SCRAMBLING_CNT: '0',
                SUBDIR: 'nested',
            });
            expect(getFilePath).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(deadline - 1);
            expect(requestStop).not.toHaveBeenCalled();
            expect(kill).not.toHaveBeenCalled();
            const encodeOption = model.getEncodeOption();
            if (clearOptionAtDeadline) {
                (model as unknown as { encodeOption: EncodeOption | null }).encodeOption = null;
            }
            await vi.advanceTimersByTimeAsync(1);
            (model as unknown as { encodeOption: EncodeOption | null }).encodeOption = encodeOption;
            expect(requestStop).toHaveBeenCalledTimes(clearOptionAtDeadline ? 0 : 1);
            if (clearOptionAtDeadline === false) {
                expect(requestStop).toHaveBeenCalledWith(handle);
                expect(encodeError).toHaveBeenCalledWith('encode process is time out: 905 null');
                expect(encodeInfo).toHaveBeenCalledWith('kill encode process encodeId: 905, pid: 73101');
                expect(encodeError).toHaveBeenCalledWith('stop encode process failed: 905');
                expect(encodeError).toHaveBeenCalledWith(stopError);
            }
            expect(kill).not.toHaveBeenCalled();
            expect(model.childProcess).toBe(child);
            expect(finish).not.toHaveBeenCalled();
            expect(release).not.toHaveBeenCalled();
            expect(unhandledRejections).toEqual([]);
            await vi.advanceTimersByTimeAsync(deadline);
            expect(requestStop).toHaveBeenCalledTimes(clearOptionAtDeadline ? 0 : 1);
            expect(model.childProcess).toBe(child);
            expect(finish).not.toHaveBeenCalled();
            expect(release).not.toHaveBeenCalled();

            child.exitCode = 1;
            child.emit('exit', 1, null);
            await Promise.resolve();
            expect(finish).toHaveBeenCalledOnce();
            expect(finish).toHaveBeenCalledWith(true, null);
            expect(model.childProcess).toBeNull();
            expect(release).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
            expect(unhandledRejections).toEqual([]);
            process.off('unhandledRejection', observeUnhandledRejection);
            unhandledRejectionObservers.delete(observeUnhandledRejection);
        },
    );
});
