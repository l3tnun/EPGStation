import { constants as fsConstants, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const LiveHLSStreamModel = compiled<any>('model', 'service', 'stream', 'LiveHLSStreamModel.js').default;
const RecordedHLSStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedHLSStreamModel.js').default;
const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;
const HLSFileDeleterModel = compiled<any>('model', 'service', 'stream', 'util', 'HLSFileDeleterModel.js').default;
const FileUtil = compiled<any>('util', 'FileUtil.js').default;
const dirs: string[] = [];

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

const createHls = () => {
    const dir = mkdtempSync(join(tmpdir(), 'epg-hls-'));
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
    model.setOption({ channelId: 1, cmd: '%NODE%' }, 0);
    return { dir, logs, model, socket };
};

const lifecycleStream = (
    start: () => Promise<void> = async () => undefined,
    type: 'LiveHLS' | 'LiveStream' = 'LiveStream',
) => {
    let exit: (() => void) | undefined;
    const stream = fakeStream({ channelId: 202, isEnable: type === 'LiveStream', mode: 0, type });
    stream.start.mockImplementation(start);
    stream.setExitStream.mockImplementation((callback: () => void) => {
        exit = callback;
    });
    return { emitExit: () => exit?.(), stream };
};

const lifecycleManager = (execution = executionManager()) => {
    const notifyClient = vi.fn();
    const logs = logger();
    return {
        execution,
        logs,
        manager: new StreamManageModel({ getLogger: () => logs }, execution, { notifyClient }),
        notifyClient,
    };
};

const settleMicrotasks = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

describe('actual HLS readiness and timers', () => {
    it('[MD-5.10][MD-5.12] releases artifact ownership after HLS directory preparation fails', async () => {
        const { model } = createHls();
        const artifactOwnerCount = LiveHLSStreamModel.hlsArtifactOwners.size;
        const failure = Object.assign(new Error('synthetic HLS directory preparation failure'), { code: 'EACCES' });
        vi.spyOn(FileUtil, 'access').mockRejectedValue(failure);

        await expect(model.start(8)).rejects.toBe(failure);

        expect(LiveHLSStreamModel.hlsArtifactOwners.size).toBe(artifactOwnerCount);
    });

    it('[MD-3.14][MD-3.15][MD-3.16] indexes exact startup artifacts without deleting them', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-index-'));
        dirs.push(dir);
        for (const file of [
            'stream1-not-an-artifact',
            'stream1.m3u8',
            'stream1-0.ts',
            'stream1-0.ts.bak',
            'stream1-caption.vtt',
            'stream1-segment.txt',
            'stream1evil.ts',
            'stream10.m3u8',
            'stream10-0.ts',
            'stream10-child_vtt.m3u8',
            'stream9007199254740992.m3u8',
            'stream-no-id.m3u8',
            'xstream2.m3u8',
            'unrelated.ts',
        ]) {
            writeFileSync(join(dir, file), file);
        }
        const index = new HLSFileDeleterModel({ getLogger: logger });

        await expect(index.scanAtStartup(dir)).resolves.toEqual(new Set([1, 10]));
        await expect(index.scanCurrent(dir)).resolves.toEqual(new Set([1, 10]));
        await expect(index.listExact(dir, 1).then(files => files.sort())).resolves.toEqual([
            'stream1-0.ts',
            'stream1-0.ts.bak',
            'stream1-caption.vtt',
            'stream1-not-an-artifact',
            'stream1-segment.txt',
            'stream1.m3u8',
            'stream1evil.ts',
        ]);
        expect(existsSync(join(dir, 'stream1.m3u8'))).toBe(true);
        expect(existsSync(join(dir, 'stream10-0.ts'))).toBe(true);
    });

    it('[MD-5.4][MD-5.5][MD-5.6] retries exact artifact cleanup and records an unlink failure without touching an adjacent ID', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-cleanup-'));
        dirs.push(dir);
        writeFileSync(join(dir, 'stream1.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream1-0.ts'), 'retry-me');
        writeFileSync(join(dir, 'stream10-0.ts'), 'adjacent');
        const index = new HLSFileDeleterModel({ getLogger: logger });
        const failure = new Error('synthetic hls unlink failure');
        const originalUnlink = FileUtil.unlink;
        const unlink = vi.spyOn(FileUtil, 'unlink').mockImplementation(async (filePath: string) => {
            if (filePath.endsWith('stream1-0.ts')) {
                throw failure;
            }
            await originalUnlink(filePath);
        });
        index.setOption({ streamFilePath: dir, streamId: 1 });

        await expect(index.deleteAllFiles()).resolves.toEqual({
            passes: 3,
            remainingFiles: ['stream1-0.ts'],
            status: 'remaining',
        });

        expect(unlink.mock.calls.filter(([filePath]: [string]) => filePath.endsWith('stream1-0.ts'))).toHaveLength(3);
        expect(existsSync(join(dir, 'stream1.m3u8'))).toBe(false);
        expect(existsSync(join(dir, 'stream1-0.ts'))).toBe(true);
        expect(existsSync(join(dir, 'stream10-0.ts'))).toBe(true);
    });

    it('[MD-5.4][MD-5.12][MD-5.13] records each failed scan and continues exact cleanup through all passes', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-cleanup-scan-unknown-'));
        dirs.push(dir);
        writeFileSync(join(dir, 'stream8.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream8-0.ts'), 'owned');
        writeFileSync(join(dir, 'stream80-0.ts'), 'adjacent');
        const logs = logger();
        const index = new HLSFileDeleterModel({ getLogger: () => logs });
        const failure = new Error('synthetic HLS scan failure');
        vi.spyOn(index, 'scanCurrent').mockRejectedValue(failure);
        index.setOption({ streamFilePath: dir, streamId: 8 });

        await expect(index.deleteAllFiles()).resolves.toEqual({
            passes: 3,
            remainingFiles: [],
            status: 'unknown',
        });

        for (let pass = 1; pass <= 3; pass++) {
            expect(logs.stream.error).toHaveBeenCalledWith({
                error: failure,
                operation: 'scan',
                pass,
                streamId: 8,
            });
        }
        expect(existsSync(join(dir, 'stream8.m3u8'))).toBe(false);
        expect(existsSync(join(dir, 'stream8-0.ts'))).toBe(false);
        expect(existsSync(join(dir, 'stream80-0.ts'))).toBe(true);
    });

    it('[MD-5.4][MD-5.5][MD-5.12][MD-5.13] keeps one scan failure unknown after later successful exact passes', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-cleanup-transient-scan-'));
        dirs.push(dir);
        writeFileSync(join(dir, 'stream1.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream1-0.ts'), 'owned');
        writeFileSync(join(dir, 'stream10-0.ts'), 'adjacent');
        const logs = logger();
        const index = new HLSFileDeleterModel({ getLogger: () => logs });
        const failure = new Error('synthetic first-pass HLS scan failure');
        const originalReadDir = FileUtil.readDir;
        vi.spyOn(FileUtil, 'readDir').mockImplementation(originalReadDir).mockRejectedValueOnce(failure);
        index.setOption({ streamFilePath: dir, streamId: 1 });

        await expect(index.deleteAllFiles()).resolves.toEqual({
            passes: 3,
            remainingFiles: [],
            status: 'unknown',
        });

        expect(logs.stream.error).toHaveBeenCalledOnce();
        expect(logs.stream.error).toHaveBeenCalledWith({
            error: failure,
            operation: 'scan',
            pass: 1,
            streamId: 1,
        });
        expect(existsSync(join(dir, 'stream1.m3u8'))).toBe(false);
        expect(existsSync(join(dir, 'stream1-0.ts'))).toBe(false);
        expect(existsSync(join(dir, 'stream10-0.ts'))).toBe(true);
    });

    it('[MD-5.13] records every exact-list and rescan failure before reporting unknown artifacts', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-cleanup-unknown-'));
        dirs.push(dir);
        const logs = logger();
        const index = new HLSFileDeleterModel({ getLogger: () => logs });
        const failure = new Error('synthetic hls directory failure');
        vi.spyOn(index, 'listExact').mockRejectedValue(failure);
        index.setOption({ streamFilePath: dir, streamId: 8 });

        await expect(index.deleteAllFiles()).resolves.toEqual({
            passes: 3,
            remainingFiles: [],
            status: 'unknown',
        });

        for (let pass = 1; pass <= 3; pass++) {
            expect(logs.stream.error).toHaveBeenCalledWith({ error: failure, operation: 'list', pass, streamId: 8 });
            expect(logs.stream.error).toHaveBeenCalledWith({ error: failure, operation: 'rescan', pass, streamId: 8 });
        }
    });

    it('[MD-3.17] retries directory preparation after a failed HLS-only scan', async () => {
        const dir = join(mkdtempSync(join(tmpdir(), 'epg-hls-retry-')), 'stream-files');
        dirs.push(join(dir, '..'));
        const index = new HLSFileDeleterModel({ getLogger: logger });
        const access = vi
            .spyOn(FileUtil, 'access')
            .mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));

        await expect(index.scanAtStartup(dir)).rejects.toThrow('denied');
        expect(access).toHaveBeenCalledWith(dir, fsConstants.R_OK | fsConstants.W_OK);
        access.mockRestore();
        await expect(index.scanAtStartup(dir)).resolves.toEqual(new Set());
        expect(existsSync(dir)).toBe(true);
    });

    it('[MD-3.16][MD-3.17] propagates mkdir failure and permits a later scan retry', async () => {
        const dir = join(mkdtempSync(join(tmpdir(), 'epg-hls-mkdir-retry-')), 'stream-files');
        dirs.push(join(dir, '..'));
        const index = new HLSFileDeleterModel({ getLogger: logger });
        const failure = new Error('synthetic mkdir failure');
        const access = vi
            .spyOn(FileUtil, 'access')
            .mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
        const mkdir = vi.spyOn(FileUtil, 'mkdir').mockRejectedValueOnce(failure);

        await expect(index.scanCurrent(dir)).rejects.toBe(failure);
        expect(mkdir).toHaveBeenCalledWith(dir);
        access.mockRestore();
        mkdir.mockRestore();
        await expect(index.scanCurrent(dir)).resolves.toEqual(new Set());
    });

    it('[MD-3.16][MD-3.17] propagates post-create access failure and permits a later scan retry', async () => {
        const dir = join(mkdtempSync(join(tmpdir(), 'epg-hls-access-retry-')), 'stream-files');
        dirs.push(join(dir, '..'));
        const index = new HLSFileDeleterModel({ getLogger: logger });
        const failure = Object.assign(new Error('synthetic post-create access failure'), { code: 'EACCES' });
        const access = vi
            .spyOn(FileUtil, 'access')
            .mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
            .mockRejectedValueOnce(failure);

        await expect(index.scanCurrent(dir)).rejects.toBe(failure);
        expect(access).toHaveBeenCalledTimes(2);
        expect(existsSync(dir)).toBe(true);
        access.mockRestore();
        await expect(index.scanCurrent(dir)).resolves.toEqual(new Set());
    });

    it('[MD-3.17] propagates directory read failure and permits a later scan retry', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-read-retry-'));
        dirs.push(dir);
        const index = new HLSFileDeleterModel({ getLogger: logger });
        const failure = new Error('synthetic artifact read failure');
        const readDir = vi.spyOn(FileUtil, 'readDir').mockRejectedValueOnce(failure);

        await expect(index.scanAtStartup(dir)).rejects.toBe(failure);
        readDir.mockRestore();
        await expect(index.scanAtStartup(dir)).resolves.toEqual(new Set());
    });

    it('[MD-3.16] recognizes only an ENOENT object as a missing directory', () => {
        const index = new HLSFileDeleterModel({ getLogger: logger });

        expect((index as any).isMissingDirectory({ code: 'ENOENT' })).toBe(true);
        expect((index as any).isMissingDirectory({ code: 'EACCES' })).toBe(false);
        expect((index as any).isMissingDirectory({})).toBe(false);
        expect((index as any).isMissingDirectory(null)).toBe(false);
        expect((index as any).isMissingDirectory('ENOENT')).toBe(false);
    });

    it('[MD-3.6][MD-3.12] excludes adjacent numeric IDs from readiness', async () => {
        vi.useFakeTimers();
        const { dir, model, socket } = createHls();
        writeFileSync(join(dir, 'stream1.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream10-0.ts'), 'a');
        writeFileSync(join(dir, 'stream10-1.ts'), 'b');
        model.startCheckStreamEnable(1);

        await vi.advanceTimersByTimeAsync(100);

        expect(model.getInfo().isEnable).toBe(false);
        expect(socket.notifyClient).not.toHaveBeenCalled();
        await model.stop();
    });

    it('[MD-3.5][MD-3.6] requires the exact parent and at least two non-playlist, non-VTT media artifacts', async () => {
        vi.useFakeTimers();
        const cases = [
            ['stream2-0.ts', 'stream2-1.ts'],
            ['stream2-child.m3u8', 'stream2-0.ts', 'stream2-1.ts'],
            ['stream2.m3u8', 'stream2-0.ts'],
            ['stream2.m3u8', 'stream2-0.ts', 'stream2-caption.vtt'],
            ['stream2.m3u8', 'stream2-child.m3u8', 'stream2-child_vtt.m3u8'],
        ];
        for (const files of cases) {
            const { model, socket } = createHls();
            vi.spyOn(FileUtil, 'readDir').mockResolvedValueOnce(files);
            model.startCheckStreamEnable(2);

            await vi.advanceTimersByTimeAsync(100);

            expect(model.getInfo().isEnable).toBe(false);
            expect(socket.notifyClient).not.toHaveBeenCalled();
            await model.stop();
            vi.restoreAllMocks();
        }
    });

    it('[MD-3.6] delegates one readiness snapshot to the exact artifact index', async () => {
        vi.useFakeTimers();
        const { model, socket } = createHls();
        const listExact = vi.fn(async () => ['stream7.m3u8', 'stream7-0.ts', 'stream7-1.ts']);
        (model as any).fileDeleter = {
            deleteAllFiles: vi.fn(async () => undefined),
            listExact,
            setOption: vi.fn(),
        };
        const readDir = vi.spyOn(FileUtil, 'readDir').mockRejectedValue(new Error('fallback must not run'));
        model.startCheckStreamEnable(7);
        const ready = new Promise<void>(resolve => socket.notifyClient.mockImplementationOnce(resolve));

        await vi.advanceTimersByTimeAsync(100);
        await ready;

        expect(listExact).toHaveBeenCalledWith((model as any).config.streamFilePath, 7);
        expect(readDir).not.toHaveBeenCalled();
        expect(model.getInfo().isEnable).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        await model.stop();
    });

    it('[MD-3.6] fallback exact selection rejects unrelated and adjacent numeric prefixes', async () => {
        const { model } = createHls();
        vi.spyOn(FileUtil, 'readDir').mockResolvedValue([
            'unrelated.ts',
            'stream1-not-an-artifact',
            'stream1.m3u8',
            'stream1-0.ts',
            'stream1-0.ts.bak',
            'stream1-segment.txt',
            'stream1evil.ts',
            'stream10-0.ts',
            'stream12-0.ts',
        ]);

        await expect((model as any).listExactHlsArtifacts(1)).resolves.toEqual(['stream1.m3u8', 'stream1-0.ts']);

        expect(FileUtil.readDir).toHaveBeenCalledWith((model as any).config.streamFilePath);
    });

    it('[MD-3.12] records an active readiness scan failure and cancels its timer', async () => {
        vi.useFakeTimers();
        const failure = new Error('synthetic readiness scan failure');
        const { logs, model, socket } = createHls();
        vi.spyOn(FileUtil, 'readDir').mockRejectedValueOnce(failure);
        model.startCheckStreamEnable(12);

        await vi.advanceTimersByTimeAsync(100);

        expect(logs.stream.error).toHaveBeenCalledWith(
            `get stream files list error: 12 ${(model as any).config.streamFilePath}`,
        );
        expect(socket.notifyClient).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expect((model as any).readinessGeneration).toBeNull();
        await model.stop();
    });

    it('[MD-3.12][MD-4.10] invalidates an overlapping readiness success after a scan failure', async () => {
        vi.useFakeTimers();
        const first = deferred<string[]>();
        const second = deferred<string[]>();
        const { model, socket } = createHls();
        vi.spyOn(FileUtil, 'readDir')
            .mockImplementationOnce(() => first.promise)
            .mockImplementationOnce(() => second.promise);
        model.startCheckStreamEnable(17);

        await vi.advanceTimersByTimeAsync(200);
        first.reject(new Error('synthetic overlapping scan failure'));
        await settleMicrotasks();
        second.resolve(['stream17.m3u8', 'stream17-0.ts', 'stream17-1.ts']);
        await settleMicrotasks();

        expect(model.getInfo().isEnable).toBe(false);
        expect(socket.notifyClient).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        await model.stop();
    });

    it('[MD-4.10] ignores a readiness scan rejection that settles after stop', async () => {
        vi.useFakeTimers();
        const files = deferred<string[]>();
        const { logs, model, socket } = createHls();
        vi.spyOn(FileUtil, 'readDir').mockImplementationOnce(() => files.promise);
        model.startCheckStreamEnable(13);
        await vi.advanceTimersByTimeAsync(100);
        await model.stop();

        files.reject(new Error('stale readiness failure'));
        await settleMicrotasks();

        expect(logs.stream.error).not.toHaveBeenCalled();
        expect(socket.notifyClient).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-4.10] identifies only the currently active readiness generation', async () => {
        const { model } = createHls();
        const current = {};
        const stale = {};
        (model as any).readinessGeneration = current;

        expect((model as any).isCurrentReadinessGeneration(current)).toBe(true);
        expect((model as any).isCurrentReadinessGeneration(stale)).toBe(false);
        (model as any).readinessGeneration = null;
        expect((model as any).isCurrentReadinessGeneration(current)).toBe(false);
    });

    it('[MD-4.10] returns from the captured poll callback after its generation becomes stale', async () => {
        let poll: (() => Promise<void>) | undefined;
        vi.spyOn(global, 'setInterval').mockImplementation(handler => {
            poll = handler as () => Promise<void>;
            return {} as NodeJS.Timeout;
        });
        const { model, socket } = createHls();
        vi.spyOn(FileUtil, 'readDir').mockResolvedValue(['stream16.m3u8', 'stream16-0.ts', 'stream16-1.ts']);
        model.startCheckStreamEnable(16);
        await model.stop();
        socket.notifyClient.mockImplementation(() => {
            throw new Error('stale readiness notification');
        });

        await expect(poll?.()).resolves.toBeUndefined();

        expect(model.getInfo().isEnable).toBe(false);
        expect(socket.notifyClient).not.toHaveBeenCalled();
    });

    it('[MD-3.6][MD-4.10] ignores a readiness scan that settles after stop', async () => {
        vi.useFakeTimers();
        const { model, socket } = createHls();
        const files = deferred<string[]>();
        vi.spyOn(FileUtil, 'readDir').mockImplementationOnce(() => files.promise);
        model.startCheckStreamEnable(8);
        await vi.advanceTimersByTimeAsync(100);
        await model.stop();
        socket.notifyClient.mockImplementation(() => {
            throw new Error('stale readiness notification');
        });

        files.resolve(['stream8.m3u8', 'stream8-0.ts', 'stream8-1.ts']);
        await settleMicrotasks();
        await vi.advanceTimersByTimeAsync(0);

        expect(model.getInfo().isEnable).toBe(false);
        expect(socket.notifyClient).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-3.7][MD-4.10] fences subtitle mutation before a stale readiness snapshot is processed', async () => {
        vi.useFakeTimers();
        const files = deferred<string[]>();
        const { model } = createHls();
        (model as any).fileDeleter = {
            deleteAllFiles: vi.fn(async () => undefined),
            listExact: vi.fn(() => files.promise),
            setOption: vi.fn(),
        };
        const addSubtitle = vi.spyOn(model as any, 'addSubtitleInfoToParentPlaylist');
        model.startCheckStreamEnable(18);
        await vi.advanceTimersByTimeAsync(100);

        await model.stop();
        model.startCheckStreamEnable(18);
        files.resolve(['stream18.m3u8', 'stream18-child_vtt.m3u8', 'stream18-0.ts', 'stream18-1.ts']);
        await settleMicrotasks();
        await settleMicrotasks();

        expect(addSubtitle).not.toHaveBeenCalled();
        expect(model.getInfo().isEnable).toBe(false);
        await model.stop();
    });

    it('[MD-3.7] adds an available subtitle playlist without requiring a child media playlist', async () => {
        vi.useFakeTimers();
        const { dir, model, socket } = createHls();
        writeFileSync(join(dir, 'stream9.m3u8'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmedia.m3u8');
        writeFileSync(join(dir, 'stream9-child_vtt.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream9-0.ts'), 'a');
        writeFileSync(join(dir, 'stream9-1.ts'), 'b');
        model.startCheckStreamEnable(9);
        const ready = new Promise<void>(resolve => socket.notifyClient.mockImplementationOnce(resolve));

        await vi.advanceTimersByTimeAsync(100);
        await ready;
        const playlist = await import('node:fs/promises').then(fs => fs.readFile(join(dir, 'stream9.m3u8'), 'utf8'));

        expect(playlist).toContain('TYPE=SUBTITLES');
        await model.stop();
    });

    it('[MD-3.7] leaves a ready parent unchanged when no subtitle playlist is available', async () => {
        vi.useFakeTimers();
        const { dir, model, socket } = createHls();
        const original = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmedia.m3u8';
        writeFileSync(join(dir, 'stream14.m3u8'), original);
        writeFileSync(join(dir, 'stream14-0.ts'), 'a');
        writeFileSync(join(dir, 'stream14-1.ts'), 'b');
        model.startCheckStreamEnable(14);
        const ready = new Promise<void>(resolve => socket.notifyClient.mockImplementationOnce(resolve));

        await vi.advanceTimersByTimeAsync(100);
        await ready;

        const playlist = await import('node:fs/promises').then(fs => fs.readFile(join(dir, 'stream14.m3u8'), 'utf8'));
        expect(playlist).toBe(original);
        expect((model as any).log.stream.error).not.toHaveBeenCalled();
        await model.stop();
    });

    it('[MD-3.7] records subtitle playlist update failure and still publishes readiness', async () => {
        vi.useFakeTimers();
        const failure = new Error('synthetic subtitle update failure');
        const { dir, logs, model, socket } = createHls();
        writeFileSync(join(dir, 'stream15.m3u8'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmedia.m3u8');
        writeFileSync(join(dir, 'stream15-child_vtt.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream15-0.ts'), 'a');
        writeFileSync(join(dir, 'stream15-1.ts'), 'b');
        vi.spyOn(FileUtil, 'writeFile').mockRejectedValueOnce(failure);
        model.startCheckStreamEnable(15);
        const ready = new Promise<void>(resolve => socket.notifyClient.mockImplementationOnce(resolve));

        await vi.advanceTimersByTimeAsync(100);
        await ready;

        expect(logs.stream.error).toHaveBeenCalledWith('failed to add subtitle info');
        expect(logs.stream.error).toHaveBeenCalledWith(failure);
        expect(model.getInfo().isEnable).toBe(true);
        await model.stop();
    });

    it('[MD-4.10] does not mark ready when stop wins during subtitle playlist update', async () => {
        vi.useFakeTimers();
        const write = deferred<void>();
        const { dir, model, socket } = createHls();
        writeFileSync(join(dir, 'stream11.m3u8'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmedia.m3u8');
        writeFileSync(join(dir, 'stream11-child_vtt.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream11-0.ts'), 'a');
        writeFileSync(join(dir, 'stream11-1.ts'), 'b');
        const writeFile = vi.spyOn(FileUtil, 'writeFile').mockImplementationOnce(() => write.promise);
        model.startCheckStreamEnable(11);
        await vi.advanceTimersByTimeAsync(100);
        await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce());

        await model.stop();
        write.resolve(undefined);
        await settleMicrotasks();

        expect(model.getInfo().isEnable).toBe(false);
        expect(socket.notifyClient).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-4.2][MD-4.3] polls every 100ms until playlist and two media artifacts exist', async () => {
        vi.useFakeTimers();
        const { dir, model, socket } = createHls();
        model.startCheckStreamEnable(3);
        expect(model.getInfo().isEnable).toBe(false);
        writeFileSync(join(dir, 'stream3.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream3-0.ts'), 'a');
        writeFileSync(join(dir, 'stream3-1.ts'), 'b');
        const ready = new Promise<void>(resolve => socket.notifyClient.mockImplementationOnce(resolve));
        await vi.advanceTimersByTimeAsync(99);
        expect(model.getInfo().isEnable).toBe(false);
        expect(socket.notifyClient).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await ready;
        expect(model.getInfo().isEnable).toBe(true);
        expect(socket.notifyClient).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        await model.stop();
    });

    it('[MD-4.2] keeps polling without an overall readiness deadline', async () => {
        vi.useFakeTimers();
        const { model, socket } = createHls();
        const readDir = vi.spyOn(FileUtil, 'readDir').mockResolvedValue([]);
        model.startCheckStreamEnable(5);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(model.getInfo().isEnable).toBe(false);
        readDir.mockResolvedValue(['stream5.m3u8', 'stream5-0.ts', 'stream5-1.ts']);
        const ready = new Promise<void>(resolve => socket.notifyClient.mockImplementationOnce(resolve));
        await vi.advanceTimersByTimeAsync(100);
        await ready;

        expect(model.getInfo().isEnable).toBe(true);
        expect(socket.notifyClient).toHaveBeenCalledOnce();
        await model.stop();
    });

    it('[MD-4.7] retains recorded HLS playlist and segment after the writer terminal event', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-recorded-hls-terminal-'));
        dirs.push(dir);
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'hls-writer' });
        const fileDeleter = { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() };
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            {
                createHlsWriter: vi.fn(async () => ({ child, handle })),
                stopHls: vi.fn(async () => ({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true })),
            },
            fileDeleter,
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 31 }, 0);
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = join(dir, 'source.ts');
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'encoded';
            model.isRecording = false;
        });
        await model.start(6);
        const playlist = join(dir, 'stream6.m3u8');
        const segment = join(dir, 'stream6-0.ts');
        writeFileSync(playlist, '#EXTM3U');
        writeFileSync(segment, 'synthetic-segment');

        child.emit('exit', 0);
        await Promise.resolve();

        expect(existsSync(playlist)).toBe(true);
        expect(existsSync(segment)).toBe(true);
        expect(fileDeleter.deleteAllFiles).toHaveBeenCalledTimes(1);
        await model.stop();
    });

    it('[MD-5.1][MD-5.12] continues RecordedHLS artifact cleanup after the opaque writer stop rejects', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-recorded-hls-stop-order-'));
        dirs.push(dir);
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'recorded-hls-writer' });
        const operations: string[] = [];
        const stopHls = vi.fn(async () => {
            operations.push('writer-stop');
            throw new Error('synthetic recorded HLS writer stop failure');
        });
        const fileDeleter = {
            deleteAllFiles: vi.fn(async () => {
                operations.push('artifact-cleanup');
                return { passes: 1, remainingFiles: [], status: 'cleared' as const };
            }),
            setOption: vi.fn(),
        };
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
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

        await model.start(3);
        operations.length = 0;

        await expect(model.stop()).resolves.toBeUndefined();

        expect(stopHls).toHaveBeenCalledOnce();
        expect(stopHls).toHaveBeenCalledWith(handle);
        expect(operations).toEqual(['writer-stop', 'artifact-cleanup']);
    });

    it('[MD-5.1][MD-5.4][MD-5.12] cleans artifacts after stopping a late RecordedHLS writer', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-recorded-hls-late-stop-order-'));
        dirs.push(dir);
        const writer = deferred<{ child: ReturnType<typeof fakeChild>; handle: object }>();
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'late-recorded-hls-writer' });
        const operations: string[] = [];
        const createHlsWriter = vi.fn(() => writer.promise);
        const stopHls = vi.fn(async () => {
            operations.push('writer-stop');
            throw new Error('synthetic late recorded HLS writer stop failure');
        });
        const fileDeleter = {
            deleteAllFiles: vi.fn(async () => {
                operations.push('artifact-cleanup');
                return { passes: 1, remainingFiles: [], status: 'cleared' as const };
            }),
            setOption: vi.fn(),
        };
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            { createHlsWriter, stopHls },
            fileDeleter,
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 1 }, 0);
        const artifactOwnerCount = RecordedHLSStreamModel.hlsArtifactOwners.size;
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = join(dir, 'source.ts');
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'encoded';
            model.isRecording = false;
        });

        const started = model.start(7);
        await vi.waitFor(() => expect(createHlsWriter).toHaveBeenCalledOnce());
        await model.stop();
        operations.length = 0;

        writer.resolve({ child, handle });
        await expect(started).resolves.toBeUndefined();

        expect(stopHls).toHaveBeenCalledOnce();
        expect(stopHls).toHaveBeenCalledWith(handle);
        expect(fileDeleter.deleteAllFiles).toHaveBeenCalledTimes(3);
        expect(operations).toEqual(['writer-stop', 'artifact-cleanup']);
        expect(RecordedHLSStreamModel.hlsArtifactOwners.size).toBe(artifactOwnerCount);
    });

    it('[MD-4.3] injects subtitle metadata when child and VTT playlists are present', async () => {
        const { dir, model } = createHls();
        writeFileSync(join(dir, 'stream4.m3u8'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchild.m3u8');
        writeFileSync(join(dir, 'stream4-child.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream4-child_vtt.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream4-0.ts'), 'a');
        writeFileSync(join(dir, 'stream4-1.ts'), 'b');
        model.startCheckStreamEnable(4);
        let playlist = '';
        await vi.waitFor(async () => {
            playlist = await import('node:fs/promises').then(fs => fs.readFile(join(dir, 'stream4.m3u8'), 'utf8'));
            expect(playlist).toContain('TYPE=SUBTITLES');
        });
        expect(playlist).toContain('TYPE=SUBTITLES');
        expect(playlist).toContain('SUBTITLES="subtitle"');
        await model.stop();
    });

    it('[MD-4.4] resets the exact 15-second stop timer on keep', async () => {
        vi.useFakeTimers();
        const { model } = createHls();
        const stop = vi.spyOn(model, 'stop').mockResolvedValue(undefined);
        model.setStopTimer();
        await vi.advanceTimersByTimeAsync(14_999);
        expect(stop).not.toHaveBeenCalled();
        model.keep();
        await vi.advanceTimersByTimeAsync(14_999);
        expect(stop).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(stop).toHaveBeenCalledOnce();
    });
});

