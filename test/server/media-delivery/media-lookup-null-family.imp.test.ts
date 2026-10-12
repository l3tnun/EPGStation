import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled, executionManager, fakeStream, logger } from './_media-harness';

const StreamApiModel = compiled<any>('model', 'api', 'stream', 'StreamApiModel.js').default;
const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;
const VideoApiModel = compiled<any>('model', 'api', 'video', 'VideoApiModel.js').default;

/**
 * Combined residual-4351 G5–G6 public media lookup null family.
 * - StreamApiModel.getLiveM2TsStreamM3u8: channelDB.findId null → null (L355–357)
 * - VideoApiModel.getM3u8: missing video / missing recorded → null (L132–139)
 * Real compiled models; no product change; no stream start after missing lookup.
 */
const makeStreamApi = (channelFindId: ReturnType<typeof vi.fn>) => {
    const createM3U8PlayListStr = vi.fn(() => 'synthetic-playlist');
    const consumer = { acquireAndOpen: vi.fn() };
    const manager = new StreamManageModel(
        { getLogger: logger },
        executionManager(),
        { notifyClient: vi.fn() },
        undefined,
        consumer,
    );
    const model = new StreamApiModel(
        { getConfig: () => ({}) },
        async () => fakeStream(),
        async () => fakeStream(),
        async () => fakeStream(),
        async () => fakeStream(),
        manager,
        { findChannelIdAndTime: vi.fn(async () => null) },
        { findId: vi.fn(async () => null) },
        { findId: vi.fn(async () => null) },
        { findId: channelFindId },
        { createM3U8PlayListStr },
        consumer,
    );
    return { createM3U8PlayListStr, model };
};

const makeVideoApi = (videoFindId: ReturnType<typeof vi.fn>, recordedFindId: ReturnType<typeof vi.fn>) => {
    const createM3U8PlayListStr = vi.fn(() => 'synthetic-playlist');
    const model = new VideoApiModel(
        {
            getConfig: () => ({
                recorded: [],
                thumbnail: 'synthetic-thumbnail',
            }),
        },
        { findId: videoFindId },
        { findId: recordedFindId },
        { createM3U8PlayListStr },
        {
            getFullFilePathFromId: vi.fn(async () => null),
            getInfo: vi.fn(async () => ({ duration: 0 })),
        },
        {
            recorded: {
                deleteVideoFile: null as unknown as (videoFileId: number) => Promise<void>,
            },
        },
    );
    return { createM3U8PlayListStr, model };
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('public media lookup null family (unittest/imp)', () => {
    it('[R2-MEDIA-LOOKUP-NULL-FAMILY] Stream/Video public lookups resolve null without playlist work', async () => {
        const channelFindId = vi.fn(async () => null);
        const { createM3U8PlayListStr: streamPlaylist, model: streamApi } = makeStreamApi(channelFindId);

        await expect(
            streamApi.getLiveM2TsStreamM3u8('host.invalid', false, { channelId: 101, mode: 0 }),
        ).resolves.toBeNull();

        expect(channelFindId).toHaveBeenCalledExactlyOnceWith(101);
        expect(streamPlaylist).not.toHaveBeenCalled();

        const videoMissing = vi.fn(async () => null);
        const recordedNever = vi.fn(async () => ({ name: 'rec', duration: 60000 }));
        const { createM3U8PlayListStr: videoPlaylistA, model: videoApiMissingVideo } = makeVideoApi(
            videoMissing,
            recordedNever,
        );
        await expect(videoApiMissingVideo.getM3u8('host.invalid', false, 22)).resolves.toBeNull();
        expect(videoMissing).toHaveBeenCalledExactlyOnceWith(22);
        expect(recordedNever).not.toHaveBeenCalled();
        expect(videoPlaylistA).not.toHaveBeenCalled();

        const videoPresent = vi.fn(async () => ({
            filePath: 'clip.ts',
            recordedId: 9001,
        }));
        const recordedMissing = vi.fn(async () => null);
        const { createM3U8PlayListStr: videoPlaylistB, model: videoApiMissingRecorded } = makeVideoApi(
            videoPresent,
            recordedMissing,
        );
        await expect(videoApiMissingRecorded.getM3u8('host.invalid', false, 33)).resolves.toBeNull();
        expect(videoPresent).toHaveBeenCalledExactlyOnceWith(33);
        expect(recordedMissing).toHaveBeenCalledExactlyOnceWith(9001);
        expect(videoPlaylistB).not.toHaveBeenCalled();
    });
});
