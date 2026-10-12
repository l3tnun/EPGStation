import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    axiosRequestStub as axiosRequest,
    baseConfig,
    compiled,
    deferred,
    fakeChild,
    logger,
    prepareApiUtil,
    prepareEncodeProcessManageModel,
    spawnStub,
} from './_media-harness';

const LiveHLSStreamModel = compiled<any>('model', 'service', 'stream', 'LiveHLSStreamModel.js').default;
const RecordedHLSStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedHLSStreamModel.js').default;
let EncodeProcessManageModel: new (...args: any[]) => any;
let ApiUtil: new (...args: any[]) => any;
beforeAll(async () => {
    EncodeProcessManageModel = await prepareEncodeProcessManageModel();
    ApiUtil = await prepareApiUtil();
});

afterEach(() => {
    // `spawnStub`/`axiosRequestStub` (from `./_media-harness`) are plain `vi.fn()`s, not `vi.spyOn`
    // spies -- `restoreAllMocks` only restores spies, so use `resetAllMocks` to avoid a leftover
    // `mockImplementation` leaking into later tests.
    vi.resetAllMocks();
    axiosRequest.mockResolvedValue({ data: {} });
    vi.useRealTimers();
});

const deps = [
    { getConfig: () => baseConfig() },
    { getLogger: logger },
    { create: async () => undefined },
    { deleteAllFiles: async () => undefined, setOption: () => undefined },
    { notifyClient: () => undefined },
];

describe('stream command expansion', () => {
    it('[MD-5.3] expands live FFmpeg/HLS placeholders and leaves unknown tokens untouched', async () => {
        const model = new LiveHLSStreamModel(
            deps[0],
            deps[1],
            deps[2],
            deps[3],
            { getServiceStream: async () => undefined },
            deps[4],
        );
        model.setOption({ channelId: 1, cmd: '%FFMPEG% %streamFileDir% %streamNum% %UNKNOWN%' }, 0);
        expect(model.createProcessOption(9)).toEqual({
            cmd: 'synthetic-ffmpeg synthetic-stream-root 9 %UNKNOWN%',
            input: null,
            output: 'synthetic-stream-root/stream9.m3u8',
            priority: 1,
        });
    });

    it('[MD-5.3] expands recorded seek and HLS placeholders with the production input contract', async () => {
        const model = new RecordedHLSStreamModel(...deps, {}, {}, {});
        model.setOption(
            { cmd: '%FFMPEG% %SS% %streamFileDir% %streamNum% %UNKNOWN%', playPosition: 7, videoFileId: 31 },
            0,
        );
        model.videoFilePath = 'synthetic/video.mp4';
        model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
        model.videoFileType = 'encoded';
        await expect(model.createProcessOption(9)).resolves.toEqual({
            cmd: 'synthetic-ffmpeg 7 synthetic-stream-root 9 %UNKNOWN%',
            input: 'synthetic/video.mp4',
            output: 'synthetic-stream-root/stream9.m3u8',
            priority: 1,
        });
    });

    it('[MD-10.2] keeps non-applicable viewer placeholders intact through command execution', async () => {
        spawnStub.mockImplementation(() => fakeChild());
        const manager = new EncodeProcessManageModel({ getLogger: logger }, { getConfig: () => baseConfig() });

        await manager.create({
            cmd: '%NODE% %INPUT% %OUTPUT% %streamFileDir% %streamNum% %SS%',
            input: null,
            output: null,
            priority: 1,
        });

        expect(spawnStub).toHaveBeenCalledWith(process.argv[0], [
            '%INPUT%',
            '%OUTPUT%',
            '%streamFileDir%',
            '%streamNum%',
            '%SS%',
        ]);
    });
});

describe('Kodi request deadline implementation', () => {
    it('[MD-7.5] applies one finite client deadline and releases it after a response', async () => {
        vi.useFakeTimers();
        const response = deferred<unknown>();
        axiosRequest.mockImplementationOnce(() => response.promise);
        const apiUtil = new ApiUtil({ getConfig: () => ({}) });

        const pending = apiUtil.sendToKodi('https://request.invalid/video', {
            host: 'http://kodi.invalid:8080',
            name: 'living-room',
        });
        const option = axiosRequest.mock.calls[0]?.[0] as { signal: AbortSignal; timeout: number };
        expect(option.timeout).toBe(30_000);
        expect(option.signal.aborted).toBe(false);

        await vi.advanceTimersByTimeAsync(29_999);
        expect(vi.getTimerCount()).toBe(1);
        response.resolve({ data: {} });

        await expect(pending).resolves.toBeUndefined();
        expect(option.signal.aborted).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-7.5] rejects with the deadline terminal after the request remains pending', async () => {
        vi.useFakeTimers();
        const response = deferred<unknown>();
        axiosRequest.mockImplementationOnce(() => response.promise);
        const apiUtil = new ApiUtil({ getConfig: () => ({}) });

        const terminal = apiUtil
            .sendToKodi('https://request.invalid/video', {
                host: 'http://kodi.invalid:8080',
                name: 'living-room',
            })
            .then(
                () => undefined,
                error => error,
            );

        await vi.advanceTimersByTimeAsync(30_000);

        await expect(terminal).resolves.toMatchObject({ message: 'KodiRequestDeadlineExceeded' });
        expect(vi.getTimerCount()).toBe(0);
    });
});
