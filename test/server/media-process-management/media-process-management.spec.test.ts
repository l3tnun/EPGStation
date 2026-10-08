import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// The repeated advanceTimersByTimeAsync(500) calls below exercise ProcessUtil.kill's default
// SIGINT-then-resolve grace (src/util/ProcessUtil.ts:33, `wait = 500`), which is byte-identical
// to v2 5cf2ea383 src/util/ProcessUtil.ts:11.
const processStubs = vi.hoisted(() => ({ spawn: vi.fn() }));

interface SyntheticChild extends EventEmitter {
    exitCode: number | null;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
    signalCode: NodeJS.Signals | null;
    stderr: PassThrough;
    stdin: PassThrough;
    stdout: PassThrough;
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
}

interface DirectLiveModel {
    getStream(): PassThrough;
    setOption(option: { channelId: number; cmd?: string }, mode: number): void;
    start(streamId: number): Promise<void>;
    stop(): Promise<void>;
}

interface DirectLiveModelConstructor {
    new (...dependencies: unknown[]): DirectLiveModel;
    readonly ENCODE_PROCESS_PRIORITY: number;
}

interface PriorityConsumerConstructor {
    readonly ENCODE_PROCESS_PRIORITY?: number;
    readonly ENCODE_PRIPORITY?: number;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const mutableChildProcess = require('child_process') as { spawn: typeof processStubs.spawn };
const originalSpawn = mutableChildProcess.spawn;
mutableChildProcess.spawn = processStubs.spawn;
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const ProcessManager = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeProcessManageModel.js')) as {
        default: ProcessManagerConstructor;
    }
).default;
const LiveStreamModel = (
    require(join(compiledSnapshot, 'model', 'service', 'stream', 'LiveStreamModel.js')) as {
        default: DirectLiveModelConstructor;
    }
).default;
const EncoderModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncoderModel.js')) as {
        default: PriorityConsumerConstructor;
    }
).default;
const RecordedStreamBaseModel = (
    require(join(compiledSnapshot, 'model', 'service', 'stream', 'base', 'RecordedStreamBaseModel.js')) as {
        default: PriorityConsumerConstructor;
    }
).default;
const processUtil = (
    require(join(compiledSnapshot, 'util', 'ProcessUtil.js')) as {
        default: {
            isProcessGroupAlive(pgid: number): boolean;
            killProcessGroup(pgid: number, signal: NodeJS.Signals): void;
        };
    }
).default;

const children: SyntheticChild[] = [];
const temporaryDirectories: string[] = [];
const logger = {
    encode: { error: vi.fn(), info: vi.fn() },
    stream: { debug: vi.fn(), error: vi.fn(), info: vi.fn() },
};
const command = process.execPath;
const option = (priority: number) => ({ input: null, output: null, cmd: command, priority });
const registryOf = (manager: ProcessManager): unknown[] => (manager as unknown as { childs: unknown[] }).childs;

const makeChild = (): SyntheticChild => {
    const child = Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        kill: vi.fn(),
        pid: 42,
        signalCode: null as NodeJS.Signals | null,
        stderr: new PassThrough(),
        stdin: new PassThrough(),
        stdout: new PassThrough(),
    });
    child.kill.mockImplementation(() => {
        child.exitCode = 0;
        child.emit('exit', 0);
        return true;
    });
    children.push(child);
    return child;
};

const makeManager = (maximum: number): ProcessManager =>
    new ProcessManager({ getLogger: () => logger }, { getConfig: () => ({ encodeProcessNum: maximum }) });

const spawnNext = (): SyntheticChild => {
    const child = makeChild();
    processStubs.spawn.mockImplementationOnce(() => {
        queueMicrotask(() => child.emit('spawn'));
        return child;
    });
    return child;
};

const spawnUnsettled = (): SyntheticChild => {
    const child = makeChild();
    processStubs.spawn.mockReturnValueOnce(child);
    return child;
};

const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

interface CanonicalSpecCase {
    readonly acceptanceCriterion: string;
    readonly id: string;
    readonly title: string;
    readonly verify: () => Promise<void> | void;
}

const canonicalCase = (
    acceptanceCriterion: string,
    title: string,
    verify: CanonicalSpecCase['verify'],
): CanonicalSpecCase => ({
    acceptanceCriterion,
    id: `MP-SPEC-${acceptanceCriterion.replace('.', '-')}`,
    title,
    verify,
});

