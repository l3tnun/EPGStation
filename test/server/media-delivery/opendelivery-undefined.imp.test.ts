import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const VideoApiModel = (
    require(join(snapshot, 'model', 'api', 'video', 'VideoApiModel.js')) as {
        default: new (...args: unknown[]) => {
            openDelivery(videoFileId: number, isActive?: () => boolean): Promise<unknown>;
        };
    }
).default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real VideoApiModel.openDelivery StreamManageModelIsUndefined guard (L66–68).
 * Optional IStreamManageModel omitted → public openDelivery rejects before acquire.
 * Object.create is forbidden — use real compiled constructor with six deps only.
 */
const makeSubjectWithoutStreamManager = () => {
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
        // intentionally omit 7th optional streamManageModel
    );
    return { model };
};

describe('VideoApiModel.openDelivery undefined stream manager (unittest/imp)', () => {
    it('[R2-VIDEOAPI-OPENDELIVERY-UNDEFINED] openDelivery rejects StreamManageModelIsUndefined when manager omitted', async () => {
        const { model } = makeSubjectWithoutStreamManager();

        await expect(model.openDelivery(4301)).rejects.toThrow('StreamManageModelIsUndefined');
    });
});
