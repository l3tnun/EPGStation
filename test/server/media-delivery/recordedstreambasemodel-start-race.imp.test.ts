import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, deferred, fakeChild, logger } from './_media-harness';

const RecordedStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedStreamModel.js').default;
const RecordedHLSStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedHLSStreamModel.js').default;

const directories: string[] = [];

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

const makeSubject = (
    options: {
        readonly hls?: boolean;
        readonly processManager?: Record<string, unknown>;
    } = {},
) => {
    const log = logger();
    const config = (() => {
        if (options.hls !== true) return baseConfig();
        const directory = mkdtempSync(join(tmpdir(), 'epg-recorded-race-'));
        directories.push(directory);
        return baseConfig({ streamFilePath: directory });
    })();
    const processManager = {
        createHlsWriter: vi.fn(),
        createManaged: vi.fn(),
        requestStop: vi.fn(async () => undefined),
        stopHls: vi.fn(async () => ({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true })),
        ...options.processManager,
    };
    const Model = options.hls === true ? RecordedHLSStreamModel : RecordedStreamModel;
    const model = new Model(
        { getConfig: () => config },
        { getLogger: () => log },
        processManager,
        { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
        { notifyClient: vi.fn() },
        { findId: vi.fn(async () => ({ id: 1, recordedId: 2, type: 'encoded' })) },
        { findId: vi.fn(async () => ({ isRecording: false })) },
        {
            getFullFilePathFromId: vi.fn(async () => 'synthetic-recorded.mp4'),
            getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 480 })),
        },
    );
    model.setOption({ cmd: '%NODE% synthetic-recorded', playPosition: 0, videoFileId: 1 }, 0);
    return { log, model, processManager };
};

/**
 * RecordedStreamBaseModel.start の途中で停止された場合・プロセス起動が失敗した場合の分岐。
 * 停止済みの世代は後から届いた process を止めて何も採用せず、停止されていない起動失敗は
 * 記録して停止し、`CreateStreamProcessError` で終える。
 */
describe('RecordedStreamBaseModel start races and process failures (unittest/imp)', () => {
    it('[MD-10.2] returns without creating a process when stop arrived while the process option was being built', async () => {
        const { model, processManager } = makeSubject();
        const option = deferred<unknown>();
        vi.spyOn(model, 'createProcessOption').mockReturnValue(option.promise as never);

        const starting = model.start(0);
        await vi.waitFor(() => expect(model.createProcessOption).toHaveBeenCalledOnce());
        await model.stop();
        option.resolve({ cmd: 'synthetic', input: null, output: null, priority: 0 });

        await expect(starting).resolves.toBeUndefined();
        expect(processManager.createManaged).not.toHaveBeenCalled();
    });

    it('[MD-10.2] requests a stop for a managed process that arrived after stop and adopts nothing', async () => {
        const created = deferred<{ child: unknown; handle: unknown }>();
        const { model, processManager } = makeSubject({
            processManager: { createManaged: vi.fn(() => created.promise) },
        });
        const handle = Object.freeze({ kind: 'late-managed-process' });

        const starting = model.start(0);
        await vi.waitFor(() => expect(processManager.createManaged).toHaveBeenCalledOnce());
        await model.stop();
        created.resolve({ child: fakeChild(), handle });

        await expect(starting).resolves.toBeUndefined();
        expect(processManager.requestStop).toHaveBeenCalledExactlyOnceWith(handle);
        expect(() => model.getStream()).toThrow('StreamIsNull');
    });

    it('[MD-10.2] rethrows a process start failure that arrives after stop without logging it as a start failure', async () => {
        const created = deferred<{ child: unknown; handle: unknown }>();
        const { log, model, processManager } = makeSubject({
            processManager: { createManaged: vi.fn(() => created.promise) },
        });
        const failure = new Error('synthetic late process failure');

        const starting = model.start(0);
        const outcome = expect(starting).rejects.toBe(failure);
        await vi.waitFor(() => expect(processManager.createManaged).toHaveBeenCalledOnce());
        await model.stop();
        created.reject(failure);

        await outcome;
        expect(log.stream.error).not.toHaveBeenCalledWith('create encode process failed: %NODE% synthetic-recorded');
    });

    it('[MD-10.2] logs the failed command, stops the stream, and rejects CreateStreamProcessError when process creation fails', async () => {
        const failure = new Error('synthetic process creation failure');
        const { log, model } = makeSubject({
            processManager: { createManaged: vi.fn(async () => Promise.reject(failure)) },
        });

        await expect(model.start(0)).rejects.toThrow('CreateStreamProcessError');

        expect(log.stream.info).toHaveBeenCalledWith('create encode process: %NODE% synthetic-recorded');
        expect(log.stream.error).toHaveBeenCalledWith('create encode process failed: %NODE% synthetic-recorded');
        expect(() => model.getStream()).toThrow('StreamIsNull');
    });

    it('[MD-10.2] completes the HLS writer start bookkeeping when the HLS writer cannot be created', async () => {
        const failure = new Error('synthetic hls writer failure');
        const { log, model, processManager } = makeSubject({
            hls: true,
            processManager: { createHlsWriter: vi.fn(async () => Promise.reject(failure)) },
        });

        await expect(model.start(6)).rejects.toThrow('CreateStreamProcessError');

        expect(processManager.createHlsWriter).toHaveBeenCalledOnce();
        expect(log.stream.error).toHaveBeenCalledWith(expect.stringContaining('create encode process failed:'));
    });

    it('[MD-10.2] exposes the process stdout through getStream once the process has started', async () => {
        vi.useFakeTimers();
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'recorded-managed-process' });
        const { model } = makeSubject({ processManager: { createManaged: vi.fn(async () => ({ child, handle })) } });

        await model.start(0);

        expect(model.getStream()).toBe(child.stdout);
        await model.stop();
    });

    it('[MD-10.2] rejects a playback source whose video file id differs from the requested one', async () => {
        const { model, processManager } = makeSubject();
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/other.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 2,
                videoFileId: 99,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            async () => undefined,
        );

        await expect(model.start(0)).rejects.toThrow('RecordedPlaybackSourceVideoFileIdMismatch');

        expect(processManager.createManaged).not.toHaveBeenCalled();
    });
});