describe('stream manager lifecycle internals', () => {
    it('[MD-3.3][MD-4.4] reserves distinct HLS IDs when concurrent artifact snapshots settle out of order', async () => {
        vi.useFakeTimers();
        const initialization = deferred<ReadonlySet<number>>();
        const firstSnapshot = deferred<ReadonlySet<number>>();
        const secondSnapshot = deferred<ReadonlySet<number>>();
        const artifactIndex = {
            deleteAllFiles: vi.fn(async () => undefined),
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn(() => initialization.promise),
            scanCurrent: vi
                .fn()
                .mockImplementationOnce(() => firstSnapshot.promise)
                .mockImplementationOnce(() => secondSnapshot.promise),
            setOption: vi.fn(),
        };
        const first = lifecycleStream(async () => undefined, 'LiveHLS');
        const second = lifecycleStream(async () => undefined, 'LiveHLS');
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: logger }, { getConfig: () => baseConfig() }, artifactIndex),
        );

        const firstStart = manager.start(first.stream);
        const secondStart = manager.start(second.stream);
        expect(manager.getStreamInfos()).toEqual([]);
        initialization.resolve(new Set());
        await vi.waitFor(() => expect(artifactIndex.scanCurrent).toHaveBeenCalledTimes(2));
        secondSnapshot.resolve(new Set());
        await expect(secondStart).resolves.toBe(0);
        firstSnapshot.resolve(new Set());
        await expect(firstStart).resolves.toBe(1);

        expect(manager.getStreamInfos().map(({ streamId }: any) => streamId)).toEqual([0, 1]);
        expect(vi.getTimerCount()).toBe(0);
        await manager.stopAll();

        expect(first.stream.stop).toHaveBeenCalledOnce();
        expect(second.stream.stop).toHaveBeenCalledOnce();
        expect(manager.getStreamInfos()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-10.2] wraps the HLS allocation cursor at the safe-integer boundary', async () => {
        const artifactIndex = {
            listExact: vi.fn(async () => []),
            scanAtStartup: vi.fn(async () => new Set<number>()),
            scanCurrent: vi.fn(async () => new Set<number>()),
        };
        const idAllocator = fakeIdAllocator({ getLogger: logger }, { getConfig: () => baseConfig() }, artifactIndex);
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            idAllocator,
        );
        const maximum = lifecycleStream(async () => undefined, 'LiveHLS');
        const wrapped = lifecycleStream(async () => undefined, 'LiveHLS');
        (idAllocator as any).allocationCursor = Number.MAX_SAFE_INTEGER;

        await expect(manager.start(maximum.stream)).resolves.toBe(Number.MAX_SAFE_INTEGER);
        await expect(manager.start(wrapped.stream)).resolves.toBe(0);

        const activeIds = manager.getStreamInfos().map(({ streamId }: any) => streamId);
        expect(activeIds).toHaveLength(2);
        expect(activeIds).toEqual(expect.arrayContaining([Number.MAX_SAFE_INTEGER, 0]));
        await manager.stopAll();
    });

    it('records starting, ready, and stopping while memoizing one resource-bundle finalizer', async () => {
        const target = lifecycleStream();
        const execution = executionManager();
        const { logs, manager } = lifecycleManager(execution);
        const result = manager.start(target.stream);
        const active = (manager as any).streams[0];
        expect(active.state).toBe('starting');
        expect(active.startResult.settled).toBe(false);
        expect(active.resources.adopt(vi.fn())).toBe('adopted');

        await expect(result).resolves.toBe(0);
        expect(active.state).toBe('ready');
        expect(active.startResult.settled).toBe(true);
        expect(active.startTimer).toBeNull();

        const reasons: string[] = [];
        const nestedDisposer = vi.fn();
        const nestedAdoptions: string[] = [];
        let reentrantFinalize: Promise<void> | undefined;
        let reentered = false;
        target.stream.stop.mockImplementation(() => {
            nestedAdoptions.push(active.resources.adopt(nestedDisposer));
            if (reentered === false) {
                reentered = true;
                reentrantFinalize = active.resources.finalize('source-ended');
            }
        });
        const release = deferred<void>();
        expect(
            active.resources.adopt(async (reason: string) => {
                reasons.push(reason);
                await release.promise;
            }),
        ).toBe('adopted');
        const stopping = manager.stop(0);
        await vi.waitFor(() => expect(reasons).toEqual(['explicit-stop']));
        expect(active.state).toBe('stopping');
        const bundleFinalizer = active.resources.finalize('source-ended');
        expect(active.resources.finalize('start-timeout')).toBe(bundleFinalizer);
        expect(reentrantFinalize).toBe(bundleFinalizer);
        expect(active.resources.adopt(vi.fn())).toBe('stale');
        expect(nestedAdoptions).toEqual(['stale']);
        expect(nestedDisposer).not.toHaveBeenCalled();
        expect(target.stream.stop).toHaveBeenCalledOnce();
        expect(execution.getExecution.mock.calls).toEqual([[1], [1]]);

        release.resolve(undefined);
        await stopping;
        await bundleFinalizer;
        expect(manager.getStreamInfos()).toEqual([]);
        expect(logs.stream.error).not.toHaveBeenCalled();
    });

    it('memoizes one finalizer across explicit stop, terminal, and duplicate stop', async () => {
        const pendingStop = deferred<void>();
        const target = lifecycleStream();
        target.stream.stop.mockImplementation(() => pendingStop.promise);
        const next = lifecycleStream();
        const { manager } = lifecycleManager();
        await manager.start(target.stream);

        const firstStop = manager.stop(0);
        target.emitExit();
        const duplicateStop = manager.stop(0);
        await settleMicrotasks();
        expect(target.stream.stop).toHaveBeenCalledOnce();

        expect(await manager.start(next.stream)).toBe(1);
        pendingStop.resolve(undefined);
        await Promise.all([firstStop, duplicateStop]);
        expect(target.stream.stop).toHaveBeenCalledOnce();
    });

    it('continues finalization and releases the same object when cleanup rejects', async () => {
        vi.useFakeTimers();
        const failure = new Error('synthetic cleanup failure');
        const target = lifecycleStream();
        target.stream.stop.mockRejectedValue(failure);
        const { logs, manager } = lifecycleManager();
        await manager.start(target.stream);

        await expect(manager.stop(0)).resolves.toBeUndefined();

        expect(manager.getStreamInfos()).toEqual([]);
        expect(logs.stream.error).toHaveBeenCalledWith('stop stream error 0');
        expect(logs.stream.error).toHaveBeenCalledWith(failure);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-5.3] releases the stream even when cleanup diagnostics throw', async () => {
        const cleanupFailure = new Error('synthetic HLS cleanup failure');
        const diagnosticFailure = new Error('synthetic diagnostic failure');
        const target = lifecycleStream();
        target.stream.stop.mockRejectedValue(cleanupFailure);
        const { logs, manager, notifyClient } = lifecycleManager();
        logs.stream.error.mockImplementation(() => {
            throw diagnosticFailure;
        });
        await manager.start(target.stream);
        const notificationsBeforeStop = notifyClient.mock.calls.length;

        await expect(manager.stop(0)).resolves.toBeUndefined();

        expect(target.stream.stop).toHaveBeenCalledOnce();
        expect(manager.getStreamInfos()).toEqual([]);
        expect(notifyClient).toHaveBeenCalledTimes(notificationsBeforeStop + 2);
    });

    it('[MD-5.7][MD-5.12] completes HLS removal when the force-release callback throws', async () => {
        const target = lifecycleStream(undefined, 'LiveHLS');
        target.stream.finalizeStop.mockImplementation(() => {
            throw new Error('synthetic HLS force-release callback failure');
        });
        const { manager, notifyClient } = lifecycleManager();
        await expect(manager.start(target.stream)).resolves.toBe(0);
        const notificationsBeforeStop = notifyClient.mock.calls.length;

        await expect(manager.stop(0)).resolves.toBeUndefined();

        expect(manager.getStreamInfos()).toEqual([]);
        expect(notifyClient).toHaveBeenCalledTimes(notificationsBeforeStop + 2);
    });

    it('lets success immediately before the deadline win and removes the timer', async () => {
        vi.useFakeTimers();
        const pendingStart = deferred<void>();
        const target = lifecycleStream(() => pendingStart.promise);
        const { manager } = lifecycleManager();
        const result = manager.start(target.stream);

        await vi.advanceTimersByTimeAsync(29_999);
        pendingStart.resolve(undefined);
        await settleMicrotasks();
        await expect(result).resolves.toBe(0);
        await vi.advanceTimersByTimeAsync(1);

        expect(target.stream.stop).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('lets an exact-30-second success timer registered first win and makes the deadline inert', async () => {
        vi.useFakeTimers();
        const pendingStart = deferred<void>();
        setTimeout(() => pendingStart.resolve(undefined), 30_000);
        const target = lifecycleStream(() => pendingStart.promise);
        const { manager, notifyClient } = lifecycleManager();
        const result = manager.start(target.stream);
        const active = (manager as any).streams[0];
        const reasons: string[] = [];
        active.resources.adopt((reason: string) => reasons.push(reason));
        await settleMicrotasks();
        expect(target.stream.start).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(30_000);
        await expect(result).resolves.toBe(0);

        expect(active.state).toBe('ready');
        expect(active.startResult.settled).toBe(true);
        expect(target.stream.stop).not.toHaveBeenCalled();
        expect(notifyClient).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);

        await vi.advanceTimersByTimeAsync(1);
        expect(target.stream.stop).not.toHaveBeenCalled();
        expect(notifyClient).toHaveBeenCalledTimes(2);

        await manager.stop(0);
        expect(target.stream.stop).toHaveBeenCalledOnce();
        expect(reasons).toEqual(['explicit-stop']);
        expect(notifyClient).toHaveBeenCalledTimes(4);
        expect(manager.getStreamInfos()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('lets the exact-30-second deadline registered first win and ignores late success', async () => {
        vi.useFakeTimers();
        const pendingStart = deferred<void>();
        const target = lifecycleStream(() => pendingStart.promise);
        const { manager, notifyClient } = lifecycleManager();
        const result = manager.start(target.stream);
        const rejection = expect(result).rejects.toThrow('StreamStartTimeout');
        const active = (manager as any).streams[0];
        const reasons: string[] = [];
        active.resources.adopt((reason: string) => reasons.push(reason));
        await settleMicrotasks();
        expect(target.stream.start).toHaveBeenCalledOnce();
        setTimeout(() => pendingStart.resolve(undefined), 30_000);

        await vi.advanceTimersByTimeAsync(30_000);
        await rejection;
        await settleMicrotasks();

        expect(active.state).toBe('stopping');
        expect(active.startResult.settled).toBe(true);
        expect(target.stream.stop).toHaveBeenCalledTimes(2);
        expect(reasons).toEqual(['start-timeout']);
        expect(notifyClient).toHaveBeenCalledTimes(3);
        expect(manager.getStreamInfos()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);

        await vi.advanceTimersByTimeAsync(1);
        expect(target.stream.stop).toHaveBeenCalledTimes(2);
        expect(notifyClient).toHaveBeenCalledTimes(3);
    });

    it('lets the deadline win over a same-turn late failure without an unhandled rejection', async () => {
        vi.useFakeTimers();
        const pendingStart = deferred<void>();
        const target = lifecycleStream(() => pendingStart.promise);
        const { manager } = lifecycleManager();
        const result = manager.start(target.stream);
        const rejection = expect(result).rejects.toThrow(/timeout/i);

        await vi.advanceTimersByTimeAsync(30_000);
        await rejection;
        pendingStart.reject(new Error('late start failure'));
        await settleMicrotasks();

        expect(target.stream.stop).toHaveBeenCalledTimes(2);
        expect(manager.getStreamInfos()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('notifies once for each real transition and never for a stale terminal callback', async () => {
        const oldStream = lifecycleStream();
        const replacement = lifecycleStream();
        const { manager, notifyClient } = lifecycleManager();
        await manager.start(oldStream.stream);
        await manager.stop(0);
        await manager.start(replacement.stream);
        expect(notifyClient).toHaveBeenCalledTimes(6);

        oldStream.emitExit();
        await settleMicrotasks();

        expect(notifyClient).toHaveBeenCalledTimes(6);
        expect(replacement.stream.stop).not.toHaveBeenCalled();
    });

    it('joins an immediate source terminal to the same finalizer without duplicate cleanup', async () => {
        const target = lifecycleStream();
        target.stream.start.mockImplementation(async () => target.emitExit());
        const { manager } = lifecycleManager();
        const result = manager.start(target.stream);
        const reasons: string[] = [];
        expect((manager as any).streams[0].resources.adopt((reason: string) => reasons.push(reason))).toBe('adopted');

        await expect(result).rejects.toThrow('StreamStartStopped');
        await vi.waitFor(() => expect(manager.getStreamInfos()).toEqual([]));

        expect(target.stream.stop).toHaveBeenCalledOnce();
        expect(reasons).toEqual(['source-ended']);
    });

    it('rejects listener setup failure and releases the reserved object without starting', async () => {
        const target = lifecycleStream();
        target.stream.setExitStream.mockImplementation(() => {
            throw 'synthetic listener setup failure';
        });
        const { manager } = lifecycleManager();

        await expect(manager.start(target.stream)).rejects.toThrow('synthetic listener setup failure');
        await vi.waitFor(() => expect(manager.getStreamInfos()).toEqual([]));

        expect(target.stream.start).not.toHaveBeenCalled();
        expect(target.stream.stop).toHaveBeenCalledOnce();
    });

    it('rejects a stopped pending start, clears its timer, and keeps its ID until cleanup finishes', async () => {
        vi.useFakeTimers();
        const pendingStart = deferred<void>();
        const pendingStop = deferred<void>();
        const target = lifecycleStream(() => pendingStart.promise);
        target.stream.stop.mockImplementationOnce(() => pendingStop.promise);
        const next = lifecycleStream();
        const { manager } = lifecycleManager();
        const result = manager.start(target.stream);
        const rejection = expect(result).rejects.toThrow('StreamStartStopped');
        await vi.waitFor(() => expect(target.stream.start).toHaveBeenCalledOnce());

        const stopping = manager.stop(0);
        await rejection;
        expect((manager as any).streams[0].state).toBe('stopping');
        expect((manager as any).streams[0].startResult.settled).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        await expect(manager.start(next.stream)).resolves.toBe(1);

        pendingStop.resolve(undefined);
        await stopping;
        pendingStart.resolve(undefined);
        await settleMicrotasks();
        expect(target.stream.stop).toHaveBeenCalledTimes(2);
        expect(manager.getStreamInfos().map(({ streamId }: any) => streamId)).toEqual([1]);
    });

    it('logs a rejected late cleanup without mutating the replacement object', async () => {
        vi.useFakeTimers();
        const pendingStart = deferred<void>();
        const failure = new Error('synthetic late cleanup failure');
        const late = lifecycleStream(() => pendingStart.promise);
        late.stream.stop.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
        const replacement = lifecycleStream();
        const { logs, manager } = lifecycleManager();
        const result = manager.start(late.stream);
        const rejection = expect(result).rejects.toThrow('StreamStartTimeout');
        await vi.advanceTimersByTimeAsync(30_000);
        await rejection;
        await expect(manager.start(replacement.stream)).resolves.toBe(0);

        pendingStart.resolve(undefined);
        await settleMicrotasks();

        expect(logs.stream.error).toHaveBeenCalledWith('late stream cleanup error 0');
        expect(logs.stream.error).toHaveBeenCalledWith(failure);
        expect(late.stream.stop).toHaveBeenCalledTimes(2);
        expect(replacement.stream.stop).not.toHaveBeenCalled();
    });

    it('passes start-failed and start-timeout as the first resource finalization reasons', async () => {
        vi.useFakeTimers();
        const startFailure = new Error('synthetic start failure');
        const failed = lifecycleStream(async () => {
            throw startFailure;
        });
        const timed = lifecycleStream(() => new Promise<void>(() => undefined));
        const { manager } = lifecycleManager();
        const failedResult = manager.start(failed.stream);
        const failedReasons: string[] = [];
        (manager as any).streams[0].resources.adopt((reason: string) => failedReasons.push(reason));
        await expect(failedResult).rejects.toBe(startFailure);
        await vi.waitFor(() => expect(manager.getStreamInfos()).toEqual([]));
        expect(failedReasons).toEqual(['start-failed']);

        const timedResult = manager.start(timed.stream);
        const timeoutRejection = expect(timedResult).rejects.toThrow('StreamStartTimeout');
        const timedActive = (manager as any).streams[0];
        const timedReasons: string[] = [];
        timedActive.resources.adopt((reason: string) => timedReasons.push(reason));
        await vi.advanceTimersByTimeAsync(30_000);
        await timeoutRejection;
        await vi.waitFor(() => expect(manager.getStreamInfos()).toEqual([]));
        expect(timedActive.startResult.settled).toBe(true);
        expect(timedReasons).toEqual(['start-timeout']);
    });

    it('requires unsettled, starting, and current object identity before applying start settlement', async () => {
        const target = lifecycleStream();
        const { manager } = lifecycleManager();
        await manager.start(target.stream);
        const active = (manager as any).streams[0];

        active.startResult.settled = false;
        active.state = 'starting';
        expect((manager as any).canSettleStart(active)).toBe(true);
        active.startResult.settled = true;
        expect((manager as any).canSettleStart(active)).toBe(false);
        active.startResult.settled = false;
        active.state = 'ready';
        expect((manager as any).canSettleStart(active)).toBe(false);
        active.state = 'starting';
        (manager as any).streams[0] = { ...active };
        expect((manager as any).canSettleStart(active)).toBe(false);
        (manager as any).streams[0] = active;
        active.state = 'ready';
        active.startResult.settled = true;

        const notifications = (manager as any).socketIO.notifyClient.mock.calls.length;
        (manager as any).rejectStart(active, new Error('stale rejection'), 'start-failed');
        expect((manager as any).socketIO.notifyClient).toHaveBeenCalledTimes(notifications);
        expect(active.state).toBe('ready');
        await manager.stop(0);
    });

    it('does not start external I/O after stop wins while start transition acquisition is pending', async () => {
        const transition = deferred<number>();
        const execution = executionManager();
        execution.getExecution.mockImplementationOnce(() => transition.promise);
        const target = lifecycleStream();
        const { manager } = lifecycleManager(execution);
        const result = manager.start(target.stream);
        const rejection = expect(result).rejects.toThrow('StreamStartStopped');

        const stopping = manager.stop(0);
        await rejection;
        transition.resolve(1);
        await stopping;
        await settleMicrotasks();

        expect(target.stream.start).not.toHaveBeenCalled();
        expect(target.stream.stop).toHaveBeenCalledOnce();
        expect(manager.getStreamInfos()).toEqual([]);
    });

    it('preserves missing stop, keep, and info behavior', async () => {
        const { manager } = lifecycleManager();

        await expect(manager.stop(404)).resolves.toBeUndefined();
        expect(() => manager.keep(404)).toThrow('StreamIsUndefined');
        expect(() => manager.getStreamInfo(404)).toThrow('StreamIsNotFound');
    });

    it('fails start when transition acquisition fails and still finalizes the reservation', async () => {
        const failure = new Error('synthetic start transition failure');
        const execution = executionManager();
        execution.getExecution.mockRejectedValueOnce(failure);
        const target = lifecycleStream();
        const { manager } = lifecycleManager(execution);
        const result = manager.start(target.stream);
        const reasons: string[] = [];
        (manager as any).streams[0].resources.adopt((reason: string) => reasons.push(reason));

        await expect(result).rejects.toBe(failure);
        await vi.waitFor(() => expect(manager.getStreamInfos()).toEqual([]));

        expect(target.stream.start).not.toHaveBeenCalled();
        expect(target.stream.stop).toHaveBeenCalledOnce();
        expect((manager as any).log.stream.error).toHaveBeenCalledWith('start stream error');
        expect((manager as any).log.stream.error).toHaveBeenCalledWith(failure);
        expect(reasons).toEqual(['start-failed']);
    });

    it('continues resource cleanup when stop transition acquisition fails', async () => {
        const failure = new Error('synthetic stop transition failure');
        const execution = executionManager();
        execution.getExecution.mockResolvedValueOnce(1).mockRejectedValueOnce(failure);
        const target = lifecycleStream();
        const { logs, manager } = lifecycleManager(execution);
        await manager.start(target.stream);

        await expect(manager.stop(0, true)).resolves.toBeUndefined();

        expect(target.stream.stop).toHaveBeenCalledOnce();
        expect(manager.getStreamInfos()).toEqual([]);
        expect(logs.stream.error).toHaveBeenCalledWith('stop stream transition error 0');
        expect(logs.stream.error).toHaveBeenCalledWith(failure);
        expect(execution.getExecution.mock.calls).toEqual([[1], [10]]);
    });

    it('keeps replacement identity safe at both finalizer identity fences', async () => {
        const target = lifecycleStream();
        const replacement = lifecycleStream();
        const { manager, notifyClient } = lifecycleManager();
        await manager.start(target.stream);
        const active = (manager as any).streams[0];
        const replacementActive = { ...active, stream: replacement.stream };
        (manager as any).streams[0] = replacementActive;
        const notifications = notifyClient.mock.calls.length;

        await (manager as any).finalizeActive(active, 'explicit-stop', 1);
        expect(target.stream.stop).not.toHaveBeenCalled();
        expect((manager as any).streams[0]).toBe(replacementActive);
        expect(notifyClient).toHaveBeenCalledTimes(notifications);

        (manager as any).streams[0] = active;
        active.finalizePromise = null;
        active.resources = {
            finalize: vi.fn(async () => {
                (manager as any).streams[0] = replacementActive;
            }),
        };
        await (manager as any).finalizeActive(active, 'explicit-stop', 1);
        expect((manager as any).streams[0]).toBe(replacementActive);
    });

    it('cleans a late-settled old object after its ID has been reused', async () => {
        const oldStream = lifecycleStream();
        const replacement = lifecycleStream();
        const { manager } = lifecycleManager();
        await manager.start(oldStream.stream);
        const oldActive = (manager as any).streams[0];
        await manager.stop(0);
        await manager.start(replacement.stream);
        oldStream.stream.stop.mockClear();

        await (manager as any).settleLateStart(oldActive);

        expect(oldStream.stream.stop).toHaveBeenCalledOnce();
        expect(replacement.stream.stop).not.toHaveBeenCalled();
        expect((manager as any).streams[0].stream).toBe(replacement.stream);
    });

    it('logs one unexpected stopAll rejection and continues its fixed snapshot', async () => {
        const failure = new Error('synthetic stopAll failure');
        const first = lifecycleStream();
        const second = lifecycleStream();
        const { logs, manager } = lifecycleManager();
        await manager.start(first.stream);
        await manager.start(second.stream);
        const originalStopActive = (manager as any).stopActive.bind(manager);
        const stopActive = vi
            .spyOn(manager as any, 'stopActive')
            .mockRejectedValueOnce(failure)
            .mockImplementation(originalStopActive);

        await manager.stopAll();

        expect(stopActive).toHaveBeenCalledTimes(2);
        expect(logs.system.error).toHaveBeenCalledWith(failure);
        expect(second.stream.stop).toHaveBeenCalledOnce();
    });
});