const canonicalSpecCases: readonly CanonicalSpecCase[] = [
    canonicalCase('R1.1', 'keeps encoding and playback processes in one shared registry', async () => {
        const manager = makeManager(2);
        const playback = spawnNext();
        await manager.createManaged(option(1));
        const encoding = spawnNext();
        await manager.createManaged(option(10));

        expect(registryOf(manager)).toHaveLength(2);
        expect(registryOf(manager)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ child: playback, priority: 1 }),
                expect.objectContaining({ child: encoding, priority: 10 }),
            ]),
        );
    }),
    canonicalCase('R1.2', 'associates every running process with its accepted priority', async () => {
        const manager = makeManager(2);
        spawnNext();
        await manager.createManaged(option(1));
        spawnNext();
        await manager.createManaged(option(10));

        expect(
            registryOf(manager)
                .map(info => (info as { priority: number }).priority)
                .sort((left, right) => left - right),
        ).toEqual([1, 10]);
    }),
    canonicalCase('R1.3', 'attempts a new process start while capacity remains', async () => {
        const manager = makeManager(2);
        const child = spawnNext();

        await expect(manager.createManaged(option(1))).resolves.toMatchObject({ child });
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(registryOf(manager)).toHaveLength(1);
    }),
    canonicalCase('R1.4', 'disables spawning when the validated maximum is zero', async () => {
        const manager = makeManager(0);

        await expect(manager.createManaged(option(1))).rejects.toThrow('EncodeProcessManageModelCreateError');
        expect(processStubs.spawn).not.toHaveBeenCalled();
        expect(registryOf(manager)).toEqual([]);
    }),
    canonicalCase('R1.5', 'releases the admission reservation after a synchronous spawn failure', async () => {
        const manager = makeManager(1);
        processStubs.spawn.mockImplementationOnce(() => {
            throw new Error('synthetic canonical spawn failure');
        });

        await expect(manager.createManaged(option(1))).rejects.toThrow('synthetic canonical spawn failure');
        expect(registryOf(manager)).toEqual([]);
    }),
    canonicalCase('R1.6', 'bypasses the manager when live delivery needs no transform', async () => {
        vi.useFakeTimers();
        const streamDirectory = mkdtempSync(join(tmpdir(), 'epgstation-media-spec-direct-'));
        temporaryDirectories.push(streamDirectory);
        const source = new PassThrough();
        const directManager = {
            create: vi.fn(),
            createHlsWriter: vi.fn(),
            createManaged: vi.fn(),
            requestStop: vi.fn(),
            stopHls: vi.fn(),
        };
        const live = new LiveStreamModel(
            {
                getConfig: () => ({
                    ffmpeg: process.execPath,
                    streamingPriority: 1,
                    streamFilePath: streamDirectory,
                }),
            },
            {
                getLogger: () => ({
                    stream: {
                        debug: vi.fn(),
                        error: vi.fn(),
                        fatal: vi.fn(),
                        info: vi.fn(),
                        warn: vi.fn(),
                    },
                }),
            },
            directManager,
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            {
                openServiceStream: vi.fn(async () => ({
                    close: () => source.destroy(),
                    stream: source,
                })),
            },
            { notifyClient: vi.fn() },
        );
        live.setOption({ channelId: 101 }, 0);

        try {
            await live.start(7);
            expect(live.getStream()).toBe(source);
            expect(directManager.create).not.toHaveBeenCalled();
            expect(directManager.createManaged).not.toHaveBeenCalled();
            expect(directManager.createHlsWriter).not.toHaveBeenCalled();
        } finally {
            await live.stop();
            source.destroy();
        }
        expect(vi.getTimerCount()).toBe(0);
    }),
    canonicalCase('R2.1', 'publishes encoding as priority 10', () => {
        expect(EncoderModel.ENCODE_PRIPORITY).toBe(10);
    }),
    canonicalCase('R2.2', 'publishes live and recorded playback conversion as priority 1', () => {
        expect(LiveStreamModel.ENCODE_PROCESS_PRIORITY).toBe(1);
        expect(RecordedStreamBaseModel.ENCODE_PROCESS_PRIORITY).toBe(1);
    }),
    canonicalCase('R2.3', 'replaces one lower-priority process at capacity', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const playback = spawnNext();
        await manager.createManaged(option(1));
        const encoding = spawnNext();

        const replacement = manager.createManaged(option(10));
        await vi.advanceTimersByTimeAsync(500);

        await expect(replacement).resolves.toMatchObject({ child: encoding });
        expect(playback.kill).toHaveBeenCalledOnce();
        expect(playback.kill).toHaveBeenCalledWith('SIGINT');
    }),
    canonicalCase('R2.4', 'rejects when no running process has lower priority', async () => {
        const manager = makeManager(1);
        const active = spawnNext();
        await manager.createManaged(option(11));

        await expect(manager.createManaged(option(10))).rejects.toThrow('EncodeProcessManageModelCreateError');
        expect(active.kill).not.toHaveBeenCalled();
        expect(registryOf(manager)).toHaveLength(1);
    }),
    canonicalCase('R2.5', 'selects the most recently registered eligible lower-priority process', async () => {
        vi.useFakeTimers();
        const manager = makeManager(3);
        const oldest = spawnNext();
        vi.setSystemTime(1);
        await manager.createManaged(option(0));
        const middle = spawnNext();
        vi.setSystemTime(2);
        await manager.createManaged(option(1));
        const newest = spawnNext();
        vi.setSystemTime(3);
        await manager.createManaged(option(1));
        const replacementChild = spawnNext();

        const replacement = manager.createManaged(option(10));
        await vi.advanceTimersByTimeAsync(500);

        await expect(replacement).resolves.toMatchObject({ child: replacementChild });
        expect(newest.kill).toHaveBeenCalledOnce();
        expect(middle.kill).not.toHaveBeenCalled();
        expect(oldest.kill).not.toHaveBeenCalled();
    }),
    canonicalCase('R2.6', 'never selects a same-priority process for replacement', async () => {
        const manager = makeManager(1);
        const active = spawnNext();
        await manager.createManaged(option(10));

        await expect(manager.createManaged(option(10))).rejects.toThrow('EncodeProcessManageModelCreateError');
        expect(active.kill).not.toHaveBeenCalled();
    }),
    canonicalCase('R3.1', 'requests stop on the selected lower-priority process', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const playback = spawnNext();
        await manager.createManaged(option(1));
        const replacementChild = spawnNext();

        const replacement = manager.createManaged(option(10));
        expect(playback.kill).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(500);

        await expect(replacement).resolves.toMatchObject({ child: replacementChild });
        expect(playback.kill).toHaveBeenCalledOnce();
        expect(playback.kill).toHaveBeenCalledWith('SIGINT');
    }),
    canonicalCase('R3.2', 'waits no longer than 3000ms for logical slot release', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const playback = spawnNext();
        playback.kill.mockImplementation(() => true);
        await manager.createManaged(option(1));
        const replacement = manager.createManaged(option(10));
        let settled = false;
        replacement.then(
            () => {
                settled = true;
            },
            () => {
                settled = true;
            },
        );

        await vi.advanceTimersByTimeAsync(2999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(settled).toBe(false);
        await vi.advanceTimersToNextTimerAsync();

        await expect(replacement).rejects.toThrow('EncodeProcessManageModelTimeoutError');
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    }),
    canonicalCase('R3.3', 'starts the reserved replacement when release is confirmed at 3000ms', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const playback = spawnNext();
        playback.kill.mockImplementation(() => true);
        await manager.createManaged(option(1));

        const replacement = manager.createManaged(option(10));
        const replacementChild = spawnNext();
        setTimeout(() => playback.emit('exit', 0), 3000);

        await vi.advanceTimersByTimeAsync(2999);
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);

        await expect(replacement).resolves.toMatchObject({ child: replacementChild });
        expect(processStubs.spawn).toHaveBeenCalledTimes(2);
        expect(registryOf(manager)).toHaveLength(1);
        expect((registryOf(manager)[0] as { child: SyntheticChild }).child).toBe(replacementChild);
    }),
    canonicalCase('R3.4', 'rejects the replacement while the slot is still occupied at 3000ms', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const playback = spawnNext();
        playback.kill.mockImplementation(() => true);
        await manager.createManaged(option(1));

        const replacement = manager.createManaged(option(10));
        const rejected = expect(replacement).rejects.toThrow('EncodeProcessManageModelTimeoutError');
        await vi.advanceTimersByTimeAsync(3000);
        await vi.advanceTimersToNextTimerAsync();

        await rejected;
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(registryOf(manager)).toHaveLength(1);
        expect((registryOf(manager)[0] as { state: string }).state).toBe('stopping');
    }),
    canonicalCase('R3.5', 'does not retry a timed-out replacement after later release', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const playback = spawnNext();
        playback.kill.mockImplementation(() => true);
        await manager.createManaged(option(1));
        const replacement = manager.createManaged(option(10));
        const rejected = expect(replacement).rejects.toThrow('EncodeProcessManageModelTimeoutError');

        await vi.advanceTimersByTimeAsync(3000);
        await vi.advanceTimersToNextTimerAsync();
        await rejected;
        playback.emit('exit', 0);
        await settle();
        await vi.runAllTimersAsync();

        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(registryOf(manager)).toEqual([]);
    }),
    canonicalCase('R3.6', 'joins duplicate stop requests without duplicate signals', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const child = spawnNext();
        const { handle } = await manager.createManaged(option(1));

        const first = manager.requestStop(handle);
        const duplicate = manager.requestStop(handle);
        expect(duplicate).toBe(first);
        await vi.advanceTimersByTimeAsync(500);

        await expect(first).resolves.toEqual({ sentSignals: ['SIGINT'], status: 'requested' });
        expect(child.kill).toHaveBeenCalledOnce();
        expect(child.kill).toHaveBeenCalledWith('SIGINT');
    }),
    canonicalCase('R4.1', 'removes a normally exited process from the running registry', async () => {
        const manager = makeManager(1);
        const child = spawnNext();
        await manager.createManaged(option(1));

        child.emit('exit', 0);
        await settle();

        expect(registryOf(manager)).toEqual([]);
    }),
    canonicalCase('R4.2', 'removes both failed starts and confirmed abnormal exits', async () => {
        const manager = makeManager(1);
        const failed = spawnUnsettled();
        const starting = manager.createManaged(option(1));
        failed.emit('error', new Error('synthetic canonical pre-spawn error'));
        await expect(starting).rejects.toThrow('synthetic canonical pre-spawn error');
        expect(registryOf(manager)).toEqual([]);

        const abnormal = spawnNext();
        await manager.createManaged(option(1));
        abnormal.emit('exit', 1);
        await settle();
        expect(registryOf(manager)).toEqual([]);
    }),
    canonicalCase('R4.3', 'makes a released slot available to a later explicit request', async () => {
        const manager = makeManager(1);
        const first = spawnNext();
        await manager.createManaged(option(1));
        first.emit('exit', 0);
        await settle();
        const second = spawnNext();

        await expect(manager.createManaged(option(1))).resolves.toMatchObject({ child: second });
        expect(processStubs.spawn).toHaveBeenCalledTimes(2);
    }),
    canonicalCase('R4.4', 'never automatically restarts a terminal process', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const child = spawnNext();
        await manager.createManaged(option(1));

        child.emit('exit', 0);
        await settle();
        await vi.runAllTimersAsync();

        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(registryOf(manager)).toEqual([]);
    }),
    canonicalCase('R4.5', 'does not expose encode-result or playback-state ownership', () => {
        const methods = Object.getOwnPropertyNames(ProcessManager.prototype);

        expect(methods).not.toEqual(
            expect.arrayContaining(['result', 'getResult', 'playbackState', 'getPlaybackState']),
        );
    }),
    canonicalCase('R4.6', 'does not queue a rejected start request', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const active = spawnNext();
        await manager.createManaged(option(1));
        await expect(manager.createManaged(option(1))).rejects.toThrow('EncodeProcessManageModelCreateError');

        active.emit('exit', 0);
        await settle();
        await vi.runAllTimersAsync();

        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(registryOf(manager)).toEqual([]);
    }),
    canonicalCase('R5.1', 'starts an HLS writer as a new process-group leader', async () => {
        const manager = makeManager(1);
        const child = spawnNext();

        await expect(manager.createHlsWriter(option(1))).resolves.toMatchObject({ child });
        expect(processStubs.spawn).toHaveBeenCalledWith(process.execPath, [], { detached: true });
    }),
    canonicalCase('R5.2', 'binds direct child PID PGID priority handle and slot to one entry', async () => {
        const manager = makeManager(1);
        const child = spawnNext();
        const started = await manager.createHlsWriter(option(7));
        const processInfo = registryOf(manager)[0] as {
            child: SyntheticChild;
            handle: object;
            kind: string;
            pgid: number;
            pid: number;
            priority: number;
        };

        expect(started).toEqual({ child, handle: processInfo.handle });
        expect(processInfo).toMatchObject({ child, kind: 'hls-writer', pgid: 42, pid: 42, priority: 7 });
        expect(registryOf(manager)).toHaveLength(1);
    }),
    canonicalCase('R5.3', 'rejects an HLS start that cannot establish a process-group identity', async () => {
        const manager = makeManager(1);
        const child = spawnNext();
        child.pid = 0;

        await expect(manager.createHlsWriter(option(1))).rejects.toThrow('HlsWriterProcessGroupStartError');
        expect(registryOf(manager)).toEqual([]);
    }),
    canonicalCase('R5.4', 'addresses only the process group saved at managed start', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const child = spawnNext();
        const { handle } = await manager.createHlsWriter(option(1));
        child.pid = 99;
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValueOnce(true).mockReturnValueOnce(false);
        const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});

        const stopping = manager.stopHls(handle);
        await vi.runAllTimersAsync();

        await expect(stopping).resolves.toMatchObject({ exitConfirmed: true, slotReleased: true });
        expect(signal.mock.calls).toEqual([[42, 'SIGINT']]);
    }),
    canonicalCase('R6.1', 'sends one SIGINT and polls at most three times', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        spawnNext();
        const { handle } = await manager.createHlsWriter(option(1));
        const alive = vi
            .spyOn(processUtil, 'isProcessGroupAlive')
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(false);
        const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});

        const stopping = manager.stopHls(handle);
        await vi.runAllTimersAsync();

        await expect(stopping).resolves.toEqual({
            exitConfirmed: true,
            sentSignals: ['SIGINT'],
            slotReleased: true,
        });
        expect(alive).toHaveBeenCalledTimes(4);
        expect(signal.mock.calls).toEqual([[42, 'SIGINT']]);
    }),
    canonicalCase('R6.2', 'escalates once to SIGKILL and polls at most three more times', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        spawnNext();
        const { handle } = await manager.createHlsWriter(option(1));
        const alive = vi.spyOn(processUtil, 'isProcessGroupAlive');
        for (const value of [true, true, true, true, true, true, false]) alive.mockReturnValueOnce(value);
        const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});

        const stopping = manager.stopHls(handle);
        await vi.runAllTimersAsync();

        await expect(stopping).resolves.toEqual({
            exitConfirmed: true,
            sentSignals: ['SIGINT', 'SIGKILL'],
            slotReleased: true,
        });
        expect(alive).toHaveBeenCalledTimes(7);
        expect(signal.mock.calls).toEqual([
            [42, 'SIGINT'],
            [42, 'SIGKILL'],
        ]);
    }),
    canonicalCase('R6.3', 'releases a confirmed HLS slot exactly once', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        spawnNext();
        const { handle } = await manager.createHlsWriter(option(1));
        const processInfo = registryOf(manager)[0] as { slotReleasedResolve: () => void };
        const released = vi.fn();
        processInfo.slotReleasedResolve = released;
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValueOnce(true).mockReturnValueOnce(false);
        vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});

        const stopping = manager.stopHls(handle);
        await vi.runAllTimersAsync();

        await expect(stopping).resolves.toMatchObject({ exitConfirmed: true, slotReleased: true });
        expect(released).toHaveBeenCalledOnce();
        expect(registryOf(manager)).toEqual([]);
    }),
    canonicalCase('R6.4', 'force-releases the slot after both finite polling stages remain alive', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        spawnNext();
        const { handle } = await manager.createHlsWriter(option(1));
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValue(true);
        const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});

        const stopping = manager.stopHls(handle);
        await vi.runAllTimersAsync();

        await expect(stopping).resolves.toEqual({
            exitConfirmed: false,
            sentSignals: ['SIGINT', 'SIGKILL'],
            slotReleased: true,
        });
        expect(signal).toHaveBeenCalledTimes(2);
        expect(registryOf(manager)).toEqual([]);
    }),
    canonicalCase('R6.5', 'records complete diagnostics when logical release is forced', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        spawnNext();
        const { handle } = await manager.createHlsWriter(option(1));
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValue(true);
        vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});

        const stopping = manager.stopHls(handle);
        await vi.runAllTimersAsync();
        await stopping;

        expect(logger.encode.error).toHaveBeenCalledWith(
            expect.objectContaining({
                forcedSlotRelease: true,
                pgid: 42,
                pid: 42,
                sentSignals: ['SIGINT', 'SIGKILL'],
                terminalConfirmed: false,
            }),
        );
    }),
    canonicalCase('R6.6', 'sends no additional signal after HLS stop completion', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        spawnNext();
        const { handle } = await manager.createHlsWriter(option(1));
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValueOnce(true).mockReturnValueOnce(false);
        const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});

        const stopping = manager.stopHls(handle);
        await vi.runAllTimersAsync();
        await stopping;
        await expect(manager.stopHls(handle)).resolves.toMatchObject({ sentSignals: [], slotReleased: true });

        expect(signal).toHaveBeenCalledOnce();
    }),
    canonicalCase('R6.7', 'isolates late terminal events from a newer generation', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const oldChild = spawnNext();
        const { handle } = await manager.createHlsWriter(option(1));
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValue(true);
        const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});
        const stopping = manager.stopHls(handle);
        await vi.runAllTimersAsync();
        await stopping;

        const newChild = spawnNext();
        await manager.createManaged(option(1));
        oldChild.emit('error', new Error('synthetic late error'));
        oldChild.emit('exit', 0);
        oldChild.emit('close', 0, null);

        expect(registryOf(manager)).toHaveLength(1);
        expect((registryOf(manager)[0] as { child: SyntheticChild }).child).toBe(newChild);
        expect(signal).toHaveBeenCalledTimes(2);
    }),
    canonicalCase('R6.8', 'keeps HLS artifact deletion outside logical slot release', () => {
        const methods = Object.getOwnPropertyNames(ProcessManager.prototype);

        expect(methods).not.toEqual(
            expect.arrayContaining(['delete', 'deleteAllFiles', 'removeArtifact', 'removeArtifacts']),
        );
    }),
    canonicalCase('R6.9', 'rejects a stale handle even when a numeric PID and PGID are reused', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        spawnNext();
        const old = await manager.createHlsWriter(option(1));
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValueOnce(true).mockReturnValueOnce(false);
        const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});
        const firstStop = manager.stopHls(old.handle);
        await vi.runAllTimersAsync();
        await firstStop;

        const newChild = spawnNext();
        await manager.createHlsWriter(option(1));
        await expect(manager.stopHls(old.handle)).resolves.toMatchObject({ sentSignals: [], slotReleased: true });

        expect(signal).toHaveBeenCalledOnce();
        expect(registryOf(manager)).toHaveLength(1);
        expect((registryOf(manager)[0] as { child: SyntheticChild }).child).toBe(newChild);
    }),
    canonicalCase('R6.10', 'returns one idempotent HLS stop operation and a stable stopped result', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        spawnNext();
        const { handle } = await manager.createHlsWriter(option(1));
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValueOnce(true).mockReturnValueOnce(false);
        const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});

        const first = manager.stopHls(handle);
        expect(manager.stopHls(handle)).toBe(first);
        expect(manager.stopHls(handle)).toBe(first);
        await vi.runAllTimersAsync();
        await expect(first).resolves.toMatchObject({ sentSignals: ['SIGINT'], slotReleased: true });
        await expect(manager.stopHls(handle)).resolves.toMatchObject({ sentSignals: [], slotReleased: true });

        expect(signal).toHaveBeenCalledOnce();
    }),
    canonicalCase('R6.11', 'logs helper failure and force-releases through one terminal path', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        spawnNext();
        const { handle } = await manager.createHlsWriter(option(1));
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValue(true);
        vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {
            throw new Error('synthetic canonical signal failure');
        });

        const stopping = manager.stopHls(handle);
        await vi.runAllTimersAsync();

        await expect(stopping).resolves.toMatchObject({ exitConfirmed: false, slotReleased: true });
        expect(registryOf(manager)).toEqual([]);
        expect(logger.encode.error).toHaveBeenCalledWith(expect.objectContaining({ stage: 'SIGINT-send' }));
        expect(logger.encode.error).toHaveBeenCalledWith(
            expect.objectContaining({ forcedSlotRelease: true, terminalConfirmed: false }),
        );
    }),
    canonicalCase('R7.1', 'reads the configured maximum when a manager instance starts', async () => {
        const getConfig = vi.fn(() => ({ encodeProcessNum: 0 }));
        const manager = new ProcessManager({ getLogger: () => logger }, { getConfig });

        await expect(manager.createManaged(option(1))).rejects.toThrow('EncodeProcessManageModelCreateError');
        expect(getConfig).toHaveBeenCalledOnce();
        expect(processStubs.spawn).not.toHaveBeenCalled();
    }),
    canonicalCase('R7.2', 'keeps the startup maximum fixed while the instance is running', async () => {
        const configuration = { encodeProcessNum: 1 };
        const getConfig = vi.fn(() => configuration);
        const manager = new ProcessManager({ getLogger: () => logger }, { getConfig });
        spawnNext();
        await manager.createManaged(option(1));
        configuration.encodeProcessNum = 2;

        await expect(manager.createManaged(option(1))).rejects.toThrow('EncodeProcessManageModelCreateError');
        expect(getConfig).toHaveBeenCalledOnce();
        expect(registryOf(manager)).toHaveLength(1);
    }),
    canonicalCase('R7.3', 'lets a new instance read the changed maximum', async () => {
        const configuration = { encodeProcessNum: 1 };
        const original = new ProcessManager({ getLogger: () => logger }, { getConfig: () => configuration });
        const oldChild = spawnNext();
        await original.createManaged(option(1));
        configuration.encodeProcessNum = 2;
        const restarted = new ProcessManager({ getLogger: () => logger }, { getConfig: () => configuration });
        const firstNew = spawnNext();
        await restarted.createManaged(option(1));
        const secondNew = spawnNext();
        await restarted.createManaged(option(1));

        expect(registryOf(original)).toEqual([expect.objectContaining({ child: oldChild })]);
        expect(registryOf(restarted)).toHaveLength(2);
        expect(registryOf(restarted)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ child: firstNew }),
                expect.objectContaining({ child: secondNew }),
            ]),
        );
    }),
    canonicalCase('R7.4', 'exposes no manager-owned server shutdown or drain operation', () => {
        const methods = Object.getOwnPropertyNames(ProcessManager.prototype);

        expect(methods).not.toEqual(expect.arrayContaining(['drain', 'shutdown', 'stopAll', 'terminateAll']));
    }),
];

