import { describe, expect, it, vi } from 'vitest';

import { compiled, logger } from './_media-harness';

const HlsStreamIdAllocator = compiled<any>(
    'model',
    'service',
    'stream',
    'manager',
    'HlsStreamIdAllocator.js',
).default;

/**
 * Web・API側処理の起動時（構築時、最初のHLS識別番号の割当より前）に、残ったHLS成果物の削除を始めることを確かめる。
 * 最初の配信を待たずに削除するので、配信が無い間も前回の成果物が残らない。
 */
describe('HlsStreamIdAllocator startup artifact deletion (unittest/imp)', () => {
    it('[R2-HLSSTREAMIDALLOCATOR-STARTUP] starts deleting the remaining artifacts on construction, before the first snapshot', async () => {
        const log = logger();
        const deleteAllArtifacts = vi.fn(async () => new Set<number>());
        const scanCurrent = vi.fn(async () => new Set<number>());
        const allocator = new HlsStreamIdAllocator(
            { getLogger: () => log },
            { getConfig: () => ({ streamFilePath: 'synthetic-stream-root' }) },
            { deleteAllFiles: vi.fn(), listExact: vi.fn(), deleteAllArtifacts, scanCurrent, setOption: vi.fn() },
        );

        expect(allocator.isAvailable()).toBe(true);
        expect(deleteAllArtifacts).toHaveBeenCalledOnce();
        expect(deleteAllArtifacts).toHaveBeenCalledWith('synthetic-stream-root');

        // 最初の割当の前の走査は、構築時に始めた削除を待つだけで、削除をやり直さない
        await allocator.captureSnapshot();
        expect(deleteAllArtifacts).toHaveBeenCalledOnce();
        expect(scanCurrent).toHaveBeenCalledWith('synthetic-stream-root');
    });
});
