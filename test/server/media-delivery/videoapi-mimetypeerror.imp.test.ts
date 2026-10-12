import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;

/**
 * `file-type` ships as a pure ES module (`"type": "module"`, no CommonJS build), so its `require()`d
 * form is the live module namespace object itself -- `vi.spyOn` cannot redefine any of its properties
 * ("Module namespace is not configurable in ESM"). Separately, the compiled `VideoApiModel.js`'s own
 * `import { fileTypeFromFile } from 'file-type'` is a static binding that a mutation of some other
 * `require('file-type')` reference would not reach anyway, the same hazard as `child_process`/`axios`
 * elsewhere in this migration.
 *
 * `vi.doMock` + `vi.resetModules` + a dynamic `import()` of the compiled model is the mechanism that
 * actually lands a replacement in that binding (mirrors
 * `event-and-hook-delivery/external-command-test-harness.ts#installSpawnStub`).
 */
const fileTypeFromFileDispatch = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined);

let VideoApiModel: new (...args: unknown[]) => {
    getFullFilePath(videoFileId: number): Promise<{ path: string; mime: string } | null>;
};

beforeAll(async () => {
    const fileTypeMock = { fileTypeFromFile: (...args: unknown[]) => fileTypeFromFileDispatch(...args) };
    vi.doMock('file-type', () => fileTypeMock);
    try {
        vi.resetModules();
        const imported = (await import(join(snapshot, 'model', 'api', 'video', 'VideoApiModel.js'))) as {
            default: new (...args: unknown[]) => {
                getFullFilePath(videoFileId: number): Promise<{ path: string; mime: string } | null>;
            };
        };
        VideoApiModel = imported.default;
    } finally {
        vi.doUnmock('file-type');
    }
});

afterEach(() => {
    // `fileTypeFromFileDispatch` is a plain `vi.fn()`, not a `vi.spyOn` spy -- `restoreAllMocks` only
    // restores spies, so `resetAllMocks` is used to bring back its creation-time (resolves `undefined`)
    // implementation and avoid leaking a test's override into later tests.
    vi.resetAllMocks();
});

/**
 * Real VideoApiModel.getFullFilePath → createMime extension switch (L115–119).
 * Public getFullFilePath with file-type miss: .mp4 rejects MimeTypeError; .m2ts returns video/mp2t.
 * Non-null file-type mime and private createMime are out of scope.
 */
const makeSubject = (fullPath: string) => {
    const getFullFilePathFromId = vi.fn(async (_videoFileId: number) => fullPath);
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
            getFullFilePathFromId,
            getInfo: vi.fn(async () => ({ duration: 0 })),
        },
        {
            recorded: {
                deleteVideoFile: null as unknown as (videoFileId: number) => Promise<void>,
            },
        },
    );
    return { getFullFilePathFromId, model };
};

describe('VideoApiModel.getFullFilePath createMime extension switch (unittest/imp)', () => {
    it('[R2-VIDEOAPI-MIMETYPEERROR] getFullFilePath rejects MimeTypeError for non-ts/m2ts after file-type miss', async () => {
        fileTypeFromFileDispatch.mockResolvedValue(undefined);
        const { getFullFilePathFromId, model } = makeSubject('/synthetic/video.mp4');

        await expect(model.getFullFilePath(4401)).rejects.toThrow('MimeTypeError');
        expect(getFullFilePathFromId).toHaveBeenCalledExactlyOnceWith(4401);
        expect(fileTypeFromFileDispatch).toHaveBeenCalledExactlyOnceWith('/synthetic/video.mp4');
    });

    it('[R2-VIDEOAPI-MIMETYPEERROR-M2TS] getFullFilePath returns video/mp2t for .m2ts after file-type miss', async () => {
        fileTypeFromFileDispatch.mockResolvedValue(undefined);
        const { getFullFilePathFromId, model } = makeSubject('/synthetic/video.m2ts');

        await expect(model.getFullFilePath(4402)).resolves.toEqual({
            path: '/synthetic/video.m2ts',
            mime: 'video/mp2t',
        });
        expect(getFullFilePathFromId).toHaveBeenCalledExactlyOnceWith(4402);
        expect(fileTypeFromFileDispatch).toHaveBeenCalledExactlyOnceWith('/synthetic/video.m2ts');
    });

    it('[R2-VIDEOAPI-MATROSKA-MIME] getFullFilePath publishes video/x-matroska when file-type reports video/matroska', async () => {
        fileTypeFromFileDispatch.mockResolvedValue({ ext: 'mkv', mime: 'video/matroska' });
        const { model } = makeSubject('/synthetic/video.mkv');

        await expect(model.getFullFilePath(4403)).resolves.toEqual({
            path: '/synthetic/video.mkv',
            mime: 'video/x-matroska',
        });
    });

    it('[R2-VIDEOAPI-MATROSKA-MIME-PASSTHROUGH] getFullFilePath keeps other file-type mimes unchanged', async () => {
        fileTypeFromFileDispatch.mockResolvedValue({ ext: 'mp4', mime: 'video/mp4' });
        const { model } = makeSubject('/synthetic/video.mp4');

        await expect(model.getFullFilePath(4404)).resolves.toEqual({
            path: '/synthetic/video.mp4',
            mime: 'video/mp4',
        });
    });
});
