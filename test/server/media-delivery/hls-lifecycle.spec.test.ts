import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    baseConfig,
    compiled,
    deferred,
    executionManager,
    fakeChild,
    fakeIdAllocator,
    fakeStream,
    logger,
} from './_media-harness';

const childProcess = createRequire(join(process.cwd(), 'package.json'))('node:child_process');
const LiveHLSStreamModel = compiled<any>('model', 'service', 'stream', 'LiveHLSStreamModel.js').default;
const RecordedHLSStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedHLSStreamModel.js').default;
const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;
const EncodeProcessManageModel = compiled<any>('model', 'service', 'encode', 'EncodeProcessManageModel.js').default;
const HLSFileDeleterModel = compiled<any>('model', 'service', 'stream', 'util', 'HLSFileDeleterModel.js').default;
const ServiceServer = compiled<any>('model', 'service', 'ServiceServer.js').default;
const FileUtil = compiled<any>('util', 'FileUtil.js').default;
const ProcessUtil = compiled<any>('util', 'ProcessUtil.js').default;
const dirs: string[] = [];

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

const lifecycleStream = (
    start: () => Promise<void> = async () => undefined,
    type: 'LiveHLS' | 'LiveStream' = 'LiveStream',
) => {
    let exit: (() => void) | undefined;
    const stream = fakeStream({ channelId: 101, isEnable: type === 'LiveStream', mode: 0, type });
    stream.start.mockImplementation(start);
    stream.setExitStream.mockImplementation((callback: () => void) => {
        exit = callback;
    });
    return { emitExit: () => exit?.(), stream };
};

const lifecycleManager = () => {
    const notifyClient = vi.fn();
    const logs = logger();
    const execution = executionManager();
    return {
        execution,
        logs,
        manager: new StreamManageModel({ getLogger: () => logs }, execution, { notifyClient }),
        notifyClient,
    };
};

const createHls = () => {
    const dir = mkdtempSync(join(tmpdir(), 'epg-hls-contract-'));
    dirs.push(dir);
    const socket = { notifyClient: vi.fn() };
    const logs = logger();
    const child = fakeChild();
    const handle = Object.freeze({ kind: 'hls-writer' });
    const model = new LiveHLSStreamModel(
        { getConfig: () => baseConfig({ streamFilePath: dir }) },
        { getLogger: () => logs },
        {
            createHlsWriter: vi.fn(async () => ({ child, handle })),
            stopHls: vi.fn(async () => ({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true })),
        },
        { deleteAllFiles: vi.fn(), setOption: vi.fn() },
        { getServiceStream: vi.fn() },
        socket,
    );
    model.setOption({ channelId: 101, cmd: '%NODE%' }, 0);
    return { dir, logs, model, socket };
};

const settleMicrotasks = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

const managedHlsWriter = () => {
    const logs = logger();
    const manager = new EncodeProcessManageModel({ getLogger: () => logs }, { getConfig: () => baseConfig() });
    const child = fakeChild();
    const handle = Object.freeze({ kind: 'hls-writer' });
    let resolveReleased!: () => void;
    // Models ChildProcessInfo.token (an opaque identity handle), named off the scanner's
    // credential-key match; revisit if EncodeProcessManageModel ever reads .token off childs.
    const identityToken = {};
    const processInfo = {
        child,
        directCloseConfirmed: false,
        directTerminalConfirmed: false,
        groupAbsentConfirmed: false,
        handle,
        identityToken,
        kind: 'hls-writer',
        pgid: 71,
        pid: 70,
        priority: 1,
        processId: 1,
        removeLifecycleListeners: vi.fn(),
        slotReleased: false,
        slotReleasedPromise: new Promise<void>(resolve => {
            resolveReleased = resolve;
        }),
        slotReleasedResolve: resolveReleased,
        state: 'running',
    };
    (manager as any).childs.push(processInfo);
    (manager as any).handles.set(handle, processInfo);
    return { handle, logs, manager };
};