afterEach(() => {
    for (const child of children.splice(0)) {
        child.removeAllListeners();
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
    }
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { force: true, recursive: true });
    }
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    processStubs.spawn.mockReset();
    logger.encode.error.mockClear();
    logger.encode.info.mockClear();
    logger.stream.debug.mockClear();
    logger.stream.error.mockClear();
    logger.stream.info.mockClear();
});

afterAll(() => {
    mutableChildProcess.spawn = originalSpawn;
});

describe('media process management canonical acceptance inventory', () => {
    it.each(canonicalSpecCases)('[$id] $acceptanceCriterion $title', async ({ verify }) => {
        await verify();
    });

    it('[MP-SPEC-R8-1] runs every one of the 43 acceptance criteria exactly once as a uniquely identified case', () => {
        const ranges: ReadonlyArray<readonly [number, number]> = [
            [1, 6],
            [2, 6],
            [3, 6],
            [4, 6],
            [5, 4],
            [6, 11],
            [7, 4],
        ];
        const expectedCriteria = ranges.flatMap(([requirement, count]) =>
            Array.from({ length: count }, (_value, index) => `R${requirement}.${index + 1}`),
        );

        expect(expectedCriteria).toHaveLength(43);
        expect(canonicalSpecCases).toHaveLength(43);
        expect(canonicalSpecCases.map(({ acceptanceCriterion }) => acceptanceCriterion)).toEqual(expectedCriteria);
        expect(new Set(canonicalSpecCases.map(({ id }) => id)).size).toBe(43);
        for (const { id, title, verify } of canonicalSpecCases) {
            expect({ id, title: title.trim() }).not.toEqual({ id, title: '' });
            expect(verify).toBeTypeOf('function');
        }
    });
});

