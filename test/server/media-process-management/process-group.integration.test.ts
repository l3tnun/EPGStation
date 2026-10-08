import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface LiveModel {
    getStream(): PassThrough;
    setExitStream(callback: () => void): void;
    setOption(option: { channelId: number; cmd?: string }, mode: number): void;
    start(streamId: number): Promise<void>;
    stop(): Promise<void>;
}

interface LiveModelConstructor {
    new (...dependencies: unknown[]): LiveModel;
    readonly ENCODE_PROCESS_PRIORITY: number;
}

interface PriorityConsumerConstructor {
    readonly ENCODE_PROCESS_PRIORITY?: number;
    readonly ENCODE_PRIPORITY?: number;
}

interface EncoderRuntime {
    cancel(): Promise<void>;
    childProcess: SyntheticChild | null;
    setOnFinish(callback: (isError: boolean, outputFilePath: string | null) => void): void;
    setOption(option: {
        encodeId: number;
        mode: string;
        parentDir: string;
        recordedId: number;
        removeOriginal: boolean;
        sourceVideoFileId: number;
    }): void;
    start(): Promise<void>;
}

interface EncoderConstructor extends PriorityConsumerConstructor {
    new (...dependencies: unknown[]): EncoderRuntime;
}

interface ManagedProcessManager {
    createHlsWriter(option: {
        cmd: string;
        input: null;
        output: null;
        priority: number;
    }): Promise<{ child: SyntheticChild; handle: object }>;
    createManaged(option: {
        cmd: string;
        input: null;
        output: null;
        priority: number;
    }): Promise<{ child: SyntheticChild; handle: object }>;
    requestStop(handle: object): Promise<unknown>;
    stopHls(handle: object): Promise<{
        exitConfirmed: boolean;
        sentSignals: Array<'SIGINT' | 'SIGKILL'>;
        slotReleased: true;
    }>;
}

interface ManagedProcessManagerConstructor {
    new (
        logger: { getLogger(): unknown },
        configuration: { getConfig(): { encodeProcessNum: number } },
    ): ManagedProcessManager;
}

interface SyntheticChild extends EventEmitter {
    exitCode: number | null;
    kill(signal?: string): boolean;
    pid: number;
    signalCode: NodeJS.Signals | null;
    stderr: PassThrough;
    stdin: PassThrough;
    stdout: PassThrough;
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const LiveStreamModel = (
    require(join(compiledSnapshot, 'model', 'service', 'stream', 'LiveStreamModel.js')) as {
        default: LiveModelConstructor;
    }
).default;
const LiveHLSStreamModel = (
    require(join(compiledSnapshot, 'model', 'service', 'stream', 'LiveHLSStreamModel.js')) as {
        default: LiveModelConstructor;
    }
).default;
const EncoderModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncoderModel.js')) as {
        default: EncoderConstructor;
    }
).default;
const RecordedStreamModel = require(
    join(compiledSnapshot, 'model', 'service', 'stream', 'RecordedStreamModel.js'),
).default;
const RecordedHLSStreamModel = require(
    join(compiledSnapshot, 'model', 'service', 'stream', 'RecordedHLSStreamModel.js'),
).default;
const RecordedStreamBaseModel = (
    require(join(compiledSnapshot, 'model', 'service', 'stream', 'base', 'RecordedStreamBaseModel.js')) as {
        default: PriorityConsumerConstructor;
    }
).default;
const EncodeProcessManageModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeProcessManageModel.js')) as {
        default: ManagedProcessManagerConstructor;
    }
).default;
const processUtil = (
    require(join(compiledSnapshot, 'util', 'ProcessUtil.js')) as {
        default: {
            isProcessGroupAlive(pgid: number): boolean;
            kill(child: SyntheticChild): Promise<void>;
            killProcessGroup(pgid: number, signal: NodeJS.Signals): void;
        };
    }
).default;

const resources: Array<EventEmitter | PassThrough> = [];
const temporaryDirectories: string[] = [];
const isolatedProcessGroups = new Set<number>();
const logger = {
    stream: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
};

const makeSource = (): PassThrough => {
    const stream = new PassThrough();
    resources.push(stream);
    return stream;
};

const makeChild = (): SyntheticChild => {
    const child = Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        kill: vi.fn(() => true),
        pid: 42,
        signalCode: null as NodeJS.Signals | null,
        stderr: new PassThrough(),
        stdin: new PassThrough(),
        stdout: new PassThrough(),
    });
    resources.push(child, child.stdin, child.stdout, child.stderr);
    return child;
};

const deferred = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const makeManager = (child: SyntheticChild) => {
    const managedHandle = Object.freeze({ kind: 'managed' });
    const hlsHandle = Object.freeze({ kind: 'hls-writer' });
    return {
        create: vi.fn(),
        createHlsWriter: vi.fn(async () => ({ child, handle: hlsHandle })),
        createManaged: vi.fn(async () => ({ child, handle: managedHandle })),
        hlsHandle,
        managedHandle,
        requestStop: vi.fn(async () => ({ status: 'requested', sentSignals: ['SIGINT'] })),
        stopHls: vi.fn(async () => ({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true })),
    };
};

const makeConfig = () => {
    const streamFilePath = mkdtempSync(join(tmpdir(), 'epgstation-media-process-'));
    temporaryDirectories.push(streamFilePath);
    const config: Record<string, unknown> = {
        ffmpeg: join(tmpdir(), 'epgstation-media-process', 'ffmpeg'),
        streamingPriority: 1,
    };
    config.streamFilePath = streamFilePath;
    return config;
};

// `laterSources` を渡した場合だけ、開始のたびに次の放送受信 stream を返す。空の既定では
// 従来どおり常に同じ `source` を返すため、既存 case の観測は変わらない。逐次で世代を切り替える
// case は、前世代の stream が停止時に destroy されるため独立した stream を必要とする。
const makeLive = (
    manager: ReturnType<typeof makeManager>,
    source: PassThrough,
    hls = false,
    laterSources: PassThrough[] = [],
): {
    fileDeleter: { deleteAllFiles: ReturnType<typeof vi.fn>; setOption: ReturnType<typeof vi.fn> };
    live: LiveModel;
} => {
    const queue = [source, ...laterSources];
    const tunerServerAccess = {
        openServiceStream: vi.fn(async () => {
            const stream = queue.length > 1 ? queue.shift()! : queue[0];
            return { stream, close: () => stream.destroy() };
        }),
    };
    const fileDeleter = { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() };
    const Model = hls ? LiveHLSStreamModel : LiveStreamModel;
    return {
        fileDeleter,
        live: new Model(
            { getConfig: makeConfig },
            { getLogger: () => logger },
            manager,
            fileDeleter,
            tunerServerAccess,
            { notifyClient: vi.fn() },
        ),
    };
};

