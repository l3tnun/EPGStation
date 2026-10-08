import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushNextTick, makeChild, makeClient, makeServer } from '../_harness';

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('IMP-RECORDED-USE lease deadline and release lifecycle', () => {
    it('moves a granted acquire id pending-to-leased and sends exactly one matching terminal release', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        const { server } = makeServer();
        const child = makeChild();
        const registry = {
            acquire: vi.fn(() => ({ status: 'granted' as const })),
            release: vi.fn(() => 'released' as const),
        };
        try {
            server.recordedResourceUseRegistryRegistrationPort.register(registry);
            server.register(child);
            harness.send.mockImplementation(message => child.emit('message', message));
            child.send.mockImplementation(message => void harness.receive(message));

            const { token } = await harness.client.recordedResourceUseClient.acquire(501, 'delivery');
            expect(harness.client.leased.has(1)).toBe(true);
            expect(vi.getTimerCount()).toBe(0);

            const firstRelease = harness.client.recordedResourceUseClient.release(token);
            const duplicateRelease = harness.client.recordedResourceUseClient.release(token);
            await flushNextTick();
            await Promise.resolve();

            await expect(Promise.all([firstRelease, duplicateRelease])).resolves.toEqual([undefined, undefined]);
            expect(harness.send.mock.calls.map(([message]) => message)).toContainEqual({
                acquisitionRequestId: 1,
                type: 'recordedUseRelease',
            });
            expect(harness.send.mock.calls.filter(([message]) => message.type === 'recordedUseRelease')).toHaveLength(
                1,
            );
            expect(registry.release).toHaveBeenCalledOnce();
            expect(registry.release).toHaveBeenCalledWith({ acquisitionRequestId: 1, senderPeer: child });
            expect(harness.client.leased.has(1)).toBe(false);
            expect(harness.client.pending.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            harness.cleanup();
        }
    });

    it('rejects at 5,000ms, never returns a late grant for use, and best-effort releases that same identity once', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        const { server } = makeServer();
        const child = makeChild();
        const delayedReplies: unknown[] = [];
        const registry = {
            acquire: vi.fn(() => ({ status: 'granted' as const })),
            release: vi.fn(() => 'released' as const),
        };
        try {
            server.recordedResourceUseRegistryRegistrationPort.register(registry);
            server.register(child);
            harness.send.mockImplementation(message => child.emit('message', message));
            child.send.mockImplementation(message => delayedReplies.push(message));

            const outcome = harness.client.recordedResourceUseClient.acquire(502, 'encoding').then(
                value => ({ value }),
                (error: Error) => ({ error: error.message }),
            );
            await flushNextTick();
            expect(delayedReplies).toEqual([{ id: 1, status: 'granted', type: 'recordedUseAcquireReply' }]);

            await vi.advanceTimersByTimeAsync(4_999);
            expect(harness.client.pending.has(1)).toBe(true);
            expect(harness.client.leased.has(1)).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            await expect(outcome).resolves.toEqual({ error: 'IPCTimeout' });
            expect(harness.client.pending.has(1)).toBe(false);
            expect(harness.client.retired.has(1)).toBe(true);
            expect(harness.client.leased.has(1)).toBe(false);
            expect(vi.getTimerCount()).toBe(0);
            await vi.advanceTimersByTimeAsync(1);
            expect(harness.client.leased.has(1)).toBe(false);

            await harness.receive(delayedReplies[0]);
            await flushNextTick();
            await Promise.resolve();
            expect(registry.release).toHaveBeenCalledOnce();
            expect(registry.release).toHaveBeenCalledWith({ acquisitionRequestId: 1, senderPeer: child });
            expect(harness.send.mock.calls.filter(([message]) => message.type === 'recordedUseRelease')).toHaveLength(
                1,
            );
            expect(harness.client.leased.has(1)).toBe(true);

            await harness.receive(delayedReplies[1]);
            expect(harness.client.leased.has(1)).toBe(false);
            expect(harness.client.retired.has(1)).toBe(false);
            expect(harness.client.pending.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);

            await harness.receive(delayedReplies[0]);
            expect(registry.release).toHaveBeenCalledOnce();
        } finally {
            harness.cleanup();
        }
    });

    it('keeps an unconfirmed release leased through its deadline and frees only after its late exact reply', async () => {
        vi.useFakeTimers();
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        const { server } = makeServer();
        const child = makeChild();
        const delayedReplies: unknown[] = [];
        const registry = {
            acquire: vi.fn(() => ({ status: 'granted' as const })),
            release: vi.fn(() => 'released' as const),
        };
        try {
            server.recordedResourceUseRegistryRegistrationPort.register(registry);
            server.register(child);
            harness.send.mockImplementation(message => child.emit('message', message));
            child.send.mockImplementation(message => void harness.receive(message));
            const { token } = await harness.client.recordedResourceUseClient.acquire(503, 'encoding');
            expect(harness.client.allocateIdentifier()).toBeUndefined();

            child.send.mockImplementation(message => delayedReplies.push(message));
            const release = harness.client.recordedResourceUseClient.release(token).then(
                () => ({ status: 'released' }),
                (error: Error) => ({ error: error.message }),
            );
            await flushNextTick();
            expect(registry.release).toHaveBeenCalledOnce();
            expect(delayedReplies).toEqual([
                { acquisitionRequestId: 1, status: 'released', type: 'recordedUseReleaseReply' },
            ]);

            await vi.advanceTimersByTimeAsync(5_000);
            await expect(release).resolves.toEqual({ error: 'IPCTimeout' });
            expect(harness.client.leased.has(1)).toBe(true);
            expect(harness.client.retiredRecordedUseReleases.has(1)).toBe(true);
            expect(harness.client.allocateIdentifier()).toBeUndefined();
            expect(vi.getTimerCount()).toBe(0);

            await harness.receive(delayedReplies[0]);
            expect(harness.client.leased.has(1)).toBe(false);
            expect(harness.client.retiredRecordedUseReleases.has(1)).toBe(false);
            expect(harness.client.allocateIdentifier()).toBe(1);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            harness.cleanup();
        }
    });

    it('fences a stale release after peer replacement by retaining the original peer identity for the registry', async () => {
        const { server } = makeServer();
        const original = makeChild();
        const replacement = makeChild();
        const leaseOwners = new Map([[701, original]]);
        const registry = {
            acquire: vi.fn(() => ({ status: 'granted' as const })),
            release: vi.fn(
                ({ acquisitionRequestId, senderPeer }: { acquisitionRequestId: number; senderPeer: object }) => {
                    if (leaseOwners.get(acquisitionRequestId) !== senderPeer) return 'unknown' as const;
                    leaseOwners.delete(acquisitionRequestId);
                    return 'released' as const;
                },
            ),
        };
        server.recordedResourceUseRegistryRegistrationPort.register(registry);
        server.register(original);
        server.register(replacement);

        original.emit('message', { acquisitionRequestId: 701, type: 'recordedUseRelease' });
        replacement.emit('message', { acquisitionRequestId: 701, type: 'recordedUseRelease' });

        expect(registry.release).toHaveBeenCalledOnce();
        expect(registry.release).toHaveBeenCalledWith({ acquisitionRequestId: 701, senderPeer: replacement });
        expect(leaseOwners.get(701)).toBe(original);
        expect(replacement.send).toHaveBeenCalledWith({
            acquisitionRequestId: 701,
            status: 'unknown',
            type: 'recordedUseReleaseReply',
        });
    });
});

