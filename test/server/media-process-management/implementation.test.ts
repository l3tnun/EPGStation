import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerOverrides } from '../harness/child-module-overrides.mjs';

// The repeated advanceTimersByTimeAsync(500) calls below exercise ProcessUtil.kill's default
// SIGINT-then-resolve grace (src/util/ProcessUtil.ts:33, `wait = 500`), which is byte-identical
// to v2 5cf2ea383 src/util/ProcessUtil.ts:11.
const processStubs = vi.hoisted(() => ({ spawn: vi.fn() }));

interface SyntheticChild extends EventEmitter {
    exitCode: number | null;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
    signalCode: NodeJS.Signals | null;
    stderr: PassThrough | null;
    stdin: PassThrough | null;
    stdout: PassThrough | null;
}

interface EncoderRuntime {
    cancel(): Promise<void>;
    setOnFinish(callback: () => void): void;
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

interface EncoderConstructor {
    new (...dependencies: unknown[]): EncoderRuntime;
}

interface ProcessManager {
    create(option: {
        input: string | null;
        output: string | null;
        cmd: string;
        priority: number;
    }): Promise<SyntheticChild>;
    createManaged(option: {
        input: string | null;
        output: string | null;
        cmd: string;
        priority: number;
    }): Promise<{ child: SyntheticChild; handle: object }>;
    createHlsWriter(option: {
        input: string | null;
        output: string | null;
        cmd: string;
        priority: number;
        spawnOption?: Record<string, unknown>;
    }): Promise<{ child: SyntheticChild; handle: { kind: 'hls-writer' } }>;
    requestStop(
        handle: object,
    ): Promise<{ sentSignals: ['SIGINT']; status: 'requested' } | { sentSignals: []; status: 'already-released' }>;
    stopHls(handle: object): Promise<{
        exitConfirmed: boolean;
        sentSignals: Array<'SIGINT' | 'SIGKILL'>;
        slotReleased: true;
    }>;
}

interface ProcessManagerConstructor {
    new (
        logger: { getLogger(): unknown },
        configuration: { getConfig(): { encodeProcessNum: number } },
    ): ProcessManager;
    readonly prototype: object;
}

/**
 * Redirects `EncodeProcessManageModel.js`'s `import { spawn } from 'child_process'` to `processStubs.spawn`.
 *
 * The compiled server is ES modules, and Node snapshots a builtin's named exports the first time
 * anything imports it as ESM: mutating a CJS `require('child_process').spawn` after that snapshot
 * does not reach `EncodeProcessManageModel.js`'s own `spawn` binding, which was closed over at that first import. A loader hook registered with `module.registerHooks()` sits
 * below both `require()` and `import()` -- including Node's `require(esm)` used below -- and lets the
 * specifier itself resolve to a shim, so it works regardless of how the module is first loaded. This
 * reuses the shared hook module the harness already spawns child processes with
 * (`test/server/harness/child-module-overrides.mjs`; read-only here, other tests depend on it) by
 * calling its `registerOverrides` in this same process, scoped via `parentURL` to just this compiled
 * module so no other module's `child_process`/`node:child_process` import is affected. See
 * `test/server/service-interface/integration/fs-create-read-stream-hook.ts` for the established sibling
 * of this exact pattern (there for `fs.createReadStream`).
 *
 * Registration must happen before `EncodeProcessManageModel.js` is loaded anywhere in this process, so
 * it runs ahead of the `require()` below, at this file's own module-evaluation time.
 */
declare global {
    var __epgstationTestSpawn: typeof processStubs.spawn | undefined;
}
globalThis.__epgstationTestSpawn = processStubs.spawn;

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const encodeProcessManageModelPath = join(
    compiledSnapshot,
    'model',
    'service',
    'encode',
    'EncodeProcessManageModel.js',
);
const encodeProcessManageModuleUrl = pathToFileURL(encodeProcessManageModelPath).href;
const spawnShimSource = [
    "import * as realChildProcess from 'node:child_process';",
    'const delegate = (...args) => (globalThis.__epgstationTestSpawn ?? realChildProcess.spawn)(...args);',
    "export * from 'node:child_process';",
    'export const spawn = delegate;',
    'export default { ...realChildProcess, spawn: delegate };',
].join('\n');
registerOverrides([
    { parentURL: encodeProcessManageModuleUrl, specifier: 'child_process', source: spawnShimSource },
    { parentURL: encodeProcessManageModuleUrl, specifier: 'node:child_process', source: spawnShimSource },
]);

const ProcessManager = (
    require(encodeProcessManageModelPath) as {
        default: ProcessManagerConstructor;
    }
).default;
const EncoderModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncoderModel.js')) as {
        default: EncoderConstructor;
    }
).default;
const managerInterface = require(join(compiledSnapshot, 'model', 'service', 'encode', 'IEncodeProcessManageModel.js'));
const processUtil = (
    require(join(compiledSnapshot, 'util', 'ProcessUtil.js')) as {
        default: {
            isProcessGroupAlive(pgid: number): boolean;
            killProcessGroup(pgid: number, signal: NodeJS.Signals): void;
            wait(milliseconds: number): Promise<void>;
        };
    }
).default;

const children: SyntheticChild[] = [];
const temporaryDirectories: string[] = [];
const executedImplementationCaseIds = new Set<string>();
const logger = { encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
const option = { input: null, output: null, cmd: process.execPath, priority: 1 };
const registryOf = (manager: ProcessManager): unknown[] => (manager as unknown as { childs: unknown[] }).childs;

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
    children.push(child);
    return child;
};

const makeManager = (configuration: { encodeProcessNum: number }): ProcessManager =>
    new ProcessManager({ getLogger: () => logger }, { getConfig: () => configuration });

const spawnManaged = (child = makeChild()): SyntheticChild => {
    processStubs.spawn.mockImplementationOnce(() => {
        queueMicrotask(() => child.emit('spawn'));
        return child;
    });
    return child;
};

