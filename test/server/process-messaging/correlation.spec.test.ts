import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushImmediate, flushNextTick, makeChild, makeClient, makeServer } from './_harness';

const expectClientRequestResourcesReleased = (client: any): void => {
    expect(client.pending.size).toBe(0);
    expect(client.retired.size).toBe(0);
    expect(client.leased.size).toBe(0);
    expect(client.allocationWaiters).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
};

const terminalEvents = ['exit', 'error', 'disconnect', 'close'] as const;

const expectPeerReleased = (server: any, child: ReturnType<typeof makeChild>): void => {
    child.emit('disconnect');
    expect(server.child).toBeNull();
    expect(server.currentPeer).toBeNull();
    expect(child.listenerCount('message')).toBe(0);
    for (const event of terminalEvents) expect(child.listenerCount(event)).toBe(0);
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('SPEC-CORR numeric request identifiers', () => {
    it('[PM-2.1] sends the reserved numeric id with the unchanged operation envelope', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(123_456);
        const harness = makeClient();
        try {
            const request = harness.client.reserveation.update(17);

            await flushNextTick();

            expect(harness.send).toHaveBeenCalledOnce();
            expect(harness.send.mock.calls[0][0]).toEqual({
                args: { reserveId: 17 },
                func: 'update',
                id: 1,
                model: 'reserveation',
            });
            await harness.receive({ id: 1, result: undefined });
            await expect(request).resolves.toBeUndefined();
            expectClientRequestResourcesReleased(harness.client);
        } finally {
            harness.cleanup();
        }
    });

    it('[PM-2.7] starts at 1 within the production safe-integer range', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            const request = harness.client.reserveation.getBroadcastStatus();
            await flushNextTick();

            const message = harness.send.mock.calls[0][0];
            expect(message.id).toBe(1);
            expect(Number.isSafeInteger(message.id)).toBe(true);
            expect(message.id).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
            await harness.receive({ id: message.id, result: { isBroadcasting: false } });
            await expect(request).resolves.toEqual({ isBroadcasting: false });
            expectClientRequestResourcesReleased(harness.client);
        } finally {
            harness.cleanup();
        }
    });

    it('[PM-2.8] reserves distinct ids before the next event-loop turn', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(321_000);
        const harness = makeClient();
        try {
            const first = harness.client.reserveation.update(1);
            const second = harness.client.reserveation.update(2);

            const pendingBeforeNextTick = harness.client.pending;
            await flushNextTick();
            expect(pendingBeforeNextTick).toBeInstanceOf(Map);
            expect(pendingBeforeNextTick.size).toBe(2);
            expect(harness.send.mock.calls.map(([message]) => message.id)).toEqual([1, 2]);
            await harness.receive({ id: 2, result: undefined });
            await harness.receive({ id: 1, result: undefined });
            await expect(first).resolves.toBeUndefined();
            await expect(second).resolves.toBeUndefined();
            expectClientRequestResourcesReleased(harness.client);
        } finally {
            harness.cleanup();
        }
    });

    it('[PM-2.9] wraps directly from the configured maximum to 1', async () => {
        vi.useFakeTimers();
        const successor = vi.fn((current: number) => current + 1);
        const harness = makeClient({ max: 3, successor });
        try {
            harness.client.nextCandidate = 3;
            const atMaximum = harness.client.reserveation.update(3);
            const afterWrap = harness.client.reserveation.update(1);

            await flushNextTick();
            expect(harness.send.mock.calls.map(([message]) => message.id)).toEqual([3, 1]);
            expect(successor).not.toHaveBeenCalledWith(3);
            await harness.receive({ id: 3, result: undefined });
            await harness.receive({ id: 1, result: undefined });
            await expect(atMaximum).resolves.toBeUndefined();
            await expect(afterWrap).resolves.toBeUndefined();
            expectClientRequestResourcesReleased(harness.client);
        } finally {
            harness.cleanup();
        }
    });

    it('[PM-2.10] skips pending, retired, and leased ids from the wrap point', async () => {
        vi.useFakeTimers();
        const harness = makeClient({ max: 4, successor: (current: number) => current + 1 });
        try {
            harness.client.nextCandidate = 2;
            const retired = harness.client.reserveation.update(102).then(
                () => ({ status: 'fulfilled' as const }),
                (error: Error) => ({ error, status: 'rejected' as const }),
            );
            await flushNextTick();
            expect(harness.send.mock.calls[0][0].id).toBe(2);
            await vi.advanceTimersByTimeAsync(5_000);
            await expect(retired).resolves.toEqual({
                error: expect.objectContaining({ message: 'IPCTimeout' }),
                status: 'rejected',
            });

            harness.client.nextCandidate = 1;
            const pending = harness.client.reserveation.update(101);
            await flushNextTick();
            expect(harness.send.mock.calls[1][0].id).toBe(1);

            const acquired = harness.client.recordedResourceUseClient.acquire(103, 'encoding');
            await flushNextTick();
            expect(harness.send.mock.calls[2][0]).toEqual({
                id: 3,
                kind: 'encoding',
                recordedId: 103,
                type: 'recordedUseAcquire',
            });
            await harness.receive({ id: 3, status: 'granted', type: 'recordedUseAcquireReply' });
            const { token } = await acquired;
            expect(harness.client.leased.has(3)).toBe(true);

            const wrapped = harness.client.reserveation.getBroadcastStatus();
            await flushNextTick();

            expect(harness.send.mock.calls[3][0].id).toBe(4);
            await harness.receive({ id: 1, result: undefined });
            await harness.receive({ id: 2, result: 'late-retired-result' });
            const release = harness.client.recordedResourceUseClient.release(token);
            await flushNextTick();
            expect(harness.send.mock.calls[4][0]).toEqual({ acquisitionRequestId: 3, type: 'recordedUseRelease' });
            await harness.receive({ acquisitionRequestId: 3, status: 'released', type: 'recordedUseReleaseReply' });
            await harness.receive({ id: 4, result: { isBroadcasting: false } });
            await expect(pending).resolves.toBeUndefined();
            await expect(release).resolves.toBeUndefined();
            await expect(wrapped).resolves.toEqual({ isBroadcasting: false });
            expectClientRequestResourcesReleased(harness.client);
        } finally {
            harness.cleanup();
        }
    });

    it('[PM-2.16] keeps every wire id a positive number instead of a string or bigint', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            const requests = Array.from({ length: 4 }, (_, index) => harness.client.reserveation.update(index + 1));
            await flushNextTick();

            const ids = harness.send.mock.calls.map(([message]) => message.id);
            expect(ids).toEqual([1, 2, 3, 4]);
            expect(ids.every((id: unknown) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)).toBe(true);
            for (const id of ids) await harness.receive({ id, result: undefined });
            await expect(Promise.all(requests)).resolves.toEqual([undefined, undefined, undefined, undefined]);
            expectClientRequestResourcesReleased(harness.client);
        } finally {
            harness.cleanup();
        }
    });
});