describe('IMP-RECORDED-USE snapshot deadline and generation lifecycle', () => {
    it('converges absent child, unknown provider, send failure, mismatch, timeout, and late reply to unknown without leftovers', async () => {
        vi.useFakeTimers();
        const { server } = makeServer();
        await expect(server.recordedUseSnapshotClient.requestSnapshot()).resolves.toEqual({ status: 'unknown' });
        expect(server.pendingSnapshots.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);

        const harness = makeClient();
        const child = makeChild();
        const listenerCount = process.listenerCount('message');
        try {
            server.register(child);
            harness.send.mockImplementation(message => child.emit('message', message));
            child.send.mockImplementation(message => void harness.receive(message));
            await expect(server.recordedUseSnapshotClient.requestSnapshot()).resolves.toEqual({ status: 'unknown' });
            expect(server.pendingSnapshots.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);

            harness.client.recordedUseSnapshotHandlerRegistrationPort.register({
                getSnapshot: () => ({ recordedIds: [710], status: 'known' }),
            });
            await expect(server.recordedUseSnapshotClient.requestSnapshot()).resolves.toEqual({
                recordedIds: [710],
                status: 'known',
            });
            harness.client.recordedUseSnapshotHandlerRegistrationPort.register({
                getSnapshot: () => ({ status: 'unknown' }),
            });
            await expect(server.recordedUseSnapshotClient.requestSnapshot()).resolves.toEqual({ status: 'unknown' });
            expect(server.pendingSnapshots.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);

            child.send.mockImplementation(() => {
                throw new Error('synthetic snapshot send failure');
            });
            await expect(server.recordedUseSnapshotClient.requestSnapshot()).resolves.toEqual({ status: 'unknown' });
            expect(server.pendingSnapshots.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);

            const lateReplies: unknown[] = [];
            child.send.mockImplementation(message => lateReplies.push(message));
            const outcome = server.recordedUseSnapshotClient.requestSnapshot().then(snapshot => ({ snapshot }));
            expect(server.pendingSnapshots.size).toBe(1);
            expect(vi.getTimerCount()).toBe(1);
            child.emit('message', {
                id: 99,
                snapshot: { recordedIds: [711], status: 'known' },
                type: 'recordedUseSnapshotReply',
            });
            await vi.advanceTimersByTimeAsync(4_999);
            expect(server.pendingSnapshots.size).toBe(1);
            await vi.advanceTimersByTimeAsync(1);
            await expect(outcome).resolves.toEqual({ snapshot: { status: 'unknown' } });
            expect(server.pendingSnapshots.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);

            child.emit('message', {
                id: lateReplies[0].id,
                snapshot: { recordedIds: [712], status: 'known' },
                type: 'recordedUseSnapshotReply',
            });
            expect(server.pendingSnapshots.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
            expect(process.listenerCount('message')).toBe(listenerCount);
        } finally {
            harness.cleanup();
        }
    });

    it('rejects an old-generation snapshot when a replacement becomes current and cleans the old request timer', async () => {
        vi.useFakeTimers();
        const { server } = makeServer();
        const original = makeChild();
        const replacement = makeChild();
        server.register(original);
        original.send.mockImplementation(() => undefined);

        const snapshot = server.recordedUseSnapshotClient.requestSnapshot();
        expect(server.pendingSnapshots.size).toBe(1);
        expect(vi.getTimerCount()).toBe(1);
        server.register(replacement);

        await expect(snapshot).resolves.toEqual({ status: 'unknown' });
        expect(server.pendingSnapshots.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        original.emit('message', {
            id: 1,
            snapshot: { recordedIds: [713], status: 'known' },
            type: 'recordedUseSnapshotReply',
        });
        expect(server.pendingSnapshots.size).toBe(0);
    });

    it('accepts only the exact pending peer once and clears its request-specific timer', async () => {
        vi.useFakeTimers();
        const { server } = makeServer();
        const child = makeChild();
        const wrongPeer = makeChild();
        server.register(child);
        child.send.mockImplementation(() => undefined);

        const snapshot = server.recordedUseSnapshotClient.requestSnapshot();
        expect(server.pendingSnapshots.size).toBe(1);
        expect(vi.getTimerCount()).toBe(1);

        expect(() =>
            server.completeRecordedUseSnapshot(1, wrongPeer, { recordedIds: [714], status: 'known' }),
        ).not.toThrow();
        expect(server.pendingSnapshots.size).toBe(1);
        expect(vi.getTimerCount()).toBe(1);

        server.completeRecordedUseSnapshot(1, child, { recordedIds: [714], status: 'known' });
        await expect(snapshot).resolves.toEqual({ recordedIds: [714], status: 'known' });
        expect(server.pendingSnapshots.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);

        expect(() =>
            server.completeRecordedUseSnapshot(1, child, { recordedIds: [715], status: 'known' }),
        ).not.toThrow();
        expect(server.pendingSnapshots.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('resolves unknown when a boolean-connected child reports a callback send failure for a snapshot request', async () => {
        const { server } = makeServer();
        const child = makeChild();
        (child as unknown as { connected?: boolean }).connected = true;
        child.send.mockImplementation((_message: unknown, callback?: (error: Error | null) => void) => {
            callback?.(new Error('synthetic snapshot callback send failure'));
            return false;
        });
        server.register(child);

        await expect(server.recordedUseSnapshotClient.requestSnapshot()).resolves.toEqual({ status: 'unknown' });
        expect(server.pendingSnapshots.size).toBe(0);
    });

    it('normalizes a null snapshot reply payload to unknown', async () => {
        vi.useFakeTimers();
        const { server } = makeServer();
        const child = makeChild();
        child.send.mockImplementation(() => undefined);
        server.register(child);

        const outcome = server.recordedUseSnapshotClient.requestSnapshot();
        const sentId = child.send.mock.calls[0][0].id;
        child.emit('message', { id: sentId, snapshot: null, type: 'recordedUseSnapshotReply' });

        await expect(outcome).resolves.toEqual({ status: 'unknown' });
    });

    it('ignores a timeout firing for a snapshot request id that already resolved', () => {
        const { server } = makeServer();
        expect(server.pendingSnapshots.size).toBe(0);

        // No production call site can invoke this after clearTimeout already ran; this exercises
        // the same already-settled guard directly, the way completeRecordedUseSnapshot's mismatched-
        // peer/already-resolved cases above are exercised directly in this file.
        expect(() => server.timeoutRecordedUseSnapshot(123_456)).not.toThrow();
        expect(server.pendingSnapshots.size).toBe(0);
    });

    it('allocates around a synthetic id collision and wraps a collision at Number.MAX_SAFE_INTEGER back to 1', () => {
        const { server } = makeServer();
        const child = makeChild();
        server.register(child);
        child.send.mockImplementation(() => undefined);

        // A non-boundary collision advances the candidate by exactly one.
        const stale = { child, resolve: () => undefined, timeoutHandle: setTimeout(() => undefined, 0) };
        server.pendingSnapshots.set(5, stale);
        server.nextSnapshotRequestId = 5;
        server.recordedUseSnapshotClient.requestSnapshot();
        expect(child.send).toHaveBeenLastCalledWith({ id: 6, type: 'recordedUseSnapshotRequest' });
        expect(server.nextSnapshotRequestId).toBe(7);
        server.pendingSnapshots.delete(5);
        server.pendingSnapshots.delete(6);
        clearTimeout(stale.timeoutHandle);

        // A collision exactly at Number.MAX_SAFE_INTEGER wraps the candidate to 1, not 0 or NaN.
        const staleAtMax = { child, resolve: () => undefined, timeoutHandle: setTimeout(() => undefined, 0) };
        server.pendingSnapshots.set(Number.MAX_SAFE_INTEGER, staleAtMax);
        server.nextSnapshotRequestId = Number.MAX_SAFE_INTEGER;
        server.recordedUseSnapshotClient.requestSnapshot();
        expect(child.send).toHaveBeenLastCalledWith({ id: 1, type: 'recordedUseSnapshotRequest' });
        expect(server.nextSnapshotRequestId).toBe(2);
        server.pendingSnapshots.delete(Number.MAX_SAFE_INTEGER);
        server.pendingSnapshots.delete(1);
        clearTimeout(staleAtMax.timeoutHandle);

        // With no collision, allocating Number.MAX_SAFE_INTEGER itself still wraps the *next*
        // candidate to 1.
        server.nextSnapshotRequestId = Number.MAX_SAFE_INTEGER;
        server.recordedUseSnapshotClient.requestSnapshot();
        expect(child.send).toHaveBeenLastCalledWith({
            id: Number.MAX_SAFE_INTEGER,
            type: 'recordedUseSnapshotRequest',
        });
        expect(server.nextSnapshotRequestId).toBe(1);
        server.pendingSnapshots.delete(Number.MAX_SAFE_INTEGER);
    });
});
