import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    baseConfig,
    compiled,
    deferred,
    executionManager,
    fakeChild,
    fakeStream,
    logger,
    prepareEncodeProcessManageModel,
    spawnStub,
} from './_media-harness';

const HLSFileDeleterModel = compiled<any>('model', 'service', 'stream', 'util', 'HLSFileDeleterModel.js').default;
const LiveHLSStreamModel = compiled<any>('model', 'service', 'stream', 'LiveHLSStreamModel.js').default;
const LiveStreamModel = compiled<any>('model', 'service', 'stream', 'LiveStreamModel.js').default;
const LoggerModel = compiled<any>('model', 'LoggerModel.js').default;
const RecordedHLSStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedHLSStreamModel.js').default;
const RecordedStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedStreamModel.js').default;
const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;
let EncodeProcessManageModel: new (...args: any[]) => any;
beforeAll(async () => {
    EncodeProcessManageModel = await prepareEncodeProcessManageModel();
});

describe('encode process boundary', () => {
    beforeEach(() => {
        spawnStub.mockImplementation(() => {
            const child = new EventEmitter() as any;
            child.exitCode = null;
            child.stdin = new PassThrough();
            child.stdout = new PassThrough();
            child.stderr = new PassThrough();
            child.kill = vi.fn();
            return child;
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        // `spawnStub` is a plain `vi.fn()`, not a `vi.spyOn` spy -- `resetAllMocks` (unlike
        // `restoreAllMocks`) restores its creation-time (real `child_process.spawn`) implementation.
        vi.resetAllMocks();
    });

    it('[MD-5.4] replaces only non-null INPUT/OUTPUT and inherits the parent environment', async () => {
        const manager = new EncodeProcessManageModel(
            { getLogger: logger },
            { getConfig: () => ({ encodeProcessNum: 2 }) },
        );
        await manager.create({
            cmd: '%NODE% %INPUT% %OUTPUT% %UNUSED%',
            input: 'synthetic-input',
            output: null,
            priority: 1,
        });
        expect(spawnStub).toHaveBeenCalledWith(process.argv[0], ['synthetic-input', '%OUTPUT%', '%UNUSED%']);
    });

    it('[MD-5.4] lets an actual synthetic child read the inherited parent environment', async () => {
        spawnStub.mockReset();
        const dir = mkdtempSync(join(tmpdir(), 'epg-media-child-'));
        const scriptPath = join(dir, 'read-parent-env.cjs');
        const outputPath = join(dir, 'child-output.txt');
        const markerName = 'EPGSTATION_SYNTHETIC_MEDIA_MARKER';
        const previousMarker = process.env[markerName];
        process.env[markerName] = 'synthetic-parent-marker';
        writeFileSync(
            scriptPath,
            `require('node:fs').writeFileSync(process.argv[2], process.env.${markerName} ?? 'missing')`,
        );

        try {
            const manager = new EncodeProcessManageModel(
                { getLogger: logger },
                { getConfig: () => ({ encodeProcessNum: 2 }) },
            );
            const child = await manager.create({
                cmd: `%NODE% ${scriptPath} ${outputPath}`,
                input: null,
                output: null,
                priority: 1,
            });
            await new Promise<void>((resolve, reject) => {
                if (child.exitCode !== null) {
                    resolve();
                    return;
                }
                child.once('exit', (code: number | null) =>
                    code === 0 ? resolve() : reject(new Error(`synthetic child exit ${code}`)),
                );
                child.once('error', reject);
            });

            expect(readFileSync(outputPath, 'utf8')).toBe('synthetic-parent-marker');
        } finally {
            if (previousMarker === undefined) delete process.env[markerName];
            else process.env[markerName] = previousMarker;
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('[MD-1.2][MD-1.4][MD-6.1][MD-9.8] connects the actual managed process and logger to transformed live start, body, and stop', async () => {
        spawnStub.mockReset();
        const dir = mkdtempSync(join(tmpdir(), 'epg-media-live-transform-'));
        const scriptPath = join(dir, 'copy-stdin.cjs');
        writeFileSync(scriptPath, "process.on('SIGINT', () => process.exit(0)); process.stdin.pipe(process.stdout);");
        const actualLogger = new LoggerModel();
        actualLogger.initialize();
        for (const category of Object.values(actualLogger.getLogger()) as any[]) category.level = 'off';
        const logs = { getLogger: () => actualLogger.getLogger() };
        const processManager = new EncodeProcessManageModel(logs, { getConfig: () => ({ encodeProcessNum: 1 }) });
        const requestStop = vi.spyOn(processManager, 'requestStop');
        const tuner = new PassThrough();
        const close = vi.fn(() => tuner.destroy());
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            logs,
            processManager,
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101, cmd: `%NODE% ${scriptPath}` }, 0);
        const manager = new StreamManageModel(logs, executionManager(), { notifyClient: vi.fn() });

        try {
            const streamId = await manager.start(model);
            const body = new Promise<Buffer>((resolve, reject) =>
                model.getStream().once('data', resolve).once('error', reject),
            );
            tuner.write('actual-transformed-body');
            await expect(body).resolves.toEqual(Buffer.from('actual-transformed-body'));

            await manager.stop(streamId);
            expect(close).toHaveBeenCalledOnce();
            expect(requestStop).toHaveBeenCalledOnce();
            expect(manager.getStreamInfos()).toEqual([]);
        } finally {
            await manager.stopAll();
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('[MD-3.4][MD-3.6][MD-3.10][MD-4.7] connects the actual HLS writer handle to readiness, keep, and artifact cleanup', async () => {
        spawnStub.mockReset();
        const dir = mkdtempSync(join(tmpdir(), 'epg-media-live-hls-writer-'));
        const scriptPath = join(dir, 'write-hls.cjs');
        writeFileSync(
            scriptPath,
            [
                "const fs = require('node:fs');",
                "const path = require('node:path');",
                'const root = process.argv[2];',
                'const streamId = process.argv[3];',
                "fs.writeFileSync(path.join(root, `stream${streamId}.m3u8`), '#EXTM3U');",
                "fs.writeFileSync(path.join(root, `stream${streamId}-0.ts`), 'segment');",
                "fs.writeFileSync(path.join(root, `stream${streamId}-1.ts`), 'segment');",
                "process.on('SIGINT', () => process.exit(0));",
                'process.stdin.resume();',
                'setInterval(() => undefined, 1000);',
            ].join('\n'),
        );
        const actualLogger = new LoggerModel();
        actualLogger.initialize();
        for (const category of Object.values(actualLogger.getLogger()) as any[]) category.level = 'off';
        const logs = { getLogger: () => actualLogger.getLogger() };
        const processManager = new EncodeProcessManageModel(logs, { getConfig: () => ({ encodeProcessNum: 1 }) });
        const stopHls = vi.spyOn(processManager, 'stopHls');
        const tuner = new PassThrough();
        const model = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            logs,
            processManager,
            new HLSFileDeleterModel(logs),
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(() => tuner.destroy()), stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101, cmd: `%NODE% ${scriptPath} %streamFileDir% %streamNum%` }, 0);
        const manager = new StreamManageModel(logs, executionManager(), { notifyClient: vi.fn() });

        try {
            const streamId = await manager.start(model);
            await vi.waitFor(() => expect(model.getInfo().isEnable).toBe(true));
            expect(readFileSync(join(dir, `stream${streamId}.m3u8`), 'utf8')).toBe('#EXTM3U');
            expect(readFileSync(join(dir, `stream${streamId}-0.ts`), 'utf8')).toBe('segment');
            expect(readFileSync(join(dir, `stream${streamId}-1.ts`), 'utf8')).toBe('segment');

            manager.keep(streamId);
            await manager.stop(streamId);
            expect(stopHls).toHaveBeenCalledOnce();
            expect(manager.getStreamInfos()).toEqual([]);
            expect(() => readFileSync(join(dir, `stream${streamId}.m3u8`))).toThrow();
            expect(() => readFileSync(join(dir, `stream${streamId}-0.ts`))).toThrow();
            expect(() => readFileSync(join(dir, `stream${streamId}-1.ts`))).toThrow();
        } finally {
            await manager.stopAll();
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('[MD-2.3][MD-3.4][MD-4.7] connects the recorded HLS consumer to the actual writer playlist and stop handle', async () => {
        spawnStub.mockReset();
        const dir = mkdtempSync(join(tmpdir(), 'epg-media-recorded-hls-writer-'));
        const scriptPath = join(dir, 'write-recorded-hls.cjs');
        const inputPath = join(dir, 'recorded.mp4');
        writeFileSync(inputPath, 'recorded-source');
        writeFileSync(
            scriptPath,
            [
                "const fs = require('node:fs');",
                "const path = require('node:path');",
                'const root = process.argv[2];',
                'const streamId = process.argv[3];',
                "fs.writeFileSync(path.join(root, `stream${streamId}.m3u8`), '#EXTM3U');",
                "fs.writeFileSync(path.join(root, `stream${streamId}-0.ts`), 'recorded-segment');",
                "fs.writeFileSync(path.join(root, `stream${streamId}-1.ts`), 'recorded-segment');",
                "process.on('SIGINT', () => process.exit(0));",
                'process.stdin.resume();',
                'setInterval(() => undefined, 1000);',
            ].join('\n'),
        );
        const actualLogger = new LoggerModel();
        actualLogger.initialize();
        for (const category of Object.values(actualLogger.getLogger()) as any[]) category.level = 'off';
        const logs = { getLogger: () => actualLogger.getLogger() };
        const processManager = new EncodeProcessManageModel(logs, { getConfig: () => ({ encodeProcessNum: 1 }) });
        const stopHls = vi.spyOn(processManager, 'stopHls');
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            logs,
            processManager,
            new HLSFileDeleterModel(logs),
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setPlaybackSource({
            inputPath,
            kind: 'encoded-direct',
            playPosition: 4,
            recordedId: 41,
            videoFileId: 31,
            videoInfo: { bitRate: 8, duration: 10, size: 10 },
        });
        model.setOption(
            { cmd: `%NODE% ${scriptPath} %streamFileDir% %streamNum% %INPUT% %SS%`, playPosition: 4, videoFileId: 31 },
            0,
        );
        const manager = new StreamManageModel(logs, executionManager(), { notifyClient: vi.fn() });

        try {
            const streamId = await manager.start(model);
            await vi.waitFor(() => expect(model.getInfo().isEnable).toBe(true));
            expect(readFileSync(join(dir, `stream${streamId}.m3u8`), 'utf8')).toBe('#EXTM3U');
            expect(readFileSync(join(dir, `stream${streamId}-0.ts`), 'utf8')).toBe('recorded-segment');

            await manager.stop(streamId);
            expect(stopHls).toHaveBeenCalledOnce();
            expect(manager.getStreamInfos()).toEqual([]);
            expect(() => readFileSync(join(dir, `stream${streamId}.m3u8`))).toThrow();
        } finally {
            await manager.stopAll();
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('[MD-1.6] releases an instantly terminal managed child through its opaque handle', async () => {
        const child = fakeChild();
        child.exitCode = 1;
        const handle = Object.freeze({ kind: 'managed-live-terminal' });
        const requestStop = vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' }));
        const tuner = new PassThrough();
        const close = vi.fn(() => tuner.destroy());
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged: vi.fn(async () => ({ child, handle })), requestStop },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101, cmd: '%NODE% synthetic-live-terminal' }, 0);
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });

        await expect(manager.start(model)).rejects.toThrow('StreamStartStopped');
        await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());

        expect(requestStop).toHaveBeenCalledOnce();
        expect(requestStop).toHaveBeenCalledWith(handle);
        expect(child.kill).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(manager.getStreamInfos()).toEqual([]), { timeout: 2000 });
    });

    it('[MD-1.8][MD-10.4] rejects a timed-out live start and closes only its late tuner handle', async () => {
        vi.useFakeTimers();
        const pendingTuner = deferred<any>();
        const tuner = new PassThrough();
        const close = vi.fn(() => tuner.destroy());
        const processManager = {
            createManaged: vi.fn(),
            requestStop: vi.fn(),
        };
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            processManager,
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { openServiceStream: vi.fn(() => pendingTuner.promise) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101 }, 0);
        const notifyClient = vi.fn();
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient });

        const start = manager.start(model);
        const rejected = expect(start).rejects.toThrow('StreamStartTimeout');

        await vi.advanceTimersByTimeAsync(30_000);
        await rejected;
        expect(notifyClient).toHaveBeenCalledTimes(3);
        const notificationsBeforeLateTuner = notifyClient.mock.calls.length;
        pendingTuner.resolve({ close, stream: tuner });
        await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());

        expect(close).toHaveBeenCalledOnce();
        expect(processManager.createManaged).not.toHaveBeenCalled();
        expect(notifyClient).toHaveBeenCalledTimes(notificationsBeforeLateTuner);
        expect(manager.getStreamInfos()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-2.12][MD-4.4][MD-10.4] keeps a post-snapshot start while preventing stale recorded process creation', async () => {
        vi.useFakeTimers();
        const pendingContent = deferred<any>();
        const processManager = {
            createHlsWriter: vi.fn(),
            createManaged: vi.fn(),
            requestStop: vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' })),
            stopHls: vi.fn(),
        };
        const videoFileDB = { findId: vi.fn(() => pendingContent.promise) };
        const recordedDB = { findId: vi.fn(async () => ({ isRecording: false })) };
        const videoUtil = { getFullFilePathFromId: vi.fn(async () => 'synthetic-recorded.ts') };
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            processManager,
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            videoFileDB,
            recordedDB,
            videoUtil,
        );
        model.getVideoInfo = vi.fn(async () => ({ bitRate: 8, duration: 30, size: 30 }));
        const processOptionCreated = deferred<void>();
        const createProcessOption = model.createProcessOption.bind(model);
        model.createProcessOption = vi.fn(async (streamId: number) => {
            const option = await createProcessOption(streamId);
            processOptionCreated.resolve();
            return option;
        });
        model.setOption({ cmd: '%NODE% synthetic-recorded-late', playPosition: 0, videoFileId: 31 }, 0);
        const notifyClient = vi.fn();
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient });
        const replacement = fakeStream({ channelId: 202, isEnable: true, mode: 0, type: 'LiveStream' });

        const start = manager.start(model);
        const rejected = expect(start).rejects.toThrow('StreamStartStopped');
        await vi.waitFor(() => expect(videoFileDB.findId).toHaveBeenCalledWith(31));
        expect(manager.getStreamInfos().map(({ streamId }: any) => streamId)).toEqual([0]);
        manager.keep(0);
        expect(vi.getTimerCount()).toBe(2);

        const stopping = manager.stopAll();
        const replacementStart = manager.start(replacement);
        await expect(replacementStart).resolves.toBe(1);
        await rejected;
        await stopping;
        expect(notifyClient).toHaveBeenCalledTimes(5);
        const notificationsBeforeLateResources = notifyClient.mock.calls.length;
        pendingContent.resolve({ id: 31, recordedId: 41, type: 'encoded' });
        await processOptionCreated.promise;
        await Promise.resolve();

        expect(processManager.createManaged).not.toHaveBeenCalled();
        expect(processManager.requestStop).not.toHaveBeenCalled();
        expect(notifyClient).toHaveBeenCalledTimes(notificationsBeforeLateResources);
        expect(replacement.stop).not.toHaveBeenCalled();
        expect(manager.getStreamInfos().map(({ streamId }: any) => streamId)).toEqual([1]);
        expect(vi.getTimerCount()).toBe(0);

        await manager.stop(1);
    });

    it('[MD-2.12][MD-10.4] clears the start deadline after a recorded tail reader establishes', async () => {
        vi.useFakeTimers();
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'managed-recorded-tail' });
        const reader = { close: vi.fn(async () => undefined), readable: new PassThrough() };
        const processManager = {
            createManaged: vi.fn(async () => ({ child, handle })),
            requestStop: vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' })),
        };
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            processManager,
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setOption({ cmd: '%NODE% synthetic-recorded-tail', playPosition: 0, videoFileId: 31 }, 0);
        model.setPlaybackSource({
            inputPath: 'synthetic-recording.ts',
            kind: 'recording-tail-reader',
            playPosition: 0,
            reader,
            recordedId: 41,
            videoFileId: 31,
            videoInfo: { bitRate: 8, duration: 60, size: 480 },
        });
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });

        await expect(manager.start(model)).resolves.toBe(0);
        expect((manager as any).streams[0].startTimer).toBeNull();
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(14_999);
        manager.keep(0);
        await vi.advanceTimersByTimeAsync(14_999);
        manager.keep(0);
        await vi.advanceTimersByTimeAsync(3);

        const receivedTailData = new Promise<Buffer>(resolve => child.stdin.once('data', resolve));
        reader.readable.write('tail-after-start-deadline');
        await expect(receivedTailData).resolves.toEqual(Buffer.from('tail-after-start-deadline'));

        expect(manager.getStreamInfos().map(({ streamId }: any) => streamId)).toEqual([0]);
        expect(processManager.requestStop).not.toHaveBeenCalled();
        await manager.stop(0);
        expect(reader.close).toHaveBeenCalledOnce();
        expect(processManager.requestStop).toHaveBeenCalledWith(handle);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-6.2] routes a recorded terminal child through its saved managed handle before final removal', async () => {
        const reader = new PassThrough();
        reader.destroy = vi.fn(reader.destroy.bind(reader));
        const processManager = new EncodeProcessManageModel(
            { getLogger: logger },
            { getConfig: () => ({ encodeProcessNum: 2 }) },
        );
        const createManaged = vi.spyOn(processManager, 'createManaged');
        const requestStop = vi.spyOn(processManager, 'requestStop');
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            processManager,
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn(async () => ({ id: 31, recordedId: 41, type: 'ts' })) },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = 'synthetic-recording.ts';
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'ts';
            model.isRecording = true;
        });
        model.setFileStream = vi.fn(() => {
            model.fileStream = reader;
        });
        model.setOption({ cmd: '%NODE% synthetic-recorded-terminal', playPosition: 0, videoFileId: 31 }, 0);
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });

        const start = manager.start(model);
        await vi.waitFor(() => expect(spawnStub).toHaveBeenCalledOnce());
        const child = spawnStub.mock.results[0]?.value as any;
        expect(child).toBeDefined();
        child.emit('spawn');
        await start;
        const startedProcess = await createManaged.mock.results[0]?.value;
        if (startedProcess === undefined) throw new Error('managed process start result was not captured');

        child.exitCode = 0;
        child.emit('exit', 0);
        await vi.waitFor(() => expect(requestStop).toHaveBeenCalledOnce());

        expect(requestStop.mock.calls[0]?.[0]).toBe(startedProcess.handle);
        await expect(requestStop.mock.results[0]?.value).resolves.toEqual({
            sentSignals: [],
            status: 'already-released',
        });
        expect(reader.destroy).toHaveBeenCalledOnce();
        expect(child.kill).not.toHaveBeenCalled();
        expect(manager.getStreamInfos()).toEqual([]);
    });
});
