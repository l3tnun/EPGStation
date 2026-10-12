import { appendFileSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    baseConfig,
    compiled,
    deferred,
    executionManager,
    fakeChild,
    fakeStream,
    fsStubs as nodeFs,
    logger,
    prepareRecordedDeliveryFsMocks,
} from './_media-harness';

const StreamApiModel = compiled<any>('model', 'api', 'stream', 'StreamApiModel.js').default;
const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;
const VideoApiModel = compiled<any>('model', 'api', 'video', 'VideoApiModel.js').default;
let RecordedStreamModel: new (...args: any[]) => any;
let tail: any;
let container: any;
beforeAll(async () => {
    ({ container, RecordedStreamModel, TailStream: tail } = await prepareRecordedDeliveryFsMocks());
});
const RecordedPlaybackSourceProvider = compiled<any>(
    'model',
    'operator',
    'recorded',
    'RecordedPlaybackSourceProvider.js',
).default;

// 製品の追尾 reader（RecordedPlaybackSourceProvider が録画中の file に対して返す reader）を実 file で開く。
const openRecordingTail = async (initialContent: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'epg-recording-tail-contract-'));
    dirs.push(dir);
    const path = join(dir, 'recording.ts');
    writeFileSync(path, initialContent);
    const provider = new RecordedPlaybackSourceProvider(
        { findId: vi.fn(async () => ({ id: 61, recordedId: 71, type: 'ts' })) },
        { findId: vi.fn(async () => ({ id: 71, isRecording: true })) },
        {
            getFullFilePathFromVideoFile: vi.fn(() => path),
            getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: initialContent.length })),
        },
    );
    const adopted = (await provider.open(61, 71, 0)).adopt();
    if (adopted.status !== 'adopted' || adopted.source.kind !== 'recording-tail-reader') {
        throw new Error('Expected a recording-tail reader');
    }
    const readable = adopted.source.reader.readable;
    let body = '';
    let ended = false;
    readable
        .on('data', (chunk: Buffer) => {
            body += chunk.toString();
        })
        .once('end', () => {
            ended = true;
        });
    return {
        body: () => body,
        ended: () => ended,
        file: Reflect.get(readable, 'file') as import('node:fs/promises').FileHandle,
        path,
        reader: adopted.source.reader as { close(): Promise<void> },
        readable,
    };
};

// `vi.waitFor` は fake timer の下では check のたびに timer を進めるため、時刻を検査する case では interval を 0 にする。
const waitForTailRecheck = async (): Promise<void> => {
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0), { interval: 0 });
    expect(vi.getTimerCount()).toBe(1);
};

const dirs: string[] = [];