describe('HLS manager lifecycle contract', () => {
    it('[PRIMARY R5.5] deletes only exact HLS artifacts without deleting an adjacent stream ID', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-public-cleanup-'));
        dirs.push(dir);
        writeFileSync(join(dir, 'stream4.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream4-0.ts'), 'owned');
        writeFileSync(join(dir, 'stream40-0.ts'), 'adjacent');
        const deleter = new HLSFileDeleterModel({ getLogger: logger });
        deleter.setOption({ streamFilePath: dir, streamId: 4 });

        await expect(deleter.deleteAllFiles()).resolves.toEqual({
            passes: 1,
            remainingFiles: [],
            status: 'cleared',
        });

        expect(existsSync(join(dir, 'stream4.m3u8'))).toBe(false);
        expect(existsSync(join(dir, 'stream4-0.ts'))).toBe(false);
        expect(existsSync(join(dir, 'stream40-0.ts'))).toBe(true);
    });

    it('[PRIMARY R5.13] reports HLS artifact scan failure as an unknown remaining state after all passes', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-public-scan-unknown-'));
        dirs.push(dir);
        writeFileSync(join(dir, 'stream4.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream4-0.ts'), 'owned');
        writeFileSync(join(dir, 'stream40-0.ts'), 'adjacent');
        const deleter = new HLSFileDeleterModel({ getLogger: logger });
        const scanFailure = new Error('synthetic public HLS scan failure');
        const scanCurrent = vi.spyOn(deleter, 'scanCurrent').mockRejectedValue(scanFailure);
        deleter.setOption({ streamFilePath: dir, streamId: 4 });

        await expect(deleter.deleteAllFiles()).resolves.toEqual({
            passes: 3,
            remainingFiles: [],
            status: 'unknown',
        });

        expect(scanCurrent).toHaveBeenCalledTimes(3);
        expect(existsSync(join(dir, 'stream4.m3u8'))).toBe(false);
        expect(existsSync(join(dir, 'stream4-0.ts'))).toBe(false);
        expect(existsSync(join(dir, 'stream40-0.ts'))).toBe(true);
    });

    it('[PRIMARY R5.1] attempts the recorded HLS writer stop once and still removes its artifacts', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-recorded-hls-public-stop-'));
        dirs.push(dir);
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'recorded-hls-writer' });
        const stopHls = vi.fn(async () => {
            throw new Error('synthetic recorded HLS writer stop failure');
        });
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            { createHlsWriter: vi.fn(async () => ({ child, handle })), stopHls },
            new HLSFileDeleterModel({ getLogger: logger }),
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 1 }, 0);
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = join(dir, 'source.ts');
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'encoded';
            model.isRecording = false;
        });

        await model.start(3);
        writeFileSync(join(dir, 'stream3.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream3-0.ts'), 'owned');
        writeFileSync(join(dir, 'stream30-0.ts'), 'adjacent');

        await expect(model.stop()).resolves.toBeUndefined();

        expect(stopHls).toHaveBeenCalledOnce();
        expect(stopHls).toHaveBeenCalledWith(handle);
        expect(existsSync(join(dir, 'stream3.m3u8'))).toBe(false);
        expect(existsSync(join(dir, 'stream3-0.ts'))).toBe(false);
        expect(existsSync(join(dir, 'stream30-0.ts'))).toBe(true);
    });

    it('[PRIMARY R5.9] records remaining HLS artifacts and force release after all cleanup passes', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-recorded-hls-force-release-event-'));
        dirs.push(dir);
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'unconfirmed-recorded-hls-writer' });
        const writerStopResult = {
            exitConfirmed: false,
            sentSignals: ['SIGINT', 'SIGKILL'] as const,
            slotReleased: true,
        };
        const stopHls = vi.fn(async () => writerStopResult);
        const artifactCleanup = {
            passes: 3,
            remainingFiles: ['stream0-remaining.ts'],
            status: 'remaining' as const,
        };
        const fileDeleter = {
            deleteAllFiles: vi
                .fn()
                .mockResolvedValueOnce({ passes: 1, remainingFiles: [], status: 'cleared' as const })
                .mockResolvedValueOnce(artifactCleanup),
            setOption: vi.fn(),
        };
        const { logs, manager } = lifecycleManager();
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: () => logs },
            { createHlsWriter: vi.fn(async () => ({ child, handle })), stopHls },
            fileDeleter,
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 1 }, 0);
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = join(dir, 'source.ts');
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'encoded';
            model.isRecording = false;
        });
        await expect(manager.start(model)).resolves.toBe(0);
        const registryAtDiagnostic: unknown[] = [];
        logs.stream.error.mockImplementation(value => {
            if (typeof value === 'object' && value !== null && (value as { event?: unknown }).event !== undefined) {
                registryAtDiagnostic.push(manager.getStreamInfos());
            }
        });

        await manager.stop(0);

        expect(stopHls).toHaveBeenCalledOnce();
        expect(stopHls).toHaveBeenCalledWith(handle);
        expect(manager.getStreamInfos()).toEqual([]);
        expect(registryAtDiagnostic).toEqual([[]]);
        expect(logs.stream.error).toHaveBeenCalledTimes(1);
        expect(logs.stream.error).toHaveBeenCalledWith({
            artifactCleanup,
            artifactCleanupFailure: undefined,
            event: 'hls-stop-finalization',
            forceReleased: true,
            streamId: 0,
            streamType: 'RecordedHLS',
            writerStopFailure: undefined,
            writerStopResult,
        });
        model.finalizeStop();
        model.finalizeStop();
        expect(logs.stream.error).toHaveBeenCalledTimes(1);
        expect(logs.stream.info).not.toHaveBeenCalledWith(
            expect.objectContaining({ event: 'hls-stream-force-release' }),
        );
    });

    it('[MD-5.7] ignores a force-release completion before an HLS lifecycle has started', () => {
        const fileDeleter = {
            deleteAllFiles: vi.fn(async () => ({ passes: 1, remainingFiles: [], status: 'cleared' as const })),
            setOption: vi.fn(),
        };
        const processManager = {
            createHlsWriter: vi.fn(),
            stopHls: vi.fn(),
        };
        const tunerManager = { openServiceStream: vi.fn() };
        const logs = logger();
        const model = new LiveHLSStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: () => logs },
            processManager,
            fileDeleter,
            tunerManager,
            { notifyClient: vi.fn() },
        );

        expect(() => model.finalizeStop()).not.toThrow();

        expect(fileDeleter.deleteAllFiles).not.toHaveBeenCalled();
        expect(processManager.createHlsWriter).not.toHaveBeenCalled();
        expect(processManager.stopHls).not.toHaveBeenCalled();
        expect(tunerManager.openServiceStream).not.toHaveBeenCalled();
        expect(logs.stream.error).not.toHaveBeenCalled();
    });

    it('[PRIMARY R5.8] records an unconfirmed writer stop result with the forced HLS release', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-recorded-hls-cleanup-reject-event-'));
        dirs.push(dir);
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'cleanup-reject-recorded-hls-writer' });
        const writerStopResult = {
            exitConfirmed: true,
            sentSignals: ['SIGINT'] as const,
            slotReleased: true,
        };
        const stopHls = vi.fn(async () => writerStopResult);
        const artifactCleanupFailure = new Error('synthetic RecordedHLS artifact cleanup failure');
        const fileDeleter = {
            deleteAllFiles: vi
                .fn()
                .mockResolvedValueOnce({ passes: 1, remainingFiles: [], status: 'cleared' as const })
                .mockRejectedValueOnce(artifactCleanupFailure),
            setOption: vi.fn(),
        };
        const { logs, manager } = lifecycleManager();
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: () => logs },
            { createHlsWriter: vi.fn(async () => ({ child, handle })), stopHls },
            fileDeleter,
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 1 }, 0);
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = join(dir, 'source.ts');
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'encoded';
            model.isRecording = false;
        });
        await expect(manager.start(model)).resolves.toBe(0);
        const registryAtDiagnostic: unknown[] = [];
        logs.stream.error.mockImplementation(value => {
            if (typeof value === 'object' && value !== null && (value as { event?: unknown }).event !== undefined) {
                registryAtDiagnostic.push(manager.getStreamInfos());
            }
        });

        await manager.stop(0);

        expect(stopHls).toHaveBeenCalledOnce();
        expect(stopHls).toHaveBeenCalledWith(handle);
        expect(fileDeleter.deleteAllFiles).toHaveBeenCalledTimes(2);
        expect(manager.getStreamInfos()).toEqual([]);
        expect(registryAtDiagnostic).toEqual([[]]);
        expect(logs.stream.error).toHaveBeenCalledTimes(1);
        expect(logs.stream.error).toHaveBeenCalledWith({
            artifactCleanup: undefined,
            artifactCleanupFailure,
            event: 'hls-stop-finalization',
            forceReleased: true,
            streamId: 0,
            streamType: 'RecordedHLS',
            writerStopFailure: undefined,
            writerStopResult,
        });
    });

    it('[PRIMARY R5.10] prevents a late recorded HLS writer result from changing a released identity', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-recorded-hls-late-stop-'));
        dirs.push(dir);
        const writer = deferred<{ child: ReturnType<typeof fakeChild>; handle: object }>();
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'late-recorded-hls-writer' });
        const stopFailure = new Error('synthetic late RecordedHLS writer stop failure');
        const earlyCleanupFailure = new Error('synthetic early RecordedHLS artifact cleanup failure');
        const lateCleanupFailure = new Error('synthetic late RecordedHLS artifact cleanup failure');
        const createHlsWriter = vi.fn(() => writer.promise);
        const stopHls = vi.fn(async () => {
            writeFileSync(join(dir, 'stream0-0.ts'), 'writer-stop-flush');
            throw stopFailure;
        });
        const { logs, manager } = lifecycleManager();
        const hlsFileDeleter = new HLSFileDeleterModel({ getLogger: () => logs });
        let cleanupCount = 0;
        const fileDeleter = {
            deleteAllFiles: vi.fn(async () => {
                cleanupCount += 1;
                const result = await hlsFileDeleter.deleteAllFiles();
                if (cleanupCount === 2) throw earlyCleanupFailure;
                if (cleanupCount === 3) throw lateCleanupFailure;
                return result;
            }),
            setOption: vi.fn((option: unknown) => hlsFileDeleter.setOption(option)),
        };
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: () => logs },
            { createHlsWriter, stopHls },
            fileDeleter,
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 1 }, 0);
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = join(dir, 'source.ts');
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'encoded';
            model.isRecording = false;
        });

        const started = manager.start(model);
        const rejectedStart = expect(started).rejects.toThrow('StreamStartStopped');
        await vi.waitFor(() => expect(createHlsWriter).toHaveBeenCalledOnce());
        await manager.stop(0);
        await rejectedStart;
        expect(manager.getStreamInfos()).toEqual([]);
        expect(logs.stream.error).not.toHaveBeenCalled();

        writeFileSync(join(dir, 'stream0.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream00-0.ts'), 'adjacent');
        writer.resolve({ child, handle });
        await vi.waitFor(() => expect(stopHls).toHaveBeenCalledOnce());

        expect(stopHls).toHaveBeenCalledWith(handle);
        await vi.waitFor(() => {
            expect(existsSync(join(dir, 'stream0.m3u8'))).toBe(false);
            expect(existsSync(join(dir, 'stream0-0.ts'))).toBe(false);
        });
        expect(existsSync(join(dir, 'stream00-0.ts'))).toBe(true);
        expect(logs.stream.error).toHaveBeenCalledTimes(1);
        expect(logs.stream.error).toHaveBeenCalledWith({
            artifactCleanup: undefined,
            artifactCleanupAttempts: [
                { failure: earlyCleanupFailure, result: undefined },
                { failure: lateCleanupFailure, result: undefined },
            ],
            artifactCleanupFailure: earlyCleanupFailure,
            event: 'hls-stop-finalization',
            forceReleased: true,
            streamId: 0,
            streamType: 'RecordedHLS',
            writerStopFailure: stopFailure,
            writerStopResult: undefined,
        });
    });

    it('[PRIMARY R3.1] reserves HLS IDs that are absent from active streams and the artifact snapshot', async () => {
        const scan = deferred<ReadonlySet<number>>();
        const recheckedIds = new Set<number>();
        let exactRecheckCount = 0;
        const artifactIndex = {
            listExact: vi.fn(async (_path: string, streamId: number) => {
                exactRecheckCount += 1;
                if (exactRecheckCount > 2) {
                    throw new Error('unexpected repeated exact recheck');
                }
                if (recheckedIds.has(streamId)) {
                    throw new Error(`duplicate exact recheck: ${streamId}`);
                }
                recheckedIds.add(streamId);
                return [];
            }),
            scanAtStartup: vi.fn(() => scan.promise),
            scanCurrent: vi.fn(() => scan.promise),
        };
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: logger }, { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) }, artifactIndex),
        );
        const first = fakeStream({ isEnable: false, type: 'LiveHLS' });
        const second = fakeStream({ isEnable: false, type: 'LiveHLS' });

        const firstResult = manager.start(first);
        const secondResult = manager.start(second);
        expect(manager.getStreamInfos()).toEqual([]);
        scan.resolve(new Set([0, 10]));

        await expect(firstResult).resolves.toBe(1);
        await expect(secondResult).resolves.toBe(2);
        expect(artifactIndex.scanAtStartup).toHaveBeenCalledOnce();
        expect(first.start).toHaveBeenCalledWith(1);
        expect(second.start).toHaveBeenCalledWith(2);
    });

    it('[MD-3.1] does not make a non-HLS start wait for HLS index initialization', async () => {
        const startup = deferred<ReadonlySet<number>>();
        const artifactIndex = {
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn(() => startup.promise),
            scanCurrent: vi.fn(async () => new Set<number>()),
        };
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: logger }, { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) }, artifactIndex),
        );
        const stream = fakeStream({ isEnable: true, type: 'LiveStream' });

        await expect(manager.start(stream)).resolves.toBe(0);
        expect(stream.start).toHaveBeenCalledWith(0);
        expect(artifactIndex.scanCurrent).not.toHaveBeenCalled();
        expect(artifactIndex.listExact).not.toHaveBeenCalled();
        startup.resolve(new Set());
        await settleMicrotasks();
    });

    it('[PRIMARY R3.15] skips an HLS ID when an exact residual artifact appears before writer start', async () => {
        const artifactIndex = {
            listExact: vi.fn(async (_path: string, streamId: number) => (streamId === 0 ? ['stream0-late.ts'] : [])),
            scanAtStartup: vi.fn(async () => new Set<number>()),
            scanCurrent: vi.fn(async () => new Set<number>()),
        };
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: logger }, { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) }, artifactIndex),
        );
        const stream = fakeStream({ isEnable: false, type: 'RecordedHLS' });

        await expect(manager.start(stream)).resolves.toBe(1);

        expect(artifactIndex.listExact.mock.calls).toEqual([
            ['synthetic-hls-root', 0],
            ['synthetic-hls-root', 1],
        ]);
        expect(stream.start).toHaveBeenCalledOnce();
        expect(stream.start).toHaveBeenCalledWith(1);
        expect(manager.getStreamInfos().map(({ streamId }: any) => streamId)).toEqual([1]);
    });

    it('[MD-3.3][MD-3.13] applies the existing start deadline to an unresolved artifact snapshot', async () => {
        vi.useFakeTimers();
        const scan = deferred<ReadonlySet<number>>();
        const artifactIndex = {
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn(() => scan.promise),
            scanCurrent: vi.fn(() => scan.promise),
        };
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: logger }, { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) }, artifactIndex),
        );
        const stream = fakeStream({ isEnable: false, type: 'LiveHLS' });
        const result = manager.start(stream);
        const rejection = expect(result).rejects.toThrow('StreamStartTimeout');

        await vi.advanceTimersByTimeAsync(30_000);
        await rejection;

        expect(stream.start).not.toHaveBeenCalled();
        expect(manager.getStreamInfos()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-3.13] expires an unresolved snapshot at the absolute deadline from a nonzero monotonic origin', async () => {
        vi.useFakeTimers();
        let monotonicNow = 10_000;
        vi.spyOn(globalThis.performance, 'now').mockImplementation(() => monotonicNow);
        const scan = deferred<ReadonlySet<number>>();
        const artifactIndex = {
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn(() => scan.promise),
            scanCurrent: vi.fn(() => scan.promise),
        };
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: logger }, { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) }, artifactIndex),
        );
        const stream = fakeStream({ isEnable: false, type: 'LiveHLS' });
        const settlements: unknown[] = [];
        void manager.start(stream).catch(error => settlements.push(error));

        await vi.advanceTimersByTimeAsync(29_999);
        monotonicNow += 29_999;
        expect(settlements).toEqual([]);
        monotonicNow += 1;
        await vi.advanceTimersByTimeAsync(1);
        await settleMicrotasks();

        expect(settlements).toEqual([expect.objectContaining({ message: 'StreamStartTimeout' })]);
        expect(stream.start).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-3.13] shares one absolute deadline across a 29,999ms snapshot and the remaining start budget', async () => {
        vi.useFakeTimers();
        let monotonicNow = 10_000;
        vi.spyOn(globalThis.performance, 'now').mockImplementation(() => monotonicNow);
        const startup = deferred<ReadonlySet<number>>();
        const body = deferred<void>();
        const artifactIndex = {
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn(() => startup.promise),
            scanCurrent: vi.fn(async () => new Set<number>()),
        };
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: logger }, { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) }, artifactIndex),
        );
        const stream = fakeStream({ isEnable: false, type: 'LiveHLS' });
        stream.start.mockImplementation(() => body.promise);
        const result = manager.start(stream);
        const settlements: unknown[] = [];
        void result.catch(error => settlements.push(error));

        await vi.advanceTimersByTimeAsync(29_999);
        monotonicNow += 29_999;
        startup.resolve(new Set());
        await settleMicrotasks();
        await settleMicrotasks();
        await settleMicrotasks();
        expect(stream.start).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(1);

        monotonicNow += 1;
        await vi.advanceTimersByTimeAsync(1);
        await settleMicrotasks();
        expect(settlements).toEqual([expect.objectContaining({ message: 'StreamStartTimeout' })]);
        expect(stream.stop).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(stream.stop).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    // 30_000 (30s) is StreamManageModel.MEDIA_DELIVERY_START_TIMEOUT_MS
    // (src/model/service/stream/manager/StreamManageModel.ts:831), a v3-only stream-start
    // deadline with no v2 counterpart -- approved in
    // .kiro/specs/server-media-delivery/design.md:200-304 (see :213).
    it.each([
        ['29,999ms', 29_999, false],
        ['30,000ms', 30_000, true],
        ['30,001ms', 30_001, true],
    ] as const)(
        '[MD-3.13] checks monotonic settlement at %s even before the deadline callback runs',
        async (_label, elapsed, shouldTimeout) => {
            vi.useFakeTimers();
            let monotonicNow = 10_000;
            vi.spyOn(globalThis.performance, 'now').mockImplementation(() => monotonicNow);
            const startup = deferred<ReadonlySet<number>>();
            const artifactIndex = {
                listExact: vi.fn(async () => []),
                scanAtStartup: vi.fn(() => startup.promise),
                scanCurrent: vi.fn(async () => new Set<number>()),
            };
            const manager = new StreamManageModel(
                { getLogger: logger },
                executionManager(),
                { notifyClient: vi.fn() },
                fakeIdAllocator({ getLogger: logger }, { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) }, artifactIndex),
            );
            const stream = fakeStream({ isEnable: false, type: 'LiveHLS' });
            const result = manager.start(stream);

            monotonicNow += elapsed;
            startup.resolve(new Set());
            await settleMicrotasks();
            await settleMicrotasks();

            if (shouldTimeout) {
                await expect(result).rejects.toThrow('StreamStartTimeout');
                expect(stream.start).not.toHaveBeenCalled();
                expect(manager.getStreamInfos()).toEqual([]);
            } else {
                await expect(result).resolves.toBe(0);
                expect(stream.start).toHaveBeenCalledOnce();
            }
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('[MD-3.13] rounds a fractional remaining shared budget up to one effective millisecond timer', async () => {
        vi.useFakeTimers();
        let monotonicNow = 10_000.25;
        vi.spyOn(globalThis.performance, 'now').mockImplementation(() => monotonicNow);
        const startup = deferred<ReadonlySet<number>>();
        const body = deferred<void>();
        const artifactIndex = {
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn(() => startup.promise),
            scanCurrent: vi.fn(async () => new Set<number>()),
        };
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: logger }, { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) }, artifactIndex),
        );
        const stream = fakeStream({ isEnable: false, type: 'LiveHLS' });
        stream.start.mockImplementation(() => body.promise);
        const result = manager.start(stream);

        monotonicNow = 39_999.5;
        startup.resolve(new Set());
        await settleMicrotasks();
        await settleMicrotasks();
        await settleMicrotasks();
        expect(stream.start).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(1);

        const rejection = expect(result).rejects.toThrow('StreamStartTimeout');
        monotonicNow = 40_000.25;
        await vi.advanceTimersByTimeAsync(1);
        await rejection;
        expect(stream.stop).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[PRIMARY R3.17] retries a failed HLS artifact initialization on the first later HLS request', async () => {
        const failure = new Error('synthetic startup scan failure');
        const logs = logger();
        const artifactIndex = {
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(new Set<number>()),
            scanCurrent: vi.fn(async () => new Set<number>()),
        };
        const manager = new StreamManageModel(
            { getLogger: () => logs },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: () => logs }, { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) }, artifactIndex),
        );
        await settleMicrotasks();
        const stream = fakeStream({ isEnable: false, type: 'LiveHLS' });

        await expect(manager.start(stream)).resolves.toBe(0);

        expect(artifactIndex.scanAtStartup).toHaveBeenCalledTimes(2);
        expect(logs.stream.error).toHaveBeenCalledWith('hls artifact index initialization error: synthetic-hls-root');
        expect(logs.stream.error).toHaveBeenCalledWith(failure);
        expect(stream.start).toHaveBeenCalledOnce();
    });

    it('[PRIMARY R3.14] reserves IDs discovered by the startup HLS artifact scan', async () => {
        const artifactIndex = {
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn(async () => new Set([0])),
            scanCurrent: vi.fn(async () => new Set<number>()),
        };
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: logger }, { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) }, artifactIndex),
        );

        const stream = fakeStream({ isEnable: false, type: 'LiveHLS' });
        await expect(manager.start(stream)).resolves.toBe(1);
        expect(stream.start).toHaveBeenCalledWith(1);
    });

    it('[MD-3.13][MD-3.17] rejects a failed current snapshot and clears the start deadline', async () => {
        vi.useFakeTimers();
        const failure = new Error('synthetic current scan failure');
        const logs = logger();
        const artifactIndex = {
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn(async () => new Set<number>()),
            scanCurrent: vi.fn(async () => {
                throw failure;
            }),
        };
        const manager = new StreamManageModel(
            { getLogger: () => logs },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: () => logs }, { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) }, artifactIndex),
        );

        const stream = fakeStream({ isEnable: false, type: 'LiveHLS' });
        await expect(manager.start(stream)).rejects.toBe(failure);
        expect(stream.start).not.toHaveBeenCalled();
        expect(logs.stream.error).toHaveBeenCalledWith('start stream error');
        expect(logs.stream.error).toHaveBeenCalledWith(failure);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[PRIMARY R4.3] stops the requested HLS reservation before it can start external work', async () => {
        const files = deferred<string[]>();
        const artifactIndex = {
            listExact: vi
                .fn()
                .mockImplementationOnce(() => files.promise)
                .mockRejectedValue(new Error('unexpected stale exact recheck')),
            scanAtStartup: vi.fn(async () => new Set<number>()),
            scanCurrent: vi.fn(async () => new Set<number>()),
        };
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: logger }, { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) }, artifactIndex),
        );
        const stream = fakeStream({ isEnable: false, type: 'LiveHLS' });
        const starting = manager.start(stream);
        await vi.waitFor(() => expect(artifactIndex.listExact).toHaveBeenCalledOnce());

        await manager.stop(0);
        files.resolve(['stream0-late.ts']);
        await settleMicrotasks();

        await expect(starting).rejects.toThrow('StreamStartStopped');
        expect(stream.start).not.toHaveBeenCalled();
        expect(manager.getStreamInfos()).toEqual([]);
    });

    it('[MD-4.10] keeps a replacement HLS state unchanged after an old terminal recheck rejects', async () => {
        const oldFiles = deferred<string[]>();
        const artifactIndex = {
            listExact: vi
                .fn()
                .mockImplementationOnce(() => oldFiles.promise)
                .mockResolvedValue([]),
            scanAtStartup: vi.fn(async () => new Set<number>()),
            scanCurrent: vi.fn(async () => new Set<number>()),
        };
        const idAllocator = fakeIdAllocator(
            { getLogger: logger },
            { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) },
            artifactIndex,
        );
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            idAllocator,
        );
        const old = fakeStream({ isEnable: false, type: 'LiveHLS' });
        const replacement = fakeStream({ isEnable: false, type: 'LiveHLS' });
        const oldResult = manager.start(old);
        const oldRejection = oldResult.catch(error => error);
        await vi.waitFor(() => expect(artifactIndex.listExact).toHaveBeenCalledOnce());
        await manager.stop(0);
        (idAllocator as any).allocationCursor = 0;
        await expect(manager.start(replacement)).resolves.toBe(0);
        const replacementArtifacts = new Set((idAllocator as any).currentArtifactIds);

        oldFiles.reject(new Error('stale exact recheck failure'));
        await settleMicrotasks();
        await expect(oldRejection).resolves.toMatchObject({ message: 'StreamStartStopped' });

        expect((idAllocator as any).currentArtifactIds).toEqual(replacementArtifacts);
        expect(manager.getStreamInfo(0)).toEqual(replacement.getInfo());
        expect(replacement.stop).not.toHaveBeenCalled();
    });

    it('[MD-3.3][MD-3.17] rejects an exact recheck failure and quarantines that ID', async () => {
        const failure = new Error('synthetic exact recheck failure');
        const logs = logger();
        const artifactIndex = {
            listExact: vi.fn(async () => {
                throw failure;
            }),
            scanAtStartup: vi.fn(async () => new Set<number>()),
            scanCurrent: vi.fn(async () => new Set<number>()),
        };
        const idAllocator = fakeIdAllocator(
            { getLogger: () => logs },
            { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) },
            artifactIndex,
        );
        const manager = new StreamManageModel(
            { getLogger: () => logs },
            executionManager(),
            { notifyClient: vi.fn() },
            idAllocator,
        );
        const stream = fakeStream({ isEnable: false, type: 'LiveHLS' });

        await expect(manager.start(stream)).rejects.toBe(failure);
        expect((idAllocator as any).currentArtifactIds).toEqual(new Set([0]));
        expect(logs.stream.error).toHaveBeenCalledWith('start stream error');
        expect(logs.stream.error).toHaveBeenCalledWith(failure);
        expect(stream.start).not.toHaveBeenCalled();
    });

    it('[MD-3.1] enables artifact indexing only when configuration and index are both present', () => {
        // This capability belongs to the IStreamIdAllocator collaborator StreamManageModel
        // delegates to (StreamManageModel itself does not know what "artifact indexing" means),
        // so it is asserted directly against the allocator rather than through the manager.
        const create = (configuration?: object, artifactIndex?: object) =>
            fakeIdAllocator({ getLogger: logger }, configuration, artifactIndex);
        const configuration = { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) };
        const artifactIndex = {
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn(async () => new Set<number>()),
            scanCurrent: vi.fn(async () => new Set<number>()),
        };

        expect(create().isAvailable()).toBe(false);
        expect(create(configuration).isAvailable()).toBe(false);
        expect(create(undefined, artifactIndex).isAvailable()).toBe(false);
        expect(create(configuration, artifactIndex).isAvailable()).toBe(true);
    });

    it('[MD-3.3] prevents an older late snapshot from replacing a newer confirmed artifact set', async () => {
        const older = deferred<ReadonlySet<number>>();
        const newer = deferred<ReadonlySet<number>>();
        const artifactIndex = {
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn(async () => new Set<number>()),
            scanCurrent: vi
                .fn()
                .mockImplementationOnce(() => older.promise)
                .mockImplementationOnce(() => newer.promise),
        };
        const idAllocator = fakeIdAllocator(
            { getLogger: logger },
            { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) },
            artifactIndex,
        );
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            idAllocator,
        );
        const first = fakeStream({ isEnable: false, type: 'LiveHLS' });
        const second = fakeStream({ isEnable: false, type: 'LiveHLS' });
        const firstResult = manager.start(first);
        const secondResult = manager.start(second);

        newer.resolve(new Set([0, 5]));
        await expect(secondResult).resolves.toBe(1);
        older.resolve(new Set());
        await expect(firstResult).resolves.toBe(2);

        expect((idAllocator as any).currentArtifactIds).toEqual(new Set([0, 5]));
    });

    it('[PRIMARY R3.3] wraps the HLS allocation cursor and skips active identifiers', async () => {
        const artifactIndex = {
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn(async () => new Set<number>()),
            scanCurrent: vi.fn(async () => new Set<number>()),
        };
        const idAllocator = fakeIdAllocator(
            { getLogger: logger },
            { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) },
            artifactIndex,
        );
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            idAllocator,
        );
        (idAllocator as any).allocationCursor = Number.MAX_SAFE_INTEGER;
        const max = fakeStream({ isEnable: false, type: 'LiveHLS' });
        const wrapped = fakeStream({ isEnable: false, type: 'LiveHLS' });

        await expect(manager.start(max)).resolves.toBe(Number.MAX_SAFE_INTEGER);
        await expect(manager.start(wrapped)).resolves.toBe(0);
        await manager.stop(0);
        await manager.stop(Number.MAX_SAFE_INTEGER);

        const next = fakeStream({ isEnable: false, type: 'LiveHLS' });
        await expect(manager.start(next)).resolves.toBe(0);
    });

    it('[PRIMARY R3.2] does not reuse the just force-released HLS ID as the next allocation candidate', async () => {
        const artifactIndex = {
            deleteAllFiles: vi.fn(async () => ({ passes: 1, remainingFiles: [], status: 'cleared' as const })),
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn(async () => new Set<number>()),
            scanCurrent: vi.fn(async () => new Set<number>()),
            setOption: vi.fn(),
        };
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: logger }, { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) }, artifactIndex),
        );
        const ended = lifecycleStream(async () => undefined, 'LiveHLS');
        const cursorAdvance = lifecycleStream(async () => undefined, 'LiveHLS');
        const replacement = lifecycleStream(async () => undefined, 'LiveHLS');
        await expect(manager.start(ended.stream)).resolves.toBe(0);
        await expect(manager.start(cursorAdvance.stream)).resolves.toBe(1);
        await manager.stop(1);

        ended.emitExit();
        await vi.waitFor(() => expect(manager.getStreamInfos()).toEqual([]));

        await expect(manager.start(replacement.stream)).resolves.toBe(1);
    });

    it('[MD-3.2][MD-5.7] keeps the reusable ID after a non-HLS identity removal', async () => {
        const current = lifecycleStream();
        const replacement = lifecycleStream(undefined, 'LiveHLS');
        const artifactIndex = {
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn(async () => new Set<number>()),
            scanCurrent: vi.fn(async () => new Set<number>()),
        };
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: logger }, { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) }, artifactIndex),
        );

        await expect(manager.start(current.stream)).resolves.toBe(0);
        await manager.stop(0);

        await expect(manager.start(replacement.stream)).resolves.toBe(0);
    });

    it('[MD-5.7][MD-5.12] preserves an HLS model without the internal force-release callback', async () => {
        const current = lifecycleStream(undefined, 'LiveHLS');
        const { manager, notifyClient } = lifecycleManager();

        await expect(manager.start(current.stream)).resolves.toBe(0);
        const notificationsBeforeStop = notifyClient.mock.calls.length;
        await expect(manager.stop(0)).resolves.toBeUndefined();

        expect(manager.getStreamInfos()).toEqual([]);
        expect(notifyClient).toHaveBeenCalledTimes(notificationsBeforeStop + 2);
    });

    it('[MD-3.2] finds the first gap across the safe-integer wrap boundary', async () => {
        const artifactIndex = {
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn(async () => new Set<number>()),
            scanCurrent: vi.fn(async () => new Set([0, 2, Number.MAX_SAFE_INTEGER])),
        };
        const idAllocator = fakeIdAllocator(
            { getLogger: logger },
            { getConfig: () => ({ streamFilePath: 'synthetic-hls-root' }) },
            artifactIndex,
        );
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            idAllocator,
        );
        (idAllocator as any).allocationCursor = Number.MAX_SAFE_INTEGER;
        const stream = fakeStream({ isEnable: false, type: 'LiveHLS' });

        await expect(manager.start(stream)).resolves.toBe(1);
        expect(stream.start).toHaveBeenCalledWith(1);
    });

    it('[PRIMARY R4.8] treats a request to stop an absent delivery as already stopped', async () => {
        const socket = { notifyClient: vi.fn() };
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), socket);
        const stream = fakeStream({ isEnable: false, type: 'LiveHLS' });
        await expect(manager.start(stream)).resolves.toBe(0);
        expect(manager.getStreamInfos()).toEqual([{ info: { isEnable: false, type: 'LiveHLS' }, streamId: 0 }]);
        manager.keep(0);
        expect(stream.keep).toHaveBeenCalledOnce();
        expect(() => manager.keep(404)).toThrow('StreamIsUndefined');
        await expect(manager.stop(404)).resolves.toBeUndefined();
        await manager.stop(0);
        expect(socket.notifyClient).toHaveBeenCalledTimes(3);
    });

    it('[MD-4.7] retains a stream ID while an explicit stop operation is pending', async () => {
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        const gate = deferred<void>();
        const first = fakeStream({ type: 'RecordedHLS' });
        first.stop.mockImplementation(() => gate.promise);
        await manager.start(first);
        const stopping = manager.stop(0);
        await vi.waitFor(() => expect(first.stop).toHaveBeenCalledOnce());
        const second = fakeStream({ type: 'LiveHLS' });
        await expect(manager.start(second)).resolves.toBe(1);
        gate.resolve(undefined);
        await stopping;
        expect((manager as { drain?: unknown }).drain).toBeUndefined();
        expect((manager as { restore?: unknown }).restore).toBeUndefined();
    });

    it('[PRIMARY R5.12] continues HLS force-release cleanup despite a writer-stop and diagnostic failure', async () => {
        const cleanupFailure = new Error('synthetic HLS cleanup failure');
        const diagnosticFailure = new Error('synthetic diagnostic failure');
        const old = lifecycleStream(async () => undefined, 'LiveHLS');
        old.stream.stop.mockRejectedValue(cleanupFailure);
        const replacement = lifecycleStream(async () => undefined, 'LiveHLS');
        const { logs, manager } = lifecycleManager();
        logs.stream.error.mockImplementation(() => {
            throw diagnosticFailure;
        });
        await manager.start(old.stream);

        await expect(Promise.all([manager.stop(0, true), manager.stop(0, true)])).resolves.toEqual([
            undefined,
            undefined,
        ]);

        expect(old.stream.stop).toHaveBeenCalledOnce();
        expect(manager.getStreamInfos()).toEqual([]);
        await expect(manager.start(replacement.stream)).resolves.toBe(0);
        old.emitExit();
        await settleMicrotasks();

        expect(replacement.stream.stop).not.toHaveBeenCalled();
        expect(manager.getStreamInfo(0)).toEqual(replacement.stream.getInfo());
    });
});

