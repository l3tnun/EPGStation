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

const makeDelivery = (kind: 'encoded-direct' | 'ts-direct' = 'encoded-direct') => {
    const release = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    return {
        close,
        recordedId: 41,
        release,
        source:
            kind === 'encoded-direct'
                ? {
                      inputPath: 'synthetic/recorded.ts',
                      kind,
                      playPosition: 0,
                      recordedId: 41,
                      videoFileId: 31,
                      videoInfo: { bitRate: 8, duration: 60, size: 480 },
                  }
                : { kind, playPosition: 0, reader: { close }, recordedId: 41, videoFileId: 31 },
    };
};

const makeAllocator = (collisions: boolean[] = []) => {
    let next = 0;
    const known = new Set<number>();
    return {
        beginInitialization: vi.fn(),
        captureSnapshot: vi.fn(async () => new Set<number>()),
        hasArtifactCollision: vi.fn(async () => collisions.shift() ?? false),
        isAvailable: vi.fn(() => true),
        knownCollisions: vi.fn(() => known),
        markKnownCollision: vi.fn((id: number) => {
            known.add(id);
        }),
        release: vi.fn(),
        reserve: vi.fn(() => next++),
    };
};

const setup = (
    consumer: { acquireAndOpen: (...args: any[]) => any } | undefined,
    options: { allocator?: any; execution?: any } = {},
) => {
    const log = logger();
    const socket = { notifyClient: vi.fn() };
    const execution = options.execution ?? executionManager();
    const manager = new StreamManageModel(
        { getLogger: () => log },
        execution,
        socket,
        options.allocator,
        consumer,
    );
    return { execution, log, manager, socket };
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/**
 * StreamManageModel が録画済み配信の開始（`startRecorded`）と、配信元だけの取得（`acquireRecordedDelivery`）で
 * 保つ状態: 開始前に見せる仮の配信情報、失敗・停止のときの後始末、timer の解除、診断ログ。
 */
describe('StreamManageModel recorded start and release states (unittest/imp)', () => {
    it('[MD-10.2] reports the pending info while the delivery is being acquired and leaves no error log after a stop', async () => {
        const opened = deferred<any>();
        const consumer = { acquireAndOpen: vi.fn(() => opened.promise) };
        const { log, manager } = setup(consumer);

        const starting = manager.startRecorded(
            vi.fn(async () => fakeStream()),
            recordedStartOption({ mode: 2, videoFileId: 77 }),
        );
        const outcome = expect(starting).rejects.toThrow('StreamStartStopped');
        await vi.waitFor(() => expect(consumer.acquireAndOpen).toHaveBeenCalledOnce());

        expect(manager.getStreamInfos()).toEqual([
            { info: { isEnable: false, mode: 2, type: 'RecordedStream', videoFileId: 77 }, streamId: 0 },
        ]);

        await manager.stop(0);
        await outcome;
        expect(manager.getStreamInfos()).toEqual([]);
        expect(log.stream.error).not.toHaveBeenCalled();

        // 停止の後に取得が失敗しても、開始の失敗として記録せず、後始末すべき stream も無い。
        opened.reject(new Error('synthetic late acquire failure'));
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(log.stream.error).not.toHaveBeenCalled();
    });

    it('[MD-10.2] logs and rejects with the acquisition failure itself while the start is still valid', async () => {
        const failure = new Error('synthetic acquire failure');
        const consumer = {
            acquireAndOpen: vi.fn(async () => {
                throw failure;
            }),
        };
        const { log, manager } = setup(consumer);

        await expect(manager.startRecorded(vi.fn(), recordedStartOption())).rejects.toBe(failure);

        expect(log.stream.error.mock.calls).toEqual([['start stream error'], [failure]]);
        expect(manager.getStreamInfos()).toEqual([]);
    });

    it('[MD-10.2] returns the delivery lease, not the stream, when adopting the playback source fails', async () => {
        const delivery = makeDelivery();
        const consumer = { acquireAndOpen: vi.fn(async () => delivery) };
        const failure = new Error('synthetic adopt failure');
        const stream = fakeStream({ type: 'RecordedStream' });
        stream.adoptPlaybackSource.mockImplementation(() => {
            throw failure;
        });
        const { manager } = setup(consumer);

        await expect(manager.startRecorded(vi.fn(async () => stream), recordedStartOption())).rejects.toBe(failure);

        expect(delivery.release).toHaveBeenCalledOnce();
        expect(stream.stop).not.toHaveBeenCalled();
    });

    it('[MD-10.2] stops the adopted stream, not the delivery lease, when configuring the stream fails', async () => {
        const delivery = makeDelivery();
        const consumer = { acquireAndOpen: vi.fn(async () => delivery) };
        const failure = new Error('synthetic configure failure');
        const stream = fakeStream({ type: 'RecordedStream' });
        const option = recordedStartOption({
            configure: vi.fn(() => {
                throw failure;
            }),
        });
        const { manager } = setup(consumer);

        await expect(manager.startRecorded(vi.fn(async () => stream), option)).rejects.toBe(failure);

        expect(stream.stop).toHaveBeenCalledOnce();
        expect(delivery.release).not.toHaveBeenCalled();
    });

    it('[MD-10.2] leaves no start timer behind once a recorded stream has started', async () => {
        vi.useFakeTimers();
        const consumer = { acquireAndOpen: vi.fn(async () => makeDelivery()) };
        const { manager } = setup(consumer);

        await manager.startRecorded(
            vi.fn(async () => fakeStream({ type: 'RecordedStream' })),
            recordedStartOption(),
        );

        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-2.12] logs the stream id when the late delivery lease of a timed-out start cannot be released', async () => {
        vi.useFakeTimers();
        const opened = deferred<any>();
        const consumer = { acquireAndOpen: vi.fn(() => opened.promise) };
        const { log, manager } = setup(consumer);
        const starting = manager.startRecorded(
            vi.fn(async () => fakeStream()),
            recordedStartOption(),
        );
        const timeout = expect(starting).rejects.toThrow('StreamStartTimeout');
        await vi.waitFor(() => expect(consumer.acquireAndOpen).toHaveBeenCalledOnce());
        await vi.advanceTimersByTimeAsync(30_000);
        await timeout;

        const delivery = makeDelivery();
        const releaseFailure = new Error('synthetic release failure');
        delivery.release.mockRejectedValue(releaseFailure);
        opened.resolve(delivery);
        await vi.waitFor(() => expect(delivery.release).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(log.stream.error).toHaveBeenCalledWith(releaseFailure));

        expect(log.stream.error).toHaveBeenCalledWith('recorded delivery lease release error 0');
    });
});

