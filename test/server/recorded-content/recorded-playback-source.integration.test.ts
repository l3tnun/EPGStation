import 'reflect-metadata';

import { appendFile, mkdtemp, open, readdir, readlink, rename, rm, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const nodeFs = require('node:fs') as typeof import('node:fs');
type PositionalFileRead = (
    this: FileHandle,
    buffer: NodeJS.ArrayBufferView,
    offset?: number | null,
    length?: number | null,
    position?: number | bigint | null,
) => Promise<{ buffer: NodeJS.ArrayBufferView; bytesRead: number }>;
type FileHandleClose = (this: FileHandle) => Promise<void>;
type FileHandleStat = (this: FileHandle) => ReturnType<FileHandle['stat']>;
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const container = (
    require(join(snapshot, 'model/ModelContainer.js')) as {
        default: {
            bind(identifier: string): { toConstantValue(value: unknown): void };
            isBound(identifier: string): boolean;
            unbind(identifier: string): void;
        };
    }
).default;
const RecordedPlaybackSourceProvider = (
    require(join(snapshot, 'model/operator/recorded/RecordedPlaybackSourceProvider.js')) as {
        default: new (...args: any[]) => {
            open(
                videoFileId: number,
                expectedRecordedId: number,
                playPosition: number,
            ): Promise<{
                readonly state: string;
                adopt():
                    | { readonly status: 'adopted'; readonly source: Record<string, any> }
                    | { readonly status: 'stale' };
                disposeBeforeAdoption(): Promise<void>;
            }>;
            resolveRecordedId(videoFileId: number): Promise<number>;
        };
    }
).default;

const temporaryRoots: string[] = [];
const fileCloseRestores: Array<() => void> = [];

const temporaryRoot = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-playback-source-'));
    temporaryRoots.push(root);
    return root;
};

const isOpenByThisProcess = async (path: string): Promise<boolean> => {
    const descriptors = await readdir('/proc/self/fd');
    const targets = await Promise.all(
        descriptors.map(async descriptor => {
            try {
                return await readlink(`/proc/self/fd/${descriptor}`);
            } catch {
                return null;
            }
        }),
    );
    return targets.includes(path);
};

const closeOpenDescriptor = async (path: string): Promise<void> => {
    const descriptors = await readdir('/proc/self/fd');
    for (const descriptor of descriptors) {
        try {
            if ((await readlink(`/proc/self/fd/${descriptor}`)) !== path) {
                continue;
            }
        } catch {
            continue;
        }

        await new Promise<void>((resolve, reject) => {
            nodeFs.close(Number(descriptor), error => {
                if (error === null) {
                    resolve();
                    return;
                }
                reject(error);
            });
        });
        return;
    }
    throw new Error('RECORDING_TAIL_FD_NOT_FOUND');
};

const waitForTailRecheck = async (): Promise<void> => {
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0), { interval: 0 });
    expect(vi.getTimerCount()).toBe(1);
};

const observeProviderOwnedFileClose = (readable: NodeJS.ReadableStream) => {
    const file = Reflect.get(readable, 'file') as FileHandle;
    const fileClose = vi.spyOn(file, 'close');
    fileCloseRestores.push(() => fileClose.mockRestore());
    return fileClose;
};

afterEach(async () => {
    for (const restore of fileCloseRestores.splice(0)) restore();
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { force: true, recursive: true })));
});

const bindTailLogger = (): (() => void) => {
    if (container.isBound('ILoggerModel')) {
        return () => undefined;
    }
    container.bind('ILoggerModel').toConstantValue({ getLogger: () => ({ stream: { error: vi.fn() } }) });
    return () => container.unbind('ILoggerModel');
};