describe('delivery start coordinator contract', () => {
    it('[PRIMARY R4.1] lists accepted live and recorded delivery objects while later starts are pending', async () => {
        const firstStart = deferred<void>();
        const secondStart = deferred<void>();
        const first = lifecycleStream(() => firstStart.promise);
        const second = lifecycleStream(() => secondStart.promise);
        const { manager } = lifecycleManager();

        const firstResult = manager.start(first.stream);
        expect(manager.getStreamInfos().map(({ streamId }: any) => streamId)).toEqual([0]);
        manager.keep(0);
        expect(first.stream.keep).toHaveBeenCalledOnce();

        const secondResult = manager.start(second.stream);
        expect(manager.getStreamInfos().map(({ streamId }: any) => streamId)).toEqual([0, 1]);
        secondStart.resolve(undefined);
        await expect(secondResult).resolves.toBe(1);
        expect(first.stream.start).toHaveBeenCalledWith(0);
        expect(second.stream.start).toHaveBeenCalledWith(1);

        firstStart.resolve(undefined);
        await expect(firstResult).resolves.toBe(0);
    });

    it('[PRIMARY R4.4] stops only the delivery objects present when stop-all is accepted', async () => {
        const firstStop = deferred<void>();
        const first = lifecycleStream();
        first.stream.stop.mockImplementation(() => firstStop.promise);
        const second = lifecycleStream();
        const third = lifecycleStream();
        const { execution, manager } = lifecycleManager();
        await manager.start(first.stream);
        await manager.start(second.stream);
        const stopReasons: string[] = [];
        (manager as any).streams[0].resources.adopt((reason: string) => stopReasons.push(`0:${reason}`));
        (manager as any).streams[1].resources.adopt((reason: string) => stopReasons.push(`1:${reason}`));

        const stopping = manager.stopAll();
        await settleMicrotasks();
        expect(first.stream.stop).toHaveBeenCalledOnce();

        const thirdId = await manager.start(third.stream);
        expect(thirdId).toBe(2);
        firstStop.resolve(undefined);
        await stopping;

        expect(second.stream.stop).toHaveBeenCalledOnce();
        expect(third.stream.stop).not.toHaveBeenCalled();
        expect(manager.getStreamInfos().map(({ streamId }: any) => streamId)).toEqual([2]);
        expect(stopReasons).toEqual(['0:explicit-stop', '1:explicit-stop']);
        expect(execution.getExecution.mock.calls).toEqual([[1], [1], [10], [1], [10]]);
    });

    it('[MD-4.6] ignores a terminal callback from a LiveHLS object whose ID was already reused', async () => {
        const oldStream = lifecycleStream();
        const replacement = lifecycleStream();
        const { manager } = lifecycleManager();
        expect(await manager.start(oldStream.stream)).toBe(0);
        await manager.stop(0);
        expect(await manager.start(replacement.stream)).toBe(0);

        oldStream.emitExit();
        await settleMicrotasks();

        expect(replacement.stream.stop).not.toHaveBeenCalled();
        expect(manager.getStreamInfo(0)).toEqual(replacement.stream.getInfo());
    });

    it('[MD-1.8][MD-2.12] rejects at 30 seconds and sends late success only to old-object cleanup', async () => {
        vi.useFakeTimers();
        const lateStart = deferred<void>();
        const late = lifecycleStream(() => lateStart.promise);
        const replacement = lifecycleStream();
        const { manager } = lifecycleManager();
        const result = manager.start(late.stream);
        const rejection = expect(result).rejects.toThrow(/timeout/i);

        await vi.advanceTimersByTimeAsync(29_999);
        expect(late.stream.stop).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await rejection;
        expect(late.stream.stop).toHaveBeenCalledOnce();

        expect(await manager.start(replacement.stream)).toBe(0);
        lateStart.resolve(undefined);
        await settleMicrotasks();

        expect(late.stream.stop).toHaveBeenCalledTimes(2);
        expect(replacement.stream.stop).not.toHaveBeenCalled();
        expect(manager.getStreamInfo(0)).toEqual(replacement.stream.getInfo());
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[PRIMARY R3.13] leaves an established HLS readiness check running without an overall deadline', async () => {
        vi.useFakeTimers();
        const established = lifecycleStream();
        const hls = lifecycleStream(async () => undefined, 'LiveHLS');
        const { manager, notifyClient } = lifecycleManager();

        await expect(manager.start(established.stream)).resolves.toBe(0);
        await expect(manager.start(hls.stream)).resolves.toBe(1);
        expect(vi.getTimerCount()).toBe(0);
        expect(notifyClient).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(60_000);

        expect(established.stream.stop).not.toHaveBeenCalled();
        expect(hls.stream.stop).not.toHaveBeenCalled();
        expect(manager.getStreamInfo(1).type).toBe('LiveHLS');
    });
});

