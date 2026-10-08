import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
const RecordedManageModel = load<{ prototype: Record<string, unknown> }>(
    'model/operator/recorded/RecordedManageModel.js',
);
const FileUtil = require(join(snapshot, 'util', 'FileUtil.js')).default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real RecordedManageModel.updateVideoFileSize body with lower I/O mocked.
 * Prior harnesses mock the method itself; that leaves L647–661 uncovered.
 */
const subject = () => {
    const value: any = Object.create(RecordedManageModel.prototype);
    value.log = { system: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } };
    value.videoUtil = {
        getFullFilePathFromId: vi.fn(async () => '/tmp/epgstation-synthetic-video.ts'),
    };
    value.videoFileDB = {
        updateSize: vi.fn(async () => undefined),
    };
    value.recordedEvent = {
        emitUpdateVideoFileSize: vi.fn(),
    };
    return value;
};

describe('RecordedManageModel.updateVideoFileSize (unittest/imp)', () => {
    it('[R2-RECORDED-MANAGE-UPDATE-VIDEO-SIZE] persists size before notifying (emit only after updateSize resolves)', async () => {
        const target = subject();
        const getFileSize = vi.spyOn(FileUtil, 'getFileSize').mockResolvedValue(98_765);

        let resolveUpdateSize!: () => void;
        const updateSizeGate = new Promise<void>(resolve => {
            resolveUpdateSize = resolve;
        });
        target.videoFileDB.updateSize.mockReturnValue(updateSizeGate);

        const run = target.updateVideoFileSize(4_201);

        // Drain microtasks until updateSize has been entered but not resolved.
        for (let i = 0; i < 8; i += 1) {
            await Promise.resolve();
        }

        expect(target.log.system.info).toHaveBeenCalledWith('update video file size: 4201');
        expect(target.videoUtil.getFullFilePathFromId).toHaveBeenCalledExactlyOnceWith(4_201);
        expect(getFileSize).toHaveBeenCalledExactlyOnceWith('/tmp/epgstation-synthetic-video.ts');
        expect(target.videoFileDB.updateSize).toHaveBeenCalledExactlyOnceWith(4_201, 98_765);
        // Notification must not fire before persistence completes.
        expect(target.recordedEvent.emitUpdateVideoFileSize).not.toHaveBeenCalled();

        resolveUpdateSize();
        await run;

        expect(target.recordedEvent.emitUpdateVideoFileSize).toHaveBeenCalledExactlyOnceWith(4_201);
    });

    it('[R2-RECORDED-MANAGE-UPDATE-VIDEO-SIZE] propagates updateSize rejection without notifying', async () => {
        const target = subject();
        vi.spyOn(FileUtil, 'getFileSize').mockResolvedValue(12_345);
        const failure = new Error('VideoFileDBUpdateSizeFailure');
        target.videoFileDB.updateSize.mockRejectedValue(failure);

        await expect(target.updateVideoFileSize(4_203)).rejects.toBe(failure);

        expect(target.videoUtil.getFullFilePathFromId).toHaveBeenCalledExactlyOnceWith(4_203);
        expect(target.videoFileDB.updateSize).toHaveBeenCalledExactlyOnceWith(4_203, 12_345);
        expect(target.recordedEvent.emitUpdateVideoFileSize).not.toHaveBeenCalled();
    });

    it('[R2-RECORDED-MANAGE-UPDATE-VIDEO-SIZE] rejects VideoFileIsNotFound when path is null', async () => {
        const target = subject();
        target.videoUtil.getFullFilePathFromId.mockResolvedValue(null);
        const getFileSize = vi.spyOn(FileUtil, 'getFileSize');

        await expect(target.updateVideoFileSize(4_202)).rejects.toThrow('VideoFileIsNotFound');

        expect(target.videoUtil.getFullFilePathFromId).toHaveBeenCalledExactlyOnceWith(4_202);
        expect(target.log.system.error).toHaveBeenCalledWith('video file is not found: 4202');
        expect(getFileSize).not.toHaveBeenCalled();
        expect(target.videoFileDB.updateSize).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitUpdateVideoFileSize).not.toHaveBeenCalled();
    });
});
