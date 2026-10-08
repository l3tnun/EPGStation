import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, fakeChild, logger } from './_media-harness';

const LiveHLSStreamModel = compiled<any>('model', 'service', 'stream', 'LiveHLSStreamModel.js').default;
const LiveStreamModel = compiled<any>('model', 'service', 'stream', 'LiveStreamModel.js').default;

const makeSession = (overrides: Record<string, unknown> = {}) => ({
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
 * Real LiveStreamBaseModel.disposeSession/closeTunerStream/releaseSessionListeners diagnostics
 * that the public start()/stop() flow never leaves in the specific state exercised here (an
 * hlsWriterHandle without a matching hlsStopFinalization only happens for a session built
 * directly, and an emitter/logger that itself throws during cleanup is a fault-injection
 * scenario). `disposeSession` is called directly (private, but plain-JS-accessible on the
 * compiled class) against a hand-built session, mirroring the existing direct-call convention
 * used for other private StreamBaseModel members in this suite.
 */
describe('LiveStreamBaseModel session cleanup diagnostics (unittest/imp)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('[R2-LIVE-DISPOSESESSION-NOFINALIZATION] falls back to a direct writer stop and artifact delete without a finalization (L473–475, L481–483)', async () => {
        const log = logger();
        const stopHls = vi.fn(async () => undefined);
        const deleteAllFiles = vi.fn(async () => undefined);
        const model = new LiveHLSStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: () => log },
            { createHlsWriter: vi.fn(), stopHls },
            { deleteAllFiles, setOption: vi.fn() },
            { openServiceStream: vi.fn() },
            { notifyClient: vi.fn() },
        );
        const handle = Object.freeze({ kind: 'direct-writer-handle' });
        const session = makeSession({ hlsWriterHandle: handle });

        await expect(model.disposeSession(session)).resolves.toBeUndefined();

        expect(stopHls).toHaveBeenCalledExactlyOnceWith(handle);
        expect(deleteAllFiles).toHaveBeenCalledOnce();
    });

    it('[R2-LIVE-RELEASESESSIONLISTENERS-CATCH] logs and continues when removing a session listener throws (L495–498)', async () => {
        const log = logger();
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: () => log },
            { createManaged: vi.fn() },
            { deleteAllFiles: vi.fn(), setOption: vi.fn() },
            { openServiceStream: vi.fn() },
            { notifyClient: vi.fn() },
        );
        const boom = new Error('synthetic-listener-off-failure');
        const off = vi.fn(() => {
            throw boom;
        });
        const session = makeSession({ ownedListeners: [{ emitter: { off }, event: 'close', listener: vi.fn() }] });

        await expect(model.disposeSession(session)).resolves.toBeUndefined();

        expect(off).toHaveBeenCalledExactlyOnceWith('close', expect.any(Function));
        expect(log.stream.error).toHaveBeenCalledWith('stop stream listener error');
        expect(log.stream.error).toHaveBeenCalledWith(boom);
        expect(session.ownedListeners).toEqual([]);
    });

    it('[R2-LIVE-LOGCLEANUPERROR-CATCH] does not propagate when the cleanup-diagnostic logger itself throws (L514–516)', async () => {
        const log = logger();
        const boom = new Error('synthetic-listener-off-failure');
        const loggerBoom = new Error('synthetic-log-stream-error-failure');
        log.stream.error.mockImplementation(() => {
            throw loggerBoom;
        });
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: () => log },
            { createManaged: vi.fn() },
            { deleteAllFiles: vi.fn(), setOption: vi.fn() },
            { openServiceStream: vi.fn() },
            { notifyClient: vi.fn() },
        );
        const off = vi.fn(() => {
            throw boom;
        });
        const session = makeSession({ ownedListeners: [{ emitter: { off }, event: 'close', listener: vi.fn() }] });

        await expect(model.disposeSession(session)).resolves.toBeUndefined();

        expect(log.stream.error).toHaveBeenCalledWith('stop stream listener error');
    });

    it('[R2-LIVE-CLOSETUNERSTREAM-CATCH] logs and does not throw when the tuner handle close() itself throws', () => {
        const log = logger();
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: () => log },
            { createManaged: vi.fn() },
            { deleteAllFiles: vi.fn(), setOption: vi.fn() },
            { openServiceStream: vi.fn() },
            { notifyClient: vi.fn() },
        );
        const boom = new Error('synthetic-tuner-close-failure');
        const handle = {
            close: vi.fn(() => {
                throw boom;
            }),
        };
        const session = makeSession({ tunerStreamHandle: handle });

        expect(() => model.closeTunerStream(handle, session)).not.toThrow();

        expect(log.stream.error).toHaveBeenCalledWith('stop tuner stream error');
        expect(log.stream.error).toHaveBeenCalledWith(boom);
        expect(session.tunerStreamHandle).toBeNull();
    });

    it('[R2-LIVE-STDERR-DATA] logs decoded stderr chunks while a live stream is running (L275–277)', async () => {
        const log = logger();
        const tuner = new PassThrough();
        const child = fakeChild();
        const stderr = child.stderr;
        const handle = Object.freeze({ kind: 'live-stderr-handle' });
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: () => log },
            { createManaged: vi.fn(async () => ({ child, handle })) },
            { deleteAllFiles: vi.fn(), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(), stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101, cmd: '%NODE% synthetic-stderr' }, 0);

        await model.start(0);
        stderr.write('synthetic ffmpeg stderr chunk');
        await Promise.resolve();
        await Promise.resolve();

        expect(log.stream.debug).toHaveBeenCalledWith('synthetic ffmpeg stderr chunk');
        await model.stop();
    });

    it('[R2-LIVE-STDIN-ERROR] logs and does not raise when the encode process stdin emits an error while the session is active (L~280)', async () => {
        const log = logger();
        const tuner = new PassThrough();
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'live-stdin-error-handle' });
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: () => log },
            { createManaged: vi.fn(async () => ({ child, handle })) },
            { deleteAllFiles: vi.fn(), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(), stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101, cmd: '%NODE% synthetic-stdin-error' }, 0);

        await model.start(0);
        const boom = new Error('synthetic-stdin-write-error');

        expect(() => child.stdin.emit('error', boom)).not.toThrow();
        await Promise.resolve();

        expect(log.stream.error).toHaveBeenCalledWith('stream process stdin error');
        expect(log.stream.error).toHaveBeenCalledWith(boom);

        await model.stop();
    });

    it('[R2-LIVE-EXIT-LOG-WIRING] logs the encode process exit code/signal at warn level while the session is still active (L~271)', async () => {
        const log = logger();
        const tuner = new PassThrough();
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'live-exit-log-handle' });
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: () => log },
            { createManaged: vi.fn(async () => ({ child, handle })) },
            { deleteAllFiles: vi.fn(), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(), stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101, cmd: '%NODE% synthetic-exit-log' }, 0);

        await model.start(0);
        child.emit('exit', 255, null);
        await Promise.resolve();

        expect(log.stream.warn).toHaveBeenCalledWith('encode process exited: code=255, signal=null');
        expect(log.stream.info).not.toHaveBeenCalledWith(expect.stringContaining('encode process exited'));
    });

    it('[R2-LIVE-EXIT-LOG-EXPECTED] logs the encode process exit code/signal at info level once the session is no longer adoptable', () => {
        const log = logger();
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: () => log },
            { createManaged: vi.fn() },
            { deleteAllFiles: vi.fn(), setOption: vi.fn() },
            { openServiceStream: vi.fn() },
            { notifyClient: vi.fn() },
        );
        const session = makeSession({ stopped: true });

        model.logStreamProcessExit(session, null, 'SIGTERM');

        expect(log.stream.info).toHaveBeenCalledWith('encode process exited: code=null, signal=SIGTERM');
        expect(log.stream.warn).not.toHaveBeenCalled();
    });
});