const makeEncoder = (manager: ProcessManager): EncoderRuntime => {
    const root = mkdtempSync(join(tmpdir(), 'epgstation-media-process-imp-'));
    temporaryDirectories.push(root);
    const inputPath = join(root, 'input.ts');
    writeFileSync(inputPath, 'synthetic input');
    const encoder = new EncoderModel(
        { getLogger: () => logger },
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
    return encoder;
};

const exerciseEncoderStopSeam = async (reason: 'cancel' | 'deadline'): Promise<void> => {
    vi.useFakeTimers();
    const manager = makeManager({ encodeProcessNum: 1 });
    const child = spawnManaged();
    const encoder = makeEncoder(manager);
    const requestStop = vi.spyOn(manager, 'requestStop');
    let finish: () => void = () => {};
    const finished = new Promise<void>(resolve => {
        finish = resolve;
    });
    encoder.setOnFinish(finish);

    await encoder.start();
    const processInfo = registryOf(manager)[0] as {
        handle: object;
        slotReleasedResolve: () => void;
        state: string;
        stopRequestOperation?: Promise<unknown>;
    };
    const originalRelease = processInfo.slotReleasedResolve;
    const releaseResolution = vi.fn(() => originalRelease());
    processInfo.slotReleasedResolve = releaseResolution;

    let consumerStops: Promise<unknown>;
    let sharedConsumerOperation: Promise<unknown> | null;
    if (reason === 'cancel') {
        const first = encoder.cancel();
        sharedConsumerOperation = (encoder as unknown as { stopRequestOperation: Promise<unknown> | null })
            .stopRequestOperation;
        const duplicate = encoder.cancel();
        expect((encoder as unknown as { stopRequestOperation: Promise<unknown> | null }).stopRequestOperation).toBe(
            sharedConsumerOperation,
        );
        consumerStops = Promise.all([first, duplicate]);
    } else {
        await vi.advanceTimersByTimeAsync(1000);
        sharedConsumerOperation = (encoder as unknown as { stopRequestOperation: Promise<unknown> | null })
            .stopRequestOperation;
        const explicitJoin = encoder.cancel();
        expect((encoder as unknown as { stopRequestOperation: Promise<unknown> | null }).stopRequestOperation).toBe(
            sharedConsumerOperation,
        );
        consumerStops = explicitJoin;
    }
    expect(sharedConsumerOperation).toBeInstanceOf(Promise);
    await Promise.resolve();

    expect(requestStop).toHaveBeenCalledOnce();
    expect(requestStop).toHaveBeenCalledWith(processInfo.handle);
    expect(requestStop.mock.results[0].value).toBe(processInfo.stopRequestOperation);
    expect(processInfo.state).toBe('stopping');
    expect(registryOf(manager)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(500);
    await consumerStops;
    expect(child.kill.mock.calls).toEqual([['SIGINT']]);
    expect(requestStop).toHaveBeenCalledOnce();
    expect(releaseResolution).not.toHaveBeenCalled();

    child.signalCode = 'SIGINT';
    child.emit('exit', null, 'SIGINT');
    await finished;

    expect(releaseResolution).toHaveBeenCalledOnce();
    expect(registryOf(manager)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
};

beforeEach(context => {
    const match = /^\[['"]?(MP-IMP-[A-Za-z0-9-]+)['"]?\]/u.exec(context.task.name);
    if (match !== null) executedImplementationCaseIds.add(match[1]);
});

afterEach(() => {
    for (const child of children.splice(0)) {
        child.removeAllListeners();
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
    }
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    processStubs.spawn.mockReset();
    logger.encode.error.mockClear();
    logger.encode.info.mockClear();
    logger.encode.debug.mockClear();
    logger.encode.warn.mockClear();
});

describe('media process management implementation characterization', () => {
    it('[MP-IMP-R8-CAPACITY] classifies maximum zero, one free slot, and one occupied slot', async () => {
        const disabled = makeManager({ encodeProcessNum: 0 });
        await expect(disabled.createManaged(option)).rejects.toThrow('EncodeProcessManageModelCreateError');
        expect(processStubs.spawn).not.toHaveBeenCalled();
        expect(registryOf(disabled)).toEqual([]);

        const enabled = makeManager({ encodeProcessNum: 1 });
        const child = spawnManaged();
        await expect(enabled.createManaged(option)).resolves.toMatchObject({ child });
        await expect(enabled.createManaged(option)).rejects.toThrow('EncodeProcessManageModelCreateError');

        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect((enabled as unknown as { occupiedSlotCount(): number }).occupiedSlotCount()).toBe(1);
        expect(registryOf(enabled)).toHaveLength(1);
    });

    it.each([
        {
            expectedArguments: ['%INPUT%', '%OUTPUT%'],
            id: 'MP-IMP-R8-IO-NULL',
            input: null,
            label: 'null',
            output: null,
        },
        {
            expectedArguments: ['', ''],
            id: 'MP-IMP-R8-IO-EMPTY',
            input: '',
            label: 'empty string',
            output: '',
        },
        {
            expectedArguments: ['synthetic-input', 'synthetic-output'],
            id: 'MP-IMP-R8-IO-NORMAL',
            input: 'synthetic-input',
            label: 'normal string',
            output: 'synthetic-output',
        },
    ] as const)('[$id] applies $label input and output with exact spawn arguments', async testCase => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = spawnManaged();

        await manager.createManaged({
            cmd: `${process.execPath} %INPUT% %OUTPUT%`,
            input: testCase.input,
            output: testCase.output,
            priority: 1,
        });

        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(processStubs.spawn).toHaveBeenCalledWith(process.execPath, [...testCase.expectedArguments]);
        expect(registryOf(manager)).toEqual([expect.objectContaining({ child })]);
    });

    it('[MP-IMP-R8-PRIORITY] classifies lower, same, and higher priority branches with exact target identity', async () => {
        vi.useFakeTimers();
        const replacing = makeManager({ encodeProcessNum: 3 });
        const oldest = spawnManaged();
        vi.setSystemTime(1);
        await replacing.createManaged({ ...option, priority: 0 });
        const middle = spawnManaged();
        vi.setSystemTime(2);
        await replacing.createManaged(option);
        const newest = spawnManaged();
        vi.setSystemTime(3);
        await replacing.createManaged(option);

        const replacement = replacing.createManaged({ ...option, priority: 10 });
        await vi.advanceTimersByTimeAsync(500);
        expect(newest.kill).toHaveBeenCalledOnce();
        expect(middle.kill).not.toHaveBeenCalled();
        expect(oldest.kill).not.toHaveBeenCalled();
        const replacementChild = spawnManaged();
        newest.emit('exit', 0);
        await expect(replacement).resolves.toMatchObject({ child: replacementChild });

        const same = makeManager({ encodeProcessNum: 1 });
        const samePriority = spawnManaged();
        await same.createManaged({ ...option, priority: 10 });
        await expect(same.createManaged({ ...option, priority: 10 })).rejects.toThrow(
            'EncodeProcessManageModelCreateError',
        );
        expect(samePriority.kill).not.toHaveBeenCalled();

        const higher = makeManager({ encodeProcessNum: 1 });
        const higherPriority = spawnManaged();
        await higher.createManaged({ ...option, priority: 11 });
        await expect(higher.createManaged({ ...option, priority: 10 })).rejects.toThrow(
            'EncodeProcessManageModelCreateError',
        );
        expect(higherPriority.kill).not.toHaveBeenCalled();
    });

    it('[MP-IMP-R8-POST-SPAWN-ERROR] retains a started child after error alone until terminal confirmation', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = spawnManaged();
        await manager.createManaged(option);
        const diagnostic = new Error('synthetic post-spawn diagnostic');

        child.emit('error', diagnostic);

        expect(logger.encode.error).toHaveBeenCalledWith(diagnostic);
        expect(registryOf(manager)).toHaveLength(1);
        await expect(manager.createManaged(option)).rejects.toThrow('EncodeProcessManageModelCreateError');

        child.emit('close', 1, null);
        expect(registryOf(manager)).toEqual([]);
        const later = spawnManaged();
        await expect(manager.createManaged(option)).resolves.toMatchObject({ child: later });
    });

    it('[MP-IMP-R8-SPAWN-TERMINAL-RACE] releases once when spawn and terminal arrive in the same microtask', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = makeChild();
        processStubs.spawn.mockImplementationOnce(() => {
            queueMicrotask(() => {
                child.emit('spawn');
                child.emit('exit', 1);
                child.emit('close', 1, null);
            });
            return child;
        });

        await expect(manager.createManaged(option)).resolves.toMatchObject({ child });
        await Promise.resolve();

        expect(registryOf(manager)).toEqual([]);
        expect(child.eventNames()).toEqual([]);
    });

    it('[MP-IMP-R1-IDENTITY] isolates distinct handles when the clock and numeric PID are reused', async () => {
        vi.setSystemTime(1);
        const manager = makeManager({ encodeProcessNum: 1 });
        const firstChild = spawnManaged();
        const first = await manager.createManaged(option);
        expect(firstChild.listenerCount('spawn')).toBe(0);
        firstChild.emit('exit', 0);

        const secondChild = spawnManaged();
        const second = await manager.createManaged(option);
        firstChild.emit('close', 0, null);

        expect(first.handle).not.toBe(second.handle);
        expect(firstChild.pid).toBe(secondChild.pid);
        expect(registryOf(manager)).toHaveLength(1);
        expect((registryOf(manager)[0] as { child: SyntheticChild }).child).toBe(secondChild);
    });

    it('[MP-IMP-R1-REENTRANT] counts a reservation during synchronous spawn re-entry', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = makeChild();
        let reentrant: Promise<unknown> | undefined;
        processStubs.spawn.mockImplementationOnce(() => {
            reentrant = manager.createManaged(option);
            queueMicrotask(() => child.emit('spawn'));
            return child;
        });

        await expect(manager.createManaged(option)).resolves.toMatchObject({ child });
        await expect(reentrant).rejects.toThrow('EncodeProcessManageModelCreateError');
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(registryOf(manager)).toHaveLength(1);
    });

    it('[MP-IMP-R1-LEGACY-STARTING] returns the compatible child while lifecycle stays starting until spawn', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = makeChild();
        processStubs.spawn.mockReturnValueOnce(child);

        await expect(manager.create(option)).resolves.toBe(child);

        expect((registryOf(manager)[0] as { state: string }).state).toBe('starting');
        expect(child.listenerCount('spawn')).toBe(1);
        child.emit('spawn');
        expect((registryOf(manager)[0] as { state: string }).state).toBe('running');
        expect(child.listenerCount('spawn')).toBe(0);
    });

    it('[MP-IMP-R1-LEGACY-PRE-START-ERROR] releases an early-returned child and ignores its later close', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const failed = makeChild();
        processStubs.spawn.mockReturnValueOnce(failed);
        await expect(manager.create(option)).resolves.toBe(failed);

        failed.emit('error', new Error('synthetic pre-start failure'));
        expect(registryOf(manager)).toEqual([]);
        expect(failed.eventNames()).toEqual([]);

        const later = spawnManaged();
        await expect(manager.create(option)).resolves.toBe(later);
        failed.emit('close', 1, null);
        expect(registryOf(manager)).toHaveLength(1);
        expect((registryOf(manager)[0] as { child: SyntheticChild }).child).toBe(later);
    });

    it('[MP-IMP-R1-OPTIONS] applies nullable replacements and forwards an explicit spawn option', async () => {
        const manager = makeManager({ encodeProcessNum: 2 });
        const replaced = spawnManaged();
        const spawnOption = { cwd: process.cwd() };
        await manager.createManaged({
            cmd: `${process.execPath} %INPUT% %OUTPUT%`,
            input: 'synthetic-input',
            output: 'synthetic-output',
            priority: 1,
            spawnOption,
        });
        expect(processStubs.spawn).toHaveBeenLastCalledWith(
            process.execPath,
            ['synthetic-input', 'synthetic-output'],
            spawnOption,
        );
        replaced.emit('exit', 0);

        const unchanged = spawnManaged();
        await manager.createManaged({ ...option, cmd: `${process.execPath} %INPUT% %OUTPUT%` });
        expect(processStubs.spawn).toHaveBeenLastCalledWith(process.execPath, ['%INPUT%', '%OUTPUT%']);
        unchanged.emit('exit', 0);
    });

    it('[MP-IMP-R1-PARSE] releases its reservation when command parsing fails', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });

        await expect(manager.createManaged({ ...option, cmd: '/synthetic/not-found' })).rejects.toThrow(
            'CmdBinIsNotFound',
        );
        expect(registryOf(manager)).toEqual([]);
        expect(processStubs.spawn).not.toHaveBeenCalled();

        const later = spawnManaged();
        await expect(manager.createManaged(option)).resolves.toMatchObject({ child: later });
    });

    it('[MP-IMP-R1-PARSE-PLACEHOLDERS] passes node, root, and escaped-space substitutions to spawn', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = spawnManaged();

        await expect(
            manager.createManaged({
                ...option,
                cmd: `%NODE% %ROOT%/recorded%SPACE%file`,
            }),
        ).resolves.toMatchObject({ child });

        expect(processStubs.spawn).toHaveBeenLastCalledWith(process.execPath, [
            `${resolve(compiledSnapshot, '..')}/recorded file`,
        ]);
        child.emit('exit', 0);
        expect(registryOf(manager)).toEqual([]);
    });

    it('[MP-IMP-R1-SPAWN-THROW] releases a synchronous spawn failure before the next request', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        processStubs.spawn.mockImplementationOnce(() => {
            throw new Error('synthetic spawn throw');
        });

        await expect(manager.createManaged(option)).rejects.toThrow('synthetic spawn throw');
        expect(registryOf(manager)).toEqual([]);

        const later = spawnManaged();
        await expect(manager.createManaged(option)).resolves.toMatchObject({ child: later });
    });

    it('[MP-IMP-R1-PRE-SPAWN] releases error and immediate-terminal startup failures exactly once', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const errorChild = makeChild();
        processStubs.spawn.mockReturnValueOnce(errorChild);
        const errored = manager.createManaged(option);
        errorChild.emit('error', new Error('before spawn'));
        errorChild.emit('exit', 1);
        await expect(errored).rejects.toThrow('before spawn');
        expect(registryOf(manager)).toEqual([]);
        expect(errorChild.eventNames()).toEqual([]);

        const immediateChild = makeChild();
        immediateChild.exitCode = 1;
        processStubs.spawn.mockReturnValueOnce(immediateChild);
        await expect(manager.createManaged(option)).rejects.toThrow('EncodeProcessManageModelStartError');
        expect(registryOf(manager)).toEqual([]);
        expect(immediateChild.eventNames()).toEqual([]);

        const later = spawnManaged();
        await expect(manager.createManaged(option)).resolves.toMatchObject({ child: later });
    });

    it('[MP-IMP-R1-SIGNAL-TERMINAL] rejects a child already terminated by signal before spawn', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = makeChild();
        child.signalCode = 'SIGTERM';
        processStubs.spawn.mockReturnValueOnce(child);

        await expect(manager.createManaged(option)).rejects.toThrow('EncodeProcessManageModelStartError');
        expect(registryOf(manager)).toEqual([]);
    });

    it('[MP-IMP-R5-HLS-IDENTITY] binds the direct child, PID, PGID, priority, token, and HLS handle to one slot', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = spawnManaged();

        const started = await manager.createHlsWriter({ ...option, priority: 7 });
        const processInfo = registryOf(manager)[0] as {
            child: SyntheticChild;
            handle: { kind: string };
            kind: string;
            pgid: number;
            pid: number;
            priority: number;
            token: object;
        };

        expect(started).toEqual({ child, handle: processInfo.handle });
        expect(started.handle).toEqual({ kind: 'hls-writer' });
        expect(Object.isFrozen(started.handle)).toBe(true);
        expect(processInfo).toMatchObject({ child, kind: 'hls-writer', pgid: 42, pid: 42, priority: 7 });
        expect(processInfo).toMatchObject({ directTerminalConfirmed: false, groupAbsentConfirmed: false });
        expect(processInfo.token).toEqual(expect.any(Object));
        expect(processStubs.spawn).toHaveBeenLastCalledWith(process.execPath, [], { detached: true });
    });

    it('[MP-IMP-R5-HLS-GROUP-FAILURE] releases the reservation and slot when no process group leader PID is available', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = spawnManaged();
        child.pid = 0;

        await expect(manager.createHlsWriter(option)).rejects.toThrow('HlsWriterProcessGroupStartError');
        expect(registryOf(manager)).toEqual([]);
        expect(child.eventNames()).toEqual([]);

        const later = spawnManaged();
        await expect(manager.createManaged(option)).resolves.toMatchObject({ child: later });
    });

    it.each([
        {
            checks: [true, false],
            confirmed: true,
            id: 'MP-IMP-R6-HLS-STAGES-SIGINT',
            label: 'SIGINT',
            signals: ['SIGINT'],
            waits: 1,
        },
        {
            checks: [true, true, true, true, false],
            confirmed: true,
            id: 'MP-IMP-R6-HLS-STAGES-SIGKILL',
            label: 'SIGKILL',
            signals: ['SIGINT', 'SIGKILL'],
            waits: 4,
        },
        {
            checks: [true, true, true, true, true, true, true],
            confirmed: false,
            id: 'MP-IMP-R6-HLS-STAGES-FORCED',
            label: 'forced release',
            signals: ['SIGINT', 'SIGKILL'],
            waits: 6,
        },
    ] as const)(
        '[$id] uses exact signal and polling counts for $label',
        async ({ checks, confirmed, signals, waits }) => {
            vi.useFakeTimers();
            const manager = makeManager({ encodeProcessNum: 1 });
            const child = spawnManaged();
            const { handle } = await manager.createHlsWriter(option);
            const processInfo = registryOf(manager)[0] as { slotReleasedResolve: () => void };
            const releaseResolution = vi.fn();
            processInfo.slotReleasedResolve = releaseResolution;
            const alive = vi.spyOn(processUtil, 'isProcessGroupAlive');
            for (const value of checks) alive.mockReturnValueOnce(value);
            const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});
            const wait = vi.spyOn(processUtil, 'wait');

            const stopping = manager.stopHls(handle);
            expect((registryOf(manager)[0] as { state: string }).state).toBe('stopping');
            await vi.runAllTimersAsync();

            await expect(stopping).resolves.toEqual({
                exitConfirmed: confirmed,
                sentSignals: signals,
                slotReleased: true,
            });
            expect(alive).toHaveBeenCalledTimes(checks.length);
            expect(signal.mock.calls).toEqual(signals.map(sent => [42, sent]));
            expect(wait).toHaveBeenCalledTimes(waits);
            expect(wait.mock.calls).toEqual(Array.from({ length: waits }, () => [1000]));
            expect(releaseResolution).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(0);
            expect(registryOf(manager)).toEqual([]);
            expect(child.listenerCount('exit')).toBe(0);
            if (!confirmed) {
                expect(child.listenerCount('error')).toBe(1);
                expect(child.listenerCount('close')).toBe(1);
                expect(logger.encode.error).toHaveBeenCalledWith(
                    expect.objectContaining({
                        forcedSlotRelease: true,
                        pgid: 42,
                        pid: 42,
                        sentSignals: signals,
                        terminalConfirmed: false,
                    }),
                );
                child.emit('close', 0, null);
                expect(child.listenerCount('error')).toBe(0);
                expect(child.listenerCount('close')).toBe(0);
            } else {
                expect(child.listenerCount('error')).toBe(0);
                expect(child.listenerCount('close')).toBe(0);
                expect(logger.encode.error).not.toHaveBeenCalledWith(
                    expect.objectContaining({ forcedSlotRelease: true }),
                );
            }
        },
    );

    it('[MP-IMP-R6-HLS-DUPLICATE] publishes one stop operation before signal re-entry and returns the same terminal result', async () => {
        vi.useFakeTimers();
        const manager = makeManager({ encodeProcessNum: 1 });
        spawnManaged();
        const { handle } = await manager.createHlsWriter(option);
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValueOnce(true).mockReturnValueOnce(false);
        let reentrant: ReturnType<ProcessManager['stopHls']> | undefined;
        vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {
            reentrant = manager.stopHls(handle);
        });

        const first = manager.stopHls(handle);
        expect(reentrant).toBe(first);
        expect(manager.stopHls(handle)).toBe(first);
        await vi.runAllTimersAsync();

        await expect(first).resolves.toEqual({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
        expect(processUtil.killProcessGroup).toHaveBeenCalledOnce();
        expect(registryOf(manager)).toEqual([]);
    });

    it.each([
        { failure: 'group-check', id: 'MP-IMP-R6-HLS-FAILURE-GROUP-CHECK' },
        { failure: 'SIGINT-send', id: 'MP-IMP-R6-HLS-FAILURE-SIGINT-SEND' },
        { failure: 'SIGINT-check', id: 'MP-IMP-R6-HLS-FAILURE-SIGINT-CHECK' },
        { failure: 'wait', id: 'MP-IMP-R6-HLS-FAILURE-WAIT' },
        { failure: 'SIGKILL-send', id: 'MP-IMP-R6-HLS-FAILURE-SIGKILL-SEND' },
        { failure: 'SIGKILL-check', id: 'MP-IMP-R6-HLS-FAILURE-SIGKILL-CHECK' },
    ] as const)('[$id] finalizes once when $failure fails', async ({ failure }) => {
        vi.useFakeTimers();
        const manager = makeManager({ encodeProcessNum: 1 });
        spawnManaged();
        const { handle } = await manager.createHlsWriter(option);
        const alive = vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValue(true);
        const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});
        const wait = vi.spyOn(processUtil, 'wait');
        if (failure === 'group-check')
            alive.mockImplementation(() => {
                throw new Error('check failed');
            });
        if (failure === 'SIGINT-send')
            signal.mockImplementationOnce(() => {
                throw new Error('int failed');
            });
        if (failure === 'wait') wait.mockRejectedValue(new Error('wait failed'));
        if (failure === 'SIGINT-check') {
            alive.mockReturnValueOnce(true).mockImplementation(() => {
                throw new Error('int check failed');
            });
        }
        if (failure === 'SIGKILL-send')
            signal
                .mockImplementationOnce(() => {})
                .mockImplementationOnce(() => {
                    throw new Error('kill failed');
                });
        if (failure === 'SIGKILL-check') {
            alive
                .mockReturnValueOnce(true)
                .mockReturnValueOnce(true)
                .mockReturnValueOnce(true)
                .mockReturnValueOnce(true)
                .mockImplementation(() => {
                    throw new Error('kill check failed');
                });
        }

        const stopping = manager.stopHls(handle);
        await vi.runAllTimersAsync();

        await expect(stopping).resolves.toMatchObject({ exitConfirmed: false, slotReleased: true });
        expect(registryOf(manager)).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        const expectedStage = {
            'group-check': 'initial-check',
            'SIGINT-send': 'SIGINT-send',
            'SIGINT-check': 'SIGINT-check',
            wait: 'SIGINT-wait',
            'SIGKILL-send': 'SIGKILL-send',
            'SIGKILL-check': 'SIGKILL-check',
        }[failure];
        expect(logger.encode.error).toHaveBeenCalledWith(expect.objectContaining({ stage: expectedStage }));
    });

    it('[MP-IMP-R6-HLS-LOGGER-FAILURE] releases the slot and retains the late-error sink when stop diagnostics throw', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = spawnManaged();
        const { handle } = await manager.createHlsWriter(option);
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockImplementationOnce(() => {
            throw new Error('synthetic group check failure');
        });
        logger.encode.error.mockImplementationOnce(() => {
            throw new Error('synthetic logger failure');
        });

        await expect(manager.stopHls(handle)).rejects.toThrow('synthetic logger failure');

        expect(registryOf(manager)).toEqual([]);
        expect(child.listenerCount('error')).toBe(1);
        expect(child.listenerCount('close')).toBe(1);
        expect(() => child.emit('error', new Error('late error after diagnostic failure'))).not.toThrow();
        child.emit('close', 0, null);
        expect(child.listenerCount('error')).toBe(0);
        expect(child.listenerCount('close')).toBe(0);
    });

    it('[MP-IMP-R6-HLS-DIRECT-TERMINAL] retains a slot while descendants remain and releases after group absence', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = spawnManaged();
        await manager.createHlsWriter(option);
        const alive = vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValueOnce(true).mockReturnValueOnce(false);

        child.emit('exit', 0);
        const processInfo = registryOf(manager)[0] as {
            directTerminalConfirmed: boolean;
            groupAbsentConfirmed: boolean;
            groupAbsenceCheckOperation: Promise<void>;
        };
        await processInfo.groupAbsenceCheckOperation;
        expect(processInfo.directTerminalConfirmed).toBe(true);
        expect(registryOf(manager)).toHaveLength(1);

        child.emit('close', 0, null);
        await processInfo.groupAbsenceCheckOperation;
        expect(alive).toHaveBeenCalledTimes(2);
        expect(processInfo.groupAbsentConfirmed).toBe(true);
        expect(registryOf(manager)).toEqual([]);
    });

    it('[MP-IMP-R6-HLS-EXIT-CLEANUP] releases an absent HLS group without installing a normal-process late-error sink', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = spawnManaged();
        await manager.createHlsWriter(option);
        const processInfo = registryOf(manager)[0] as { groupAbsenceCheckOperation: Promise<void> };
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValueOnce(false);

        child.emit('exit', 0, null);
        await processInfo.groupAbsenceCheckOperation;

        expect(registryOf(manager)).toEqual([]);
        expect(child.listenerCount('error')).toBe(0);
        expect(child.listenerCount('close')).toBe(0);
    });

    it('[MP-IMP-R6-HLS-TERMINAL-CHECK-FAILURE] records a natural-terminal group probe failure and retains the stoppable slot', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = spawnManaged();
        const { handle } = await manager.createHlsWriter(option);
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockImplementationOnce(() => {
            throw new Error('terminal check failed');
        });

        child.emit('exit', 0);
        const processInfo = registryOf(manager)[0] as { groupAbsenceCheckOperation: Promise<void> };
        await processInfo.groupAbsenceCheckOperation;

        expect(logger.encode.error).toHaveBeenCalledWith(expect.objectContaining({ stage: 'terminal-check' }));
        expect(registryOf(manager)).toHaveLength(1);
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValueOnce(false);
        await expect(manager.stopHls(handle)).resolves.toMatchObject({ exitConfirmed: true, slotReleased: true });
    });

    it('[MP-IMP-R6-HLS-DUPLICATE-TERMINAL] shares one pending group absence check for duplicate terminal callbacks', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = spawnManaged();
        await manager.createHlsWriter(option);
        let resolveProbe: (alive: boolean) => void = () => {};
        const alive = vi.spyOn(processUtil, 'isProcessGroupAlive').mockImplementation(() => false);
        alive.mockImplementationOnce(() => {
            resolveProbe(true);
            return true;
        });

        child.emit('exit', 0);
        const processInfo = registryOf(manager)[0] as { groupAbsenceCheckOperation: Promise<void> };
        child.emit('close', 0, null);
        await processInfo.groupAbsenceCheckOperation;

        expect(alive).toHaveBeenCalledOnce();
        expect(registryOf(manager)).toHaveLength(1);
    });

    it('[MP-IMP-R6-HLS-LATE-POLL] prevents a released generation from polling or signaling a reused PGID', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const oldChild = spawnManaged();
        const old = await manager.createHlsWriter(option);
        const alive = vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValue(true);
        const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});
        let resolveWait: () => void = () => {};
        vi.spyOn(processUtil, 'wait').mockImplementation(
            () =>
                new Promise<void>(resolve => {
                    resolveWait = resolve;
                }),
        );

        const stopping = manager.stopHls(old.handle);
        await Promise.resolve();
        const oldInfo = registryOf(manager)[0] as object;
        const lateExit = oldChild.listeners('exit')[0] as () => void;
        const lateClose = oldChild.listeners('close')[0] as () => void;
        const lateError = oldChild.listeners('error')[0] as (error: Error) => void;
        (manager as unknown as { release(info: object): void }).release(oldInfo);
        const currentChild = spawnManaged();
        await manager.createHlsWriter(option);
        const expectCurrentGenerationOnly = (): void => {
            expect(registryOf(manager)).toHaveLength(1);
            expect((registryOf(manager)[0] as { child: SyntheticChild }).child).toBe(currentChild);
            expect(alive).toHaveBeenCalledOnce();
            expect(signal).toHaveBeenCalledOnce();
        };

        resolveWait();

        await expect(stopping).resolves.toMatchObject({ slotReleased: true });
        expectCurrentGenerationOnly();
        lateExit();
        expectCurrentGenerationOnly();
        lateClose();
        expectCurrentGenerationOnly();
        lateError(new Error('late old error'));
        await Promise.resolve();
        await Promise.resolve();
        expectCurrentGenerationOnly();
    });

    it('[MP-IMP-R6-HLS-REENTRANT-RELEASE] starts no poll timer when signal delivery synchronously releases the generation', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        spawnManaged();
        const { handle } = await manager.createHlsWriter(option);
        const processInfo = registryOf(manager)[0] as object;
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValue(true);
        const wait = vi.spyOn(processUtil, 'wait');
        vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {
            (manager as unknown as { release(info: object): void }).release(processInfo);
        });

        await expect(manager.stopHls(handle)).resolves.toMatchObject({ exitConfirmed: true, slotReleased: true });
        expect(wait).not.toHaveBeenCalled();
        expect(registryOf(manager)).toEqual([]);
    });

    it('[MP-IMP-R6-HLS-STALE] returns stopped for unknown and completed handles without another signal or release', async () => {
        vi.useFakeTimers();
        const manager = makeManager({ encodeProcessNum: 1 });
        spawnManaged();
        const { handle } = await manager.createHlsWriter(option);
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValueOnce(false);
        const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});
        await expect(manager.stopHls(handle)).resolves.toEqual({
            exitConfirmed: true,
            sentSignals: [],
            slotReleased: true,
        });

        await expect(manager.stopHls(handle)).resolves.toEqual({
            exitConfirmed: true,
            sentSignals: [],
            slotReleased: true,
        });
        await expect(manager.stopHls({})).resolves.toEqual({
            exitConfirmed: true,
            sentSignals: [],
            slotReleased: true,
        });
        expect(signal).not.toHaveBeenCalled();
        expect(registryOf(manager)).toEqual([]);
    });

    it('[MP-IMP-R6-HLS-FORCED-ERROR-SINK] absorbs a late child error only until close without touching a reused generation', async () => {
        vi.useFakeTimers();
        const manager = makeManager({ encodeProcessNum: 1 });
        const oldChild = spawnManaged();
        const old = await manager.createHlsWriter(option);
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValue(true);
        const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});

        const stopping = manager.stopHls(old.handle);
        await vi.runAllTimersAsync();
        await expect(stopping).resolves.toMatchObject({ exitConfirmed: false, slotReleased: true });
        expect(registryOf(manager)).toEqual([]);

        const currentChild = spawnManaged();
        await manager.createHlsWriter(option);
        const signalCount = signal.mock.calls.length;

        expect(() => oldChild.emit('error', new Error('late forced-release error'))).not.toThrow();
        expect(registryOf(manager)).toHaveLength(1);
        expect((registryOf(manager)[0] as { child: SyntheticChild }).child).toBe(currentChild);
        expect(signal).toHaveBeenCalledTimes(signalCount);
        oldChild.emit('close', 0, null);
        expect(oldChild.listenerCount('error')).toBe(0);
        expect(oldChild.listenerCount('close')).toBe(0);
    });

    it('[MP-IMP-R6-HLS-KIND] rejects a normal managed handle without signaling or releasing its active slot', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = spawnManaged();
        const { handle } = await manager.createManaged(option);
        const signal = vi.spyOn(processUtil, 'killProcessGroup');
        const processInfo = registryOf(manager)[0] as {
            directTerminalConfirmed: boolean;
            groupAbsentConfirmed: boolean;
            pgid?: number;
            pid?: number;
        };

        await expect(manager.stopHls(handle)).resolves.toEqual({
            exitConfirmed: true,
            sentSignals: [],
            slotReleased: true,
        });
        expect(signal).not.toHaveBeenCalled();
        expect(processInfo).toMatchObject({
            directTerminalConfirmed: false,
            groupAbsentConfirmed: false,
            pgid: undefined,
            pid: undefined,
        });
        expect(registryOf(manager)).toHaveLength(1);
        child.emit('exit', 0);
    });

    it('[MP-IMP-R5-HLS-PRE-SPAWN-TERMINAL] rejects without probing a group when the direct child terminates before spawn', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = makeChild();
        processStubs.spawn.mockReturnValueOnce(child);
        const alive = vi.spyOn(processUtil, 'isProcessGroupAlive');

        const starting = manager.createHlsWriter(option);
        child.emit('exit', 1);

        await expect(starting).rejects.toThrow('EncodeProcessManageModelStartError');
        expect(alive).not.toHaveBeenCalled();
        expect(registryOf(manager)).toEqual([]);
    });

    it('[MP-IMP-R6-GROUP-UTIL] addresses a saved process group and distinguishes ESRCH from probe failure', async () => {
        const processKill = vi.spyOn(process, 'kill').mockReturnValue(true);

        expect(processUtil.isProcessGroupAlive(42)).toBe(true);
        expect(processKill).toHaveBeenLastCalledWith(-42, 0);
        processKill.mockImplementationOnce(() => {
            throw Object.assign(new Error('absent'), { code: 'ESRCH' });
        });
        expect(processUtil.isProcessGroupAlive(42)).toBe(false);
        processKill.mockImplementationOnce(() => {
            throw Object.assign(new Error('denied'), { code: 'EPERM' });
        });
        expect(() => processUtil.isProcessGroupAlive(42)).toThrow('denied');
        processKill.mockImplementationOnce(() => {
            throw null;
        });
        let caught: unknown = 'not-thrown';
        try {
            processUtil.isProcessGroupAlive(42);
        } catch (err: unknown) {
            caught = err;
        }
        expect(caught).toBeNull();

        processUtil.killProcessGroup(42, 'SIGINT');
        expect(processKill).toHaveBeenLastCalledWith(-42, 'SIGINT');

        vi.useFakeTimers();
        let waited = false;
        const waiting = processUtil.wait(1000).then(() => {
            waited = true;
        });
        await vi.advanceTimersByTimeAsync(999);
        expect(waited).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await waiting;
        expect(waited).toBe(true);
        expect(vi.getTimerCount()).toBe(0);

        const child = makeChild();
        expect(processUtil.isExited(child)).toBe(false);
        child.exitCode = 0;
        expect(processUtil.isExited(child)).toBe(true);
    });

    it('[MP-IMP-R4-RELEASE] ignores duplicate and out-of-order terminal notifications after one exact release', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const terminal = spawnManaged();
        await manager.createManaged(option);
        const processInfo = registryOf(manager)[0] as {
            directCloseConfirmed: boolean;
            slotReleased: boolean;
            slotReleasedResolve: () => void;
            state: string;
        };
        const releaseResolution = vi.fn();
        processInfo.slotReleasedResolve = releaseResolution;

        terminal.emit('close', 1, null);
        terminal.emit('exit', 1, null);
        terminal.emit('close', 1, null);

        expect(registryOf(manager)).toEqual([]);
        expect(terminal.listenerCount('spawn')).toBe(0);
        expect(terminal.listenerCount('error')).toBe(0);
        expect(terminal.listenerCount('exit')).toBe(0);
        expect(terminal.listenerCount('close')).toBe(0);
        expect(processInfo.directCloseConfirmed).toBe(true);
        expect(processInfo.slotReleased).toBe(true);
        expect(processInfo.state).toBe('released');
        (manager as unknown as { release(info: object): void }).release(processInfo);
        expect(releaseResolution).toHaveBeenCalledOnce();
    });

    it('[MP-IMP-R4-EXACT-CHILD] removes an older terminal child without removing the newer child at another index', async () => {
        const manager = makeManager({ encodeProcessNum: 2 });
        const older = spawnManaged();
        await manager.createManaged(option);
        const newer = spawnManaged();
        await manager.createManaged(option);

        older.emit('exit', 0);

        expect(registryOf(manager)).toHaveLength(1);
        expect((registryOf(manager)[0] as { child: SyntheticChild }).child).toBe(newer);
    });

    it('[MP-IMP-R4-STREAMS] removes owned data listeners and accepts a child without piped stdio', async () => {
        const manager = makeManager({ encodeProcessNum: 2 });
        const piped = spawnManaged();
        await manager.createManaged(option);
        expect(piped.stdout?.listenerCount('data')).toBe(1);
        expect(piped.stderr?.listenerCount('data')).toBe(1);
        piped.emit('exit', 0);
        expect(piped.stdout?.listenerCount('data')).toBe(0);
        expect(piped.stderr?.listenerCount('data')).toBe(0);

        const unpiped = makeChild();
        unpiped.stdin = null;
        unpiped.stdout = null;
        unpiped.stderr = null;
        spawnManaged(unpiped);
        await manager.createManaged(option);
        unpiped.emit('exit', 0);
        expect(registryOf(manager)).toEqual([]);
    });

    it('[MP-IMP-R3-STALE-STOP] treats unknown and released handles as stopped without another signal', async () => {
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = spawnManaged();
        const { handle } = await manager.createManaged(option);
        child.emit('exit', 0);

        await expect(manager.requestStop(handle)).resolves.toEqual({ sentSignals: [], status: 'already-released' });
        await expect(manager.requestStop({})).resolves.toEqual({ sentSignals: [], status: 'already-released' });
        expect(child.kill).not.toHaveBeenCalled();
    });

    it('[MP-IMP-R3-EXACT-STOP] resolves an active handle by object identity without signaling another active child', async () => {
        vi.useFakeTimers();
        const manager = makeManager({ encodeProcessNum: 2 });
        const firstChild = spawnManaged();
        await manager.createManaged(option);
        const secondChild = spawnManaged();
        const second = await manager.createManaged(option);

        await expect(manager.requestStop({})).resolves.toEqual({ sentSignals: [], status: 'already-released' });
        const stopped = manager.requestStop(second.handle);
        await vi.advanceTimersByTimeAsync(500);
        await expect(stopped).resolves.toEqual({ sentSignals: ['SIGINT'], status: 'requested' });
        expect(firstChild.kill).not.toHaveBeenCalled();
        expect(secondChild.kill).toHaveBeenCalledOnce();
    });

    it('[MP-IMP-R3-STOP] shares one stop operation, cleans stdio, and leaves no timer after its response', async () => {
        vi.useFakeTimers();
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = spawnManaged();
        const { handle } = await manager.createManaged(option);
        if (child.stdin === null || child.stdout === null || child.stderr === null)
            throw new Error('piped child required');
        const stdinEnd = vi.spyOn(child.stdin, 'end');
        const stdoutDestroy = vi.spyOn(child.stdout, 'destroy');
        const stderrDestroy = vi.spyOn(child.stderr, 'destroy');
        const processInfo = registryOf(manager)[0] as { state: string };

        const first = manager.requestStop(handle);
        const duplicate = manager.requestStop(handle);
        expect(duplicate).toBe(first);

        await vi.advanceTimersByTimeAsync(500);
        await expect(first).resolves.toEqual({ sentSignals: ['SIGINT'], status: 'requested' });
        expect(stdinEnd).toHaveBeenCalledOnce();
        expect(stdoutDestroy).toHaveBeenCalledOnce();
        expect(stderrDestroy).toHaveBeenCalledOnce();
        expect(child.kill).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        expect(registryOf(manager)).toHaveLength(1);
        expect(processInfo.state).toBe('stopping');
    });

    it('[MP-IMP-R3-CONSUMER-CANCEL] joins duplicate encoding cancellation at the exact manager stop seam', async () => {
        await exerciseEncoderStopSeam('cancel');
    });

    it('[MP-IMP-R3-CONSUMER-DEADLINE] joins encoding deadline and explicit cancellation at the exact manager stop seam', async () => {
        await exerciseEncoderStopSeam('deadline');
    });

    it('[MP-IMP-R3-REENTRANT-STOP] publishes the shared stop operation before synchronous unpipe re-entry', async () => {
        vi.useFakeTimers();
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = spawnManaged();
        const { handle } = await manager.createManaged(option);
        if (child.stdout === null) throw new Error('piped child required');
        const destination = new PassThrough();
        child.stdout.pipe(destination);
        let reentrant: ReturnType<ProcessManager['requestStop']> | undefined;
        destination.once('unpipe', () => {
            reentrant = manager.requestStop(handle);
        });

        try {
            const first = manager.requestStop(handle);

            expect(reentrant).toBe(first);
            expect(vi.getTimerCount()).toBe(1);
            await vi.advanceTimersByTimeAsync(500);
            await expect(first).resolves.toEqual({ sentSignals: ['SIGINT'], status: 'requested' });
            expect(child.kill).toHaveBeenCalledOnce();
        } finally {
            destination.destroy();
        }
    });

    it('[MP-IMP-R3-STOP-FAILURE] rejects replacement when stdio cleanup fails without creating a timer', async () => {
        vi.useFakeTimers();
        const manager = makeManager({ encodeProcessNum: 1 });
        const child = spawnManaged();
        await manager.createManaged(option);
        const processInfo = registryOf(manager)[0] as { processId: number };
        if (child.stdin === null) throw new Error('piped child required');
        vi.spyOn(child.stdin, 'end').mockImplementation(() => {
            throw new Error('synthetic cleanup failure');
        });

        await expect(manager.createManaged({ ...option, priority: 10 })).rejects.toThrow('synthetic cleanup failure');
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(logger.encode.error).toHaveBeenCalledWith(`kill process failed: ${processInfo.processId}`);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MP-IMP-R3-RESERVATION] lets only the replacement owner consume a slot released in the same turn', async () => {
        vi.useFakeTimers();
        const manager = makeManager({ encodeProcessNum: 1 });
        const playback = spawnManaged();
        await manager.createManaged(option);

        const replacement = manager.createManaged({ ...option, priority: 10 });
        const [reservation] = [
            ...(
                manager as unknown as {
                    replacementReservations: Set<{ consumed: boolean }>;
                }
            ).replacementReservations,
        ];
        expect(reservation.consumed).toBe(false);
        await vi.advanceTimersByTimeAsync(500);

        const reservedChild = spawnManaged();
        spawnManaged();
        playback.emit('exit', 0);
        const competing = manager.createManaged(option);

        await expect(competing).rejects.toThrow('EncodeProcessManageModelCreateError');
        await expect(replacement).resolves.toMatchObject({ child: reservedChild });
        expect(reservation.consumed).toBe(true);
        expect(processStubs.spawn).toHaveBeenCalledTimes(2);
        expect(registryOf(manager)).toHaveLength(1);
        expect((registryOf(manager)[0] as { child: SyntheticChild }).child).toBe(reservedChild);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MP-IMP-R3-DISTINCT] reserves distinct running targets for concurrent higher-priority requests', async () => {
        vi.useFakeTimers();
        const manager = makeManager({ encodeProcessNum: 2 });
        const older = spawnManaged();
        await manager.createManaged(option);
        const newer = spawnManaged();
        await manager.createManaged(option);

        const first = manager.createManaged({ ...option, priority: 10 });
        const second = manager.createManaged({ ...option, priority: 10 });
        await expect(manager.createManaged({ ...option, priority: 10 })).rejects.toThrow(
            'EncodeProcessManageModelCreateError',
        );
        expect((manager as unknown as { occupiedSlotCount(): number }).occupiedSlotCount()).toBe(2);

        await vi.advanceTimersByTimeAsync(500);
        expect(newer.kill).toHaveBeenCalledOnce();
        expect(older.kill).toHaveBeenCalledOnce();

        const firstReplacement = spawnManaged();
        const secondReplacement = spawnManaged();
        newer.emit('exit', 0);
        older.emit('exit', 0);

        await expect(first).resolves.toMatchObject({ child: firstReplacement });
        await expect(second).resolves.toMatchObject({ child: secondReplacement });
        expect(registryOf(manager)).toHaveLength(2);
        expect((manager as unknown as { occupiedSlotCount(): number }).occupiedSlotCount()).toBe(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MP-IMP-R3-HLS-EXACT-DEADLINE] admits replacement when the third HLS probe reports absence at exactly 3000ms', async () => {
        vi.useFakeTimers();
        const manager = makeManager({ encodeProcessNum: 1 });
        spawnManaged();
        await manager.createHlsWriter(option);
        const alive = vi.spyOn(processUtil, 'isProcessGroupAlive');
        for (const value of [true, true, true, false]) alive.mockReturnValueOnce(value);
        const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});
        const replacementChild = spawnManaged();

        const replacement = manager.createManaged({ ...option, priority: 10 });
        const replacementOutcome = Promise.allSettled([replacement]);
        await vi.advanceTimersByTimeAsync(2999);
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);

        const [outcome] = await replacementOutcome;
        expect(outcome.status).toBe('fulfilled');
        if (outcome.status === 'rejected') throw outcome.reason;
        expect(outcome.value).toMatchObject({ child: replacementChild });
        expect(alive.mock.results.map(result => result.value)).toEqual([true, true, true, false]);
        expect(signal.mock.calls).toEqual([[42, 'SIGINT']]);
        expect(processStubs.spawn).toHaveBeenCalledTimes(2);
        expect(registryOf(manager)).toHaveLength(1);
        expect((registryOf(manager)[0] as { child: SyntheticChild }).child).toBe(replacementChild);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MP-IMP-R3-AFTER-DEADLINE] rejects a 3001ms release processed before the deadline immediate', async () => {
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
        const manager = makeManager({ encodeProcessNum: 1 });
        const playback = spawnManaged();
        await manager.createManaged(option);

        const replacement = manager.createManaged({ ...option, priority: 10 });
        spawnManaged();
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
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(registryOf(manager)).toEqual([]);
        expect(clearDeadlineCheck).toHaveBeenCalledOnce();
        expect(clearDeadlineCheck).toHaveBeenCalledWith(deadlineCheckHandle);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MP-IMP-R3-HLS-TIMEOUT] rejects replacement when HLS group absence is confirmed after 3000ms', async () => {
        vi.useFakeTimers();
        const manager = makeManager({ encodeProcessNum: 1 });
        spawnManaged();
        const writer = await manager.createHlsWriter(option);
        const alive = vi.spyOn(processUtil, 'isProcessGroupAlive');
        for (const value of [true, true, true, true, false]) alive.mockReturnValueOnce(value);
        const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});
        const stopHls = vi.spyOn(manager, 'stopHls');

        const replacement = manager.createManaged({ ...option, priority: 10 });
        expect(stopHls).toHaveBeenCalledOnce();
        expect(stopHls).toHaveBeenLastCalledWith(writer.handle);
        const replacementOutcome = expect(replacement).rejects.toThrow('EncodeProcessManageModelTimeoutError');
        const processInfo = registryOf(manager)[0] as { hlsStopOperation: Promise<unknown>; state: string };
        const explicitStop = manager.stopHls(writer.handle);
        expect(stopHls).toHaveBeenCalledTimes(2);
        expect(explicitStop).toBe(processInfo.hlsStopOperation);

        await vi.advanceTimersByTimeAsync(3000);
        await vi.advanceTimersToNextTimerAsync();
        await replacementOutcome;
        expect(processInfo.state).toBe('stopping');
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(writer.child.kill).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1000);
        await expect(explicitStop).resolves.toMatchObject({ exitConfirmed: true, slotReleased: true });
        expect(alive.mock.results.map(result => result.value)).toEqual([true, true, true, true, false]);
        expect(signal.mock.calls).toEqual([
            [42, 'SIGINT'],
            [42, 'SIGKILL'],
        ]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MP-IMP-R7-SNAPSHOT] keeps the constructor configuration snapshot while a new instance reads the changed maximum', async () => {
        const configuration = { encodeProcessNum: 1 };
        const original = makeManager(configuration);
        const first = spawnManaged();
        await original.create(option);
        configuration.encodeProcessNum = 2;

        await expect(original.create(option)).rejects.toThrow('EncodeProcessManageModelCreateError');
        const restarted = makeManager(configuration);
        const second = spawnManaged();
        const third = spawnManaged();
        await expect(restarted.create(option)).resolves.toBe(second);
        await expect(restarted.create(option)).resolves.toBe(third);

        expect(registryOf(original)).toHaveLength(1);
        expect(registryOf(restarted)).toHaveLength(2);
    });

    it('[MP-IMP-R7-EMPTY-RESTART] creates an empty memory registry instead of restoring another instance registry', async () => {
        const original = makeManager({ encodeProcessNum: 1 });
        const active = spawnManaged();
        await original.create(option);

        const restarted = makeManager({ encodeProcessNum: 1 });

        expect(registryOf(original)).toHaveLength(1);
        expect(registryOf(restarted)).toEqual([]);
    });

    it('[MP-IMP-R7-NO-DRAIN] exposes admission only and no manager-owned drain or business-result API', () => {
        const publicMethods = Object.getOwnPropertyNames(ProcessManager.prototype).filter(
            name => name !== 'constructor',
        );

        expect(publicMethods).toContain('create');
        expect(publicMethods).not.toEqual(
            expect.arrayContaining(['drain', 'shutdown', 'result', 'getResult', 'restart', 'retry']),
        );
        expect(Object.keys(managerInterface)).toEqual([]);
    });
});

