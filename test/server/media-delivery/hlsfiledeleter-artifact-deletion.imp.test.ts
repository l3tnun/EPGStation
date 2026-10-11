import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled, logger } from './_media-harness';

const HLSFileDeleterModel = compiled<any>('model', 'service', 'stream', 'util', 'HLSFileDeleterModel.js').default;

const directories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

const makeSubject = () => {
    const log = logger();
    const scratch = mkdtempSync(join(tmpdir(), 'epg-hls-deleter-'));
    directories.push(scratch);
    const model = new HLSFileDeleterModel({ getLogger: () => log });
    return { scratch, log, model };
};

/**
 * HLSFileDeleterModel が artifact を消す順序・結果・診断。
 */
describe('HLSFileDeleterModel artifact deletion details (unittest/imp)', () => {
    it('[MD-10.2] deletes the artifacts in name order, reporting each and the stream being cleaned', async () => {
        const { scratch, log, model } = makeSubject();
        for (const name of ['stream1-b.ts', 'stream1-a.ts', 'stream1.m3u8', 'stream2.m3u8']) {
            writeFileSync(join(scratch, name), 'x');
        }
        const listed = ['stream1-b.ts', 'stream1.m3u8', 'stream1-a.ts'];
        vi.spyOn(model, 'listExact').mockResolvedValueOnce([...listed]).mockResolvedValue([]);

        const result = await model.deleteAllFiles({ streamFilePath: scratch, streamId: 1 });

        expect(result).toEqual({ passes: 1, remainingFiles: [], status: 'cleared' });
        expect(log.stream.info.mock.calls).toEqual([
            ['delete all hls files: 1'],
            ['deleted stream1-a.ts'],
            ['deleted stream1-b.ts'],
            ['deleted stream1.m3u8'],
        ]);
        expect(existsSync(join(scratch, 'stream2.m3u8'))).toBe(true);
    });

    it('[MD-10.2] reports the remaining files in name order and the unlink failure of each', async () => {
        const { scratch, log, model } = makeSubject();
        vi.spyOn(model, 'listExact').mockImplementation(async () => ['stream1-b.ts', 'stream1-a.ts']);

        const result = await model.deleteAllFiles({ streamFilePath: scratch, streamId: 1 });

        expect(result).toEqual({
            passes: 3,
            remainingFiles: ['stream1-a.ts', 'stream1-b.ts'],
            status: 'remaining',
        });
        expect(log.stream.error).toHaveBeenCalledWith({
            error: expect.objectContaining({ code: 'ENOENT' }),
            file: 'stream1-a.ts',
            operation: 'unlink',
            pass: 1,
            streamId: 1,
        });
    });

    it('[MD-10.2] does not report a clean result when the artifacts could not be listed before deleting', async () => {
        const { scratch, model } = makeSubject();
        vi.spyOn(model, 'listExact')
            .mockRejectedValueOnce(new Error('synthetic list failure'))
            .mockResolvedValue([]);

        const result = await model.deleteAllFiles({ streamFilePath: scratch, streamId: 1 });

        expect(result).toEqual({ passes: 3, remainingFiles: [], status: 'unknown' });
    });

    it('[MD-10.2] lists only files that continue the stream id with a non-digit', async () => {
        const { scratch, model } = makeSubject();
        for (const name of ['stream1', 'stream1.m3u8', 'stream1-2.ts', 'stream10.m3u8', 'other1.m3u8']) {
            writeFileSync(join(scratch, name), 'x');
        }

        const listed = await model.listExact(scratch, 1);

        expect([...listed].sort()).toEqual(['stream1-2.ts', 'stream1.m3u8']);
    });
});
