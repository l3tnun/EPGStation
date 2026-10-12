import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, logger } from './_media-harness';

const RecordedStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedStreamModel.js').default;

/**
 * Real RecordedStreamBaseModel guard clauses that the public `start()` flow always satisfies
 * before reaching them (setOption is always called first, and setVideFileInfo/setFileStream are
 * only ever invoked internally after their own preconditions already hold). Each guard is
 * reachable only by calling the (compiled, plain-JS-accessible) private method directly against
 * a state the public API never produces on its own -- the same convention this suite already
 * uses for StreamBaseModel.checkStreamDir (see check-stream-dir.imp.test.ts).
 */
const createSubject = () => {
    const log = logger();
    const model = new RecordedStreamModel(
        { getConfig: () => baseConfig() },
        { getLogger: () => log },
        {
            createHlsWriter: vi.fn(),
            createManaged: vi.fn(),
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

describe('RecordedStreamBaseModel guard direct calls (unittest/imp)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('[R2-RECORDED-START-PROCESSOPTION-NULL] start() rejects before any option is set (L138–140)', async () => {
        const { model } = createSubject();
        await expect(model.start(0)).rejects.toThrow('ProcessOptionIsNull');
    });

    it('[R2-RECORDED-START-SETVIDEOFILEINFO-INCOMPLETE] start() rejects when setVideFileInfo leaves the video fields unset (L143–145)', async () => {
        const { model } = createSubject();
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 1 }, 0);
        model.setVideFileInfo = vi.fn(async () => undefined);

        await expect(model.start(0)).rejects.toThrow('SetVideoFileInfoError');
    });

    it('[R2-RECORDED-SETVIDEOFILEINFO-PROCESSOPTION-NULL] setVideFileInfo throws before any option is set (L284–286)', async () => {
        const { model } = createSubject();
        await expect(model.setVideFileInfo()).rejects.toThrow('ProcessOptionIsNull');
    });

    it('[R2-RECORDED-CREATEPROCESSOPTION-PROCESSOPTION-NULL] createProcessOption throws before any option is set (L342–344)', async () => {
        const { model } = createSubject();
        await expect(model.createProcessOption(0)).rejects.toThrow('ProcessOptionIsNull');
    });

    it('[R2-RECORDED-CREATEPROCESSOPTION-VIDEOFILEINFO-NULL] createProcessOption throws when the video fields are unset (L346–348)', async () => {
        const { model } = createSubject();
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 1 }, 0);

        await expect(model.createProcessOption(0)).rejects.toThrow('SetVideoFileInfoError');
    });

    it('[R2-RECORDED-SETFILESTREAM-VIDEOFILEERROR] setFileStream throws before any option/video info is set (L382–384)', () => {
        const { model } = createSubject();
        expect(() => model.setFileStream()).toThrow('VideoFileError');
    });

    it('[R2-RECORDED-GETSTREAM-NULL] getStream throws before a stream process exists (L640–642)', () => {
        const { model } = createSubject();
        expect(() => model.getStream()).toThrow('StreamIsNull');
    });

    it('[R2-RECORDED-GETINFO-PROCESSOPTION-NULL] getInfo throws before any option is set (L650–652)', () => {
        const { model } = createSubject();
        expect(() => model.getInfo()).toThrow('ProcessOptionIsNull');
    });

    it('[R2-RECORDED-GETINFO-CONFIGMODE-NULL] getInfo throws when processOption is set without going through setOption (L654–656)', () => {
        const { model } = createSubject();
        // setOption always assigns processOption and configMode together; bypass it to reach the
        // defensive invariant check that configMode is still set.
        model.processOption = { cmd: '%NODE%', playPosition: 0, videoFileId: 1 };

        expect(() => model.getInfo()).toThrow('ConfigModeIsNull');
    });
});
