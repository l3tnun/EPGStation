import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, logger } from './_media-harness';

const LiveStreamModel = compiled<any>('model', 'service', 'stream', 'LiveStreamModel.js').default;

const directories: string[] = [];

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

const makeModel = (streamFilePath: string, log = logger()) =>
    new LiveStreamModel(
        { getConfig: () => baseConfig({ streamFilePath }) },
        { getLogger: () => log },
        { createManaged: vi.fn(), requestStop: vi.fn() },
        { deleteAllFiles: vi.fn(), setOption: vi.fn() },
        { openServiceStream: vi.fn() },
        { notifyClient: vi.fn() },
    );

/**
 * StreamBaseModel の readiness 確認の世代管理。HLS 以外の stream では確認を 1 本だけ持ち、
 * 読み込み中に世代が替わった字幕 playlist の更新は書き込まずに捨てる。
 */
describe('StreamBaseModel readiness generation (unittest/imp)', () => {
    it('[MD-10.2] keeps the first readiness check for a non-HLS stream and ignores a second start request', () => {
        vi.useFakeTimers();
        const log = logger();
        const model = makeModel('synthetic-stream-root', log);

        model.startCheckStreamEnable(3);
        const firstGeneration = model.readinessGeneration;
        const firstTimer = model.streamCheckTimer;
        model.startCheckStreamEnable(4);

        expect(firstGeneration).not.toBeNull();
        expect(model.readinessGeneration).toBe(firstGeneration);
        expect(model.streamCheckTimer).toBe(firstTimer);
        expect(vi.getTimerCount()).toBe(1);
        expect(log.stream.info).toHaveBeenCalledExactlyOnceWith('start check stream file: 3');
    });

    it('[MD-10.2] leaves the parent playlist untouched when the readiness generation changed while reading it', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'epg-readiness-'));
        directories.push(directory);
        const original = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nstream.m3u8\n';
        writeFileSync(join(directory, 'parent.m3u8'), original);
        const model = makeModel(directory);
        model.readinessGeneration = {};

        await model.addSubtitleInfoToParentPlaylist('parent.m3u8', 'subtitle.m3u8', {});

        expect(readFileSync(join(directory, 'parent.m3u8'), 'utf-8')).toBe(original);
    });

    it('[MD-3.7] inserts the subtitle entry when the readiness generation is still current', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'epg-readiness-'));
        directories.push(directory);
        writeFileSync(join(directory, 'parent.m3u8'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nstream.m3u8\n');
        const model = makeModel(directory);
        const generation = {};
        model.readinessGeneration = generation;

        await model.addSubtitleInfoToParentPlaylist('parent.m3u8', 'subtitle.m3u8', generation);

        expect(readFileSync(join(directory, 'parent.m3u8'), 'utf-8')).toBe(
            '#EXTM3U\n' +
                '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subtitle",NAME="Japanese",DEFAULT=YES,LANGUAGE="jp",URI="subtitle.m3u8"\n' +
                '#EXT-X-STREAM-INF:BANDWIDTH=1,SUBTITLES="subtitle"\n' +
                'stream.m3u8\n',
        );
    });
});
