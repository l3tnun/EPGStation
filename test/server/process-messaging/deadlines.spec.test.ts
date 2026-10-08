import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushNextTick, makeClient } from './_harness';

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const expectClientRequestResourcesReleased = (client: any): void => {
    expect(client.pending.size).toBe(0);
    expect(client.retired.size).toBe(0);
    expect(client.leased.size).toBe(0);
    expect(client.allocationWaiters).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
};

const expectDeadline = async (invoke: (client: any) => Promise<unknown>, deadline: number): Promise<void> => {
    vi.useFakeTimers();
    const harness = makeClient();
    try {
        let settlements = 0;
        const request = invoke(harness.client);
        const outcome = request.then(
            value => {
                settlements += 1;
                return { value };
            },
            (error: Error) => {
                settlements += 1;
                return { error };
            },
        );
        await flushNextTick();
        const id = harness.send.mock.calls[0][0].id;

        await vi.advanceTimersByTimeAsync(deadline - 1);
        expect(settlements).toBe(0);
        expect(harness.client.pending.has(id)).toBe(true);
        expect(harness.client.retired.has(id)).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        expect(settlements).toBe(1);
        await expect(outcome).resolves.toMatchObject({ error: { message: 'IPCTimeout' } });
        expect(harness.client.pending.has(id)).toBe(false);
        expect(harness.client.retired.has(id)).toBe(true);

        await vi.advanceTimersByTimeAsync(1);
        expect(settlements).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
        await harness.receive({ id, result: 'late-result' });
        expectClientRequestResourcesReleased(harness.client);
    } finally {
        harness.cleanup();
    }
};

describe('SPEC-DEADLINE operation deadlines', () => {
    it('[PM-4.1] applies 4,999/5,000/5,001ms boundaries to a normal request', async () => {
        await expectDeadline(client => client.reserveation.update(201), 5_000);
    });

    // 600_000 (10min) in [PM-4.2]-[PM-4.4] below is longRequestTimeout
    // (src/model/ipc/IPCClient.ts:59), the long-operation counterpart of the ordinary
    // defaultRequestTimeout = 5_000 declared alongside it (IPCClient.ts:58) and in
    // src/model/ipc/IPCServer.ts:76. A v3-only IPC deadline with no v2 counterpart -- approved in
    // .kiro/specs/server-process-messaging/design.md:212,521.
    it('[PM-4.2] applies 599,999/600,000/600,001ms boundaries to upload registration', async () => {
        await expectDeadline(client => client.recorded.addUploadedVideoFile({ name: 'synthetic-upload' }), 600_000);
    });

    it('[PM-4.3] applies a finite 600,000ms boundary to video cleanup', async () => {
        await expectDeadline(client => client.recorded.videoFileCleanup(), 600_000);
    });

    it('[PM-4.4] applies a finite 600,000ms boundary to drop-log cleanup', async () => {
        await expectDeadline(client => client.recorded.dropLogFileCleanup(), 600_000);
    });

    it('[PM-4.5] rejects only the requester once at its deadline', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            let settlements = 0;
            const request = harness.client.thumbnail.add(301);
            const outcome = request.then(
                value => value,
                (error: Error) => {
                    settlements += 1;
                    return error.message;
                },
            );
            await flushNextTick();

            await vi.advanceTimersByTimeAsync(5_000);
            await expect(outcome).resolves.toBe('IPCTimeout');
            await vi.advanceTimersByTimeAsync(5_000);
            expect(settlements).toBe(1);
            const id = harness.send.mock.calls[0][0].id;
            await harness.receive({ id, result: 'late-result' });
            expectClientRequestResourcesReleased(harness.client);
        } finally {
            harness.cleanup();
        }
    });

    it('[PM-4.6] does not send handler cancellation or abort after requester timeout', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            const request = harness.client.recorded.delete(302);
            void request.catch(() => undefined);
            await flushNextTick();
            const requestMessage = harness.send.mock.calls[0][0];

            await vi.advanceTimersByTimeAsync(5_001);

            expect(harness.send).toHaveBeenCalledOnce();
            expect(requestMessage).toEqual({
                args: { recordedId: 302 },
                func: 'delete',
                id: 1,
                model: 'recorded',
            });
            await harness.receive({ id: requestMessage.id, result: undefined });
            expectClientRequestResourcesReleased(harness.client);
        } finally {
            harness.cleanup();
        }
    });

    it('[PM-4.7] keeps the timeout result and releases retired state only after a late reply', async () => {
        vi.useFakeTimers();
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        try {
            const request = harness.client.recorded.delete(303);
            const outcome = request.then(
                value => value,
                (error: Error) => error.message,
            );
            await flushNextTick();
            await vi.advanceTimersByTimeAsync(5_000);
            await expect(outcome).resolves.toBe('IPCTimeout');

            let replacementSettlements = 0;
            const replacement = harness.client.recorded.delete(304).then(
                value => {
                    replacementSettlements += 1;
                    return { value };
                },
                (error: Error) => {
                    replacementSettlements += 1;
                    return { error };
                },
            );
            await Promise.resolve();
            expect(replacementSettlements).toBe(0);
            expect(harness.client.retired.has(1)).toBe(true);

            await harness.receive({ id: 1, result: 'late-result' });
            await flushNextTick();
            expect(replacementSettlements).toBe(0);
            expect(harness.client.retired.has(1)).toBe(false);
            expect(harness.send).toHaveBeenCalledTimes(2);

            await harness.receive({ id: 1, result: 'replacement-result' });
            await expect(replacement).resolves.toEqual({ value: 'replacement-result' });
            expectClientRequestResourcesReleased(harness.client);
        } finally {
            harness.cleanup();
        }
    });
});
