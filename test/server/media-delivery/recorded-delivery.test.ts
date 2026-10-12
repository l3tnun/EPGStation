import { appendFileSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    baseConfig,
    compiled,
    fakeChild,
    fsStubs as nodeFs,
    logger,
    prepareRecordedDeliveryFsMocks,
} from './_media-harness';

const RecordedHLSStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedHLSStreamModel.js').default;
let RecordedStreamModel: new (...args: any[]) => any;
let tail: any;
let container: any;
beforeAll(async () => {
    ({ container, RecordedStreamModel, TailStream: tail } = await prepareRecordedDeliveryFsMocks());
});
const requireFromPackage = createRequire(join(process.cwd(), 'package.json'));
const ID3MetadataTransform = requireFromPackage('arib-subtitle-timedmetadater').default as {
    new (): import('node:stream').Transform;
    prototype: import('node:stream').Transform;
};
const statWithSize = (size: number): import('node:fs').Stats => ({ size }) as import('node:fs').Stats;

const observeTailStreamLifecycle = (stream: import('node:stream').Readable) => {
    let error: Error | undefined;
    const closed = new Promise<void>(resolve => stream.once('close', resolve));
    stream.once('error', streamError => {
        error = streamError;
    });
    return {
        assertClosedWithoutError: async (): Promise<void> => {
            await closed;
            expect(error).toBeUndefined();
        },
    };
};

const dirs: string[] = [];
afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

beforeAll(() => {
    if (!container.isBound('ILoggerModel')) container.bind('ILoggerModel').toConstantValue({ getLogger: logger });
});

afterAll(() => {
    if (container.isBound('ILoggerModel')) container.unbind('ILoggerModel');
});

const createRecorded = (hls = false) => {
    const child = fakeChild();
    const handle = Object.freeze({ kind: 'managed' });
    const log = logger();
    const videoFileDB = { findId: vi.fn(async () => null) };
    const recordedDB = { findId: vi.fn(async () => null) };
    const videoUtil = { getFullFilePathFromId: vi.fn() };
    const processManager = {
        createHlsWriter: vi.fn(async () => ({ child, handle: Object.freeze({ kind: 'hls' }) })),
        createManaged: vi.fn(async () => ({ child, handle })),
        requestStop: vi.fn(async () => ({ status: 'requested', sentSignals: ['SIGINT'] })),
        stopHls: vi.fn(async () => ({ status: 'requested', sentSignals: ['SIGINT'] })),
    };
    const fileDeleter = { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() };
    const Model = hls ? RecordedHLSStreamModel : RecordedStreamModel;
    const model = new Model(
        { getConfig: () => baseConfig() },
        { getLogger: () => log },
        processManager,
        fileDeleter,
        { notifyClient: vi.fn() },
        videoFileDB,
        recordedDB,
        videoUtil,
    );
    return { child, fileDeleter, log, model, processManager, recordedDB, videoFileDB, videoUtil };
};

