import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, executionManager, fakeChild, fakeStream, logger } from './_media-harness';

const LiveStreamModel = compiled<any>('model', 'service', 'stream', 'LiveStreamModel.js').default;
const RecordedStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedStreamModel.js').default;
const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;

const settleMicrotasks = async (): Promise<void> => {
    for (let index = 0; index < 8; index++) await Promise.resolve();
};

describe('non-HLS direct stop contract', () => {
    it('[PRIMARY R6.1] attempts a terminal live conversion handle and tuner once despite cleanup failures', async () => {
        const child = fakeChild();
        child.exitCode = 1;
        const handle = Object.freeze({ kind: 'managed-live-direct-stop' });
        const processFailure = new Error('synthetic live process stop failure');
        const tunerFailure = new Error('synthetic live tuner stop failure');
        const requestStop = vi.fn(async () => Promise.reject(processFailure));
        const tuner = new PassThrough();
        const close = vi.fn(() => {
            tuner.destroy();
            throw tunerFailure;
        });
        const model = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged: vi.fn(async () => ({ child, handle })), requestStop },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101, cmd: '%NODE% synthetic-live-direct-stop' }, 0);

        await model.start(0);
        await expect(Promise.all([model.stop(), model.stop()])).resolves.toEqual([undefined, undefined]);

        expect(requestStop).toHaveBeenCalledOnce();
        expect(requestStop).toHaveBeenCalledWith(handle);
        expect(close).toHaveBeenCalledOnce();
        expect(child.kill).not.toHaveBeenCalled();
    });

    it('[PRIMARY R6.2] attempts a terminal recorded conversion handle and reader once despite cleanup failures', async () => {
        const child = fakeChild();
        child.exitCode = 1;
        const handle = Object.freeze({ kind: 'managed-recorded-direct-stop' });
        const processFailure = new Error('synthetic recorded process stop failure');
        const readerFailure = new Error('synthetic recorded reader stop failure');
        const requestStop = vi.fn(async () => Promise.reject(processFailure));
        const reader = new PassThrough();
        reader.destroy = vi.fn(() => {
            throw readerFailure;
        });
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged: vi.fn(async () => ({ child, handle })), requestStop },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn(async () => ({ id: 31, recordedId: 41, type: 'ts' })) },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = 'synthetic-recording.ts';
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'ts';
            model.isRecording = true;
        });
        model.setFileStream = vi.fn(() => {
            model.fileStream = reader;
        });
        model.setOption({ cmd: '%NODE% synthetic-recorded-direct-stop', playPosition: 0, videoFileId: 31 }, 0);

        await model.start(0);
        await expect(Promise.all([model.stop(), model.stop()])).resolves.toEqual([undefined, undefined]);

        expect(requestStop).toHaveBeenCalledOnce();
        expect(requestStop).toHaveBeenCalledWith(handle);
        expect(reader.destroy).toHaveBeenCalledOnce();
        expect(child.kill).not.toHaveBeenCalled();
    });

    it('[MD-6.2] retains the saved recorded handle after the child emits terminal exit', async () => {
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'managed-recorded-exit-stop' });
        const requestStop = vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' }));
        const reader = new PassThrough();
        reader.destroy = vi.fn(reader.destroy.bind(reader));
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged: vi.fn(async () => ({ child, handle })), requestStop },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn(async () => ({ id: 31, recordedId: 41, type: 'ts' })) },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.setVideFileInfo = vi.fn(async () => {
            model.videoFilePath = 'synthetic-recording.ts';
            model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
            model.videoFileType = 'ts';
            model.isRecording = true;
        });
        model.setFileStream = vi.fn(() => {
            model.fileStream = reader;
        });
        model.setOption({ cmd: '%NODE% synthetic-recorded-exit-stop', playPosition: 0, videoFileId: 31 }, 0);

        await model.start(0);
        child.emit('exit', 0);
        await expect(model.stop()).resolves.toBeUndefined();

        expect(requestStop).toHaveBeenCalledOnce();
        expect(requestStop).toHaveBeenCalledWith(handle);
        expect(reader.destroy).toHaveBeenCalledOnce();
        expect(child.kill).not.toHaveBeenCalled();
    });

    it('[PRIMARY R6.3] removes and finally notifies the exact stream once after partial cleanup failure', async () => {
        const cleanupFailure = new Error('synthetic direct stop cleanup failure');
        const logs = logger();
        const notifyClient = vi.fn();
        const target = fakeStream({ isEnable: true, type: 'LiveStream' });
        let emitOldExit = (): void => {
            throw new Error('old exit callback is not installed');
        };
        target.setExitStream.mockImplementation((callback: () => void) => {
            emitOldExit = callback;
        });
        target.stop.mockRejectedValueOnce(cleanupFailure);
        const manager = new StreamManageModel({ getLogger: () => logs }, executionManager(), { notifyClient });
        const streamId = await manager.start(target);
        const notificationCountBeforeStop = notifyClient.mock.calls.length;

        await Promise.all([manager.stop(streamId), manager.stop(streamId)]);

        expect(target.stop).toHaveBeenCalledOnce();
        expect(manager.getStreamInfos()).toEqual([]);
        expect(notifyClient).toHaveBeenCalledTimes(notificationCountBeforeStop + 2);
        expect(logs.stream.error).toHaveBeenCalledWith(cleanupFailure);

        const replacement = fakeStream({ isEnable: true, type: 'LiveStream' });
        await expect(manager.start(replacement)).resolves.toBe(streamId);
        const notificationCountBeforeOldExit = notifyClient.mock.calls.length;
        emitOldExit();
        await settleMicrotasks();

        expect((manager as any).streams[streamId].stream).toBe(replacement);
        expect(replacement.stop).not.toHaveBeenCalled();
        expect(notifyClient).toHaveBeenCalledTimes(notificationCountBeforeOldExit);
        await manager.stop(streamId);
    });

    it('[MD-6.3] removes and finally notifies the stream when cleanup diagnostics throw', async () => {
        const cleanupFailure = new Error('synthetic direct stop cleanup failure');
        const diagnosticFailure = new Error('synthetic direct stop diagnostic failure');
        const logs = logger();
        logs.stream.error.mockImplementation(() => {
            throw diagnosticFailure;
        });
        const notifyClient = vi.fn();
        const target = fakeStream({ isEnable: true, type: 'RecordedStream' });
        target.stop.mockRejectedValueOnce(cleanupFailure);
        const manager = new StreamManageModel({ getLogger: () => logs }, executionManager(), { notifyClient });
        const streamId = await manager.start(target);
        const notificationCountBeforeStop = notifyClient.mock.calls.length;

        await expect(manager.stop(streamId)).resolves.toBeUndefined();

        expect(target.stop).toHaveBeenCalledOnce();
        expect(manager.getStreamInfos()).toEqual([]);
        expect(notifyClient).toHaveBeenCalledTimes(notificationCountBeforeStop + 2);
    });
});
