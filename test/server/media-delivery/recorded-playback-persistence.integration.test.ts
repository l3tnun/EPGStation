import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRepositoryPersistence, type RepositoryPersistence } from '../persistence/repository-harness';
import { compiled } from './_media-harness';

/*
 * media-delivery の録画済み配信の test は、録画・ビデオファイルの DB を `vi.fn` の偽物（findId が固定の行を返す）で置く。
 * ここでは、本物の sqlite（本物の RecordedDB・VideoFileDB）に行を入れ、本物の RecordedPlaybackSourceProvider が
 * 偽物のときと同じ採用結果（種別・path・録画 ID）と同じ失敗の理由を返すことを確かめる。
 */

const RecordedPlaybackSourceProvider = compiled<any>(
    'model',
    'operator',
    'recorded',
    'RecordedPlaybackSourceProvider.js',
).default;

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const setup = async () => {
    const persistence: RepositoryPersistence = await createRepositoryPersistence('sqlite');
    cleanups.push(() => persistence.cleanup());
    const dir = mkdtempSync(join(tmpdir(), 'epg-playback-persistence-'));
    cleanups.push(() => rmSync(dir, { force: true, recursive: true }));
    const completedPath = join(dir, 'synthetic-completed.bin');
    const recordingPath = join(dir, 'synthetic-recording.bin');
    const encodedPath = join(dir, 'synthetic-encoded.bin');
    writeFileSync(completedPath, 'synthetic-completed-content');
    writeFileSync(recordingPath, 'synthetic-recording-content');
    writeFileSync(encodedPath, 'synthetic-encoded-content');
    const paths = new Map([
        ['synthetic-completed.bin', completedPath],
        ['synthetic-recording.bin', recordingPath],
        ['synthetic-encoded.bin', encodedPath],
    ]);

    const addRecorded = (isRecording: boolean, programId: number): Promise<number> =>
        persistence.db.RecordedDB.insertOnce(
            Object.assign(new persistence.entities.Recorded(), {
                channelId: 101,
                duration: 60_000,
                endAt: 1_700_000_060_000,
                halfWidthName: 'playback boundary',
                isProtected: false,
                isRecording,
                name: 'playback boundary',
                programId,
                startAt: 1_700_000_000_000,
            }),
        );
    const addVideoFile = (videoFile: Record<string, unknown>, recordedId: number): Promise<number> =>
        persistence.db.VideoFileDB.insertOnce(
            Object.assign(new persistence.entities.VideoFile(), {
                name: 'playback',
                parentDirectoryName: 'main',
                recordedId,
                size: 1,
                ...videoFile,
            }),
        );
    const videoUtil = {
        getFullFilePathFromVideoFile: vi.fn((videoFile: { filePath: string }) => paths.get(videoFile.filePath) ?? null),
        getInfo: vi.fn(async () => ({ bitRate: 8, duration: 10, size: 10 })),
    };
    const provider = new RecordedPlaybackSourceProvider(
        persistence.db.VideoFileDB,
        persistence.db.RecordedDB,
        videoUtil,
    );
    return { addRecorded, addVideoFile, completedPath, encodedPath, provider, recordingPath };
};

describe('recorded playback source provider on real sqlite rows', () => {
    it('[MD-DOUBLE-PARITY-RECORDED] adopts a completed file and a recording file with the kind, path, and recorded ID the doubles assume', async () => {
        const { addRecorded, addVideoFile, completedPath, provider, recordingPath } = await setup();
        const completedRecordedId = await addRecorded(false, 1);
        const completedVideoFileId = await addVideoFile(
            { filePath: 'synthetic-completed.bin', type: 'ts' },
            completedRecordedId,
        );
        const recordingRecordedId = await addRecorded(true, 2);
        const recordingVideoFileId = await addVideoFile(
            { filePath: 'synthetic-recording.bin', type: 'ts' },
            recordingRecordedId,
        );

        const completedSource = await provider.open(completedVideoFileId, completedRecordedId, 0);
        const recordingSource = await provider.open(recordingVideoFileId, recordingRecordedId, 0);
        try {
            expect(completedSource.source).toMatchObject({
                inputPath: completedPath,
                kind: 'completed-file-reader',
                recordedId: completedRecordedId,
                videoFileId: completedVideoFileId,
            });
            expect(recordingSource.source).toMatchObject({
                inputPath: recordingPath,
                kind: 'recording-tail-reader',
                recordedId: recordingRecordedId,
                videoFileId: recordingVideoFileId,
            });
        } finally {
            await completedSource.release?.();
            await recordingSource.release?.();
        }
    });

    it('[MD-DOUBLE-PARITY-RECORDED] opens an encoded file directly without a reader, and keeps the failure reasons for a missing or mismatched row', async () => {
        const { addRecorded, addVideoFile, encodedPath, provider } = await setup();
        const recordedId = await addRecorded(false, 3);
        const videoFileId = await addVideoFile({ filePath: 'synthetic-encoded.bin', type: 'encoded' }, recordedId);

        const direct = await provider.open(videoFileId, recordedId, 0.5);
        try {
            expect(direct.source).toMatchObject({
                inputPath: encodedPath,
                kind: 'encoded-direct',
                playPosition: 0.5,
                recordedId,
            });
        } finally {
            await direct.release?.();
        }
        await expect(provider.open(videoFileId + 100, recordedId, 0)).rejects.toThrow(
            'RecordedPlaybackVideoFileNotFound',
        );
        await expect(provider.open(videoFileId, recordedId + 100, 0)).rejects.toThrow(
            'RecordedPlaybackRecordedIdMismatch',
        );
        await expect(provider.resolveRecordedId(videoFileId)).resolves.toBe(recordedId);
    });
});
