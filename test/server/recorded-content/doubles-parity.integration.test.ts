import 'reflect-metadata';

import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createSyntheticMedia, FFPROBE, runProcess } from '../harness/synthetic-media';
import {
    createRepositoryPersistence,
    loadCompiledDefault,
    type RepositoryPersistence,
} from '../persistence/repository-harness';

/*
 * 録画済みの配信の test は、録画済み・video file の DB model を `{ id, recordedId, type }` のような最小の値を返す
 * 偽物に、VideoUtil（path の解決と ffprobe）を固定の path と固定の情報を返す偽物にしている。同じ再生元の取得を、
 * 本物の better-sqlite3 の RecordedDB・VideoFileDB、本物の VideoUtil（保存先の設定と本物の ffprobe）、実 file で流し、
 * 偽物のときと同じ結果になることを確かめる。入力は本物の ffmpeg が lavfi で作る合成の動画。
 */

const RecordedPlaybackSourceProvider = loadCompiledDefault<any>(
    'model/operator/recorded/RecordedPlaybackSourceProvider.js',
);
const VideoUtil = loadCompiledDefault<any>('model/api/video/VideoUtil.js');

let root: string;
let storage: string;
let ffprobePath: string;
let persistence: RepositoryPersistence;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'epgstation-recorded-parity-'));
    storage = join(root, 'synthetic-storage');
    await runProcess('mkdir', ['-p', join(storage, 'synthetic-sub')]);
    await createSyntheticMedia(join(storage, 'synthetic-sub'), 'complete.ts', 'mpegts', 4);
    await createSyntheticMedia(join(storage, 'synthetic-sub'), 'encoded.mp4', 'mp4', 2);
    const complete = await readFile(join(storage, 'synthetic-sub', 'complete.ts'));
    // 録画の始まったばかりの TS（10 packet）。本物の ffprobe は duration も bit_rate も返さない。
    await writeFile(join(storage, 'synthetic-sub', 'head.ts'), complete.subarray(0, 1_880));
    ffprobePath = (await runProcess('sh', ['-c', `command -v ${FFPROBE}`])).stdout.trim();
    persistence = await createRepositoryPersistence('sqlite');
}, 120_000);

afterAll(async () => {
    await persistence?.cleanup();
    await rm(root, { force: true, recursive: true });
});

const recordedRow = (overrides: Record<string, unknown>) => ({
    reserveId: null,
    ruleId: null,
    programId: null,
    channelId: 10,
    isProtected: false,
    startAt: 1_000,
    endAt: 2_000,
    duration: 1_000,
    name: 'synthetic-recorded',
    halfWidthName: 'synthetic-recorded',
    isRecording: false,
    dropLogFileId: null,
    ...overrides,
});

const insertVideo = async (fileName: string, type: 'ts' | 'encoded', isRecording = false) => {
    const recordedId = Number(await persistence.db.RecordedDB.insertOnce(recordedRow({ isRecording })));
    const videoFileId = Number(
        await persistence.db.VideoFileDB.insertOnce({
            recordedId,
            parentDirectoryName: 'synthetic-storage',
            filePath: join('synthetic-sub', fileName),
            type,
            name: type === 'ts' ? 'TS' : 'H.264',
            size: (await stat(join(storage, 'synthetic-sub', fileName))).size,
        }),
    );
    return { recordedId, videoFileId };
};

const realVideoUtil = () =>
    new VideoUtil(
        { getConfig: () => ({ ffprobe: ffprobePath, recorded: [{ name: 'synthetic-storage', path: storage }] }) },
        persistence.db.VideoFileDB,
    );

const readAll = async (readable: Readable): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const chunk of readable) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
};

const outcome = async (provider: any, videoFileId: number, recordedId: number, playPosition: number) => {
    try {
        const opened = await provider.open(videoFileId, recordedId, playPosition);
        const adoption = opened.adopt();
        const source = adoption.source;
        const summary = {
            kind: source.kind,
            inputPath: source.inputPath,
            durationIsFinite: Number.isFinite(source.videoInfo.duration),
            bitRateIsFinite: Number.isFinite(source.videoInfo.bitRate),
            size: source.videoInfo.size,
        };
        try {
            const body = source.reader === undefined ? null : await readAll(source.reader.readable);
            return { ...summary, bodyLength: body?.length ?? null };
        } finally {
            await source.reader?.close();
        }
    } catch (error) {
        return { error: (error as Error).message };
    }
};

