import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, executionManager, fakeChild, fakeStream, logger } from './_media-harness';

const StreamApiModel = compiled<any>('model', 'api', 'stream', 'StreamApiModel.js').default;
const LiveStreamModel = compiled<any>('model', 'service', 'stream', 'LiveStreamModel.js').default;
const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;

afterEach(() => vi.useRealTimers());

const createApi = (config = baseConfig()) => {
    const direct = fakeStream();
    const hls = fakeStream();
    const manage = { start: vi.fn(async () => 14) };
    const apiUtil = { createM3U8PlayListStr: vi.fn(() => 'synthetic-playlist') };
    const api = new StreamApiModel(
        { getConfig: () => config },
        async () => direct,
        async () => hls,
        async () => fakeStream(),
        async () => fakeStream(),
        manage,
        {},
        {},
        {},
        { findId: vi.fn(async () => ({ name: 'synthetic-channel' })) },
        apiUtil,
    );
    return { api, apiUtil, direct, hls, manage };
};

describe('live delivery characterization', () => {
    it('[PRIMARY R1.1] returns the manager-owned live body after starting the requested channel', async () => {
        const { api, direct, manage } = createApi();
        const body = new PassThrough();
        direct.getStream.mockReturnValue(body);

        await expect(api.startLiveM2TsStream({ channelId: 101, mode: 0 })).resolves.toEqual({
            stream: body,
            streamId: 14,
        });
        expect(direct.setOption).toHaveBeenCalledWith({ channelId: 101, cmd: undefined }, 0);
        expect(manage.start).toHaveBeenCalledWith(direct);
    });

    it('[PRIMARY R1.2] selects M2TS, M2TSLL, WebM, MP4 and HLS configured methods', async () => {
        const { api, direct, hls, manage } = createApi();
        await api.startLiveM2TsStream({ channelId: 101, mode: 0 });
        await api.startLiveM2TsLLStream({ channelId: 101, mode: 0 });
        await api.startLiveWebmStream({ channelId: 101, mode: 0 });
        await api.startMp4Stream({ channelId: 101, mode: 0 });
        await expect(api.startLiveHLSStream({ channelId: 101, mode: 0 })).resolves.toBe(14);

        expect(direct.setOption.mock.calls.map(call => call[0])).toEqual([
            { channelId: 101, cmd: undefined },
            { channelId: 101, cmd: '%NODE% live-m2tsll' },
            { channelId: 101, cmd: '%NODE% live-webm' },
            { channelId: 101, cmd: '%NODE% live-mp4' },
        ]);
        expect(hls.setOption).toHaveBeenCalledWith({ channelId: 101, cmd: '%NODE% live-hls' }, 0);
        expect(manage.start).toHaveBeenCalledTimes(5);
    });

    it('[PRIMARY R1.5] rejects an unknown format quality before provider or tuner work', async () => {
        const { api, direct, manage } = createApi();
        await expect(api.startLiveWebmStream({ channelId: 101, mode: 9 })).rejects.toThrow('ConfigIsUndefined');
        expect(direct.setOption).not.toHaveBeenCalled();
        expect(manage.start).not.toHaveBeenCalled();
    });

    it('[PRIMARY R1.7] creates the existing external-player live M2TS playlist', async () => {
        const { api, apiUtil } = createApi();
        await expect(
            api.getLiveM2TsStreamM3u8('request-host.invalid', true, { channelId: 101, mode: 2 }),
        ).resolves.toEqual({
            name: 'synthetic-channel.m3u8',
            playList: 'synthetic-playlist',
        });
        expect(apiUtil.createM3U8PlayListStr).toHaveBeenCalledWith({
            baseUrl: '/api/streams/live/101/m2ts?mode=2',
            duration: 0,
            host: 'request-host.invalid',
            isSecure: true,
            name: 'synthetic-channel',
        });
    });

    it('[PRIMARY R1.3] passes a commandless live tuner body through without creating a transform process', async () => {
        const tuner = new PassThrough();
        const close = vi.fn(() => tuner.destroy());
        const createManaged = vi.fn();
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged },
            { deleteAllFiles: vi.fn(), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101 }, 0);

        await model.start(0);
        expect(model.getStream()).toBe(tuner);
        expect(createManaged).not.toHaveBeenCalled();
        await model.stop();
        expect(close).toHaveBeenCalledOnce();
    });

    it('[PRIMARY R1.4] keeps the managed transform handle until the transformed live stream stops', async () => {
        const tuner = new PassThrough();
        const close = vi.fn(() => tuner.destroy());
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'live-contract-handle' });
        const processManager = {
            createManaged: vi.fn(async () => ({ child, handle })),
            requestStop: vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' })),
        };
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            processManager,
            { deleteAllFiles: vi.fn(), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101, cmd: '%NODE% live-contract-transform' }, 0);

        await model.start(4);
        expect(model.getStream()).toBe(child.stdout);
        expect(processManager.createManaged).toHaveBeenCalledOnce();
        expect(processManager.requestStop).not.toHaveBeenCalled();
        await model.stop();
        expect(processManager.requestStop).toHaveBeenCalledWith(handle);
        expect(close).toHaveBeenCalledOnce();
    });

    it('[PRIMARY R1.6] rejects a failed transform start after closing the already-acquired tuner resource', async () => {
        const tuner = new PassThrough();
        const close = vi.fn(() => tuner.destroy());
        const failure = new Error('synthetic live conversion failure');
        const processManager = {
            createManaged: vi.fn(async () => Promise.reject(failure)),
            requestStop: vi.fn(),
        };
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            processManager,
            { deleteAllFiles: vi.fn(), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101, cmd: '%NODE% live-contract-failure' }, 0);

        await expect(model.start(5)).rejects.toBe(failure);
        expect(processManager.createManaged).toHaveBeenCalledOnce();
        expect(processManager.requestStop).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledOnce();
        expect(tuner.destroyed).toBe(true);
    });

    it('[PRIMARY R1.8] rejects a live-delivery start that has not established within the finite start deadline', async () => {
        vi.useFakeTimers();
        const start = new Promise<void>(() => undefined);
        const stream = fakeStream({ isEnable: true, type: 'LiveStream' });
        stream.start.mockImplementation(() => start);
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
        expect(manager.getStreamInfos()).toEqual([]);
    });

    it('[PRIMARY R1.9] leaves an established direct live body running after the start deadline has elapsed', async () => {
        vi.useFakeTimers();
        const tuner = new PassThrough();
        const close = vi.fn(() => tuner.destroy());
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged: vi.fn(), requestStop: vi.fn() },
            { deleteAllFiles: vi.fn(), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101 }, 0);
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });

        await expect(manager.start(model)).resolves.toBe(0);
        await vi.advanceTimersByTimeAsync(60_000);

        expect(close).not.toHaveBeenCalled();
        expect(manager.getStreamInfo(0)).toEqual(model.getInfo());
    });

    it('[PRIMARY R4.5] stops the manager-owned direct live delivery once when its viewer body closes', async () => {
        const tuner = new PassThrough();
        const close = vi.fn(() => tuner.destroy());
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged: vi.fn(), requestStop: vi.fn() },
            { deleteAllFiles: vi.fn(), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101 }, 0);
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });

        await manager.start(model);
        tuner.emit('close');
        await vi.waitFor(() => expect(manager.getStreamInfos()).toEqual([]));

        expect(close).toHaveBeenCalledOnce();
    });
});