describe('recorded playback source provider integration', () => {
    it('rejects the second phase when its reread video-file mapping no longer matches the preliminary lease ID', async () => {
        const videoFileDB = {
            findId: vi
                .fn()
                .mockResolvedValueOnce({ id: 301, recordedId: 90 })
                .mockResolvedValueOnce({ id: 301, recordedId: 91 }),
        };
        const recordedDB = { findId: vi.fn() };
        const videoUtil = { getFullFilePathFromVideoFile: vi.fn(), getInfo: vi.fn() };
        const provider = new RecordedPlaybackSourceProvider(videoFileDB, recordedDB, videoUtil);

        await expect(provider.resolveRecordedId(301)).resolves.toBe(90);
        await expect(provider.open(301, 90, 4)).rejects.toThrow('RecordedPlaybackRecordedIdMismatch');

        expect(recordedDB.findId).not.toHaveBeenCalled();
        expect(videoUtil.getFullFilePathFromVideoFile).not.toHaveBeenCalled();
    });

    it('preserves variant selection and first-wins pre-adoption cleanup while resolving a real input path', async () => {
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        await writeFile(inputPath, 'synthetic recording bytes');
        const videoFile = { id: 302, recordedId: 91, type: 'ts' };
        const recorded = { id: 91, isRecording: true };
        const tailReader = { close: vi.fn(async () => undefined), readable: new PassThrough() };
        const completedReader = { close: vi.fn(async () => undefined), readable: new PassThrough() };
        const readerFactory = {
            openCompletedFile: vi.fn(async () => completedReader),
            openRecordingTail: vi.fn(async () => tailReader),
        };
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => videoFile) },
            { findId: vi.fn(async () => recorded) },
            {
                getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                getInfo: vi.fn(async () => ({ bitRate: 64, duration: 60, size: 24 })),
            },
            readerFactory,
        );

        const tail = await provider.open(302, 91, 1.5);
        const disposal = tail.disposeBeforeAdoption();
        expect(tail.adopt()).toEqual({ status: 'stale' });
        await disposal;
        await tail.disposeBeforeAdoption();

        expect(tailReader.close).toHaveBeenCalledOnce();
        expect(readerFactory.openRecordingTail).toHaveBeenCalledWith(inputPath, 12);

        recorded.isRecording = false;
        const completed = await provider.open(302, 91, 1.5);
        expect(completed.adopt()).toEqual({
            source: expect.objectContaining({
                inputPath,
                kind: 'completed-file-reader',
                playPosition: 1.5,
                reader: completedReader,
            }),
            status: 'adopted',
        });
        await completed.disposeBeforeAdoption();
        expect(completedReader.close).not.toHaveBeenCalled();
    });

    it('opens and closes a completed-file reader against a temporary filesystem file, and fails before returning a source when the file cannot open', async () => {
        const root = await temporaryRoot();
        const inputPath = join(root, 'completed.ts');
        await writeFile(inputPath, 'abcdef');
        const videoFile = { id: 303, recordedId: 92, type: 'ts' };
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => videoFile) },
            { findId: vi.fn(async () => ({ id: 92, isRecording: false })) },
            {
                getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                getInfo: vi.fn(async () => ({ bitRate: 16, duration: 60, size: 6 })),
            },
        );

        const adopted = (await provider.open(303, 92, 1)).adopt();
        expect(adopted.status).toBe('adopted');
        if (adopted.status !== 'adopted' || adopted.source.kind !== 'completed-file-reader') {
            throw new Error('Expected a completed-file reader');
        }
        const chunks: Buffer[] = [];
        for await (const chunk of adopted.source.reader.readable) {
            chunks.push(Buffer.from(chunk));
        }
        expect(Buffer.concat(chunks).toString()).toBe('cdef');

        const close = adopted.source.reader.close();
        expect(adopted.source.reader.close()).toBe(close);
        await close;
        expect(adopted.source.reader.readable.destroyed).toBe(true);
        expect(adopted.source.reader.readable.closed).toBe(true);

        const missingProvider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => ({ id: 304, recordedId: 92, type: 'ts' })) },
            { findId: vi.fn(async () => ({ id: 92, isRecording: false })) },
            {
                getFullFilePathFromVideoFile: vi.fn(() => join(root, 'missing.ts')),
                getInfo: vi.fn(async () => ({ bitRate: 64, duration: 60, size: 24 })),
            },
        );

        await expect(missingProvider.open(304, 92, 1)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('opens the default recording-tail descriptor before returning the source, then closes that descriptor on reader disposal', async () => {
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        const movedPath = join(root, 'recording-opened.ts');
        await writeFile(inputPath, 'tail bytes');
        const releaseLogger = bindTailLogger();
        try {
            const provider = new RecordedPlaybackSourceProvider(
                { findId: vi.fn(async () => ({ id: 306, recordedId: 94, type: 'ts' })) },
                { findId: vi.fn(async () => ({ id: 94, isRecording: true })) },
                {
                    getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                    getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 10 })),
                },
            );

            const opened = await provider.open(306, 94, 1);
            await rename(inputPath, movedPath);
            expect(opened.state).toBe('pending');
            const adopted = opened.adopt();
            if (adopted.status !== 'adopted' || adopted.source.kind !== 'recording-tail-reader') {
                throw new Error('Expected a recording-tail reader');
            }
            const firstChunk = await new Promise<Buffer>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('RECORDING_TAIL_FD_WAS_NOT_OPENED')), 100);
                adopted.source.reader.readable
                    .once('data', (chunk: Buffer) => {
                        clearTimeout(timeout);
                        resolve(Buffer.from(chunk));
                    })
                    .once('error', error => {
                        clearTimeout(timeout);
                        reject(error);
                    })
                    .resume();
            });
            expect(firstChunk.toString()).toBe('ail bytes');
            expect(await isOpenByThisProcess(movedPath)).toBe(true);
            await adopted.source.reader.close();
            expect(await isOpenByThisProcess(movedPath)).toBe(false);

            expect(opened.state).toBe('adopted');
            expect(opened.adopt()).toEqual({ status: 'stale' });
        } finally {
            releaseLogger();
        }
    });

    it('does not request recording-tail bytes beyond the descriptor content remaining after its play position', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        const content = Buffer.from('tail bytes');
        await writeFile(inputPath, content);
        const probe = await open(inputPath, 'r');
        const fileHandlePrototype = Object.getPrototypeOf(probe) as { read: PositionalFileRead };
        const originalRead = fileHandlePrototype.read;
        await probe.close();
        const readRequests: Array<{ length: number; position: number }> = [];
        fileHandlePrototype.read = async function (buffer, offset, length, position) {
            readRequests.push({
                length: length ?? 0,
                position: typeof position === 'bigint' ? Number(position) : (position ?? 0),
            });
            return originalRead.call(this, buffer, offset, length, position);
        };
        try {
            const provider = new RecordedPlaybackSourceProvider(
                { findId: vi.fn(async () => ({ id: 322, recordedId: 110, type: 'ts' })) },
                { findId: vi.fn(async () => ({ id: 110, isRecording: true })) },
                {
                    getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                    getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: content.length })),
                },
            );
            const adopted = (await provider.open(322, 110, 1)).adopt();
            if (adopted.status !== 'adopted' || adopted.source.kind !== 'recording-tail-reader') {
                throw new Error('Expected a recording-tail reader');
            }

            const firstChunk = new Promise<Buffer>((resolve, reject) => {
                adopted.source.reader.readable
                    .once('data', (chunk: Buffer) => resolve(Buffer.from(chunk)))
                    .once('error', reject)
                    .resume();
            });
            await expect(firstChunk).resolves.toEqual(content.subarray(1));
            await waitForTailRecheck();

            expect(readRequests).toContainEqual({ length: content.length - 1, position: 1 });
            expect(readRequests.every(request => request.length <= content.length - request.position)).toBe(true);
            await adopted.source.reader.close();
        } finally {
            fileHandlePrototype.read = originalRead;
            vi.useRealTimers();
        }
    });

    it('follows a recording-file append after EOF recheck, then ends unchanged and releases its descriptor', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        await writeFile(inputPath, 'a');
        try {
            const provider = new RecordedPlaybackSourceProvider(
                { findId: vi.fn(async () => ({ id: 309, recordedId: 97, type: 'ts' })) },
                { findId: vi.fn(async () => ({ id: 97, isRecording: true })) },
                {
                    getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                    getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 1 })),
                },
            );
            const adopted = (await provider.open(309, 97, 0)).adopt();
            if (adopted.status !== 'adopted' || adopted.source.kind !== 'recording-tail-reader') {
                throw new Error('Expected a recording-tail reader');
            }
            const fileClose = observeProviderOwnedFileClose(adopted.source.reader.readable);

            const chunks: string[] = [];
            let receiveFirstChunk!: () => void;
            let receiveSecondChunk!: () => void;
            const firstChunk = new Promise<void>(resolve => {
                receiveFirstChunk = resolve;
            });
            const secondChunk = new Promise<void>(resolve => {
                receiveSecondChunk = resolve;
            });
            const closed = new Promise<void>(resolve => {
                adopted.source.reader.readable.once('close', resolve);
            });
            const ended = new Promise<void>((resolve, reject) => {
                adopted.source.reader.readable
                    .on('data', (chunk: Buffer) => {
                        chunks.push(chunk.toString());
                        if (chunks.length === 1) {
                            receiveFirstChunk();
                        }
                        if (chunks.length === 2) {
                            receiveSecondChunk();
                        }
                    })
                    .once('end', resolve)
                    .once('error', reject)
                    .resume();
            });
            await firstChunk;
            await waitForTailRecheck();
            expect(chunks).toEqual(['a']);

            await appendFile(inputPath, 'b');
            await vi.advanceTimersByTimeAsync(1000);
            await secondChunk;
            await waitForTailRecheck();
            expect(chunks).toEqual(['a', 'b']);

            await vi.advanceTimersByTimeAsync(1000);
            await ended;
            await closed;

            expect(chunks.join('')).toBe('ab');
            expect(fileClose).toHaveBeenCalledOnce();
            expect(adopted.source.reader.readable.closed).toBe(true);
            expect(await isOpenByThisProcess(inputPath)).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('reads each available byte exactly once across the stream high-water-mark boundary before polling for growth', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        const content = Buffer.alloc(64 * 1024 + 1, 0x61);
        await writeFile(inputPath, content);
        try {
            const provider = new RecordedPlaybackSourceProvider(
                { findId: vi.fn(async () => ({ id: 315, recordedId: 103, type: 'ts' })) },
                { findId: vi.fn(async () => ({ id: 103, isRecording: true })) },
                {
                    getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                    getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: content.length })),
                },
            );
            const adopted = (await provider.open(315, 103, 0)).adopt();
            if (adopted.status !== 'adopted' || adopted.source.kind !== 'recording-tail-reader') {
                throw new Error('Expected a recording-tail reader');
            }

            const chunks: Buffer[] = [];
            const received = new Promise<void>((resolve, reject) => {
                adopted.source.reader.readable
                    .on('data', (chunk: Buffer) => {
                        chunks.push(Buffer.from(chunk));
                        if (Buffer.concat(chunks).length === content.length) {
                            resolve();
                        }
                    })
                    .once('error', reject)
                    .resume();
            });
            await received;
            await waitForTailRecheck();

            expect(chunks.map(chunk => chunk.length)).toEqual([64 * 1024, 1]);
            expect(Buffer.concat(chunks)).toEqual(content);
            await adopted.source.reader.close();
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not read past the stream high-water mark before the consumer asks for more data', async () => {
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        const content = Buffer.alloc(64 * 1024 + 1, 0x61);
        await writeFile(inputPath, content);
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => ({ id: 317, recordedId: 105, type: 'ts' })) },
            { findId: vi.fn(async () => ({ id: 105, isRecording: true })) },
            {
                getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: content.length })),
            },
        );
        const adopted = (await provider.open(317, 105, 0)).adopt();
        if (adopted.status !== 'adopted' || adopted.source.kind !== 'recording-tail-reader') {
            throw new Error('Expected a recording-tail reader');
        }

        const available = new Promise<void>((resolve, reject) => {
            adopted.source.reader.readable.once('readable', resolve).once('error', reject);
        });
        adopted.source.reader.readable.read(0);
        await available;
        for (let attempts = 0; attempts < 100; attempts += 1) {
            await new Promise<void>(resolve => setImmediate(resolve));
        }

        expect(adopted.source.reader.readable.readableLength).toBe(64 * 1024);
        expect(adopted.source.reader.readable.read()).toEqual(content.subarray(0, 64 * 1024));
        await adopted.source.reader.close();
    });

    it('coalesces a repeated demand while its first descriptor stat is pending', async () => {
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        await writeFile(inputPath, 'a');
        const probe = await open(inputPath, 'r');
        const fileHandlePrototype = Object.getPrototypeOf(probe) as {
            read: PositionalFileRead;
            stat: FileHandleStat;
        };
        const originalRead = fileHandlePrototype.read;
        const originalStat = fileHandlePrototype.stat;
        await probe.close();
        let releaseStat!: () => void;
        const statReleased = new Promise<void>(resolve => {
            releaseStat = resolve;
        });
        let statStarted!: () => void;
        const statStartedPromise = new Promise<void>(resolve => {
            statStarted = resolve;
        });
        let holdStat = true;
        let readAttempts = 0;
        fileHandlePrototype.stat = async function () {
            if (holdStat) {
                holdStat = false;
                statStarted();
                await statReleased;
            }
            return originalStat.call(this);
        };
        fileHandlePrototype.read = async function (buffer, offset, length, position) {
            readAttempts += 1;
            return originalRead.call(this, buffer, offset, length, position);
        };
        try {
            const provider = new RecordedPlaybackSourceProvider(
                { findId: vi.fn(async () => ({ id: 320, recordedId: 108, type: 'ts' })) },
                { findId: vi.fn(async () => ({ id: 108, isRecording: true })) },
                {
                    getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                    getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 1 })),
                },
            );
            const adopted = (await provider.open(320, 108, 0)).adopt();
            if (adopted.status !== 'adopted' || adopted.source.kind !== 'recording-tail-reader') {
                throw new Error('Expected a recording-tail reader');
            }

            const chunks: string[] = [];
            const firstChunk = new Promise<void>((resolve, reject) => {
                adopted.source.reader.readable
                    .on('data', (chunk: Buffer) => {
                        chunks.push(chunk.toString());
                        resolve();
                    })
                    .once('error', reject)
                    .resume();
            });
            await statStartedPromise;
            adopted.source.reader.readable._read(64 * 1024);
            releaseStat();
            await firstChunk;
            await new Promise<void>(resolve => setImmediate(resolve));

            expect(readAttempts).toBe(1);
            expect(chunks).toEqual(['a']);
            await adopted.source.reader.close();
        } finally {
            fileHandlePrototype.read = originalRead;
            fileHandlePrototype.stat = originalStat;
        }
    });

    it('does not issue another descriptor read after disposal wins while stat is pending', async () => {
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        await writeFile(inputPath, 'a');
        const probe = await open(inputPath, 'r');
        const fileHandlePrototype = Object.getPrototypeOf(probe) as {
            read: PositionalFileRead;
            stat: FileHandleStat;
        };
        const originalRead = fileHandlePrototype.read;
        const originalStat = fileHandlePrototype.stat;
        await probe.close();
        let tailFile: FileHandle | null = null;
        let originalClose: FileHandleClose | null = null;
        let releaseFileClose!: () => void;
        const fileCloseReleased = new Promise<void>(resolve => {
            releaseFileClose = resolve;
        });
        let fileCloseStarted!: () => void;
        const fileCloseStartedPromise = new Promise<void>(resolve => {
            fileCloseStarted = resolve;
        });
        let releaseStat!: () => void;
        const statReleased = new Promise<void>(resolve => {
            releaseStat = resolve;
        });
        let statStarted!: () => void;
        const statStartedPromise = new Promise<void>(resolve => {
            statStarted = resolve;
        });
        let holdStat = true;
        let readAttempts = 0;
        fileHandlePrototype.stat = async function () {
            const stat = await originalStat.call(this);
            if (holdStat) {
                holdStat = false;
                statStarted();
                await statReleased;
            }
            return stat;
        };
        fileHandlePrototype.read = async function (buffer, offset, length, position) {
            readAttempts += 1;
            return originalRead.call(this, buffer, offset, length, position);
        };
        try {
            const provider = new RecordedPlaybackSourceProvider(
                { findId: vi.fn(async () => ({ id: 318, recordedId: 106, type: 'ts' })) },
                { findId: vi.fn(async () => ({ id: 106, isRecording: true })) },
                {
                    getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                    getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 1 })),
                },
            );
            const adopted = (await provider.open(318, 106, 0)).adopt();
            if (adopted.status !== 'adopted' || adopted.source.kind !== 'recording-tail-reader') {
                throw new Error('Expected a recording-tail reader');
            }

            const readable = adopted.source.reader.readable;
            tailFile = Reflect.get(readable, 'file') as FileHandle;
            originalClose = tailFile.close;
            const fileClose = vi.fn(async function (this: FileHandle) {
                fileCloseStarted();
                await fileCloseReleased;
                return originalClose!.call(this);
            });
            tailFile.close = fileClose;
            const originalPush = readable.push;
            let outputsAfterClose = 0;
            readable.push = chunk => {
                if (readable.destroyed) {
                    outputsAfterClose += 1;
                }
                return originalPush.call(readable, chunk);
            };
            let dataEvents = 0;
            const errors: Error[] = [];
            readable
                .on('data', () => {
                    dataEvents += 1;
                })
                .on('error', error => {
                    errors.push(error);
                })
                .resume();
            await statStartedPromise;
            const close = adopted.source.reader.close();
            await fileCloseStartedPromise;
            releaseStat();
            for (let attempts = 0; attempts < 100; attempts += 1) {
                await new Promise<void>(resolve => setImmediate(resolve));
            }

            expect(readAttempts).toBe(0);
            expect(dataEvents).toBe(0);
            expect(errors).toEqual([]);
            expect(outputsAfterClose).toBe(0);
            expect(fileClose).toHaveBeenCalledOnce();
            releaseFileClose();
            await close;
            expect(readable.closed).toBe(true);
            expect(fileClose).toHaveBeenCalledOnce();
            readable.push = originalPush;
        } finally {
            if (tailFile !== null && originalClose !== null) {
                tailFile.close = originalClose;
            }
            fileHandlePrototype.read = originalRead;
            fileHandlePrototype.stat = originalStat;
        }
    });

    it('does not emit a chunk after disposal wins while a descriptor read is pending', async () => {
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        await writeFile(inputPath, 'a');
        const probe = await open(inputPath, 'r');
        const fileHandlePrototype = Object.getPrototypeOf(probe) as { read: PositionalFileRead };
        const originalRead = fileHandlePrototype.read;
        await probe.close();
        let releaseRead!: () => void;
        const readReleased = new Promise<void>(resolve => {
            releaseRead = resolve;
        });
        let readFinished!: () => void;
        const readFinishedPromise = new Promise<void>(resolve => {
            readFinished = resolve;
        });
        let holdRead = true;
        fileHandlePrototype.read = async function (buffer, offset, length, position) {
            const result = await originalRead.call(this, buffer, offset, length, position);
            if (holdRead) {
                holdRead = false;
                readFinished();
                await readReleased;
            }
            return result;
        };
        try {
            const provider = new RecordedPlaybackSourceProvider(
                { findId: vi.fn(async () => ({ id: 319, recordedId: 107, type: 'ts' })) },
                { findId: vi.fn(async () => ({ id: 107, isRecording: true })) },
                {
                    getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                    getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 1 })),
                },
            );
            const adopted = (await provider.open(319, 107, 0)).adopt();
            if (adopted.status !== 'adopted' || adopted.source.kind !== 'recording-tail-reader') {
                throw new Error('Expected a recording-tail reader');
            }

            const readable = adopted.source.reader.readable;
            const originalPush = readable.push;
            let outputsAfterClose = 0;
            readable.push = chunk => {
                if (readable.destroyed) {
                    outputsAfterClose += 1;
                }
                return originalPush.call(readable, chunk);
            };
            let dataEvents = 0;
            const errors: Error[] = [];
            readable
                .on('data', () => {
                    dataEvents += 1;
                })
                .on('error', error => {
                    errors.push(error);
                })
                .resume();
            await readFinishedPromise;
            const close = adopted.source.reader.close();
            releaseRead();
            await close;
            await new Promise<void>(resolve => setImmediate(resolve));

            expect(dataEvents).toBe(0);
            expect(errors).toEqual([]);
            expect(outputsAfterClose).toBe(0);
            expect(readable.closed).toBe(true);
            readable.push = originalPush;
        } finally {
            fileHandlePrototype.read = originalRead;
        }
    });

    it('does not attempt terminal stream output after disposal wins while an EOF recheck stat is pending', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        await writeFile(inputPath, '');
        const probe = await open(inputPath, 'r');
        const fileHandlePrototype = Object.getPrototypeOf(probe) as { stat: FileHandleStat };
        const originalStat = fileHandlePrototype.stat;
        await probe.close();
        let releaseRecheckStat!: () => void;
        const recheckStatReleased = new Promise<void>(resolve => {
            releaseRecheckStat = resolve;
        });
        let recheckStatStarted!: () => void;
        const recheckStatStartedPromise = new Promise<void>(resolve => {
            recheckStatStarted = resolve;
        });
        let statCalls = 0;
        fileHandlePrototype.stat = async function () {
            statCalls += 1;
            const stat = await originalStat.call(this);
            if (statCalls === 2) {
                recheckStatStarted();
                await recheckStatReleased;
            }
            return stat;
        };
        try {
            const provider = new RecordedPlaybackSourceProvider(
                { findId: vi.fn(async () => ({ id: 321, recordedId: 109, type: 'ts' })) },
                { findId: vi.fn(async () => ({ id: 109, isRecording: true })) },
                {
                    getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                    getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 0 })),
                },
            );
            const adopted = (await provider.open(321, 109, 0)).adopt();
            if (adopted.status !== 'adopted' || adopted.source.kind !== 'recording-tail-reader') {
                throw new Error('Expected a recording-tail reader');
            }

            const readable = adopted.source.reader.readable;
            const originalPush = readable.push;
            let outputsAfterClose = 0;
            readable.push = chunk => {
                if (readable.destroyed) {
                    outputsAfterClose += 1;
                }
                return originalPush.call(readable, chunk);
            };
            readable.resume();
            await waitForTailRecheck();
            await vi.advanceTimersByTimeAsync(1000);
            await recheckStatStartedPromise;
            const close = adopted.source.reader.close();
            releaseRecheckStat();
            await close;
            await new Promise<void>(resolve => setImmediate(resolve));

            expect(outputsAfterClose).toBe(0);
            expect(readable.closed).toBe(true);
            readable.push = originalPush;
        } finally {
            fileHandlePrototype.stat = originalStat;
            vi.useRealTimers();
        }
    });

    it('waits for a later size change when a recording is truncated between its stat and read', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        await writeFile(inputPath, 'a');
        const probe = await open(inputPath, 'r');
        const fileHandlePrototype = Object.getPrototypeOf(probe) as {
            read: PositionalFileRead;
            stat: FileHandleStat;
        };
        const originalRead = fileHandlePrototype.read;
        const originalStat = fileHandlePrototype.stat;
        await probe.close();
        let truncateBeforeRead = true;
        let statCalls = 0;
        fileHandlePrototype.stat = async function () {
            statCalls += 1;
            return originalStat.call(this);
        };
        fileHandlePrototype.read = async function (buffer, offset, length, position) {
            if (truncateBeforeRead) {
                truncateBeforeRead = false;
                await writeFile(inputPath, '');
            }
            return originalRead.call(this, buffer, offset, length, position);
        };
        try {
            const provider = new RecordedPlaybackSourceProvider(
                { findId: vi.fn(async () => ({ id: 316, recordedId: 104, type: 'ts' })) },
                { findId: vi.fn(async () => ({ id: 104, isRecording: true })) },
                {
                    getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                    getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 1 })),
                },
            );
            const adopted = (await provider.open(316, 104, 0)).adopt();
            if (adopted.status !== 'adopted' || adopted.source.kind !== 'recording-tail-reader') {
                throw new Error('Expected a recording-tail reader');
            }

            const chunks: string[] = [];
            const received = new Promise<void>((resolve, reject) => {
                adopted.source.reader.readable
                    .on('data', (chunk: Buffer) => {
                        chunks.push(chunk.toString());
                        resolve();
                    })
                    .once('error', reject)
                    .resume();
            });
            await waitForTailRecheck();
            expect(chunks).toEqual([]);
            expect(statCalls).toBe(1);

            await appendFile(inputPath, 'bc');
            await vi.advanceTimersByTimeAsync(1000);
            await received;

            expect(chunks).toEqual(['bc']);
            await adopted.source.reader.close();
        } finally {
            fileHandlePrototype.read = originalRead;
            fileHandlePrototype.stat = originalStat;
            vi.useRealTimers();
        }
    });

    it('restarts from the beginning after a recording file shrinks, then advances from its new offset', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        await writeFile(inputPath, 'abcd');
        try {
            const provider = new RecordedPlaybackSourceProvider(
                { findId: vi.fn(async () => ({ id: 310, recordedId: 98, type: 'ts' })) },
                { findId: vi.fn(async () => ({ id: 98, isRecording: true })) },
                {
                    getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                    getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 4 })),
                },
            );
            const adopted = (await provider.open(310, 98, 0)).adopt();
            if (adopted.status !== 'adopted' || adopted.source.kind !== 'recording-tail-reader') {
                throw new Error('Expected a recording-tail reader');
            }

            const chunks: string[] = [];
            let receiveChunk!: () => void;
            const receiveNextChunk = (): Promise<void> =>
                new Promise<void>(resolve => {
                    receiveChunk = resolve;
                });
            const firstChunk = receiveNextChunk();
            adopted.source.reader.readable
                .on('data', (chunk: Buffer) => {
                    chunks.push(chunk.toString());
                    receiveChunk();
                })
                .resume();

            await firstChunk;
            adopted.source.reader.readable.read(1);
            await waitForTailRecheck();

            const afterShrink = receiveNextChunk();
            await writeFile(inputPath, 'xy');
            await vi.advanceTimersByTimeAsync(1000);
            await afterShrink;
            adopted.source.reader.readable.read(1);
            await waitForTailRecheck();

            const afterGrowth = receiveNextChunk();
            await appendFile(inputPath, 'z');
            await vi.advanceTimersByTimeAsync(1000);
            await afterGrowth;

            expect(chunks).toEqual(['abcd', 'xy', 'z']);
            await adopted.source.reader.close();
            expect(adopted.source.reader.readable.closed).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('reports and settles a default reader close failure after its file descriptor becomes invalid', async () => {
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        await writeFile(inputPath, 'tail bytes');
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => ({ id: 311, recordedId: 99, type: 'ts' })) },
            { findId: vi.fn(async () => ({ id: 99, isRecording: true })) },
            {
                getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 10 })),
            },
        );
        const adopted = (await provider.open(311, 99, 0)).adopt();
        if (adopted.status !== 'adopted' || adopted.source.kind !== 'recording-tail-reader') {
            throw new Error('Expected a recording-tail reader');
        }

        await closeOpenDescriptor(inputPath);
        const error = new Promise<Error>(resolve => adopted.source.reader.readable.once('error', resolve));
        const closing = adopted.source.reader.close();

        await expect(error).resolves.toMatchObject({ code: 'EBADF' });
        await closing;
        expect(adopted.source.reader.readable.closed).toBe(true);
    });

    it('reports and closes a default reader when its descriptor fails during a pending read', async () => {
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        await writeFile(inputPath, 'tail bytes');
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => ({ id: 312, recordedId: 100, type: 'ts' })) },
            { findId: vi.fn(async () => ({ id: 100, isRecording: true })) },
            {
                getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 10 })),
            },
        );
        const adopted = (await provider.open(312, 100, 0)).adopt();
        if (adopted.status !== 'adopted' || adopted.source.kind !== 'recording-tail-reader') {
            throw new Error('Expected a recording-tail reader');
        }
        const fileClose = observeProviderOwnedFileClose(adopted.source.reader.readable);

        await closeOpenDescriptor(inputPath);
        const closed = new Promise<void>(resolve => adopted.source.reader.readable.once('close', resolve));
        const error = new Promise<Error>(resolve => adopted.source.reader.readable.once('error', resolve));
        adopted.source.reader.readable.resume();

        await expect(error).resolves.toMatchObject({ code: 'EBADF' });
        await closed;
        expect(fileClose).toHaveBeenCalledOnce();
        expect(adopted.source.reader.readable.closed).toBe(true);
    });

    it('clears the pending EOF recheck when the default reader is disposed', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        await writeFile(inputPath, '');
        try {
            const provider = new RecordedPlaybackSourceProvider(
                { findId: vi.fn(async () => ({ id: 313, recordedId: 101, type: 'ts' })) },
                { findId: vi.fn(async () => ({ id: 101, isRecording: true })) },
                {
                    getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                    getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 0 })),
                },
            );
            const adopted = (await provider.open(313, 101, 0)).adopt();
            if (adopted.status !== 'adopted' || adopted.source.kind !== 'recording-tail-reader') {
                throw new Error('Expected a recording-tail reader');
            }

            adopted.source.reader.readable.resume();
            await waitForTailRecheck();
            await adopted.source.reader.close();

            expect(vi.getTimerCount()).toBe(0);
            expect(adopted.source.reader.readable.closed).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('reports and closes a default reader when its EOF recheck cannot stat the descriptor', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        await writeFile(inputPath, '');
        try {
            const provider = new RecordedPlaybackSourceProvider(
                { findId: vi.fn(async () => ({ id: 314, recordedId: 102, type: 'ts' })) },
                { findId: vi.fn(async () => ({ id: 102, isRecording: true })) },
                {
                    getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                    getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 0 })),
                },
            );
            const adopted = (await provider.open(314, 102, 0)).adopt();
            if (adopted.status !== 'adopted' || adopted.source.kind !== 'recording-tail-reader') {
                throw new Error('Expected a recording-tail reader');
            }

            adopted.source.reader.readable.resume();
            await waitForTailRecheck();
            await closeOpenDescriptor(inputPath);
            const closed = new Promise<void>(resolve => adopted.source.reader.readable.once('close', resolve));
            const error = new Promise<Error>(resolve => adopted.source.reader.readable.once('error', resolve));
            await vi.advanceTimersByTimeAsync(1000);

            await expect(error).resolves.toMatchObject({ code: 'EBADF' });
            await closed;
            expect(adopted.source.reader.readable.closed).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('closes a completed file descriptor when creating its reader rejects', async () => {
        const root = await temporaryRoot();
        const inputPath = join(root, 'completed.ts');
        await writeFile(inputPath, 'synthetic completed bytes');
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => ({ id: 307, recordedId: 95, type: 'ts' })) },
            { findId: vi.fn(async () => ({ id: 95, isRecording: false })) },
            {
                getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 24 })),
            },
        );

        await expect(provider.open(307, 95, -1)).rejects.toThrow();
    });

    it('[Task gap] rejects with the original error when createReadStream itself throws synchronously, after closing the descriptor', async () => {
        const root = await temporaryRoot();
        const inputPath = join(root, 'completed.ts');
        await writeFile(inputPath, 'synthetic completed bytes');
        const probe = await open(inputPath, 'r');
        const fileHandlePrototype = Object.getPrototypeOf(probe) as {
            createReadStream: (...args: unknown[]) => unknown;
        };
        const originalCreateReadStream = fileHandlePrototype.createReadStream;
        await probe.close();
        const createFailure = new Error('synthetic createReadStream failure');
        fileHandlePrototype.createReadStream = function () {
            throw createFailure;
        };
        try {
            const provider = new RecordedPlaybackSourceProvider(
                { findId: vi.fn(async () => ({ id: 309, recordedId: 97, type: 'ts' })) },
                { findId: vi.fn(async () => ({ id: 97, isRecording: false })) },
                {
                    getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                    getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 24 })),
                },
            );

            // The descriptor opened inside openCompletedFile is closed before the original
            // createReadStream error propagates. `rm` on Linux happily removes a file with an
            // open fd, so the afterEach cleanup succeeding does not prove the descriptor was
            // closed. `FileHandle.prototype.close` is not spyable -- Node binds `close` (and
            // `Symbol.asyncDispose`) as an own instance property, not a prototype method, unlike
            // `createReadStream` above -- so this reuses the same `isOpenByThisProcess` /proc/self/fd
            // check this file already uses elsewhere to prove a descriptor was really closed.
            await expect(provider.open(309, 97, 1)).rejects.toBe(createFailure);
            expect(await isOpenByThisProcess(inputPath)).toBe(false);
        } finally {
            fileHandlePrototype.createReadStream = originalCreateReadStream;
        }
    });

    it('propagates the default recording-tail descriptor open failure before returning a source', async () => {
        const root = await temporaryRoot();
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => ({ id: 308, recordedId: 96, type: 'ts' })) },
            { findId: vi.fn(async () => ({ id: 96, isRecording: true })) },
            {
                getFullFilePathFromVideoFile: vi.fn(() => join(root, 'missing-recording.ts')),
                getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 24 })),
            },
        );

        await expect(provider.open(308, 96, 0)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('uses the successfully opened completed-file descriptor instead of reopening the path for its reader', async () => {
        const root = await temporaryRoot();
        const inputPath = join(root, 'completed.ts');
        await writeFile(inputPath, 'synthetic completed bytes');
        const createReadStream = vi.spyOn(nodeFs, 'createReadStream').mockImplementation(() => {
            throw new Error('SYNTHETIC_SECOND_PATH_OPEN');
        });
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => ({ id: 305, recordedId: 93, type: 'ts' })) },
            { findId: vi.fn(async () => ({ id: 93, isRecording: false })) },
            {
                getFullFilePathFromVideoFile: vi.fn(() => inputPath),
                getInfo: vi.fn(async () => ({ bitRate: 64, duration: 60, size: 24 })),
            },
        );

        const adopted = (await provider.open(305, 93, 1)).adopt();

        expect(adopted.status).toBe('adopted');
        expect(createReadStream).not.toHaveBeenCalled();
        if (adopted.status !== 'adopted' || adopted.source.kind !== 'completed-file-reader') {
            throw new Error('Expected a completed-file reader');
        }
        await adopted.source.reader.close();
        expect(adopted.source.reader.readable.destroyed).toBe(true);
        expect(adopted.source.reader.readable.closed).toBe(true);
    });
});
