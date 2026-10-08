import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled, deferred, executionManager, fakeStream, logger } from './_media-harness';

const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;

const recordedStartOption = (overrides: Record<string, unknown> = {}) => ({
    configure: vi.fn(),
    mode: 0,
    pendingInfoType: 'RecordedStream' as const,
    playPosition: 0,
    usesManagedId: false,
    videoFileId: 31,
    ...overrides,
});

const makeDelivery = () => {
    const release = vi.fn(async () => undefined);
    return {
        recordedId: 41,
        release,
        source: {
            inputPath: 'synthetic/recorded.ts',
            kind: 'encoded-direct' as const,
            playPosition: 0,
            recordedId: 41,
            videoFileId: 31,
            videoInfo: { bitRate: 8, duration: 60, size: 480 },
        },
    };
};

const makeManager = (consumer: { acquireAndOpen: (...args: any[]) => any }) =>
    new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() }, undefined, consumer);

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/**
 * StreamManageModel の録画配信の開始が確定する分岐。開始が既に無効（時間切れ・停止）なら
 * 取得した配信元の lease を返して stream を作らず、有効なまま成功すれば採用した stream と
 * 採番した streamId を返す。
 */
describe('StreamManageModel recorded start settlement (unittest/imp)', () => {
    it('[MD-2.12] reports the acquisition inactive after the start timeout and releases a late delivery without creating a stream', async () => {
        vi.useFakeTimers();
        const opened = deferred<any>();
        let isActiveProbe: (() => boolean) | undefined;
        const consumer = {
            acquireAndOpen: vi.fn((_videoFileId: number, _playPosition: number, probe: () => boolean) => {
                isActiveProbe = probe;
                return opened.promise;
            }),
        };
        const streamProvider = vi.fn(async () => fakeStream());
        const manager = makeManager(consumer);

        const starting = manager.startRecorded(streamProvider, recordedStartOption());
        const timeoutRejection = expect(starting).rejects.toThrow('StreamStartTimeout');
        await vi.waitFor(() => expect(consumer.acquireAndOpen).toHaveBeenCalledOnce());
        expect(isActiveProbe!()).toBe(true);
        await vi.advanceTimersByTimeAsync(30_000);
        await timeoutRejection;
        expect(isActiveProbe!()).toBe(false);

        const delivery = makeDelivery();
        opened.resolve(delivery);
        await vi.waitFor(() => expect(delivery.release).toHaveBeenCalledOnce());

        expect(streamProvider).not.toHaveBeenCalled();
        expect(manager.getStreamInfos()).toEqual([]);
    });

    it('[MD-10.2] releases the acquired delivery and rejects with the provider failure when the stream cannot be created', async () => {
        const delivery = makeDelivery();
        const consumer = { acquireAndOpen: vi.fn(async () => delivery) };
        const failure = new Error('synthetic stream provider failure');
        const option = recordedStartOption();
        const manager = makeManager(consumer);

        await expect(
            manager.startRecorded(
                vi.fn(async () => {
                    throw failure;
                }),
                option,
            ),
        ).rejects.toBe(failure);

        expect(delivery.release).toHaveBeenCalledOnce();
        expect(option.configure).not.toHaveBeenCalled();
        expect(manager.getStreamInfos()).toEqual([]);
    });

    it('[MD-10.2] resolves the adopted stream and the allocated stream id when the start stays valid', async () => {
        const delivery = makeDelivery();
        const consumer = { acquireAndOpen: vi.fn(async () => delivery) };
        const stream = fakeStream({ type: 'RecordedStream' });
        const option = recordedStartOption();
        const manager = makeManager(consumer);

        const started = await manager.startRecorded(
            vi.fn(async () => stream),
            option,
        );

        expect(consumer.acquireAndOpen).toHaveBeenCalledExactlyOnceWith(31, 0, expect.any(Function));
        expect(started.stream).toBe(stream);
        expect(stream.adoptPlaybackSource).toHaveBeenCalledExactlyOnceWith(delivery.source, expect.any(Function));
        expect(option.configure).toHaveBeenCalledExactlyOnceWith(stream, delivery.source);
        expect(stream.start).toHaveBeenCalledExactlyOnceWith(started.streamId);
        expect(delivery.release).not.toHaveBeenCalled();
    });

    it('[MD-10.2] acquireRecordedDelivery releases the delivery and rejects StreamStartStopped when the caller became inactive', async () => {
        const delivery = makeDelivery();
        let active = true;
        const consumer = {
            acquireAndOpen: vi.fn(async () => {
                active = false;
                return delivery;
            }),
        };
        const manager = makeManager(consumer);

        await expect(manager.acquireRecordedDelivery(31, 0, () => active)).rejects.toThrow('StreamStartStopped');

        expect(delivery.release).toHaveBeenCalledOnce();
    });
});
