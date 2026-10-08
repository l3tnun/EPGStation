import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushNextTick, makeClient } from '../_harness';

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('IMP-CHAR-PM-7.2 numeric allocator', () => {
    it('numeric-range-wrap-successor-zero-full-release-resume binds the production maximum', () => {
        const harness = makeClient();
        try {
            expect(harness.client.idAllocationSeams.max).toBe(Number.MAX_SAFE_INTEGER);
            expect(harness.client.nextCandidate).toBe(1);
        } finally {
            harness.cleanup();
        }
    });

    it('does not evaluate successor at the maximum branch', async () => {
        vi.useFakeTimers();
        const successor = vi.fn((current: number) => {
            if (current === 3) throw new Error('successor must not receive the maximum');
            return current + 1;
        });
        const harness = makeClient({ max: 3, successor });
        try {
            harness.client.nextCandidate = 3;
            void harness.client.reserveation.getBroadcastStatus();
            await flushNextTick();

            expect(harness.send.mock.calls[0][0].id).toBe(3);
            expect(successor).not.toHaveBeenCalled();
            expect(harness.client.nextCandidate).toBe(1);
        } finally {
            harness.cleanup();
        }
    });

    it('accepts the exact production maximum while preserving the injected successor ledger', () => {
        const successor = vi.fn((current: number) => current + 1);
        const harness = makeClient({ max: Number.MAX_SAFE_INTEGER, successor });
        try {
            expect(harness.client.idAllocationSeams.max).toBe(Number.MAX_SAFE_INTEGER);
            expect(harness.client.allocateIdentifier()).toBe(1);
            expect(successor).toHaveBeenCalledOnce();
            expect(successor).toHaveBeenCalledWith(1);
            expect(harness.client.nextCandidate).toBe(2);
        } finally {
            harness.cleanup();
        }
    });

    it.each([0, -1, 4, Number.MAX_SAFE_INTEGER + 1, 1.5, '2'])('never adopts invalid successor %j', async invalid => {
        vi.useFakeTimers();
        const successor = vi.fn(() => invalid as number);
        const harness = makeClient({ max: 3, successor });
        try {
            void harness.client.reserveation.update(1);
            void harness.client.reserveation.update(2);
            await flushNextTick();

            const ids = harness.send.mock.calls.map(([message]) => message.id);
            expect(ids).toEqual([1, 2]);
            expect(ids.every((id: unknown) => typeof id === 'number' && Number.isSafeInteger(id))).toBe(true);
        } finally {
            harness.cleanup();
        }
    });

    it.each([0, -1, Number.MAX_SAFE_INTEGER + 1, 1.5, '3'])('ignores invalid allocator maximum %j', async max => {
        vi.useFakeTimers();
        const harness = makeClient({ max: max as number, successor: (current: number) => current + 1 });
        try {
            void harness.client.reserveation.getBroadcastStatus();
            await flushNextTick();

            const id = harness.send.mock.calls[0][0].id;
            expect(id).toBe(1);
            expect(harness.client.idAllocationSeams.max).toBe(Number.MAX_SAFE_INTEGER);
        } finally {
            harness.cleanup();
        }
    });

    it.each([undefined, null, 0, 'next'])('uses the production successor when the seam is %j', successor => {
        const harness = makeClient({ max: 3, successor });
        try {
            expect(harness.client.allocateIdentifier()).toBe(1);
            expect(harness.client.allocateIdentifier()).toBe(2);
            expect(harness.client.nextCandidate).toBe(3);
        } finally {
            harness.cleanup();
        }
    });

    it.each(['pending', 'retired', 'leased'] as const)('returns no id when %s owns the complete range', owner => {
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        try {
            if (owner === 'pending') harness.client.pending.set(1, {});
            else harness.client[owner].add(1);

            expect(harness.client.allocateIdentifier()).toBeUndefined();
            expect(harness.client.nextCandidate).toBe(1);
        } finally {
            harness.cleanup();
        }
    });

    it('keeps a free cursor even when a later identifier is occupied', () => {
        const harness = makeClient({ max: 3, successor: (current: number) => current + 1 });
        try {
            harness.client.leased.add(2);

            expect(harness.client.allocateIdentifier()).toBe(1);
            expect(harness.client.nextCandidate).toBe(2);
        } finally {
            harness.cleanup();
        }
    });
});
