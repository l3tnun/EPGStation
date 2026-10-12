import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, deferred, executionManager, fakeChild, fakeIdAllocator, logger } from './_media-harness';

const LiveStreamModel = compiled<any>('model', 'service', 'stream', 'LiveStreamModel.js').default;
const LiveHLSStreamModel = compiled<any>('model', 'service', 'stream', 'LiveHLSStreamModel.js').default;
const LoggerModel = compiled<any>('model', 'LoggerModel.js').default;
const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;
const HLSFileDeleterModel = compiled<any>('model', 'service', 'stream', 'util', 'HLSFileDeleterModel.js').default;
const TunerServerAccessModel = compiled<any>('model', 'tuner', 'TunerServerAccessModel.js').default;
const FileUtil = compiled<any>('util', 'FileUtil.js').default;

afterEach(() => vi.useRealTimers());

const settleMicrotasks = async (): Promise<void> => {
    for (let index = 0; index < 16; index++) await Promise.resolve();
};

describe('live tuner boundary characterization', () => {
    it('[MD-5.1][MD-5.2][MD-5.3] joins Live HLS stop on one opaque handle and cleans artifacts after writer rejection', async () => {
        const streamFilePath = mkdtempSync(join(tmpdir(), 'epg-live-hls-stop-'));
        const logs = logger();
        const tuner = new PassThrough();
        const operations: string[] = [];
        const close = vi.fn(() => {
            operations.push('input-close');
            tuner.destroy();
        });
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'hls-writer' });
        const stopFailure = new Error('synthetic live HLS writer stop failure');
        const stopHls = vi.fn(async () => {
            operations.push('writer-stop');
            throw stopFailure;
        });
        const fileDeleter = {
            deleteAllFiles: vi.fn(async () => {
                operations.push('artifact-cleanup');
                return { passes: 1, remainingFiles: [], status: 'cleared' as const };
            }),
            setOption: vi.fn(),
        };
        const model = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath }) },
            { getLogger: () => logs },
            { createHlsWriter: vi.fn(async () => ({ child, handle })), stopHls },
            fileDeleter,
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101, cmd: '%NODE% synthetic-live-hls' }, 0);
        const manager = new StreamManageModel({ getLogger: () => logs }, executionManager(), {
            notifyClient: vi.fn(),
        });

        try {
            await expect(manager.start(model)).resolves.toBe(0);
            operations.length = 0;
            await expect(Promise.all([manager.stop(0), manager.stop(0)])).resolves.toEqual([undefined, undefined]);

            expect(stopHls).toHaveBeenCalledOnce();
            expect(stopHls).toHaveBeenCalledWith(handle);
            expect(close).toHaveBeenCalledOnce();
            expect(fileDeleter.deleteAllFiles).toHaveBeenCalledTimes(2);
            expect(operations).toEqual(['input-close', 'writer-stop', 'artifact-cleanup']);
            expect(manager.getStreamInfos()).toEqual([]);
            expect(logs.stream.error).toHaveBeenCalledTimes(1);
            expect(logs.stream.error).toHaveBeenCalledWith({
                artifactCleanup: { passes: 1, remainingFiles: [], status: 'cleared' },
                artifactCleanupFailure: undefined,
                event: 'hls-stop-finalization',
                forceReleased: true,
                streamId: 0,
                streamType: 'LiveHLS',
                writerStopFailure: stopFailure,
                writerStopResult: undefined,
            });
        } finally {
            rmSync(streamFilePath, { force: true, recursive: true });
        }
    });

    it('[MD-5.1][MD-5.10][MD-5.12] stops a late-created HLS writer through its opaque handle without adopting the stopped session', async () => {
        const streamFilePath = mkdtempSync(join(tmpdir(), 'epg-live-hls-late-stop-'));
        const oldWriter = deferred<{ child: ReturnType<typeof fakeChild>; handle: object }>();
        const logs = logger();
        const oldTuner = new PassThrough();
        const newTuner = new PassThrough();
        const oldClose = vi.fn(() => oldTuner.destroy());
        const newClose = vi.fn(() => newTuner.destroy());
        const oldChild = fakeChild();
        const newChild = fakeChild();
        const oldHandle = Object.freeze({ kind: 'late-old-hls-writer' });
        const newHandle = Object.freeze({ kind: 'new-hls-writer' });
        const createHlsWriter = vi
            .fn()
            .mockImplementationOnce(() => oldWriter.promise)
            .mockResolvedValueOnce({ child: newChild, handle: newHandle });
        const stopHls = vi.fn(async (target: object) => {
            if (target === oldHandle) {
                writeFileSync(join(streamFilePath, 'stream0-0.ts'), 'writer-stop-flush');
                return {
                    exitConfirmed: true,
                    sentSignals: ['SIGINT'] as const,
                    slotReleased: true,
                };
            }
            return {
                exitConfirmed: true,
                sentSignals: ['SIGINT'] as const,
                slotReleased: true,
            };
        });
        const fileDeleter = new HLSFileDeleterModel({ getLogger: () => logs });
        const actualDeleteAllFiles = fileDeleter.deleteAllFiles.bind(fileDeleter);
        const deleteAllFiles = vi
            .spyOn(fileDeleter, 'deleteAllFiles')
            .mockImplementationOnce(actualDeleteAllFiles)
            .mockImplementationOnce(actualDeleteAllFiles)
            .mockImplementationOnce(async option => {
                await actualDeleteAllFiles(option);
                return { passes: 3, remainingFiles: ['stream0-late.ts'], status: 'remaining' };
            })
            .mockImplementation(actualDeleteAllFiles);
        const model = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath }) },
            { getLogger: () => logs },
            { createHlsWriter, stopHls },
            fileDeleter,
            {
                openServiceStream: vi
                    .fn()
                    .mockResolvedValueOnce({ close: oldClose, stream: oldTuner })
                    .mockResolvedValueOnce({ close: newClose, stream: newTuner }),
            },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101, cmd: '%NODE% synthetic-live-hls' }, 0);
        const manager = new StreamManageModel(
            { getLogger: () => logs },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: () => logs }, { getConfig: () => baseConfig({ streamFilePath }) }, fileDeleter),
        );

        try {
            const started = manager.start(model);
            const rejectedStart = expect(started).rejects.toThrow('StreamStartStopped');
            await vi.waitFor(() => expect(createHlsWriter).toHaveBeenCalledOnce());

            await manager.stop(0);
            await rejectedStart;
            expect(manager.getStreamInfos()).toEqual([]);

            model.setOption({ channelId: 101, cmd: '%NODE% synthetic-live-hls' }, 1);
            await expect(manager.start(model)).rejects.toThrow('StreamStartInProgress');
            expect(createHlsWriter).toHaveBeenCalledOnce();
            await vi.waitFor(() => expect(manager.getStreamInfos()).toEqual([]));

            writeFileSync(join(streamFilePath, 'stream0.m3u8'), '#EXTM3U');
            writeFileSync(join(streamFilePath, 'stream00-0.ts'), 'adjacent');
            oldWriter.resolve({ child: oldChild, handle: oldHandle });

            await vi.waitFor(() => expect(stopHls).toHaveBeenCalledWith(oldHandle));
            expect(oldClose).toHaveBeenCalledOnce();
            await vi.waitFor(() => {
                expect(existsSync(join(streamFilePath, 'stream0.m3u8'))).toBe(false);
                expect(existsSync(join(streamFilePath, 'stream0-0.ts'))).toBe(false);
            });
            expect(deleteAllFiles.mock.calls.map(([option]: any[]) => option?.streamId)).toEqual([0, 0, 0]);
            expect(existsSync(join(streamFilePath, 'stream00-0.ts'))).toBe(true);
            expect(manager.getStreamInfos()).toEqual([]);
            const finalizationEvents = logs.stream.error.mock.calls
                .map(([value]: unknown[]) => value)
                .filter(
                    value =>
                        typeof value === 'object' &&
                        value !== null &&
                        (value as { event?: unknown }).event === 'hls-stop-finalization',
                );
            expect(finalizationEvents).toEqual([
                {
                    artifactCleanup: { passes: 1, remainingFiles: [], status: 'cleared' },
                    artifactCleanupAttempts: [
                        { failure: undefined, result: { passes: 1, remainingFiles: [], status: 'cleared' } },
                        {
                            failure: undefined,
                            result: { passes: 3, remainingFiles: ['stream0-late.ts'], status: 'remaining' },
                        },
                    ],
                    artifactCleanupFailure: undefined,
                    event: 'hls-stop-finalization',
                    forceReleased: true,
                    streamId: 0,
                    streamType: 'LiveHLS',
                    writerStopFailure: undefined,
                    writerStopResult: {
                        exitConfirmed: true,
                        sentSignals: ['SIGINT'],
                        slotReleased: true,
                    },
                },
            ]);

            await settleMicrotasks();
            model.setOption({ channelId: 101, cmd: '%NODE% synthetic-live-hls' }, 2);
            await expect(manager.start(model)).resolves.toBe(2);
            writeFileSync(join(streamFilePath, 'stream2.m3u8'), '#EXTM3U');
            writeFileSync(join(streamFilePath, 'stream2-0.ts'), 'new-session');
            expect(manager.getStreamInfos().map(({ streamId }: any) => streamId)).toEqual([2]);

            await manager.stop(2);
            expect(stopHls).toHaveBeenCalledWith(newHandle);
            expect(newClose).toHaveBeenCalledOnce();
            expect(existsSync(join(streamFilePath, 'stream2.m3u8'))).toBe(false);
            expect(existsSync(join(streamFilePath, 'stream2-0.ts'))).toBe(false);
            expect(manager.getStreamInfos()).toEqual([]);
            expect(
                logs.stream.error.mock.calls.filter(
                    ([value]: unknown[]) =>
                        typeof value === 'object' &&
                        value !== null &&
                        (value as { event?: unknown }).event === 'hls-stop-finalization',
                ),
            ).toHaveLength(1);
        } finally {
            oldWriter.resolve({ child: oldChild, handle: oldHandle });
            await settleMicrotasks();
            await manager.stopAll();
            rmSync(streamFilePath, { force: true, recursive: true });
        }
    });

    it('[MD-5.10][MD-5.12] fences late cleanup from replacement artifacts after same-ID reuse', async () => {
        const streamFilePath = mkdtempSync(join(tmpdir(), 'epg-live-hls-same-id-reuse-'));
        const oldWriter = deferred<{ child: ReturnType<typeof fakeChild>; handle: object }>();
        const logs = logger();
        const oldTuner = new PassThrough();
        const replacementTuner = new PassThrough();
        const oldClose = vi.fn(() => oldTuner.destroy());
        const replacementClose = vi.fn(() => replacementTuner.destroy());
        const oldChild = fakeChild();
        const replacementChild = fakeChild();
        const oldHandle = Object.freeze({ kind: 'same-id-old-hls-writer' });
        const replacementHandle = Object.freeze({ kind: 'same-id-replacement-hls-writer' });
        const oldCreateHlsWriter = vi.fn(() => oldWriter.promise);
        const oldStopHls = vi.fn(async () => ({
            exitConfirmed: false,
            sentSignals: ['SIGINT', 'SIGKILL'] as const,
            slotReleased: true,
        }));
        const replacementStopHls = vi.fn(async () => ({
            exitConfirmed: true,
            sentSignals: ['SIGINT'] as const,
            slotReleased: true,
        }));
        const oldFileDeleter = new HLSFileDeleterModel({ getLogger: () => logs });
        const replacementFileDeleter = new HLSFileDeleterModel({ getLogger: () => logs });
        const oldDeleteAllFiles = vi.spyOn(oldFileDeleter, 'deleteAllFiles');
        const oldModel = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath }) },
            { getLogger: () => logs },
            { createHlsWriter: oldCreateHlsWriter, stopHls: oldStopHls },
            oldFileDeleter,
            { openServiceStream: vi.fn(async () => ({ close: oldClose, stream: oldTuner })) },
            { notifyClient: vi.fn() },
        );
        const replacementModel = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath }) },
            { getLogger: () => logs },
            {
                createHlsWriter: vi.fn(async () => ({ child: replacementChild, handle: replacementHandle })),
                stopHls: replacementStopHls,
            },
            replacementFileDeleter,
            {
                openServiceStream: vi.fn(async () => ({
                    close: replacementClose,
                    stream: replacementTuner,
                })),
            },
            { notifyClient: vi.fn() },
        );
        oldModel.setOption({ channelId: 101, cmd: '%NODE% synthetic-live-hls' }, 0);
        replacementModel.setOption({ channelId: 102, cmd: '%NODE% synthetic-live-hls' }, 0);
        const manager = new StreamManageModel({ getLogger: () => logs }, executionManager(), {
            notifyClient: vi.fn(),
        });
        const artifactOwnerCount = LiveHLSStreamModel.hlsArtifactOwners.size;

        try {
            const started = manager.start(oldModel);
            const rejectedStart = expect(started).rejects.toThrow('StreamStartStopped');
            await vi.waitFor(() => expect(oldCreateHlsWriter).toHaveBeenCalledOnce());

            await manager.stop(0);
            await rejectedStart;
            await expect(manager.start(replacementModel)).resolves.toBe(0);
            writeFileSync(join(streamFilePath, 'stream0.m3u8'), '#EXTM3U');
            writeFileSync(join(streamFilePath, 'stream0-0.ts'), 'replacement-generation');

            oldWriter.resolve({ child: oldChild, handle: oldHandle });
            await vi.waitFor(() => expect(oldStopHls).toHaveBeenCalledWith(oldHandle));
            await settleMicrotasks();

            expect(oldDeleteAllFiles).toHaveBeenCalledTimes(2);
            expect(oldClose).toHaveBeenCalledOnce();
            expect(existsSync(join(streamFilePath, 'stream0.m3u8'))).toBe(true);
            expect(existsSync(join(streamFilePath, 'stream0-0.ts'))).toBe(true);
            expect(manager.getStreamInfos().map(({ streamId }: any) => streamId)).toEqual([0]);
            expect(
                logs.stream.error.mock.calls
                    .map(([value]: unknown[]) => value)
                    .filter(
                        value =>
                            typeof value === 'object' &&
                            value !== null &&
                            (value as { event?: unknown }).event === 'hls-stop-finalization',
                    ),
            ).toEqual([
                {
                    artifactCleanup: { passes: 1, remainingFiles: [], status: 'cleared' },
                    artifactCleanupAttempts: [
                        { failure: undefined, result: { passes: 1, remainingFiles: [], status: 'cleared' } },
                        { failure: undefined, result: { passes: 0, remainingFiles: [], status: 'cleared' } },
                    ],
                    artifactCleanupFailure: undefined,
                    event: 'hls-stop-finalization',
                    forceReleased: true,
                    streamId: 0,
                    streamType: 'LiveHLS',
                    writerStopFailure: undefined,
                    writerStopResult: {
                        exitConfirmed: false,
                        sentSignals: ['SIGINT', 'SIGKILL'],
                        slotReleased: true,
                    },
                },
            ]);

            await manager.stop(0);
            expect(replacementStopHls).toHaveBeenCalledWith(replacementHandle);
            expect(replacementClose).toHaveBeenCalledOnce();
            expect(existsSync(join(streamFilePath, 'stream0.m3u8'))).toBe(false);
            expect(existsSync(join(streamFilePath, 'stream0-0.ts'))).toBe(false);
            expect(manager.getStreamInfos()).toEqual([]);
            expect(LiveHLSStreamModel.hlsArtifactOwners.size).toBe(artifactOwnerCount);
        } finally {
            oldWriter.resolve({ child: oldChild, handle: oldHandle });
            await settleMicrotasks();
            await manager.stopAll();
            rmSync(streamFilePath, { force: true, recursive: true });
        }
    });

    it('[MD-5.10][MD-5.12] finishes old cleanup before preparing a same-ID replacement', async () => {
        const streamFilePath = mkdtempSync(join(tmpdir(), 'epg-live-hls-cleanup-prep-order-'));
        const oldWriter = deferred<{ child: ReturnType<typeof fakeChild>; handle: object }>();
        const oldUnlinkEntered = deferred<void>();
        const releaseOldUnlink = deferred<void>();
        const replacementCleanupEntered = deferred<void>();
        const releaseReplacementCleanup = deferred<void>();
        const logs = logger();
        const oldTuner = new PassThrough();
        const replacementTuner = new PassThrough();
        const oldChild = fakeChild();
        const replacementChild = fakeChild();
        const oldHandle = Object.freeze({ kind: 'cleanup-first-old-hls-writer' });
        const replacementHandle = Object.freeze({ kind: 'cleanup-first-replacement-hls-writer' });
        const oldCreateHlsWriter = vi.fn(() => oldWriter.promise);
        const replacementCreateHlsWriter = vi.fn(async () => ({
            child: replacementChild,
            handle: replacementHandle,
        }));
        const oldStopHls = vi.fn(async () => {
            writeFileSync(join(streamFilePath, 'stream0-old.ts'), 'old-generation');
            return {
                exitConfirmed: true,
                sentSignals: ['SIGINT'] as const,
                slotReleased: true,
            };
        });
        const replacementStopHls = vi.fn(async () => ({
            exitConfirmed: true,
            sentSignals: ['SIGINT'] as const,
            slotReleased: true,
        }));
        const oldFileDeleter = new HLSFileDeleterModel({ getLogger: () => logs });
        const replacementFileDeleter = new HLSFileDeleterModel({ getLogger: () => logs });
        const actualReplacementDeleteAllFiles = replacementFileDeleter.deleteAllFiles.bind(replacementFileDeleter);
        const replacementDeleteAllFiles = vi
            .spyOn(replacementFileDeleter, 'deleteAllFiles')
            .mockImplementation(async option => {
                replacementCleanupEntered.resolve();
                await releaseReplacementCleanup.promise;
                return actualReplacementDeleteAllFiles(option);
            });
        const replacementSetOption = vi.spyOn(replacementFileDeleter, 'setOption');
        const originalUnlink = FileUtil.unlink;
        let oldUnlinkPaused = false;
        const unlink = vi.spyOn(FileUtil, 'unlink').mockImplementation(async (filePath: string) => {
            if (filePath.endsWith('/stream0-old.ts') && oldUnlinkPaused === false) {
                oldUnlinkPaused = true;
                oldUnlinkEntered.resolve();
                await releaseOldUnlink.promise;
            }
            await originalUnlink(filePath);
        });
        const oldModel = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath }) },
            { getLogger: () => logs },
            { createHlsWriter: oldCreateHlsWriter, stopHls: oldStopHls },
            oldFileDeleter,
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(), stream: oldTuner })) },
            { notifyClient: vi.fn() },
        );
        const replacementModel = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath }) },
            { getLogger: () => logs },
            { createHlsWriter: replacementCreateHlsWriter, stopHls: replacementStopHls },
            replacementFileDeleter,
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(), stream: replacementTuner })) },
            { notifyClient: vi.fn() },
        );
        oldModel.setOption({ channelId: 101, cmd: '%NODE% synthetic-live-hls' }, 0);
        replacementModel.setOption({ channelId: 102, cmd: '%NODE% synthetic-live-hls' }, 0);
        const manager = new StreamManageModel({ getLogger: () => logs }, executionManager(), {
            notifyClient: vi.fn(),
        });
        const cleanupTurnCount = LiveHLSStreamModel.hlsArtifactCleanupTurns.size;
        let replacementStarted: Promise<number> | null = null;

        try {
            const started = manager.start(oldModel);
            const rejectedStart = expect(started).rejects.toThrow('StreamStartStopped');
            await vi.waitFor(() => expect(oldCreateHlsWriter).toHaveBeenCalledOnce());
            await manager.stop(0);
            await rejectedStart;

            oldWriter.resolve({ child: oldChild, handle: oldHandle });
            await oldUnlinkEntered.promise;

            replacementStarted = manager.start(replacementModel);
            await vi.waitFor(() => expect(replacementSetOption).toHaveBeenCalledOnce());
            expect(replacementDeleteAllFiles).not.toHaveBeenCalled();
            expect(replacementCreateHlsWriter).not.toHaveBeenCalled();

            releaseOldUnlink.resolve();
            await replacementCleanupEntered.promise;
            expect(LiveHLSStreamModel.hlsArtifactCleanupTurns.size).toBe(cleanupTurnCount + 1);
            releaseReplacementCleanup.resolve();
            await expect(replacementStarted).resolves.toBe(0);
            writeFileSync(join(streamFilePath, 'stream0.m3u8'), '#EXTM3U');
            writeFileSync(join(streamFilePath, 'stream0-0.ts'), 'replacement-generation');
            await settleMicrotasks();

            expect(existsSync(join(streamFilePath, 'stream0.m3u8'))).toBe(true);
            expect(existsSync(join(streamFilePath, 'stream0-0.ts'))).toBe(true);
            expect(manager.getStreamInfos().map(({ streamId }: any) => streamId)).toEqual([0]);
            await manager.stop(0);
            expect(LiveHLSStreamModel.hlsArtifactCleanupTurns.size).toBe(cleanupTurnCount);
        } finally {
            releaseOldUnlink.resolve();
            releaseReplacementCleanup.resolve();
            oldWriter.resolve({ child: oldChild, handle: oldHandle });
            if (replacementStarted !== null) {
                await replacementStarted.catch(() => undefined);
            }
            await settleMicrotasks();
            await manager.stopAll();
            unlink.mockRestore();
            rmSync(streamFilePath, { force: true, recursive: true });
        }
    });

    it('[MD-5.10][MD-5.12] keeps late cleanup ownership independent across stream IDs', async () => {
        const streamFilePath = mkdtempSync(join(tmpdir(), 'epg-live-hls-owner-id-boundary-'));
        const oldWriter = deferred<{ child: ReturnType<typeof fakeChild>; handle: object }>();
        const logs = logger();
        const oldTuner = new PassThrough();
        const otherTuner = new PassThrough();
        const oldChild = fakeChild();
        const otherChild = fakeChild();
        const oldHandle = Object.freeze({ kind: 'owner-id-old-hls-writer' });
        const otherHandle = Object.freeze({ kind: 'owner-id-other-hls-writer' });
        const oldCreateHlsWriter = vi.fn(() => oldWriter.promise);
        const oldStopHls = vi.fn(async () => ({
            exitConfirmed: false,
            sentSignals: ['SIGINT', 'SIGKILL'] as const,
            slotReleased: true,
        }));
        const otherStopHls = vi.fn(async () => ({
            exitConfirmed: true,
            sentSignals: ['SIGINT'] as const,
            slotReleased: true,
        }));
        const oldFileDeleter = new HLSFileDeleterModel({ getLogger: () => logs });
        const otherFileDeleter = new HLSFileDeleterModel({ getLogger: () => logs });
        const artifactIndex = new HLSFileDeleterModel({ getLogger: () => logs });
        const oldDeleteAllFiles = vi.spyOn(oldFileDeleter, 'deleteAllFiles');
        const oldModel = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath }) },
            { getLogger: () => logs },
            { createHlsWriter: oldCreateHlsWriter, stopHls: oldStopHls },
            oldFileDeleter,
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(), stream: oldTuner })) },
            { notifyClient: vi.fn() },
        );
        const otherModel = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath }) },
            { getLogger: () => logs },
            {
                createHlsWriter: vi.fn(async () => ({ child: otherChild, handle: otherHandle })),
                stopHls: otherStopHls,
            },
            otherFileDeleter,
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(), stream: otherTuner })) },
            { notifyClient: vi.fn() },
        );
        oldModel.setOption({ channelId: 101, cmd: '%NODE% synthetic-live-hls' }, 0);
        otherModel.setOption({ channelId: 102, cmd: '%NODE% synthetic-live-hls' }, 1);
        const manager = new StreamManageModel(
            { getLogger: () => logs },
            executionManager(),
            { notifyClient: vi.fn() },
            fakeIdAllocator({ getLogger: () => logs }, { getConfig: () => baseConfig({ streamFilePath }) }, artifactIndex),
        );

        try {
            const started = manager.start(oldModel);
            const rejectedStart = expect(started).rejects.toThrow('StreamStartStopped');
            await vi.waitFor(() => expect(oldCreateHlsWriter).toHaveBeenCalledOnce());
            await manager.stop(0);
            await rejectedStart;

            await expect(manager.start(otherModel)).resolves.toBe(1);
            writeFileSync(join(streamFilePath, 'stream0.m3u8'), '#EXTM3U');
            writeFileSync(join(streamFilePath, 'stream0-0.ts'), 'old-generation');
            writeFileSync(join(streamFilePath, 'stream1.m3u8'), '#EXTM3U');
            writeFileSync(join(streamFilePath, 'stream1-0.ts'), 'other-id-generation');

            oldWriter.resolve({ child: oldChild, handle: oldHandle });
            await vi.waitFor(() => expect(oldStopHls).toHaveBeenCalledWith(oldHandle));
            await vi.waitFor(() => expect(oldDeleteAllFiles).toHaveBeenCalledTimes(3));

            expect(existsSync(join(streamFilePath, 'stream0.m3u8'))).toBe(false);
            expect(existsSync(join(streamFilePath, 'stream0-0.ts'))).toBe(false);
            expect(existsSync(join(streamFilePath, 'stream1.m3u8'))).toBe(true);
            expect(existsSync(join(streamFilePath, 'stream1-0.ts'))).toBe(true);
            expect(manager.getStreamInfos().map(({ streamId }: any) => streamId)).toEqual([1]);

            await manager.stop(1);
            expect(otherStopHls).toHaveBeenCalledWith(otherHandle);
            expect(existsSync(join(streamFilePath, 'stream1.m3u8'))).toBe(false);
            expect(existsSync(join(streamFilePath, 'stream1-0.ts'))).toBe(false);
        } finally {
            oldWriter.resolve({ child: oldChild, handle: oldHandle });
            await settleMicrotasks();
            await manager.stopAll();
            rmSync(streamFilePath, { force: true, recursive: true });
        }
    });

    it('[MD-LIVE-TUNER-DIRECT] connects a commandless tuner stream directly and closes it on stop', async () => {
        vi.useFakeTimers();
        const tunerStream = new PassThrough() as any;
        tunerStream.unpipe = vi.fn(tunerStream.unpipe.bind(tunerStream));
        tunerStream.destroy = vi.fn(tunerStream.destroy.bind(tunerStream));
        const createProcess = vi.fn();
        const close = vi.fn(() => tunerStream.destroy());
        const openServiceStream = vi.fn(async () => ({ stream: tunerStream, close }));
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { create: createProcess },
            { deleteAllFiles: async () => undefined, setOption: () => undefined },
            { openServiceStream },
            { notifyClient: () => undefined },
        );
        model.setOption({ channelId: 101 }, 0);
        const exited = vi.fn();
        model.setExitStream(exited);

        await model.start(0);
        expect(model.getStream()).toBe(tunerStream);
        expect(createProcess).not.toHaveBeenCalled();
        expect(openServiceStream).toHaveBeenCalledWith({ serviceId: 101, priority: 1 });
        tunerStream.emit('close');
        expect(exited).toHaveBeenCalledOnce();
        await model.stop();
        expect(tunerStream.destroy).toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-1.1][MD-1.3][MD-6.1] connects the actual tuner HTTP adapter and logger to direct live start, body, and stop', async () => {
        let requestClosed!: () => void;
        const requestClosedPromise = new Promise<void>(resolve => {
            requestClosed = resolve;
        });
        const tunerServer: Server = createServer((request, response) => {
            expect(request.url).toBe('/api/services/101/stream?decode=1');
            expect(request.headers['x-mirakurun-priority']).toBe('1');
            response.writeHead(200, { 'content-type': 'video/mp2t' });
            response.write('actual-tuner-body');
            request.once('close', requestClosed);
        });
        tunerServer.listen(0, '127.0.0.1');
        await once(tunerServer, 'listening');
        const address = tunerServer.address();
        if (address === null || typeof address === 'string') throw new Error('SyntheticTunerAddressIsUnavailable');

        const actualLogger = new LoggerModel();
        actualLogger.initialize();
        for (const category of Object.values(actualLogger.getLogger()) as any[]) category.level = 'off';
        const logs = { getLogger: () => actualLogger.getLogger() };
        const manager = new StreamManageModel(logs, executionManager(), { notifyClient: vi.fn() });
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            logs,
            { createManaged: vi.fn(), requestStop: vi.fn() },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            new TunerServerAccessModel(`http://127.0.0.1:${address.port}`, 'synthetic-media-delivery'),
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101 }, 0);

        try {
            const streamId = await manager.start(model);
            const chunk = await new Promise<Buffer>((resolve, reject) => {
                model.getStream().once('data', resolve).once('error', reject);
            });
            expect(chunk.toString()).toBe('actual-tuner-body');
            expect(manager.getStreamInfos()).toHaveLength(1);

            await manager.stop(streamId);
            await requestClosedPromise;
            expect(manager.getStreamInfos()).toEqual([]);
        } finally {
            await manager.stopAll();
            tunerServer.closeAllConnections();
            await new Promise<void>(resolve => tunerServer.close(() => resolve()));
        }
    });

    it('[MD-LIVE-TUNER-FAILURE] preserves stream logger category and rejects an invalid tuner channel', async () => {
        const logs = logger();
        const failure = new Error('synthetic tuner channel failure');
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: () => logs },
            { create: vi.fn() },
            { deleteAllFiles: async () => undefined, setOption: () => undefined },
            { openServiceStream: async () => Promise.reject(failure) },
            { notifyClient: () => undefined },
        );
        model.setOption({ channelId: 999 }, 0);
        await expect(model.start(0)).rejects.toBe(failure);
        expect(logs.stream.error).toHaveBeenCalledWith('get mirakurun service stream failed: 999');
    });

    it('[MD-1.8] closes a tuner handle that settles after the coordinator deadline without adopting it', async () => {
        vi.useFakeTimers();
        const acquired = deferred<{ close: () => void; stream: PassThrough }>();
        const tuner = new PassThrough();
        const close = vi.fn(() => tuner.destroy());
        const createManaged = vi.fn();
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { openServiceStream: vi.fn(() => acquired.promise) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101 }, 0);
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        const terminal = manager.start(model).then(
            value => ({ status: 'fulfilled' as const, value }),
            error => ({ error, status: 'rejected' as const }),
        );

        await settleMicrotasks();
        expect(manager.getStreamInfos()).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(30_000);
        await expect(terminal).resolves.toMatchObject({
            error: expect.objectContaining({ message: 'StreamStartTimeout' }),
            status: 'rejected',
        });

        acquired.resolve({ close, stream: tuner });
        await settleMicrotasks();

        expect(close).toHaveBeenCalledOnce();
        expect(createManaged).not.toHaveBeenCalled();
        expect(tuner.listenerCount('close')).toBe(0);
        expect(tuner.listenerCount('end')).toBe(0);
        expect(tuner.listenerCount('error')).toBe(0);
        expect(manager.getStreamInfos()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-1.9] keeps an established commandless tuner body beyond the 30-second start deadline', async () => {
        vi.useFakeTimers();
        const tuner = new PassThrough();
        const close = vi.fn(() => tuner.destroy());
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged: vi.fn() },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101 }, 0);
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });

        const streamId = await manager.start(model);
        await vi.advanceTimersByTimeAsync(30_000);

        expect(model.getStream()).toBe(tuner);
        expect(close).not.toHaveBeenCalled();
        expect(manager.getStreamInfos()).toHaveLength(1);

        await manager.stop(streamId);
        expect(close).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });
});
