import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled } from './_media-harness';

const StreamApiModel = compiled<any>('model', 'api', 'stream', 'StreamApiModel.js').default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real StreamApiModel.getStreamInfos StreamInfoTypeError else branch (L481–483).
 * Public getStreamInfos with an unknown stream info type rejects StreamInfoTypeError.
 * Live/Recorded success paths are out of scope.
 */
const makeSubject = (streamInfos: unknown[]) => {
    const streamManageModel = {
        getStreamInfos: vi.fn(() => streamInfos),
    };
    const model = new StreamApiModel(
        { getConfig: () => ({}) },
        async () => ({}),
        async () => ({}),
        async () => ({}),
        async () => ({}),
        streamManageModel,
        { findChannelIdAndTime: vi.fn(async () => null) },
        { findId: vi.fn(async () => null) },
        { findId: vi.fn(async () => null) },
        { findId: vi.fn(async () => null) },
        { createM3U8PlayListStr: vi.fn(() => 'synthetic-playlist') },
    );
    return { model, streamManageModel };
};

describe('StreamApiModel.getStreamInfos StreamInfoTypeError (unittest/imp)', () => {
    it('[R2-STREAMAPI-STREAMINFOTYPEERROR] getStreamInfos rejects for unknown stream info type', async () => {
        const { model, streamManageModel } = makeSubject([
            {
                streamId: 7,
                info: {
                    type: 'UnknownStreamType',
                    mode: 0,
                    isEnable: true,
                },
            },
        ]);

        await expect(model.getStreamInfos(false)).rejects.toThrow('StreamInfoTypeError');
        expect(streamManageModel.getStreamInfos).toHaveBeenCalledOnce();
    });
});
