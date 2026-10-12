import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled, deferred, executionManager, fakeStream, logger } from './_media-harness';

const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;

const recordedStartOption = (overrides: Record<string, unknown> = {}) => ({
    configure: vi.fn(),
    mode: 0,
    pendingInfoType: 'RecordedStream' as const,
    playPosition: 0,
    usesManagedId: false,
    videoFileId: 1,
    ...overrides,
});

describe('StreamManageModel recorded delivery failure paths (unittest/imp)', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('[R2-STREAMMANAGE-STARTRECORDED-NOCONSUMER] startRecorded rejects without a DI or supplied consumer (L202–204)', async () => {
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });

        await expect(
            manager.startRecorded(
                vi.fn(async () => fakeStream()),
                recordedStartOption(),
            ),
        ).rejects.toThrow('RecordedDeliveryLeaseConsumerIsUndefined');
    });

    it('[R2-STREAMMANAGE-ACQUIRERECORDEDDELIVERY-NOCONSUMER] acquireRecordedDelivery rejects without a DI or supplied consumer (L272–274)', async () => {
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });

        await expect(manager.acquireRecordedDelivery(1, 0)).rejects.toThrow(
            'RecordedDeliveryLeaseConsumerIsUndefined',
        );
    });

    it('[R2-STREAMMANAGE-ACQUIRERECORDEDDELIVERY-DEFAULTISACTIVE] falls back to the default isActive callback and reports the acquire active while starting (L268)', async () => {
        const opened = deferred<any>();
        let capturedIsActive: (() => boolean) | undefined;
        const deliveryConsumer = {
            acquireAndOpen: vi.fn((_videoFileId: number, _playPosition: number, isActiveProbe: () => boolean) => {
                capturedIsActive = isActiveProbe;
                return opened.promise;
            }),
        };
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            undefined,
            deliveryConsumer,
        );

        // No third argument is supplied, so `acquireRecordedDelivery` falls back to its default
        // `isActive: () => boolean = () => true` (StreamManageModel.ts:268).
        const acquiring = manager.acquireRecordedDelivery(51, 0);
        await vi.waitFor(() => expect(deliveryConsumer.acquireAndOpen).toHaveBeenCalledOnce());
        expect(capturedIsActive).toBeDefined();

        // The acquire is still 'starting', so the wrapper (`() => active.state === 'starting' &&
        // isActive()`) must actually evaluate and return the default arrow's body.
        expect(capturedIsActive!()).toBe(true);

        const release = vi.fn(async () => undefined);
        opened.resolve({
            recordedId: 61,
            release,
            source: {
                inputPath: 'synthetic/default-isactive-recorded.ts',
                kind: 'encoded-direct' as const,
                playPosition: 0,
                recordedId: 61,
                videoFileId: 51,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
        });
        const acquired = await acquiring;
        expect(acquired.recordedId).toBe(61);
        await acquired.release();
        expect(release).toHaveBeenCalledOnce();
    });

    it('[R2-STREAMMANAGE-ACQUIRERECORDEDDELIVERY-LATEREJECTAFTERTIMEOUT] no-ops a late acquireAndOpen rejection that arrives after the start timeout already settled (L283)', async () => {
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

            const acquiring = manager.acquireRecordedDelivery(52, 0);
            const timeoutRejection = expect(acquiring).rejects.toThrow('StreamStartTimeout');
            await vi.advanceTimersByTimeAsync(30_000);
            await timeoutRejection;

            // The start timeout already moved `active.state` away from 'starting' and settled the
            // outer promise. A late rejection now drives the `error => rejectStart(...)` handler a
            // second time; rejectStart's guard (`if (active.state !== 'starting') return;`,
            // StreamManageModel.ts:283) must observe the non-'starting' state and no-op instead of
            // re-settling anything or throwing. Spy on the same private
            // `clearRecordedDeliveryStartTimer` rejectStart calls right after its guard: if the
            // guard did not short-circuit, this late rejection would call it a second time.
            const clearStartTimerSpy = vi.spyOn(manager, 'clearRecordedDeliveryStartTimer');
            opened.reject(new Error('synthetic-late-acquire-rejection-after-timeout'));
            await vi.advanceTimersByTimeAsync(0);
            await Promise.resolve();

            expect(clearStartTimerSpy).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('[R2-STREAMMANAGE-RELEASEUNADOPTED-CATCH] absorbs a throwing reader.close() and release() while releasing a late acquireRecordedDelivery (L348–351, L366)', async () => {
        vi.useFakeTimers();
        try {
            const opened = deferred<any>();
            const deliveryConsumer = { acquireAndOpen: vi.fn(() => opened.promise) };
            const log = logger();
            const manager = new StreamManageModel(
                { getLogger: () => log },
                executionManager(),
                { notifyClient: vi.fn() },
                undefined,
                deliveryConsumer,
            );

            const acquiring = manager.acquireRecordedDelivery(31, 0);
            const timeoutRejection = expect(acquiring).rejects.toThrow('StreamStartTimeout');
            await vi.advanceTimersByTimeAsync(30_000);
            await timeoutRejection;

            const closeFailure = new Error('synthetic-late-reader-close-failure');
            const releaseFailure = new Error('synthetic-late-lease-release-failure');
            const reader = { close: vi.fn(async () => Promise.reject(closeFailure)) };
            const release = vi.fn(async () => Promise.reject(releaseFailure));
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
            expect(log.stream.error).toHaveBeenCalledWith('recorded delivery source reader close error');
            expect(log.stream.error).toHaveBeenCalledWith(closeFailure);
            // streamId is undefined for the acquireRecordedDelivery path.
            expect(log.stream.error).toHaveBeenCalledWith('recorded delivery lease release error');
            expect(log.stream.error).toHaveBeenCalledWith(releaseFailure);
            expect(manager.getStreamInfos()).toEqual([]);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('[R2-STREAMMANAGE-STARTRECORDED-LATESTREAMPROVIDER] cleans up a late-resolving stream candidate and its recorded delivery once the request has already timed out (L224–228)', async () => {
        vi.useFakeTimers();
        try {
            const delivery = {
                recordedId: 41,
                source: {
                    inputPath: 'synthetic/late-provider-recorded.ts',
                    kind: 'encoded-direct' as const,
                    playPosition: 0,
                    recordedId: 41,
                    videoFileId: 31,
                    videoInfo: { bitRate: 8, duration: 60, size: 480 },
                },
            };
            const deliveryConsumer = { acquireAndOpen: vi.fn(async () => delivery) };
            const streamProviderGate = deferred<void>();
            const lateStream = fakeStream({ type: 'RecordedStream' });
            const streamProvider = vi.fn(async () => {
                await streamProviderGate.promise;
                return lateStream;
            });
            const log = logger();
            const manager = new StreamManageModel(
                { getLogger: () => log },
                executionManager(),
                { notifyClient: vi.fn() },
                undefined,
                deliveryConsumer,
            );

            const starting = manager.startRecorded(streamProvider, recordedStartOption({ videoFileId: 31 }));
            const timeoutRejection = expect(starting).rejects.toThrow('StreamStartTimeout');
            await vi.waitFor(() => expect(streamProvider).toHaveBeenCalledOnce());
            await vi.advanceTimersByTimeAsync(30_000);
            await timeoutRejection;

            streamProviderGate.resolve();
            await vi.waitFor(() => expect(lateStream.stop).toHaveBeenCalledOnce());

            expect(lateStream.adoptPlaybackSource).not.toHaveBeenCalled();
            expect(manager.getStreamInfos()).toEqual([]);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });
});
