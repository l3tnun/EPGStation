import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, fakeChild, logger } from './_media-harness';

const RecordedStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedStreamModel.js').default;
const RecordedHLSStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedHLSStreamModel.js').default;

const directories: string[] = [];
const models: any[] = [];

afterEach(async () => {
    vi.restoreAllMocks();
    for (const model of models.splice(0)) await model.stop().catch(() => undefined);
    for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

const videoInfo = { bitRate: 8, duration: 60, size: 480 };

const readerSource = (reader: { readable: unknown; close: () => Promise<void> }) => ({
    inputPath: 'synthetic/reader.ts',
    kind: 'completed-file-reader',
    playPosition: 0,
    reader,
    recordedId: 2,
    videoFileId: 1,
    videoInfo,
});

const directSource = () => ({
    inputPath: 'synthetic/direct.mp4',
    kind: 'encoded-direct',
    playPosition: 0,
    recordedId: 2,
    videoFileId: 1,
    videoInfo,
});

const makeSubject = (
    options: {
        readonly hls?: boolean;
        readonly child?: any;
        readonly processManager?: Record<string, unknown>;
        readonly video?: Record<string, unknown>;
    } = {},
) => {
    const log = logger();
    const config = (() => {
        if (options.hls !== true) return baseConfig();
        const directory = mkdtempSync(join(tmpdir(), 'epg-recorded-gaps-'));
        directories.push(directory);
        return baseConfig({ streamFilePath: directory });
    })();
    const child = options.child ?? fakeChild();
    const handle = Object.freeze({ kind: 'synthetic-process-handle' });
    const processManager = {
        createHlsWriter: vi.fn(async () => ({ child, handle })),
        createManaged: vi.fn(async () => ({ child, handle })),
        requestStop: vi.fn(async () => undefined),
        stopHls: vi.fn(async () => ({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true })),
        ...options.processManager,
    };
    const fileDeleter = {
        deleteAllFiles: vi.fn(async () => ({ passes: 1, remainingFiles: [], status: 'cleared' })),
        setOption: vi.fn(),
    };
    const Model = options.hls === true ? RecordedHLSStreamModel : RecordedStreamModel;
    const model = new Model(
        { getConfig: () => config },
        { getLogger: () => log },
        processManager,
        fileDeleter,
        { notifyClient: vi.fn() },
        { findId: vi.fn(async () => ({ id: 1, recordedId: 2, type: 'encoded', ...options.video })) },
        { findId: vi.fn(async () => ({ isRecording: false })) },
        {
            getFullFilePathFromId: vi.fn(async () => 'synthetic-recorded.mp4'),
            getInfo: vi.fn(async () => videoInfo),
        },
    );
    model.setOption({ cmd: '%NODE% synthetic-recorded', playPosition: 0, videoFileId: 1 }, 0);
    models.push(model);
    return { child, fileDeleter, handle, log, model, processManager };
};

/**
 * RecordedStreamBaseModel の process 起動後の配線。入力の流し込み、process の終了の通知、
 * 再生元の遅延解放の条件、停止時の資源の後始末と診断を確かめる。
 */
describe('RecordedStreamBaseModel process wiring (unittest/imp)', () => {
    it('[MD-10.2] pipes a non-HLS reader source straight into the process stdin without the subtitle transform', async () => {
        const { child, log, model } = makeSubject();
        const readable = new PassThrough();
        const pipe = vi.spyOn(readable, 'pipe');
        model.adoptPlaybackSource(readerSource({ close: vi.fn(async () => undefined), readable }), async () => undefined);

        await model.start(0);

        expect(pipe).toHaveBeenCalledExactlyOnceWith(child.stdin);
        expect(log.stream.info).not.toHaveBeenCalledWith('use arib-subtitle-timedmetadater');
    });

    it('[MD-10.2] pipes an HLS reader source through the subtitle transform into the process stdin', async () => {
        const { child, log, model } = makeSubject({ hls: true });
        const readable = new PassThrough();
        const pipe = vi.spyOn(readable, 'pipe');
        model.adoptPlaybackSource(readerSource({ close: vi.fn(async () => undefined), readable }), async () => undefined);

        await model.start(3);

        expect(log.stream.info).toHaveBeenCalledWith('use arib-subtitle-timedmetadater');
        expect(pipe).toHaveBeenCalledOnce();
        const transform = pipe.mock.calls[0][0] as any;
        expect(transform).not.toBe(child.stdin);
        expect(transform._readableState.pipes).toContain(child.stdin);
    });

    it('[MD-10.2] starts without piping when the process has no stdin, and without reading stderr when it has none', async () => {
        const child = fakeChild();
        child.stdin = null;
        child.stderr = null;
        const { model } = makeSubject({ child });
        const readable = new PassThrough();
        const pipe = vi.spyOn(readable, 'pipe');
        model.adoptPlaybackSource(readerSource({ close: vi.fn(async () => undefined), readable }), async () => undefined);

        await expect(model.start(0)).resolves.toBeUndefined();

        expect(pipe).not.toHaveBeenCalled();
    });

    it('[MD-10.2] logs the process stderr as debug output', async () => {
        const { child, log, model } = makeSubject();
        model.adoptPlaybackSource(directSource(), async () => undefined);

        await model.start(0);
        child.stderr.write('synthetic stderr line');

        await vi.waitFor(() => expect(log.stream.debug).toHaveBeenCalledWith('synthetic stderr line'));
    });

    it.each(['exit', 'error'])('[MD-10.2] notifies the exit callback once when a non-HLS process emits %s', async event => {
        const { child, model } = makeSubject();
        model.adoptPlaybackSource(directSource(), async () => undefined);
        const onExit = vi.fn();
        model.setExitStream(onExit);
        await model.start(0);
        expect(onExit).not.toHaveBeenCalled();

        child.emit(event, new Error('synthetic'));

        await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce());
    });

    it('[MD-10.2] notifies the exit callback and drops the listeners when the process had already exited at start', async () => {
        const child = fakeChild();
        child.exitCode = 0;
        const { model } = makeSubject({ child });
        model.adoptPlaybackSource(directSource(), async () => undefined);
        const onExit = vi.fn();
        model.setExitStream(onExit);

        await model.start(0);

        await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce());
        expect(child.listenerCount('exit')).toBe(0);
        expect(child.listenerCount('error')).toBe(0);
    });

    it('[MD-10.2] keeps the playback source until the managed process emits error, then releases it', async () => {
        const { child, model } = makeSubject();
        const release = vi.fn(async () => undefined);
        model.adoptPlaybackSource(directSource(), release);
        await model.start(0);

        await model.stop();
        expect(release).not.toHaveBeenCalled();

        child.emit('error', new Error('synthetic'));

        await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    });

    it('[MD-10.2] releases the playback source right after stop when the managed process had already exited', async () => {
        const child = fakeChild();
        child.exitCode = 1;
        const { model } = makeSubject({ child });
        const release = vi.fn(async () => undefined);
        model.adoptPlaybackSource(directSource(), release);
        await model.start(0);

        await model.stop();

        await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    });

    it('[MD-10.2] does not delete HLS files when a non-HLS stream stops', async () => {
        const { fileDeleter, model } = makeSubject();
        await model.start(0);

        await model.stop();

        expect(fileDeleter.deleteAllFiles).not.toHaveBeenCalled();
    });

    it('[MD-10.2] unpipes and destroys the file stream when the stream stops', async () => {
        const { model } = makeSubject();
        const fileStream = { destroy: vi.fn(), unpipe: vi.fn() };
        model.fileStream = fileStream;

        await model.stop();

        expect(fileStream.unpipe).toHaveBeenCalledOnce();
        expect(fileStream.destroy).toHaveBeenCalledOnce();
    });

    it('[MD-10.2] logs only the error itself when a cleanup step without a message fails', async () => {
        const failure = new Error('synthetic stop failure');
        const { log, model } = makeSubject({ processManager: { requestStop: vi.fn(async () => Promise.reject(failure)) } });
        await model.start(0);

        await model.stop();

        expect(log.stream.error.mock.calls).toEqual([[failure]]);
    });

    it('[MD-10.2] logs the message and then the error when closing the playback reader fails', async () => {
        const failure = new Error('synthetic close failure');
        const { log, model } = makeSubject();
        model.adoptPlaybackSource(
            readerSource({ close: vi.fn(async () => Promise.reject(failure)), readable: new PassThrough() }),
            async () => undefined,
        );
        await model.start(0);

        await model.stop();

        expect(log.stream.error.mock.calls).toEqual([['recorded playback source reader close error'], [failure]]);
    });

    it('[MD-10.2] throws StreamIsNull when the process has no stdout', async () => {
        const child = fakeChild();
        child.stdout = null;
        const { model } = makeSubject({ child });
        await model.start(0);

        expect(() => model.getStream()).toThrow('StreamIsNull');
    });

    it('[MD-10.2] logs the failure and rejects FileStreamSetError with the cause when the file stream cannot be created', async () => {
        const cause = new Error('synthetic read stream failure');
        const { log, model, processManager } = makeSubject({ video: { type: 'ts' } });
        model.setFileStream = () => {
            throw cause;
        };

        const failure = await model.start(0).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toBe('FileStreamSetError');
        expect((failure as Error).cause).toBe(cause);
        expect(log.stream.error.mock.calls).toEqual([['create file stream error'], [cause]]);
        expect(processManager.createManaged).not.toHaveBeenCalled();
    });

    it.each([
        ['file path', { videoFileInfo: videoInfo, videoFilePath: null }],
        ['file info', { videoFileInfo: null, videoFilePath: 'synthetic/file.mp4' }],
    ])('[MD-10.2] start rejects when setVideFileInfo leaves only the %s unset', async (_name, fields) => {
        const { model } = makeSubject();
        model.setVideFileInfo = vi.fn(async () => {
            Object.assign(model, fields);
        });

        await expect(model.start(0)).rejects.toThrow('SetVideoFileInfoError');
    });

    it.each([
        ['file path', { videoFileInfo: videoInfo, videoFilePath: null }],
        ['file info', { videoFileInfo: null, videoFilePath: 'synthetic/file.mp4' }],
    ])('[MD-10.2] createProcessOption rejects when only the video %s is unset', async (_name, fields) => {
        const { model } = makeSubject();
        Object.assign(model, fields);

        await expect(model.createProcessOption(0)).rejects.toThrow('SetVideoFileInfoError');
    });

    it.each([
        ['process option', { processOption: null, videoFileInfo: videoInfo, videoFilePath: 'synthetic/file.mp4' }],
        ['file path', { videoFileInfo: videoInfo, videoFilePath: null }],
        ['file info', { videoFileInfo: null, videoFilePath: 'synthetic/file.mp4' }],
    ])('[MD-10.2] setFileStream rejects when only the %s is unset', (_name, fields) => {
        const { model } = makeSubject();
        Object.assign(model, { videoFileInfo: videoInfo, videoFilePath: 'synthetic/file.mp4' }, fields);

        expect(() => model.setFileStream()).toThrow('VideoFileError');
    });

    it('[MD-10.2] leaves the stream placeholders of a non-HLS command untouched and passes no output', async () => {
        const { model } = makeSubject();
        model.setOption({ cmd: '%FFMPEG% -dir %streamFileDir% -n %streamNum% -ss %SS%', playPosition: 7, videoFileId: 1 }, 0);
        Object.assign(model, { videoFileInfo: videoInfo, videoFilePath: 'synthetic/file.mp4' });

        const option = await model.createProcessOption(5);

        expect(option.cmd).toBe('synthetic-ffmpeg -dir %streamFileDir% -n %streamNum% -ss 7');
        expect(option.output).toBeNull();
    });

    it('[MD-10.2] logs the path of the recorded file when a file stream is created', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'epg-recorded-file-'));
        directories.push(directory);
        const file = join(directory, 'synthetic.ts');
        writeFileSync(file, Buffer.alloc(64));
        const { log, model } = makeSubject();
        Object.assign(model, { videoFileInfo: videoInfo, videoFilePath: file, videoFileType: 'ts' });

        model.setFileStream();
        const closed = new Promise<void>(resolve => model.fileStream.once('close', () => resolve()));
        model.fileStream.destroy();
        await closed;

        expect(log.stream.info).toHaveBeenCalledWith(`create file stream: ${file}`);
    });
});
