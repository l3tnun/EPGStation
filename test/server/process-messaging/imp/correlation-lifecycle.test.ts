import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushNextTick, makeClient } from '../_harness';

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('IMP-CHAR-PM-7.2 inbound client routing', () => {
    it('routes both id-less notification kinds to only their exact client port', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            const encodeOption = { mode: 'synthetic', recordedId: 301 };

            await harness.receive({ type: 'notifyClient' });
            expect(harness.notifyClient).toHaveBeenCalledOnce();
            expect(harness.encodePush).not.toHaveBeenCalled();

            await harness.receive({ type: 'pushEncode', value: encodeOption });
            expect(harness.notifyClient).toHaveBeenCalledOnce();
            expect(harness.encodePush).toHaveBeenCalledOnce();
            expect(harness.encodePush).toHaveBeenCalledWith(encodeOption);
            expect(harness.client.pending.size).toBe(0);
            expect(harness.send).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            harness.cleanup();
        }
    });
});

describe('IMP-CHAR-PM-7.2 correlation lifecycle', () => {
    it('pending-retired-send-failure-response-and-late-response clears response resources once', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            const messageListenerCount = process.listenerCount('message');
            let settlements = 0;
            const request = harness.client.reserveation.update(101).finally(() => {
                settlements += 1;
            });
            await flushNextTick();
            const id = harness.send.mock.calls[0][0].id;
            expect(harness.client.pending.has(id)).toBe(true);
            expect(vi.getTimerCount()).toBe(1);

            await harness.receive({ id, result: 'accepted' });
            await harness.receive({ id, result: 'duplicate' });

            await expect(request).resolves.toBe('accepted');
            expect(settlements).toBe(1);
            expect(harness.client.pending.has(id)).toBe(false);
            expect(harness.client.retired.has(id)).toBe(false);
            expect(vi.getTimerCount()).toBe(0);
            expect(process.listenerCount('message')).toBe(messageListenerCount);
        } finally {
            harness.cleanup();
        }
    });

    it('ignores an unknown response without settling another request', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            let settlements = 0;
            const request = harness.client.reserveation.update(102).finally(() => {
                settlements += 1;
            });
            await flushNextTick();
            const id = harness.send.mock.calls[0][0].id;

            await harness.receive({ id: id + 100, result: 'unknown' });
            expect(settlements).toBe(0);
            expect(harness.client.pending.has(id)).toBe(true);

            await harness.receive({ id, result: 'accepted' });
            await expect(request).resolves.toBe('accepted');
            expect(settlements).toBe(1);
        } finally {
            harness.cleanup();
        }
    });

    it('keeps a full-range waiter unsent while the only id is retired', async () => {
        vi.useFakeTimers();
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        try {
            const timedOut = harness.client.reserveation.update(103);
            void timedOut.catch(() => undefined);
            await flushNextTick();
            await vi.advanceTimersByTimeAsync(5_000);

            let waiterSettlements = 0;
            const waiter = harness.client.reserveation.update(104);
            const waiterOutcome = waiter.then(
                (value: unknown) => {
                    waiterSettlements += 1;
                    return { value };
                },
                (error: Error) => {
                    waiterSettlements += 1;
                    return { error };
                },
            );
            await Promise.resolve();
            expect(harness.send).toHaveBeenCalledTimes(1);
            expect(waiterSettlements).toBe(0);

            await harness.receive({ id: 1, result: 'late' });
            await flushNextTick();
            expect(harness.send).toHaveBeenCalledTimes(2);
            expect(waiterSettlements).toBe(0);
            await harness.receive({ id: 1, result: 'waiter' });
            await expect(waiterOutcome).resolves.toEqual({ value: 'waiter' });
        } finally {
            harness.cleanup();
        }
    });

    it('resumes a FIFO waiter only after an exact leased id is released', async () => {
        vi.useFakeTimers();
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        try {
            harness.client.leased.add(1);
            let settlements = 0;
            const request = harness.client.reserveation.update(105);
            const outcome = request.then(
                (value: unknown) => {
                    settlements += 1;
                    return { value };
                },
                (error: Error) => {
                    settlements += 1;
                    return { error };
                },
            );
            await Promise.resolve();
            expect(harness.send).not.toHaveBeenCalled();
            expect(settlements).toBe(0);

            harness.client.leased.delete(1);
            harness.client.drainAllocationWaiters();
            await flushNextTick();
            expect(harness.send).toHaveBeenCalledOnce();
            expect(harness.send.mock.calls[0][0].id).toBe(1);
            await harness.receive({ id: 1, result: 'released' });
            await expect(outcome).resolves.toEqual({ value: 'released' });
        } finally {
            harness.cleanup();
        }
    });

    it('settles only once when the response wins the deadline boundary', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            let settlements = 0;
            const request = harness.client.reserveation.update(106).finally(() => {
                settlements += 1;
            });
            await flushNextTick();
            const id = harness.send.mock.calls[0][0].id;

            await vi.advanceTimersByTimeAsync(4_999);
            await harness.receive({ id, result: 'response-first' });
            await vi.advanceTimersByTimeAsync(1);

            await expect(request).resolves.toBe('response-first');
            expect(settlements).toBe(1);
            expect(harness.client.retired.has(id)).toBe(false);
            expect(vi.getTimerCount()).toBe(0);

            expect(() => harness.client.timeoutRequest(id)).not.toThrow();
            expect(settlements).toBe(1);
            expect(harness.client.pending.has(id)).toBe(false);
            expect(harness.client.retired.has(id)).toBe(false);
        } finally {
            harness.cleanup();
        }
    });

    it('settles only once when timeout wins and treats the same-turn response as late', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            let settlements = 0;
            const request = harness.client.reserveation.update(107).finally(() => {
                settlements += 1;
            });
            const outcome = request.then(
                value => value,
                (error: Error) => error.message,
            );
            await flushNextTick();
            const id = harness.send.mock.calls[0][0].id;

            await vi.advanceTimersByTimeAsync(5_000);
            await harness.receive({ id, result: 'too-late' });

            await expect(outcome).resolves.toBe('IPCTimeout');
            expect(settlements).toBe(1);
            expect(harness.client.pending.has(id)).toBe(false);
            expect(harness.client.retired.has(id)).toBe(false);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            harness.cleanup();
        }
    });
});

