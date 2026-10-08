import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const EncoderModel = (
    require(join(snapshot, 'model', 'service', 'encode', 'EncoderModel.js')) as {
        default: new (...args: unknown[]) => {
            start(): Promise<void>;
            getEncodeOption(): unknown;
        };
    }
).default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real EncoderModel.start EncodeOptionIsNull guard (L104–107).
 * Public start() with no prior setOption logs and rejects.
 * Encode suites exercise start only after setOption, leaving this residual unhit.
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

describe('EncoderModel.start EncodeOptionIsNull (unittest/imp)', () => {
    it('[R2-ENCODER-START-OPTION-NULL] start without setOption rejects EncodeOptionIsNull and logs once', async () => {
        const { encodeLog, encoder } = makeEncoder();

        expect(encoder.getEncodeOption()).toBeNull();

        await expect(encoder.start()).rejects.toThrow('EncodeOptionIsNull');
        expect(encodeLog.error).toHaveBeenCalledExactlyOnceWith('encodeOption is null');
        // option remains unset; no setOption was called
        expect(encoder.getEncodeOption()).toBeNull();
    });

    it('[R2-ENCODER-NO-OPTION-GUARDS] every encodeOption-is-null guard short-circuits before setOption', async () => {
        const { encodeLog, encoder } = makeEncoder();
        const anyEncoder = encoder as unknown as {
            cancel(): Promise<void>;
            childEndProcessing(code: number | null, signal: NodeJS.Signals | null, outputFilePath: string | null): Promise<void>;
            getEncodeId(): unknown;
            updateEncodingProgressInfo(data: unknown): void;
        };

        // getEncodeId (EncoderModel.ts:630) and cancel (EncoderModel.ts:581) are public and reachable
        // with no prior setOption; updateEncodingProgressInfo (EncoderModel.ts:372) and
        // childEndProcessing (EncoderModel.ts:539) are private but are the only way -- short of a
        // running child process -- to observe their own encodeOption-is-null guards, since normal
        // callers only reach them from a stdout/exit listener that setOption/start themselves register.
        expect(anyEncoder.getEncodeId()).toBeNull();

        await expect(anyEncoder.cancel()).resolves.toBeUndefined();

        // Spy on the private parsing step updateEncodingProgressInfo only reaches after its own
        // `encodeOption === null` guard (EncoderModel.ts:372) -- proving the guard actually
        // short-circuited before doing any parsing work, not just that the call happened not to
        // throw for some other reason.
        const decodeProgressChunkSpy = vi.spyOn(encoder as unknown as { decodeProgressChunk(data: Buffer): unknown }, 'decodeProgressChunk');
        anyEncoder.updateEncodingProgressInfo(Buffer.from('progress'));
        expect(decodeProgressChunkSpy).not.toHaveBeenCalled();

        await anyEncoder.childEndProcessing(0, null, null);
        expect(encodeLog.error).toHaveBeenCalledWith('encodeOptionIsNull');

        expect(encoder.getEncodeOption()).toBeNull();
    });
});
