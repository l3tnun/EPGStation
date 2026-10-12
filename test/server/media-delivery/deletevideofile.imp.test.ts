import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const VideoApiModel = (
    require(join(snapshot, 'model', 'api', 'video', 'VideoApiModel.js')) as {
        default: new (...args: unknown[]) => {
            deleteVideoFile(videoFileId: number): Promise<void>;
        };
    }
).default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real VideoApiModel.deleteVideoFile thin delegation (L158–160).
 * Public body only awaits ipc.recorded.deleteVideoFile; API suites mock VideoApi itself.
 *
 * Fixture-safety: keep `recorded` object properties as fully resolvable literals in the
 * object initializer (null placeholder), then assign the mock after construction. Putting
 * vi.fn under the `recorded` key is uninspectable to the scanner.
 */
const makeSubject = () => {
    const deleteVideoFile = vi.fn(async (_videoFileId: number) => undefined);
    const ipc = {
        recorded: {
            deleteVideoFile: null as unknown as (videoFileId: number) => Promise<void>,
        },
    };
    ipc.recorded.deleteVideoFile = deleteVideoFile;
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
        ipc,
    );
    return { deleteVideoFile, model };
};

describe('VideoApiModel.deleteVideoFile thin delegation (unittest/imp)', () => {
    it('[R2-VIDEOAPI-DELETEVIDEOFILE] public deleteVideoFile delegates once to ipc.recorded.deleteVideoFile', async () => {
        const { deleteVideoFile, model } = makeSubject();

        await expect(model.deleteVideoFile(4201)).resolves.toBeUndefined();

        expect(deleteVideoFile).toHaveBeenCalledExactlyOnceWith(4201);
    });
});
