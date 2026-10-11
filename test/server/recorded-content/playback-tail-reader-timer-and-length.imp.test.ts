import 'reflect-metadata';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;

interface TailReadable {
    _read(size: number): void;
    destroyed: boolean;
    file: Record<string, unknown>;
    on(event: string, listener: (chunk: Buffer) => void): unknown;
}
interface Source {
    readonly reader: { readonly readable: TailReadable; close(): Promise<void> };
}
type Provider = {
    open(
        videoFileId: number,
        expectedRecordedId: number,
        playPosition: number,
    ): Promise<{ adopt(): { source?: Source; status: string } }>;
};

const RecordedPlaybackSourceProvider = (
    require(join(snapshot, 'model/operator/recorded/RecordedPlaybackSourceProvider.js')) as {
        default: new (...args: unknown[]) => Provider;
    }
).default;

let directory: string;
let filePath: string;

beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'epgstation-playback-tail-'));
    filePath = join(directory, 'synthetic-recording.m2ts');
});

afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { force: true, recursive: true });
});

const openRecordingSource = async (playPosition: number): Promise<Source> => {
    const provider = new RecordedPlaybackSourceProvider(
        { findId: vi.fn(async () => ({ id: 1, parentDirectoryName: 'synthetic-storage', recordedId: 7, type: 'ts' })) },
        { findId: vi.fn(async () => ({ id: 7, isRecording: true })) },
        {
            getFullFilePathFromVideoFile: vi.fn(() => filePath),
            getInfo: vi.fn(async () => ({ bitRate: 16, duration: 1, size: 1 })),
        },
    );
    const opened = await provider.open(1, 7, playPosition);
    return opened.adopt().source as Source;
};

// 1000ms待ちのtimerだけを横取りし、発火させず、timerごとに別のhandleを返す。
const captureGrowthTimerHandles = (): object[] => {
    const handles: object[] = [];
    const original = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
        handler: () => void,
        delay?: number,
        ...rest: unknown[]
    ) => {
        if (delay === 1000) {
            const handle = { name: `growth-timer-${handles.length}` };
            handles.push(handle);
            return handle as unknown as NodeJS.Timeout;
        }
        return (original as (...args: unknown[]) => NodeJS.Timeout)(handler, delay, ...rest);
    }) as unknown as typeof setTimeout);
    return handles;
};

describe('[RC-10.2] recording-tail reader growth timer', () => {
    it('cancels the pending growth check when the stream is asked to read again', async () => {
        await writeFile(filePath, 'abc');
        const handles = captureGrowthTimerHandles();
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
        const source = await openRecordingSource(0);
        const chunks: Buffer[] = [];
        source.reader.readable.on('data', chunk => chunks.push(chunk));
        await vi.waitFor(() => expect(handles).toHaveLength(1));
        expect(Buffer.concat(chunks).toString()).toBe('abc');

        source.reader.readable._read(16);

        expect(clearTimeoutSpy).toHaveBeenCalledWith(handles[0]);
        await vi.waitFor(() => expect(handles).toHaveLength(2));
        await source.reader.close();
    });

    it('cancels the pending growth check when the stream is destroyed', async () => {
        await writeFile(filePath, 'abc');
        const handles = captureGrowthTimerHandles();
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
        const source = await openRecordingSource(0);
        source.reader.readable.on('data', () => undefined);
        await vi.waitFor(() => expect(handles).toHaveLength(1));

        await source.reader.close();

        expect(source.reader.readable.destroyed).toBe(true);
        expect(clearTimeoutSpy).toHaveBeenCalledWith(handles[0]);
    });
});

describe('[RC-10.2] recording-tail reader read length', () => {
    const readLengthRequested = async (
        requestedSize: number,
    ): Promise<{ length: number; offsetInFile: number; target: number }> => {
        // bit rate 16 and play position 2 start the reader at byte 4.
        await writeFile(filePath, 'abcdefghij');
        const source = await openRecordingSource(2);
        const original = source.reader.readable.file as { close(): Promise<void> };
        const read = vi.fn(async (_buffer: Buffer, _offset: number, length: number) => ({ bytesRead: length }));
        source.reader.readable.file = { close: async () => undefined, read, stat: vi.fn(async () => ({ size: 10 })) };

        source.reader.readable._read(requestedSize);
        // The stream asks for more once it has buffered the first chunk; only the first request is examined.
        await vi.waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(0));
        await source.reader.close();
        await original.close();

        const [buffer, target, length, offsetInFile] = read.mock.calls[0] as unknown as [
            Buffer,
            number,
            number,
            number,
        ];
        return { length: length ?? buffer.length, offsetInFile, target };
    };

    it('reads only the bytes that remain after the start offset when more are requested', async () => {
        await expect(readLengthRequested(100)).resolves.toEqual({ length: 6, offsetInFile: 4, target: 0 });
    });

    it('reads only the requested size when fewer bytes are requested than remain', async () => {
        await expect(readLengthRequested(3)).resolves.toEqual({ length: 3, offsetInFile: 4, target: 0 });
    });
});
