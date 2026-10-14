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
        expect(abnormal.log.encode.info).toHaveBeenCalledWith('delete encode output file: abnormal-output.mp4');
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
            const queueStore = {
                add: vi.fn(async () => 1),
                abandon: vi.fn(async () => undefined),
                updateOutputPath: vi.fn(async () => undefined),
                remove: vi.fn(async () => undefined),
                list: vi.fn(async () => []),
            };
            const manage = new EncodeManageModel(
                { getLogger: () => log },
                { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: failure === 'queueAppend' ? 2 : 1 }) },
                execution,
                provider,
                event,
                undefined,
                undefined,
                queueStore,
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
            // 記録した後の失敗では、その記録を一回削除する（識別番号は戻さない）
            expect(queueStore.add).toHaveBeenCalledTimes(failure === 'execution' ? 0 : 1);
            expect(queueStore.remove.mock.calls).toEqual(failure === 'execution' ? [] : [[1]]);
            expect(queueStore.abandon).not.toHaveBeenCalled();
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
        // 失敗した B が受け取った識別番号 2 は戻さず、C は 3 になる
        await expect(acceptedC).resolves.toBe(3);

        expect(manage.getEncodeInfo()).toEqual({
            runningQueue: [],
            waitQueue: [
                { id: 1, mode: 'synthetic-mode', recordedId: 101 },
                { id: 3, mode: 'synthetic-mode', recordedId: 103 },
            ],
        });
        expect(new Set(manage.waitQueue.map(item => item.getEncodeId())).size).toBe(2);
        expect(manage.admissionReservations).toBe(0);
        expect(activeExecutions.size).toBe(0);
        expect(execution.unLockExecution).toHaveBeenCalledTimes(3);
        expect(log.encode.info.mock.calls).toEqual([['add new encode: 1'], ['add new encode: 3']]);
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

const makeTerminalManage = (concurrentEncodeNum = 1) => {
    const created: SyntheticEncoder[] = [];
    const infos: FinishEncodeInfo[] = [];
    const directFinish = {
        finishEncode: vi.fn(async (info: FinishEncodeInfo) => {
            infos.push(info);
        }),
    };
    const event = {
        emitAddEncode: vi.fn(),
        emitCancelEncode: vi.fn(),
        emitErrorEncode: vi.fn(),
        emitFinishEncode: vi.fn(),
        emitUpdateEncodeProgress: vi.fn(),
    };
    let lockCall = 0;
    const execution = {
        getExecution: vi.fn(async (_priority?: number) => `synthetic-execution-${++lockCall}`),
        unLockExecution: vi.fn(),
    };
    const logger = {
        encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
        system: { error: vi.fn() },
    };
    const token = {};
    const recordedResourceUse: RecordedResourceUsePort = {
        acquire: vi.fn(async () => ({ token })),
        release: vi.fn(async () => undefined),
    };
    const manage = new EncodeManageModel(
        { getLogger: () => logger },
        { getConfig: () => ({ concurrentEncodeNum, encodeQueueLimit: 10 }) },
        execution,
        vi.fn(async () => {
            const item = encoder(null, null);
            created.push(item);
            return item;
        }),
        event,
        recordedResourceUse,
        directFinish,
    ) as EncodeManageRuntime & { listener: EventEmitter };
    const terminal = (index: number): NonNullable<SyntheticEncoder['finishCallback']> => {
        const callback = created[index]?.finishCallback;
        if (callback === null || callback === undefined) throw new Error('MissingSyntheticFinishCallback');
        return callback;
    };
    return { created, directFinish, event, execution, infos, lease: token, logger, manage, recordedResourceUse, terminal };
};

