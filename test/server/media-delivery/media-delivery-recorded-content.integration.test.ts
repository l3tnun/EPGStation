import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, deferred, executionManager, fakeChild, fakeStream, logger } from './_media-harness';

const StreamApiModel = compiled<any>('model', 'api', 'stream', 'StreamApiModel.js').default;
const RecordedPlaybackSourceProvider = compiled<any>(
    'model',
    'operator',
    'recorded',
    'RecordedPlaybackSourceProvider.js',
).default;
const RecordedStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedStreamModel.js').default;
const RecordedHLSStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedHLSStreamModel.js').default;
const StreamBaseModel = compiled<any>('model', 'service', 'stream', 'base', 'StreamBaseModel.js').default;
const RecordedDeliveryLeaseConsumer = compiled<any>(
    'model',
    'service',
    'stream',
    'recorded',
    'RecordedDeliveryLeaseConsumer.js',
).default;
const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;
const VideoApiModel = compiled<any>('model', 'api', 'video', 'VideoApiModel.js').default;

describe('recorded content boundary', () => {
    it('[MD-2.2][MD-2.8] selects encoded configuration and rejects a missing video file', async () => {
        const stream = fakeStream({ type: 'RecordedStream' });
        const deliveryConsumer = {
            acquireAndOpen: vi.fn(async (videoFileId: number, playPosition: number) => {
                if (videoFileId === 404) throw new Error('RecordedPlaybackVideoFileNotFound');
                return {
                    release: async () => undefined,
                    source: {
                        inputPath: 'synthetic/encoded.mp4',
                        kind: 'encoded-direct' as const,
                        playPosition,
                        recordedId: 41,
                        videoFileId,
                        videoInfo: { bitRate: 8, duration: 60, size: 480 },
                    },
                };
            }),
        };
        const api = new StreamApiModel(
            { getConfig: () => baseConfig() },
            async () => fakeStream(),
            async () => fakeStream(),
            async () => stream,
            async () => fakeStream(),
            new StreamManageModel(
                { getLogger: logger },
                executionManager(),
                { notifyClient: vi.fn() },
                undefined,
                deliveryConsumer,
            ),
            {},
            {},
            {},
            {},
            {},
            deliveryConsumer,
        );
        await api.startRecordedWebMStream({ mode: 0, playPosition: 0, videoFileId: 31 });
        expect(stream.setOption).toHaveBeenCalledWith(
            { cmd: '%NODE% encoded-webm', playPosition: 0, videoFileId: 31 },
            0,
        );
        await expect(api.startRecordedWebMStream({ mode: 0, playPosition: 0, videoFileId: 404 })).rejects.toThrow(
            'VideoIsNull',
        );
    });

    it('[MD-2.1][MD-2.3][MD-2.4][MD-6.2] makes the public transformed start adopt the provider source and exact-release its lease at terminal stop', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-media-recorded-provider-'));
        const filePath = join(dir, 'recorded.ts');
        writeFileSync(filePath, '0123456789');
        const videoFileDB = { findId: vi.fn(async () => ({ id: 31, recordedId: 41, type: 'ts' })) };
        const recordedDB = { findId: vi.fn(async () => ({ id: 41, isRecording: false })) };
        const videoUtil = {
            getFullFilePathFromVideoFile: vi.fn(() => filePath),
            getInfo: vi.fn(async () => ({ bitRate: 8, duration: 10, size: 10 })),
        };
        const release = vi.fn(async () => undefined);
        const deliveryConsumer = new RecordedDeliveryLeaseConsumer(
            new RecordedPlaybackSourceProvider(videoFileDB, recordedDB, videoUtil),
            { acquire: vi.fn(async () => ({ release })) },
        );
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'recorded-provider-process' });
        const requestStop = vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' }));
        const createManaged = vi.fn(async () => ({ child, handle }));
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged, requestStop },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        const api = new StreamApiModel(
            { getConfig: () => baseConfig() },
            async () => fakeStream(),
            async () => fakeStream(),
            async () => model,
            async () => fakeStream(),
            manager,
            {},
            videoFileDB,
            {},
            {},
            {},
            deliveryConsumer,
        );
        const chunks: Buffer[] = [];
        child.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
        const stdinEnded = new Promise<void>((resolve, reject) =>
            child.stdin.once('end', resolve).once('error', reject),
        );

        try {
            const { streamId } = await api.startRecordedWebMStream({ mode: 0, playPosition: 4, videoFileId: 31 });
            await stdinEnded;
            expect(Buffer.concat(chunks).toString()).toBe('456789');
            expect(videoFileDB.findId).toHaveBeenCalledTimes(2);
            expect(recordedDB.findId).toHaveBeenCalledOnce();
            expect(videoUtil.getFullFilePathFromVideoFile).toHaveBeenCalledWith({ id: 31, recordedId: 41, type: 'ts' });
            expect(videoUtil.getInfo).toHaveBeenCalledWith(filePath);
            expect(createManaged.mock.calls[0]?.[0].cmd).toContain('ts-webm');

            await api.stop(streamId);
            expect(requestStop).toHaveBeenCalledWith(handle);
            expect(manager.getStreamInfos()).toEqual([]);

            child.emit('exit', 0);
            await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
        } finally {
            await manager.stopAll();
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('[MD-2.1][MD-2.3] starts a transformed stream from the head of a recording whose probe reports no bit rate and releases its lease at stop', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-media-recorded-no-bitrate-'));
        const filePath = join(dir, 'recorded.ts');
        writeFileSync(filePath, '0123456789');
        const videoFileDB = { findId: vi.fn(async () => ({ id: 31, recordedId: 41, type: 'ts' })) };
        const recordedDB = { findId: vi.fn(async () => ({ id: 41, isRecording: false })) };
        const videoUtil = {
            getFullFilePathFromVideoFile: vi.fn(() => filePath),
            getInfo: vi.fn(async () => ({ bitRate: Number.NaN, duration: Number.NaN, size: 10 })),
        };
        const release = vi.fn(async () => undefined);
        const deliveryConsumer = new RecordedDeliveryLeaseConsumer(
            new RecordedPlaybackSourceProvider(videoFileDB, recordedDB, videoUtil),
            { acquire: vi.fn(async () => ({ release })) },
        );
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'recorded-no-bitrate-process' });
        const requestStop = vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' }));
        const createManaged = vi.fn(async () => ({ child, handle }));
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged, requestStop },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        const api = new StreamApiModel(
            { getConfig: () => baseConfig() },
            async () => fakeStream(),
            async () => fakeStream(),
            async () => model,
            async () => fakeStream(),
            manager,
            {},
            videoFileDB,
            {},
            {},
            {},
            deliveryConsumer,
        );
        const chunks: Buffer[] = [];
        child.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
        const stdinEnded = new Promise<void>((resolve, reject) =>
            child.stdin.once('end', resolve).once('error', reject),
        );

        try {
            const { streamId } = await api.startRecordedWebMStream({ mode: 0, playPosition: 0, videoFileId: 31 });
            await stdinEnded;
            expect(Buffer.concat(chunks).toString()).toBe('0123456789');

            await api.stop(streamId);
            child.emit('exit', 0);
            await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
        } finally {
            await manager.stopAll();
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('[MD-2.3][MD-2.12] fails a transformed start with the unavailable-start-position reason and releases its lease when the probe reports no bit rate and the play position is past the head', async () => {
        const videoFileDB = { findId: vi.fn(async () => ({ id: 31, recordedId: 41, type: 'ts' })) };
        const recordedDB = { findId: vi.fn(async () => ({ id: 41, isRecording: false })) };
        const videoUtil = {
            getFullFilePathFromVideoFile: vi.fn(() => 'synthetic/no-bitrate.ts'),
            getInfo: vi.fn(async () => ({ bitRate: Number.NaN, duration: 60, size: 10 })),
        };
        const release = vi.fn(async () => undefined);
        const deliveryConsumer = new RecordedDeliveryLeaseConsumer(
            new RecordedPlaybackSourceProvider(videoFileDB, recordedDB, videoUtil),
            { acquire: vi.fn(async () => ({ release })) },
        );
        const stream = fakeStream({ type: 'RecordedStream' });
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        const api = new StreamApiModel(
            { getConfig: () => baseConfig() },
            async () => fakeStream(),
            async () => fakeStream(),
            async () => stream,
            async () => fakeStream(),
            manager,
            {},
            videoFileDB,
            {},
            {},
            {},
            deliveryConsumer,
        );

        await expect(api.startRecordedWebMStream({ mode: 0, playPosition: 4, videoFileId: 31 })).rejects.toThrow(
            'RecordedPlaybackStartPositionUnavailable',
        );

        expect(stream.adoptPlaybackSource).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledOnce();
        expect(manager.getStreamInfos()).toEqual([]);
    });

    it('[MD-2.3][MD-2.12] exact-releases an adopted source once when public transformed start fails after provider adoption', async () => {
        const videoFileDB = { findId: vi.fn(async () => ({ id: 31, recordedId: 41, type: 'encoded' })) };
        const recordedDB = { findId: vi.fn(async () => ({ id: 41, isRecording: false })) };
        const videoUtil = {
            getFullFilePathFromVideoFile: vi.fn(() => 'synthetic/recorded.mp4'),
            getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 480 })),
        };
        const release = vi.fn(async () => {
            throw new Error('SyntheticRecordedLeaseReleaseFailure');
        });
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            {
                createManaged: vi.fn(async () => {
                    throw new Error('SyntheticProcessStartFailure');
                }),
                requestStop: vi.fn(),
            },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            {
                findId: vi.fn(() => {
                    throw new Error('RecordedStreamDbFallback');
                }),
            },
            {
                findId: vi.fn(() => {
                    throw new Error('RecordedStreamRecordedFallback');
                }),
            },
            {
                getFullFilePathFromId: vi.fn(() => {
                    throw new Error('RecordedStreamPathFallback');
                }),
            },
        );
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        const api = new StreamApiModel(
            { getConfig: () => baseConfig() },
            async () => fakeStream(),
            async () => fakeStream(),
            async () => model,
            async () => fakeStream(),
            manager,
            {},
            videoFileDB,
            {},
            {},
            {},
            new RecordedDeliveryLeaseConsumer(new RecordedPlaybackSourceProvider(videoFileDB, recordedDB, videoUtil), {
                acquire: vi.fn(async () => ({ release })),
            }),
        );

        await expect(api.startRecordedWebMStream({ mode: 0, playPosition: 4, videoFileId: 31 })).rejects.toThrow(
            'StreamStartStopped',
        );

        expect(release).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(manager.getStreamInfos()).toEqual([]));
    });

    it('[MD-2.3][MD-2.12] exact-releases an adopted source when public transformed configuration rejects', async () => {
        const config = baseConfig();
        delete config.stream.recorded.encoded.webm;
        const videoFileDB = { findId: vi.fn(async () => ({ id: 31, recordedId: 41, type: 'encoded' })) };
        const recordedDB = { findId: vi.fn(async () => ({ id: 41, isRecording: false })) };
        const videoUtil = {
            getFullFilePathFromVideoFile: vi.fn(() => 'synthetic/recorded.mp4'),
            getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 480 })),
        };
        const release = vi.fn(async () => undefined);
        const stream = fakeStream({ type: 'RecordedStream' });
        const streamProvider = vi.fn(async () => stream);
        stream.adoptPlaybackSource.mockImplementation((_source, release) => {
            stream.stop.mockImplementation(async () => {
                await release();
            });
        });
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            undefined,
            new RecordedDeliveryLeaseConsumer(new RecordedPlaybackSourceProvider(videoFileDB, recordedDB, videoUtil), {
                acquire: vi.fn(async () => ({ release })),
            }),
        );
        const api = new StreamApiModel(
            { getConfig: () => config },
            async () => fakeStream(),
            async () => fakeStream(),
            streamProvider,
            async () => fakeStream(),
            manager,
            {},
            videoFileDB,
            {},
            {},
            {},
        );

        await expect(api.startRecordedWebMStream({ mode: 0, playPosition: 4, videoFileId: 31 })).rejects.toThrow(
            'ConfigIsUndefined',
        );

        expect(streamProvider).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    });

    it('[MD-2.2][MD-6.2] releases the provider reader when the direct-delivery request closes during MIME detection', async () => {
        const mime = deferred<string>();
        const reader = { close: vi.fn(async () => undefined), readable: fakeChild().stdout };
        const release = vi.fn(async () => undefined);
        const consumer = {
            acquireAndOpen: vi.fn(async () => ({
                release,
                source: {
                    inputPath: 'synthetic/pending-mime.ts',
                    kind: 'recording-tail-reader' as const,
                    playPosition: 0,
                    reader,
                    recordedId: 41,
                    videoFileId: 31,
                    videoInfo: { bitRate: 8, duration: 60, size: 480 },
                },
            })),
        };
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            undefined,
            consumer,
        );
        const videoApi = new VideoApiModel({ getConfig: () => baseConfig() }, {}, {}, {}, {}, {}, manager);
        vi.spyOn(videoApi, 'createMime').mockImplementation(() => mime.promise);
        let active = true;
        const opening = videoApi.openDelivery(31, () => active);

        await vi.waitFor(() => expect(consumer.acquireAndOpen).toHaveBeenCalledOnce());
        active = false;
        mime.resolve('video/mp2t');

        await expect(opening).rejects.toThrow('RecordedDeliveryStopped');
        expect(reader.close).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledOnce();
    });

    it('[MD-2.3][MD-4.7][MD-6.2] releases a managed recorded HLS delivery only after its stop terminal completes', async () => {
        const terminal = deferred<void>();
        const release = vi.fn(async () => undefined);
        const consumer = {
            acquireAndOpen: vi.fn(async () => ({
                release,
                source: {
                    inputPath: 'synthetic/managed-hls.mp4',
                    kind: 'encoded-direct' as const,
                    playPosition: 4,
                    recordedId: 41,
                    videoFileId: 31,
                    videoInfo: { bitRate: 8, duration: 60, size: 480 },
                },
            })),
        };
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            undefined,
            consumer,
        );
        const stream = fakeStream({ isEnable: true, mode: 0, type: 'RecordedHLS', videoFileId: 31 });
        stream.adoptPlaybackSource.mockImplementation((_source, releaseSource) => {
            stream.stop.mockImplementation(async () => {
                await terminal.promise;
                await releaseSource();
            });
        });
        const api = new StreamApiModel(
            { getConfig: () => baseConfig() },
            async () => fakeStream(),
            async () => fakeStream(),
            async () => fakeStream(),
            async () => stream,
            manager,
            {},
            {},
            {},
            {},
            {},
            consumer,
        );
        const streamId = await api.startRecordedHLSStream({ mode: 0, playPosition: 4, videoFileId: 31 });

        const stopping = manager.stop(streamId);
        await vi.waitFor(() => expect(stream.stop).toHaveBeenCalledOnce());
        expect(release).not.toHaveBeenCalled();

        terminal.resolve();
        await stopping;

        expect(release).toHaveBeenCalledOnce();
        expect(manager.getStreamInfos()).toEqual([]);
    });

    it('[MD-2.3][MD-6.2] keeps an adopted recorded lease until the managed child reaches a terminal event', async () => {
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'recorded-provider-terminal-child' });
        const release = vi.fn(async () => undefined);
        const requestStop = vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' }));
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged: vi.fn(async () => ({ child, handle })), requestStop },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/managed.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            release,
        );
        model.setOption({ cmd: '%NODE% encoded-webm', playPosition: 0, videoFileId: 31 }, 0);

        await model.start(0);
        await model.stop();

        expect(requestStop).toHaveBeenCalledWith(handle);
        expect(release).not.toHaveBeenCalled();

        child.emit('exit', 0);
        await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    });

    it('[MD-2.3][MD-6.2] does not create a recorded managed process after stop settles before process-option construction', async () => {
        const option = deferred<any>();
        const optionEntered = deferred<void>();
        const release = vi.fn(async () => undefined);
        const createManaged = vi.fn(async () => ({
            child: fakeChild(),
            handle: Object.freeze({ kind: 'unexpected' }),
        }));
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged, requestStop: vi.fn() },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/stopped-before-option.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            release,
        );
        model.setOption({ cmd: '%NODE% encoded-webm', playPosition: 0, videoFileId: 31 }, 0);
        model.createProcessOption = vi.fn(() => {
            optionEntered.resolve();
            return option.promise;
        });

        const starting = model.start(0);
        await optionEntered.promise;
        await model.stop();
        option.resolve({
            cmd: '%NODE% encoded-webm',
            input: 'synthetic/stopped-before-option.mp4',
            output: null,
            priority: 1,
        });
        await starting;

        expect(createManaged).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledOnce();
    });

    it('[MD-2.3][MD-6.2] prevents an older recorded managed start from replacing a newer generation', async () => {
        const firstOption = deferred<any>();
        const firstOptionEntered = deferred<void>();
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'newer-recorded-managed' });
        const release = vi.fn(async () => undefined);
        const createManaged = vi.fn(async () => ({ child, handle }));
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged, requestStop: vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' })) },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/newer-recorded-managed.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            release,
        );
        model.setOption({ cmd: '%NODE% encoded-webm', playPosition: 0, videoFileId: 31 }, 0);
        model.createProcessOption = vi
            .fn()
            .mockImplementationOnce(() => {
                firstOptionEntered.resolve();
                return firstOption.promise;
            })
            .mockResolvedValue({
                cmd: '%NODE% encoded-webm',
                input: 'synthetic/newer-recorded-managed.mp4',
                output: null,
                priority: 1,
            });

        const olderStart = model.start(0);
        await firstOptionEntered.promise;
        await model.start(1);
        firstOption.resolve({
            cmd: '%NODE% encoded-webm',
            input: 'synthetic/newer-recorded-managed.mp4',
            output: null,
            priority: 1,
        });
        await olderStart;

        expect(createManaged).toHaveBeenCalledOnce();

        await model.stop();
        expect(release).not.toHaveBeenCalled();
        child.emit('exit', 0);
        await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    });

    it('[MD-2.3][MD-6.2] stops only an older managed child that arrives after a newer generation starts', async () => {
        const olderProcess = deferred<any>();
        const olderHandle = Object.freeze({ kind: 'older-recorded-managed' });
        const currentHandle = Object.freeze({ kind: 'current-recorded-managed' });
        const currentChild = fakeChild();
        const requestStop = vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' }));
        const createManaged = vi
            .fn()
            .mockImplementationOnce(() => olderProcess.promise)
            .mockResolvedValue({ child: currentChild, handle: currentHandle });
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged, requestStop },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/older-managed-child.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            async () => undefined,
        );
        model.setOption({ cmd: '%NODE% encoded-webm', playPosition: 0, videoFileId: 31 }, 0);

        const olderStart = model.start(0);
        await vi.waitFor(() => expect(createManaged).toHaveBeenCalledOnce());
        await model.start(1);
        olderProcess.resolve({ child: fakeChild(), handle: olderHandle });
        await olderStart;

        expect(requestStop).toHaveBeenCalledWith(olderHandle);
        expect(requestStop).not.toHaveBeenCalledWith(currentHandle);

        await model.stop();
        expect(requestStop).toHaveBeenCalledWith(currentHandle);
    });

    it('[MD-2.3][MD-6.2] keeps an adopted lease while an older managed start is pending after a newer generation stops', async () => {
        const olderProcess = deferred<any>();
        const olderChild = fakeChild();
        const currentChild = fakeChild();
        const olderHandle = Object.freeze({ kind: 'older-pending-recorded-managed' });
        const currentHandle = Object.freeze({ kind: 'current-recorded-managed-before-older-settles' });
        const release = vi.fn(async () => undefined);
        const requestStop = vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' }));
        const createManaged = vi
            .fn()
            .mockImplementationOnce(() => olderProcess.promise)
            .mockResolvedValue({ child: currentChild, handle: currentHandle });
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged, requestStop },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/older-pending-managed.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            release,
        );
        model.setOption({ cmd: '%NODE% encoded-webm', playPosition: 0, videoFileId: 31 }, 0);

        const olderStart = model.start(0);
        await vi.waitFor(() => expect(createManaged).toHaveBeenCalledTimes(1));
        await model.start(1);

        await model.stop();
        expect(requestStop).toHaveBeenCalledWith(currentHandle);
        currentChild.emit('close', 0);
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(release).not.toHaveBeenCalled();

        olderProcess.resolve({ child: olderChild, handle: olderHandle });
        await olderStart;
        expect(requestStop).toHaveBeenCalledWith(olderHandle);
        expect(release).not.toHaveBeenCalled();

        olderChild.emit('close', 0);
        await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    });

    it('[MD-2.3][MD-6.2] stops only the accepted HLS generation and releases after the replacement writer terminal stop', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-media-recorded-hls-stop-generation-'));
        const acceptedWriterStop = deferred<any>();
        const replacementWriterStop = deferred<any>();
        const acceptedStopBoundary = deferred<void>();
        const acceptedHandle = Object.freeze({ kind: 'accepted-hls-writer' });
        const replacementHandle = Object.freeze({ kind: 'replacement-hls-writer' });
        const release = vi.fn(async () => undefined);
        const stopHls = vi.fn(handle => {
            if (handle === acceptedHandle) return acceptedWriterStop.promise;
            if (handle === replacementHandle) return replacementWriterStop.promise;
            throw new Error('unexpected HLS writer handle');
        });
        const createHlsWriter = vi
            .fn()
            .mockResolvedValueOnce({ child: fakeChild(), handle: acceptedHandle })
            .mockResolvedValueOnce({ child: fakeChild(), handle: replacementHandle });
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            { createHlsWriter, stopHls },
            {
                deleteAllFiles: vi.fn(async () => ({ passes: 1, remainingFiles: [], status: 'cleared' })),
                setOption: vi.fn(),
            },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        const baseStop = vi
            .spyOn(StreamBaseModel.prototype, 'stop')
            .mockImplementationOnce(() => acceptedStopBoundary.promise);
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/accepted-then-replacement-hls.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            release,
        );
        model.setOption({ cmd: '%NODE% encoded-hls', playPosition: 0, videoFileId: 31 }, 0);

        try {
            await model.start(0);
            const acceptedStop = model.stop();
            const repeatedAcceptedStop = model.stop();
            expect(repeatedAcceptedStop).toBe(acceptedStop);
            await vi.waitFor(() => expect(baseStop).toHaveBeenCalledOnce());

            await model.start(1);
            expect(stopHls).not.toHaveBeenCalled();

            acceptedStopBoundary.resolve();
            await vi.waitFor(() => expect(stopHls).toHaveBeenCalledWith(acceptedHandle));
            expect(stopHls).not.toHaveBeenCalledWith(replacementHandle);

            baseStop.mockRestore();
            const replacementStop = model.stop();
            await vi.waitFor(() => expect(stopHls).toHaveBeenCalledWith(replacementHandle));
            expect(release).not.toHaveBeenCalled();

            acceptedWriterStop.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
            await acceptedStop;
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(release).not.toHaveBeenCalled();

            replacementWriterStop.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
            await replacementStop;
            await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());

            await model.stop();
            expect(release).toHaveBeenCalledOnce();
        } finally {
            acceptedStopBoundary.resolve();
            acceptedWriterStop.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
            replacementWriterStop.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
            baseStop.mockRestore();
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('[MD-2.3][MD-6.2] reuses an accepted HLS stop during synchronous exit reentrancy until its writer terminal', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-media-recorded-hls-reentrant-stop-'));
        const writerStop = deferred<any>();
        const writerHandle = Object.freeze({ kind: 'reentrant-hls-writer' });
        const release = vi.fn(async () => undefined);
        const stopHls = vi.fn(() => writerStop.promise);
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            { createHlsWriter: vi.fn(async () => ({ child: fakeChild(), handle: writerHandle })), stopHls },
            {
                deleteAllFiles: vi.fn(async () => ({ passes: 1, remainingFiles: [], status: 'cleared' })),
                setOption: vi.fn(),
            },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        let reentrantStop!: Promise<void>;
        let primarySettled = false;
        let reentrantSettled = false;
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/reentrant-hls-stop.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            release,
        );
        model.setOption({ cmd: '%NODE% encoded-hls', playPosition: 0, videoFileId: 31 }, 0);

        try {
            await model.start(0);
            model.setExitStream(() => {
                reentrantStop = model.stop();
            });

            const primaryStop = model.stop();
            void primaryStop.then(() => {
                primarySettled = true;
            });
            expect(reentrantStop).toBe(primaryStop);
            void reentrantStop.then(() => {
                reentrantSettled = true;
            });

            await vi.waitFor(() => expect(stopHls).toHaveBeenCalledWith(writerHandle));
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(primarySettled).toBe(false);
            expect(reentrantSettled).toBe(false);
            expect(stopHls).toHaveBeenCalledOnce();
            expect(release).not.toHaveBeenCalled();

            writerStop.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
            await Promise.all([primaryStop, reentrantStop]);
            await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
            expect(stopHls).toHaveBeenCalledOnce();
            expect(model.pendingProcessStartGenerations.size).toBe(0);
            expect(model.pendingHlsWriterStops.size).toBe(0);
            expect(model.activeHlsWriterFinalizations.size).toBe(0);
        } finally {
            writerStop.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('[MD-2.3][MD-6.2] reuses a no-generation stop during synchronous exit reentrancy', async () => {
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged: vi.fn(), requestStop: vi.fn() },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        let reentrantStop!: Promise<void>;
        const baseStop = vi.spyOn(StreamBaseModel.prototype, 'stop');
        model.setExitStream(() => {
            reentrantStop = model.stop();
        });

        try {
            const primaryStop = model.stop();

            expect(reentrantStop).toBe(primaryStop);
            await Promise.all([primaryStop, reentrantStop]);
            expect(baseStop).toHaveBeenCalledOnce();
        } finally {
            baseStop.mockRestore();
        }
    });

    it('[MD-2.3][MD-6.2] keeps an adopted lease while a replacement HLS writer remains running after the accepted writer stops', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-media-recorded-hls-replacement-running-'));
        const acceptedWriterStop = deferred<any>();
        const replacementWriterStop = deferred<any>();
        const acceptedStopBoundary = deferred<void>();
        const acceptedHandle = Object.freeze({ kind: 'accepted-hls-writer-before-replacement-stop' });
        const replacementHandle = Object.freeze({ kind: 'replacement-hls-writer-still-running' });
        const release = vi.fn(async () => undefined);
        const stopHls = vi.fn(handle => {
            if (handle === acceptedHandle) return acceptedWriterStop.promise;
            if (handle === replacementHandle) return replacementWriterStop.promise;
            throw new Error('unexpected HLS writer handle');
        });
        const createHlsWriter = vi
            .fn()
            .mockResolvedValueOnce({ child: fakeChild(), handle: acceptedHandle })
            .mockResolvedValueOnce({ child: fakeChild(), handle: replacementHandle });
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            { createHlsWriter, stopHls },
            {
                deleteAllFiles: vi.fn(async () => ({ passes: 1, remainingFiles: [], status: 'cleared' })),
                setOption: vi.fn(),
            },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        const baseStop = vi
            .spyOn(StreamBaseModel.prototype, 'stop')
            .mockImplementationOnce(() => acceptedStopBoundary.promise);
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/accepted-then-running-replacement-hls.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            release,
        );
        model.setOption({ cmd: '%NODE% encoded-hls', playPosition: 0, videoFileId: 31 }, 0);

        try {
            await model.start(0);
            const acceptedStop = model.stop();
            await vi.waitFor(() => expect(baseStop).toHaveBeenCalledOnce());

            await model.start(1);
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(release).not.toHaveBeenCalled();
            acceptedStopBoundary.resolve();
            await vi.waitFor(() => expect(stopHls).toHaveBeenCalledWith(acceptedHandle));

            acceptedWriterStop.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
            await acceptedStop;
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(release).not.toHaveBeenCalled();

            baseStop.mockRestore();
            const replacementStop = model.stop();
            await vi.waitFor(() => expect(stopHls).toHaveBeenCalledWith(replacementHandle));
            expect(release).not.toHaveBeenCalled();

            replacementWriterStop.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
            await replacementStop;
            await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
        } finally {
            acceptedStopBoundary.resolve();
            acceptedWriterStop.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
            replacementWriterStop.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
            baseStop.mockRestore();
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('[MD-2.3][MD-6.2] keeps a current HLS writer running while it stops an older writer generation', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-media-recorded-hls-generation-'));
        const olderWriter = deferred<any>();
        const currentChild = fakeChild();
        const olderHandle = Object.freeze({ kind: 'older-hls-writer' });
        const currentHandle = Object.freeze({ kind: 'current-hls-writer' });
        const stopHls = vi.fn(async () => ({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true }));
        const createHlsWriter = vi
            .fn()
            .mockImplementationOnce(() => olderWriter.promise)
            .mockResolvedValue({ child: currentChild, handle: currentHandle });
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            { createHlsWriter, stopHls },
            {
                deleteAllFiles: vi.fn(async () => ({ passes: 1, remainingFiles: [], status: 'cleared' })),
                setOption: vi.fn(),
            },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/hls-generation.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            async () => undefined,
        );
        model.setOption({ cmd: '%NODE% encoded-hls', playPosition: 0, videoFileId: 31 }, 0);

        try {
            const olderStart = model.start(0);
            await vi.waitFor(() => expect(createHlsWriter).toHaveBeenCalledOnce());
            await model.start(1);
            expect(stopHls).not.toHaveBeenCalled();

            olderWriter.resolve({ child: fakeChild(), handle: olderHandle });
            await olderStart;

            expect(stopHls).toHaveBeenCalledWith(olderHandle);
            await model.stop();
            expect(stopHls).toHaveBeenCalledWith(currentHandle);
        } finally {
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('[MD-2.3][MD-6.2] keeps an adopted lease until the current stopped HLS writer finalizes after an older generation settles', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-media-recorded-hls-overlapping-generations-'));
        const olderWriter = deferred<any>();
        const currentWriter = deferred<any>();
        const currentWriterStop = deferred<any>();
        const olderHandle = Object.freeze({ kind: 'older-overlapping-hls-writer' });
        const currentHandle = Object.freeze({ kind: 'current-overlapping-hls-writer' });
        const release = vi.fn(async () => undefined);
        const createHlsWriter = vi
            .fn()
            .mockImplementationOnce(() => olderWriter.promise)
            .mockImplementationOnce(() => currentWriter.promise);
        const stopHls = vi.fn(handle => {
            if (handle === currentHandle) {
                return currentWriterStop.promise;
            }
            return Promise.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
        });
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            { createHlsWriter, stopHls },
            {
                deleteAllFiles: vi.fn(async () => ({ passes: 1, remainingFiles: [], status: 'cleared' })),
                setOption: vi.fn(),
            },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/overlapping-hls-generations.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            release,
        );
        model.setOption({ cmd: '%NODE% encoded-hls', playPosition: 0, videoFileId: 31 }, 0);

        try {
            const olderStart = model.start(0);
            await vi.waitFor(() => expect(createHlsWriter).toHaveBeenCalledTimes(1));

            const currentStart = model.start(1);
            await vi.waitFor(() => expect(createHlsWriter).toHaveBeenCalledTimes(2));

            await model.stop();
            expect(release).not.toHaveBeenCalled();

            olderWriter.resolve({ child: fakeChild(), handle: olderHandle });
            await olderStart;
            expect(stopHls).toHaveBeenCalledWith(olderHandle);
            expect(release).not.toHaveBeenCalled();

            currentWriter.resolve({ child: fakeChild(), handle: currentHandle });
            await vi.waitFor(() => expect(stopHls).toHaveBeenCalledWith(currentHandle));
            expect(release).not.toHaveBeenCalled();

            currentWriterStop.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
            await currentStart;
            await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
        } finally {
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('[MD-2.3][MD-6.2] keeps an adopted lease while an older HLS writer is pending after a newer generation stops', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-media-recorded-hls-pending-older-generation-'));
        const olderWriter = deferred<any>();
        const currentWriterStop = deferred<any>();
        const olderHandle = Object.freeze({ kind: 'older-pending-hls-writer' });
        const currentHandle = Object.freeze({ kind: 'current-hls-writer-before-older-settles' });
        const release = vi.fn(async () => undefined);
        const createHlsWriter = vi
            .fn()
            .mockImplementationOnce(() => olderWriter.promise)
            .mockResolvedValue({ child: fakeChild(), handle: currentHandle });
        const stopHls = vi.fn(handle => {
            if (handle === currentHandle) {
                return currentWriterStop.promise;
            }
            return Promise.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
        });
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            { createHlsWriter, stopHls },
            {
                deleteAllFiles: vi.fn(async () => ({ passes: 1, remainingFiles: [], status: 'cleared' })),
                setOption: vi.fn(),
            },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/older-pending-hls.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            release,
        );
        model.setOption({ cmd: '%NODE% encoded-hls', playPosition: 0, videoFileId: 31 }, 0);

        try {
            const olderStart = model.start(0);
            await vi.waitFor(() => expect(createHlsWriter).toHaveBeenCalledTimes(1));
            await model.start(1);

            const stopping = model.stop();
            await vi.waitFor(() => expect(stopHls).toHaveBeenCalledWith(currentHandle));

            currentWriterStop.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
            await stopping;
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(release).not.toHaveBeenCalled();

            olderWriter.resolve({ child: fakeChild(), handle: olderHandle });
            await olderStart;
            expect(stopHls).toHaveBeenCalledWith(olderHandle);
            await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
        } finally {
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('[MD-2.3][MD-4.7][MD-6.2] keeps an adopted lease until the current stopped HLS writer finalizes after an older writer fails', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-media-recorded-hls-overlapping-failure-'));
        const olderWriter = deferred<any>();
        const currentWriter = deferred<any>();
        const currentWriterStop = deferred<any>();
        const olderFailure = new Error('OlderRecordedHlsWriterFailure');
        const currentHandle = Object.freeze({ kind: 'current-overlapping-hls-writer-after-failure' });
        const release = vi.fn(async () => undefined);
        const createHlsWriter = vi
            .fn()
            .mockImplementationOnce(() => olderWriter.promise)
            .mockImplementationOnce(() => currentWriter.promise);
        const stopHls = vi.fn(handle => {
            if (handle === currentHandle) {
                return currentWriterStop.promise;
            }
            return Promise.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
        });
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            { createHlsWriter, stopHls },
            {
                deleteAllFiles: vi.fn(async () => ({ passes: 1, remainingFiles: [], status: 'cleared' })),
                setOption: vi.fn(),
            },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/overlapping-hls-writer-failure.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            release,
        );
        model.setOption({ cmd: '%NODE% encoded-hls', playPosition: 0, videoFileId: 31 }, 0);

        try {
            const olderStart = model.start(0);
            await vi.waitFor(() => expect(createHlsWriter).toHaveBeenCalledTimes(1));

            const currentStart = model.start(1);
            await vi.waitFor(() => expect(createHlsWriter).toHaveBeenCalledTimes(2));

            await model.stop();
            expect(release).not.toHaveBeenCalled();

            olderWriter.reject(olderFailure);
            await expect(olderStart).rejects.toThrow(olderFailure);
            expect(release).not.toHaveBeenCalled();

            currentWriter.resolve({ child: fakeChild(), handle: currentHandle });
            await vi.waitFor(() => expect(stopHls).toHaveBeenCalledWith(currentHandle));
            expect(release).not.toHaveBeenCalled();

            currentWriterStop.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
            await currentStart;
            await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
        } finally {
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('[MD-2.3][MD-6.2] preserves the managed-start error that arrives after stop acceptance', async () => {
        const processStart = deferred<any>();
        const release = vi.fn(async () => undefined);
        const startFailure = new Error('RecordedManagedStartAfterStopFailure');
        const createManaged = vi.fn(() => processStart.promise);
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged, requestStop: vi.fn() },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/managed-start-failure.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            release,
        );
        model.setOption({ cmd: '%NODE% encoded-webm', playPosition: 0, videoFileId: 31 }, 0);

        const starting = model.start(0);
        await vi.waitFor(() => expect(createManaged).toHaveBeenCalledOnce());
        await model.stop();
        processStart.reject(startFailure);

        await expect(starting).rejects.toThrow(startFailure);
        expect(release).toHaveBeenCalledOnce();
    });

    it('[MD-2.3][MD-6.2] preserves an older managed-start rejection without stopping a newer generation', async () => {
        const olderProcess = deferred<any>();
        const currentChild = fakeChild();
        const currentHandle = Object.freeze({ kind: 'current-after-older-rejection' });
        const startFailure = new Error('OlderRecordedManagedStartFailure');
        const requestStop = vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' }));
        const createManaged = vi
            .fn()
            .mockImplementationOnce(() => olderProcess.promise)
            .mockResolvedValue({ child: currentChild, handle: currentHandle });
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged, requestStop },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/older-managed-rejection.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            async () => undefined,
        );
        model.setOption({ cmd: '%NODE% encoded-webm', playPosition: 0, videoFileId: 31 }, 0);

        const olderStart = model.start(0);
        await vi.waitFor(() => expect(createManaged).toHaveBeenCalledOnce());
        await model.start(1);
        olderProcess.reject(startFailure);

        await expect(olderStart).rejects.toThrow(startFailure);
        expect(requestStop).not.toHaveBeenCalled();

        await model.stop();
        expect(requestStop).toHaveBeenCalledWith(currentHandle);
    });

    it('[MD-2.3][MD-6.2] keeps an adopted recorded lease when a managed child arrives after stop acceptance', async () => {
        const processStart = deferred<any>();
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'recorded-provider-late-child' });
        const release = vi.fn(async () => undefined);
        const requestStop = vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' }));
        const createManaged = vi.fn(() => processStart.promise);
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged, requestStop },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/late-managed.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            release,
        );
        model.setOption({ cmd: '%NODE% encoded-webm', playPosition: 0, videoFileId: 31 }, 0);

        const starting = model.start(0);
        await vi.waitFor(() => expect(createManaged).toHaveBeenCalledOnce());
        await model.stop();
        expect(release).not.toHaveBeenCalled();

        processStart.resolve({ child, handle });
        await starting;

        expect(requestStop).toHaveBeenCalledWith(handle);
        expect(release).not.toHaveBeenCalled();

        child.emit('close', 0);
        await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    });

    it('[MD-2.3][MD-6.2] keeps an adopted recorded lease until a late HLS writer finalizes', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-media-recorded-hls-late-'));
        const writerStart = deferred<any>();
        const writerStop = deferred<any>();
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'hls-writer' });
        const release = vi.fn(async () => undefined);
        const createHlsWriter = vi.fn(() => writerStart.promise);
        const stopHls = vi.fn(() => writerStop.promise);
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            { createHlsWriter, stopHls },
            {
                deleteAllFiles: vi.fn(async () => ({ passes: 1, remainingFiles: [], status: 'cleared' })),
                setOption: vi.fn(),
            },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/late-hls.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            release,
        );
        model.setOption({ cmd: '%NODE% encoded-hls', playPosition: 0, videoFileId: 31 }, 0);

        try {
            const starting = model.start(0);
            await vi.waitFor(() => expect(createHlsWriter).toHaveBeenCalledOnce());
            await model.stop();
            expect(release).not.toHaveBeenCalled();

            writerStart.resolve({ child, handle });
            await vi.waitFor(() => expect(stopHls).toHaveBeenCalledWith(handle));
            expect(release).not.toHaveBeenCalled();

            writerStop.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
            await starting;
            await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
        } finally {
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('[MD-2.3][MD-6.2] exact-releases a provider lease after a normal HLS writer stop finalizes', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-media-recorded-hls-normal-stop-'));
        const inputPath = join(dir, 'recorded.mp4');
        writeFileSync(inputPath, 'recorded-input');
        const writerStop = deferred<any>();
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'normal-hls-writer' });
        const release = vi.fn(async () => undefined);
        const videoFileDB = { findId: vi.fn(async () => ({ id: 31, recordedId: 41, type: 'encoded' })) };
        const recordedDB = { findId: vi.fn(async () => ({ id: 41, isRecording: false })) };
        const videoUtil = {
            getFullFilePathFromVideoFile: vi.fn(() => inputPath),
            getInfo: vi.fn(async () => ({ bitRate: 8, duration: 60, size: 480 })),
        };
        const deliveryConsumer = new RecordedDeliveryLeaseConsumer(
            new RecordedPlaybackSourceProvider(videoFileDB, recordedDB, videoUtil),
            { acquire: vi.fn(async () => ({ release })) },
        );
        const acquired = await deliveryConsumer.acquireAndOpen(31, 0);
        const stopHls = vi.fn(() => writerStop.promise);
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            { createHlsWriter: vi.fn(async () => ({ child, handle })), stopHls },
            {
                deleteAllFiles: vi.fn(async () => ({ passes: 1, remainingFiles: [], status: 'cleared' })),
                setOption: vi.fn(),
            },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.adoptPlaybackSource(acquired.source, () => acquired.release());
        model.setOption({ cmd: '%NODE% encoded-hls', playPosition: 0, videoFileId: 31 }, 0);

        try {
            await model.start(0);

            const stopping = model.stop();
            await vi.waitFor(() => expect(stopHls).toHaveBeenCalledWith(handle));
            expect(release).not.toHaveBeenCalled();

            writerStop.resolve({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
            await stopping;
            await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());

            await model.stop();
            expect(release).toHaveBeenCalledOnce();
        } finally {
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('[MD-2.3][MD-4.7][MD-6.2] releases an adopted HLS lease only after a stopped writer start failure finalizes', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-media-recorded-hls-start-failure-'));
        const writerStart = deferred<any>();
        const release = vi.fn(async () => undefined);
        const startFailure = new Error('RecordedHlsWriterStartAfterStopFailure');
        const createHlsWriter = vi.fn(() => writerStart.promise);
        const logs = logger();
        const fileDeleter = {
            deleteAllFiles: vi
                .fn()
                .mockResolvedValueOnce({ passes: 1, remainingFiles: [], status: 'cleared' })
                .mockResolvedValueOnce({ passes: 1, remainingFiles: ['stream0-late.ts'], status: 'remaining' }),
            setOption: vi.fn(),
        };
        const model = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: () => logs },
            { createHlsWriter, stopHls: vi.fn() },
            fileDeleter,
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/hls-start-failure.mp4',
                kind: 'encoded-direct',
                playPosition: 0,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            release,
        );
        model.setOption({ cmd: '%NODE% encoded-hls', playPosition: 0, videoFileId: 31 }, 0);

        try {
            const starting = model.start(0);
            await vi.waitFor(() => expect(createHlsWriter).toHaveBeenCalledOnce());
            await model.stop();
            expect(release).not.toHaveBeenCalled();

            writerStart.reject(startFailure);

            await expect(starting).rejects.toThrow(startFailure);
            await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
            expect(fileDeleter.deleteAllFiles).toHaveBeenCalledTimes(2);
            model.finalizeStop();
            expect(logs.stream.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    artifactCleanup: { passes: 1, remainingFiles: ['stream0-late.ts'], status: 'remaining' },
                    event: 'hls-stop-finalization',
                    forceReleased: true,
                    streamId: 0,
                    streamType: 'RecordedHLS',
                }),
            );
        } finally {
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('[MD-2.12][MD-7.1] settles a pending recorded provider at the manager deadline and exact-releases its late result', async () => {
        vi.useFakeTimers();
        try {
            const opened = deferred<any>();
            const deliveryConsumer = { acquireAndOpen: vi.fn(() => opened.promise) };
            const manager = new StreamManageModel(
                { getLogger: logger },
                executionManager(),
                { notifyClient: vi.fn() },
                undefined,
                deliveryConsumer,
            );
            const stream = fakeStream({ type: 'RecordedStream' });
            const api = new StreamApiModel(
                { getConfig: () => baseConfig() },
                async () => fakeStream(),
                async () => fakeStream(),
                async () => stream,
                async () => fakeStream(),
                manager,
                {},
                {},
                {},
                {},
                {},
                deliveryConsumer,
            );
            let settlement: unknown;
            const starting = api.startRecordedWebMStream({ mode: 0, playPosition: 4, videoFileId: 31 }).then(
                () => {
                    settlement = 'resolved';
                },
                error => {
                    settlement = error;
                },
            );

            await vi.advanceTimersByTimeAsync(30_000);

            expect(settlement).toMatchObject({ message: 'StreamStartTimeout' });
            expect(manager.getStreamInfos()).toEqual([]);
            expect(stream.start).not.toHaveBeenCalled();

            const reader = { close: vi.fn(async () => undefined), readable: fakeChild().stdout };
            const release = vi.fn(async () => undefined);
            opened.resolve({
                release,
                source: {
                    inputPath: 'synthetic/late-recorded.ts',
                    kind: 'recording-tail-reader' as const,
                    playPosition: 4,
                    reader,
                    recordedId: 41,
                    videoFileId: 31,
                    videoInfo: { bitRate: 8, duration: 60, size: 480 },
                },
            });
            await starting;
            await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
            expect(reader.close).toHaveBeenCalledOnce();
            expect(stream.adoptPlaybackSource).not.toHaveBeenCalled();
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('[MD-2.12] settles acquireRecordedDelivery at the start deadline and exact-releases its late tail reader', async () => {
        vi.useFakeTimers();
        try {
            const opened = deferred<any>();
            const deliveryConsumer = { acquireAndOpen: vi.fn(() => opened.promise) };
            const manager = new StreamManageModel(
                { getLogger: logger },
                executionManager(),
                { notifyClient: vi.fn() },
                undefined,
                deliveryConsumer,
            );

            const acquiring = manager.acquireRecordedDelivery(31, 0);
            const timeoutRejection = expect(acquiring).rejects.toThrow('StreamStartTimeout');

            await vi.advanceTimersByTimeAsync(30_000);
            await timeoutRejection;

            expect(deliveryConsumer.acquireAndOpen).toHaveBeenCalledOnce();
            expect(deliveryConsumer.acquireAndOpen).toHaveBeenCalledWith(31, 0, expect.any(Function), {
                allowMissingVideoInfo: true,
            });

            const reader = { close: vi.fn(async () => undefined), readable: fakeChild().stdout };
            const release = vi.fn(async () => undefined);
            opened.resolve({
                release,
                source: {
                    inputPath: 'synthetic/late-acquire-recorded.ts',
                    kind: 'recording-tail-reader' as const,
                    playPosition: 0,
                    reader,
                    recordedId: 41,
                    videoFileId: 31,
                    videoInfo: { bitRate: 8, duration: 60, size: 480 },
                },
            });
            await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
            expect(reader.close).toHaveBeenCalledOnce();
            expect(manager.getStreamInfos()).toEqual([]);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('[MD-2.12] rejects acquireRecordedDelivery with StreamStartStopped when isActive flips false before late open', async () => {
        vi.useFakeTimers();
        try {
            const opened = deferred<any>();
            const deliveryConsumer = { acquireAndOpen: vi.fn(() => opened.promise) };
            const manager = new StreamManageModel(
                { getLogger: logger },
                executionManager(),
                { notifyClient: vi.fn() },
                undefined,
                deliveryConsumer,
            );

            let active = true;
            const acquiring = manager.acquireRecordedDelivery(31, 0, () => active);
            const stoppedRejection = expect(acquiring).rejects.toThrow('StreamStartStopped');

            await vi.waitFor(() => expect(deliveryConsumer.acquireAndOpen).toHaveBeenCalledOnce());
            active = false;

            const reader = { close: vi.fn(async () => undefined), readable: fakeChild().stdout };
            const release = vi.fn(async () => undefined);
            opened.resolve({
                release,
                source: {
                    inputPath: 'synthetic/inactive-late-acquire-recorded.ts',
                    kind: 'recording-tail-reader' as const,
                    playPosition: 0,
                    reader,
                    recordedId: 41,
                    videoFileId: 31,
                    videoInfo: { bitRate: 8, duration: 60, size: 480 },
                },
            });

            await stoppedRejection;
            await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
            expect(reader.close).toHaveBeenCalledOnce();
            expect(manager.getStreamInfos()).toEqual([]);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('[MD-2.3][MD-4.1][MD-6.2] retains a starting recorded list item and exact-cleans a reader delivered after explicit stop', async () => {
        const opened = deferred<any>();
        const consumer = { acquireAndOpen: vi.fn(() => opened.promise) };
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            undefined,
            consumer,
        );
        const stream = fakeStream({ type: 'RecordedStream' });
        const api = new StreamApiModel(
            { getConfig: () => baseConfig() },
            async () => fakeStream(),
            async () => fakeStream(),
            async () => stream,
            async () => fakeStream(),
            manager,
            {},
            {},
            {},
            {},
            {},
            consumer,
        );
        const starting = api.startRecordedWebMStream({ mode: 0, playPosition: 4, videoFileId: 31 });

        await vi.waitFor(() => expect(consumer.acquireAndOpen).toHaveBeenCalledOnce());
        const startingInfos = manager.getStreamInfos();
        await manager.stop(0);

        const reader = { close: vi.fn(async () => undefined), readable: fakeChild().stdout };
        const release = vi.fn(async () => undefined);
        opened.resolve({
            release,
            source: {
                inputPath: 'synthetic/stopped-late-recording.ts',
                kind: 'recording-tail-reader' as const,
                playPosition: 4,
                reader,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
        });

        await expect(starting).rejects.toThrow('StreamStartStopped');
        await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());

        expect(startingInfos).toEqual([
            {
                info: { isEnable: false, mode: 0, type: 'RecordedStream', videoFileId: 31 },
                streamId: 0,
            },
        ]);
        expect(reader.close).toHaveBeenCalledOnce();
        expect(stream.adoptPlaybackSource).not.toHaveBeenCalled();
        expect(manager.getStreamInfos()).toEqual([]);
    });

    it('[MD-2.12] preserves the stream-construction error when the unadopted lease release rejects', async () => {
        const releaseFailure = new Error('SyntheticRecordedLeaseReleaseFailure');
        const release = vi.fn(async () => {
            throw releaseFailure;
        });
        const log = logger();
        const consumer = {
            acquireAndOpen: vi.fn(async () => ({
                release,
                source: {
                    inputPath: 'synthetic/recorded.mp4',
                    kind: 'encoded-direct' as const,
                    playPosition: 4,
                    recordedId: 41,
                    videoFileId: 31,
                    videoInfo: { bitRate: 8, duration: 60, size: 480 },
                },
            })),
        };
        const manager = new StreamManageModel(
            { getLogger: () => log },
            executionManager(),
            { notifyClient: vi.fn() },
            undefined,
            consumer,
        );
        const api = new StreamApiModel(
            { getConfig: () => baseConfig() },
            async () => fakeStream(),
            async () => fakeStream(),
            async () => {
                throw new Error('SyntheticRecordedStreamConstructionFailure');
            },
            async () => fakeStream(),
            manager,
            {},
            {},
            {},
            {},
            {},
        );

        await expect(api.startRecordedWebMStream({ mode: 0, playPosition: 4, videoFileId: 31 })).rejects.toThrow(
            'SyntheticRecordedStreamConstructionFailure',
        );
        expect(consumer.acquireAndOpen).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledOnce();
        expect(log.stream.error).toHaveBeenCalledWith('recorded delivery lease release error 0');
        expect(log.stream.error).toHaveBeenCalledWith(releaseFailure);
    });

    it('[MD-2.4][MD-6.2] exact-releases an adopted playback lease once while retaining later cleanup after release failure', async () => {
        const log = logger();
        const releaseFailure = new Error('SyntheticPlaybackLeaseReleaseFailure');
        const release = vi.fn(async () => {
            throw releaseFailure;
        });
        const reader = { close: vi.fn(async () => undefined), readable: fakeChild().stdout };
        const handle = Object.freeze({ kind: 'recorded-provider-release-latch' });
        const requestStop = vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' }));
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: () => log },
            { createManaged: vi.fn(), requestStop },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        model.adoptPlaybackSource(
            {
                inputPath: 'synthetic/recording.ts',
                kind: 'recording-tail-reader',
                playPosition: 0,
                reader,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            release,
        );
        model.streamProcessHandle = handle;

        await Promise.all([model.stop(), model.stop()]);

        expect(reader.close).toHaveBeenCalledOnce();
        expect(requestStop).toHaveBeenCalledWith(handle);
        expect(release).toHaveBeenCalledOnce();
        expect(log.stream.error).toHaveBeenNthCalledWith(1, 'recorded playback source lease release error');
        expect(log.stream.error).toHaveBeenNthCalledWith(2, releaseFailure);
    });

    it('[MD-2.4][MD-6.2] does not attempt a playback lease release when no provider source was adopted', async () => {
        const log = logger();
        const model = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: () => log },
            { createManaged: vi.fn(), requestStop: vi.fn() },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );

        await model.stop();

        expect(log.stream.error).not.toHaveBeenCalled();
    });
});
