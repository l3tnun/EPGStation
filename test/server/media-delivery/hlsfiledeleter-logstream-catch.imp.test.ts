import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled, logger } from './_media-harness';

const HLSFileDeleterModel = compiled<any>('model', 'service', 'stream', 'util', 'HLSFileDeleterModel.js').default;

/**
 * Real HLSFileDeleterModel.logStream catch path (L178–180).
 * logStream is used for both 'info' and 'error' diagnostics around every artifact
 * scan/delete; a logger that itself throws must not interrupt the caller.
 */
describe('HLSFileDeleterModel.logStream diagnostics catch (unittest/imp)', () => {
    const dirs: string[] = [];

    afterEach(() => {
        vi.restoreAllMocks();
        for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
    });

    it('[R2-HLSFILEDELETER-LOGSTREAM-CATCH] swallows a throwing stream.error logger during deleteAllFiles', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-logstream-error-'));
        dirs.push(dir);
        const log = logger();
        const boom = new Error('synthetic-hls-log-stream-failure');
        log.stream.error.mockImplementation(() => {
            throw boom;
        });
        const deleter = new HLSFileDeleterModel({ getLogger: () => log });
        const scanFailure = new Error('synthetic-hls-scan-failure');
        vi.spyOn(deleter, 'scanCurrent').mockRejectedValue(scanFailure);
        deleter.setOption({ streamFilePath: dir, streamId: 7 });

        await expect(deleter.deleteAllFiles()).resolves.toEqual({
            passes: 3,
            remainingFiles: [],
            status: 'unknown',
        });

        // The throwing logger was actually invoked (and its failure absorbed) rather than skipped.
        expect(log.stream.error).toHaveBeenCalled();
    });

    it('[R2-HLSFILEDELETER-LOGSTREAM-CATCH] swallows a throwing stream.info logger during deleteAllFiles', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-logstream-info-'));
        dirs.push(dir);
        const log = logger();
        const boom = new Error('synthetic-hls-log-stream-info-failure');
        log.stream.info.mockImplementation(() => {
            throw boom;
        });
        const deleter = new HLSFileDeleterModel({ getLogger: () => log });
        deleter.setOption({ streamFilePath: dir, streamId: 7 });

        await expect(deleter.deleteAllFiles()).resolves.toEqual({
            passes: 1,
            remainingFiles: [],
            status: 'cleared',
        });

        expect(log.stream.info).toHaveBeenCalledWith('delete all hls files: 7');
    });
});