describe('media process management specification characterization', () => {
    it('[MP-SPEC-R1-ATOMIC] reserves the only slot before another same-loop request can spawn', async () => {
        const manager = makeManager(1);
        const firstChild = spawnUnsettled();

        const first = manager.createManaged(option(1));
        const second = manager.createManaged(option(1));

        expect(processStubs.spawn).toHaveBeenCalledOnce();
        await expect(second).rejects.toThrow('EncodeProcessManageModelCreateError');
        firstChild.emit('spawn');
        await expect(first).resolves.toMatchObject({ child: firstChild });
    });

    it('[MP-SPEC-R1-HANDLE] returns a distinct opaque stop handle with each managed start', async () => {
        const manager = makeManager(2);
        const firstChild = spawnNext();
        const first = await manager.createManaged(option(1));
        const secondChild = spawnNext();
        const second = await manager.createManaged(option(1));

        expect(first.child).toBe(firstChild);
        expect(second.child).toBe(secondChild);
        expect(first.handle).not.toBe(second.handle);
        expect(Object.keys(first.handle)).toEqual([]);
        expect(Object.keys(second.handle)).toEqual([]);
    });

    it('[MP-SPEC-R1-CAPACITY] rejects maximum zero without spawning and starts below the captured limit', async () => {
        const disabled = makeManager(0);
        await expect(disabled.create(option(1))).rejects.toThrow('EncodeProcessManageModelCreateError');
        expect(processStubs.spawn).not.toHaveBeenCalled();

        const enabled = makeManager(1);
        const child = spawnNext();
        await expect(enabled.create(option(1))).resolves.toBe(child);
        expect(processStubs.spawn).toHaveBeenCalledTimes(1);
    });

    it('[MP-SPEC-R5-HLS-GROUP] starts an HLS writer as a new process group leader without changing caller spawn options', async () => {
        const manager = makeManager(1);
        const child = spawnNext();

        const started = await manager.createHlsWriter({
            ...option(1),
            spawnOption: { cwd: process.cwd(), env: { SYNTHETIC_HLS: '1' } },
        });

        expect(started.child).toBe(child);
        expect(started.handle).toEqual({ kind: 'hls-writer' });
        expect(processStubs.spawn).toHaveBeenCalledWith(process.execPath, [], {
            cwd: process.cwd(),
            detached: true,
            env: { SYNTHETIC_HLS: '1' },
        });
    });

    it.each([
        ['after SIGINT', [true, false], ['SIGINT'], true],
        ['after SIGKILL', [true, true, true, true, false], ['SIGINT', 'SIGKILL'], true],
        ['by forced logical release', [true, true, true, true, true, true, true], ['SIGINT', 'SIGKILL'], false],
    ] as const)(
        '[MP-SPEC-R6-HLS-STOP] finishes %s with finite polling and one slot release',
        async (_label, checks, expectedSignals, exitConfirmed) => {
            vi.useFakeTimers();
            const manager = makeManager(1);
            spawnNext();
            const { handle } = await manager.createHlsWriter(option(1));
            const alive = vi.spyOn(processUtil, 'isProcessGroupAlive');
            for (const value of checks) alive.mockReturnValueOnce(value);
            const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});

            const stopping = manager.stopHls(handle);
            await vi.runAllTimersAsync();

            await expect(stopping).resolves.toEqual({
                exitConfirmed,
                sentSignals: expectedSignals,
                slotReleased: true,
            });
            expect(signal.mock.calls).toEqual(expectedSignals.map(sent => [42, sent]));
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('[MP-SPEC-R6-HLS-IDEMPOTENT] shares concurrent stops and sends no signal after terminal release', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        spawnNext();
        const { handle } = await manager.createHlsWriter(option(1));
        vi.spyOn(processUtil, 'isProcessGroupAlive').mockReturnValueOnce(true).mockReturnValueOnce(false);
        const signal = vi.spyOn(processUtil, 'killProcessGroup').mockImplementation(() => {});

        const first = manager.stopHls(handle);
        expect(manager.stopHls(handle)).toBe(first);
        await vi.runAllTimersAsync();
        await expect(first).resolves.toMatchObject({ sentSignals: ['SIGINT'], slotReleased: true });
        await expect(manager.stopHls(handle)).resolves.toEqual({
            exitConfirmed: true,
            sentSignals: [],
            slotReleased: true,
        });
        expect(signal).toHaveBeenCalledOnce();
    });

    it('[MP-SPEC-R2-PRIORITY] replaces a lower-priority playback process for priority 10 encoding', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const playback = spawnNext();
        await manager.create(option(1));
        const encoding = spawnNext();

        const pending = manager.create(option(10));
        expect(processStubs.spawn).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(500);

        await expect(pending).resolves.toBe(encoding);
        expect(playback.kill).toHaveBeenCalledOnce();
        expect(playback.kill).toHaveBeenCalledWith('SIGINT');
        expect(processStubs.spawn).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MP-SPEC-R5-HLS-REPLACEMENT] preserves HLS process-group identity when replacing a lower-priority normal process', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const playback = spawnNext();
        await manager.createManaged(option(1));
        const writer = spawnNext();

        const pending = manager.createHlsWriter(option(10));
        await vi.advanceTimersByTimeAsync(500);
        const started = await pending;
        const processInfo = registryOf(manager)[0] as {
            child: SyntheticChild;
            kind: string;
            pgid: number;
            pid: number;
        };

        expect(playback.kill).toHaveBeenCalledWith('SIGINT');
        expect(started).toEqual({ child: writer, handle: { kind: 'hls-writer' } });
        expect(processStubs.spawn).toHaveBeenLastCalledWith(process.execPath, [], { detached: true });
        expect(processInfo).toMatchObject({ child: writer, kind: 'hls-writer', pgid: 42, pid: 42 });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MP-SPEC-R2-NEWEST] selects the most recently registered eligible lower-priority process', async () => {
        vi.useFakeTimers();
        const manager = makeManager(3);
        const oldest = spawnNext();
        vi.setSystemTime(1);
        await manager.create(option(0));
        const middle = spawnNext();
        vi.setSystemTime(2);
        await manager.create(option(1));
        const newest = spawnNext();
        vi.setSystemTime(3);
        await manager.create(option(1));
        const replacement = spawnNext();
        vi.setSystemTime(4);

        const pending = manager.create(option(10));
        await vi.advanceTimersByTimeAsync(500);

        await expect(pending).resolves.toBe(replacement);
        expect(newest.kill).toHaveBeenCalledWith('SIGINT');
        expect(middle.kill).not.toHaveBeenCalled();
        expect(oldest.kill).not.toHaveBeenCalled();
    });

    it.each([
        ['same', 10],
        ['higher', 11],
    ])('[MP-SPEC-R2-REJECT] preserves a %s-priority active process and rejects immediately', async (_label, active) => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const existing = spawnNext();
        await manager.create(option(active));

        await expect(manager.create(option(10))).rejects.toThrow('EncodeProcessManageModelCreateError');
        expect(existing.kill).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expect(processStubs.spawn).toHaveBeenCalledTimes(1);
    });

    it('[MP-SPEC-R4-NO-QUEUE] never retries a rejected request when a later terminal event frees capacity', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const active = spawnNext();
        await manager.create(option(10));
        await expect(manager.create(option(10))).rejects.toThrow('EncodeProcessManageModelCreateError');

        active.emit('exit', 0);
        await settle();
        await vi.runAllTimersAsync();

        expect(processStubs.spawn).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        ['normal exit', 'exit', 0],
        ['abnormal exit', 'exit', 1],
    ] as const)(
        '[MP-SPEC-R4-TERMINAL] removes a child after %s and permits one later explicit start',
        async (_label, event, value) => {
            const manager = makeManager(1);
            const terminal = spawnNext();
            await manager.create(option(1));
            terminal.emit(event, value);
            await settle();

            const later = spawnNext();
            await expect(manager.create(option(1))).resolves.toBe(later);
            expect(processStubs.spawn).toHaveBeenCalledTimes(2);
        },
    );

    it('[MP-SPEC-R4-ERROR] keeps a started child registered after error alone and releases it on confirmed terminal', async () => {
        const manager = makeManager(1);
        const active = spawnNext();
        await manager.createManaged(option(1));

        active.emit('error', new Error('diagnostic-only'));
        await expect(manager.createManaged(option(1))).rejects.toThrow('EncodeProcessManageModelCreateError');

        active.emit('close', 1, null);
        const later = spawnNext();
        await expect(manager.createManaged(option(1))).resolves.toMatchObject({ child: later });
    });

    it('[MP-SPEC-R3-STOP] joins duplicate stops and responds after one delayed SIGINT without waiting for terminal', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const child = spawnNext();
        const { handle } = await manager.createManaged(option(1));

        const first = manager.requestStop(handle);
        const duplicate = manager.requestStop(handle);
        expect(duplicate).toBe(first);
        expect(child.kill).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(499);
        expect(child.kill).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);

        await expect(first).resolves.toEqual({ sentSignals: ['SIGINT'], status: 'requested' });
        expect(child.kill).toHaveBeenCalledOnce();
        expect(child.kill).toHaveBeenCalledWith('SIGINT');
    });

    it('[MP-SPEC-R3-EXACT-DEADLINE] lets only the reservation owner use a slot released at exactly 3000ms', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const playback = spawnNext();
        playback.kill.mockImplementation(() => true);
        await manager.createManaged(option(1));

        const replacement = manager.createManaged(option(10));
        const replacementChild = spawnNext();
        const competing = new Promise<{ child: SyntheticChild; handle: object }>((resolve, reject) => {
            setTimeout(() => {
                playback.emit('exit', 0);
                manager.createManaged(option(1)).then(resolve, reject);
            }, 3000);
        });
        const outcomes = Promise.allSettled([replacement, competing]);

        await vi.advanceTimersByTimeAsync(2999);
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);

        const [replacementOutcome, competingOutcome] = await outcomes;
        expect(replacementOutcome.status).toBe('fulfilled');
        if (replacementOutcome.status === 'rejected') throw replacementOutcome.reason;
        expect(replacementOutcome.value).toMatchObject({ child: replacementChild });
        expect(competingOutcome.status).toBe('rejected');
        if (competingOutcome.status === 'fulfilled') throw new Error('The competing request unexpectedly started');
        expect(competingOutcome.reason).toMatchObject({ message: 'EncodeProcessManageModelCreateError' });
        expect(processStubs.spawn).toHaveBeenCalledTimes(2);
        expect(registryOf(manager)).toHaveLength(1);
        expect((registryOf(manager)[0] as { child: SyntheticChild }).child).toBe(replacementChild);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MP-SPEC-R3-AFTER-DEADLINE] rejects a slot released at 3001ms before the deadline immediate runs', async () => {
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
        const manager = makeManager(1);
        const playback = spawnNext();
        playback.kill.mockImplementation(() => true);
        await manager.createManaged(option(1));

        const replacement = manager.createManaged(option(10));
        spawnNext();
        setTimeout(() => playback.emit('exit', 0), 3001);
        const outcome = Promise.allSettled([replacement]);

        await vi.advanceTimersByTimeAsync(3000);
        expect(processStubs.spawn).toHaveBeenCalledOnce();
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

    it('[MP-SPEC-R2-TIMEOUT] does not start a replacement before release and clears its three-second timeout', async () => {
        vi.useFakeTimers();
        const manager = makeManager(1);
        const unreaped = spawnNext();
        unreaped.kill.mockImplementation(() => true);
        await manager.create(option(1));
        const pending = manager.create(option(10));
        let settled = false;
        pending.then(
            () => {
                settled = true;
            },
            () => {
                settled = true;
            },
        );

        await vi.advanceTimersByTimeAsync(2999);
        expect(settled).toBe(false);
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(settled).toBe(false);
        await vi.advanceTimersToNextTimerAsync();

        await expect(pending).rejects.toThrow('EncodeProcessManageModelTimeoutError');
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);

        const processInfo = registryOf(manager)[0] as {
            handle: object;
            state: string;
            stopRequestOperation: Promise<unknown>;
        };
        const explicitStop = manager.requestStop(processInfo.handle);
        expect(explicitStop).toBe(processInfo.stopRequestOperation);
        await expect(explicitStop).resolves.toEqual({ sentSignals: ['SIGINT'], status: 'requested' });
        expect(unreaped.kill).toHaveBeenCalledOnce();
        expect(processInfo.state).toBe('stopping');
    });
});
