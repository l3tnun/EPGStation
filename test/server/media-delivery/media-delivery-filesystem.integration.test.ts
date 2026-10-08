import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
    vi.restoreAllMocks();
});

describe('HLS artifact allocation filesystem boundary', () => {
    it('runs production StreamBase startup cleanup without deleting an adjacent numeric stream ID', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-start-cleanup-'));
        dirs.push(dir);
        writeFileSync(join(dir, 'stream1.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream1-000000001.ts'), 'owned');
        writeFileSync(join(dir, 'stream1-000000001.ts.bak'), 'not-an-artifact');
        writeFileSync(join(dir, 'stream1evil.ts'), 'not-an-artifact');
        writeFileSync(join(dir, 'stream10.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream10-000000001.ts'), 'adjacent');
        const index = new HLSFileDeleterModel({ getLogger: logger });
        const child = fakeChild();
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            {
                createHlsWriter: vi.fn(async () => ({ child, handle: Object.freeze({ kind: 'hls-writer' }) })),
                stopHls: vi.fn(async () => ({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true })),
            },
            index,
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

        await model.start(1);

        expect(existsSync(join(dir, 'stream1.m3u8'))).toBe(false);
        expect(existsSync(join(dir, 'stream1-000000001.ts'))).toBe(false);
        expect(existsSync(join(dir, 'stream1-000000001.ts.bak'))).toBe(false);
        expect(existsSync(join(dir, 'stream1evil.ts'))).toBe(false);
        expect(existsSync(join(dir, 'stream10.m3u8'))).toBe(true);
        expect(existsSync(join(dir, 'stream10-000000001.ts'))).toBe(true);
        await model.stop();
    });

    it('[MD-5.4][MD-5.5][MD-5.12][MD-5.13] deletes exact files after scan failure and preserves the adjacent ID', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-scan-unknown-'));
        dirs.push(dir);
        writeFileSync(join(dir, 'stream1.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream1-000000001.ts'), 'owned');
        writeFileSync(join(dir, 'stream10.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream10-000000001.ts'), 'adjacent');
        const logs = logger();
        const index = new HLSFileDeleterModel({ getLogger: () => logs });
        const scanFailure = new Error('synthetic integrated HLS scan failure');
        vi.spyOn(index, 'scanCurrent').mockRejectedValue(scanFailure);

        await expect(index.deleteAllFiles({ streamFilePath: dir, streamId: 1 })).resolves.toEqual({
            passes: 3,
            remainingFiles: [],
            status: 'unknown',
        });

        expect(existsSync(join(dir, 'stream1.m3u8'))).toBe(false);
        expect(existsSync(join(dir, 'stream1-000000001.ts'))).toBe(false);
        expect(existsSync(join(dir, 'stream10.m3u8'))).toBe(true);
        expect(existsSync(join(dir, 'stream10-000000001.ts'))).toBe(true);
        expect(logs.stream.error).toHaveBeenCalledTimes(3);
        expect(logs.stream.error).toHaveBeenNthCalledWith(1, {
            error: scanFailure,
            operation: 'scan',
            pass: 1,
            streamId: 1,
        });
    });

    it('[MD-5.1][MD-5.2][MD-5.3] continues recorded HLS artifact cleanup after its opaque writer stop rejects', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-recorded-stop-'));
        dirs.push(dir);
        const logs = logger();
        const child = fakeChild();
        const stopFailure = new Error('synthetic hls writer stop failure');
        const stopHls = vi.fn(async () => {
            throw stopFailure;
        });
        const artifactIndex = new HLSFileDeleterModel({ getLogger: () => logs });
        const manager = new StreamManageModel(
            { getLogger: () => logs },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: () => logs }, { getConfig: () => ({ streamFilePath: dir }) }, artifactIndex),
        );
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: () => logs },
            {
                createHlsWriter: vi.fn(async () => ({ child, handle: Object.freeze({ kind: 'hls-writer' }) })),
                stopHls,
            },
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

        await expect(manager.start(model)).resolves.toBe(0);
        writeFileSync(join(dir, 'stream0.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream0-0.ts'), 'owned');
        writeFileSync(join(dir, 'stream10-0.ts'), 'adjacent');
        const registryAtDiagnostic: unknown[] = [];
        logs.stream.error.mockImplementation(value => {
            if (typeof value === 'object' && value !== null && (value as { event?: unknown }).event !== undefined) {
                registryAtDiagnostic.push(manager.getStreamInfos());
            }
        });

        await expect(manager.stop(0)).resolves.toBeUndefined();

        expect(stopHls).toHaveBeenCalledOnce();
        expect(existsSync(join(dir, 'stream0.m3u8'))).toBe(false);
        expect(existsSync(join(dir, 'stream0-0.ts'))).toBe(false);
        expect(existsSync(join(dir, 'stream10-0.ts'))).toBe(true);
        expect(manager.getStreamInfos()).toEqual([]);
        expect(registryAtDiagnostic).toEqual([[]]);
        expect(logs.stream.error).toHaveBeenCalledTimes(1);
        expect(logs.stream.error).toHaveBeenCalledWith({
            artifactCleanup: { passes: 1, remainingFiles: [], status: 'cleared' },
            artifactCleanupFailure: undefined,
            event: 'hls-stop-finalization',
            forceReleased: true,
            streamId: 0,
            streamType: 'RecordedHLS',
            writerStopFailure: stopFailure,
            writerStopResult: undefined,
        });
    });

    it('keeps startup artifacts, skips their exact IDs, and rechecks before starting the writer', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-allocation-'));
        dirs.push(dir);
        writeFileSync(join(dir, 'stream0.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream10-0.ts'), 'adjacent');
        const index = new HLSFileDeleterModel({ getLogger: logger });
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: logger }, { getConfig: () => ({ streamFilePath: dir }) }, index),
        );
        const stream = fakeStream({ isEnable: false, type: 'LiveHLS' });
        stream.start.mockImplementation(async (streamId: number) => {
            writeFileSync(join(dir, `writer-started-${streamId}`), 'started');
        });

        await expect(manager.start(stream)).resolves.toBe(1);

        expect(existsSync(join(dir, 'stream0.m3u8'))).toBe(true);
        expect(existsSync(join(dir, 'stream10-0.ts'))).toBe(true);
        expect(existsSync(join(dir, 'writer-started-1'))).toBe(true);
        expect(stream.start).toHaveBeenCalledWith(1);
    });

    it('[MD-5.7][MD-5.10][MD-5.12] force-releases an HLS ID through the public manager lifecycle', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-force-release-'));
        dirs.push(dir);
        const socket = { notifyClient: vi.fn() };
        const index = new HLSFileDeleterModel({ getLogger: logger });
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            socket,
            fakeIdAllocator({ getLogger: logger }, { getConfig: () => ({ streamFilePath: dir }) }, index),
        );
        const stopped = fakeStream({ isEnable: false, type: 'LiveHLS' });
        stopped.stop.mockRejectedValue(new Error('synthetic HLS cleanup failure'));
        const replacement = fakeStream({ isEnable: false, type: 'LiveHLS' });

        await expect(manager.start(stopped)).resolves.toBe(0);
        await expect(manager.stop(0, true)).resolves.toBeUndefined();

        expect(manager.getStreamInfos()).toEqual([]);
        await expect(manager.start(replacement)).resolves.toBe(1);
        expect(manager.getStreamInfos()).toEqual([{ info: replacement.getInfo(), streamId: 1 }]);
        expect(socket.notifyClient).toHaveBeenCalled();

        await manager.stop(1, true);
    });

    it('publishes readiness from exact filesystem artifacts without counting an adjacent ID', async () => {
        vi.useFakeTimers();
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-readiness-'));
        dirs.push(dir);
        const socket = { notifyClient: vi.fn() };
        const index = new HLSFileDeleterModel({ getLogger: logger });
        const originalListExact = index.listExact.bind(index);
        let finishFirstScan: (() => void) | undefined;
        const firstScan = new Promise<void>(resolve => {
            finishFirstScan = resolve;
        });
        vi.spyOn(index, 'listExact').mockImplementation(async (...args: [string, number]) => {
            const files = await originalListExact(...args);
            finishFirstScan?.();
            finishFirstScan = undefined;
            return files;
        });
        const child = fakeChild();
        const model = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            {
                createHlsWriter: vi.fn(async () => ({ child, handle: Object.freeze({ kind: 'hls-writer' }) })),
                stopHls: vi.fn(async () => ({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true })),
            },
            index,
            { getServiceStream: vi.fn() },
            socket,
        );
        model.setOption({ channelId: 1, cmd: '%NODE%' }, 0);
        writeFileSync(join(dir, 'stream2.m3u8'), '#EXTM3U');
        writeFileSync(join(dir, 'stream2-0.ts'), 'a');
        writeFileSync(join(dir, 'stream20-0.ts'), 'adjacent');

        model.startCheckStreamEnable(2);
        await vi.advanceTimersByTimeAsync(100);
        await firstScan;
        await Promise.resolve();
        expect(model.getInfo().isEnable).toBe(false);
        expect(socket.notifyClient).not.toHaveBeenCalled();

        writeFileSync(join(dir, 'stream2-1.ts'), 'b');
        const ready = new Promise<void>(resolve => socket.notifyClient.mockImplementationOnce(resolve));
        await vi.advanceTimersByTimeAsync(100);
        await ready;

        expect(model.getInfo().isEnable).toBe(true);
        expect(socket.notifyClient).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        index.setOption({ streamFilePath: dir, streamId: 2 });
        await model.stop();
    });

    it('does not rewrite a real subtitle playlist after stop and same-ID readiness replacement', async () => {
        vi.useFakeTimers();
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-readiness-generation-'));
        dirs.push(dir);
        const original = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmedia.m3u8';
        for (const [name, content] of [
            ['stream9.m3u8', original],
            ['stream9-child_vtt.m3u8', '#EXTM3U'],
            ['stream9-0.ts', 'a'],
            ['stream9-1.ts', 'b'],
        ]) {
            writeFileSync(join(dir, name), content);
        }
        const files = deferred<string[]>();
        const index = new HLSFileDeleterModel({ getLogger: logger });
        const listExact = vi.spyOn(index, 'listExact').mockImplementationOnce(() => files.promise);
        const model = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            {
                createHlsWriter: vi.fn(),
                stopHls: vi.fn(async () => ({ exitConfirmed: true, sentSignals: [], slotReleased: true })),
            },
            index,
            { getServiceStream: vi.fn() },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 1, cmd: '%NODE%' }, 0);
        model.startCheckStreamEnable(9);
        await vi.advanceTimersByTimeAsync(100);
        expect(listExact).toHaveBeenCalledOnce();

        index.setOption({ streamFilePath: dir, streamId: 999 });
        await model.stop();
        model.startCheckStreamEnable(9);
        files.resolve(['stream9.m3u8', 'stream9-child_vtt.m3u8', 'stream9-0.ts', 'stream9-1.ts']);
        for (let index = 0; index < 10; index++) {
            await Promise.resolve();
        }

        expect(readFileSync(join(dir, 'stream9.m3u8'), 'utf8')).toBe(original);
        expect(model.getInfo().isEnable).toBe(false);
        await model.stop();
    });

    it('does not write a stale subtitle playlist when stop and same-ID replacement win during parent read', async () => {
        vi.useFakeTimers();
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-readiness-read-race-'));
        dirs.push(dir);
        const original = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmedia.m3u8';
        for (const [name, content] of [
            ['stream9.m3u8', original],
            ['stream9-child_vtt.m3u8', '#EXTM3U'],
            ['stream9-0.ts', 'a'],
            ['stream9-1.ts', 'b'],
        ]) {
            writeFileSync(join(dir, name), content);
        }
        const parentRead = deferred<string>();
        const index = new HLSFileDeleterModel({ getLogger: logger });
        const readFile = vi.spyOn(FileUtil, 'readFile').mockImplementationOnce(() => parentRead.promise);
        const writeFile = vi.spyOn(FileUtil, 'writeFile');
        const model = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            {
                createHlsWriter: vi.fn(),
                stopHls: vi.fn(async () => ({ exitConfirmed: true, sentSignals: [], slotReleased: true })),
            },
            index,
            { getServiceStream: vi.fn() },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 1, cmd: '%NODE%' }, 0);
        model.startCheckStreamEnable(9);
        await vi.advanceTimersByTimeAsync(100);
        await vi.waitFor(() => expect(readFile).toHaveBeenCalledOnce());

        index.setOption({ streamFilePath: dir, streamId: 999 });
        await model.stop();
        model.startCheckStreamEnable(9);
        parentRead.resolve(original);
        for (let count = 0; count < 10; count++) await Promise.resolve();

        expect(writeFile).not.toHaveBeenCalled();
        expect(readFileSync(join(dir, 'stream9.m3u8'), 'utf8')).toBe(original);
        expect(model.getInfo().isEnable).toBe(false);
        await model.stop();
    });
});
