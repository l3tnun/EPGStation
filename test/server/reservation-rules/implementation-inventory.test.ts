import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadProduction, loggerModel, makeReservationHarness, makeRule } from '../fixtures/reservation-rules/runtime';

interface RuleManager {
    add(rule: unknown): Promise<number>;
}

interface RuleOptionChecker {
    checkRuleOption(rule: unknown): boolean;
}

interface ExecutionManager {
    getExecution(priority: number, timeout?: number): Promise<number>;
    unLockExecution(id: number): void;
}

const RuleManageModel = loadProduction<new (...args: unknown[]) => RuleManager>(
    'model',
    'operator',
    'rule',
    'RuleManageModel.js',
);
const ReserveOptionChecker = loadProduction<new (configuration: unknown) => RuleOptionChecker>(
    'model',
    'operator',
    'ReserveOptionChecker.js',
);
const ExecutionManagementModel = loadProduction<
    new (logger: unknown, maxExecutionId?: number, reservationOwnerWatchdog?: boolean) => ExecutionManager
>('model', 'ExecutionManagementModel.js');

const checker = (): RuleOptionChecker =>
    new ReserveOptionChecker({ getConfig: () => ({ encode: [{ name: 'synthetic' }] }) });

const baseTimeRule = (searchOption: Record<string, unknown>) => ({
    isTimeSpecification: true,
    reserveOption: { allowEndLack: false, avoidDuplicate: false, enable: true },
    searchOption,
});

const makeRuleManager = (optionChecker: RuleOptionChecker) => {
    const repository = { insertOnce: vi.fn(async () => 901) };
    const event = { emitAdded: vi.fn() };
    const manager = new RuleManageModel(loggerModel, optionChecker, repository, event);

    return { event, manager, repository };
};

