import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled, executionManager, fakeStream, logger } from './_media-harness';

const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;

/**
 * Real StreamManageModel guard clauses that its own public API always satisfies before
 * reaching them (a `startRecorded` request never resolves without either adopting a stream or
 * throwing, and `attachStream` is only ever called once per active). Each is reachable only by
 * calling the (compiled, plain-JS-accessible) private method directly, or by isolating a single
 * post-condition check with a mocked collaborator -- the same convention this suite already uses
 * for StreamBaseModel's private members.
 */
describe('StreamManageModel guard direct calls (unittest/imp)', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('[R2-STREAMMANAGE-NULLALLOCATOR] the default NULL_STREAM_ID_ALLOCATOR fallback is inert in every operation (L132–141)', async () => {
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        const allocator = manager.idAllocator;

        expect(allocator.isAvailable()).toBe(false);
        expect(allocator.beginInitialization()).toBeUndefined();
        await expect(allocator.captureSnapshot()).resolves.toBeNull();
        await expect(allocator.hasArtifactCollision(1)).resolves.toBe(false);
        expect(allocator.knownCollisions()).toEqual(new Set());
        expect(allocator.markKnownCollision(1)).toBeUndefined();
        expect(allocator.release(1)).toBeUndefined();
        expect(() => allocator.reserve([], new Set())).toThrow('StreamIdAllocatorUnavailable');
    });

    it('[R2-STREAMMANAGE-ATTACHSTREAM-REENTRY] attachStream rejects attaching a second stream to the same active entry (L473–475)', () => {
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        const active = {
            id: 0,
            mapStartError: (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
            pendingInfo: null,
            preparation: null,
            resources: { adopt: vi.fn() },
            startResult: { promise: Promise.resolve(0), reject: vi.fn(), resolve: vi.fn(), settled: false },
            stream: fakeStream(),
            finalizePromise: null,
            startTimer: null,
            state: 'starting',
            usesManagedId: false,
        };

        expect(() => manager.attachStream(active, fakeStream())).toThrow('StreamAlreadyAttached');
    });

    it('[R2-STREAMMANAGE-STARTINTERNAL-LATEPREPARATION] settles a late preparation failure through the real concurrent stop() path when the stream was never attached (L509–511, L611)', async () => {
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        const boom = new Error('synthetic-late-preparation-failure');
        let capturedId: number | undefined;

        const startPromise = manager.startInternal(
            null,
            false,
            async (active: { id: number }) => {
                capturedId = active.id;
                // A real concurrent stop() request (the same public API a caller would use)
                // settles startResult with StreamStartStopped and finishes finalizeActive --
                // exactly the state canSettleStart() reports as false -- before this
                // preparation's own async work (e.g. an external I/O failure) finishes and
                // throws. This routes the throw through settleLateStart instead of
                // rejectStart, and settleLateStart finds the stream was never attached
                // (active.stream still null), so there is nothing left to clean up.
                await manager.stop(active.id);
                throw boom;
            },
        );

        await expect(startPromise).rejects.toThrow('StreamStartStopped');
        expect(capturedId).toBeDefined();
        // The concurrent stop() already finalized and removed the active entry; the late
        // preparation failure must not resurrect or re-settle it.
        expect(() => manager.getStreamInfo(capturedId)).toThrow('StreamIsNotFound');
    });

    it('[R2-STREAMMANAGE-STARTINTERNAL-UNADOPTED] rejects with RecordedStreamStartNotAdopted when preparation resolves without attaching a stream (L519–522)', async () => {
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });

        await expect(manager.startInternal(null, false, async () => undefined)).rejects.toThrow(
            'RecordedStreamStartNotAdopted',
        );
    });

    it('[R2-STREAMMANAGE-KEEP-PENDING] keep() throws while a recorded delivery request has not yet attached a stream (L832)', () => {
        vi.useFakeTimers();
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        void manager.startRecorded(
            vi.fn(async () => fakeStream()),
            {
                configure: vi.fn(),
                mode: 0,
                pendingInfoType: 'RecordedStream',
                playPosition: 0,
                usesManagedId: false,
                videoFileId: 1,
            },
            { acquireAndOpen: vi.fn(() => new Promise(() => undefined)) },
        );

        expect(() => manager.keep(0)).toThrow('StreamIsUndefined');
    });

    it('[R2-STREAMMANAGE-GETSTREAMINFO-PENDING] getStreamInfo() throws while a recorded delivery request has not yet attached a stream (L848)', () => {
        vi.useFakeTimers();
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        void manager.startRecorded(
            vi.fn(async () => fakeStream()),
            {
                configure: vi.fn(),
                mode: 0,
                pendingInfoType: 'RecordedStream',
                playPosition: 0,
                usesManagedId: false,
                videoFileId: 1,
            },
            { acquireAndOpen: vi.fn(() => new Promise(() => undefined)) },
        );

        expect(() => manager.getStreamInfo(0)).toThrow('StreamIsNotFound');
    });
});
