import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadProduction, loggerModel, makeReservationHarness } from '../fixtures/reservation-rules/runtime';

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
});

const eventPort = () => {
    const callbacks: Record<string, (...args: unknown[]) => unknown> = {};
    return {
        callbacks,
        port: new Proxy(
            {},
            {
                get: (_target, property: string) => (callback: (...args: unknown[]) => unknown) => {
                    callbacks[property] = callback;
                },
            },
        ),
    };
};

const drainMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('candidate recalculation trigger characterization', () => {
    it('[RR-6.1][RR-6.2][RR-7.5] forwards every Rule event and every program update as independent recalculation calls', async () => {
        const epg = eventPort();
        const rule = eventPort();
        const inertEvents = Array.from({ length: 6 }, eventPort);
        const reservationManage = {
            updateAll: vi.fn(async () => undefined),
            updateRule: vi.fn(async () => undefined),
            cancel: vi.fn(),
        };
        const EventSetter = loadProduction<new (...args: unknown[]) => { set(): void }>(
            'model',
            'event',
            'EventSetter.js',
        );
        const setter = new EventSetter(
            loggerModel,
            epg.port,
            inertEvents[0].port,
            rule.port,
            inertEvents[1].port,
            inertEvents[2].port,
            inertEvents[3].port,
            inertEvents[4].port,
            inertEvents[5].port,
            reservationManage,
            { update: vi.fn() },
            { historyCleanup: vi.fn(async () => undefined), removeRuleId: vi.fn(async () => undefined) },
            {},
            { add: vi.fn() },
            new Proxy({}, { get: () => vi.fn() }),
            { notifyClient: vi.fn(), setEncode: vi.fn() },
            { getConfig: () => ({ recorded: [{ name: 'synthetic' }] }) },
            { setup: vi.fn() },
        );
        setter.set();

        for (const callback of ['setAdded', 'setUpdated', 'setEnabled', 'setDisabled']) rule.callbacks[callback](77);
        await rule.callbacks.setDeleted(78);
        await epg.callbacks.setUpdated();
        await epg.callbacks.setUpdated();

        expect(reservationManage.updateRule.mock.calls).toEqual([[77], [77], [77], [77], [78]]);
        expect(reservationManage.updateAll.mock.calls).toEqual([[true], [false]]);
    });
});

describe('all-rule batch characterization', () => {
    it('[IMP-BULK-BATCH-ORDER][RR-6.7][RR-6.8][RR-6.9][RR-6.11] processes IDs sequentially, waits 10ms, and continues after failure', async () => {
        vi.useFakeTimers();
        const harness = makeReservationHarness({
            ruleDB: { findId: vi.fn(), getIds: vi.fn(async () => [3, 5, 8]) },
        });
        const settlements: Array<{ reject(error: Error): void; resolve(): void }> = [];
        const updateRule = vi.fn(
            () =>
                new Promise<void>((resolve, reject) => {
                    settlements.push({ reject, resolve });
                }),
        );
        harness.model.updateRule = updateRule;

        const batch = harness.model.updateAll();
        await drainMicrotasks();
        expect(updateRule.mock.calls).toEqual([[3, false, false]]);

        settlements[0].resolve();
        await drainMicrotasks();
        expect(updateRule).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(10);
        expect(updateRule.mock.calls).toEqual([
            [3, false, false],
            [5, false, false],
        ]);

        settlements[1].reject(new Error('synthetic-item-failure'));
        await drainMicrotasks();
        await vi.advanceTimersByTimeAsync(10);
        expect(updateRule.mock.calls).toEqual([
            [3, false, false],
            [5, false, false],
            [8, false, false],
        ]);
        settlements[2].resolve();
        await drainMicrotasks();
        await vi.advanceTimersByTimeAsync(10);
        await expect(batch).resolves.toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[IMP-BULK-BATCH-ORDER][RR-6.12] does not coalesce overlapping full batches and lets independent item boundaries interleave', async () => {
        vi.useFakeTimers();
        const harness = makeReservationHarness({
            ruleDB: {
                findId: vi.fn(),
                getIds: vi.fn().mockResolvedValueOnce([1, 3]).mockResolvedValueOnce([2, 4]),
            },
        });
        const updateRule = vi.fn(async () => undefined);
        harness.model.updateRule = updateRule;

        const first = harness.model.updateAll();
        const second = harness.model.updateAll();
        await drainMicrotasks();
        expect(updateRule.mock.calls).toEqual([
            [1, false, false],
            [2, false, false],
        ]);

        await vi.runAllTimersAsync();
        await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
        expect(updateRule.mock.calls).toEqual([
            [1, false, false],
            [2, false, false],
            [3, false, false],
            [4, false, false],
        ]);
        expect(vi.getTimerCount()).toBe(0);
    });
});
