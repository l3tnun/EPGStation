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
            getEncodeOption(): unknown;
        };
    }
).default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real EncoderModel.setOption already-set guard (L82–85).
 * First set succeeds; second public setOption throws EncodeSetOptionError.
 * Encode suites mock setOption, leaving the residual guard unhit.
 */
const makeEncoder = () => {
    const encodeLog = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const encoder = new EncoderModel(
        { getLogger: () => ({ encode: encodeLog }) },
        { getConfig: () => ({ encode: [], ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }) },
        { requestStop: vi.fn() },
        { getFilePath: vi.fn(), release: vi.fn() },
        { findId: vi.fn(async () => null) },
        { findId: vi.fn(async () => null) },
        { findId: vi.fn(async () => null) },
        {
            getFullFilePathFromId: vi.fn(async () => null),
            getInfo: vi.fn(async () => null),
            getParentDirPath: vi.fn(() => '/synthetic'),
        },
        {
            emitAddEncode: vi.fn(),
            emitCancelEncode: vi.fn(),
            emitErrorEncode: vi.fn(),
            emitFinishEncode: vi.fn(),
            emitUpdateEncodeProgress: vi.fn(),
        },
        { formatFilePathString: vi.fn(async (directory: string) => directory) },
    );
    return { encodeLog, encoder };
};

const option = {
    encodeId: 9001,
    mode: 'synthetic-mode',
    parentDir: 'synthetic-parent',
    recordedId: 91,
    removeOriginal: false,
    sourceVideoFileId: 92,
};

describe('EncoderModel.setOption already-set throw (unittest/imp)', () => {
    it('[R2-ENCODER-SETOPTION-ALREADYSET] first setOption stores option; second throws EncodeSetOptionError', () => {
        const { encodeLog, encoder } = makeEncoder();

        expect(encoder.getEncodeOption()).toBeNull();
        encoder.setOption(option);
        expect(encoder.getEncodeOption()).toEqual(option);
        expect(encodeLog.error).not.toHaveBeenCalled();

        expect(() => encoder.setOption({ ...option, encodeId: 9002 })).toThrow('EncodeSetOptionError');
        expect(encodeLog.error).toHaveBeenCalledExactlyOnceWith('encodeOption is not null');
        // first option remains; second set rejected
        expect(encoder.getEncodeOption()).toEqual(option);
    });
});