describe('StreamManageModel acquireRecordedDelivery states (unittest/imp)', () => {
    it('[MD-10.2] gives the liveness probe and the missing-video-info option to the consumer, and deactivates the probe after the timeout', async () => {
        vi.useFakeTimers();
        const opened = deferred<any>();
        let probe: (() => boolean) | undefined;
        const consumer = {
            acquireAndOpen: vi.fn((_videoFileId: number, _playPosition: number, fn: () => boolean) => {
                probe = fn;
                return opened.promise;
            }),
        };
        const { manager } = setup(consumer);
        let callerActive = true;

        const acquiring = manager.acquireRecordedDelivery(31, 0, () => callerActive);
        const timeout = expect(acquiring).rejects.toThrow('StreamStartTimeout');

        expect(consumer.acquireAndOpen).toHaveBeenCalledExactlyOnceWith(31, 0, expect.any(Function), {
            allowMissingVideoInfo: true,
        });
        expect(probe!()).toBe(true);
        callerActive = false;
        expect(probe!()).toBe(false);
        callerActive = true;
        expect(probe!()).toBe(true);

        await vi.advanceTimersByTimeAsync(30_000);
        await timeout;
        expect(probe!()).toBe(false);

        const delivery = makeDelivery();
        opened.resolve(delivery);
        await vi.waitFor(() => expect(delivery.release).toHaveBeenCalledOnce());
    });

    it('[MD-10.2] rejects with the acquisition failure at once and leaves no timer behind', async () => {
        vi.useFakeTimers();
        const failure = new Error('synthetic acquire failure');
        const consumer = {
            acquireAndOpen: vi.fn(async () => {
                throw failure;
            }),
        };
        const { manager } = setup(consumer);

        await expect(manager.acquireRecordedDelivery(31, 0)).rejects.toBe(failure);

        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-10.2] leaves no timer behind after a successful acquisition and releases the lease once', async () => {
        vi.useFakeTimers();
        const delivery = makeDelivery();
        const consumer = { acquireAndOpen: vi.fn(async () => delivery) };
        const { log, manager } = setup(consumer);

        const acquired = await manager.acquireRecordedDelivery(31, 0);

        expect(vi.getTimerCount()).toBe(0);
        expect(acquired.source).toBe(delivery.source);
        await Promise.all([acquired.release(), acquired.release()]);
        expect(delivery.release).toHaveBeenCalledOnce();
        expect(log.stream.error).not.toHaveBeenCalled();
    });

    it('[MD-10.2] closes the reader of a source that has one before releasing, and logs nothing for a direct source', async () => {
        const reader = makeDelivery('ts-direct');
        const direct = makeDelivery('encoded-direct');
        const consumers = [reader, direct];
        const consumer = { acquireAndOpen: vi.fn(async () => consumers.shift()) };
        const { log, manager } = setup(consumer);

        const first = await manager.acquireRecordedDelivery(31, 0);
        await first.release();
        const second = await manager.acquireRecordedDelivery(31, 0);
        await second.release();

        expect(reader.close).toHaveBeenCalledOnce();
        expect(reader.release).toHaveBeenCalledOnce();
        expect(direct.release).toHaveBeenCalledOnce();
        expect(log.stream.error).not.toHaveBeenCalled();
    });

    it('[MD-10.2] logs a reader close failure and a lease release failure without a stream id, and still resolves the release', async () => {
        const delivery = makeDelivery('ts-direct');
        const closeFailure = new Error('synthetic close failure');
        const releaseFailure = new Error('synthetic release failure');
        delivery.close.mockRejectedValue(closeFailure);
        delivery.release.mockRejectedValue(releaseFailure);
        const consumer = { acquireAndOpen: vi.fn(async () => delivery) };
        const { log, manager } = setup(consumer);

        const acquired = await manager.acquireRecordedDelivery(31, 0);
        await acquired.release();

        expect(log.stream.error.mock.calls).toEqual([
            ['recorded delivery source reader close error'],
            [closeFailure],
            ['recorded delivery lease release error'],
            [releaseFailure],
        ]);
    });
});