describe('HLS public readiness contract', () => {
    it('[PRIMARY R3.4] returns an accepted HLS identifier while the HLS stream remains unready', async () => {
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        const stream = fakeStream({ isEnable: false, type: 'LiveHLS' });

        await expect(manager.start(stream)).resolves.toBe(0);

        expect(manager.getStreamInfo(0)).toEqual(stream.getInfo());
        expect(stream.start).toHaveBeenCalledWith(0);
    });

    it('[PRIMARY R3.5] keeps HLS unavailable while its parent playlist and media artifacts are absent', async () => {
        vi.useFakeTimers();
        const { model, socket } = createHls();

        model.startCheckStreamEnable(2);
        await vi.advanceTimersByTimeAsync(100);

        expect(model.getInfo().isEnable).toBe(false);
        expect(socket.notifyClient).not.toHaveBeenCalled();
        await model.stop();
    });

    it('[PRIMARY R3.6] marks HLS viewable only after its exact parent playlist and two media artifacts exist', async () => {
        vi.useFakeTimers();
        const { dir, model, socket } = createHls();
        writeFileSync(join(dir, 'stream3.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream3-0.ts'), 'a');
        writeFileSync(join(dir, 'stream3-1.ts'), 'b');
        const ready = new Promise<void>(resolve => socket.notifyClient.mockImplementationOnce(resolve));

        model.startCheckStreamEnable(3);
        await vi.advanceTimersByTimeAsync(100);
        await ready;

        expect(model.getInfo().isEnable).toBe(true);
        expect(socket.notifyClient).toHaveBeenCalledOnce();
        await model.stop();
    });

    it('[PRIMARY R3.7] adds available subtitle metadata to the HLS parent playlist', async () => {
        vi.useFakeTimers();
        const { dir, model, socket } = createHls();
        writeFileSync(join(dir, 'stream7.m3u8'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmedia.m3u8');
        writeFileSync(join(dir, 'stream7-child_vtt.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream7-0.ts'), 'a');
        writeFileSync(join(dir, 'stream7-1.ts'), 'b');
        const ready = new Promise<void>(resolve => socket.notifyClient.mockImplementationOnce(resolve));

        model.startCheckStreamEnable(7);
        await vi.advanceTimersByTimeAsync(100);
        await ready;

        const playlist = await import('node:fs/promises').then(fs => fs.readFile(join(dir, 'stream7.m3u8'), 'utf8'));
        expect(playlist).toContain('TYPE=SUBTITLES');
        await model.stop();
    });

    it('[PRIMARY R3.8] writes the HLS parent playlist directly below the configured common HLS directory', () => {
        const { dir, model } = createHls();

        expect(model.createProcessOption(8)).toMatchObject({ output: `${dir}/stream8.m3u8` });
    });

    it('[PRIMARY R3.9] exposes the configured HLS artifact directory at the stable public streamfiles route', () => {
        const server = Object.create(ServiceServer.prototype) as any;
        server.app = { use: vi.fn() };
        server.config = { streamFilePath: 'synthetic-stream-root', thumbnail: 'synthetic-thumbnails' };
        server.createUrl = (value: string) => `/subdir${value}`;

        server.setStaticFiles();

        expect(server.app.use.mock.calls.some((call: unknown[]) => call[0] === '/subdir/streamfiles')).toBe(true);
    });

    it('[PRIMARY R3.10] extends an HLS keep deadline to fifteen seconds for a valid keep request', async () => {
        vi.useFakeTimers();
        const { model } = createHls();
        const stop = vi.spyOn(model, 'stop').mockResolvedValue(undefined);
        model.setStopTimer();
        await vi.advanceTimersByTimeAsync(14_999);
        model.keep();
        await vi.advanceTimersByTimeAsync(14_999);

        expect(stop).not.toHaveBeenCalled();
        await model.stop();
    });

    it('[PRIMARY R3.11] stops an HLS stream when no keep request arrives within fifteen seconds', async () => {
        vi.useFakeTimers();
        const { model } = createHls();
        const stop = vi.spyOn(model, 'stop').mockResolvedValue(undefined);
        model.setStopTimer();

        await vi.advanceTimersByTimeAsync(15_000);

        expect(stop).toHaveBeenCalledOnce();
    });

    it('[PRIMARY R3.12] checks HLS readiness at a one-hundred-millisecond interval', async () => {
        vi.useFakeTimers();
        const { dir, model, socket } = createHls();
        model.startCheckStreamEnable(12);
        writeFileSync(join(dir, 'stream12.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream12-0.ts'), 'a');
        writeFileSync(join(dir, 'stream12-1.ts'), 'b');
        const ready = new Promise<void>(resolve => socket.notifyClient.mockImplementationOnce(resolve));

        await vi.advanceTimersByTimeAsync(99);
        expect(model.getInfo().isEnable).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await ready;

        expect(model.getInfo().isEnable).toBe(true);
        expect(socket.notifyClient).toHaveBeenCalledOnce();
        await model.stop();
    });

    it('[PRIMARY R3.16] creates a missing HLS directory before scanning its artifacts', async () => {
        const root = mkdtempSync(join(tmpdir(), 'epg-hls-directory-contract-'));
        dirs.push(root);
        const dir = join(root, 'streamfiles');
        const index = new HLSFileDeleterModel({ getLogger: logger });

        await expect(index.scanAtStartup(dir)).resolves.toEqual(new Set());

        expect(existsSync(dir)).toBe(true);
    });

    it('[PRIMARY R4.2] exposes delivery format, mode, readiness, and target information in the public list', async () => {
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        const info = { channelId: 101, isEnable: false, mode: 2, type: 'LiveHLS' };
        const stream = fakeStream(info);

        await manager.start(stream);

        expect(manager.getStreamInfos()).toEqual([{ info, streamId: 0 }]);
    });

    it('[PRIMARY R4.9] rejects a keep request for an HLS delivery that is no longer managed', () => {
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });

        expect(() => manager.keep(404)).toThrow('StreamIsUndefined');
    });

    it('[PRIMARY R4.11] keeps a stopping HLS identifier unavailable to a new HLS start', async () => {
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        const gate = deferred<void>();
        const stopping = fakeStream({ isEnable: false, type: 'LiveHLS' });
        stopping.stop.mockImplementation(() => gate.promise);
        await manager.start(stopping);
        const terminal = manager.stop(0);
        await vi.waitFor(() => expect(stopping.stop).toHaveBeenCalledOnce());

        await expect(manager.start(fakeStream({ isEnable: false, type: 'LiveHLS' }))).resolves.toBe(1);
        gate.resolve(undefined);
        await terminal;
    });

    it('[MD-4.6] stops the active LiveHLS delivery when its writer reaches a terminal event', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-live-hls-terminal-contract-'));
        dirs.push(dir);
        const tuner = new PassThrough();
        const close = vi.fn(() => tuner.destroy());
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'live-hls-terminal-writer' });
        const stopHls = vi.fn(async () => ({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true }));
        const model = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            { createHlsWriter: vi.fn(async () => ({ child, handle })), stopHls },
            new HLSFileDeleterModel({ getLogger: logger }),
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101, cmd: '%NODE%' }, 0);
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });

        await expect(manager.start(model)).resolves.toBe(0);
        child.emit('exit', 0);
        await vi.waitFor(() => expect(manager.getStreamInfos()).toEqual([]));

        expect(stopHls).toHaveBeenCalledOnce();
        expect(stopHls).toHaveBeenCalledWith(handle);
        expect(close).toHaveBeenCalledOnce();
    });

    it('[PRIMARY R4.6] removes an untransformed LiveHLS delivery when its tuner body terminates', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-live-hls-tuner-terminal-contract-'));
        dirs.push(dir);
        const tuner = new PassThrough();
        const model = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            {
                createHlsWriter: vi.fn(),
                stopHls: vi.fn(async () => ({ exitConfirmed: true, sentSignals: [], slotReleased: true })),
            },
            new HLSFileDeleterModel({ getLogger: logger }),
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(), stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101 }, 0);
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });

        await expect(manager.start(model)).resolves.toBe(0);
        expect(manager.getStreamInfos()).toHaveLength(1);

        tuner.emit('end');

        await vi.waitFor(() => expect(manager.getStreamInfos()).toEqual([]));
    });

    it('[MD-4.7] retains completed RecordedHLS artifacts until an explicit stop request arrives', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-recorded-hls-terminal-contract-'));
        dirs.push(dir);
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'recorded-hls-terminal-writer' });
        const stopHls = vi.fn(async () => ({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true }));
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            { createHlsWriter: vi.fn(async () => ({ child, handle })), stopHls },
            new HLSFileDeleterModel({ getLogger: logger }),
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 1 }, 0);
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = join(dir, 'source.ts');
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'encoded';
            model.isRecording = false;
        });
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });

        await expect(manager.start(model)).resolves.toBe(0);
        writeFileSync(join(dir, 'stream0.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream0-0.ts'), 'owned');
        child.emit('exit', 0);
        await settleMicrotasks();

        expect(manager.getStreamInfo(0)).toEqual(model.getInfo());
        expect(existsSync(join(dir, 'stream0.m3u8'))).toBe(true);
        expect(existsSync(join(dir, 'stream0-0.ts'))).toBe(true);
        expect(stopHls).not.toHaveBeenCalled();

        await manager.stop(0);
        expect(stopHls).toHaveBeenCalledOnce();
        expect(manager.getStreamInfos()).toEqual([]);
    });

    it('[PRIMARY R4.7] removes completed RecordedHLS artifacts after its keep requests stop arriving', async () => {
        vi.useFakeTimers();
        const dir = mkdtempSync(join(tmpdir(), 'epg-recorded-hls-keep-expiry-contract-'));
        dirs.push(dir);
        const child = fakeChild();
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            {
                createHlsWriter: vi.fn(async () => ({
                    child,
                    handle: Object.freeze({ kind: 'recorded-hls-keep-expiry' }),
                })),
                stopHls: vi.fn(async () => ({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true })),
            },
            new HLSFileDeleterModel({ getLogger: logger }),
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 1 }, 0);
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = join(dir, 'source.ts');
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'encoded';
            model.isRecording = false;
        });
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });

        await expect(manager.start(model)).resolves.toBe(0);
        writeFileSync(join(dir, 'stream0.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream0-0.ts'), 'owned');
        child.emit('exit', 0);
        await settleMicrotasks();
        manager.keep(0);

        await vi.advanceTimersByTimeAsync(14_999);
        expect(manager.getStreamInfos()).toHaveLength(1);
        expect(existsSync(join(dir, 'stream0.m3u8'))).toBe(true);
        expect(existsSync(join(dir, 'stream0-0.ts'))).toBe(true);

        await vi.advanceTimersByTimeAsync(1);

        await vi.waitFor(() => expect(manager.getStreamInfos()).toEqual([]));
        expect(existsSync(join(dir, 'stream0.m3u8'))).toBe(false);
        expect(existsSync(join(dir, 'stream0-0.ts'))).toBe(false);
    });

    it('[MD-4.10] notifies exactly once for each accepted state transition', async () => {
        const notifyClient = vi.fn();
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient });
        const stream = fakeStream({ isEnable: true, type: 'LiveStream' });

        await expect(manager.start(stream)).resolves.toBe(0);
        expect(notifyClient).toHaveBeenCalledTimes(2);

        await manager.stop(0);
        expect(notifyClient).toHaveBeenCalledTimes(4);
        expect(manager.getStreamInfos()).toEqual([]);
    });

    it('[PRIMARY R4.10] emits each Live, Recorded, and HLS lifecycle notification in its own order without extras', async () => {
        const cases = [
            { channelId: 101, isEnable: true, mode: 0, type: 'LiveStream' },
            { isEnable: true, mode: 0, type: 'RecordedStream', videoFileId: 1 },
        ];

        for (const info of cases) {
            const observedLists: unknown[][] = [];
            let manager!: InstanceType<typeof StreamManageModel>;
            const socket = {
                notifyClient: () => {
                    observedLists.push(manager.getStreamInfos());
                },
            };
            manager = new StreamManageModel({ getLogger: logger }, executionManager(), socket);
            const stream = fakeStream(info);

            await expect(manager.start(stream)).resolves.toBe(0);
            await manager.stop(0);

            const activeList = [{ info, streamId: 0 }];
            expect(observedLists).toEqual([[], activeList, activeList, []]);
        }

        vi.useFakeTimers();
        const dir = mkdtempSync(join(tmpdir(), 'epg-live-hls-notification-contract-'));
        dirs.push(dir);
        const tuner = new PassThrough();
        const hlsNotifications: unknown[][] = [];
        let hlsManager!: InstanceType<typeof StreamManageModel>;
        let resolveHlsReady!: () => void;
        const hlsReady = new Promise<void>(resolve => {
            resolveHlsReady = resolve;
        });
        const hlsSocket = {
            notifyClient: () => {
                const streamInfos = hlsManager.getStreamInfos();
                hlsNotifications.push(streamInfos);
                if (streamInfos.some(stream => stream.info.isEnable === true)) resolveHlsReady();
            },
        };
        const hlsModel = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            {
                createHlsWriter: vi.fn(async () => ({
                    child: fakeChild(),
                    handle: Object.freeze({ kind: 'live-hls-notification' }),
                })),
                stopHls: vi.fn(async () => ({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true })),
            },
            new HLSFileDeleterModel({ getLogger: logger }),
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(), stream: tuner })) },
            hlsSocket,
        );
        hlsModel.setOption({ channelId: 101, cmd: '%NODE%' }, 0);
        hlsManager = new StreamManageModel({ getLogger: logger }, executionManager(), hlsSocket);

        await expect(hlsManager.start(hlsModel)).resolves.toBe(0);
        writeFileSync(join(dir, 'stream0.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream0-0.ts'), 'first');
        writeFileSync(join(dir, 'stream0-1.ts'), 'second');
        await vi.advanceTimersByTimeAsync(100);
        await hlsReady;
        await hlsManager.stop(0);

        const readyHlsList = [{ info: { channelId: 101, isEnable: true, mode: 0, type: 'LiveHLS' }, streamId: 0 }];
        expect(hlsNotifications).toEqual([[], readyHlsList, readyHlsList, []]);
    });

    it('[PRIMARY R5.4] re-scans and removes the exact HLS artifacts after writer shutdown', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-cleanup-contract-'));
        dirs.push(dir);
        writeFileSync(join(dir, 'stream4.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream4-0.ts'), 'owned');
        const index = new HLSFileDeleterModel({ getLogger: logger });
        index.setOption({ streamFilePath: dir, streamId: 4 });

        await expect(index.deleteAllFiles()).resolves.toEqual({ passes: 1, remainingFiles: [], status: 'cleared' });

        expect(existsSync(join(dir, 'stream4.m3u8'))).toBe(false);
        expect(existsSync(join(dir, 'stream4-0.ts'))).toBe(false);
    });

    it('[PRIMARY R5.6] records an exact HLS artifact deletion failure and continues later cleanup passes', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-unlink-contract-'));
        dirs.push(dir);
        writeFileSync(join(dir, 'stream6.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream6-0.ts'), 'owned');
        const logs = logger();
        const index = new HLSFileDeleterModel({ getLogger: () => logs });
        const failure = new Error('synthetic unlink failure');
        const unlink = vi.spyOn(FileUtil, 'unlink').mockRejectedValueOnce(failure);
        index.setOption({ streamFilePath: dir, streamId: 6 });

        await expect(index.deleteAllFiles()).resolves.toMatchObject({ passes: 2, status: 'cleared' });

        expect(unlink).toHaveBeenCalledWith(`${dir}/stream6.m3u8`);
        expect(logs.stream.error).toHaveBeenCalledWith(expect.objectContaining({ error: failure, streamId: 6 }));
    });

    it('[MD-5.7] removes the stopped HLS identity and releases it once after artifact cleanup', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-recorded-hls-force-release-contract-'));
        dirs.push(dir);
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'recorded-hls-force-release-writer' });
        const stopHls = vi.fn(async () => ({
            exitConfirmed: false,
            sentSignals: ['SIGINT', 'SIGKILL'],
            slotReleased: true,
        }));
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            { createHlsWriter: vi.fn(async () => ({ child, handle })), stopHls },
            new HLSFileDeleterModel({ getLogger: logger }),
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 1 }, 0);
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = join(dir, 'source.ts');
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'encoded';
            model.isRecording = false;
        });
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });

        await expect(manager.start(model)).resolves.toBe(0);
        writeFileSync(join(dir, 'stream0.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream0-0.ts'), 'owned');
        await manager.stop(0);

        expect(stopHls).toHaveBeenCalledOnce();
        expect(manager.getStreamInfos()).toEqual([]);
        expect(existsSync(join(dir, 'stream0.m3u8'))).toBe(false);
        await expect(manager.start(fakeStream({ isEnable: false, type: 'LiveHLS' }))).resolves.toBe(0);
    });

    it('[PRIMARY R5.7] keeps exactly one HLS execution slot reusable when terminal, stop, and finalization overlap', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-recorded-hls-slot-reuse-contract-'));
        dirs.push(dir);
        const logs = logger();
        const processManager = new EncodeProcessManageModel(
            { getLogger: () => logs },
            { getConfig: () => baseConfig({ encodeProcessNum: 1 }) },
        );
        const firstChild = fakeChild();
        firstChild.pid = 71;
        const nextChild = fakeChild();
        nextChild.pid = 72;
        vi.spyOn(childProcess, 'spawn').mockReturnValueOnce(firstChild).mockReturnValueOnce(nextChild);
        vi.spyOn(ProcessUtil, 'isProcessGroupAlive').mockReturnValue(false);
        const option = { cmd: '%NODE%', input: null, output: null, priority: 1 };
        const firstWriter = processManager.createHlsWriter(option);
        firstChild.emit('spawn');
        const writer = await firstWriter;
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: () => logs },
            { createHlsWriter: vi.fn(async () => writer), stopHls: handle => processManager.stopHls(handle) },
            new HLSFileDeleterModel({ getLogger: () => logs }),
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 1 }, 0);
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = join(dir, 'source.ts');
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'encoded';
            model.isRecording = false;
        });
        const manager = new StreamManageModel({ getLogger: () => logs }, executionManager(), { notifyClient: vi.fn() });

        await expect(manager.start(model)).resolves.toBe(0);
        writeFileSync(join(dir, 'stream0.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream0-0.ts'), 'owned');
        const stopping = manager.stop(0);
        firstChild.emit('exit', 0);
        firstChild.emit('close', 0);
        await stopping;

        expect(manager.getStreamInfos()).toEqual([]);
        expect(existsSync(join(dir, 'stream0.m3u8'))).toBe(false);
        const nextWriter = processManager.createHlsWriter(option);
        nextChild.emit('spawn');
        const next = await nextWriter;
        await expect(processManager.createHlsWriter(option)).rejects.toThrow('EncodeProcessManageModelCreateError');

        await processManager.stopHls(next.handle);
    });
});

