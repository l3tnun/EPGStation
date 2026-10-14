import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, deferred, fakeChild, logger } from './_media-harness';

const LiveStreamModel = compiled<any>('model', 'service', 'stream', 'LiveStreamModel.js').default;
const LiveHLSStreamModel = compiled<any>('model', 'service', 'stream', 'LiveHLSStreamModel.js').default;

const directories: string[] = [];
const models: any[] = [];

afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const model of models.splice(0)) await model.stop().catch(() => undefined);
    for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

const makeSubject = (
    options: {
        readonly hls?: boolean;
        readonly cmd?: string | null;
        readonly child?: any;
        readonly streamRoot?: string;
        readonly openServiceStream?: (...args: any[]) => Promise<unknown>;
        readonly processManager?: Record<string, unknown>;
        readonly fileDeleter?: Record<string, unknown>;
    } = {},
) => {
    const log = logger();
    const streamRoot =
        options.streamRoot ??
        (() => {
            const scratch = mkdtempSync(join(tmpdir(), 'epg-live-gaps-'));
            directories.push(scratch);
            return scratch;
        })();
    const child = options.child ?? fakeChild();
    const handleProcess = Object.freeze({ kind: 'synthetic-process-handle' });
    const tuner = new PassThrough();
    const tunerHandle = { close: vi.fn(), stream: tuner };
    const processManager = {
        createHlsWriter: vi.fn(async () => ({ child, handle: handleProcess })),
        createManaged: vi.fn(async () => ({ child, handle: handleProcess })),
        requestStop: vi.fn(async () => undefined),
        stopHls: vi.fn(async () => ({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true })),
        ...options.processManager,
    };
    const fileDeleter = {
        deleteAllFiles: vi.fn(async () => ({ passes: 1, remainingFiles: [], status: 'cleared' })),
        setOption: vi.fn(),
        ...options.fileDeleter,
    };
    const openServiceStream = options.openServiceStream ?? vi.fn(async () => tunerHandle);
    const Model = options.hls === true ? LiveHLSStreamModel : LiveStreamModel;
    const model = new Model(
        { getConfig: () => baseConfig({ streamFilePath: streamRoot }) },
        { getLogger: () => log },
        processManager,
        fileDeleter,
        { openServiceStream },
        { notifyClient: vi.fn() },
    );
    if (options.cmd !== null) model.setOption({ channelId: 101, cmd: options.cmd ?? '%NODE% synthetic-live' }, 0);
    else model.setOption({ channelId: 101 }, 0);
    models.push(model);
    return { child, fileDeleter, handleProcess, log, model, openServiceStream, processManager, streamRoot, tuner, tunerHandle };
};

const sessionOf = (overrides: Record<string, unknown> = {}) => ({
    finalizer: null,
    hlsStopFinalization: null,
    hlsWriterHandle: null,
    id3MetadataTransform: null,
    managedProcessHandle: null,
    ownedListeners: [],
    stopped: false,
    stream: null,
    streamProcess: null,
    token: {},
    tunerStreamHandle: null,
    ...overrides,
});

/**
 * LiveStreamBaseModel の開始後の配線と後始末。process の起動・入力の流し込み・開始の失敗と競合・
 * 停止時の資源の解放と診断を確かめる。
 */
