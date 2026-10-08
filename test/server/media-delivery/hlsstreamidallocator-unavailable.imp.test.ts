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
 * Real HlsStreamIdAllocator.captureSnapshot early-return path (L84–86) and the constructor's
 * "no config/artifactIndex" branch it depends on: production DI always supplies both
 * collaborators, so `isAvailable() === false` is only reachable by constructing the allocator
 * without them (mirrors StreamManageModel's own NULL_STREAM_ID_ALLOCATOR fallback contract).
 */
describe('HlsStreamIdAllocator unavailable collaborator contract (unittest/imp)', () => {
    it('[R2-HLSSTREAMIDALLOCATOR-UNAVAILABLE] resolves captureSnapshot to null and skips initialization without config/artifactIndex', async () => {
        const log = logger();
        const allocator = new HlsStreamIdAllocator({ getLogger: () => log });

        expect(allocator.isAvailable()).toBe(false);
        await expect(allocator.captureSnapshot()).resolves.toBeNull();
    });

    it('[R2-HLSSTREAMIDALLOCATOR-UNAVAILABLE] resolves captureSnapshot to null when only the artifactIndex is missing', async () => {
        const log = logger();
        const allocator = new HlsStreamIdAllocator({ getLogger: () => log }, { getConfig: () => ({ streamFilePath: 'synthetic' }) });

        expect(allocator.isAvailable()).toBe(false);
        await expect(allocator.captureSnapshot()).resolves.toBeNull();
    });

    it('[R2-HLSSTREAMIDALLOCATOR-UNAVAILABLE] resolves captureSnapshot to null when only the config is missing', async () => {
        const log = logger();
        const scanAtStartup = vi.fn(async () => new Set<number>());
        const allocator = new HlsStreamIdAllocator({ getLogger: () => log }, undefined, {
            deleteAllFiles: vi.fn(),
            listExact: vi.fn(),
            scanAtStartup,
            scanCurrent: vi.fn(),
            setOption: vi.fn(),
        });

        expect(allocator.isAvailable()).toBe(false);
        expect(scanAtStartup).not.toHaveBeenCalled();
        await expect(allocator.captureSnapshot()).resolves.toBeNull();
    });
});
