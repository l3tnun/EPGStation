import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushNextTick, makeChild, makeClient, makeServer } from '../_harness';

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/**
 * Structural RED (coverage inventory for the IPC client):
 * IPCClient.ts L373–572 retains 278 statement gaps. Existing deadline-races /
 * operation-routing cover granted/blocked acquire, happy release, acquire timeout,
 * release timeout, and known/unknown snapshot happy paths. They do not exercise:
 * release transport failure, release reply unknown, non-leased release early return,
 * late non-granted acquire after retire, snapshot handler throw / normalize reject,
 * or snapshot reply transport failure — the dense residual statement clusters at
 * L401–405, L419–421, L434–448, L459–461, L483–491, L506–508, L516–534.
 */
describe('IMP-RECORDED-USE client lifecycle residual edge paths', () => {
    const grantAcquire = async (harness: ReturnType<typeof makeClient>, recordedId = 801) => {
        const acquire = harness.client.recordedResourceUseClient.acquire(recordedId, 'delivery');
        await flushNextTick();
        await harness.receive({ id: 1, status: 'granted', type: 'recordedUseAcquireReply' });
        const { token } = await acquire;
        expect(harness.client.leased.has(1)).toBe(true);
        return token as object;
    };

    it('rejects release and frees no lease leftovers when process.send is undefined', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            const token = await grantAcquire(harness);
            delete process.send;

            const release = harness.client.recordedResourceUseClient.release(token);
            await flushNextTick();
            await expect(release).rejects.toThrow('process.send is undefined');
            expect(harness.client.recordedUseReleasePending.size).toBe(0);
            expect(harness.client.leased.has(1)).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            harness.cleanup();
        }
    });

    it('rejects release once when process.send throws and logs the transport error', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            const token = await grantAcquire(harness);
            harness.send.mockImplementation(() => {
                throw new Error('synthetic-recorded-use-release-throw');
            });

            const release = harness.client.recordedResourceUseClient.release(token);
            await flushNextTick();
            await expect(release).rejects.toThrow('synthetic-recorded-use-release-throw');
            expect(harness.logError).toHaveBeenCalledWith(
                'process.send error: synthetic-recorded-use-release-throw',
            );
            expect(harness.client.recordedUseReleasePending.size).toBe(0);
            expect(harness.client.leased.has(1)).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            harness.cleanup();
        }
    });

    it('logs process.send callback errors on release without settling the pending release', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            const token = await grantAcquire(harness);
            let sendCallback: ((error: Error | null) => void) | undefined;
            harness.send.mockImplementation((_message: unknown, callback?: (error: Error | null) => void) => {
                sendCallback = callback;
                return true;
            });

            const release = harness.client.recordedResourceUseClient.release(token);
            await flushNextTick();
            expect(harness.client.recordedUseReleasePending.has(1)).toBe(true);
            expect(vi.getTimerCount()).toBe(1);

            sendCallback?.(new Error('synthetic-release-callback-error'));
            expect(harness.logError).toHaveBeenCalledWith(
                'process.send callback error: synthetic-release-callback-error',
            );
            expect(harness.client.recordedUseReleasePending.has(1)).toBe(true);

            await harness.receive({
                acquisitionRequestId: 1,
                status: 'released',
                type: 'recordedUseReleaseReply',
            });
            await expect(release).resolves.toBeUndefined();
            expect(harness.client.leased.has(1)).toBe(false);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            harness.cleanup();
        }
    });

    it('rejects a pending release when the reply status is unknown and keeps the id leased', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            const token = await grantAcquire(harness);
            const release = harness.client.recordedResourceUseClient.release(token);
            await flushNextTick();
            await harness.receive({
                acquisitionRequestId: 1,
                status: 'unknown',
                type: 'recordedUseReleaseReply',
            });
            await expect(release).rejects.toThrow('RecordedResourceUseUnknown');
            expect(harness.client.leased.has(1)).toBe(true);
            expect(harness.client.recordedUseReleasePending.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            harness.cleanup();
        }
    });

    it('accepts already-released as a successful terminal release and frees the lease', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            const token = await grantAcquire(harness);
            const release = harness.client.recordedResourceUseClient.release(token);
            await flushNextTick();
            await harness.receive({
                acquisitionRequestId: 1,
                status: 'already-released',
                type: 'recordedUseReleaseReply',
            });
            await expect(release).resolves.toBeUndefined();
            expect(harness.client.leased.has(1)).toBe(false);
            expect(harness.client.recordedUseReleasePending.size).toBe(0);
        } finally {
            harness.cleanup();
        }
    });

    it('no-ops release for an unknown token and for a concurrent in-flight release of the same lease', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            await expect(harness.client.recordedResourceUseClient.release({})).resolves.toBeUndefined();
            expect(harness.send).not.toHaveBeenCalled();

            const token = await grantAcquire(harness);
            const first = harness.client.recordedResourceUseClient.release(token);
            await flushNextTick();
            expect(harness.send.mock.calls.filter(([message]) => message.type === 'recordedUseRelease')).toHaveLength(
                1,
            );
            // Token is already unbound; a second release must not enqueue another transport.
            await expect(harness.client.recordedResourceUseClient.release(token)).resolves.toBeUndefined();
            expect(harness.send.mock.calls.filter(([message]) => message.type === 'recordedUseRelease')).toHaveLength(
                1,
            );

            // Force a second call into releaseRecordedResourceUse while still leased + pending.
            await expect(harness.client.releaseRecordedResourceUse(1)).resolves.toBeUndefined();
            expect(harness.send.mock.calls.filter(([message]) => message.type === 'recordedUseRelease')).toHaveLength(
                1,
            );

            await harness.receive({
                acquisitionRequestId: 1,
                status: 'released',
                type: 'recordedUseReleaseReply',
            });
            await expect(first).resolves.toBeUndefined();
            // After free, another direct release is a no-op (not leased).
            await expect(harness.client.releaseRecordedResourceUse(1)).resolves.toBeUndefined();
            expect(harness.send.mock.calls.filter(([message]) => message.type === 'recordedUseRelease')).toHaveLength(
                1,
            );
        } finally {
            harness.cleanup();
        }
    });

    it('after acquire timeout, a late non-granted reply drains waiters without leasing', async () => {
        vi.useFakeTimers();
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        try {
            const outcome = harness.client.recordedResourceUseClient.acquire(802, 'encoding').then(
                value => ({ value }),
                (error: Error) => ({ error: error.message }),
            );
            await flushNextTick();
            await vi.advanceTimersByTimeAsync(5_000);
            await expect(outcome).resolves.toEqual({ error: 'IPCTimeout' });
            expect(harness.client.retired.has(1)).toBe(true);
            expect(harness.client.retiredRecordedUseAcquires.has(1)).toBe(true);
            expect(harness.client.allocateIdentifier()).toBeUndefined();

            await harness.receive({ id: 1, status: 'blocked', type: 'recordedUseAcquireReply' });
            expect(harness.client.leased.has(1)).toBe(false);
            expect(harness.client.retired.has(1)).toBe(false);
            expect(harness.client.retiredRecordedUseAcquires.has(1)).toBe(false);
            expect(harness.client.allocateIdentifier()).toBe(1);
            expect(harness.send.mock.calls.filter(([message]) => message.type === 'recordedUseRelease')).toHaveLength(
                0,
            );
        } finally {
            harness.cleanup();
        }
    });

    it('swallows the fire-and-forget release failure after a late granted reply arrives post-retire', async () => {
        vi.useFakeTimers();
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        try {
            const outcome = harness.client.recordedResourceUseClient.acquire(803, 'encoding').then(
                value => ({ value }),
                (error: Error) => ({ error: error.message }),
            );
            await flushNextTick();
            await vi.advanceTimersByTimeAsync(5_000);
            await expect(outcome).resolves.toEqual({ error: 'IPCTimeout' });
            expect(harness.client.retiredRecordedUseAcquires.has(1)).toBe(true);

            // Transport is gone by the time the late `granted` reply shows up, so the
            // fire-and-forget `releaseRecordedResourceUse(...).catch(() => undefined)` at
            // IPCClient.ts:475 must observe a rejection and swallow it instead of surfacing
            // an unhandled rejection.
            delete process.send;
            await harness.receive({ id: 1, status: 'granted', type: 'recordedUseAcquireReply' });
            await flushNextTick();

            // The late grant still marks the id leased (IPCClient.ts:474) even though the
            // fire-and-forget release below immediately fails.
            expect(harness.client.leased.has(1)).toBe(true);
            expect(harness.client.retired.has(1)).toBe(false);
            expect(harness.client.retiredRecordedUseAcquires.has(1)).toBe(false);
            // The release attempt failed before ever registering a pending release entry
            // (process.send was missing), so nothing is left waiting and no transport error
            // was logged for this path (unlike a `process.send` throw, which does log).
            expect(harness.client.recordedUseReleasePending.size).toBe(0);
            expect(harness.logError).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            harness.cleanup();
        }
    });

    it('converges snapshot handler throw and invalid snapshots to unknown without leftovers', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        const { server } = makeServer();
        const child = makeChild();
        try {
            server.register(child);
            harness.send.mockImplementation(message => child.emit('message', message));
            child.send.mockImplementation(message => void harness.receive(message));

            harness.client.recordedUseSnapshotHandlerRegistrationPort.register({
                getSnapshot: () => {
                    throw new Error('synthetic-snapshot-handler-throw');
                },
            });
            await expect(server.recordedUseSnapshotClient.requestSnapshot()).resolves.toEqual({ status: 'unknown' });

            for (const invalid of [
                null,
                17,
                'known',
                { status: 'known' },
                { status: 'known', recordedIds: '1' },
                { status: 'known', recordedIds: [1, '2'] },
                { status: 'known', recordedIds: [1.5] },
                { status: 'maybe', recordedIds: [1] },
            ]) {
                harness.client.recordedUseSnapshotHandlerRegistrationPort.register({
                    getSnapshot: () => invalid as never,
                });
                await expect(server.recordedUseSnapshotClient.requestSnapshot()).resolves.toEqual({
                    status: 'unknown',
                });
            }

            expect(server.pendingSnapshots.size).toBe(0);
            expect(harness.client.pending.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            harness.cleanup();
        }
    });

    it('logs snapshot reply transport failures when process.send is missing or throws', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            // Missing process.send while handling a parent snapshot request.
            delete process.send;
            await harness.receive({ id: 91, type: 'recordedUseSnapshotRequest' });
            await flushNextTick();
            expect(harness.logError).toHaveBeenCalledWith('process.send is undefined');

            Object.defineProperty(process, 'send', { configurable: true, value: harness.send, writable: true });
            harness.send.mockImplementation(() => {
                throw new Error('synthetic-snapshot-reply-throw');
            });
            await harness.receive({ id: 92, type: 'recordedUseSnapshotRequest' });
            await flushNextTick();
            expect(harness.logError).toHaveBeenCalledWith('process.send error: synthetic-snapshot-reply-throw');

            let sendCallback: ((error: Error | null) => void) | undefined;
            harness.send.mockImplementation((_message: unknown, callback?: (error: Error | null) => void) => {
                sendCallback = callback;
                return true;
            });
            await harness.receive({ id: 93, type: 'recordedUseSnapshotRequest' });
            await flushNextTick();
            sendCallback?.(new Error('synthetic-snapshot-callback-error'));
            expect(harness.logError).toHaveBeenCalledWith(
                'process.send callback error: synthetic-snapshot-callback-error',
            );
        } finally {
            harness.cleanup();
        }
    });

    it('frees a leased id from a late already-released reply after release timeout retirement', async () => {
        vi.useFakeTimers();
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        try {
            const token = await grantAcquire(harness);
            expect(harness.client.allocateIdentifier()).toBeUndefined();

            const release = harness.client.recordedResourceUseClient.release(token).then(
                () => ({ status: 'released' as const }),
                (error: Error) => ({ error: error.message }),
            );
            await flushNextTick();
            await vi.advanceTimersByTimeAsync(5_000);
            await expect(release).resolves.toEqual({ error: 'IPCTimeout' });
            expect(harness.client.leased.has(1)).toBe(true);
            expect(harness.client.retiredRecordedUseReleases.has(1)).toBe(true);

            await harness.receive({
                acquisitionRequestId: 1,
                status: 'already-released',
                type: 'recordedUseReleaseReply',
            });
            expect(harness.client.leased.has(1)).toBe(false);
            expect(harness.client.retiredRecordedUseReleases.has(1)).toBe(false);
            expect(harness.client.allocateIdentifier()).toBe(1);
        } finally {
            harness.cleanup();
        }
    });

    it('ignores a release timeout or send failure firing for an acquisition id that already settled', async () => {
        const harness = makeClient();
        try {
            // Both timeoutRecordedUseRelease and failRecordedUseRelease start with the same
            // `recordedUseReleasePending.get(id) === undefined` guard. No production call site can
            // invoke either after the pending entry is already gone (clearTimeout cancels the timer
            // this file's own timeout cases exercise; sendRecordedUseRelease's failure path only
            // runs once per release, before any reply/timeout could remove it) -- exercised directly
            // here, the same way the release-registry's own already-settled guards are exercised
            // directly elsewhere in this suite.
            expect(() => harness.client.timeoutRecordedUseRelease(999_999)).not.toThrow();
            expect(harness.client.recordedUseReleasePending.size).toBe(0);

            expect(() =>
                harness.client.failRecordedUseRelease(999_999, new Error('synthetic already-settled failure')),
            ).not.toThrow();
            expect(harness.client.recordedUseReleasePending.size).toBe(0);
        } finally {
            harness.cleanup();
        }
    });
});