describe('HLS writer process-group contract', () => {
    it('[PRIMARY R5.2] requests SIGINT from the HLS writer process group and confirms its exit', async () => {
        const { handle, manager } = managedHlsWriter();
        const alive = vi.spyOn(ProcessUtil, 'isProcessGroupAlive').mockReturnValueOnce(true).mockReturnValue(false);
        const signal = vi.spyOn(ProcessUtil, 'killProcessGroup').mockImplementation(() => undefined);
        vi.spyOn(ProcessUtil, 'wait').mockResolvedValue(undefined);

        await expect(manager.stopHls(handle)).resolves.toEqual({
            exitConfirmed: true,
            sentSignals: ['SIGINT'],
            slotReleased: true,
        });

        expect(signal).toHaveBeenCalledWith(71, 'SIGINT');
        expect(alive).toHaveBeenCalledTimes(2);
    });

    it('[PRIMARY R5.3] escalates an HLS writer group that survives three SIGINT checks to SIGKILL', async () => {
        const { handle, manager } = managedHlsWriter();
        vi.spyOn(ProcessUtil, 'isProcessGroupAlive').mockReturnValue(true);
        const signal = vi.spyOn(ProcessUtil, 'killProcessGroup').mockImplementation(() => undefined);
        const wait = vi.spyOn(ProcessUtil, 'wait').mockResolvedValue(undefined);

        await expect(manager.stopHls(handle)).resolves.toMatchObject({
            exitConfirmed: false,
            sentSignals: ['SIGINT', 'SIGKILL'],
            slotReleased: true,
        });

        expect(signal).toHaveBeenNthCalledWith(1, 71, 'SIGINT');
        expect(signal).toHaveBeenNthCalledWith(2, 71, 'SIGKILL');
        expect(wait).toHaveBeenCalledTimes(6);
    });

    it('[PRIMARY R5.11] reports an unconfirmed external HLS process group without treating logical release as exit confirmation', async () => {
        const { handle, logs, manager } = managedHlsWriter();
        vi.spyOn(ProcessUtil, 'isProcessGroupAlive').mockReturnValue(true);
        vi.spyOn(ProcessUtil, 'killProcessGroup').mockImplementation(() => undefined);
        vi.spyOn(ProcessUtil, 'wait').mockResolvedValue(undefined);

        await expect(manager.stopHls(handle)).resolves.toMatchObject({ exitConfirmed: false, slotReleased: true });

        expect(logs.encode.error).toHaveBeenCalledWith(
            expect.objectContaining({ forcedSlotRelease: true, terminalConfirmed: false }),
        );
    });
});
