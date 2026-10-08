import 'reflect-metadata';

import { appendFile, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;

interface Reader {
    readonly readable: NodeJS.ReadableStream & { destroyed: boolean; closed: boolean };
    close(): Promise<void>;
}
interface Source {
    readonly kind: string;
    readonly reader: Reader;
}
type Provider = {
    open(
        videoFileId: number,
        expectedRecordedId: number,
        playPosition: number,
    ): Promise<{ adopt(): { status: string; source?: Source } }>;
};

const RecordedPlaybackSourceProvider = (
    require(join(snapshot, 'model/operator/recorded/RecordedPlaybackSourceProvider.js')) as {
        default: new (...args: any[]) => Provider;
    }
).default;

const fsPromises = require('node:fs/promises') as Record<string, unknown>;

// ESMのnamed importへ反映させるため、builtinの関数を差し替えて同期する。
const replaceFsFunction = (name: string, replacement: unknown): (() => void) => {
    const original = fsPromises[name];
    fsPromises[name] = replacement;
    syncBuiltinESMExports();
    return () => {
        fsPromises[name] = original;
        syncBuiltinESMExports();
    };
};

let directory: string;
let filePath: string;

beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'epgstation-playback-reader-'));
    filePath = join(directory, 'synthetic-recording.m2ts');
});

afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { force: true, recursive: true });
});

// 既定のreader factoryを使い、実fileを開く経路で再生sourceを作る。
const openSource = async (options: {
    isRecording: boolean;
    playPosition?: number;
    bitRate?: number;
}): Promise<Source> => {
    const videoFile = { id: 1, parentDirectoryName: 'synthetic-storage', recordedId: 7, type: 'ts' };
    const provider = new RecordedPlaybackSourceProvider(
        { findId: vi.fn(async () => videoFile) },
        { findId: vi.fn(async () => ({ id: 7, isRecording: options.isRecording })) },
        {
            getFullFilePathFromVideoFile: vi.fn(() => filePath),
            getInfo: vi.fn(async () => ({ bitRate: options.bitRate ?? 0, duration: 1, size: 1 })),
        },
    );
    const opened = await provider.open(1, 7, options.playPosition ?? 0);
    const adoption = opened.adopt();
    expect(adoption.status).toBe('adopted');
    return adoption.source as Source;
};

// 1000ms待ちのtimerだけを横取りし、test側から発火させる（実時間を待たない）。
const captureGrowthTimers = (): Array<() => void> => {
    const callbacks: Array<() => void> = [];
    const original = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
        handler: () => void,
        delay?: number,
        ...rest: unknown[]
    ) => {
        if (delay === 1000) {
            callbacks.push(handler);
            return {} as NodeJS.Timeout;
        }
        return (original as (...args: unknown[]) => NodeJS.Timeout)(handler, delay, ...rest);
    }) as unknown as typeof setTimeout);
    return callbacks;
};

const collect = (readable: NodeJS.ReadableStream) => {
    const chunks: Buffer[] = [];
    let ended = false;
    readable.on('data', chunk => chunks.push(chunk as Buffer));
    readable.on('end', () => {
        ended = true;
    });
    return {
        ended: () => ended,
        text: () => Buffer.concat(chunks).toString('utf8'),
    };
};

