import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const EncoderModel = (
    require(join(snapshot, 'model', 'service', 'encode', 'EncoderModel.js')) as {
        default: new (...args: unknown[]) => {
            setOption(option: {
                encodeId: number;
                mode: string;
                parentDir: string;
                recordedId: number;
                removeOriginal: boolean;
                sourceVideoFileId: number;
            }): void;
            start(): Promise<void>;
            getEncodeOption(): unknown;
        };
    }
).default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real EncoderModel.start VideoPathIsNotFound guard (L129–131).
 * setOption + DB findId success; getFullFilePathFromId returns null → reject.
 * Video/recorded/channel null paths already have residual 0.
 */
const makeEncoder = () => {
    const encodeLog = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const videoFileDB = {
        findId: vi.fn(async () => ({ id: 92, recordedId: 91, filePath: 'synthetic.ts' })),
    };
    const recordedDB = {
        findId: vi.fn(async () => ({
            id: 91,
            channelId: 7,
            duration: 60,
            startAt: 1,
            endAt: 2,
            name: 'synthetic',
        })),
    };
    const channelDB = {
        findId: vi.fn(async () => ({ id: 7, name: 'synthetic-ch', halfWidthName: 'ch' })),
    };
    const videoUtil = {
        getFullFilePathFromId: vi.fn(async () => null),
        getInfo: vi.fn(async () => null),
        getParentDirPath: vi.fn(() => '/synthetic'),
    };
    const encoder = new EncoderModel(
        { getLogger: () => ({ encode: encodeLog }) },
        { getConfig: () => ({ encode: [{ name: 'synthetic-mode', cmd: 'true' }], ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }) },
        { requestStop: vi.fn() },
        { getFilePath: vi.fn(), release: vi.fn() },
        videoFileDB,
        recordedDB,
        channelDB,
        videoUtil,
        {
            emitAddEncode: vi.fn(),
            emitCancelEncode: vi.fn(),
            emitErrorEncode: vi.fn(),
            emitFinishEncode: vi.fn(),
            emitUpdateEncodeProgress: vi.fn(),
        },
        { formatFilePathString: vi.fn(async (directory: string) => directory) },
    );
    return { channelDB, encodeLog, encoder, recordedDB, videoFileDB, videoUtil };
};

const option = {
    encodeId: 9101,
    mode: 'synthetic-mode',
    parentDir: 'synthetic-parent',
    recordedId: 91,
    removeOriginal: false,
    sourceVideoFileId: 92,
};

describe('EncoderModel.start VideoPathIsNotFound (unittest/imp)', () => {
    it('[R2-ENCODER-START-VIDEOPATH-NULL] setOption then start rejects VideoPathIsNotFound when path is null', async () => {
        const { encoder, videoFileDB, recordedDB, channelDB, videoUtil } = makeEncoder();

        encoder.setOption(option);
        expect(encoder.getEncodeOption()).toEqual(option);

        await expect(encoder.start()).rejects.toThrow('VideoPathIsNotFound');

        expect(videoFileDB.findId).toHaveBeenCalledWith(92);
        expect(recordedDB.findId).toHaveBeenCalledWith(91);
        expect(channelDB.findId).toHaveBeenCalledWith(7);
        expect(videoUtil.getFullFilePathFromId).toHaveBeenCalledWith(92);
    });
});
