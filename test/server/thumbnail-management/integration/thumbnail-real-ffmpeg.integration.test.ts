import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createSyntheticMedia, FFMPEG, FFPROBE, runProcess } from '../../harness/synthetic-media';
import { cleanupHarness, makeModel, restoreSpawn, useRealSpawn } from '../imp/_thumbnail-harness';

/*
 * thumbnail の test は ffmpeg の代わりに node の script を起動する（`ffmpeg: process.execPath`）。同じ model を、
 * 既定の thumbnail command（Configuration の `thumbnailCmd`）と本物の ffmpeg、本物の ffmpeg で作った合成の TS で動かし、
 * node の script のときと同じ結果（出力の公開、DB への登録、通知、失敗の扱い）になることを確かめる。
 */

const DEFAULT_THUMBNAIL_CMD =
    '%FFMPEG% -ss %THUMBNAIL_POSITION% -y -i %INPUT% -vframes 1 -f image2 -s %THUMBNAIL_SIZE% %OUTPUT%';

let root: string;
let input: string;
let ffmpegPath: string;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-real-ffmpeg-'));
    input = await createSyntheticMedia(root, 'synthetic-input.ts', 'mpegts', 4);
    ffmpegPath = (await runProcess('sh', ['-c', `command -v ${FFMPEG}`])).stdout.trim();
}, 120_000);

afterEach(cleanupHarness);

afterAll(async () => {
    restoreSpawn();
    await rm(root, { force: true, recursive: true });
});

const probeImage = async (path: string) => {
    const { stdout } = await runProcess(FFPROBE, [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_name,width,height',
        '-of',
        'json',
        path,
    ]);
    return (JSON.parse(stdout) as { streams: Array<Record<string, unknown>> }).streams;
};

describe('node script thumbnail command against the real ffmpeg', () => {
    it('[TM-REAL-FFMPEG] publishes, registers, and announces a real JPEG made by the default thumbnail command', async () => {
        const thumbnailRoot = await mkdtemp(join(root, 'thumbnail-'));
        useRealSpawn();
        const fixture = makeModel({
            config: {
                ffmpeg: ffmpegPath,
                thumbnail: thumbnailRoot,
                thumbnailCmd: DEFAULT_THUMBNAIL_CMD,
                thumbnailPosition: 1,
                thumbnailSize: '480x270',
            },
        });
        fixture.videoUtil.getFullFilePathFromId.mockResolvedValue(input);

        fixture.model.add(11);
        await vi.waitFor(() => expect(fixture.thumbnailEvent.emitAdded).toHaveBeenCalledOnce(), {
            timeout: 30_000,
            interval: 100,
        });

        expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ filePath: '101.jpg', recordedId: 101 }),
        );
        expect(fixture.thumbnailEvent.emitAdded).toHaveBeenCalledWith(11, 101);
        await vi.waitFor(async () => expect(await readdir(thumbnailRoot)).toEqual(['101.jpg']));
        await expect(probeImage(join(thumbnailRoot, '101.jpg'))).resolves.toEqual([
            { codec_name: 'mjpeg', height: 270, width: 480 },
        ]);
        expect(fixture.log.system.error).not.toHaveBeenCalled();
    }, 60_000);

    it('[TM-REAL-FFMPEG] treats a real ffmpeg failure on an unreadable input like the non-zero exit of the node script', async () => {
        const thumbnailRoot = await mkdtemp(join(root, 'thumbnail-failure-'));
        useRealSpawn();
        const fixture = makeModel({
            config: {
                ffmpeg: ffmpegPath,
                thumbnail: thumbnailRoot,
                thumbnailCmd: DEFAULT_THUMBNAIL_CMD,
                thumbnailPosition: 1,
                thumbnailSize: '480x270',
            },
        });
        fixture.videoUtil.getFullFilePathFromId.mockResolvedValue(join(root, 'synthetic-missing-input.ts'));

        fixture.model.add(12);
        await vi.waitFor(
            () =>
                expect(fixture.log.system.error).toHaveBeenCalledWith(
                    expect.stringMatching(/^create thumbnail cmd error: \d+$/u),
                ),
            { timeout: 30_000, interval: 100 },
        );
        await vi.waitFor(async () => expect(await readdir(thumbnailRoot)).toEqual([]));
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
    }, 60_000);
});