describe('StreamManageModel managed stream ids and stop (unittest/imp)', () => {
    it('[MD-6.4] marks a collided id as known, reserves the next one and tells the clients about the change', async () => {
        const allocator = makeAllocator([true, false]);
        const stream = fakeStream({ type: 'HLS' });
        const { manager, socket } = setup(undefined, { allocator });

        const streamId = await manager.start(stream);

        expect(streamId).toBe(1);
        expect(allocator.markKnownCollision).toHaveBeenCalledExactlyOnceWith(0);
        expect(allocator.reserve).toHaveBeenCalledTimes(2);
        expect(allocator.reserve.mock.calls[1]).toEqual([[], new Set([0])]);
        expect(allocator.hasArtifactCollision.mock.calls).toEqual([[0], [1]]);
        expect(stream.start).toHaveBeenCalledExactlyOnceWith(1);
        expect(socket.notifyClient).toHaveBeenCalledTimes(2);
    });

    it('[MD-6.4] does not ask the allocator about artifacts for a stream without disk artifacts', async () => {
        const allocator = makeAllocator([true]);
        const stream = fakeStream({ type: 'MpegTsStream' });
        const { manager } = setup(undefined, { allocator });

        await manager.start(stream);

        expect(allocator.captureSnapshot).not.toHaveBeenCalled();
        expect(allocator.hasArtifactCollision).not.toHaveBeenCalled();
        expect(allocator.release).not.toHaveBeenCalled();
    });

    it('[MD-6.4] skips the artifact recheck and the start when a stop wins during the transition turn', async () => {
        const allocator = makeAllocator([false]);
        const stream = fakeStream({ type: 'HLS' });
        const gate = deferred<number>();
        const execution = {
            getExecution: vi
                .fn()
                .mockImplementationOnce(() => gate.promise)
                .mockImplementation(async () => 1),
            unLockExecution: vi.fn(),
        };
        const { manager } = setup(undefined, { allocator, execution });

        const starting = manager.start(stream);
        const outcome = expect(starting).rejects.toThrow('StreamStartStopped');
        await vi.waitFor(() => expect(execution.getExecution).toHaveBeenCalledOnce());
        await manager.stop(0);
        gate.resolve(1);
        await outcome;
        await new Promise<void>(resolve => setImmediate(resolve));

        expect(allocator.hasArtifactCollision).not.toHaveBeenCalled();
        expect(stream.start).not.toHaveBeenCalled();
    });

    it('[MD-6.4] releases the managed id and finalizes the stream once when the stream is stopped', async () => {
        const allocator = makeAllocator();
        const stream = fakeStream({ type: 'HLS' });
        const { log, manager } = setup(undefined, { allocator });
        const streamId = await manager.start(stream);

        await manager.stop(streamId);

        expect(allocator.release).toHaveBeenCalledExactlyOnceWith(streamId);
        expect(stream.stop).toHaveBeenCalledOnce();
        expect(stream.finalizeStop).toHaveBeenCalledOnce();
        expect(log.stream.error).not.toHaveBeenCalled();
    });

    it('[MD-6.4] logs a failing finalizeStop and still removes the stream', async () => {
        const stream = fakeStream({ type: 'MpegTsStream' });
        const failure = new Error('synthetic finalizeStop failure');
        stream.finalizeStop.mockImplementation(() => {
            throw failure;
        });
        const { log, manager } = setup(undefined);
        const streamId = await manager.start(stream);

        await manager.stop(streamId);

        expect(log.stream.error).toHaveBeenCalledExactlyOnceWith(failure);
        expect(manager.getStreamInfos()).toEqual([]);
    });
});