describe('encode terminal settlement internals', () => {
    it('[EN-IMP-CONCURRENT-ZERO] rejects an admission with its stable error when no encode may run concurrently', async () => {
        const fixture = makeTerminalManage(0);
        try {
            await expect(fixture.manage.push(option(971))).rejects.toThrow('ConcurrentEncodeNumIsZero');
            expect(fixture.recordedResourceUse.acquire).not.toHaveBeenCalled();
        } finally {
            fixture.manage.listener.removeAllListeners();
        }
    });

    it('[EN-IMP-TERMINAL-ERROR] reports an abnormal end, frees the slot and releases the lease without reflecting a result', async () => {
        const fixture = makeTerminalManage();
        try {
            await fixture.manage.push(option(931));
            await vi.waitFor(() => expect(fixture.created[0]?.started).toBe(true));
            expect(fixture.manage.getEncodeInfo()).toMatchObject({ runningQueue: [{ recordedId: 931 }] });

            fixture.terminal(0)(true, null);

            await vi.waitFor(() =>
                expect(fixture.recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(fixture.lease),
            );
            expect(fixture.event.emitErrorEncode).toHaveBeenCalledOnce();
            expect(fixture.directFinish.finishEncode).not.toHaveBeenCalled();
            expect(fixture.event.emitFinishEncode).not.toHaveBeenCalled();
            expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
        } finally {
            fixture.manage.listener.removeAllListeners();
        }
    });

    it('[EN-IMP-TERMINAL-ERROR] still releases the lease when freeing the slot fails after an abnormal end', async () => {
        const fixture = makeTerminalManage();
        const failure = new Error('SyntheticFinalizeFailure');
        try {
            await fixture.manage.push(option(932));
            await vi.waitFor(() => expect(fixture.created[0]?.started).toBe(true));
            // finalize() だけが使う優先度 3 の実行権の取得を失敗させる。
            fixture.execution.getExecution.mockImplementation(async (priority?: number) => {
                if (priority === 3) throw failure;
                return 'synthetic-execution';
            });

            fixture.terminal(0)(true, null);

            await vi.waitFor(() =>
                expect(fixture.recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(fixture.lease),
            );
            await vi.waitFor(() => expect(fixture.logger.system.error).toHaveBeenCalledWith(failure));
            expect(fixture.event.emitErrorEncode).toHaveBeenCalledOnce();
        } finally {
            fixture.manage.listener.removeAllListeners();
        }
    });

    it('[EN-IMP-NULL-OPTION-UNLOCK] releases the execution lock taken for the queue check when the dequeued job has no option', async () => {
        const fixture = makeTerminalManage();
        // queue の確認は手動で 1 回だけ行う。push が取る実行権が 1 回目、確認が取る実行権が 2 回目になる。
        fixture.manage.listener.removeAllListeners();
        try {
            await fixture.manage.push(option(933));
            expect(fixture.execution.unLockExecution.mock.calls).toEqual([['synthetic-execution-1']]);
            fixture.created[0].getEncodeOption = vi.fn(() => null);

            await (fixture.manage as unknown as { checkQueue(): Promise<void> }).checkQueue();

            expect(fixture.logger.encode.warn.mock.calls).toEqual([['encodeOption is null']]);
            expect(fixture.execution.unLockExecution.mock.calls).toEqual([
                ['synthetic-execution-1'],
                ['synthetic-execution-2'],
            ]);
            expect(fixture.recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(fixture.lease);
            expect(fixture.created[0].started).toBe(false);
        } finally {
            fixture.manage.listener.removeAllListeners();
        }
    });

    it('[EN-IMP-FINISH-INFO-PATH] joins the output file name to the option directory, and uses the bare name without a directory', async () => {
        const fixture = makeTerminalManage(2);
        try {
            await fixture.manage.push(option(934));
            await fixture.manage.push({ ...option(936), directory: undefined });
            await vi.waitFor(() => expect(fixture.created.every(item => item.started)).toBe(true));

            fixture.terminal(0)(false, '/synthetic/out/with-directory.mp4');
            fixture.terminal(1)(false, '/synthetic/out/without-directory.mp4');
            await vi.waitFor(() => expect(fixture.infos).toHaveLength(2));

            expect(fixture.infos[0]).toMatchObject({
                filePath: join('synthetic-subdirectory', 'with-directory.mp4'),
                fullOutputPath: '/synthetic/out/with-directory.mp4',
                recordedId: 934,
                videoFileId: 935,
            });
            expect(fixture.infos[1]).toMatchObject({
                filePath: 'without-directory.mp4',
                fullOutputPath: '/synthetic/out/without-directory.mp4',
                recordedId: 936,
            });
        } finally {
            fixture.manage.listener.removeAllListeners();
        }
    });

    it('[EN-IMP-FINISH-INFO-REMOVE-ORIGINAL] keeps the original deletion only when no other queued or running job uses the same source file', async () => {
        const fixture = makeTerminalManage(2);
        try {
            // running: A(source 942) と B(option 無し)、waiting: C(別の source)と D(option 無し)
            await fixture.manage.push({ ...option(941), removeOriginal: true });
            await fixture.manage.push(option(943));
            await vi.waitFor(() => expect(fixture.created.every(item => item.started)).toBe(true));
            await fixture.manage.push(option(945));
            await fixture.manage.push(option(947));
            fixture.created[1].getEncodeOption = vi.fn(() => null);
            fixture.created[3].getEncodeOption = vi.fn(() => null);

            fixture.terminal(0)(false, '/synthetic/out/a.mp4');
            await vi.waitFor(() => expect(fixture.infos).toHaveLength(1));

            expect(fixture.infos[0]).toMatchObject({ removeOriginal: true, videoFileId: 942 });
        } finally {
            fixture.manage.listener.removeAllListeners();
        }
    });

    it('[EN-IMP-FINISH-INFO-REMOVE-ORIGINAL] cancels the original deletion while another waiting job uses the same source file', async () => {
        const fixture = makeTerminalManage(1);
        try {
            await fixture.manage.push({ ...option(951), removeOriginal: true });
            await vi.waitFor(() => expect(fixture.created[0]?.started).toBe(true));
            await fixture.manage.push(option(951));

            fixture.terminal(0)(false, '/synthetic/out/a.mp4');
            await vi.waitFor(() => expect(fixture.infos).toHaveLength(1));

            expect(fixture.infos[0]).toMatchObject({ removeOriginal: false, videoFileId: 952 });
        } finally {
            fixture.manage.listener.removeAllListeners();
        }
    });

    it('[EN-IMP-FINISH-INFO-REMOVE-ORIGINAL] cancels the original deletion while another running job uses the same source file', async () => {
        const fixture = makeTerminalManage(2);
        try {
            await fixture.manage.push({ ...option(961), removeOriginal: true });
            await fixture.manage.push(option(961));
            await vi.waitFor(() => expect(fixture.created.every(item => item.started)).toBe(true));

            fixture.terminal(0)(false, '/synthetic/out/a.mp4');
            await vi.waitFor(() => expect(fixture.infos).toHaveLength(1));

            expect(fixture.infos[0]).toMatchObject({ removeOriginal: false, videoFileId: 962 });
        } finally {
            fixture.manage.listener.removeAllListeners();
        }
    });
});

interface SuspendManageRuntime {
    encodeSuspendTimes: Array<{ start: number; end: number }>;
    listener: EventEmitter;
    suspendResumeTimer: (NodeJS.Timeout & { hasRef(): boolean }) | null;
    cancel(id: apid.EncodeId): Promise<void>;
    push(option: apid.AddEncodeProgramOption): Promise<number>;
}

const SUSPEND_FAKE_TIMERS = { toFake: ['setTimeout', 'clearTimeout', 'Date'] } as const;

const localTime = (hours: number, minutes: number, seconds = 0, milliseconds = 0): Date =>
    new Date(2026, 0, 5, hours, minutes, seconds, milliseconds);

const makeSuspendManage = (concurrentEncodeNum: number, encodeSuspendTimes?: unknown) => {
    const created: SyntheticEncoder[] = [];
    const logger = { encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }, system: { error: vi.fn() } };
    const event = new EncodeEvent({ getLogger: () => logger });
    const execution = { getExecution: vi.fn(async () => 'synthetic-suspend-execution'), unLockExecution: vi.fn() };
    const config: Record<string, unknown> = { concurrentEncodeNum };
    if (typeof encodeSuspendTimes !== 'undefined') config.encodeSuspendTimes = encodeSuspendTimes;
    const manage = new EncodeManageModel(
        { getLogger: () => logger },
        { getConfig: () => config },
        execution,
        vi.fn(async () => {
            const item = encoder(null, null);
            created.push(item);
            return item;
        }),
        event,
    ) as unknown as SuspendManageRuntime;
    const settle = async (): Promise<void> => {
        for (let round = 0; round < 8; round += 1) await flushEventLoop();
    };
    const release = (): void => {
        manage.listener.removeAllListeners();
        (event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
    };
    return { created, execution, manage, release, settle };
};

describe('encode suspend-time internals', () => {
    it('[EN-IMP-SUSPEND-TIMES-VALIDATION] snapshots omitted and valid ranges as minutes from midnight', () => {
        const omitted = makeSuspendManage(1);
        const explicit = makeSuspendManage(1, [
            { start: '00:00', end: '24:00' },
            { start: '23:59', end: '00:00' },
            { start: '09:05', end: '10:30' },
        ]);
        try {
            expect(omitted.manage.encodeSuspendTimes).toEqual([]);
            expect(explicit.manage.encodeSuspendTimes).toEqual([
                { start: 0, end: 1440 },
                { start: 1439, end: 0 },
                { start: 545, end: 630 },
            ]);
            expect(omitted.manage.suspendResumeTimer).toBeNull();
        } finally {
            omitted.release();
            explicit.release();
        }
    });

    it.each([
        ['null', null],
        ['a string', '18:00-19:00'],
        ['a number', 1080],
        ['an object', { start: '18:00', end: '19:00' }],
        ['a null element', [null]],
        ['an array element', [['18:00', '19:00']]],
        ['a string element', ['18:00']],
        ['a missing start', [{ end: '19:00' }]],
        ['a missing end', [{ start: '18:00' }]],
        ['a numeric start', [{ start: 1080, end: '19:00' }]],
        ['a numeric end', [{ start: '18:00', end: 1140 }]],
        ['an array start', [{ start: ['18:00'], end: '19:00' }]],
        ['a one-digit hour', [{ start: '7:00', end: '08:00' }]],
        ['seconds', [{ start: '07:00:00', end: '08:00' }]],
        ['surrounding spaces', [{ start: '07:00 ', end: '08:00' }]],
        ['24:00 as start', [{ start: '24:00', end: '01:00' }]],
        ['24:01 as end', [{ start: '23:00', end: '24:01' }]],
        ['hour 25', [{ start: '23:00', end: '25:00' }]],
        ['minute 60', [{ start: '23:60', end: '01:00' }]],
        ['minute 60 within the latest start', [{ start: '00:60', end: '02:00' }]],
        ['the same start and end', [{ start: '00:00', end: '00:00' }]],
        ['an invalid range after a valid one', [{ start: '18:00', end: '19:00' }, { start: '20:00' }]],
    ])('[EN-IMP-SUSPEND-TIMES-VALIDATION] rejects %s at construction', (_label, ranges) => {
        expect(() => makeSuspendManage(1, ranges)).toThrow('InvalidEncodeSuspendTimes');
    });

    it('[EN-IMP-SUSPEND-TIMES-RESUME] keeps one unreferenced timer for repeated checks during a suspend range', async () => {
        vi.useFakeTimers(SUSPEND_FAKE_TIMERS);
        vi.setSystemTime(localTime(18, 15));
        const fixture = makeSuspendManage(3, [{ start: '18:00', end: '19:00' }]);
        try {
            await fixture.manage.push(option(3001));
            await fixture.settle();
            const firstTimer = fixture.manage.suspendResumeTimer;
            for (const recordedId of [3002, 3003]) await fixture.manage.push(option(recordedId));
            await fixture.settle();

            expect(fixture.created.every(item => item.started === false)).toBe(true);
            expect(vi.getTimerCount()).toBe(1);
            // 後の要求は timer を置き換えず、最初の timer を残す
            expect(fixture.manage.suspendResumeTimer).toBe(firstTimer);
            expect(fixture.manage.suspendResumeTimer?.hasRef()).toBe(false);
            // 受付の3回だけ実行権を取得し、停止時間帯中の待機列確認は実行権を取得しない
            expect(fixture.execution.getExecution).toHaveBeenCalledTimes(3);
            expect(fixture.execution.unLockExecution).toHaveBeenCalledTimes(3);
        } finally {
            vi.clearAllTimers();
            fixture.release();
        }
    });

    it('[EN-IMP-SUSPEND-TIMES-RESUME] waits for the earliest end of the current ranges and re-arms while another range continues', async () => {
        vi.useFakeTimers(SUSPEND_FAKE_TIMERS);
        vi.setSystemTime(localTime(18, 15, 20, 500));
        const fixture = makeSuspendManage(1, [
            { start: '18:00', end: '20:00' },
            { start: '17:00', end: '19:00' },
            { start: '21:00', end: '18:30' },
        ]);
        try {
            await fixture.manage.push(option(3101));
            await fixture.settle();

            await vi.advanceTimersByTimeAsync(15 * 60 * 1000 - 20_500 - 1);
            expect(vi.getTimerCount()).toBe(1);
            await vi.advanceTimersByTimeAsync(1);
            await fixture.settle();
            expect(fixture.created[0].started).toBe(false);
            expect(vi.getTimerCount()).toBe(1);

            await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
            await fixture.settle();
            expect(fixture.created[0].started).toBe(false);
            expect(vi.getTimerCount()).toBe(1);

            await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
            await fixture.settle();
            expect(fixture.created[0].started).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.clearAllTimers();
            fixture.release();
        }
    });

    it('[EN-IMP-SUSPEND-TIMES-LOCK-WAIT] lets a check requested before the range start one job after its lock wait', async () => {
        vi.useFakeTimers(SUSPEND_FAKE_TIMERS);
        vi.setSystemTime(localTime(17, 59, 59));
        const fixture = makeSuspendManage(2, [{ start: '18:00', end: '19:00' }]);
        const checkLock = createDeferred<string>();
        fixture.execution.getExecution
            .mockImplementationOnce(async () => 'synthetic-admission-execution')
            .mockImplementationOnce(() => checkLock.promise);
        try {
            await fixture.manage.push(option(3301));
            await fixture.settle();
            expect(fixture.execution.getExecution).toHaveBeenCalledTimes(2);
            expect(fixture.created[0].started).toBe(false);

            // 時間帯に入ってから実行権が渡ると、要求済みの確認はそのまま一件を開始する
            vi.setSystemTime(localTime(18, 0, 20));
            checkLock.resolve('synthetic-check-execution');
            await fixture.settle();

            expect(fixture.created[0].started).toBe(true);
            expect(fixture.execution.unLockExecution).toHaveBeenCalledWith('synthetic-check-execution');
            expect(vi.getTimerCount()).toBe(0);

            // 以後の要求は時間帯中として扱い、開始しない
            await fixture.manage.push(option(3302));
            await fixture.settle();
            expect(fixture.created[1].started).toBe(false);
            expect(vi.getTimerCount()).toBe(1);
        } finally {
            vi.clearAllTimers();
            fixture.release();
        }
    });

    it('[EN-IMP-SUSPEND-TIMES-LOCK-WAIT] starts nothing from a check requested inside a range while no slot was free', async () => {
        vi.useFakeTimers(SUSPEND_FAKE_TIMERS);
        vi.setSystemTime(localTime(17, 59));
        const fixture = makeSuspendManage(1, [{ start: '18:00', end: '19:00' }]);
        const waitQueue = (fixture.manage as unknown as { waitQueue: unknown[] }).waitQueue;
        const heldLock = createDeferred<string>();
        let insideRange = false;
        let held = false;
        fixture.execution.getExecution.mockImplementation(async () => {
            // 時間帯の中で、待機依頼があるときに最初に求められた実行権を保留する
            if (insideRange && !held && (fixture.manage as unknown as { waitQueue: unknown[] }).waitQueue.length > 0) {
                held = true;
                return heldLock.promise;
            }
            return 'synthetic-suspend-execution';
        });
        try {
            await fixture.manage.push(option(3401));
            await fixture.settle();
            expect(fixture.created[0].started).toBe(true);
            expect(waitQueue).toHaveLength(0);

            // 空き枠が無いときに受け付け、その確認の要求も時間帯の中で受ける
            insideRange = true;
            vi.setSystemTime(localTime(18, 10));
            await fixture.manage.push(option(3402));
            await fixture.settle();

            // 実行中のジョブが終わって空き枠ができた後で、保留した実行権を渡しても開始しない
            fixture.created[0].finish();
            await fixture.settle();
            heldLock.resolve('synthetic-held-execution');
            await fixture.settle();

            expect(fixture.created[1].started).toBe(false);
            expect(vi.getTimerCount()).toBe(1);
        } finally {
            vi.clearAllTimers();
            fixture.release();
        }
    });

    it('[EN-IMP-SUSPEND-TIMES-LOCK-WAIT] starts nothing from a check requested inside a range while nothing waited', async () => {
        vi.useFakeTimers(SUSPEND_FAKE_TIMERS);
        vi.setSystemTime(localTime(17, 59));
        const fixture = makeSuspendManage(1, [{ start: '18:00', end: '19:00' }]);
        const admissionLock = createDeferred<string>();
        const heldLock = createDeferred<string>();
        let callsInsideRange = 0;
        fixture.execution.getExecution.mockImplementation(async () => {
            if (vi.getMockedSystemTime()?.getTime() !== localTime(18, 10).getTime()) {
                return 'synthetic-suspend-execution';
            }
            callsInsideRange += 1;
            // 時間帯の中の 1 回目は受付、2 回目は終了の後始末、3 回目は待機列が空のときに要求された確認
            if (callsInsideRange === 1) return admissionLock.promise;
            if (callsInsideRange === 3) return heldLock.promise;
            return 'synthetic-suspend-execution';
        });
        try {
            await fixture.manage.push(option(3501));
            await fixture.settle();
            expect(fixture.created[0].started).toBe(true);

            vi.setSystemTime(localTime(18, 10));
            const pushed = fixture.manage.push(option(3502));
            await fixture.settle();
            fixture.created[0].finish();
            await fixture.settle();
            expect(vi.getTimerCount()).toBe(0);

            // 受付が終わって待機依頼ができた後で、保留した実行権を渡しても開始しない
            admissionLock.resolve('synthetic-admission-execution');
            await pushed;
            await fixture.settle();
            heldLock.resolve('synthetic-held-execution');
            await fixture.settle();

            expect(fixture.created[1].started).toBe(false);
            expect(vi.getTimerCount()).toBe(1);
        } finally {
            vi.clearAllTimers();
            fixture.release();
        }
    });

    it('[EN-IMP-SUSPEND-TIMES-RESUME] waits until the next-day end in the late part of a range across midnight', async () => {
        vi.useFakeTimers(SUSPEND_FAKE_TIMERS);
        vi.setSystemTime(localTime(23, 30));
        const fixture = makeSuspendManage(1, [{ start: '23:00', end: '02:00' }]);
        try {
            await fixture.manage.push(option(3601));
            await fixture.settle();
            const firstTimer = fixture.manage.suspendResumeTimer;
            expect(firstTimer).not.toBeNull();

            // 終了は翌日の 02:00 なので、最初の timer は判定し直しの上限（1 分）まで発火しない
            await vi.advanceTimersByTimeAsync(60 * 1000 - 1);
            await fixture.settle();
            expect(fixture.manage.suspendResumeTimer).toBe(firstTimer);

            await vi.advanceTimersByTimeAsync(150 * 60 * 1000 - (60 * 1000 - 1) - 1);
            await fixture.settle();
            expect(fixture.created[0].started).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            await fixture.settle();
            expect(fixture.created[0].started).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.clearAllTimers();
            fixture.release();
        }
    });

    it('[EN-IMP-SUSPEND-TIMES-RESUME] resumes at the end in the last minute of the late part of a range across midnight', async () => {
        vi.useFakeTimers(SUSPEND_FAKE_TIMERS);
        vi.setSystemTime(localTime(23, 59, 30));
        const fixture = makeSuspendManage(1, [{ start: '23:00', end: '00:00' }]);
        try {
            await fixture.manage.push(option(3611));
            await fixture.settle();

            // 終了（翌日の 00:00）まで残り 30 秒なので、判定し直しの上限（1 分）を待たずに終了時に開始する
            await vi.advanceTimersByTimeAsync(30 * 1000 - 1);
            await fixture.settle();
            expect(fixture.created[0].started).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            await fixture.settle();
            expect(fixture.created[0].started).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.clearAllTimers();
            fixture.release();
        }
    });

    it('[EN-IMP-SUSPEND-TIMES-RESUME] uses a 1 ms delay one millisecond before the end', async () => {
        vi.useFakeTimers(SUSPEND_FAKE_TIMERS);
        vi.setSystemTime(localTime(18, 59, 59, 999));
        const fixture = makeSuspendManage(1, [{ start: '18:00', end: '19:00' }]);
        try {
            await fixture.manage.push(option(3701));
            await fixture.settle();
            expect(fixture.created[0].started).toBe(false);
            expect(vi.getTimerCount()).toBe(1);

            await vi.advanceTimersByTimeAsync(1);
            await fixture.settle();
            expect(fixture.created[0].started).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.clearAllTimers();
            fixture.release();
        }
    });

    it('[EN-IMP-SUSPEND-TIMES-RESUME] keeps a whole-day range suspended across midnight', async () => {
        vi.useFakeTimers(SUSPEND_FAKE_TIMERS);
        vi.setSystemTime(localTime(23, 59, 30));
        const fixture = makeSuspendManage(1, [{ start: '00:00', end: '24:00' }]);
        try {
            await fixture.manage.push(option(3801));
            await fixture.settle();

            await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
            await fixture.settle();
            expect(new Date().getHours()).toBe(0);
            expect(fixture.created[0].started).toBe(false);
            expect(vi.getTimerCount()).toBe(1);
        } finally {
            vi.clearAllTimers();
            fixture.release();
        }
    });

    it('[EN-IMP-SUSPEND-TIMES-RESUME] cancels a waiting request inside a range and starts only the rest at the end', async () => {
        vi.useFakeTimers(SUSPEND_FAKE_TIMERS);
        vi.setSystemTime(localTime(18, 30));
        const fixture = makeSuspendManage(2, [{ start: '18:00', end: '19:00' }]);
        try {
            const cancelledId = await fixture.manage.push(option(3901));
            await fixture.manage.push(option(3902));
            await fixture.settle();

            await fixture.manage.cancel(cancelledId);
            await fixture.settle();
            expect(fixture.created.map(item => item.started)).toEqual([false, false]);
            expect(vi.getTimerCount()).toBe(1);

            await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
            await fixture.settle();
            expect(fixture.created.map(item => item.started)).toEqual([false, true]);
        } finally {
            vi.clearAllTimers();
            fixture.release();
        }
    });

    it('[EN-IMP-SUSPEND-TIMES-LOCK-WAIT] holds the next request after a lock-waiting check fails to start inside a range', async () => {
        vi.useFakeTimers(SUSPEND_FAKE_TIMERS);
        vi.setSystemTime(localTime(17, 59, 59));
        const fixture = makeSuspendManage(1, [{ start: '18:00', end: '19:00' }]);
        const checkLock = createDeferred<string>();
        fixture.execution.getExecution
            .mockImplementationOnce(async () => 'synthetic-admission-execution')
            .mockImplementationOnce(() => checkLock.promise);
        try {
            await fixture.manage.push(option(4001));
            await fixture.settle();
            vi.mocked(fixture.created[0].start).mockRejectedValueOnce(new Error('synthetic start failure'));

            vi.setSystemTime(localTime(18, 0, 20));
            await fixture.manage.push(option(4002));
            await fixture.settle();

            // 時間帯の前に要求された確認が開始に失敗した後、後始末が出す確認は時間帯の中なので開始しない
            checkLock.resolve('synthetic-check-execution');
            await fixture.settle();
            expect(fixture.created[0].start).toHaveBeenCalledTimes(1);
            expect(fixture.created[1].started).toBe(false);
            expect(vi.getTimerCount()).toBe(1);
        } finally {
            vi.clearAllTimers();
            fixture.release();
        }
    });

    it('[EN-IMP-SUSPEND-TIMES-RESUME] requests as many checks as waiting requests when they are fewer than the free slots', async () => {
        vi.useFakeTimers(SUSPEND_FAKE_TIMERS);
        vi.setSystemTime(localTime(18, 30));
        const fixture = makeSuspendManage(3, [{ start: '18:00', end: '19:00' }]);
        try {
            await fixture.manage.push(option(4101));
            await fixture.settle();
            const callsBeforeEnd = fixture.execution.getExecution.mock.calls.length;

            await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
            await fixture.settle();

            // 空き枠は 3 だが待機は 1 件なので、確認は 1 回だけ実行権を求める
            expect(fixture.execution.getExecution.mock.calls.length - callsBeforeEnd).toBe(1);
            expect(fixture.created[0].started).toBe(true);
        } finally {
            vi.clearAllTimers();
            fixture.release();
        }
    });

    it('[EN-IMP-SUSPEND-TIMES-RESUME] requests no queue check at the end when no slot is free or nothing waits', async () => {
        vi.useFakeTimers(SUSPEND_FAKE_TIMERS);
        vi.setSystemTime(localTime(18, 0));
        const busy = makeSuspendManage(1, [{ start: '18:00', end: '19:00' }]);
        const empty = makeSuspendManage(1, [{ start: '18:00', end: '19:00' }]);
        try {
            await busy.manage.push(option(3201));
            const cancelledId = await empty.manage.push(option(3203));
            await busy.settle();
            expect(vi.getTimerCount()).toBe(2);

            // 再開 timer が残ったまま時間帯の外で受け付けると、先頭が開始して本機能の枠が埋まる。
            vi.setSystemTime(localTime(12, 0));
            await busy.manage.push(option(3202));
            await busy.settle();
            expect(busy.created.map(item => item.started)).toEqual([true, false]);
            await empty.manage.cancel(cancelledId);
            await empty.settle();
            const busyChecks = busy.execution.getExecution.mock.calls.length;
            const emptyChecks = empty.execution.getExecution.mock.calls.length;

            await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
            await busy.settle();

            expect(busy.execution.getExecution).toHaveBeenCalledTimes(busyChecks);
            expect(empty.execution.getExecution).toHaveBeenCalledTimes(emptyChecks);
            expect(busy.created[1].started).toBe(false);
            expect(vi.getTimerCount()).toBe(0);

            busy.created[0].finish();
            await busy.settle();
            expect(busy.created[1].started).toBe(true);
        } finally {
            vi.clearAllTimers();
            busy.release();
            empty.release();
        }
    });
});
