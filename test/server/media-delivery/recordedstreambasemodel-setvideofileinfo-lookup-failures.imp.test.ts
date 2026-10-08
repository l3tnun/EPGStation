import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, logger } from './_media-harness';

const RecordedStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedStreamModel.js').default;

/**
 * Real RecordedStreamBaseModel.setVideFileInfo lookup-failure branches (L306–308, L313–315),
 * reached through the public start() flow: existing tests only exercise a missing video
 * (VideoIsNull) or a fully successful lookup, never a missing recorded entry or a resolved
 * video file with no filesystem path.
 */
describe('RecordedStreamBaseModel.setVideFileInfo lookup failures (unittest/imp)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('[R2-RECORDED-SETVIDEOFILEINFO-RECORDEDISNULL] start() rejects when the resolved video has no recorded entry', async () => {
        const log = logger();
        const videoFileDB = { findId: vi.fn(async () => ({ id: 1, recordedId: 2, type: 'encoded' })) };
        const recordedDB = { findId: vi.fn(async () => null) };
        const videoUtil = { getFullFilePathFromId: vi.fn(async () => 'unused'), getInfo: vi.fn() };
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: () => log },
            { createHlsWriter: vi.fn(), createManaged: vi.fn(), requestStop: vi.fn(), stopHls: vi.fn() },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            videoFileDB,
            recordedDB,
            videoUtil,
        );
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 1 }, 0);

        await expect(model.start(0)).rejects.toThrow('RecordedIsNull');

        expect(videoFileDB.findId).toHaveBeenCalledExactlyOnceWith(1);
        expect(recordedDB.findId).toHaveBeenCalledExactlyOnceWith(2);
        expect(videoUtil.getFullFilePathFromId).not.toHaveBeenCalled();
    });

    it('[R2-RECORDED-SETVIDEOFILEINFO-GETVIDEOFILEPATHERROR] start() rejects when the resolved video has no filesystem path', async () => {
        const log = logger();
        const videoFileDB = { findId: vi.fn(async () => ({ id: 1, recordedId: 2, type: 'encoded' })) };
        const recordedDB = { findId: vi.fn(async () => ({ isRecording: false })) };
        const videoUtil = { getFullFilePathFromId: vi.fn(async () => null), getInfo: vi.fn() };
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: () => log },
            { createHlsWriter: vi.fn(), createManaged: vi.fn(), requestStop: vi.fn(), stopHls: vi.fn() },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            videoFileDB,
            recordedDB,
            videoUtil,
        );
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 1 }, 0);

        await expect(model.start(0)).rejects.toThrow('GetVideoFilePathError');

        expect(videoUtil.getFullFilePathFromId).toHaveBeenCalledExactlyOnceWith(1);
        expect(videoUtil.getInfo).not.toHaveBeenCalled();
    });
});