describe('recorded playback source doubles against real repositories, VideoUtil, and ffprobe', () => {
    it('[RC-DOUBLE-PARITY-PLAYBACK] opens completed, head-only, and encoded files from real rows the same way as from the minimal row doubles', async () => {
        const complete = await insertVideo('complete.ts', 'ts');
        const head = await insertVideo('head.ts', 'ts');
        const encoded = await insertVideo('encoded.mp4', 'encoded');
        const util = realVideoUtil();
        const real = new RecordedPlaybackSourceProvider(persistence.db.VideoFileDB, persistence.db.RecordedDB, util);

        // 偽物の DB は最小の値だけを返す（配信の test の形）。path と ffprobe は本物を使う。
        const rows = new Map<
            number,
            { id: number; recordedId: number; type: string; parentDirectoryName: string; filePath: string }
        >();
        for (const [entry, file, type] of [
            [complete, 'complete.ts', 'ts'],
            [head, 'head.ts', 'ts'],
            [encoded, 'encoded.mp4', 'encoded'],
        ] as const) {
            rows.set(entry.videoFileId, {
                id: entry.videoFileId,
                recordedId: entry.recordedId,
                type,
                parentDirectoryName: 'synthetic-storage',
                filePath: join('synthetic-sub', file),
            });
        }
        const doubled = new RecordedPlaybackSourceProvider(
            { findId: vi.fn(async (id: number) => rows.get(id) ?? null) },
            { findId: vi.fn(async (id: number) => ({ id, isRecording: false })) },
            util,
        );

        const completeSize = (await stat(join(storage, 'synthetic-sub', 'complete.ts'))).size;
        const cases = [
            [complete, 0],
            [complete, 1],
            [head, 0],
            [head, 1],
            [encoded, 1],
        ] as const;
        for (const [entry, playPosition] of cases) {
            const fromReal = await outcome(real, entry.videoFileId, entry.recordedId, playPosition);
            const fromDouble = await outcome(doubled, entry.videoFileId, entry.recordedId, playPosition);
            expect({ playPosition, fromDouble }).toEqual({ playPosition, fromDouble: fromReal });
        }

        await expect(outcome(real, complete.videoFileId, complete.recordedId, 0)).resolves.toEqual({
            kind: 'completed-file-reader',
            inputPath: join(storage, 'synthetic-sub', 'complete.ts'),
            durationIsFinite: true,
            bitRateIsFinite: true,
            size: completeSize,
            bodyLength: completeSize,
        });
        // 再生位置 1 秒は bit rate から概算した位置から読む。
        const fromOneSecond = await outcome(real, complete.videoFileId, complete.recordedId, 1);
        expect(fromOneSecond).toMatchObject({ kind: 'completed-file-reader' });
        expect((fromOneSecond as { bodyLength: number }).bodyLength).toBeLessThan(completeSize);
        // 本物の ffprobe が bit_rate を返さない録画の始まりでも、再生位置 0 は先頭から読む。0 より後は位置を出せない。
        await expect(outcome(real, head.videoFileId, head.recordedId, 0)).resolves.toMatchObject({
            kind: 'completed-file-reader',
            durationIsFinite: false,
            bitRateIsFinite: false,
            bodyLength: 1_880,
        });
        await expect(outcome(real, head.videoFileId, head.recordedId, 1)).resolves.toEqual({
            error: 'RecordedPlaybackStartPositionUnavailable',
        });
        await expect(outcome(real, encoded.videoFileId, encoded.recordedId, 1)).resolves.toMatchObject({
            kind: 'encoded-direct',
            bitRateIsFinite: true,
            bodyLength: null,
        });
        await expect(outcome(real, 404_404, 1, 0)).resolves.toEqual({ error: 'RecordedPlaybackVideoFileNotFound' });
    }, 120_000);

    it('[RC-DOUBLE-PARITY-PLAYBACK] follows a real recording file while it grows and ends after it stops growing', async () => {
        const growing = 'growing.ts';
        const source = await readFile(join(storage, 'synthetic-sub', 'complete.ts'));
        const chunkSize = 188 * 40;
        await writeFile(join(storage, 'synthetic-sub', growing), source.subarray(0, chunkSize));
        const entry = await insertVideo(growing, 'ts', true);
        const provider = new RecordedPlaybackSourceProvider(
            persistence.db.VideoFileDB,
            persistence.db.RecordedDB,
            realVideoUtil(),
        );

        const opened = await provider.open(entry.videoFileId, entry.recordedId, 0);
        const adoption = opened.adopt();
        const playback = adoption.source;
        try {
            expect(playback.kind).toBe('recording-tail-reader');
            const reading = readAll(playback.reader.readable);
            let written = chunkSize;
            for (let index = 1; index < 6; index++) {
                await new Promise(resolve => setTimeout(resolve, 300));
                const next = source.subarray(written, written + chunkSize);
                await appendFile(join(storage, 'synthetic-sub', growing), next);
                written += next.length;
            }
            const body = await reading;
            expect(body.equals(source.subarray(0, written))).toBe(true);
        } finally {
            await playback.reader.close();
        }
    }, 60_000);
});
