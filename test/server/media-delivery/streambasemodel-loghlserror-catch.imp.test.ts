import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, executionManager, fakeChild, logger } from './_media-harness';

const RecordedHLSStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedHLSStreamModel.js').default;
const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;

/**
 * Real StreamBaseModel.logHlsError catch path (L333–339).
 * finalizeStop()'s force-release diagnostic funnels through logHlsError -> log.stream.error;
 * a logger that itself throws must not interrupt the manager's stop() cleanup.
 */
describe('StreamBaseModel.logHlsError diagnostics catch (unittest/imp)', () => {
    const dirs: string[] = [];

    afterEach(() => {
        vi.restoreAllMocks();
        for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
    });

    it('[R2-LOGHLSERROR-CATCH] does not propagate when the force-release diagnostic logger throws', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-loghlserror-catch-'));
        dirs.push(dir);
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'loghlserror-catch-writer' });
        const writerStopResult = {
            exitConfirmed: false,
            sentSignals: ['SIGINT'] as const,
            slotReleased: true,
        };
        const stopHls = vi.fn(async () => writerStopResult);
        const fileDeleter = {
            deleteAllFiles: vi.fn(async () => ({ passes: 1, remainingFiles: [], status: 'cleared' as const })),
            setOption: vi.fn(),
        };
        const logs = logger();
        const boom = new Error('synthetic-hls-finalization-diagnostic-failure');
        logs.stream.error.mockImplementation(value => {
            if (typeof value === 'object' && value !== null && (value as { event?: unknown }).event !== undefined) {
                throw boom;
            }
        });
        const manager = new StreamManageModel({ getLogger: () => logs }, executionManager(), { notifyClient: vi.fn() });
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: () => logs },
            { createHlsWriter: vi.fn(async () => ({ child, handle })), stopHls },
            fileDeleter,
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 1 }, 0);
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = join(dir, 'source.ts');
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'encoded';
            model.isRecording = false;
        });
        await expect(manager.start(model)).resolves.toBe(0);

        await expect(manager.stop(0)).resolves.toBeUndefined();

        expect(logs.stream.error).toHaveBeenCalledExactlyOnceWith({
            artifactCleanup: { passes: 1, remainingFiles: [], status: 'cleared' },
            artifactCleanupFailure: undefined,
            event: 'hls-stop-finalization',
            forceReleased: true,
            streamId: 0,
            streamType: 'RecordedHLS',
            writerStopFailure: undefined,
            writerStopResult,
        });
        expect(manager.getStreamInfos()).toEqual([]);
    });
});
