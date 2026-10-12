import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';
import { ThumbnailApiModel } from './_thumbnail-harness';

describe('ThumbnailApiModel IPC delegation', () => {
    it('[TM-IMP-API-IPC-DELEGATION] regenerate, fileCleanup, add, and delete each delegate to the injected IPC client exactly once with the given arguments', async () => {
        const ipc = {
            thumbnail: {
                add: vi.fn().mockResolvedValue(undefined),
                delete: vi.fn().mockResolvedValue(undefined),
                fileCleanup: vi.fn().mockResolvedValue(undefined),
                regenerate: vi.fn().mockResolvedValue(undefined),
            },
        };
        const api = new ThumbnailApiModel(ipc, { findId: vi.fn() }, { getConfig: () => ({}) });

        await expect(api.regenerate()).resolves.toBeUndefined();
        await expect(api.fileCleanup()).resolves.toBeUndefined();
        await expect(api.add(123)).resolves.toBeUndefined();
        await expect(api.delete(456)).resolves.toBeUndefined();

        expect(ipc.thumbnail.regenerate).toHaveBeenCalledExactlyOnceWith();
        expect(ipc.thumbnail.fileCleanup).toHaveBeenCalledExactlyOnceWith();
        expect(ipc.thumbnail.add).toHaveBeenCalledExactlyOnceWith(123);
        expect(ipc.thumbnail.delete).toHaveBeenCalledExactlyOnceWith(456);
    });
});