afterEach(() => {
    vi.useRealTimers();
    // `fsStubs` (from `./_media-harness`) are plain `vi.fn()`s, not `vi.spyOn` spies -- `restoreAllMocks`
    // only restores spies, so a leftover `mockImplementation` here would otherwise leak into later tests.
    vi.resetAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

const createStreamApi = (type: 'ts' | 'encoded') => {
    const direct = fakeStream();
    const hls = fakeStream();
    const deliveryConsumer = {
        acquireAndOpen: vi.fn(async (videoFileId: number, playPosition: number) => ({
            release: async () => undefined,
            source:
                type === 'encoded'
                    ? {
                          inputPath: 'synthetic/encoded.mp4',
                          kind: 'encoded-direct' as const,
                          playPosition,
                          recordedId: 41,
                          videoFileId,
                          videoInfo: { bitRate: 8, duration: 60, size: 480 },
                      }
                    : {
                          inputPath: 'synthetic/recorded.ts',
                          kind: 'completed-file-reader' as const,
                          playPosition,
                          reader: { close: async () => undefined, readable: {} },
                          recordedId: 41,
                          videoFileId,
                          videoInfo: { bitRate: 8, duration: 60, size: 480 },
                      },
        })),
    };
    const manager = {
        startRecorded: vi.fn(async (streamProvider: any, option: any, consumer: any) => {
            const stream = await streamProvider();
            const delivery = await consumer.acquireAndOpen(option.videoFileId, option.playPosition);
            stream.adoptPlaybackSource(delivery.source, () => delivery.release());
            option.configure(stream, delivery.source);
            return { stream, streamId: 22 };
        }),
    };
    const api = new StreamApiModel(
        { getConfig: () => baseConfig() },
        async () => fakeStream(),
        async () => fakeStream(),
        async () => direct,
        async () => hls,
        manager,
        {},
        {},
        {},
        {},
        {},
        deliveryConsumer,
    );
    return { api, direct, hls, manager };
};

const createRecordedModel = (duration = 10, useNativeVideoLookup = false) => {
    const child = fakeChild();
    const handle = Object.freeze({ kind: 'recorded-contract-handle' });
    const processManager = {
        createManaged: vi.fn(async () => ({ child, handle })),
        requestStop: vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' })),
    };
    const model = new RecordedStreamModel(
        { getConfig: () => baseConfig() },
        { getLogger: logger },
        processManager,
        { deleteAllFiles: vi.fn(), setOption: vi.fn() },
        { notifyClient: vi.fn() },
        { findId: vi.fn(async () => ({ id: 31, recordedId: 41, type: 'ts' })) },
        { findId: vi.fn(async () => ({ isRecording: false })) },
        { getFullFilePathFromId: vi.fn(async () => 'synthetic-recording.ts') },
    );
    if (!useNativeVideoLookup) {
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = 'synthetic-recording.ts';
            model.videoFileInfo = { bitRate: 8, duration, size: 80 };
            model.videoFileType = 'encoded';
            model.isRecording = false;
        });
    } else {
        model.videoFileDB = { findId: vi.fn(async () => null) };
    }
    return { model, processManager };
};