describe('LiveStreamBaseModel process wiring (unittest/imp)', () => {
    it('[MD-10.2] leaves the stream placeholders of a non-HLS command untouched and passes no output', () => {
        const { model } = makeSubject({ cmd: '%FFMPEG% -dir %streamFileDir% -n %streamNum%' });

        const option = model.createProcessOption(4);

        expect(option).toEqual({
            cmd: 'synthetic-ffmpeg -dir %streamFileDir% -n %streamNum%',
            input: null,
            output: null,
            priority: 1,
            report: { kind: 'stream' },
        });
    });

    it('[MD-10.2] expands the stream placeholders and the playlist output of an HLS command', () => {
        const { model, streamRoot } = makeSubject({
            cmd: '%FFMPEG% -dir %streamFileDir% -n %streamNum%',
            hls: true,
        });

        const option = model.createProcessOption(4);

        expect(option).toEqual({
            cmd: `synthetic-ffmpeg -dir ${streamRoot} -n 4`,
            input: null,
            output: `${streamRoot}/stream4.m3u8`,
            priority: 1,
            report: { kind: 'hls', streamId: 4 },
        });
    });

    it('[MD-10.2] returns no process option for a command-less pass-through stream', () => {
        const { model } = makeSubject({ cmd: null });

        expect(model.createProcessOption(4)).toBeNull();
    });

    it('[MD-10.2] rejects an HLS start without an option before touching the stream directory', async () => {
        const { fileDeleter, log, model, openServiceStream } = makeSubject({ hls: true });
        model.processOption = null;

        await expect(model.start(2)).rejects.toThrow('ProcessOptionIsNull');

        expect(fileDeleter.setOption).not.toHaveBeenCalled();
        expect(openServiceStream).not.toHaveBeenCalled();
        expect(log.stream.info).not.toHaveBeenCalled();
    });

    it('[MD-10.2] does not open the tuner stream when stop arrived while the HLS directory was being prepared', async () => {
        const cleaning = deferred<unknown>();
        const { fileDeleter, model, openServiceStream } = makeSubject({
            fileDeleter: { deleteAllFiles: vi.fn(() => cleaning.promise) },
            hls: true,
        });

        const starting = model.start(2);
        const outcome = expect(starting).rejects.toThrow('StreamStartStopped');
        await vi.waitFor(() => expect(fileDeleter.deleteAllFiles).toHaveBeenCalledOnce());
        const stopping = model.stop();
        cleaning.resolve({ passes: 1, remainingFiles: [], status: 'cleared' });

        await outcome;
        await stopping;
        expect(openServiceStream).not.toHaveBeenCalled();
    });

    it('[MD-10.2] cleans up and reports a stream directory that cannot be used, without deleting another owner’s files', async () => {
        const scratch = mkdtempSync(join(tmpdir(), 'epg-live-gaps-'));
        directories.push(scratch);
        const regularFile = join(scratch, 'regular-file');
        writeFileSync(regularFile, 'x');
        const streamRoot = join(regularFile, 'children');
        const { fileDeleter, log, model, openServiceStream } = makeSubject({ hls: true, streamRoot });

        const failure = await model.start(2).catch((error: unknown) => error);

        expect((failure as NodeJS.ErrnoException).code).toBe('ENOTDIR');
        expect(log.stream.fatal.mock.calls).toEqual([[`dir permission error: ${streamRoot}`], [failure]]);
        expect(openServiceStream).not.toHaveBeenCalled();
        expect(fileDeleter.deleteAllFiles).not.toHaveBeenCalled();
    });

    it('[MD-10.2] creates a missing stream directory and logs it', async () => {
        const scratch = mkdtempSync(join(tmpdir(), 'epg-live-gaps-'));
        directories.push(scratch);
        const streamRoot = join(scratch, 'created-here');
        const { log, model } = makeSubject({ hls: true, streamRoot });

        await model.prepStreamDir(1);

        expect(log.stream.info).toHaveBeenCalledWith(`mkdirp: ${streamRoot}`);
        expect(log.stream.fatal).not.toHaveBeenCalled();
    });

    it('[MD-10.2] stops an HLS stream by itself when no keep request arrives in time, but not a non-HLS stream', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const hls = makeSubject({ hls: true });
        const plain = makeSubject();
        await hls.model.start(2);
        await plain.model.start(2);

        await vi.advanceTimersByTimeAsync(15_000);

        expect(hls.processManager.stopHls).toHaveBeenCalledOnce();
        expect(plain.processManager.requestStop).not.toHaveBeenCalled();
    });

    it('[MD-10.2] logs the command and stops the failed session when process creation fails', async () => {
        const failure = new Error('synthetic process creation failure');
        const { log, model, tunerHandle } = makeSubject({
            processManager: { createManaged: vi.fn(async () => Promise.reject(failure)) },
        });

        await expect(model.start(2)).rejects.toBe(failure);

        expect(log.stream.info).toHaveBeenCalledWith('create encode process: %NODE% synthetic-live');
        expect(log.stream.error).toHaveBeenCalledWith('create encode process failed: %NODE% synthetic-live');
        expect(model.activeStartSession.stopped).toBe(true);
        expect(tunerHandle.close).toHaveBeenCalledOnce();
    });

    it('[MD-10.2] does not report a process creation failure that arrives after stop', async () => {
        const created = deferred<{ child: unknown; handle: unknown }>();
        const { handleProcess, log, model, processManager } = makeSubject({
            processManager: { createManaged: vi.fn(() => created.promise) },
        });

        const starting = model.start(2);
        const outcome = expect(starting).rejects.toThrow('StreamStartStopped');
        await vi.waitFor(() => expect(processManager.createManaged).toHaveBeenCalledOnce());
        await model.stop();
        created.resolve({ child: fakeChild(), handle: handleProcess });

        await outcome;
        expect(processManager.requestStop).toHaveBeenCalledExactlyOnceWith(handleProcess);
        expect(log.stream.error).not.toHaveBeenCalledWith('create encode process failed: %NODE% synthetic-live');
    });

    it('[MD-10.2] rejects CreateStreamProcessError when the created process is missing', async () => {
        const { model } = makeSubject({
            processManager: { createManaged: vi.fn(async () => ({ child: null, handle: {} })) },
        });

        await expect(model.start(2)).rejects.toThrow('CreateStreamProcessError');
    });

    it('[MD-10.2] rejects StreamProcessStdinIsNull when the process has no stdin', async () => {
        const child = fakeChild();
        child.stdin = null;
        const { model } = makeSubject({ child });

        await expect(model.start(2)).rejects.toThrow('StreamProcessStdinIsNull');
    });

    it('[MD-10.2] keeps the HLS writer start marked as pending until the writer exists, and clears it on success and failure', async () => {
        const writer = deferred<{ child: unknown; handle: unknown }>();
        const success = makeSubject({ hls: true, processManager: { createHlsWriter: vi.fn(() => writer.promise) } });

        const starting = success.model.start(2);
        await vi.waitFor(() => expect(success.processManager.createHlsWriter).toHaveBeenCalledOnce());
        expect(success.model.hlsStopFinalization.writerStartPending).toBe(true);
        writer.resolve({ child: fakeChild(), handle: {} });
        await starting;
        expect(success.model.hlsStopFinalization.writerStartPending).toBe(false);

        const failure = makeSubject({
            hls: true,
            processManager: { createHlsWriter: vi.fn(async () => Promise.reject(new Error('synthetic writer failure'))) },
        });
        await expect(failure.model.start(2)).rejects.toThrow('synthetic writer failure');
        expect(failure.model.hlsStopFinalization.writerStartPending).toBe(false);
    });

    it('[MD-10.2] feeds the tuner stream into the non-HLS process stdin', async () => {
        const { child, log, model, tuner } = makeSubject();
        await model.start(2);
        const received: string[] = [];
        child.stdin.on('data', (chunk: Buffer) => received.push(String(chunk)));

        tuner.write('synthetic-ts-data');

        await vi.waitFor(() => expect(received.join('')).toBe('synthetic-ts-data'));
        expect(log.stream.info).not.toHaveBeenCalledWith('use arib-subtitle-timedmetadater');
    });

    it('[MD-10.2] feeds the tuner stream through the subtitle transform into the HLS writer stdin', async () => {
        const { child, log, model, tuner } = makeSubject({ hls: true });
        const pipe = vi.spyOn(tuner, 'pipe');

        await model.start(2);

        expect(log.stream.info).toHaveBeenCalledWith('use arib-subtitle-timedmetadater');
        expect(pipe).toHaveBeenCalledOnce();
        const transform = pipe.mock.calls[0][0] as any;
        expect(transform).not.toBe(child.stdin);
        expect(transform._readableState.pipes).toContain(child.stdin);
        expect(model.activeStartSession.id3MetadataTransform).toBe(transform);
    });

    it('[MD-10.2] starts when the process has no stderr and logs stderr output otherwise', async () => {
        const silent = fakeChild();
        silent.stderr = null;
        await expect(makeSubject({ child: silent }).model.start(2)).resolves.toBeUndefined();

        const { child, log, model } = makeSubject();
        await model.start(2);
        child.stderr.write('synthetic stderr line');
        await vi.waitFor(() => expect(log.stream.debug).toHaveBeenCalledWith('synthetic stderr line'));
    });

    it.each(['exit', 'error'])('[MD-10.2] notifies the exit callback when the process emits %s', async event => {
        const { child, model } = makeSubject();
        const onExit = vi.fn();
        await model.start(2);
        model.setExitStream(onExit);

        child.emit(event, null, 'SIGTERM');

        await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce());
    });

    it('[MD-10.2] notifies the exit callback when the process had already exited at start', async () => {
        const child = fakeChild();
        child.exitCode = 1;
        const { model } = makeSubject({ child });
        const onExit = vi.fn();
        model.setExitStream(onExit);

        await model.start(2);

        await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce());
    });

    it.each(['close', 'end', 'error'])(
        '[MD-10.2] closes the tuner handle once when the pass-through tuner stream emits %s, and still destroys the stream at stop',
        async event => {
            const { model, tuner, tunerHandle } = makeSubject({ cmd: null });
            const onExit = vi.fn();
            model.setExitStream(onExit);
            await model.start(2);
            const destroy = vi.spyOn(tuner, 'destroy');

            tuner.emit(event, new Error('synthetic'));
            tuner.emit(event, new Error('synthetic'));

            await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce());
            expect(tunerHandle.close).toHaveBeenCalledOnce();
            await model.stop();
            expect(destroy).toHaveBeenCalledOnce();
            expect(tunerHandle.close).toHaveBeenCalledOnce();
        },
    );

    it('[MD-10.2] returns the tuner stream itself when the process has no stdout', async () => {
        const child = fakeChild();
        child.stdout = null;
        const { model, tuner } = makeSubject({ child });
        await model.start(2);

        expect(model.getStream()).toBe(tuner);
    });

    it('[MD-10.2] releases everything of a started non-HLS stream at stop without logging any error', async () => {
        const { handleProcess, fileDeleter, log, model, processManager, tuner, tunerHandle } = makeSubject();
        const unpipe = vi.spyOn(tuner, 'unpipe');
        await model.start(2);

        await model.stop();

        expect(unpipe).toHaveBeenCalledOnce();
        expect(processManager.requestStop).toHaveBeenCalledExactlyOnceWith(handleProcess);
        expect(tunerHandle.close).toHaveBeenCalledOnce();
        expect(fileDeleter.deleteAllFiles).not.toHaveBeenCalled();
        expect(log.stream.error).not.toHaveBeenCalled();
        expect(() => model.getStream()).toThrow('StreamIsNull');
    });

    it('[MD-10.2] records the writer stop and the artifact cleanup of a started HLS stream at stop, once even if stopped twice', async () => {
        const { fileDeleter, handleProcess, log, model, processManager, streamRoot, tuner } = makeSubject({ hls: true });
        const unpipe = vi.spyOn(tuner, 'unpipe');
        await model.start(2);
        const transform = model.activeStartSession.id3MetadataTransform;
        const transformUnpipe = vi.spyOn(transform, 'unpipe');

        await model.stop();
        await model.stop();

        expect(unpipe).toHaveBeenCalledOnce();
        expect(transformUnpipe).toHaveBeenCalledOnce();
        expect(transform.destroyed).toBe(true);
        expect(processManager.stopHls).toHaveBeenCalledExactlyOnceWith(handleProcess);
        const finalization = model.hlsStopFinalization;
        expect(finalization.writerStopResult).toEqual({
            exitConfirmed: true,
            sentSignals: ['SIGINT'],
            slotReleased: true,
        });
        expect(finalization.artifactCleanupAttempts).toHaveLength(1);
        expect(fileDeleter.deleteAllFiles).toHaveBeenCalledTimes(2);
        expect(fileDeleter.deleteAllFiles).toHaveBeenLastCalledWith({ streamFilePath: streamRoot, streamId: 2 });
        expect(log.stream.error).not.toHaveBeenCalled();
    });

    it('[MD-10.2] logs neither a missing stream nor a missing handle as a cleanup error when the tuner could not be opened', async () => {
        const failure = new Error('synthetic tuner failure');
        const { log, model } = makeSubject({ openServiceStream: vi.fn(async () => Promise.reject(failure)) });

        await expect(model.start(2)).rejects.toBe(failure);

        expect(log.stream.error.mock.calls).toEqual([['get mirakurun service stream failed: 101']]);
    });

    it('[MD-10.2] logs the message and the error when releasing the tuner stream fails', async () => {
        const failure = new Error('synthetic unpipe failure');
        const { log, model, tuner } = makeSubject();
        await model.start(2);
        vi.spyOn(tuner, 'unpipe').mockImplementation(() => {
            throw failure;
        });

        await model.stop();

        expect(log.stream.error.mock.calls).toEqual([['stop stream resource error'], [failure]]);
    });

    it('[MD-10.2] does not run a stale session’s exit event, and only an active, unstopped, unrecorded session may adopt', () => {
        const { model } = makeSubject();
        const session = sessionOf();
        model.activeStartSession = session;
        expect(model.canSessionAdopt(session)).toBe(true);

        expect(model.canSessionAdopt(sessionOf())).toBe(false);
        session.stopped = true;
        expect(model.canSessionAdopt(session)).toBe(false);
        session.stopped = false;
        model.stoppedProcessStartGenerations.add(session.token);
        expect(model.canSessionAdopt(session)).toBe(false);

        const stale = sessionOf();
        const onExit = vi.fn();
        model.setExitStream(onExit);
        model.emitExitForSession(stale);
        expect(onExit).not.toHaveBeenCalled();
        model.activeStartSession = stale;
        model.emitExitForSession(stale);
        expect(onExit).toHaveBeenCalledOnce();
    });

    it('[MD-10.2] marks a stopped session so that it can no longer adopt anything', () => {
        const { model } = makeSubject();
        const session = sessionOf();
        model.activeStartSession = session;

        model.stopSession(session);

        expect(session.stopped).toBe(true);
        expect(model.stoppedProcessStartGenerations.has(session.token)).toBe(true);
        expect(() => model.assertSessionCanAdopt(session)).toThrow('StreamStartStopped');
    });

    it('[MD-10.2] registers a session listener repeatedly by default and a one-shot listener only once, and remembers both', () => {
        const { model } = makeSubject();
        const session = sessionOf();
        const emitter = new EventEmitter();
        const repeated = vi.fn();
        const single = vi.fn();

        model.addSessionListener(session, emitter, 'event', repeated);
        model.addSessionListener(session, emitter, 'event', single, true);
        emitter.emit('event');
        emitter.emit('event');

        expect(repeated).toHaveBeenCalledTimes(2);
        expect(single).toHaveBeenCalledOnce();
        expect(session.ownedListeners).toEqual([
            { emitter, event: 'event', listener: repeated },
            { emitter, event: 'event', listener: single },
        ]);
    });

    it('[MD-10.2] logs the exit of a started process as a warning, and as information once the session is stopped', async () => {
        const { child, log, model } = makeSubject();
        await model.start(2);

        child.emit('exit', 3, null);
        expect(log.stream.warn).toHaveBeenCalledWith('encode process exited: code=3, signal=null');
        model.stopSession(model.activeStartSession);
        model.logStreamProcessExit(model.activeStartSession, null, 'SIGTERM');

        expect(log.stream.info).toHaveBeenCalledWith('encode process exited: code=null, signal=SIGTERM');
    });
});