describe('[RC-10.2] recording-tail reader follows a growing file', () => {
    it('emits existing bytes from the byte offset, then newly appended bytes after the growth check, then ends when the file stops growing', async () => {
        await writeFile(filePath, 'abcdef');
        const timers = captureGrowthTimers();
        const source = await openSource({ bitRate: 16, isRecording: true, playPosition: 1.5 });
        expect(source.kind).toBe('recording-tail-reader');

        const sink = collect(source.reader.readable);
        await vi.waitFor(() => expect(sink.text()).toBe('def'));
        await vi.waitFor(() => expect(timers).toHaveLength(1));
        expect(sink.ended()).toBe(false);

        await appendFile(filePath, 'ghi');
        timers.shift()?.();
        await vi.waitFor(() => expect(sink.text()).toBe('defghi'));
        await vi.waitFor(() => expect(timers).toHaveLength(1));

        timers.shift()?.();
        await vi.waitFor(() => expect(sink.ended()).toBe(true));
        expect(sink.text()).toBe('defghi');
        await source.reader.close();
    });

    it('restarts from the head when the file shrank below the saved offset', async () => {
        await writeFile(filePath, 'abcdef');
        const timers = captureGrowthTimers();
        const source = await openSource({ isRecording: true });
        const sink = collect(source.reader.readable);
        await vi.waitFor(() => expect(sink.text()).toBe('abcdef'));
        await vi.waitFor(() => expect(timers).toHaveLength(1));

        await truncate(filePath, 0);
        await writeFile(filePath, 'xy');
        timers.shift()?.();

        await vi.waitFor(() => expect(sink.text()).toBe('abcdefxy'));
        await source.reader.close();
    });

    it('ignores a duplicate read request while a read is in flight and after the stream was destroyed', async () => {
        await writeFile(filePath, 'abc');
        const source = await openSource({ isRecording: true });
        const readable = source.reader.readable as unknown as {
            _read(size: number): void;
            destroyed: boolean;
            file: { close(): Promise<void> };
        };
        const original = readable.file;
        const stat = vi.fn(async () => ({ size: 3 }));
        const read = vi.fn(async () => ({ bytesRead: 0 }));
        const close = vi.fn(async () => undefined);
        Object.assign(readable, { file: { close, read, stat } });
        const timers = captureGrowthTimers();

        readable._read(16);
        readable._read(16);
        await vi.waitFor(() => expect(timers).toHaveLength(1));
        expect(stat).toHaveBeenCalledTimes(1);

        await source.reader.close();
        expect(readable.destroyed).toBe(true);
        readable._read(16);
        expect(stat).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
        await original.close();
    });

    it('stops without pushing when the stream is destroyed while stat or read is pending', async () => {
        await writeFile(filePath, 'abc');
        const source = await openSource({ isRecording: true });
        const readable = source.reader.readable as unknown as {
            _read(size: number): void;
            push: (chunk: unknown) => boolean;
        };
        const originalFile = (readable as unknown as { file: { close(): Promise<void> } }).file;
        const push = vi.spyOn(readable, 'push');
        let releaseStat: (value: { size: number }) => void = () => undefined;
        let releaseRead: (value: { bytesRead: number }) => void = () => undefined;
        const fake = {
            close: vi.fn(async () => undefined),
            read: vi.fn(
                () =>
                    new Promise<{ bytesRead: number }>(resolve => {
                        releaseRead = resolve;
                    }),
            ),
            stat: vi.fn(
                () =>
                    new Promise<{ size: number }>(resolve => {
                        releaseStat = resolve;
                    }),
            ),
        };
        Object.assign(readable, { file: fake });

        readable._read(16);
        await source.reader.close();
        releaseStat({ size: 3 });
        await vi.waitFor(() => expect((readable as unknown as { readInProgress: boolean }).readInProgress).toBe(false));
        expect(fake.read).not.toHaveBeenCalled();
        expect(push).not.toHaveBeenCalled();

        // read待ちの間に破棄された場合も何もpushしない。
        const second = await openSource({ isRecording: true });
        const secondReadable = second.reader.readable as unknown as {
            _read(size: number): void;
            push: (chunk: unknown) => boolean;
        };
        const secondPush = vi.spyOn(secondReadable, 'push');
        const secondOriginalFile = (secondReadable as unknown as { file: { close(): Promise<void> } }).file;
        Object.assign(secondReadable, { file: fake });
        secondReadable._read(16);
        await vi.waitFor(() => expect(fake.stat).toHaveBeenCalledTimes(2));
        releaseStat({ size: 3 });
        await vi.waitFor(() => expect(fake.read).toHaveBeenCalledTimes(1));
        await second.reader.close();
        releaseRead({ bytesRead: 3 });
        await vi.waitFor(() =>
            expect((secondReadable as unknown as { readInProgress: boolean }).readInProgress).toBe(false),
        );
        expect(secondPush).not.toHaveBeenCalled();
        await originalFile.close();
        await secondOriginalFile.close();
    });

    it('destroys the stream with the read error when the offset is out of range', async () => {
        await writeFile(filePath, 'abc');
        const source = await openSource({ bitRate: 8, isRecording: true, playPosition: -3 });
        const errors: Error[] = [];
        source.reader.readable.on('error', error => errors.push(error));
        source.reader.readable.resume();

        await vi.waitFor(() => expect(errors).toHaveLength(1));
        expect(source.reader.readable.destroyed).toBe(true);
        await source.reader.close();
    });

    it('destroys the stream with the stat error raised by the growth check, and ignores a growth check after destruction', async () => {
        await writeFile(filePath, 'abc');
        const timers = captureGrowthTimers();
        const source = await openSource({ isRecording: true });
        const readable = source.reader.readable as unknown as { file: Record<string, unknown> };
        const original = readable.file as { close(): Promise<void> };
        const sink = collect(source.reader.readable);
        const errors: Error[] = [];
        source.reader.readable.on('error', error => errors.push(error));
        await vi.waitFor(() => expect(sink.text()).toBe('abc'));
        await vi.waitFor(() => expect(timers).toHaveLength(1));

        const failure = new Error('synthetic-stat-failure');
        readable.file = { close: async () => undefined, stat: vi.fn(async () => Promise.reject(failure)) };
        timers.shift()?.();
        await vi.waitFor(() => expect(errors).toEqual([failure]));
        expect(source.reader.readable.destroyed).toBe(true);
        await source.reader.close();
        await original.close();
    });

    it('does not read or end the stream when it was destroyed while the growth check was running', async () => {
        await writeFile(filePath, 'abc');
        const timers = captureGrowthTimers();
        const source = await openSource({ isRecording: true });
        const readable = source.reader.readable as unknown as { file: Record<string, unknown> };
        const original = readable.file as { close(): Promise<void> };
        const sink = collect(source.reader.readable);
        await vi.waitFor(() => expect(sink.text()).toBe('abc'));
        await vi.waitFor(() => expect(timers).toHaveLength(1));

        // 1回目のstatだけ保留にする。破棄の検査が無ければ、解放後に差分ありとして読み込みへ進む。
        let releaseStat: (value: { size: number }) => void = () => undefined;
        const stat = vi
            .fn<() => Promise<{ size: number }>>()
            .mockImplementationOnce(
                () =>
                    new Promise<{ size: number }>(resolve => {
                        releaseStat = resolve;
                    }),
            )
            .mockImplementation(async () => ({ size: 99 }));
        const read = vi.fn(async () => ({ bytesRead: 0 }));
        readable.file = { close: async () => undefined, read, stat };
        timers.shift()?.();
        await vi.waitFor(() => expect(stat).toHaveBeenCalledTimes(1));
        await source.reader.close();
        releaseStat({ size: 99 });
        await new Promise<void>(resolve => setImmediate(resolve));
        await new Promise<void>(resolve => setImmediate(resolve));

        expect(stat).toHaveBeenCalledTimes(1);
        expect(read).not.toHaveBeenCalled();
        expect(sink.ended()).toBe(false);
        await original.close();
    });

    it('reports the close error when destroying the stream and the file handle fails to close', async () => {
        await writeFile(filePath, 'abc');
        const source = await openSource({ isRecording: true });
        const readable = source.reader.readable as unknown as {
            file: Record<string, unknown>;
            destroy(error?: Error): void;
        };
        const original = readable.file as { close(): Promise<void> };
        const closeFailure = new Error('synthetic-close-failure');
        const errors: Error[] = [];
        source.reader.readable.on('error', error => errors.push(error));
        readable.file = { close: async () => Promise.reject(closeFailure) };

        readable.destroy();
        await vi.waitFor(() => expect(errors).toEqual([closeFailure]));
        await original.close();
    });

    it('keeps the original error when the file handle also fails to close', async () => {
        await writeFile(filePath, 'abc');
        const source = await openSource({ isRecording: true });
        const readable = source.reader.readable as unknown as {
            file: Record<string, unknown>;
            destroy(error?: Error): void;
        };
        const original = readable.file as { close(): Promise<void> };
        const originalError = new Error('synthetic-original-failure');
        const errors: Error[] = [];
        source.reader.readable.on('error', error => errors.push(error));
        readable.file = { close: async () => Promise.reject(new Error('synthetic-close-failure')) };

        readable.destroy(originalError);
        await vi.waitFor(() => expect(errors).toEqual([originalError]));
        await original.close();
    });
});

