import { describe, expect, it } from 'vitest';

import { compiled } from './_media-harness';

describe('recorded playback source consumer contract', () => {
    it('[MD-2.4] passes an adopted encoded source to the process as a direct input without a reader', () => {
        const RecordedPlaybackSourceConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedPlaybackSourceConsumer.js',
        ).default;
        const consumer = new RecordedPlaybackSourceConsumer();

        expect(
            consumer.consume({
                inputPath: 'synthetic/encoded.m2ts',
                kind: 'encoded-direct',
                playPosition: 12,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            }),
        ).toEqual({
            inputPath: 'synthetic/encoded.m2ts',
            playPosition: 12,
            processInput: 'synthetic/encoded.m2ts',
            recordedId: 41,
            videoFileId: 31,
            videoInfo: { bitRate: 8, duration: 60, size: 480 },
        });
    });

    it('[MD-2.4] passes an adopted reader source through stdin without reselecting the input path', () => {
        const RecordedPlaybackSourceConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedPlaybackSourceConsumer.js',
        ).default;
        const reader = { close: async () => undefined, readable: {} };
        const consumer = new RecordedPlaybackSourceConsumer();

        expect(
            consumer.consume({
                inputPath: 'synthetic/recording.ts',
                kind: 'recording-tail-reader',
                playPosition: 12,
                reader,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            }),
        ).toEqual({
            inputPath: 'synthetic/recording.ts',
            playPosition: 12,
            processInput: null,
            reader,
            recordedId: 41,
            videoFileId: 31,
            videoInfo: { bitRate: 8, duration: 60, size: 480 },
        });
    });
});