describe('SPEC-CORR request correlation lifecycle', () => {
    it('[PM-2.2] dispatches the exact target and operation', async () => {
        const { domains, server } = makeServer();
        const child = makeChild();
        server.register(child);

        child.emit('message', { args: { reserveId: 27 }, func: 'update', id: 201, model: 'reserveation' });
        await flushImmediate();

        expect(domains.reservation.update).toHaveBeenCalledOnce();
        expect(domains.reservation.update).toHaveBeenCalledWith(27);
        expectPeerReleased(server, child);
    });

    it('[PM-2.3] returns a successful result with the request id', async () => {
        const { domains, server } = makeServer();
        const child = makeChild();
        domains.reservation.getBroadcastStatus.mockResolvedValue({ isBroadcasting: false });
        server.register(child);

        child.emit('message', { func: 'getBroadcastStatus', id: 202, model: 'reserveation' });
        await flushImmediate();

        expect(child.send).toHaveBeenCalledWith({ id: 202, result: { isBroadcasting: false } });
        expectPeerReleased(server, child);
    });

    it('[PM-2.4] returns a failed result with the request id', async () => {
        const { domains, server } = makeServer();
        const child = makeChild();
        const preparation = { isRecording: false, reserveId: null, status: 'prepared' as const, token: {} };
        domains.recorded.prepareUserDeletion.mockResolvedValue(preparation);
        domains.recorded.deletePrepared.mockRejectedValue(new Error('synthetic-delete-error'));
        server.register(child);

        child.emit('message', { args: { recordedId: 28 }, func: 'delete', id: 203, model: 'recorded' });
        await flushImmediate();

        expect(child.send).toHaveBeenCalledWith({ error: 'synthetic-delete-error', id: 203 });
        expect(domains.recorded.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(28);
        expect(domains.recorded.deletePrepared).toHaveBeenCalledExactlyOnceWith(preparation.token);
        expect(domains.recorded.prepareUserDeletion.mock.invocationCallOrder[0]).toBeLessThan(
            domains.recorded.deletePrepared.mock.invocationCallOrder[0],
        );
        expectPeerReleased(server, child);
    });

    it('[PM-2.5] settles only the pending Promise with the matching id', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            let firstSettlements = 0;
            const first = harness.client.reserveation.update(31).finally(() => {
                firstSettlements += 1;
            });
            const second = harness.client.reserveation.update(32);
            await flushNextTick();
            const [firstMessage, secondMessage] = harness.send.mock.calls.map(([message]) => message);

            await harness.receive({ id: secondMessage.id, result: 'second' });
            await expect(second).resolves.toBe('second');
            expect(firstSettlements).toBe(0);
            expect([...harness.client.pending.keys()]).toEqual([firstMessage.id]);

            await harness.receive({ id: firstMessage.id, result: 'first' });
            await expect(first).resolves.toBe('first');
            expect(firstSettlements).toBe(1);
            expectClientRequestResourcesReleased(harness.client);
        } finally {
            harness.cleanup();
        }
    });

    it('[PM-2.6] accepts out-of-order responses without changing completion ownership', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            const first = harness.client.reserveation.update(41);
            const second = harness.client.reserveation.update(42);
            await flushNextTick();
            const [firstMessage, secondMessage] = harness.send.mock.calls.map(([message]) => message);

            await harness.receive({ id: secondMessage.id, result: 'second' });
            await harness.receive({ id: firstMessage.id, result: 'first' });

            await expect(second).resolves.toBe('second');
            await expect(first).resolves.toBe('first');
            expectClientRequestResourcesReleased(harness.client);
        } finally {
            harness.cleanup();
        }
    });

    it('[PM-2.11] releases a synchronously reserved id when message creation fails', async () => {
        vi.useFakeTimers();
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        try {
            const invalidOption = Object.defineProperty({ func: 'update' }, 'model', {
                get: () => {
                    throw new Error('synthetic-message-error');
                },
            });

            await expect(harness.client.send(invalidOption)).rejects.toThrow('synthetic-message-error');
            const next = harness.client.reserveation.getBroadcastStatus();
            const nextOutcome = next.then(
                (value: unknown) => ({ value }),
                (error: Error) => ({ error }),
            );
            await flushNextTick();

            expect(harness.send).toHaveBeenCalledOnce();
            expect(harness.send.mock.calls[0][0].id).toBe(1);
            await harness.receive({ id: 1, result: { isBroadcasting: false } });
            await expect(nextOutcome).resolves.toEqual({ value: { isBroadcasting: false } });
            expectClientRequestResourcesReleased(harness.client);
        } finally {
            harness.cleanup();
        }
    });

    it('[PM-2.12] releases success and error requests exactly once', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            const success = harness.client.reserveation.update(51);
            const failure = harness.client.reserveation.update(52);
            await flushNextTick();
            const [successMessage, failureMessage] = harness.send.mock.calls.map(([message]) => message);

            await harness.receive({ id: successMessage.id, result: undefined });
            await harness.receive({ error: 'synthetic-domain-error', id: failureMessage.id });

            await expect(success).resolves.toBeUndefined();
            await expect(failure).rejects.toThrow('synthetic-domain-error');
            expectClientRequestResourcesReleased(harness.client);
        } finally {
            harness.cleanup();
        }
    });

    it('[PM-2.13] moves a timed-out id from pending to retired', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            const request = harness.client.reserveation.update(61);
            const rejection = request.then(
                () => undefined,
                (error: Error) => error,
            );
            await flushNextTick();
            const id = harness.send.mock.calls[0][0].id;

            await vi.advanceTimersByTimeAsync(5_000);

            await expect(rejection).resolves.toMatchObject({ message: 'IPCTimeout' });
            expect(harness.client.pending.has(id)).toBe(false);
            expect(harness.client.retired.has(id)).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
            await harness.receive({ id, result: 'late-result' });
            expectClientRequestResourcesReleased(harness.client);
        } finally {
            harness.cleanup();
        }
    });

    it('[PM-2.14] discards a late result and only then makes the id reusable', async () => {
        vi.useFakeTimers();
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        try {
            const timedOut = harness.client.reserveation.update(71);
            const timedOutResult = timedOut.then(
                () => 'resolved',
                (error: Error) => error.message,
            );
            await flushNextTick();
            await vi.advanceTimersByTimeAsync(5_000);
            await expect(timedOutResult).resolves.toBe('IPCTimeout');

            let replacementSettlements = 0;
            const replacement = harness.client.reserveation.update(72);
            const replacementOutcome = replacement.then(
                (value: unknown) => {
                    replacementSettlements += 1;
                    return { value };
                },
                (error: Error) => {
                    replacementSettlements += 1;
                    return { error };
                },
            );
            await Promise.resolve();
            expect(harness.send).toHaveBeenCalledTimes(1);
            expect(replacementSettlements).toBe(0);

            await harness.receive({ id: 1, result: 'late-result' });
            await flushNextTick();
            expect(harness.send).toHaveBeenCalledTimes(2);
            expect(harness.send.mock.calls[1][0].id).toBe(1);
            expect(replacementSettlements).toBe(0);

            await harness.receive({ id: 1, result: 'replacement-result' });
            await expect(replacementOutcome).resolves.toEqual({ value: 'replacement-result' });
            expect(replacementSettlements).toBe(1);
            expectClientRequestResourcesReleased(harness.client);
        } finally {
            harness.cleanup();
        }
    });

    it('[PM-2.15] resumes all-used requests once each in FIFO order', async () => {
        vi.useFakeTimers();
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        try {
            const first = harness.client.reserveation.update(81);
            const second = harness.client.reserveation.update(82);
            const third = harness.client.reserveation.update(83);
            const secondOutcome = second.then(
                value => ({ value }),
                (error: Error) => ({ error }),
            );
            const thirdOutcome = third.then(
                value => ({ value }),
                (error: Error) => ({ error }),
            );
            await flushNextTick();
            expect(harness.send).toHaveBeenCalledTimes(1);

            await harness.receive({ id: 1, result: 'first' });
            await expect(first).resolves.toBe('first');
            await flushNextTick();
            expect(harness.send).toHaveBeenCalledTimes(2);
            expect(harness.send.mock.calls[1][0].args.reserveId).toBe(82);

            await harness.receive({ id: 1, result: 'second' });
            await flushNextTick();
            expect(harness.send).toHaveBeenCalledTimes(3);
            expect(harness.send.mock.calls[2][0].args.reserveId).toBe(83);
            await harness.receive({ id: 1, result: 'third' });

            await expect(secondOutcome).resolves.toEqual({ value: 'second' });
            await expect(thirdOutcome).resolves.toEqual({ value: 'third' });
            expect(harness.send).toHaveBeenCalledTimes(3);
            expectClientRequestResourcesReleased(harness.client);
        } finally {
            harness.cleanup();
        }
    });
});