describe('recorded delivery characterization', () => {
    it('[PRIMARY R2.1] provides a registered recorded file for direct playback and download', async () => {
        const model = new VideoApiModel(
            {},
            { findId: async () => ({ filePath: 'synthetic-video.ts', recordedId: 41 }) },
            { findId: async () => ({ duration: 61_900, name: 'synthetic-recorded' }) },
            {},
            { getFullFilePathFromId: async () => 'synthetic-storage/video.ts' },
            {},
        );
        model.createMime = async () => 'video/mp2t';

        await expect(model.getFullFilePath(31)).resolves.toEqual({
            mime: 'video/mp2t',
            path: 'synthetic-storage/video.ts',
        });
    });

    it('[PRIMARY R2.2] selects the configured source-file methods for an original TS recording', async () => {
        const { api, direct, hls, manager } = createStreamApi('ts');
        await api.startRecordedWebMStream({ mode: 0, playPosition: 12, videoFileId: 31 });
        await api.startRecordedMp4Stream({ mode: 0, playPosition: 12, videoFileId: 31 });
        await expect(api.startRecordedHLSStream({ mode: 0, playPosition: 12, videoFileId: 31 })).resolves.toBe(22);

        expect(direct.setOption.mock.calls.map(call => call[0].cmd)).toEqual(['%NODE% ts-webm', '%NODE% ts-mp4']);
        expect(hls.setOption).toHaveBeenCalledWith({ cmd: '%NODE% ts-hls', playPosition: 12, videoFileId: 31 }, 0);
        expect(manager.startRecorded).toHaveBeenCalledTimes(3);
    });

    it('[PRIMARY R2.3] starts WebM, MP4, and HLS viewer transforms for an encoded recording', async () => {
        const { api, direct, hls, manager } = createStreamApi('encoded');
        await api.startRecordedWebMStream({ mode: 0, playPosition: 12, videoFileId: 31 });
        await api.startRecordedMp4Stream({ mode: 0, playPosition: 12, videoFileId: 31 });
        await expect(api.startRecordedHLSStream({ mode: 0, playPosition: 12, videoFileId: 31 })).resolves.toBe(22);

        expect(direct.setOption.mock.calls.map(call => call[0].cmd)).toEqual([
            '%NODE% encoded-webm',
            '%NODE% encoded-mp4',
        ]);
        expect(hls.setOption).toHaveBeenCalledWith({ cmd: '%NODE% encoded-hls', playPosition: 12, videoFileId: 31 }, 0);
        expect(manager.startRecorded).toHaveBeenCalledTimes(3);
    });

    it('[PRIMARY R2.4] opens an original recording at the byte offset calculated from a valid seek position', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-recorded-seek-contract-'));
        dirs.push(dir);
        const path = join(dir, 'recording.ts');
        writeFileSync(path, '0123456789');
        const { model, processManager } = createRecordedModel();
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = path;
            model.videoFileInfo = { bitRate: 8, duration: 10, size: 10 };
            model.videoFileType = 'ts';
            model.isRecording = false;
        });
        const open = nodeFs.createReadStream;
        model.setOption({ cmd: '%NODE% recorded-seek', playPosition: 4, videoFileId: 31 }, 0);

        await model.start(2);

        expect(open).toHaveBeenCalledWith(path, { start: 4 });
        expect(processManager.createManaged).toHaveBeenCalledOnce();
        const reader = model.fileStream;
        await model.stop();
        if (reader !== null && reader.closed !== true) {
            await new Promise<void>(resolve => reader.once('close', resolve));
        }
    });

    it('[PRIMARY R2.5] rejects a seek past the recording duration before starting a viewer process', async () => {
        const { model, processManager } = createRecordedModel(10);
        model.setOption({ cmd: '%NODE% recorded-invalid-seek', playPosition: 10.1, videoFileId: 31 }, 0);

        await expect(model.start(3)).rejects.toThrow('OutOfRange');

        expect(processManager.createManaged).not.toHaveBeenCalled();
    });

    it('[MD-6.2] emits TailStream close when recorded stop destroys its reader', async () => {
        const streamLogger = logger();
        const loggerWasBound = container.isBound('ILoggerModel');
        if (!loggerWasBound) container.bind('ILoggerModel').toConstantValue({ getLogger: () => streamLogger });
        const close = nodeFs.close
            .mockImplementation(((fd, callback) => callback(null)) as typeof nodeFs.close);
        const open = nodeFs.open
            .mockImplementation(((path, flags, callback) => callback(null, 17)) as typeof nodeFs.open);
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 });
        const closed = new Promise<void>((resolve, reject) => stream.once('close', resolve).once('error', reject));
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: () => streamLogger },
            {
                createManaged: vi.fn(async () => ({ child: fakeChild(), handle: Object.freeze({ kind: 'managed' }) })),
                requestStop: vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' })),
            },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findId: vi.fn(async () => null) },
            { getFullFilePathFromId: vi.fn() },
        );
        model.fileStream = stream;

        await model.stop();
        await closed;

        expect(open).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledWith(17, expect.any(Function));
        if (!loggerWasBound) container.unbind('ILoggerModel');
    });

    it('[PRIMARY R2.6] waits exactly one second after recording EOF before checking the file size', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const tailing = await openRecordingTail('a');
        await vi.waitFor(() => expect(tailing.body()).toBe('a'), { interval: 0 });
        await waitForTailRecheck();
        const stat = vi.spyOn(tailing.file, 'stat');

        await vi.advanceTimersByTimeAsync(999);
        expect(stat).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);

        expect(stat).toHaveBeenCalledOnce();
        await tailing.reader.close();
    });

    it('[PRIMARY R2.7] resumes a tailing recording from appended data after the one-second EOF check', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const tailing = await openRecordingTail('abc');
        await vi.waitFor(() => expect(tailing.body()).toBe('abc'), { interval: 0 });
        await waitForTailRecheck();

        appendFileSync(tailing.path, 'def');
        await vi.advanceTimersByTimeAsync(1_000);
        await vi.waitFor(() => expect(tailing.body()).toBe('abcdef'), { interval: 0 });
        await waitForTailRecheck();
        await vi.advanceTimersByTimeAsync(1_000);
        await vi.waitFor(() => expect(tailing.ended()).toBe(true), { interval: 0 });

        expect(tailing.body()).toBe('abcdef');
        await tailing.reader.close();
    });

    it('[PRIMARY R2.8] ends an unchanged tailing recording after its one-second EOF size check', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const tailing = await openRecordingTail('abc');
        const close = vi.spyOn(tailing.file, 'close');
        await vi.waitFor(() => expect(tailing.body()).toBe('abc'), { interval: 0 });
        await waitForTailRecheck();
        expect(tailing.ended()).toBe(false);

        await vi.advanceTimersByTimeAsync(1_000);
        await vi.waitFor(() => expect(tailing.ended()).toBe(true), { interval: 0 });
        await tailing.reader.close();

        expect(tailing.body()).toBe('abc');
        expect(tailing.readable.closed).toBe(true);
        expect(close).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[PRIMARY R2.9] restarts a tailing recording read from the beginning after the file shrinks', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const tailing = await openRecordingTail('abcdef');
        await vi.waitFor(() => expect(tailing.body()).toBe('abcdef'), { interval: 0 });
        await waitForTailRecheck();

        truncateSync(tailing.path, 2);
        await vi.advanceTimersByTimeAsync(1_000);
        await vi.waitFor(() => expect(tailing.body()).toBe('abcdefab'), { interval: 0 });
        await waitForTailRecheck();
        await vi.advanceTimersByTimeAsync(1_000);
        await vi.waitFor(() => expect(tailing.ended()).toBe(true), { interval: 0 });

        expect(tailing.body()).toBe('abcdefab');
        await tailing.reader.close();
    });

    it('[PRIMARY R2.10] rejects a missing recorded target before creating a reader or viewer process', async () => {
        const { model, processManager } = createRecordedModel(10, true);
        model.setOption({ cmd: '%NODE% recorded-missing-target', playPosition: 0, videoFileId: 404 }, 0);

        await expect(model.start(4)).rejects.toThrow('VideoIsNull');

        expect(processManager.createManaged).not.toHaveBeenCalled();
    });

    it('[PRIMARY R2.11] provides the external-player playlist for the registered recorded file', async () => {
        const playlist = vi.fn(() => 'synthetic-recorded-playlist');
        const model = new VideoApiModel(
            {},
            { findId: async () => ({ filePath: 'synthetic-video.ts', recordedId: 41 }) },
            { findId: async () => ({ duration: 61_900, name: 'synthetic-recorded' }) },
            { createM3U8PlayListStr: playlist },
            { getFullFilePathFromId: async () => 'synthetic-storage/video.ts' },
            {},
        );

        await expect(model.getM3u8('request-host.invalid', false, 31)).resolves.toEqual({
            name: 'synthetic-video.ts.m3u8',
            playList: 'synthetic-recorded-playlist',
        });
        expect(playlist).toHaveBeenCalledWith({
            baseUrl: '/api/videos/31',
            duration: 61,
            host: 'request-host.invalid',
            isSecure: false,
            name: 'synthetic-recorded',
        });
    });

    it('[PRIMARY R2.12] rejects late recorded delivery establishment at one finite start deadline', async () => {
        vi.useFakeTimers();
        const start = deferred<void>();
        const stream = fakeStream({ isEnable: false, type: 'RecordedStream', videoFileId: 31 });
        stream.start.mockImplementation(() => start.promise);
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        const terminal = manager.start(stream).then(
            value => ({ status: 'fulfilled' as const, value }),
            error => ({ error, status: 'rejected' as const }),
        );

        await vi.advanceTimersByTimeAsync(30_000);

        await expect(terminal).resolves.toMatchObject({
            error: expect.objectContaining({ message: 'StreamStartTimeout' }),
            status: 'rejected',
        });
        expect(stream.stop).toHaveBeenCalledOnce();
        start.resolve(undefined);
        await Promise.resolve();
        await Promise.resolve();
        expect(manager.getStreamInfos()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });
});