const drainMicrotasks = async (): Promise<void> => {
    for (let index = 0; index < 8; index++) await Promise.resolve();
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('reservation rule implementation inventory cases', () => {
    it('[IMP-INPUT-NULL] rejects a null Rule before persistence or an event', async () => {
        const { event, manager, repository } = makeRuleManager(checker());

        await expect(manager.add(null)).rejects.toBeInstanceOf(TypeError);

        expect(repository.insertOnce).not.toHaveBeenCalled();
        expect(event.emitAdded).not.toHaveBeenCalled();
    });

    it('[IMP-INPUT-EMPTY] accepts an empty time-rule keyword, channel list, and time list', () => {
        expect(
            checker().checkRuleOption(
                baseTimeRule({
                    channelIds: [],
                    keyword: '',
                    times: [],
                }),
            ),
        ).toBe(true);
    });

    it('[IMP-INPUT-ZERO] accepts zero weekday and start values for a time Rule', () => {
        expect(
            checker().checkRuleOption(
                baseTimeRule({
                    channelIds: [],
                    keyword: 'synthetic',
                    times: [{ range: 1, start: 0, week: 0 }],
                }),
            ),
        ).toBe(true);
    });

    it('[IMP-INPUT-ONE] accepts the positive duplicate-avoidance period boundary', () => {
        expect(
            checker().checkRuleOption(
                makeRule({
                    reserveOption: {
                        allowEndLack: false,
                        avoidDuplicate: true,
                        enable: true,
                        periodToAvoidDuplicate: 1,
                    },
                }),
            ),
        ).toBe(true);
    });

    it('[IMP-INPUT-BOUNDARY] distinguishes inclusive genre bounds from adjacent out-of-range values', () => {
        const rule = (genre: number) => makeRule({ searchOption: { genres: [{ genre }] } });
        const optionChecker = checker();

        expect(optionChecker.checkRuleOption(rule(0))).toBe(true);
        expect(optionChecker.checkRuleOption(rule(15))).toBe(true);
        expect(optionChecker.checkRuleOption(rule(-1))).toBe(false);
        expect(optionChecker.checkRuleOption(rule(16))).toBe(false);
    });

    it('[IMP-INPUT-INVALID-TYPE] rejects a non-array time list before persistence or an event', async () => {
        const { event, manager, repository } = makeRuleManager(checker());

        await expect(
            manager.add(baseTimeRule({ channelIds: [], keyword: 'synthetic', times: 1 })),
        ).rejects.toBeInstanceOf(TypeError);

        expect(repository.insertOnce).not.toHaveBeenCalled();
        expect(event.emitAdded).not.toHaveBeenCalled();
    });

    it('[IMP-M6-BATCH-RELEASE-EVENT] keeps Rule batches ordered and observes release/event settlement boundaries', async () => {
        vi.useFakeTimers();
        const batchHarness = makeReservationHarness({
            ruleDB: { findId: vi.fn(), getIds: vi.fn(async () => [3, 5]) },
        });
        const settlements: Array<{ reject(error: Error): void; resolve(): void }> = [];
        batchHarness.model.updateRule = vi.fn(
            () =>
                new Promise<void>((resolve, reject) => {
                    settlements.push({ reject, resolve });
                }),
        );

        const batch = batchHarness.model.updateAll();
        await drainMicrotasks();
        expect(batchHarness.model.updateRule).toHaveBeenCalledWith(3, false, false);
        settlements[0].reject(new Error('synthetic-item-failure'));
        await drainMicrotasks();
        await vi.advanceTimersByTimeAsync(10);
        expect(batchHarness.model.updateRule).toHaveBeenLastCalledWith(5, false, false);
        settlements[1].resolve();
        await vi.runAllTimersAsync();
        await expect(batch).resolves.toBeUndefined();

        const failedExecution = {
            getExecution: vi.fn(async () => 'failed-execution'),
            unLockExecution: vi.fn(),
        };
        const failed = makeReservationHarness({
            execution: failedExecution,
            reserveDB: {
                findRuleId: vi.fn(async () => []),
                findTimeRanges: vi.fn(async () => []),
                updateMany: vi.fn(async () => {
                    throw new Error('synthetic-update-failure');
                }),
            },
        });

        await expect(failed.model.updateRule(17)).rejects.toThrow('synthetic-update-failure');
        expect(failedExecution.unLockExecution).toHaveBeenCalledExactlyOnceWith('failed-execution');
        expect(failed.reserveEvent.emitUpdated).not.toHaveBeenCalled();

        const callLedger: string[] = [];
        let commitDatabase: (() => void) | undefined;
        const execution = new ExecutionManagementModel(loggerModel, 2, true);
        const lateSettlement = makeReservationHarness({
            execution,
            reserveDB: {
                findRuleId: vi.fn(async () => []),
                findTimeRanges: vi.fn(async () => []),
                updateMany: vi.fn(
                    () =>
                        new Promise<void>(resolve => {
                            callLedger.push('database:entered');
                            commitDatabase = () => {
                                callLedger.push('database:committed');
                                resolve();
                            };
                        }),
                ),
            },
            reserveEvent: {
                emitUpdated: vi.fn(() => {
                    callLedger.push('event:updated');
                }),
            },
        });
        const update = lateSettlement.model.updateRule(17);
        await drainMicrotasks();
        expect(callLedger).toEqual(['database:entered']);

        const watchdogDeadline = 600_000;
        const secondWaiter = execution.getExecution(1, watchdogDeadline + 1);
        const thirdWaiter = execution.getExecution(1, watchdogDeadline + 1);
        let secondWaiterSettled = false;
        let thirdWaiterSettled = false;
        void secondWaiter.then(id => {
            secondWaiterSettled = true;
            callLedger.push(`second-waiter:${id}`);
        });
        void thirdWaiter.then(id => {
            thirdWaiterSettled = true;
            callLedger.push(`third-waiter:${id}`);
        });

        await vi.advanceTimersByTimeAsync(watchdogDeadline - 1);
        await drainMicrotasks();
        expect(secondWaiterSettled).toBe(false);
        expect(thirdWaiterSettled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await drainMicrotasks();
        expect(secondWaiterSettled).toBe(false);
        expect(thirdWaiterSettled).toBe(false);

        if (commitDatabase === undefined) throw new Error('database commit callback was not registered');
        commitDatabase();
        await expect(update).resolves.toBeUndefined();
        expect(lateSettlement.reserveEvent.emitUpdated).toHaveBeenCalledExactlyOnceWith(expect.any(Object));
        expect(callLedger.indexOf('database:committed')).toBeLessThan(callLedger.indexOf('event:updated'));
        await expect(secondWaiter).resolves.toBe(2);
        await drainMicrotasks();
        expect(callLedger).toContain('second-waiter:2');

        execution.unLockExecution(1);
        await drainMicrotasks();
        expect(thirdWaiterSettled).toBe(false);
        expect(callLedger).not.toContain('third-waiter:1');
        execution.unLockExecution(2);
        await expect(thirdWaiter).resolves.toBe(1);
        execution.unLockExecution(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
