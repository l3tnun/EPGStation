import * as fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, logger } from './_media-harness';

const FileUtil = compiled<any>('util', 'FileUtil.js').default;

const RecordedStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedStreamModel.js').default;

/**
 * Real compiled stream subject so private StreamBaseModel.checkStreamDir is reachable.
 */
const createSubject = () => {
    const log = logger();
    const streamRoot = 'synthetic-stream-root-missing';
    const model = new RecordedStreamModel(
        { getConfig: () => baseConfig({ streamFilePath: streamRoot }) },
        { getLogger: () => log },
        {
            createHlsWriter: vi.fn(),
            createManaged: vi.fn(),
            requestStop: vi.fn(),
            stopHls: vi.fn(),
        },
        { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
        { notifyClient: vi.fn() },
        { findId: vi.fn(async () => null) },
        { findId: vi.fn(async () => null) },
        { getFullFilePathFromId: vi.fn(async () => null) },
    );
    return { log, model, streamRoot };
};

describe('StreamBaseModel.checkStreamDir ENOENT mkdir (unittest/imp)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('[R2-CHECKSTREAMDIR-ENOENT] creates streamFilePath when FileUtil.access reports ENOENT', async () => {
        const { log, model, streamRoot } = createSubject();
        const enoent = Object.assign(new Error('synthetic-missing-stream-dir'), { code: 'ENOENT' });
        const access = vi.spyOn(FileUtil, 'access').mockRejectedValue(enoent);
        const mkdir = vi.spyOn(FileUtil, 'mkdir').mockResolvedValue(undefined);

        await expect((model as { checkStreamDir(): Promise<void> }).checkStreamDir()).resolves.toBeUndefined();

        expect(access).toHaveBeenCalledExactlyOnceWith(streamRoot, fs.constants.R_OK | fs.constants.W_OK);
        expect(log.stream.info).toHaveBeenCalledExactlyOnceWith(`mkdirp: ${streamRoot}`);
        expect(mkdir).toHaveBeenCalledExactlyOnceWith(streamRoot);
    });
});
