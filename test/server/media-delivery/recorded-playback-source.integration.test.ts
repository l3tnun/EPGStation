import { describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, fakeChild, logger } from './_media-harness';

const RecordedStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedStreamModel.js').default;

describe('recorded playback source consumer integration', () => {
    it('[MD-2.4] rejects a source for a different video file before starting a process', async () => {
        const child = fakeChild();
        const processManager = {
            createManaged: vi.fn(async () => ({ child, handle: Object.freeze({ kind: 'managed' }) })),
            requestStop: vi.fn(async () => ({ status: 'requested' })),
        };
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            processManager,
            { delete: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setOption({ cmd: '%NODE%', playPosition: 12, videoFileId: 31 }, 0);
        model.setPlaybackSource({
            inputPath: 'synthetic/encoded.m2ts',
            kind: 'encoded-direct',
            playPosition: 12,
            recordedId: 41,
            videoFileId: 32,
            videoInfo: { bitRate: 8, duration: 60, size: 480 },
        });

        await expect(model.start(7)).rejects.toThrow('RecordedPlaybackSourceVideoFileIdMismatch');

        expect(processManager.createManaged).not.toHaveBeenCalled();
    });
});
