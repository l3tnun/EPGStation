import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushNextTick, makeClient } from '../_harness';

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/**
 * Real IPCClient.acquireRecordedResourceUse when allocateIdentifier() returns undefined.
 * Waiter registration residual: L257–267.
 * Full production lifecycle: first occupies ID1 → second waits → blocked drain →
 * second start/grant resolve → release → zero waiters/pending/leased/timers.
 */
describe('IPCClient.acquireRecordedResourceUse allocation waiter (unittest/imp)', () => {
    it('[R2-IPC-RECORDED-USE-WAITER] drains a waiter through blocked→granted lifecycle and releases cleanly', async () => {
        vi.useFakeTimers();
        const timerBaseline = vi.getTimerCount();
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        try {
            // first acquire obtains and occupies ID1
            const first = harness.client.recordedResourceUseClient.acquire(41, 'encoding');
            await flushNextTick();
            expect(harness.client.pending.has(1)).toBe(true);
            expect(harness.send).toHaveBeenCalledOnce();
            expect(harness.send.mock.calls[0][0]).toEqual({
                id: 1,
                kind: 'encoding',
                recordedId: 41,
                type: 'recordedUseAcquire',
            });
            harness.send.mockClear();

            // second cannot allocate → waiter registration (exact residual fields)
            expect(harness.client.allocateIdentifier()).toBeUndefined();
            expect(harness.client.allocationWaiters).toHaveLength(0);

            const second = harness.client.recordedResourceUseClient.acquire(42, 'delivery');

            expect(harness.client.allocationWaiters).toHaveLength(1);
            const waiter = harness.client.allocationWaiters[0];
            expect(waiter.option).toEqual({ func: '', model: 'recorded' });
            expect(waiter.timeout).toBe(5_000);
            expect(typeof waiter.start).toBe('function');
            expect(typeof waiter.resolve).toBe('function');
            expect(typeof waiter.reject).toBe('function');
            expect(harness.send).not.toHaveBeenCalled();

            // first blocked reply → production drainAllocationWaiters → second.start(1)
            await harness.receive({ id: 1, status: 'blocked', type: 'recordedUseAcquireReply' });
            await expect(first).rejects.toThrow('RecordedResourceUseBlocked');
            await flushNextTick();

            expect(harness.client.allocationWaiters).toHaveLength(0);
            expect(harness.client.pending.has(1)).toBe(true);
            expect(harness.send).toHaveBeenCalledOnce();
            expect(harness.send.mock.calls[0][0]).toEqual({
                id: 1,
                kind: 'delivery',
                recordedId: 42,
                type: 'recordedUseAcquire',
            });

            // second granted → resolve via production resolve wrapper (L261)
            await harness.receive({ id: 1, status: 'granted', type: 'recordedUseAcquireReply' });
            const { token } = await second;
            expect(token).toEqual(expect.any(Object));
            expect(harness.client.leased.has(1)).toBe(true);
            expect(harness.client.pending.size).toBe(0);
            expect(harness.client.allocationWaiters).toHaveLength(0);

            // release through production path until terminal zero state
            const release = harness.client.recordedResourceUseClient.release(token);
            await flushNextTick();
            expect(harness.send.mock.calls.at(-1)?.[0]).toEqual({
                acquisitionRequestId: 1,
                type: 'recordedUseRelease',
            });
            await harness.receive({
                acquisitionRequestId: 1,
                status: 'released',
                type: 'recordedUseReleaseReply',
            });
            await expect(release).resolves.toBeUndefined();

            expect(harness.client.allocationWaiters).toHaveLength(0);
            expect(harness.client.pending.size).toBe(0);
            expect(harness.client.leased.size).toBe(0);
            expect(harness.client.recordedUseReleasePending.size).toBe(0);
            expect(vi.getTimerCount()).toBe(timerBaseline);
        } finally {
            harness.cleanup();
        }
    });
});
