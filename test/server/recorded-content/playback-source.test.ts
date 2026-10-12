import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { Container } from 'inversify';
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
                adopt():
                    | { readonly status: 'adopted'; readonly source: Record<string, unknown> }
                    | { readonly status: 'stale' };
                disposeBeforeAdoption(): Promise<void>;
            }>;
        };
    }
).default;

const reader = () => ({ close: vi.fn(async () => undefined), readable: new PassThrough() });

describe('recorded playback source handoff implementation', () => {
    it('can be constructed through its three recorded-content dependencies without binding a test-only reader factory', async () => {
        const container = new Container();
        container.bind('IVideoFileDB').toConstantValue({ findId: vi.fn(async () => ({ recordedId: 79 })) });
        container.bind('IRecordedDB').toConstantValue({ findId: vi.fn() });
        container.bind('IVideoUtil').toConstantValue({ getFullFilePathFromVideoFile: vi.fn(), getInfo: vi.fn() });
        container.bind('IRecordedPlaybackSourceProvider').to(RecordedPlaybackSourceProvider);

        const provider = container.get<any>('IRecordedPlaybackSourceProvider');

        await expect(provider.resolveRecordedId(204)).resolves.toBe(79);
    });

    it('selects the recording-tail and completed-file readers with the byte offset derived from play position', async () => {
        const videoFile = {
            filePath: 'recording.ts',
            id: 202,
            parentDirectoryName: 'synthetic-storage',
            recordedId: 77,
            type: 'ts',
        };
        const recordedDB = { findId: vi.fn() };
        const tailReader = reader();
        const completedReader = reader();
        const readerFactory = {
            openCompletedFile: vi.fn(async () => completedReader),
            openRecordingTail: vi.fn(async () => tailReader),
        };
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => videoFile) },
            recordedDB,
            {
                getFullFilePathFromVideoFile: vi.fn(() => 'synthetic-root/recording.ts'),
                getInfo: vi.fn(async () => ({ bitRate: 80, duration: 120, size: 240 })),
            },
            readerFactory,
        );

        recordedDB.findId.mockResolvedValueOnce({ id: 77, isRecording: true });
        const tail = await provider.open(202, 77, 2.9);
        recordedDB.findId.mockResolvedValueOnce({ id: 77, isRecording: false });
        const completed = await provider.open(202, 77, 2.9);

        expect(readerFactory.openRecordingTail).toHaveBeenCalledWith('synthetic-root/recording.ts', 29);
        expect(readerFactory.openCompletedFile).toHaveBeenCalledWith('synthetic-root/recording.ts', 29);
        expect(tail.adopt()).toEqual({
            source: expect.objectContaining({
                kind: 'recording-tail-reader',
                playPosition: 2.9,
                reader: tailReader,
            }),
            status: 'adopted',
        });
        expect(completed.adopt()).toEqual({
            source: expect.objectContaining({
                kind: 'completed-file-reader',
                playPosition: 2.9,
                reader: completedReader,
            }),
            status: 'adopted',
        });
    });

    it('opens the recording-tail and completed-file readers from the head when the probe reports no bit rate and the play position is 0', async () => {
        const videoFile = {
            filePath: 'recording.ts',
            id: 203,
            parentDirectoryName: 'synthetic-storage',
            recordedId: 78,
            type: 'ts',
        };
        const recordedDB = { findId: vi.fn() };
        const tailReader = reader();
        const completedReader = reader();
        const readerFactory = {
            openCompletedFile: vi.fn(async () => completedReader),
            openRecordingTail: vi.fn(async () => tailReader),
        };
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => videoFile) },
            recordedDB,
            {
                getFullFilePathFromVideoFile: vi.fn(() => 'synthetic-root/recording.ts'),
                getInfo: vi.fn(async () => ({ bitRate: Number.NaN, duration: Number.NaN, size: 240 })),
            },
            readerFactory,
        );

        recordedDB.findId.mockResolvedValueOnce({ id: 78, isRecording: true });
        const tail = await provider.open(203, 78, 0);
        recordedDB.findId.mockResolvedValueOnce({ id: 78, isRecording: false });
        const completed = await provider.open(203, 78, 0);

        expect(readerFactory.openRecordingTail).toHaveBeenCalledWith('synthetic-root/recording.ts', 0);
        expect(readerFactory.openCompletedFile).toHaveBeenCalledWith('synthetic-root/recording.ts', 0);
        expect(tail.adopt()).toEqual({
            source: expect.objectContaining({ kind: 'recording-tail-reader', playPosition: 0, reader: tailReader }),
            status: 'adopted',
        });
        expect(completed.adopt()).toEqual({
            source: expect.objectContaining({
                kind: 'completed-file-reader',
                playPosition: 0,
                reader: completedReader,
            }),
            status: 'adopted',
        });
    });

    it('fails without opening a reader when the probe reports no bit rate and the play position is past the head', async () => {
        const recordedDB = { findId: vi.fn(async () => ({ id: 78, isRecording: false })) };
        const readerFactory = { openCompletedFile: vi.fn(), openRecordingTail: vi.fn() };
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => ({ id: 203, recordedId: 78, type: 'ts' })) },
            recordedDB,
            {
                getFullFilePathFromVideoFile: vi.fn(() => 'synthetic-root/recording.ts'),
                getInfo: vi.fn(async () => ({ bitRate: Number.NaN, duration: 120, size: 240 })),
            },
            readerFactory,
        );

        await expect(provider.open(203, 78, 2.9)).rejects.toThrow('RecordedPlaybackStartPositionUnavailable');

        expect(readerFactory.openCompletedFile).not.toHaveBeenCalled();
        expect(readerFactory.openRecordingTail).not.toHaveBeenCalled();
    });

    it('disposes a pending encoded-direct source without creating or closing a reader', async () => {
        const readerFactory = { openCompletedFile: vi.fn(), openRecordingTail: vi.fn() };
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => ({ id: 205, recordedId: 80, type: 'encoded' })) },
            { findId: vi.fn(async () => ({ id: 80, isRecording: false })) },
            {
                getFullFilePathFromVideoFile: vi.fn(() => 'synthetic-root/encoded.m2ts'),
                getInfo: vi.fn(async () => ({ bitRate: 80, duration: 120, size: 240 })),
            },
            readerFactory,
        );

        const opened = await provider.open(205, 80, 0);
        await opened.disposeBeforeAdoption();

        expect(opened.state).toBe('disposed');
        expect(opened.adopt()).toEqual({ status: 'stale' });
        expect(readerFactory.openCompletedFile).not.toHaveBeenCalled();
        expect(readerFactory.openRecordingTail).not.toHaveBeenCalled();
    });

    it('lets the first adopt or dispose operation own the reader and closes an unadopted reader at most once', async () => {
        const videoFile = {
            filePath: 'recording.ts',
            id: 203,
            parentDirectoryName: 'synthetic-storage',
            recordedId: 78,
            type: 'ts',
        };
        const pendingReader = reader();
        const adoptedReader = reader();
        const readerFactory = {
            openCompletedFile: vi.fn(async () => pendingReader),
            openRecordingTail: vi.fn().mockResolvedValueOnce(pendingReader).mockResolvedValueOnce(adoptedReader),
        };
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => videoFile) },
            { findId: vi.fn(async () => ({ id: 78, isRecording: true })) },
            {
                getFullFilePathFromVideoFile: vi.fn(() => 'synthetic-root/recording.ts'),
                getInfo: vi.fn(async () => ({ bitRate: 8, duration: 120, size: 240 })),
            },
            readerFactory,
        );

        const disposedFirst = await provider.open(203, 78, 0);
        const dispose = disposedFirst.disposeBeforeAdoption();
        expect(disposedFirst.state).toBe('disposed');
        expect(disposedFirst.adopt()).toEqual({ status: 'stale' });
        await dispose;
        await disposedFirst.disposeBeforeAdoption();

        expect(pendingReader.close).toHaveBeenCalledOnce();
        expect(disposedFirst.adopt()).toEqual({ status: 'stale' });

        const adoptedFirst = await provider.open(203, 78, 0);
        expect(adoptedFirst.adopt()).toMatchObject({ status: 'adopted' });
        expect(adoptedFirst.state).toBe('adopted');
        await adoptedFirst.disposeBeforeAdoption();

        expect(adoptedReader.close).not.toHaveBeenCalled();
        expect(adoptedFirst.adopt()).toEqual({ status: 'stale' });
    });

    it('joins concurrent pre-adoption disposal until the owned reader has finished closing', async () => {
        let finishClose!: () => void;
        const closing = new Promise<void>(resolve => {
            finishClose = resolve;
        });
        const pendingReader = {
            close: vi.fn(() => closing),
            readable: new PassThrough(),
        };
        const provider = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async () => ({ id: 206, recordedId: 81, type: 'ts' })) },
            { findId: vi.fn(async () => ({ id: 81, isRecording: true })) },
            {
                getFullFilePathFromVideoFile: vi.fn(() => 'synthetic-root/recording.ts'),
                getInfo: vi.fn(async () => ({ bitRate: 8, duration: 120, size: 240 })),
            },
            {
                openCompletedFile: vi.fn(),
                openRecordingTail: vi.fn(async () => pendingReader),
            },
        );

        const opened = await provider.open(206, 81, 0);
        const firstDispose = opened.disposeBeforeAdoption();
        const secondDispose = opened.disposeBeforeAdoption();
        let firstSettled = false;
        let secondSettled = false;
        void firstDispose.then(() => {
            firstSettled = true;
        });
        void secondDispose.then(() => {
            secondSettled = true;
        });

        await Promise.resolve();

        expect(pendingReader.close).toHaveBeenCalledOnce();
        expect(opened.adopt()).toEqual({ status: 'stale' });
        expect(firstSettled).toBe(false);
        expect(secondSettled).toBe(false);

        finishClose();
        await Promise.all([firstDispose, secondDispose]);

        expect(firstSettled).toBe(true);
        expect(secondSettled).toBe(true);
    });
});
