import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RecordedPlaybackSourceProvider = (
    require(join(snapshot, 'model/operator/recorded/RecordedPlaybackSourceProvider.js')) as {
        default: new (...args: any[]) => {
            open(
                videoFileId: number,
                expectedRecordedId: number,
                playPosition: number,
            ): Promise<{
                readonly state: string;
                disposeBeforeAdoption(): Promise<void>;
                adopt():
                    | { readonly status: 'adopted'; readonly source: Record<string, unknown> }
                    | { readonly status: 'stale' };
            }>;
            resolveRecordedId(videoFileId: number): Promise<number>;
        };
    }
).default;

describe('recorded playback source contract', () => {
    it('resolves a preliminary recorded ID, then rereads the same mapping for an encoded source', async () => {
        const videoFile = {
            filePath: 'synthetic-recording.m2ts',
            id: 101,
            parentDirectoryName: 'synthetic-storage',
            recordedId: 55,
            type: 'encoded',
        };
        const videoFileDB = { findId: vi.fn(async () => videoFile) };
        const recordedDB = { findId: vi.fn(async () => ({ id: 55, isRecording: false })) };
        const videoUtil = {
            getFullFilePathFromVideoFile: vi.fn(() => 'synthetic-root/synthetic-recording.m2ts'),
            getInfo: vi.fn(async () => ({ bitRate: 16, duration: 120, size: 240 })),
        };
        const readerFactory = { openCompletedFile: vi.fn(), openRecordingTail: vi.fn() };
        const provider = new RecordedPlaybackSourceProvider(videoFileDB, recordedDB, videoUtil, readerFactory);

        await expect(provider.resolveRecordedId(101)).resolves.toBe(55);
        expect(recordedDB.findId).not.toHaveBeenCalled();

        const opened = await provider.open(101, 55, 12.5);

        expect(videoFileDB.findId).toHaveBeenCalledTimes(2);
        expect(videoFileDB.findId).toHaveBeenNthCalledWith(1, 101);
        expect(videoFileDB.findId).toHaveBeenNthCalledWith(2, 101);
        expect(recordedDB.findId).toHaveBeenCalledWith(55);
        expect(videoUtil.getFullFilePathFromVideoFile).toHaveBeenCalledWith(videoFile);
        expect(videoUtil.getInfo).toHaveBeenCalledWith('synthetic-root/synthetic-recording.m2ts');
        expect(readerFactory.openCompletedFile).not.toHaveBeenCalled();
        expect(readerFactory.openRecordingTail).not.toHaveBeenCalled();
        expect(opened.state).toBe('pending');
        expect(opened.adopt()).toEqual({
            source: {
                inputPath: 'synthetic-root/synthetic-recording.m2ts',
                kind: 'encoded-direct',
                playPosition: 12.5,
                recordedId: 55,
                videoFileId: 101,
                videoInfo: { bitRate: 16, duration: 120, size: 240 },
            },
            status: 'adopted',
        });
    });

    it('rejects opening when the video-file mapping changed after the preliminary lease lookup', async () => {
        const videoFileDB = {
            findId: vi
                .fn()
                .mockResolvedValueOnce({ id: 102, recordedId: 55 })
                .mockResolvedValueOnce({ id: 102, recordedId: 56 }),
        };
        const recordedDB = { findId: vi.fn() };
        const videoUtil = { getFullFilePathFromVideoFile: vi.fn(), getInfo: vi.fn() };
        const provider = new RecordedPlaybackSourceProvider(videoFileDB, recordedDB, videoUtil);

        await expect(provider.resolveRecordedId(102)).resolves.toBe(55);
        await expect(provider.open(102, 55, 0)).rejects.toThrow('RecordedPlaybackRecordedIdMismatch');

        expect(recordedDB.findId).not.toHaveBeenCalled();
        expect(videoUtil.getFullFilePathFromVideoFile).not.toHaveBeenCalled();
        expect(videoUtil.getInfo).not.toHaveBeenCalled();
    });

    it('rejects a missing video file instead of returning a source', async () => {
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => null) },
            { findId: vi.fn() },
            { getFullFilePathFromVideoFile: vi.fn(), getInfo: vi.fn() },
        );

        await expect(provider.resolveRecordedId(103)).rejects.toThrow('RecordedPlaybackVideoFileNotFound');
        await expect(provider.open(103, 55, 0)).rejects.toThrow('RecordedPlaybackVideoFileNotFound');
    });

    it('rejects an inconsistent recorded row ID before resolving a path or source', async () => {
        const videoUtil = { getFullFilePathFromVideoFile: vi.fn(), getInfo: vi.fn() };
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => ({ id: 108, recordedId: 55, type: 'encoded' })) },
            { findId: vi.fn(async () => ({ id: 56, isRecording: false })) },
            videoUtil,
        );

        await expect(provider.open(108, 55, 0)).rejects.toThrow('RecordedPlaybackRecordedIdMismatch');
        expect(videoUtil.getFullFilePathFromVideoFile).not.toHaveBeenCalled();
        expect(videoUtil.getInfo).not.toHaveBeenCalled();
    });

    it('rejects a disappeared recorded row instead of attaching a source to the preliminary lease', async () => {
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => ({ id: 104, recordedId: 55, type: 'encoded' })) },
            { findId: vi.fn(async () => null) },
            { getFullFilePathFromVideoFile: vi.fn(), getInfo: vi.fn() },
        );

        await expect(provider.open(104, 55, 0)).rejects.toThrow('RecordedPlaybackRecordedNotFound');
    });

    it('rejects a path-resolution failure instead of probing or returning a source', async () => {
        const videoUtil = { getFullFilePathFromVideoFile: vi.fn(() => null), getInfo: vi.fn() };
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => ({ id: 105, recordedId: 55, type: 'encoded' })) },
            { findId: vi.fn(async () => ({ id: 55, isRecording: false })) },
            videoUtil,
        );

        await expect(provider.open(105, 55, 0)).rejects.toThrow('RecordedPlaybackPathNotFound');
        expect(videoUtil.getInfo).not.toHaveBeenCalled();
    });

    it('propagates a video-information failure without returning a source', async () => {
        const probeFailure = new Error('SYNTHETIC_PROBE_FAILURE');
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => ({ id: 106, recordedId: 55, type: 'encoded' })) },
            { findId: vi.fn(async () => ({ id: 55, isRecording: false })) },
            {
                getFullFilePathFromVideoFile: vi.fn(() => 'synthetic-root/failed.ts'),
                getInfo: vi.fn(async () => {
                    throw probeFailure;
                }),
            },
        );

        await expect(provider.open(106, 55, 0)).rejects.toBe(probeFailure);
    });

    it('[RC-7.7] propagates a reader-open failure without returning a source', async () => {
        const readerFailure = new Error('SYNTHETIC_READER_OPEN_FAILURE');
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => ({ id: 107, recordedId: 55, type: 'ts' })) },
            { findId: vi.fn(async () => ({ id: 55, isRecording: false })) },
            {
                getFullFilePathFromVideoFile: vi.fn(() => 'synthetic-root/failed.ts'),
                getInfo: vi.fn(async () => ({ bitRate: 8, duration: 1, size: 1 })),
            },
            {
                openCompletedFile: vi.fn(async () => {
                    throw readerFailure;
                }),
                openRecordingTail: vi.fn(async () => ({ close: vi.fn(), readable: new PassThrough() })),
            },
        );

        await expect(provider.open(107, 55, 0)).rejects.toBe(readerFailure);
    });

    it('[RC-7.8] lets the first adopt or dispose operation own the reader and closes an unadopted reader at most once', async () => {
        const videoFile = {
            filePath: 'synthetic-recording.ts',
            id: 108,
            parentDirectoryName: 'synthetic-storage',
            recordedId: 56,
            type: 'ts',
        };
        const disposedReader = { close: vi.fn(async () => undefined), readable: new PassThrough() };
        const adoptedReader = { close: vi.fn(async () => undefined), readable: new PassThrough() };
        const readerFactory = {
            openCompletedFile: vi.fn(),
            openRecordingTail: vi.fn().mockResolvedValueOnce(disposedReader).mockResolvedValueOnce(adoptedReader),
        };
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => videoFile) },
            { findId: vi.fn(async () => ({ id: 56, isRecording: true })) },
            {
                getFullFilePathFromVideoFile: vi.fn(() => 'synthetic-root/synthetic-recording.ts'),
                getInfo: vi.fn(async () => ({ bitRate: 8, duration: 120, size: 240 })),
            },
            readerFactory,
        );

        const disposedFirst = await provider.open(108, 56, 0);
        await disposedFirst.disposeBeforeAdoption();
        await disposedFirst.disposeBeforeAdoption();

        expect(disposedFirst.adopt()).toEqual({ status: 'stale' });
        expect(disposedReader.close).toHaveBeenCalledOnce();

        const adoptedFirst = await provider.open(108, 56, 0);
        expect(adoptedFirst.adopt()).toMatchObject({ status: 'adopted' });
        await adoptedFirst.disposeBeforeAdoption();

        expect(adoptedReader.close).not.toHaveBeenCalled();
        expect(adoptedFirst.adopt()).toEqual({ status: 'stale' });
    });
});