describe('[RC-10.2] completed-file reader', () => {
    it('streams the file from the byte offset and close resolves once and is shared', async () => {
        await writeFile(filePath, 'abcdef');
        const source = await openSource({ bitRate: 16, isRecording: false, playPosition: 1 });
        expect(source.kind).toBe('completed-file-reader');
        const sink = collect(source.reader.readable);

        await new Promise<void>(resolve => source.reader.readable.once('close', () => resolve()));
        expect(sink.ended()).toBe(true);
        expect(sink.text()).toBe('cdef');
        expect(source.reader.readable.closed).toBe(true);

        const first = source.reader.close();
        const second = source.reader.close();
        expect(second).toBe(first);
        await first;
        expect(source.reader.readable.closed).toBe(true);
    });

    it('streams the whole file when the probe reports no bit rate and the play position is 0', async () => {
        await writeFile(filePath, 'abcdef');
        const source = await openSource({ bitRate: Number.NaN, isRecording: false, playPosition: 0 });
        expect(source.kind).toBe('completed-file-reader');
        const sink = collect(source.reader.readable);

        await new Promise<void>(resolve => source.reader.readable.once('close', () => resolve()));

        expect(sink.ended()).toBe(true);
        expect(sink.text()).toBe('abcdef');
    });

    it('reports an unavailable start position instead of an internal stream error when the probe reports no bit rate and the play position is past the head', async () => {
        await writeFile(filePath, 'abcdef');

        await expect(openSource({ bitRate: Number.NaN, isRecording: false, playPosition: 1 })).rejects.toThrow(
            'RecordedPlaybackStartPositionUnavailable',
        );
    });

    it('destroys an unfinished stream on close and waits for its close event', async () => {
        await writeFile(filePath, 'x'.repeat(200000));
        const source = await openSource({ isRecording: false });
        expect(source.reader.readable.closed).toBe(false);

        await source.reader.close();

        expect(source.reader.readable.destroyed).toBe(true);
        expect(source.reader.readable.closed).toBe(true);
    });

    it('closes the opened file handle and rethrows the original error when the read stream cannot be created', async () => {
        const failure = new Error('synthetic-stream-failure');
        const close = vi.fn(async () => undefined);
        const restore = replaceFsFunction(
            'open',
            vi.fn(async () => ({
                close,
                createReadStream: () => {
                    throw failure;
                },
            })),
        );
        try {
            const provider = new RecordedPlaybackSourceProvider(
                { findId: vi.fn(async () => ({ id: 1, parentDirectoryName: 'd', recordedId: 7, type: 'ts' })) },
                { findId: vi.fn(async () => ({ id: 7, isRecording: false })) },
                {
                    getFullFilePathFromVideoFile: vi.fn(() => filePath),
                    getInfo: vi.fn(async () => ({ bitRate: 8, duration: 1, size: 1 })),
                },
            );

            await expect(provider.open(1, 7, 1)).rejects.toBe(failure);
        } finally {
            restore();
        }

        expect(close).toHaveBeenCalledTimes(1);
    });

    it('rethrows the original error when the opened file handle also fails to close after the read stream cannot be created', async () => {
        const failure = new Error('synthetic-stream-failure');
        const close = vi.fn(async () => {
            throw new TypeError('synthetic-close-failure');
        });
        const restore = replaceFsFunction(
            'open',
            vi.fn(async () => ({
                close,
                createReadStream: () => {
                    throw failure;
                },
            })),
        );
        try {
            const provider = new RecordedPlaybackSourceProvider(
                { findId: vi.fn(async () => ({ id: 1, parentDirectoryName: 'd', recordedId: 7, type: 'ts' })) },
                { findId: vi.fn(async () => ({ id: 7, isRecording: false })) },
                {
                    getFullFilePathFromVideoFile: vi.fn(() => filePath),
                    getInfo: vi.fn(async () => ({ bitRate: 8, duration: 1, size: 1 })),
                },
            );

            await expect(provider.open(1, 7, 1)).rejects.toBe(failure);
        } finally {
            restore();
        }

        expect(close).toHaveBeenCalledTimes(1);
    });
});
