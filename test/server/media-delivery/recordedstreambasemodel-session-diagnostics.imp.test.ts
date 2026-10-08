import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, fakeChild, logger } from './_media-harness';

const RecordedStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedStreamModel.js').default;

const createSubject = (createManaged: ReturnType<typeof vi.fn> = vi.fn()) => {
    const log = logger();
    const model = new RecordedStreamModel(
        { getConfig: () => baseConfig() },
        { getLogger: () => log },
        {
            createHlsWriter: vi.fn(),
            createManaged,
            requestStop: vi.fn(),
            stopHls: vi.fn(),
        },
        { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
        { notifyClient: vi.fn() },
        { findId: vi.fn(async () => null) },
        { findId: vi.fn(async () => null) },
        { getFullFilePathFromId: vi.fn(async () => null) },
    );
    return { log, model };
};

const stubRealisticVideoInfo = (model: any) => {
    model.setVideFileInfo = vi.fn(async () => {
        model.videoFilePath = 'synthetic-recording.encoded';
        model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
        model.videoFileType = 'encoded';
        model.isRecording = false;
    });
};

describe('RecordedStreamBaseModel session diagnostics (unittest/imp)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("[R2-RECORDED-STREAMPROCESS-ERROR] emits the stream exit event when the non-HLS process reports 'error' (L229–231)", async () => {
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'recorded-error-event-handle' });
        const { log, model } = createSubject(vi.fn(async () => ({ child, handle })));
        stubRealisticVideoInfo(model);
        model.setOption({ cmd: '%NODE% synthetic-recorded-error-event', playPosition: 0, videoFileId: 1 }, 0);
        await model.start(0);

        let exited = false;
        model.setExitStream(() => {
            exited = true;
        });
        child.emit('error', new Error('synthetic-recorded-child-error'));
        await Promise.resolve();

        expect(exited).toBe(true);
        expect(log.stream.error).not.toHaveBeenCalled();
    });

    it('[R2-RECORDED-STDERR-DATA] logs decoded stderr chunks while a non-HLS recorded stream is running (L241–243)', async () => {
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'recorded-stderr-handle' });
        const { log, model } = createSubject(vi.fn(async () => ({ child, handle })));
        stubRealisticVideoInfo(model);
        model.setOption({ cmd: '%NODE% synthetic-recorded-stderr', playPosition: 0, videoFileId: 1 }, 0);
        await model.start(0);

        child.stderr.write('synthetic recorded ffmpeg stderr chunk');
        await Promise.resolve();
        await Promise.resolve();

        expect(log.stream.debug).toHaveBeenCalledWith('synthetic recorded ffmpeg stderr chunk');
        await model.stop();
    });

    it('[R2-RECORDED-FINISHPROCESSSTARTGENERATION-GUARD] ignores a generation that was never registered (L551–553)', async () => {
        const { model } = createSubject();
        const releaseSpy = vi.spyOn(model, 'releaseDeferredPlaybackSourceWhenSafe');

        expect(() => model.finishProcessStartGeneration({})).not.toThrow();

        expect(releaseSpy).not.toHaveBeenCalled();
    });

    it('[R2-RECORDED-TRYCLEANUP-DIAGNOSTIC-CATCH] absorbs a throwing diagnostic logger during cleanup (L627–629)', async () => {
        const { log, model } = createSubject();
        const boom = new Error('synthetic-cleanup-operation-failure');
        const loggerBoom = new Error('synthetic-log-stream-error-failure');
        log.stream.error.mockImplementation(() => {
            throw loggerBoom;
        });

        await expect(
            model.tryCleanup(() => {
                throw boom;
            }, 'synthetic cleanup message'),
        ).resolves.toBeUndefined();

        // The message log call throws first (loggerBoom), so the inner try/catch (L627-629) must
        // absorb it before ever reaching the second `this.log.stream.error(error)` call for `boom`
        // -- prove both halves: the message call happened, and the error call never did.
        expect(log.stream.error).toHaveBeenCalledExactlyOnceWith('synthetic cleanup message');
        expect(log.stream.error).not.toHaveBeenCalledWith(boom);
    });
});