const makeRecorded = (manager: ReturnType<typeof makeManager>, hls = false) => {
    const fileDeleter = { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() };
    const Model = hls ? RecordedHLSStreamModel : RecordedStreamModel;
    const recorded = new Model(
        { getConfig: makeConfig },
        { getLogger: () => logger },
        manager,
        fileDeleter,
        { notifyClient: vi.fn() },
        { findId: vi.fn(async () => null) },
        { findId: vi.fn(async () => null) },
        { getFullFilePathFromId: vi.fn() },
    );
    recorded.setOption({ cmd: `${process.execPath} -e synthetic`, playPosition: 0, videoFileId: 31 }, 0);
    recorded.setVideFileInfo = vi.fn(async () => {
        recorded.videoFilePath = join(tmpdir(), 'synthetic-video.ts');
        recorded.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
        recorded.videoFileType = 'encoded';
        recorded.isRecording = false;
    });
    return { fileDeleter, recorded };
};

const makeEncoder = (manager: ReturnType<typeof makeManager>, child: SyntheticChild): EncoderRuntime => {
    const root = mkdtempSync(join(tmpdir(), 'epgstation-media-encoder-'));
    temporaryDirectories.push(root);
    const inputPath = join(root, 'input.ts');
    writeFileSync(inputPath, 'synthetic input');
    const encodeLogger = { encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
    const encoder = new EncoderModel(
        { getLogger: () => encodeLogger },
        {
            getConfig: () => ({
                encode: [{ cmd: `${process.execPath} -e synthetic`, name: 'synthetic-mode', rate: 1 }],
                ffmpeg: join(root, 'ffmpeg'),
                ffprobe: join(root, 'ffprobe'),
            }),
        },
        manager,
        { getFilePath: vi.fn(), release: vi.fn() },
        { findId: vi.fn(async () => ({ id: 2102 })) },
        {
            findId: vi.fn(async () => ({
                audioComponentType: null,
                audioSamplingRate: null,
                channelId: 2103,
                description: null,
                dropLogFile: null,
                duration: 1000,
                endAt: 2000,
                extended: null,
                genre1: null,
                genre2: null,
                genre3: null,
                halfWidthDescription: null,
                halfWidthExtended: null,
                halfWidthName: 'synthetic recording',
                id: 2101,
                name: 'synthetic recording',
                startAt: 1000,
                subGenre1: null,
                subGenre2: null,
                subGenre3: null,
                videoComponentType: null,
                videoResolution: null,
                videoStreamContent: null,
                videoType: null,
            })),
        },
        { findId: vi.fn(async () => ({ halfWidthName: 'synthetic channel', id: 2103, name: 'synthetic channel' })) },
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
    encoder.setOption({
        encodeId: 2105,
        mode: 'synthetic-mode',
        parentDir: 'synthetic-parent',
        recordedId: 2101,
        removeOriginal: false,
        sourceVideoFileId: 2102,
    });
    manager.createManaged.mockResolvedValueOnce({ child, handle: manager.managedHandle });
    return encoder;
};

afterEach(() => {
    for (const pgid of isolatedProcessGroups) {
        try {
            process.kill(-pgid, 'SIGKILL');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
    }
    isolatedProcessGroups.clear();
    for (const resource of resources.splice(0)) {
        resource.removeAllListeners();
        if (resource instanceof PassThrough) resource.destroy();
    }
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('media process manager consumer boundaries', () => {
    it('[MP-INT-R4-INTERFACE] exposes the approved HLS handle, start, stop, and manager contracts to TypeScript consumers', () => {
        const directory = mkdtempSync(join(tmpdir(), 'epgstation-interface-consumer-'));
        temporaryDirectories.push(directory);
        const consumerPath = join(directory, 'consumer.ts');
        const interfacePath = join(process.cwd(), 'src', 'model', 'service', 'encode', 'IEncodeProcessManageModel');
        writeFileSync(
            consumerPath,
            `import type IEncodeProcessManageModel from ${JSON.stringify(interfacePath)};
import type { CreateProcessOption, HlsWriterHandle, HlsWriterStartResult, HlsWriterStopResult, ManagedProcessHandle } from ${JSON.stringify(interfacePath)};
declare const manager: IEncodeProcessManageModel;
declare const option: CreateProcessOption;
declare const handle: HlsWriterHandle;
declare const managedHandle: ManagedProcessHandle;
const started: Promise<HlsWriterStartResult> = manager.createHlsWriter(option);
const stopped: Promise<HlsWriterStopResult> = manager.stopHls(handle);
const invalidOption: CreateProcessOption = {
    // @ts-expect-error input rejects a number at the TypeScript boundary
    input: 1,
    output: null,
    cmd: 'synthetic',
    // @ts-expect-error priority rejects a string at the TypeScript boundary
    priority: 'high',
};
// @ts-expect-error a normal managed handle cannot address HLS group stop
manager.stopHls(managedHandle);
void started;
void stopped;
void invalidOption;
`,
        );

        const typescript = require('typescript') as typeof import('typescript');
        const program = typescript.createProgram([consumerPath], {
            module: typescript.ModuleKind.CommonJS,
            moduleResolution: typescript.ModuleResolutionKind.Node10,
            noEmit: true,
            skipLibCheck: true,
            strict: true,
            target: typescript.ScriptTarget.ES2022,
            // TypeScript 6's `moduleResolution: node10` deprecation warning is itself a diagnostic
            // now; silence it the way the diagnostic's own message instructs, since this test
            // asserts on the consumer's own diagnostics, not on the TypeScript version's migration
            // notices. `types`/`typeRoots` point this standalone `createProgram` (which has no
            // tsconfig of its own, since `consumerPath` lives outside the repo in a temp directory)
            // at this repo's `@types/node`, which Node10 resolution needs to resolve `IEncodeProcess
            // ManageModel.ts`'s own `import { ChildProcess, SpawnOptions } from 'child_process'`
            // (confirmed via a minimal repro: without this, `getPreEmitDiagnostics` reports "Cannot
            // find name 'child_process'" for that import even though it is never used as a bare
            // name -- the newer TypeScript no longer discovers `@types/node` from a temp-directory
            // program root on its own).
            ignoreDeprecations: '6.0',
            types: ['node'],
            typeRoots: [join(process.cwd(), 'node_modules', '@types')],
        });
        const diagnostics = typescript
            .getPreEmitDiagnostics(program)
            .map(diagnostic => typescript.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));

        expect(diagnostics).toEqual([]);
    });

    it('[MP-INT-R2-PRIORITIES] keeps encoding at priority 10 and both playback conversions at priority 1', () => {
        expect(EncoderModel.ENCODE_PRIPORITY).toBe(10);
        expect(LiveStreamModel.ENCODE_PROCESS_PRIORITY).toBe(1);
        expect(RecordedStreamBaseModel.ENCODE_PROCESS_PRIORITY).toBe(1);
    });

    it.each(['cancel', 'deadline'] as const)(
        '[MP-INT-R6-ENCODING-%s] retains child and handle separately and delegates one high-priority stop',
        async reason => {
            vi.useFakeTimers();
            const child = makeChild();
            const manager = makeManager(child);
            const encoder = makeEncoder(manager, child);
            let resolveFinish: () => void = () => {};
            const finished = new Promise<void>(resolve => {
                resolveFinish = resolve;
            });
            encoder.setOnFinish(() => resolveFinish());

            await encoder.start();
            expect(manager.createManaged).toHaveBeenCalledWith(expect.objectContaining({ priority: 10 }));
            expect(encoder.childProcess).toBe(child);

            if (reason === 'cancel') {
                await Promise.all([encoder.cancel(), encoder.cancel()]);
            } else {
                await vi.advanceTimersByTimeAsync(1000);
                await vi.waitFor(() => expect(manager.requestStop).toHaveBeenCalledOnce());
            }

            expect(manager.requestStop).toHaveBeenCalledOnce();
            expect(manager.requestStop).toHaveBeenCalledWith(manager.managedHandle);
            expect(child.kill).not.toHaveBeenCalled();
            expect(encoder.childProcess).toBe(child);

            child.signalCode = 'SIGINT';
            child.emit('exit', null, 'SIGINT');
            await finished;
            expect(encoder.childProcess).toBeNull();
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('[MP-INT-R1-DIRECT-LIVE] bypasses every manager start contract when no transform command exists', async () => {
        vi.useFakeTimers();
        const source = makeSource();
        const manager = makeManager(makeChild());
        const { live } = makeLive(manager, source);
        live.setOption({ channelId: 101 }, 0);

        try {
            await live.start(7);
            expect(manager.create).not.toHaveBeenCalled();
            expect(manager.createManaged).not.toHaveBeenCalled();
            expect(manager.createHlsWriter).not.toHaveBeenCalled();
            expect(live.getStream()).toBe(source);
        } finally {
            await live.stop();
        }
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        ['live', false],
        ['recorded', true],
    ])(
        // 配信 session の停止契約は `server-media-delivery` が所有する。terminal 後も保存済み
        // managed handle を保持し、stop() が一回だけ委譲する挙動を MD 側が固定している:
        //   live     -> test/server/media-delivery/live-delivery.test.ts:105 [MD-1.6]
        //   recorded -> test/server/media-delivery/recorded-delivery.test.ts:136 [MD-6.2]
        //               test/server/media-delivery/direct-stop.spec.test.ts:87 [MD-6.2]
        // 本 spec (server-media-process-management) が所有するのは「どの停止契約を選ぶか」と
        // 「child/PID/PGID へ直接 signal を送らないか」であり、契約選択と exactly-once はここで検証する。
        '[MP-INT-R6-NORMAL-%s] uses the exact managed handle once and retains it through terminal cleanup',
        async (_, recorded) => {
            vi.useFakeTimers();
            const child = makeChild();
            const manager = makeManager(child);
            const source = makeSource();
            const consumer = recorded ? makeRecorded(manager, false).recorded : makeLive(manager, source).live;
            if (!recorded) consumer.setOption({ channelId: 102, cmd: `${process.execPath} -e synthetic` }, 0);

            await consumer.start(8);
            expect(manager.createManaged).toHaveBeenCalledWith(expect.objectContaining({ priority: 1 }));
            expect(manager.createHlsWriter).not.toHaveBeenCalled();
            expect(manager.create).not.toHaveBeenCalled();

            child.emit('exit', 0);
            if (!recorded) {
                // live は stop() 前に終了したので canSessionAdopt が true のまま
                // logStreamProcessExit に到達し、warn 側で記録される（1.6-1）。
                expect(logger.stream.warn.mock.calls.at(-1)?.[0]).toBe(
                    'encode process exited: code=0, signal=undefined',
                );
            }
            await consumer.stop();
            await consumer.stop();

            expect(manager.requestStop).toHaveBeenCalledOnce();
            expect(manager.requestStop.mock.calls[0][0]).toBe(manager.managedHandle);
            expect(manager.stopHls).not.toHaveBeenCalled();
            expect(child.kill).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it.each([
        ['live', false],
        ['recorded', true],
    ])('[MP-INT-R6-STALE-%s] keeps the current handle when an older child terminates late', async (_, recorded) => {
        vi.useFakeTimers();
        const firstChild = makeChild();
        const secondChild = makeChild();
        const manager = makeManager(firstChild);
        const firstHandle = Object.freeze({ generation: 1 });
        const secondHandle = Object.freeze({ generation: 2 });
        manager.createManaged
            .mockResolvedValueOnce({ child: firstChild, handle: firstHandle })
            .mockResolvedValueOnce({ child: secondChild, handle: secondHandle });
        const consumer = recorded ? makeRecorded(manager, false).recorded : makeLive(manager, makeSource()).live;
        if (!recorded) consumer.setOption({ channelId: 105, cmd: `${process.execPath} -e synthetic` }, 0);

        await consumer.start(11);
        await consumer.start(12);
        firstChild.emit('exit', 0);
        await consumer.stop();

        expect(manager.requestStop).toHaveBeenCalledOnce();
        expect(manager.requestStop.mock.calls[0][0]).toBe(secondHandle);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        ['live normal', false, false],
        ['recorded normal', true, false],
        ['live HLS', false, true],
        ['recorded HLS', true, true],
    ])(
        '[MP-INT-R6-LATE-START-%s] stops the exact handle once when create settles after stop',
        async (_, recorded, hls) => {
            vi.useFakeTimers();
            const child = makeChild();
            const lateHandle = Object.freeze({ generation: 'late' });
            const pendingStart = deferred<{ child: SyntheticChild; handle: object }>();
            const manager = makeManager(child);
            const create = hls ? manager.createHlsWriter : manager.createManaged;
            create.mockImplementationOnce(() => pendingStart.promise);
            const created = recorded ? makeRecorded(manager, hls) : makeLive(manager, makeSource(), hls);
            const consumer = recorded ? created.recorded : created.live;
            if (!recorded) consumer.setOption({ channelId: 107, cmd: `${process.execPath} -e synthetic` }, 0);

            const starting = consumer.start(14);
            await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
            await consumer.stop();
            pendingStart.resolve({ child, handle: lateHandle });
            // 停止済み session を late create が採用しないことは `server-media-delivery` が所有する。
            // live は開始を失敗として終端し、recorded は late 停止だけ行って正常終端する:
            //   live normal -> test/server/media-delivery/live-delivery.test.ts:143 [MD-1.8]
            //   live HLS    -> test/server/media-delivery/media-delivery-tuner.integration.test.ts:89
            //                  [MD-5.1][MD-5.10][MD-5.12]
            //   recorded    -> test/server/media-delivery/hls-lifecycle.spec.test.ts:363 [PRIMARY R5.10]
            if (recorded) {
                await expect(starting).resolves.toBeUndefined();
            } else {
                await expect(starting).rejects.toThrow('StreamStartStopped');
            }

            if (hls) {
                expect(manager.stopHls).toHaveBeenCalledOnce();
                expect(manager.stopHls.mock.calls[0][0]).toBe(lateHandle);
                expect(manager.requestStop).not.toHaveBeenCalled();
            } else {
                expect(manager.requestStop).toHaveBeenCalledOnce();
                expect(manager.requestStop.mock.calls[0][0]).toBe(lateHandle);
                expect(manager.stopHls).not.toHaveBeenCalled();
            }
            expect(child.kill).not.toHaveBeenCalled();

            await consumer.stop();

            expect(hls ? manager.stopHls : manager.requestStop).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it.each([
        ['live normal', false, false],
        ['recorded normal', true, false],
        ['live HLS', false, true],
        ['recorded HLS', true, true],
    ])(
        '[MP-INT-R6-CURRENT-START-FAILURE-%s] cleans only the current generation after process creation fails',
        async (_, recorded, hls) => {
            vi.useFakeTimers();
            const child = makeChild();
            const manager = makeManager(child);
            const create = hls ? manager.createHlsWriter : manager.createManaged;
            const createFailure = new Error('synthetic current generation create failure');
            create.mockRejectedValueOnce(createFailure);
            const liveSource = makeSource();
            const created = recorded ? makeRecorded(manager, hls) : makeLive(manager, liveSource, hls);
            const consumer = recorded ? created.recorded : created.live;
            if (!recorded) consumer.setOption({ channelId: 110, cmd: `${process.execPath} -e synthetic` }, 0);

            if (recorded) {
                await expect(consumer.start(19)).rejects.toThrow('CreateStreamProcessError');
            } else {
                await expect(consumer.start(19)).rejects.toBe(createFailure);
                expect(liveSource.destroyed).toBe(true);
            }

            expect(manager.requestStop).not.toHaveBeenCalled();
            expect(manager.stopHls).not.toHaveBeenCalled();
            if (recorded && hls) {
                expect(created.fileDeleter.deleteAllFiles).toHaveBeenCalledTimes(2);
            }
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it.each([
        ['live normal', false, false],
        ['recorded normal', true, false],
        ['live HLS', false, true],
        ['recorded HLS', true, true],
    ])(
        '[MP-INT-R6-START-GENERATION-STOP-FAILURE-%s] preserves the current handle when stopping a late older handle fails',
        async (_, recorded, hls) => {
            vi.useFakeTimers();
            const lateChild = makeChild();
            const currentChild = makeChild();
            const lateHandle = Object.freeze({ generation: 'late' });
            const currentHandle = Object.freeze({ generation: 'current' });
            const lateStart = deferred<{ child: SyntheticChild; handle: object }>();
            const currentStart = deferred<{ child: SyntheticChild; handle: object }>();
            const manager = makeManager(lateChild);
            const create = hls ? manager.createHlsWriter : manager.createManaged;
            const stop = hls ? manager.stopHls : manager.requestStop;
            const stopFailure = new Error('synthetic stale handle stop failure');
            create.mockImplementationOnce(() => lateStart.promise).mockImplementationOnce(() => currentStart.promise);
            stop.mockRejectedValueOnce(stopFailure);
            const liveSource = makeSource();
            const currentLiveSource = makeSource();
            const created = recorded
                ? makeRecorded(manager, hls)
                : makeLive(manager, liveSource, hls, [currentLiveSource]);
            const consumer = recorded ? created.recorded : created.live;
            if (!recorded) consumer.setOption({ channelId: 109, cmd: `${process.execPath} -e synthetic` }, 0);

            const lateStarting = consumer.start(17);
            await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());

            if (recorded) {
                // 録画配信 consumer は世代を並走させる。late 世代の停止失敗の扱いは
                // `server-media-delivery` が所有する:
                //   recorded HLS -> test/server/media-delivery/hls-lifecycle.spec.test.ts:363
                //                   [PRIMARY R5.10] 失敗は writerStopFailure としてログし飲み込む
                const currentStarting = consumer.start(18);
                await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
                currentStart.resolve({ child: currentChild, handle: currentHandle });
                await currentStarting;
                lateStart.resolve({ child: lateChild, handle: lateHandle });

                if (hls) {
                    await expect(lateStarting).resolves.toBeUndefined();
                } else {
                    await expect(lateStarting).rejects.toBe(stopFailure);
                }
            } else {
                // ライブ配信 consumer の start() は single-flight であり、進行中の start を
                // 並走させる経路自体が存在しない。`server-media-delivery` 側の固定:
                //   src/model/service/stream/base/LiveStreamBaseModel.ts:104-115
                //   test/server/media-delivery/media-delivery-tuner.integration.test.ts:163
                //     -> rejects.toThrow('StreamStartInProgress')
                //   test/server/media-delivery/live-delivery.test.ts:143 [MD-1.8]
                //     -> 次世代は先行 start が終端してから逐次で開始する
                await expect(consumer.start(18)).rejects.toThrow('StreamStartInProgress');
                expect(create).toHaveBeenCalledOnce();

                await consumer.stop();
                lateStart.resolve({ child: lateChild, handle: lateHandle });
                // late 世代の停止失敗は開始失敗を置き換えず、開始は StreamStartStopped で終端する。
                await expect(lateStarting).rejects.toThrow('StreamStartStopped');

                expect(stop).toHaveBeenCalledOnce();
                expect(stop.mock.calls[0][0]).toBe(lateHandle);

                // 停止失敗を挟んでも次世代を開始でき、その handle が現行として保持される。
                const currentStarting = consumer.start(18);
                await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
                currentStart.resolve({ child: currentChild, handle: currentHandle });
                await currentStarting;
            }

            expect(stop).toHaveBeenCalledOnce();
            expect(stop.mock.calls[0][0]).toBe(lateHandle);
            expect(lateChild.kill).not.toHaveBeenCalled();
            expect(currentChild.kill).not.toHaveBeenCalled();
            // 現行世代の放送受信は late 世代の後始末で巻き添えにされない。
            if (!recorded) expect(currentLiveSource.destroyed).toBe(false);

            await consumer.stop();

            expect(stop).toHaveBeenCalledTimes(2);
            expect(stop.mock.calls[1][0]).toBe(currentHandle);
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it.each([
        ['live normal', false, false],
        ['recorded normal', true, false],
        ['live HLS', false, true],
        ['recorded HLS', true, true],
    ])(
        '[MP-INT-R6-START-GENERATION-%s] stops a late older handle without replacing the current handle',
        async (_, recorded, hls) => {
            vi.useFakeTimers();
            const lateChild = makeChild();
            const currentChild = makeChild();
            const lateHandle = Object.freeze({ generation: 'late' });
            const currentHandle = Object.freeze({ generation: 'current' });
            const lateStart = deferred<{ child: SyntheticChild; handle: object }>();
            const currentStart = deferred<{ child: SyntheticChild; handle: object }>();
            const manager = makeManager(lateChild);
            const create = hls ? manager.createHlsWriter : manager.createManaged;
            create.mockImplementationOnce(() => lateStart.promise).mockImplementationOnce(() => currentStart.promise);
            const currentLiveSource = makeSource();
            const created = recorded
                ? makeRecorded(manager, hls)
                : makeLive(manager, makeSource(), hls, [currentLiveSource]);
            const consumer = recorded ? created.recorded : created.live;
            if (!recorded) consumer.setOption({ channelId: 108, cmd: `${process.execPath} -e synthetic` }, 0);

            const stop = hls ? manager.stopHls : manager.requestStop;
            const lateStarting = consumer.start(15);
            await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());

            if (recorded) {
                // 録画配信 consumer は世代を並走させる。late 世代を採用しない判定は
                // `server-media-delivery` が所有する:
                //   test/server/media-delivery/hls-lifecycle.spec.test.ts:363 [PRIMARY R5.10]
                const currentStarting = consumer.start(16);
                await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
                currentStart.resolve({ child: currentChild, handle: currentHandle });
                await currentStarting;
                lateStart.resolve({ child: lateChild, handle: lateHandle });
                await expect(lateStarting).resolves.toBeUndefined();
            } else {
                // ライブ配信 consumer の start() は single-flight。世代の並走そのものが起きない:
                //   src/model/service/stream/base/LiveStreamBaseModel.ts:104-115
                //   test/server/media-delivery/media-delivery-tuner.integration.test.ts:163
                //     -> rejects.toThrow('StreamStartInProgress')
                //   test/server/media-delivery/live-delivery.test.ts:143 [MD-1.8]
                //     -> late handle を停止してから次世代を逐次で開始する
                await expect(consumer.start(16)).rejects.toThrow('StreamStartInProgress');
                expect(create).toHaveBeenCalledOnce();

                await consumer.stop();
                lateStart.resolve({ child: lateChild, handle: lateHandle });
                await expect(lateStarting).rejects.toThrow('StreamStartStopped');

                expect(stop).toHaveBeenCalledOnce();
                expect(stop.mock.calls[0][0]).toBe(lateHandle);

                const currentStarting = consumer.start(16);
                await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
                currentStart.resolve({ child: currentChild, handle: currentHandle });
                await currentStarting;
                expect(currentLiveSource.destroyed).toBe(false);
            }

            expect(stop).toHaveBeenCalledOnce();
            expect(stop.mock.calls[0][0]).toBe(lateHandle);
            expect(hls ? manager.requestStop : manager.stopHls).not.toHaveBeenCalled();
            expect(lateChild.kill).not.toHaveBeenCalled();
            expect(currentChild.kill).not.toHaveBeenCalled();

            await consumer.stop();

            expect(stop).toHaveBeenCalledTimes(2);
            expect(stop.mock.calls[1][0]).toBe(currentHandle);
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it.each([
        ['live normal', false, false],
        ['recorded normal', true, false],
        ['live HLS', false, true],
        ['recorded HLS', true, true],
    ])(
        '[MP-INT-R6-IMMEDIATE-%s] applies only the matching stop contract after immediate terminal',
        async (_, recorded, hls) => {
            vi.useFakeTimers();
            const child = makeChild();
            child.exitCode = 0;
            const manager = makeManager(child);
            const created = recorded ? makeRecorded(manager, hls) : makeLive(manager, makeSource(), hls);
            const consumer = recorded ? created.recorded : created.live;
            if (!recorded) consumer.setOption({ channelId: 106, cmd: `${process.execPath} -e synthetic` }, 0);

            await consumer.start(13);
            await consumer.stop();

            // 即時 terminal でも保存済み handle は保持され、停止契約は種別どおり一回だけ選ばれる。
            // 非 HLS 側の挙動は `server-media-delivery` が所有する:
            //   live     -> test/server/media-delivery/media-delivery-process.integration.test.ts:266 [MD-1.6]
            //               test/server/media-delivery/live-delivery.test.ts:105 [MD-1.6]
            //   recorded -> test/server/media-delivery/direct-stop.spec.test.ts:87 [MD-6.2]
            if (hls) {
                expect(manager.stopHls).toHaveBeenCalledOnce();
                expect(manager.stopHls.mock.calls[0][0]).toBe(manager.hlsHandle);
                expect(manager.requestStop).not.toHaveBeenCalled();
            } else {
                expect(manager.requestStop).toHaveBeenCalledOnce();
                expect(manager.requestStop.mock.calls[0][0]).toBe(manager.managedHandle);
                expect(manager.stopHls).not.toHaveBeenCalled();
            }
            expect(child.kill).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it.each([
        ['live', false],
        ['recorded', true],
    ])(
        '[MP-INT-R6-NORMAL-STOP-%s] delegates concurrent normal stop once with the exact opaque handle',
        async (_, recorded) => {
            vi.useFakeTimers();
            const child = makeChild();
            const manager = makeManager(child);
            const consumer = recorded ? makeRecorded(manager, false).recorded : makeLive(manager, makeSource()).live;
            if (!recorded) consumer.setOption({ channelId: 103, cmd: `${process.execPath} -e synthetic` }, 0);

            await consumer.start(9);
            await Promise.all([consumer.stop(), consumer.stop()]);

            expect(manager.requestStop).toHaveBeenCalledOnce();
            expect(manager.requestStop.mock.calls[0][0]).toBe(manager.managedHandle);
            expect(manager.stopHls).not.toHaveBeenCalled();
            expect(child.kill).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it.each([
        ['live', false],
        ['recorded', true],
    ])(
        '[MP-INT-R6-HLS-%s] retains the HLS group handle after direct terminal and delegates stop once',
        async (_, recorded) => {
            vi.useFakeTimers();
            const child = makeChild();
            const manager = makeManager(child);
            const created = recorded ? makeRecorded(manager, true) : makeLive(manager, makeSource(), true);
            const consumer = recorded ? created.recorded : created.live;
            const fileDeleter = created.fileDeleter;
            if (!recorded) consumer.setOption({ channelId: 104, cmd: `${process.execPath} -e synthetic` }, 0);

            await consumer.start(10);
            expect(manager.createHlsWriter).toHaveBeenCalledWith(expect.objectContaining({ priority: 1 }));
            expect(manager.createManaged).not.toHaveBeenCalled();
            expect(manager.create).not.toHaveBeenCalled();
            expect(manager.stopHls).not.toHaveBeenCalled();

            child.emit('exit', 0);
            if (!recorded) {
                // live は stop() 前に終了したので canSessionAdopt が true のまま
                // logStreamProcessExit に到達し、warn 側で記録される（1.6-1）。
                expect(logger.stream.warn.mock.calls.at(-1)?.[0]).toBe(
                    'encode process exited: code=0, signal=undefined',
                );
            }
            await Promise.all([consumer.stop(), consumer.stop()]);

            expect(manager.stopHls).toHaveBeenCalledOnce();
            expect(manager.stopHls.mock.calls[0][0]).toBe(manager.hlsHandle);
            expect(manager.requestStop).not.toHaveBeenCalled();
            expect(child.kill).not.toHaveBeenCalled();
            expect(fileDeleter.deleteAllFiles).toHaveBeenCalled();
            expect(manager.stopHls.mock.invocationCallOrder[0]).toBeLessThan(
                fileDeleter.deleteAllFiles.mock.invocationCallOrder.at(-1)!,
            );
            expect(vi.getTimerCount()).toBe(0);
        },
    );
});

const managedOption = (priority: number, cmd = process.execPath) => ({
    cmd,
    input: null as null,
    output: null as null,
    priority,
});

const makeActualManager = (maximum: number): ManagedProcessManager =>
    new EncodeProcessManageModel(
        { getLogger: () => ({ encode: { error: vi.fn(), info: vi.fn() } }) },
        { getConfig: () => ({ encodeProcessNum: maximum }) },
    );

const registryOf = (manager: ManagedProcessManager): unknown[] => (manager as unknown as { childs: unknown[] }).childs;

const rawProcessGroupAlive = (pgid: number): boolean => {
    try {
        process.kill(-pgid, 0);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
        throw error;
    }
};

const linuxPgid = (pid: number): number => {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fieldsAfterName = stat
        .slice(stat.lastIndexOf(') ') + 2)
        .trim()
        .split(/\s+/u);
    return Number(fieldsAfterName[2]);
};

const waitFor = async (condition: () => boolean, timeout = 3000): Promise<void> => {
    const deadline = Date.now() + timeout;
    while (!condition()) {
        if (Date.now() >= deadline) throw new Error('Synthetic process-group condition timed out');
        // Poll interval for the real condition checked above; not a fixed wait-then-assume delay.
        await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
};

const readPublishedPositivePid = async (reportPath: string): Promise<number> => {
    let publishedPid = 0;
    await waitFor(() => {
        try {
            const report = readFileSync(reportPath, 'utf8');
            if (!/^[1-9]\d*$/u.test(report)) return false;
            const candidate = Number(report);
            if (!Number.isSafeInteger(candidate)) return false;
            publishedPid = candidate;
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
            throw error;
        }
    });
    return publishedPid;
};

const makeLinuxGroupScript = (
    mode: 'interrupt' | 'kill' | 'direct-exit' | 'unconfirmed' | 'escaped',
    holdPidPublicationUntilRelease = false,
) => {
    const root = mkdtempSync(join(tmpdir(), 'epgstation-process-group-'));
    temporaryDirectories.push(root);
    const scriptPath = join(root, 'writer.cjs');
    const reportPath = join(root, 'descendant.pid');
    const publicationPath = `${reportPath}.publishing`;
    const readyPublicationPath = `${reportPath}.ready.publishing`;
    const readyPath = `${reportPath}.ready`;
    const releasePath = `${reportPath}.release`;
    const descendantIgnoresInterrupt = mode === 'kill' || mode === 'unconfirmed';
    writeFileSync(
        scriptPath,
        [
            "const { spawn } = require('node:child_process');",
            // This script is written to a `.cjs` file so it always runs as CommonJS regardless of
            // the parent project's `"type": "module"`, so it must use `require`, not a static
            // `import` -- a static `import` here is a SyntaxError under CommonJS and makes the
            // spawned writer process exit before it ever spawns its descendant or publishes a PID
            // (see the analogous, already-fixed note in
            // `test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts`'s
            // `[TM-2.14] passes a synthetic parent marker to the actual child process`).
            "const fs = require('node:fs');",
            `const childSource = ${JSON.stringify(
                `${descendantIgnoresInterrupt ? "process.on('SIGINT', () => {});" : ''}setInterval(() => {}, 1000);`,
            )};`,
            `const child = spawn(process.execPath, ['-e', childSource], { stdio: 'ignore'${
                mode === 'escaped' ? ', detached: true' : ''
            } });`,
            `fs.writeFileSync(${JSON.stringify(publicationPath)}, String(child.pid));`,
            ...(holdPidPublicationUntilRelease
                ? [
                      'const publishPidWhenReleased = () => {',
                      '    try {',
                      `        fs.accessSync(${JSON.stringify(releasePath)});`,
                      '    } catch (error) {',
                      "        if (error.code !== 'ENOENT') throw error;",
                      '        setTimeout(publishPidWhenReleased, 10);',
                      '        return;',
                      '    }',
                      `    fs.renameSync(${JSON.stringify(publicationPath)}, ${JSON.stringify(reportPath)});`,
                      `    fs.rmSync(${JSON.stringify(readyPath)});`,
                      `    fs.rmSync(${JSON.stringify(releasePath)});`,
                      '};',
                      'publishPidWhenReleased();',
                      `fs.writeFileSync(${JSON.stringify(readyPublicationPath)}, String(child.pid));`,
                      `fs.renameSync(${JSON.stringify(readyPublicationPath)}, ${JSON.stringify(readyPath)});`,
                  ]
                : [`fs.renameSync(${JSON.stringify(publicationPath)}, ${JSON.stringify(reportPath)});`]),
            ...(mode === 'kill' || mode === 'unconfirmed' ? ["process.on('SIGINT', () => {});"] : []),
            ...(mode === 'direct-exit' ? ['setTimeout(() => process.exit(0), 25);'] : []),
            'setInterval(() => {}, 1000);',
        ].join('\n'),
    );
    return { publicationPath, readyPath, readyPublicationPath, releasePath, reportPath, root, scriptPath };
};

describe('media process manager coordination integration', () => {
    // 全 case の前後で、test を実行している親 process の group へ signal を送っていないことを確かめる。
    let parentGroup: number | null = null;
    let processKill: ReturnType<typeof vi.spyOn> | null = null;

    beforeEach(() => {
        parentGroup = process.platform === 'linux' ? linuxPgid(process.pid) : null;
        processKill = vi.spyOn(process, 'kill');
    });

    afterEach(() => {
        const spy = processKill;
        processKill = null;
        if (spy === null || parentGroup === null) return;
        const parentTargets = new Set<number>([0, -1, process.pid, parentGroup, -parentGroup]);
        const toParent = spy.mock.calls.filter(([pid]) => parentTargets.has(pid as number));
        expect(toParent).toEqual([]);
        expect(linuxPgid(process.pid)).toBe(parentGroup);
    });

    it('[MP-INT-R3-EXACT-DEADLINE] starts one replacement from the compiled manager after exact-deadline HLS release', async () => {
        vi.useFakeTimers();
        const manager = makeActualManager(1);
        const writer = makeChild();
        const replacementChild = makeChild();
        const spawnProcess = vi
            .spyOn(manager as unknown as { spawnProcess(): SyntheticChild }, 'spawnProcess')
            .mockReturnValueOnce(writer)
            .mockImplementationOnce(() => {
                queueMicrotask(() => replacementChild.emit('spawn'));
                return replacementChild;
            });
        const starting = manager.createHlsWriter(managedOption(1));
        writer.emit('spawn');
        await starting;
        const alive = vi.spyOn(processUtil, 'isProcessGroupAlive');
        for (const value of [true, true, true, false]) alive.mockReturnValueOnce(value);
        const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});

        const replacement = manager.createManaged(managedOption(10));
        const replacementOutcome = Promise.allSettled([replacement]);
        await vi.advanceTimersByTimeAsync(3000);

        const [outcome] = await replacementOutcome;
        expect(outcome.status).toBe('fulfilled');
        if (outcome.status === 'rejected') throw outcome.reason;
        expect(outcome.value).toMatchObject({ child: replacementChild });
        expect(alive.mock.results.map(result => result.value)).toEqual([true, true, true, false]);
        expect(signal.mock.calls).toEqual([[42, 'SIGINT']]);
        expect(spawnProcess).toHaveBeenCalledTimes(2);
        expect(registryOf(manager)).toHaveLength(1);
        expect((registryOf(manager)[0] as { child: SyntheticChild }).child).toBe(replacementChild);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MP-INT-R3-AFTER-DEADLINE] rejects a compiled-manager release confirmed at 3001ms before the deadline immediate', async () => {
        vi.useFakeTimers();
        let deadlineCheck: (() => void) | undefined;
        const deadlineCheckHandle = {} as NodeJS.Immediate;
        vi.spyOn(globalThis, 'setImmediate').mockImplementation(((
            callback: (...args: any[]) => void,
            ...args: any[]
        ) => {
            deadlineCheck = () => callback(...args);
            return deadlineCheckHandle;
        }) as typeof setImmediate);
        const clearDeadlineCheck = vi.spyOn(globalThis, 'clearImmediate').mockImplementation(() => {});
        const manager = makeActualManager(1);
        const playback = makeChild();
        const replacementChild = makeChild();
        const spawnProcess = vi
            .spyOn(manager as unknown as { spawnProcess(): SyntheticChild }, 'spawnProcess')
            .mockReturnValueOnce(playback)
            .mockImplementationOnce(() => {
                queueMicrotask(() => replacementChild.emit('spawn'));
                return replacementChild;
            });
        const starting = manager.createManaged(managedOption(1));
        playback.emit('spawn');
        await starting;
        vi.spyOn(processUtil, 'kill').mockResolvedValue(undefined);

        const replacement = manager.createManaged(managedOption(10));
        setTimeout(() => playback.emit('exit', 0), 3001);
        const outcome = Promise.allSettled([replacement]);

        await vi.advanceTimersByTimeAsync(3000);
        expect(deadlineCheck).toBeTypeOf('function');
        await vi.advanceTimersByTimeAsync(1);
        deadlineCheck?.();

        await expect(outcome).resolves.toEqual([
            expect.objectContaining({
                reason: expect.objectContaining({ message: 'EncodeProcessManageModelTimeoutError' }),
                status: 'rejected',
            }),
        ]);
        expect(spawnProcess).toHaveBeenCalledOnce();
        expect(registryOf(manager)).toEqual([]);
        expect(clearDeadlineCheck).toHaveBeenCalledOnce();
        expect(clearDeadlineCheck).toHaveBeenCalledWith(deadlineCheckHandle);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MP-INT-R7-RACE] keeps timeout, explicit stop, terminal, and late error bound to one normal generation', async () => {
        vi.useFakeTimers();
        const manager = makeActualManager(1);
        const playback = makeChild();
        const spawnProcess = vi
            .spyOn(manager as unknown as { spawnProcess(): SyntheticChild }, 'spawnProcess')
            .mockReturnValue(playback);
        const starting = manager.createManaged(managedOption(1));
        playback.emit('spawn');
        const started = await starting;
        vi.spyOn(processUtil, 'kill').mockResolvedValue(undefined);

        const replacement = manager.createManaged(managedOption(10));
        const replacementOutcome = expect(replacement).rejects.toThrow('EncodeProcessManageModelTimeoutError');
        const explicitStop = manager.requestStop(started.handle);
        const processInfo = registryOf(manager)[0] as { stopRequestOperation: Promise<unknown>; state: string };
        expect(explicitStop).toBe(processInfo.stopRequestOperation);
        await expect(manager.createManaged(managedOption(10))).rejects.toThrow('EncodeProcessManageModelCreateError');

        await vi.advanceTimersByTimeAsync(3000);
        await vi.advanceTimersToNextTimerAsync();
        await replacementOutcome;
        expect(processInfo.state).toBe('stopping');
        expect(spawnProcess).toHaveBeenCalledOnce();

        playback.emit('exit', 0);
        expect(() => playback.emit('error', new Error('synthetic late diagnostic'))).not.toThrow();
        playback.emit('close', 0);
        playback.emit('exit', 0);
        await Promise.resolve();

        expect(registryOf(manager)).toEqual([]);
        expect(spawnProcess).toHaveBeenCalledOnce();
        expect(playback.kill).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MP-INT-R7-PID-VALIDATION] rejects invalid report bytes before returning one validated positive PID', async () => {
        const invalidReports = [
            ['empty', ''],
            ['zero', '0'],
            ['negative', '-1'],
            ['leading-zero', '01'],
            ['nondecimal', '1e3'],
            ['unsafe-integer', String(Number.MAX_SAFE_INTEGER + 1)],
        ] as const;

        for (const [label, invalidReport] of invalidReports) {
            const root = mkdtempSync(join(tmpdir(), `epgstation-pid-validation-${label}-`));
            temporaryDirectories.push(root);
            const reportPath = join(root, 'descendant.pid');
            writeFileSync(reportPath, invalidReport);
            let settled = false;
            const published = readPublishedPositivePid(reportPath).then(value => {
                settled = true;
                return value;
            });

            // Intentional negative observation window: readPublishedPositivePid() polls every
            // 10ms (see waitFor above), so 25ms lets at least one poll happen while the report
            // file still holds an invalid value, confirming it is not accepted before we make
            // it valid below.
            await new Promise<void>(resolve => setTimeout(resolve, 25));
            expect(settled, `${label} report must not be accepted`).toBe(false);

            writeFileSync(reportPath, String(process.pid));
            const publishedPid = await published;
            writeFileSync(reportPath, '0');
            expect(publishedPid, `${label} must return the value from the validated read`).toBe(process.pid);
        }
    });

    it('[MP-INT-R7-PID-READ-ERROR] rethrows a non-ENOENT report failure without waiting for the deadline', async () => {
        const reportDirectory = mkdtempSync(join(tmpdir(), 'epgstation-pid-read-error-'));
        temporaryDirectories.push(reportDirectory);
        const startedAt = Date.now();

        await expect(readPublishedPositivePid(reportDirectory)).rejects.toMatchObject({ code: 'EISDIR' });
        expect(Date.now() - startedAt).toBeLessThan(1000);
    });

    it('[MP-INT-R7-PID-PUBLICATION] waits for a complete positive descendant PID publication', async context => {
        context.skip(process.platform !== 'linux', 'Linux process group contract');
        const manager = makeActualManager(1);
        const fixture = makeLinuxGroupScript('interrupt', true);
        const started = await manager.createHlsWriter(managedOption(1, `${process.execPath} ${fixture.scriptPath}`));
        const pgid = started.child.pid;
        isolatedProcessGroups.add(pgid);
        const childClosed = new Promise<void>(resolve => started.child.once('close', () => resolve()));
        const descendantPid = await readPublishedPositivePid(fixture.readyPath);
        let stagedPid: number;
        try {
            stagedPid = await readPublishedPositivePid(fixture.publicationPath);
        } catch (publicationError) {
            let prematureFinalPid: string;
            try {
                prematureFinalPid = readFileSync(fixture.reportPath, 'utf8');
            } catch (finalError) {
                if ((finalError as NodeJS.ErrnoException).code === 'ENOENT') throw publicationError;
                throw finalError;
            }
            throw new Error(`Final PID ${prematureFinalPid} published before parent release`);
        }

        expect(stagedPid).toBe(descendantPid);
        expect(() => readFileSync(fixture.reportPath, 'utf8')).toThrow(expect.objectContaining({ code: 'ENOENT' }));
        writeFileSync(fixture.releasePath, String(descendantPid));
        const finalPid = await readPublishedPositivePid(fixture.reportPath);

        expect(finalPid).toBe(stagedPid);
        expect(Number.isSafeInteger(descendantPid) && descendantPid > 0).toBe(true);
        expect(linuxPgid(descendantPid)).toBe(pgid);
        await waitFor(() =>
            [fixture.publicationPath, fixture.readyPublicationPath, fixture.readyPath, fixture.releasePath].every(
                path => {
                    try {
                        readFileSync(path, 'utf8');
                        return false;
                    } catch (error) {
                        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
                        throw error;
                    }
                },
            ),
        );
        for (const path of [
            fixture.publicationPath,
            fixture.readyPublicationPath,
            fixture.readyPath,
            fixture.releasePath,
        ]) {
            expect(() => readFileSync(path, 'utf8')).toThrow(expect.objectContaining({ code: 'ENOENT' }));
        }

        await expect(manager.stopHls(started.handle)).resolves.toEqual({
            exitConfirmed: true,
            sentSignals: ['SIGINT'],
            slotReleased: true,
        });
        await waitFor(() => !rawProcessGroupAlive(pgid));
        await childClosed;
        expect(registryOf(manager)).toEqual([]);
        isolatedProcessGroups.delete(pgid);
        expect(isolatedProcessGroups).toHaveLength(0);
        expect(resources).toHaveLength(0);
        rmSync(fixture.root, { force: true, recursive: true });
        const temporaryDirectoryIndex = temporaryDirectories.indexOf(fixture.root);
        expect(temporaryDirectoryIndex).toBeGreaterThanOrEqual(0);
        temporaryDirectories.splice(temporaryDirectoryIndex, 1);
        expect(temporaryDirectories).toHaveLength(0);
    }, 12_000);

    for (const [mode, expectedSignals, exitConfirmed] of [
        ['interrupt', ['SIGINT'], true],
        ['kill', ['SIGINT', 'SIGKILL'], true],
        ['direct-exit', ['SIGINT'], true],
        ['unconfirmed', ['SIGINT', 'SIGKILL'], false],
    ] as const) {
        it(`[MP-INT-R7-LINUX-${mode}] isolates a real writer group and releases it through the approved signal stages`, async context => {
            context.skip(process.platform !== 'linux', 'Linux process group contract');
            const manager = makeActualManager(1);
            const fixture = makeLinuxGroupScript(mode);
            const started = await manager.createHlsWriter(
                managedOption(1, `${process.execPath} ${fixture.scriptPath}`),
            );
            const pgid = started.child.pid;
            isolatedProcessGroups.add(pgid);
            const descendantPid = await readPublishedPositivePid(fixture.reportPath);

            expect(linuxPgid(pgid)).toBe(pgid);
            expect(linuxPgid(descendantPid)).toBe(pgid);
            expect(pgid).not.toBe(linuxPgid(process.pid));

            if (mode === 'direct-exit') {
                await new Promise<void>(resolve => started.child.once('exit', () => resolve()));
                await Promise.resolve();
                expect(registryOf(manager)).toHaveLength(1);
                expect(rawProcessGroupAlive(pgid)).toBe(true);
            }
            if (mode === 'unconfirmed') {
                vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValue(true);
            }

            const stopped = await manager.stopHls(started.handle);
            expect(stopped).toEqual({ exitConfirmed, sentSignals: expectedSignals, slotReleased: true });
            expect(registryOf(manager)).toEqual([]);
            await waitFor(() => !rawProcessGroupAlive(pgid));
            isolatedProcessGroups.delete(pgid);
        }, 12_000);
    }

    it('[MP-INT-R7-LINUX-ESCAPED] does not claim that a descendant in another process group was stopped', async context => {
        context.skip(process.platform !== 'linux', 'Linux process group contract');
        const manager = makeActualManager(1);
        const fixture = makeLinuxGroupScript('escaped');
        const started = await manager.createHlsWriter(managedOption(1, `${process.execPath} ${fixture.scriptPath}`));
        const writerPgid = started.child.pid;
        isolatedProcessGroups.add(writerPgid);
        const escapedPid = await readPublishedPositivePid(fixture.reportPath);
        isolatedProcessGroups.add(escapedPid);
        expect(linuxPgid(escapedPid)).toBe(escapedPid);
        expect(escapedPid).not.toBe(writerPgid);

        await expect(manager.stopHls(started.handle)).resolves.toEqual({
            exitConfirmed: true,
            sentSignals: ['SIGINT'],
            slotReleased: true,
        });
        expect(registryOf(manager)).toEqual([]);
        await waitFor(() => !rawProcessGroupAlive(writerPgid));
        isolatedProcessGroups.delete(writerPgid);
        expect(rawProcessGroupAlive(escapedPid)).toBe(true);

        process.kill(-escapedPid, 'SIGKILL');
        await waitFor(() => !rawProcessGroupAlive(escapedPid));
        isolatedProcessGroups.delete(escapedPid);
    }, 12_000);

    it('[MP-INT-R7-LINUX-START-FAILURE] rejects an actual group spawn failure without retaining a slot', async context => {
        context.skip(process.platform !== 'linux', 'Linux process group contract');
        const manager = makeActualManager(1);
        const root = mkdtempSync(join(tmpdir(), 'epgstation-process-group-failure-'));
        temporaryDirectories.push(root);
        const nonExecutable = join(root, 'writer');
        writeFileSync(nonExecutable, '#!/bin/sh\nexit 0\n');

        await expect(manager.createHlsWriter(managedOption(1, nonExecutable))).rejects.toMatchObject({
            code: 'EACCES',
        });
        expect(registryOf(manager)).toEqual([]);
    });
});