describe('IMP-CHAR-PM-7.2 transport lifecycle', () => {
    it('rejects and releases immediately when process.send is unavailable', async () => {
        vi.useFakeTimers();
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        try {
            delete process.send;
            let settlements = 0;
            const failed = harness.client.reserveation.update(201).then(
                (value: unknown) => ({ value }),
                (error: Error) => {
                    settlements += 1;
                    return { error };
                },
            );
            await flushNextTick();
            await Promise.resolve();

            expect(settlements).toBe(1);
            await expect(failed).resolves.toMatchObject({ error: { message: 'process.send is undefined' } });
            expect(harness.client.pending.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);

            Object.defineProperty(process, 'send', { configurable: true, value: harness.send, writable: true });
            const next = harness.client.reserveation.update(202);
            await flushNextTick();
            expect(harness.send.mock.calls[0][0].id).toBe(1);
            await harness.receive({ id: 1, result: 'next' });
            await expect(next).resolves.toBe('next');
        } finally {
            harness.cleanup();
        }
    });

    it('rejects and releases once when process.send throws synchronously', async () => {
        vi.useFakeTimers();
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        try {
            const scheduledNextTicks: Array<() => void> = [];
            harness.send.mockImplementationOnce(() => {
                throw new Error('synthetic-send-throw');
            });
            vi.spyOn(process, 'nextTick').mockImplementation(((callback: (...args: any[]) => void, ...args: any[]) => {
                scheduledNextTicks.push(() => callback(...args));
            }) as typeof process.nextTick);

            const failed = harness.client.reserveation.update(203);
            const waiter = harness.client.reserveation.update(204);
            vi.mocked(process.nextTick).mockRestore();
            expect(scheduledNextTicks).toHaveLength(1);
            expect(() => scheduledNextTicks[0]()).not.toThrow();

            await expect(failed).rejects.toThrow('synthetic-send-throw');
            expect(harness.logError).toHaveBeenCalledWith('process.send error: synthetic-send-throw');
            expect(harness.client.pending.size).toBe(1);
            expect(vi.getTimerCount()).toBe(1);

            await flushNextTick();
            expect(harness.send.mock.calls[1][0].id).toBe(1);
            await harness.receive({ id: 1, result: 'next' });
            await expect(waiter).resolves.toBe('next');
        } finally {
            harness.cleanup();
        }
    });

    it('rejects with a stringified error when process.send throws a non-Error value synchronously', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            // Every other synchronous-send-throw case in this file (and toError's other call sites)
            // throws a real Error; this exercises toError's own `new Error(String(error))` fallback,
            // which only a non-Error thrown value reaches.
            harness.send.mockImplementationOnce(() => {
                throw 'synthetic-non-error-send-throw';
            });

            const failed = harness.client.reserveation.update(205);
            await flushNextTick();

            await expect(failed).rejects.toThrow('synthetic-non-error-send-throw');
            expect(harness.logError).toHaveBeenCalledWith('process.send error: synthetic-non-error-send-throw');
        } finally {
            harness.cleanup();
        }
    });

    it('keeps a request pending when the send callback reports no error', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            let sendCallback: ((error: Error | null) => void) | undefined;
            harness.send.mockImplementation((_message: unknown, callback?: (error: Error | null) => void) => {
                sendCallback = callback;
                return true;
            });
            const request = harness.client.reserveation.update(211);
            await flushNextTick();
            const id = harness.send.mock.calls[0][0].id;

            sendCallback?.(null);
            sendCallback?.(new Error('ignored-after-successful-callback'));

            expect(harness.logError).not.toHaveBeenCalled();
            expect(harness.client.pending.has(id)).toBe(true);
            expect(vi.getTimerCount()).toBe(1);

            await harness.receive({ id, result: 'accepted' });
            await expect(request).resolves.toBe('accepted');
            expect(harness.client.pending.has(id)).toBe(false);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            harness.cleanup();
        }
    });

    it('keeps the response result when a synchronous send throw follows the matching response', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            const scheduledNextTicks: Array<() => void> = [];
            harness.send.mockImplementationOnce((message: { id: number }) => {
                void harness.receive({ id: message.id, result: 'response-first' });
                throw new Error('throw-after-response');
            });
            vi.spyOn(process, 'nextTick').mockImplementation(((callback: (...args: any[]) => void, ...args: any[]) => {
                scheduledNextTicks.push(() => callback(...args));
            }) as typeof process.nextTick);

            let settlements = 0;
            const request = harness.client.reserveation.update(212).finally(() => {
                settlements += 1;
            });
            vi.mocked(process.nextTick).mockRestore();

            expect(scheduledNextTicks).toHaveLength(1);
            expect(() => scheduledNextTicks[0]()).not.toThrow();
            await expect(request).resolves.toBe('response-first');
            expect(settlements).toBe(1);
            expect(harness.logError).toHaveBeenCalledWith('process.send error: throw-after-response');
            expect(harness.client.pending.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            harness.cleanup();
        }
    });

    it('does not recursively drain an allocation waiter while a drain is active', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            harness.client.allocationWaiters.push({
                option: { func: 'getBroadcastStatus', model: 'reserveation' },
                reject: vi.fn(),
                resolve: vi.fn(),
                timeout: 5_000,
            });
            harness.client.isDrainingAllocationWaiters = true;

            harness.client.drainAllocationWaiters();

            expect(harness.client.allocationWaiters).toHaveLength(1);
            expect(harness.client.pending.size).toBe(0);
            expect(harness.send).not.toHaveBeenCalled();

            harness.client.isDrainingAllocationWaiters = false;
            harness.client.drainAllocationWaiters();
            await flushNextTick();
            expect(harness.client.allocationWaiters).toHaveLength(0);
            expect(harness.send).toHaveBeenCalledOnce();
            await harness.receive({ id: 1, result: 'drained' });
        } finally {
            harness.cleanup();
        }
    });

    it('marks the complete waiter drain as non-reentrant', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            const drainStates: boolean[] = [];
            const option = {
                func: 'getBroadcastStatus',
                get model(): string {
                    drainStates.push(harness.client.isDrainingAllocationWaiters);
                    return 'reserveation';
                },
            };
            harness.client.allocationWaiters.push({
                option,
                reject: vi.fn(),
                resolve: vi.fn(),
                timeout: 5_000,
            });

            harness.client.drainAllocationWaiters();

            expect(drainStates).toEqual([true]);
            expect(harness.client.isDrainingAllocationWaiters).toBe(false);
            await flushNextTick();
            await harness.receive({ id: 1, result: 'drained' });
        } finally {
            harness.cleanup();
        }
    });

    it('records callback error but keeps the same pending request, timer, and allocation waiter', async () => {
        vi.useFakeTimers();
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        try {
            let sendCallback: ((error: Error | null) => void) | undefined;
            harness.send.mockImplementation((_message: unknown, callback?: (error: Error | null) => void) => {
                sendCallback = callback;
                return true;
            });
            let requestSettlements = 0;
            const request = harness.client.reserveation.update(205).finally(() => {
                requestSettlements += 1;
            });
            await flushNextTick();
            expect(sendCallback).toBeTypeOf('function');

            let waiterSettlements = 0;
            const waiter = harness.client.reserveation.update(206).then(
                (value: unknown) => {
                    waiterSettlements += 1;
                    return { value };
                },
                (error: Error) => {
                    waiterSettlements += 1;
                    return { error };
                },
            );
            sendCallback?.(new Error('synthetic-callback-error'));
            sendCallback?.(new Error('duplicate-callback-error'));
            await Promise.resolve();

            expect(harness.logError).toHaveBeenCalledOnce();
            expect(harness.logError.mock.calls[0][0]).toContain('synthetic-callback-error');
            expect(requestSettlements).toBe(0);
            expect(waiterSettlements).toBe(0);
            expect(harness.client.pending.has(1)).toBe(true);
            expect(vi.getTimerCount()).toBe(1);
            expect(harness.send).toHaveBeenCalledOnce();

            await harness.receive({ id: 1, result: 'request-result' });
            await expect(request).resolves.toBe('request-result');
            await flushNextTick();
            expect(harness.send).toHaveBeenCalledTimes(2);
            expect(waiterSettlements).toBe(0);
            await harness.receive({ id: 1, result: 'waiter-result' });
            await expect(waiter).resolves.toEqual({ value: 'waiter-result' });
        } finally {
            harness.cleanup();
        }
    });

    it('keeps callback-failed id retired until a late reply after timeout', async () => {
        vi.useFakeTimers();
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        try {
            let sendCallback: ((error: Error | null) => void) | undefined;
            harness.send.mockImplementation((_message: unknown, callback?: (error: Error | null) => void) => {
                sendCallback = callback;
                return true;
            });
            const request = harness.client.reserveation.update(209);
            const requestOutcome = request.then(
                value => ({ value }),
                (error: Error) => ({ error }),
            );
            await flushNextTick();
            sendCallback?.(new Error('synthetic-callback-error'));

            let waiterSettlements = 0;
            const waiter = harness.client.reserveation.update(210).then(
                (value: unknown) => {
                    waiterSettlements += 1;
                    return { value };
                },
                (error: Error) => {
                    waiterSettlements += 1;
                    return { error };
                },
            );
            await vi.advanceTimersByTimeAsync(5_000);

            await expect(requestOutcome).resolves.toMatchObject({ error: { message: 'IPCTimeout' } });
            expect(harness.logError).toHaveBeenCalledOnce();
            expect(harness.client.pending.has(1)).toBe(false);
            expect(harness.client.retired.has(1)).toBe(true);
            expect(waiterSettlements).toBe(0);
            expect(harness.send).toHaveBeenCalledOnce();

            await harness.receive({ id: 1, result: 'late-result' });
            await flushNextTick();
            expect(harness.client.retired.has(1)).toBe(false);
            expect(waiterSettlements).toBe(0);
            expect(harness.send).toHaveBeenCalledTimes(2);
            await harness.receive({ id: 1, result: 'waiter-result' });
            await expect(waiter).resolves.toEqual({ value: 'waiter-result' });
        } finally {
            harness.cleanup();
        }
    });

    it('starts the response timer only after an allocation waiter receives an id', async () => {
        vi.useFakeTimers();
        const harness = makeClient({ max: 1, successor: (current: number) => current + 1 });
        try {
            const first = harness.client.reserveation.update(207);
            void first.catch(() => undefined);
            const second = harness.client.reserveation.update(208);
            const secondOutcome = second.then(
                value => ({ value }),
                (error: Error) => ({ error }),
            );
            await flushNextTick();
            expect(vi.getTimerCount()).toBe(1);

            await vi.advanceTimersByTimeAsync(5_001);
            expect(harness.send).toHaveBeenCalledOnce();
            await harness.receive({ id: 1, result: 'late-first' });
            await flushNextTick();
            expect(harness.send).toHaveBeenCalledTimes(2);
            expect(vi.getTimerCount()).toBe(1);

            await vi.advanceTimersByTimeAsync(4_999);
            expect(harness.client.pending.has(1)).toBe(true);
            await harness.receive({ id: 1, result: 'second-result' });
            await expect(secondOutcome).resolves.toEqual({ value: 'second-result' });
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            harness.cleanup();
        }
    });
});
