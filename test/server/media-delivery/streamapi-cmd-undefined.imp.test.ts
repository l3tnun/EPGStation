import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled, executionManager, fakeStream, logger } from './_media-harness';

const StreamApiModel = compiled<any>('model', 'api', 'stream', 'StreamApiModel.js').default;
const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;

/**
 * Real StreamApiModel.startRecordedWebMStream → getRecordedVideoConfig CmdIsUndefined (L333–335)
 * via real StreamManageModel.startRecorded cleanup path.
 * Config has recorded.ts.webm[mode] structure but cmd is undefined.
 * After CmdIsUndefined, production stops the adopted stream and releases delivery without setOption.
 * Missing stream.recorded / mode ConfigIsUndefined branches are out of scope.
 */
const makeSubject = () => {
    const release = vi.fn(async () => undefined);
    const stream = fakeStream({ type: 'RecordedStream' });
    stream.adoptPlaybackSource.mockImplementation((_source: unknown, releaseSource: () => Promise<void> | void) => {
        stream.stop.mockImplementation(async () => {
            await releaseSource();
        });
    });
    const streamProvider = vi.fn(async () => stream);
    const consumer = {
        acquireAndOpen: vi.fn(async () => ({
            release,
            source: {
                inputPath: 'synthetic/recorded.ts',
                kind: 'completed-file-reader' as const,
                playPosition: 0,
                recordedId: 41,
                videoFileId: 41,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
        })),
    };
    const manager = new StreamManageModel(
        { getLogger: logger },
        executionManager(),
        { notifyClient: vi.fn() },
        undefined,
        consumer,
    );
    const model = new StreamApiModel(
        {
            getConfig: () => ({
                stream: {
                    recorded: {
                        ts: {
                            // mode 0 exists so ConfigIsUndefined is not thrown; cmd is missing → CmdIsUndefined
                            webm: [{}],
                        },
                    },
                },
            }),
        },
        async () => fakeStream(),
        async () => fakeStream(),
        streamProvider,
        async () => fakeStream(),
        manager,
        { findChannelIdAndTime: vi.fn(async () => null) },
        { findId: vi.fn(async () => null) },
        { findId: vi.fn(async () => null) },
        { findId: vi.fn(async () => null) },
        { createM3U8PlayListStr: vi.fn(() => 'synthetic-playlist') },
        consumer,
    );
    return { consumer, manager, model, release, stream, streamProvider };
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('StreamApiModel.startRecordedWebMStream CmdIsUndefined (unittest/imp)', () => {
    it('[R2-STREAMAPI-CMD-UNDEFINED] rejects CmdIsUndefined and cleans adopted stream delivery', async () => {
        const { model, release, stream, streamProvider } = makeSubject();

        await expect(
            model.startRecordedWebMStream({ mode: 0, playPosition: 0, videoFileId: 41 }),
        ).rejects.toThrow('CmdIsUndefined');

        expect(streamProvider).toHaveBeenCalledOnce();
        expect(stream.setOption).not.toHaveBeenCalled();
        await vi.waitFor(() => {
            expect(stream.stop).toHaveBeenCalledOnce();
            expect(release).toHaveBeenCalledOnce();
        });
    });
});
