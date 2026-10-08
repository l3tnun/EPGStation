import 'reflect-metadata';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled } from './_media-harness';

const VideoApiModel = compiled<any>('model', 'api', 'video', 'VideoApiModel.js').default;
const { toLegacyRecordedDeliveryError } = compiled<any>(
    'model',
    'service',
    'stream',
    'recorded',
    'RecordedDeliveryLeaseConsumer.js',
);

/**
 * residual-4286 G1–G2 combined family.
 * 1) exported toLegacyRecordedDeliveryError: non-Error coercion + RecordedIsNull/GetVideoFilePathError arms
 * 2) public VideoApiModel.openDelivery: soft-null for those legacy messages; rethrow unrelated
 * Product code is not modified.
 */
const makeVideoApi = (acquireRecordedDelivery: ReturnType<typeof vi.fn>) => {
    const model = new VideoApiModel(
        {
            getConfig: () => ({
                recorded: [],
                thumbnail: 'synthetic-thumbnail',
            }),
        },
        { findId: vi.fn(async () => null) },
        { findId: vi.fn(async () => null) },
        { createM3U8PlayListStr: vi.fn(() => 'synthetic-playlist') },
        {
            getFullFilePathFromId: vi.fn(async () => null),
            getInfo: vi.fn(async () => ({ duration: 0 })),
        },
        {
            recorded: {
                deleteVideoFile: null as unknown as (videoFileId: number) => Promise<void>,
            },
        },
        { acquireRecordedDelivery },
    );
    return { model };
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('recorded-delivery legacy error family (unittest/imp)', () => {
    it('[R2-RECORDED-DELIVERY-LEGACY-ERROR-FAMILY] maps domain errors and openDelivery soft-null/rethrow', async () => {
        // non-Error is String(error) coerced
        expect(toLegacyRecordedDeliveryError('raw-failure').message).toBe('raw-failure');

        expect(toLegacyRecordedDeliveryError(new Error('RecordedPlaybackRecordedNotFound')).message).toBe(
            'RecordedIsNull',
        );
        expect(toLegacyRecordedDeliveryError(new Error('RecordedPlaybackPathNotFound')).message).toBe(
            'GetVideoFilePathError',
        );

        const acquireNullRecorded = vi.fn(async () => {
            throw new Error('RecordedPlaybackRecordedNotFound');
        });
        const { model: modelNullRecorded } = makeVideoApi(acquireNullRecorded);
        await expect(modelNullRecorded.openDelivery(5101)).resolves.toBeNull();
        expect(acquireNullRecorded).toHaveBeenCalledExactlyOnceWith(5101, 0, expect.any(Function));

        const acquireNullPath = vi.fn(async () => {
            throw new Error('RecordedPlaybackPathNotFound');
        });
        const { model: modelNullPath } = makeVideoApi(acquireNullPath);
        await expect(modelNullPath.openDelivery(5102)).resolves.toBeNull();
        expect(acquireNullPath).toHaveBeenCalledExactlyOnceWith(5102, 0, expect.any(Function));

        const acquireOther = vi.fn(async () => {
            throw new Error('UnrelatedDeliveryFailure');
        });
        const { model: modelOther } = makeVideoApi(acquireOther);
        await expect(modelOther.openDelivery(5103)).rejects.toThrow('UnrelatedDeliveryFailure');
        expect(acquireOther).toHaveBeenCalledExactlyOnceWith(5103, 0, expect.any(Function));
    });

    it('resolves the full file path as null when the video file cannot be located', async () => {
        const { model } = makeVideoApi(vi.fn());

        await expect(model.getFullFilePath(5199)).resolves.toBeNull();
    });

    it('evaluates the default isActive callback once an omitted-argument delivery is acquired', async () => {
        const release = vi.fn(async () => undefined);
        const acquireRecordedDelivery = vi.fn(async () => ({
            recordedId: 41,
            release,
            source: { inputPath: 'synthetic/video.ts', kind: 'encoded-direct' },
        }));
        const { model } = makeVideoApi(acquireRecordedDelivery);
        vi.spyOn(model, 'createMime').mockResolvedValue('video/mp2t');

        // openDelivery is called with only videoFileId, so its own `isActive: () => boolean = () => true`
        // default (VideoApiModel.ts) is what is later invoked at the post-acquisition `isActive() === false`
        // check -- the default's *creation* alone (evaluating the arrow function to bind the parameter) does
        // not execute its body; only an actual call site through to a successful acquisition does.
        await expect(model.openDelivery(5104)).resolves.toMatchObject({
            mime: 'video/mp2t',
            path: 'synthetic/video.ts',
        });
        expect(acquireRecordedDelivery).toHaveBeenCalledExactlyOnceWith(5104, 0, expect.any(Function));
    });
});