describe('recorded stream implementation characterization', () => {
    it('[MD-2.4][MD-2.5][MD-2.6] expands seek/input/HLS placeholders and recording input', async () => {
        const { model } = createRecorded(true);
        model.processOption = {
            cmd: '%FFMPEG% %SS% %streamFileDir% %streamNum%',
            playPosition: 12.5,
            videoFileId: 31,
        };
        model.videoFilePath = 'synthetic/video.ts';
        model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
        model.videoFileType = 'ts';
        model.isRecording = true;
        await expect(model.createProcessOption(7)).resolves.toEqual({
            cmd: 'synthetic-ffmpeg  synthetic-stream-root 7',
            input: null,
            output: 'synthetic-stream-root/stream7.m3u8',
            priority: 1,
        });

        model.videoFileType = 'encoded';
        model.isRecording = false;
        await expect(model.createProcessOption(7)).resolves.toMatchObject({
            cmd: 'synthetic-ffmpeg 12.5 synthetic-stream-root 7',
            input: 'synthetic/video.ts',
        });
    });

    it('[MD-2.7][MD-2.9] accepts the duration boundary and rejects values beyond it', async () => {
        const { model, processManager } = createRecorded();
        model.setOption({ cmd: '%NODE%', playPosition: 30, videoFileId: 31 }, 0);
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = 'synthetic/video.ts';
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'encoded';
        });
        await expect(model.start(0)).resolves.toBeUndefined();
        expect(processManager.createManaged).toHaveBeenCalledOnce();
        await model.stop();

        model.setOption({ cmd: '%NODE%', playPosition: 30.1, videoFileId: 31 }, 0);
        await expect(model.start(0)).rejects.toThrow('OutOfRange');
    });

    it('[MD-5.1] starts a new recorded stop operation for a later completed session', async () => {
        const { model, processManager } = createRecorded();
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 31 }, 0);
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = 'synthetic/video.ts';
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'encoded';
            model.isRecording = false;
        });

        await model.start(0);
        await model.stop();
        await model.start(1);
        await model.stop();

        expect(processManager.createManaged).toHaveBeenCalledTimes(2);
        expect(processManager.requestStop).toHaveBeenCalledTimes(2);
    });

    it('[MD-6.2] retains the managed handle after process exit until stop delegates it once', async () => {
        const { child, model, processManager } = createRecorded();
        const reader = new PassThrough();
        reader.destroy = vi.fn(reader.destroy.bind(reader));
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 31 }, 0);
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = 'synthetic/recording.ts';
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'ts';
            model.isRecording = true;
        });
        model.setFileStream = vi.fn(() => {
            model.fileStream = reader;
        });

        await model.start(0);
        child.emit('exit', 0);
        await model.stop();

        expect(processManager.requestStop).toHaveBeenCalledOnce();
        expect(processManager.requestStop).toHaveBeenCalledWith(expect.objectContaining({ kind: 'managed' }));
        expect(reader.destroy).toHaveBeenCalledOnce();
        expect(child.kill).not.toHaveBeenCalled();
    });

    it('[MD-2.8] preserves missing-video and file-open failures', async () => {
        const { model } = createRecorded();
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 31 }, 0);
        await expect(model.start(0)).rejects.toThrow('VideoIsNull');

        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = 'missing.ts';
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'ts';
        });
        const createReadStream = nodeFs.createReadStream.mockImplementationOnce(() => {
            throw new Error('synthetic open failure');
        });
        await expect(model.start(0)).rejects.toThrow('FileStreamSetError');
        createReadStream.mockRestore();
    });

    it('[MD-2.4] closes an adopted reader when range validation fails before file stream setup', async () => {
        const { model, processManager } = createRecorded();
        const reader = { close: vi.fn(async () => undefined), readable: new PassThrough() };
        model.setOption({ cmd: '%NODE%', playPosition: 61, videoFileId: 31 }, 0);
        model.setPlaybackSource({
            inputPath: 'synthetic/recording.ts',
            kind: 'recording-tail-reader',
            playPosition: 61,
            reader,
            recordedId: 41,
            videoFileId: 31,
            videoInfo: { bitRate: 8, duration: 60, size: 480 },
        });

        await expect(model.start(7)).rejects.toThrow('OutOfRange');

        expect(reader.close).toHaveBeenCalledOnce();
        expect(processManager.createManaged).not.toHaveBeenCalled();
    });

    it('[MD-2.4] closes an adopted reader when HLS preparation fails before file stream setup', async () => {
        const { model } = createRecorded(true);
        const reader = { close: vi.fn(async () => undefined), readable: new PassThrough() };
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 31 }, 0);
        model.setPlaybackSource({
            inputPath: 'synthetic/recording.ts',
            kind: 'recording-tail-reader',
            playPosition: 0,
            reader,
            recordedId: 41,
            videoFileId: 31,
            videoInfo: { bitRate: 8, duration: 60, size: 480 },
        });
        model.prepStreamDir = vi.fn(async () => {
            throw new Error('synthetic HLS preparation failure');
        });

        await expect(model.start(7)).rejects.toThrow('synthetic HLS preparation failure');

        expect(reader.close).toHaveBeenCalledOnce();
    });

    it('[MD-2.4] continues managed process cleanup when an adopted reader close rejects', async () => {
        const { log, model, processManager } = createRecorded();
        const closeFailure = new Error('synthetic reader close failure');
        const reader = {
            close: vi.fn(async () => {
                throw closeFailure;
            }),
            readable: new PassThrough(),
        };
        const handle = Object.freeze({ kind: 'managed-after-reader-close-failure' });
        model.setPlaybackSource({
            inputPath: 'synthetic/recording.ts',
            kind: 'recording-tail-reader',
            playPosition: 0,
            reader,
            recordedId: 41,
            videoFileId: 31,
            videoInfo: { bitRate: 8, duration: 60, size: 480 },
        });
        model.streamProcessHandle = handle;

        await expect(model.stop()).resolves.toBeUndefined();

        expect(reader.close).toHaveBeenCalledOnce();
        expect(log.stream.error).toHaveBeenNthCalledWith(1, 'recorded playback source reader close error');
        expect(log.stream.error).toHaveBeenNthCalledWith(2, closeFailure);
        expect(processManager.requestStop).toHaveBeenCalledWith(handle);
    });

    it('[MD-2.4] continues HLS writer and artifact cleanup when an adopted reader close rejects', async () => {
        const { fileDeleter, log, model, processManager } = createRecorded(true);
        const closeFailure = new Error('synthetic reader close failure');
        const reader = {
            close: vi.fn(async () => {
                throw closeFailure;
            }),
            readable: new PassThrough(),
        };
        const handle = Object.freeze({ kind: 'hls-after-reader-close-failure' });
        model.setPlaybackSource({
            inputPath: 'synthetic/recording.ts',
            kind: 'recording-tail-reader',
            playPosition: 0,
            reader,
            recordedId: 41,
            videoFileId: 31,
            videoInfo: { bitRate: 8, duration: 60, size: 480 },
        });
        model.hlsWriterHandle = handle;

        await expect(model.stop()).resolves.toBeUndefined();

        expect(reader.close).toHaveBeenCalledOnce();
        expect(log.stream.error).toHaveBeenNthCalledWith(1, 'recorded playback source reader close error');
        expect(log.stream.error).toHaveBeenNthCalledWith(2, closeFailure);
        expect(processManager.stopHls).toHaveBeenCalledWith(handle);
        expect(fileDeleter.deleteAllFiles).toHaveBeenCalledOnce();
    });

    it('[MD-2.4] consumes an adopted reader source without a DB or path fallback and releases its reader on stop', async () => {
        const { child, model, processManager, recordedDB, videoFileDB, videoUtil } = createRecorded();
        const reader = { close: vi.fn(async () => undefined), readable: new PassThrough() };
        const pipe = vi.spyOn(reader.readable, 'pipe');
        model.setOption({ cmd: '%NODE% %SS%', playPosition: 12, videoFileId: 31 }, 0);

        model.setPlaybackSource({
            inputPath: 'synthetic/recording.ts',
            kind: 'recording-tail-reader',
            playPosition: 12,
            reader,
            recordedId: 41,
            videoFileId: 31,
            videoInfo: { bitRate: 8, duration: 60, size: 480 },
        });

        await expect(model.start(7)).resolves.toBeUndefined();

        expect(model.videoFileType).toBe('ts');
        expect(videoFileDB.findId).not.toHaveBeenCalled();
        expect(recordedDB.findId).not.toHaveBeenCalled();
        expect(videoUtil.getFullFilePathFromId).not.toHaveBeenCalled();
        expect(processManager.createManaged).toHaveBeenCalledWith({
            cmd: '%NODE% ',
            input: null,
            output: null,
            priority: 1,
        });
        expect(pipe).toHaveBeenCalledWith(child.stdin);

        await model.stop();

        expect(reader.close).toHaveBeenCalledOnce();
    });

    it('[MD-2.4] pipes RecordedHLS ts input through one ID3 transform and tears it down on stop', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-recorded-hls-id3-'));
        dirs.push(dir);
        const { child, model, processManager } = createRecorded(true);
        model.config.streamFilePath = dir;
        const reader = { close: vi.fn(async () => undefined), readable: new PassThrough() };
        const readerPipe = vi.spyOn(reader.readable, 'pipe');
        const originalTransformPipe = ID3MetadataTransform.prototype.pipe;
        const transformPipeCalls: Array<{ transform: import('node:stream').Transform; destination: unknown }> = [];
        const transformPipe = vi.spyOn(ID3MetadataTransform.prototype, 'pipe').mockImplementation(function (
            this: import('node:stream').Transform,
            destination: unknown,
            options?: unknown,
        ) {
            transformPipeCalls.push({ destination, transform: this });
            return originalTransformPipe.call(this, destination as never, options as never);
        });
        model.setOption({ cmd: '%NODE% %SS%', playPosition: 12, videoFileId: 31 }, 0);
        model.setPlaybackSource({
            inputPath: 'synthetic/recording.ts',
            kind: 'recording-tail-reader',
            playPosition: 12,
            reader,
            recordedId: 41,
            videoFileId: 31,
            videoInfo: { bitRate: 8, duration: 60, size: 480 },
        });

        await expect(model.start(7)).resolves.toBeUndefined();

        expect(model.videoFileType).toBe('ts');
        expect(model.getStreamType()).toBe('RecordedHLS');
        expect(processManager.createHlsWriter).toHaveBeenCalledOnce();

        const transform = model.id3MetadataTransoform as import('node:stream').Transform | null;
        expect(transform).toBeInstanceOf(ID3MetadataTransform);
        expect(readerPipe).toHaveBeenCalledWith(transform);
        expect(readerPipe).not.toHaveBeenCalledWith(child.stdin);
        expect(transformPipeCalls.some(call => call.transform === transform && call.destination === child.stdin)).toBe(
            true,
        );

        const unpipe = vi.spyOn(transform!, 'unpipe');
        const destroy = vi.spyOn(transform!, 'destroy');

        await model.stop();

        expect(unpipe).toHaveBeenCalledOnce();
        expect(destroy).toHaveBeenCalledOnce();
        expect(model.id3MetadataTransoform).toBeNull();
        expect(transform!.destroyed).toBe(true);
        expect(reader.close).toHaveBeenCalledOnce();
        expect(processManager.stopHls).toHaveBeenCalledOnce();
        transformPipe.mockRestore();
    });

    it('[MD-2.4] passes an adopted encoded source directly to the process without creating a reader', async () => {
        const { model, processManager, recordedDB, videoFileDB, videoUtil } = createRecorded();
        model.setOption({ cmd: '%NODE% %SS%', playPosition: 12, videoFileId: 31 }, 0);
        model.setPlaybackSource({
            inputPath: 'synthetic/encoded.m2ts',
            kind: 'encoded-direct',
            playPosition: 12,
            recordedId: 41,
            videoFileId: 31,
            videoInfo: { bitRate: 8, duration: 60, size: 480 },
        });

        await expect(model.start(7)).resolves.toBeUndefined();

        expect(model.videoFileType).toBe('encoded');
        expect(videoFileDB.findId).not.toHaveBeenCalled();
        expect(recordedDB.findId).not.toHaveBeenCalled();
        expect(videoUtil.getFullFilePathFromId).not.toHaveBeenCalled();
        expect(processManager.createManaged).toHaveBeenCalledWith({
            cmd: '%NODE% 12',
            input: 'synthetic/encoded.m2ts',
            output: null,
            priority: 1,
        });

        await model.stop();
    });

    it(
        '[MD-2.12] actual TailStream rechecks EOF, follows growth, and closes unchanged',
        { timeout: 7_000 },
        async () => {
            const dir = mkdtempSync(join(tmpdir(), 'epg-tail-growth-'));
            dirs.push(dir);
            const path = join(dir, 'video.ts');
            writeFileSync(path, 'abc');
            const stream = tail.createReadStream(path, { start: 0 });
            let data = '';
            stream.on('data', (chunk: Buffer) => {
                data += chunk.toString();
                if (data === 'abc') setTimeout(() => appendFileSync(path, 'def'), 200);
            });
            await new Promise<void>((resolve, reject) => stream.once('end', resolve).once('error', reject));
            expect(data).toBe('abcdef');
        },
    );

    it('[MD-2.12] closes an actual TailStream reader through the recorded stop path', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-tail-stop-'));
        dirs.push(dir);
        const stream = tail.createReadStream(join(dir, 'synthetic-missing.ts'), { start: 0 });
        const closed = new Promise<void>((resolve, reject) => stream.once('close', resolve).once('error', reject));
        const { model } = createRecorded();
        model.fileStream = stream;

        await model.stop();
        await closed;

        expect(stream.destroyed).toBe(true);
        expect(stream.closed).toBe(true);
    });

    it('[MD-2.6][TailStream] reads from its supplied tail offset instead of the default offset', async () => {
        const open = nodeFs.open.mockImplementation(((path, flags, callback) => {
            callback(null, 16);
        }) as typeof nodeFs.open);
        const fstat = nodeFs.fstat.mockImplementation(((fd, callback) => {
            callback(null, statWithSize(6));
        }) as typeof nodeFs.fstat);
        const read = nodeFs.read.mockImplementation(((fd, buffer, offset, length, position, callback) => {
            callback(null, 1, Buffer.from('x'));
        }) as typeof nodeFs.read);
        const close = nodeFs.close.mockImplementation(((fd, callback) => {
            callback(null);
        }) as typeof nodeFs.close);
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 4 });
        const lifecycle = observeTailStreamLifecycle(stream);

        stream._read(1);

        expect(open).toHaveBeenCalledOnce();
        expect(fstat).toHaveBeenCalledWith(16, expect.any(Function));
        expect(read).toHaveBeenCalledWith(16, expect.any(Buffer), 0, 1, 4, expect.any(Function));
        stream.destroy();
        await lifecycle.assertClosedWithoutError();

        expect(close).toHaveBeenCalledWith(16, expect.any(Function));
    });

    it('[MD-6.2][TailStream] does not open a second descriptor when acquisition is repeated after ready', async () => {
        const open = nodeFs.open.mockImplementation(((path, flags, callback) => {
            callback(null, 20);
        }) as typeof nodeFs.open);
        const close = nodeFs.close.mockImplementation(((fd, callback) => {
            callback(null);
        }) as typeof nodeFs.close);
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 });
        const lifecycle = observeTailStreamLifecycle(stream);

        stream.getFd();

        expect(open).toHaveBeenCalledOnce();
        stream.destroy();
        await lifecycle.assertClosedWithoutError();

        expect(close).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledWith(20, expect.any(Function));
    });

    it('[MD-6.2][TailStream] closes one fd once when destruction overtakes fstat', async () => {
        let fstatCallback: ((error: NodeJS.ErrnoException | null, stat: import('node:fs').Stats) => void) | undefined;
        const open = nodeFs.open.mockImplementation(((path, flags, callback) => {
            callback(null, 17);
        }) as typeof nodeFs.open);
        const fstat = nodeFs.fstat.mockImplementation(((fd, callback) => {
            fstatCallback = callback;
        }) as typeof nodeFs.fstat);
        const read = nodeFs.read.mockImplementation((() => {
            throw new Error('TailStream must not read after destruction');
        }) as typeof nodeFs.read);
        const close = nodeFs.close.mockImplementation(((fd, callback) => {
            callback(null);
        }) as typeof nodeFs.close);
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 });
        const closed = new Promise<void>((resolve, reject) => stream.once('close', resolve).once('error', reject));

        stream._read(1);
        expect(fstat).toHaveBeenCalledWith(17, expect.any(Function));
        if (fstatCallback === undefined) throw new Error('Expected pending fstat callback');
        stream.destroy();
        fstatCallback(null, statWithSize(1));
        await closed;

        expect(read).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledWith(17, expect.any(Function));
    });

    it('[MD-6.2][TailStream] closes a pending read and suppresses its late callback', async () => {
        let readCallback:
            ((error: NodeJS.ErrnoException | null, bytesRead: number, buffer: Buffer) => void) | undefined;
        const open = nodeFs.open.mockImplementation(((path, flags, callback) => {
            callback(null, 18);
        }) as typeof nodeFs.open);
        const fstat = nodeFs.fstat.mockImplementation(((fd, callback) => {
            callback(null, statWithSize(1));
        }) as typeof nodeFs.fstat);
        const read = nodeFs.read.mockImplementation(((fd, buffer, offset, length, position, callback) => {
            readCallback = callback;
        }) as typeof nodeFs.read);
        const close = nodeFs.close.mockImplementation(((fd, callback) => {
            callback(null);
        }) as typeof nodeFs.close);
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 });
        const closed = new Promise<void>((resolve, reject) => stream.once('close', resolve).once('error', reject));
        const data = vi.fn();
        stream.on('data', data);

        stream._read(1);
        expect(read).toHaveBeenCalledOnce();
        stream.destroy();
        readCallback?.(null, 1, Buffer.from('x'));
        await closed;

        expect(data).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledOnce();
        expect(fstat).toHaveBeenCalledOnce();
    });

    it('[MD-6.2][TailStream] closes a late descriptor returned after destruction', async () => {
        let openCallback: ((error: NodeJS.ErrnoException | null, fd: number) => void) | undefined;
        const open = nodeFs.open.mockImplementation(((path, flags, callback) => {
            openCallback = callback;
        }) as typeof nodeFs.open);
        const close = nodeFs.close.mockImplementation(((fd, callback) => {
            callback(null);
        }) as typeof nodeFs.close);
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 });
        const closed = new Promise<void>((resolve, reject) => stream.once('close', resolve).once('error', reject));

        stream.destroy();
        openCallback?.(null, 19);
        await closed;

        expect(close).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledWith(19, expect.any(Function));
    });

    it('[MD-6.2][TailStream] does not close an invalid late open result after destruction', async () => {
        let openCallback: ((error: NodeJS.ErrnoException | null, fd: number) => void) | undefined;
        const open = nodeFs.open.mockImplementation(((path, flags, callback) => {
            openCallback = callback;
        }) as typeof nodeFs.open);
        const close = nodeFs.close.mockImplementation(((fd, callback) => {
            callback(null);
        }) as typeof nodeFs.close);
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 });
        const lifecycle = observeTailStreamLifecycle(stream);
        const openFailure = Object.assign(new Error('missing'), { code: 'ENOENT' });

        stream.destroy();
        openCallback?.(openFailure, -1);
        await lifecycle.assertClosedWithoutError();

        expect(open).toHaveBeenCalledOnce();
        expect(close).not.toHaveBeenCalled();
    });

    it('[MD-6.2][TailStream] treats descriptor zero as open and clears pending tail timers on destruction', async () => {
        vi.useFakeTimers();
        const open = nodeFs.open.mockImplementation(((path, flags, callback) => {
            callback(null, 0);
        }) as typeof nodeFs.open);
        const fstat = nodeFs.fstat.mockImplementation(((fd, callback) => {
            callback(null, statWithSize(0));
        }) as typeof nodeFs.fstat);
        const close = nodeFs.close.mockImplementation(((fd, callback) => {
            callback(null);
        }) as typeof nodeFs.close);
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 });
        const closed = new Promise<void>((resolve, reject) => stream.once('close', resolve).once('error', reject));

        stream._read(1);
        expect(fstat).toHaveBeenCalledWith(0, expect.any(Function));
        stream.destroy();
        await closed;

        expect(close).toHaveBeenCalledWith(0, expect.any(Function));
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-6.2][TailStream] clears an open retry timer when destruction wins', async () => {
        vi.useFakeTimers();
        const open = nodeFs.open.mockImplementation(((path, flags, callback) => {
            callback(Object.assign(new Error('missing'), { code: 'ENOENT' }), -1);
        }) as typeof nodeFs.open);
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 });
        const closed = new Promise<void>((resolve, reject) => stream.once('close', resolve).once('error', reject));

        stream._read(1);
        expect(open).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(1);
        stream.destroy();
        await closed;

        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-2.6][TailStream] does not retry an initial open failure before any read is requested', async () => {
        vi.useFakeTimers();
        const open = nodeFs.open.mockImplementation(((path, flags, callback) => {
            callback(Object.assign(new Error('missing'), { code: 'ENOENT' }), -1);
        }) as typeof nodeFs.open);
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 });
        const lifecycle = observeTailStreamLifecycle(stream);

        expect(open).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        stream.destroy();
        await lifecycle.assertClosedWithoutError();

        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-2.6][TailStream] coalesces duplicate failed open callbacks into one retry timer', async () => {
        vi.useFakeTimers();
        let openCallback: ((error: NodeJS.ErrnoException | null, fd: number) => void) | undefined;
        const open = nodeFs.open.mockImplementation(((path, flags, callback) => {
            openCallback = callback;
        }) as typeof nodeFs.open);
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 });
        const lifecycle = observeTailStreamLifecycle(stream);
        const openFailure = Object.assign(new Error('missing'), { code: 'ENOENT' });

        stream._read(1);
        if (openCallback === undefined) throw new Error('Expected pending open callback');
        openCallback(openFailure, -1);
        openCallback(openFailure, -1);

        expect(open).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(1);
        stream.destroy();
        await lifecycle.assertClosedWithoutError();

        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-2.6][TailStream] retries a pending open, then expires its idle check before closure', async () => {
        vi.useFakeTimers();
        let openAttempts = 0;
        const open = nodeFs.open.mockImplementation(((path, flags, callback) => {
            openAttempts += 1;
            if (openAttempts < 3) {
                callback(Object.assign(new Error('missing'), { code: 'ENOENT' }), -1);
                return;
            }
            callback(null, 25);
        }) as typeof nodeFs.open);
        const fstat = nodeFs.fstat.mockImplementation(((fd, callback) => {
            callback(null, statWithSize(1));
        }) as typeof nodeFs.fstat);
        const read = nodeFs.read.mockImplementation(((fd, buffer, offset, length, position, callback) => {
            callback(null, 1, Buffer.from('x'));
        }) as typeof nodeFs.read);
        nodeFs.stat.mockImplementation(((path, callback) => {
            callback(null, statWithSize(1));
        }) as typeof nodeFs.stat);
        const close = nodeFs.close.mockImplementation(((fd, callback) => {
            callback(null);
        }) as typeof nodeFs.close);
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 });
        const lifecycle = observeTailStreamLifecycle(stream);

        stream._read(1);
        expect(open).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(1_000);

        expect(open).toHaveBeenCalledTimes(3);
        expect(fstat).toHaveBeenCalledWith(25, expect.any(Function));
        expect(read).toHaveBeenCalledWith(25, expect.any(Buffer), 0, 1, 0, expect.any(Function));
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(vi.getTimerCount()).toBe(0);

        stream.destroy();
        await lifecycle.assertClosedWithoutError();

        expect(close).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledWith(25, expect.any(Function));
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-2.12][TailStream] emits an error and closes its descriptor when fstat fails', async () => {
        const failure = Object.assign(new Error('synthetic fstat failure'), { code: 'EIO' });
        const open = nodeFs.open.mockImplementation(((path, flags, callback) => {
            callback(null, 26);
        }) as typeof nodeFs.open);
        const fstat = nodeFs.fstat.mockImplementation(((fd, callback) => {
            callback(failure, statWithSize(0));
        }) as typeof nodeFs.fstat);
        const close = nodeFs.close.mockImplementation(((fd, callback) => {
            callback(null);
        }) as typeof nodeFs.close);
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 });
        const failed = new Promise<Error>(resolve => stream.once('error', resolve));
        const closed = new Promise<void>(resolve => stream.once('close', resolve));

        stream._read(1);

        await expect(failed).resolves.toBe(failure);
        await closed;
        expect(fstat).toHaveBeenCalledWith(26, expect.any(Function));
        expect(close).toHaveBeenCalledWith(26, expect.any(Function));
    });

    it('[MD-2.12][TailStream] emits an error and closes its descriptor when read fails', async () => {
        const failure = Object.assign(new Error('synthetic read failure'), { code: 'EIO' });
        const open = nodeFs.open.mockImplementation(((path, flags, callback) => {
            callback(null, 27);
        }) as typeof nodeFs.open);
        const fstat = nodeFs.fstat.mockImplementation(((fd, callback) => {
            callback(null, statWithSize(1));
        }) as typeof nodeFs.fstat);
        const read = nodeFs.read.mockImplementation(((fd, buffer, offset, length, position, callback) => {
            callback(failure, 0, buffer);
        }) as typeof nodeFs.read);
        const close = nodeFs.close.mockImplementation(((fd, callback) => {
            callback(null);
        }) as typeof nodeFs.close);
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 });
        const failed = new Promise<Error>(resolve => stream.once('error', resolve));
        const closed = new Promise<void>(resolve => stream.once('close', resolve));

        stream._read(1);

        await expect(failed).resolves.toBe(failure);
        await closed;
        expect(read).toHaveBeenCalledWith(27, expect.any(Buffer), 0, 1, 0, expect.any(Function));
        expect(close).toHaveBeenCalledWith(27, expect.any(Function));
    });

    it('[MD-2.12][TailStream] ends zero-byte reads with an error when the EOF stat fails', async () => {
        vi.useFakeTimers();
        const failure = Object.assign(new Error('synthetic EOF stat failure'), { code: 'EIO' });
        const open = nodeFs.open.mockImplementation(((path, flags, callback) => {
            callback(null, 28);
        }) as typeof nodeFs.open);
        const fstat = nodeFs.fstat.mockImplementation(((fd, callback) => {
            callback(null, statWithSize(1));
        }) as typeof nodeFs.fstat);
        const read = nodeFs.read.mockImplementation(((fd, buffer, offset, length, position, callback) => {
            callback(null, 0, buffer);
        }) as typeof nodeFs.read);
        const stat = nodeFs.stat.mockImplementation(((path, callback) => {
            callback(failure, statWithSize(1));
        }) as typeof nodeFs.stat);
        const close = nodeFs.close.mockImplementation(((fd, callback) => {
            callback(null);
        }) as typeof nodeFs.close);
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 });
        const failed = new Promise<Error>(resolve => stream.once('error', resolve));
        const closed = new Promise<void>(resolve => stream.once('close', resolve));

        stream._read(1);
        await vi.advanceTimersByTimeAsync(1_000);

        await expect(failed).resolves.toBe(failure);
        await closed;
        expect(read).toHaveBeenCalledWith(28, expect.any(Buffer), 0, 1, 0, expect.any(Function));
        expect(stat).toHaveBeenCalledWith('synthetic-recording.ts', expect.any(Function));
        expect(close).toHaveBeenCalledWith(28, expect.any(Function));
    });

    it('[MD-6.2][TailStream] ignores a stat result delivered after destruction', () => {
        vi.useFakeTimers();
        nodeFs.open.mockImplementation(((path, flags, callback) => {
            callback(null, 30);
        }) as typeof nodeFs.open);
        nodeFs.close.mockImplementation(((fd, callback) => {
            callback(null);
        }) as typeof nodeFs.close);
        let statCallback: ((error: NodeJS.ErrnoException | null, stat: import('node:fs').Stats) => void) | undefined;
        const stat = nodeFs.stat.mockImplementation(((path, callback) => {
            statCallback = callback;
        }) as typeof nodeFs.stat);
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 }) as {
            checkFile: (sizeAtEndOfFile: number) => void;
            destroy: () => void;
            doRead: () => void;
            finish: () => void;
            isClosed: boolean;
        };
        const doRead = vi.fn();
        const finish = vi.fn();
        stream.doRead = doRead;
        stream.finish = finish;

        stream.checkFile(10);
        vi.advanceTimersByTime(1_000);
        expect(stat).toHaveBeenCalledOnce();
        if (statCallback === undefined) throw new Error('Expected pending stat callback');

        // Destruction lands through the real destroy()/_destroy()/dispose() path while the stat
        // call is genuinely in flight (fs.stat's own callback is not resolved yet). The late
        // callback must not resume doRead()/finish() even though the reported size (999) differs
        // from sizeAtEndOfFile (10), which would otherwise select the doRead() branch.
        stream.destroy();
        expect(stream.isClosed).toBe(true);
        statCallback(null, statWithSize(999));

        expect(doRead).not.toHaveBeenCalled();
        expect(finish).not.toHaveBeenCalled();
    });

    it('[MD-2.9] preserves the compatible TailStream truncate-and-resend', { timeout: 5_000 }, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-tail-truncate-'));
        dirs.push(dir);
        const path = join(dir, 'video.ts');
        writeFileSync(path, 'abcdef');
        const stream = tail.createReadStream(path, { start: 0 });
        let data = '';
        stream.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (data === 'abcdef') setTimeout(() => truncateSync(path, 2), 200);
        });
        await new Promise<void>((resolve, reject) => stream.once('end', resolve).once('error', reject));
        expect(data).toBe('abcdefab');
    });
});
