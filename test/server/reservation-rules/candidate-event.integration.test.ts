import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';

import {
    createDialectPersistence,
    loadProduction,
    makeProgram,
    makeReservationHarness,
    makeRule,
} from '../fixtures/reservation-rules/runtime';
import { silentLoggerModel } from '../harness/silent-logger-model';

type Candidate = Record<string, unknown>;

type Coordinator = {
    getExecution(priority: number, timeout?: number): Promise<number>;
    unLockExecution(id: number): void;
};

type RuleQuery = {
    gets(option: { limit: number; offset: number; type: 'all' | 'normal' | 'conflict' | 'skip' | 'overlap' }): Promise<{
        rules: Array<{ id: number; reservesCnt?: number }>;
        total: number;
    }>;
};

type RuleCountProvider = {
    countRuleIds(
        ruleIds: number[],
        state: 'all' | 'normal' | 'conflict' | 'skip' | 'overlap',
    ): Promise<Array<{ ruleId: number; ruleIdCnt: number | string }>>;
};

type CreateDiffObserverTarget = {
    createDiff(...args: unknown[]): Promise<unknown>;
};

type ReserveEventAdapter = {
    setUpdated(callback: (diff: unknown) => void): void;
};

const ExecutionManagementModel = loadProduction<
    new (
        logger: { getLogger(): { system: { error(message: string): void } } },
        maxExecutionId?: number,
        reservationOwnerWatchdog?: boolean,
    ) => Coordinator
>('model', 'ExecutionManagementModel.js');

const RuleApiModel = loadProduction<new (...args: unknown[]) => RuleQuery>('model', 'api', 'rule', 'RuleApiModel.js');
const ReserveDB = loadProduction<new (...args: unknown[]) => RuleCountProvider>('model', 'db', 'ReserveDB.js');
const ReserveEvent = loadProduction<new (...args: unknown[]) => ReserveEventAdapter>(
    'model',
    'event',
    'ReserveEvent.js',
);

const deferred = <T>() => {
    let resolve: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve: resolve! };
};

const drainMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 32; i++) await Promise.resolve();
};

const observeCreateDiff = (model: unknown) => vi.spyOn(model as CreateDiffObserverTarget, 'createDiff');

const observeReservationTransaction = (source: DataSource, ledger: string[], rejectInsert: boolean = false) => {
    const createQueryRunner = source.createQueryRunner.bind(source);
    const observedRunners = new WeakSet<object>();
    const observedManagers = new WeakSet<object>();
    return vi.spyOn(source, 'createQueryRunner').mockImplementation(() => {
        const runner = createQueryRunner();
        const manager = runner.manager;
        if (rejectInsert && !observedManagers.has(manager)) {
            observedManagers.add(manager);
            vi.spyOn(manager, 'insert').mockRejectedValueOnce(new Error('synthetic candidate transaction failure'));
        }
        if (observedRunners.has(runner)) return runner;
        observedRunners.add(runner);
        let isReservationTransaction = false;
        const startTransaction = runner.startTransaction.bind(runner);
        vi.spyOn(runner, 'startTransaction').mockImplementation(async () => {
            isReservationTransaction = true;
            ledger.push('transaction:start');
            await startTransaction();
        });
        const commit = runner.commitTransaction.bind(runner);
        vi.spyOn(runner, 'commitTransaction').mockImplementation(async () => {
            await commit();
            if (isReservationTransaction) ledger.push('transaction:commit');
        });
        const rollback = runner.rollbackTransaction.bind(runner);
        vi.spyOn(runner, 'rollbackTransaction').mockImplementation(async () => {
            await rollback();
            if (isReservationTransaction) ledger.push('transaction:rollback');
        });
        const release = runner.release.bind(runner);
        vi.spyOn(runner, 'release').mockImplementation(async () => {
            await release();
            if (isReservationTransaction) ledger.push('transaction:release');
        });
        return runner;
    });
};

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('one-Rule authoritative candidate handoff integration', () => {
    it('[RR-6.2][RR-T7.1] rereads persisted Rules by ascending ID and hands disabled Rules an empty candidate array', async () => {
        const fixture = await createDialectPersistence('sqlite');
        try {
            await fixture.ruleDB.insertOnce(
                makeRule({ id: 47, reserveOption: { enable: false, allowEndLack: false, avoidDuplicate: false } }),
            );
            await fixture.ruleDB.insertOnce(
                makeRule({ id: 12, reserveOption: { enable: true, allowEndLack: false, avoidDuplicate: false } }),
            );
            const coordinator = new ExecutionManagementModel(
                { getLogger: () => ({ system: { error: vi.fn() } }) },
                undefined,
                true,
            );
            const ledger: string[] = [];
            const getExecution = coordinator.getExecution.bind(coordinator);
            vi.spyOn(coordinator, 'getExecution').mockImplementation(async (priority: number, timeout?: number) => {
                const id = await getExecution(priority, timeout);
                ledger.push(`acquire:${id}`);
                return id;
            });
            const findId = fixture.ruleDB.findId.bind(fixture.ruleDB);
            const reread = vi
                .spyOn(fixture.ruleDB, 'findId')
                .mockImplementation(async (id: number, needCnt?: boolean) => {
                    ledger.push(`read:${id}`);
                    return await findId(id, needCnt);
                });
            const getIds = vi.spyOn(fixture.ruleDB, 'getIds');
            const disabledReserve = {
                endAt: 1_900_000_060_000,
                id: 947,
                isConflict: false,
                isIgnoreOverlap: false,
                isOverlap: false,
                isSkip: false,
                programId: 947,
                programUpdateTime: 1,
                ruleId: 47,
                ruleUpdateCnt: 2,
                startAt: 1_900_000_000_000,
            };
            const updateMany = vi.fn(async () => undefined);
            const harness = makeReservationHarness({
                execution: coordinator,
                programDB: { findRule: vi.fn(async () => []) },
                reserveDB: {
                    findLists: vi.fn(async () => []),
                    findRuleId: vi.fn(async ({ ruleId }: { ruleId: number }) =>
                        ruleId === 47 ? [disabledReserve] : [],
                    ),
                    findTimeRanges: vi.fn(async () => []),
                    getManualIds: vi.fn(async () => []),
                    getRuleEventRelayIds: vi.fn(async () => []),
                    updateMany,
                },
                ruleDB: fixture.ruleDB,
            });

            await expect(harness.model.updateAll()).resolves.toBeUndefined();

            expect(getIds).toHaveBeenCalledOnce();
            expect(reread.mock.calls).toEqual([
                [12, true],
                [47, true],
            ]);
            expect(ledger.slice(0, 4)).toEqual(['acquire:1', 'read:12', 'acquire:2', 'read:47']);
            expect(
                updateMany.mock.calls.some(([diff]) =>
                    (diff.delete as Array<{ id: number }>).some(reserve => reserve.id === disabledReserve.id),
                ),
            ).toBe(true);
        } finally {
            vi.useRealTimers();
            await fixture.cleanup();
        }
    });

    it('[RR-5.2][RR-6.10][RR-6.11][RR-6.13][RR-T6.2][RR-T6.4] uses one actual coordinator owner through duplicate-aware Program handoff and successor release', async () => {
        const coordinator = new ExecutionManagementModel(
            { getLogger: () => ({ system: { error: vi.fn() } }) },
            undefined,
            true,
        );
        const acquired: number[] = [];
        const originalGetExecution = coordinator.getExecution.bind(coordinator);
        vi.spyOn(coordinator, 'getExecution').mockImplementation(async (priority: number, timeout?: number) => {
            const id = await originalGetExecution(priority, timeout);
            acquired.push(id);
            return id;
        });
        const release = vi.spyOn(coordinator, 'unLockExecution');
        const searchOption = { channelIds: [303], keyword: 'synthetic duplicate candidate', name: true };
        const reserveOption = {
            allowEndLack: false,
            avoidDuplicate: true,
            enable: true,
            periodToAvoidDuplicate: 14,
        };
        const programRead = deferred<Candidate[]>();
        const programDB = {
            findRule: vi.fn(async option => {
                expect(option).toEqual({ reserveOption, searchOption });
                return programRead.promise;
            }),
        };
        const harness = makeReservationHarness({
            execution: coordinator,
            programDB,
            ruleDB: { findId: vi.fn(async () => makeRule({ id: 51, reserveOption, searchOption })), getIds: vi.fn() },
        });

        const pending = harness.model.updateRule(51);
        await drainMicrotasks();
        const ownerId = acquired[0];
        expect(ownerId).toEqual(expect.any(Number));
        expect(programDB.findRule).toHaveBeenCalledExactlyOnceWith({ reserveOption, searchOption });
        expect(harness.reserveDB.findRuleId).toHaveBeenCalledExactlyOnceWith({
            hasConflict: true,
            hasEventRelay: false,
            hasOverlap: true,
            hasSkip: true,
            ruleId: 51,
        });
        expect(release).not.toHaveBeenCalled();

        const successor = coordinator.getExecution(0, 1_000);
        let successorSettled = false;
        void successor.then(() => {
            successorSettled = true;
        });
        await drainMicrotasks();
        expect(successorSettled).toBe(false);
        expect(acquired).toEqual([ownerId]);

        programRead.resolve([makeProgram({ id: 951 })]);
        await pending;

        expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledOnce();
        expect(harness.reserveDB.updateMany).toHaveBeenCalledOnce();
        expect(harness.reserveEvent.emitUpdated).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledExactlyOnceWith(ownerId);
        const successorId = await successor;
        expect(successorSettled).toBe(true);
        expect(successorId).not.toBe(ownerId);
        coordinator.unLockExecution(successorId);
    });

    it('[RR-5.3][RR-6.3][RR-6.5][RR-6.6][RR-T7.2] passes Program reserves to private createDiff in evaluator order', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2030-01-07T00:00:00+09:00').getTime());
        const rule = makeRule({
            id: 73,
            reserveOption: { enable: true, allowEndLack: true, avoidDuplicate: true, tags: [12] },
        });
        const harness = makeReservationHarness({
            programDB: { findRule: vi.fn(async () => [makeProgram({ id: 902 }), makeProgram({ id: 901, overlap: true })]) },
            ruleDB: { findId: vi.fn(async () => rule), getIds: vi.fn() },
        });
        const createDiff = observeCreateDiff(harness.model);

        await harness.model.updateRule(73);

        expect(createDiff).toHaveBeenCalledOnce();
        const candidates = createDiff.mock.calls[0][1] as Candidate[];
        expect(candidates.map(candidate => candidate.programId)).toEqual([902, 901]);
        expect(candidates[1]).toMatchObject({
            allowEndLack: true,
            isOverlap: true,
            isTimeSpecified: false,
            programId: 901,
            ruleId: 73,
            ruleUpdateCnt: 2,
            tags: JSON.stringify([12]),
            updateTime: new Date('2030-01-07T00:00:00+09:00').getTime(),
        });
        expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledOnce();
        expect(harness.reserveDB.updateMany).toHaveBeenCalledOnce();
        expect(harness.reserveEvent.emitUpdated).toHaveBeenCalledOnce();
    });

    it('[RR-6.3][RR-6.5][RR-6.6] passes an empty successful Program result to createDiff as the full replacement input', async () => {
        const harness = makeReservationHarness();
        const createDiff = observeCreateDiff(harness.model);

        await harness.model.updateRule(17);

        expect(createDiff).toHaveBeenCalledOnce();
        expect(createDiff.mock.calls[0][1]).toEqual([]);
        expect(harness.reserveDB.updateMany).toHaveBeenCalledOnce();
        expect(harness.reserveEvent.emitUpdated).toHaveBeenCalledOnce();
    });

    it('[RR-5.5][RR-6.3][RR-6.6] rejects a Program query failure without converting it to an empty createDiff input', async () => {
        const sentinel = new Error('synthetic-program-candidate-failure');
        const harness = makeReservationHarness({
            programDB: { findRule: vi.fn().mockRejectedValue(sentinel) },
        });
        const createDiff = observeCreateDiff(harness.model);

        await expect(harness.model.updateRule(17)).rejects.toBe(sentinel);

        expect(createDiff).not.toHaveBeenCalled();
        expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
        expect(harness.execution.unLockExecution).toHaveBeenCalledTimes(1);
    });

    it('[RR-5.5][RR-6.5][RR-6.6][RR-T7.2] propagates an actual createDiff failure after creating Program reserves', async () => {
        const failure = new Error('synthetic-create-diff-failure');
        const harness = makeReservationHarness({
            programDB: { findRule: vi.fn(async () => [makeProgram({ id: 981 })]) },
        });
        harness.reserveDB.findTimeRanges.mockRejectedValue(failure);
        const createDiff = observeCreateDiff(harness.model);

        await expect(harness.model.updateRule(17)).rejects.toBe(failure);

        expect(createDiff).toHaveBeenCalledOnce();
        expect((createDiff.mock.calls[0][1] as Candidate[]).map(candidate => candidate.programId)).toEqual([981]);
        expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
        expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith('synthetic-execution');
    });

    it('[RR-3.7][RR-6.4][RR-6.5][RR-6.6] passes only Channel A reserves to createDiff when B rejects and C is missing', async () => {
        const evaluatedAt = new Date('2030-01-07T00:00:00+09:00').getTime();
        vi.useFakeTimers();
        vi.setSystemTime(evaluatedAt);
        const channelFailure = new Error('synthetic-channel-B-failure');
        const channelDB = {
            findId: vi.fn(async (id: number) => {
                if (id === 101) {
                    return { id, channel: 'channel-A', channelType: 'GR', name: 'Channel A' };
                }
                if (id === 202) throw channelFailure;
                return null;
            }),
        };
        const harness = makeReservationHarness({
            channelDB,
            ruleDB: {
                findId: vi.fn(async () =>
                    makeRule({
                        isTimeSpecification: true,
                        searchOption: {
                            keyword: 'synthetic time candidate',
                            channelIds: [101, 202, 303],
                            times: [{ week: 0x7f, start: 0, range: 60 }],
                        },
                    }),
                ),
                getIds: vi.fn(),
            },
        });
        const createDiff = observeCreateDiff(harness.model);

        await harness.model.updateRule(17);

        expect(channelDB.findId.mock.calls).toEqual([[101], [202], [303]]);
        expect(createDiff).toHaveBeenCalledOnce();
        const candidates = createDiff.mock.calls[0][1] as Candidate[];
        expect(candidates.length).toBeGreaterThan(0);
        expect(candidates.every(candidate => candidate.channelId === 101)).toBe(true);
        expect(candidates).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    ruleId: 17,
                    programId: null,
                    isTimeSpecified: true,
                    channel: 'channel-A',
                    name: 'synthetic time candidate',
                    isOverlap: false,
                }),
            ]),
        );
        expect(candidates).not.toHaveProperty('isComplete');
        expect(candidates).not.toHaveProperty('completeness');
        expect(candidates.every(candidate => !('isComplete' in candidate))).toBe(true);
        expect(harness.programDB.findRule).not.toHaveBeenCalled();
        expect(harness.reserveDB.updateMany).toHaveBeenCalledOnce();
    });

    it('[RR-3.7][RR-6.4][RR-6.5][RR-6.6] passes an authoritative empty array to createDiff when every Channel is unavailable', async () => {
        const channelDB = {
            findId: vi.fn().mockRejectedValueOnce(new Error('synthetic-channel-reject')).mockResolvedValueOnce(null),
        };
        const harness = makeReservationHarness({
            channelDB,
            ruleDB: {
                findId: vi.fn(async () =>
                    makeRule({
                        isTimeSpecification: true,
                        searchOption: {
                            keyword: 'synthetic time candidate',
                            channelIds: [202, 303],
                            times: [{ week: 0x7f, start: 0, range: 60 }],
                        },
                    }),
                ),
                getIds: vi.fn(),
            },
        });
        const createDiff = observeCreateDiff(harness.model);

        await harness.model.updateRule(17);

        expect(channelDB.findId.mock.calls).toEqual([[202], [303]]);
        expect(createDiff).toHaveBeenCalledOnce();
        const candidates = createDiff.mock.calls[0][1] as Candidate[];
        expect(candidates).toEqual([]);
        expect(candidates).not.toHaveProperty('isComplete');
        expect(candidates).not.toHaveProperty('completeness');
        expect(harness.reserveDB.updateMany).toHaveBeenCalledOnce();
    });
});

describe('Rule count and same-coordinator handoff integration', () => {
    it('[RR-1.6][RR-T7.2] uses ReserveDB through the real RuleReservationCountPort and zero-fills only missing page IDs', async () => {
        const rules = [{ id: 73 }, { id: 29 }];
        const findAll = vi.fn(async () => [rules, 9]);
        const provider = new ReserveDB(silentLoggerModel, {}, {});
        const countRuleIds = vi.fn(async () => [{ ruleId: 73, ruleIdCnt: '4' }]);
        provider.countRuleIds = countRuleIds;
        const query = new RuleApiModel({ rule: {} }, { findAll }, provider);

        const result = await query.gets({ limit: 2, offset: 4, type: 'overlap' });

        expect(findAll).toHaveBeenCalledExactlyOnceWith({ limit: 2, offset: 4, type: 'overlap' });
        expect(countRuleIds).toHaveBeenCalledExactlyOnceWith([73, 29], 'overlap');
        expect(result).toEqual({
            rules: [
                { id: 73, reservesCnt: 4 },
                { id: 29, reservesCnt: 0 },
            ],
            total: 9,
        });
    });

    it('[RR-1.6][RR-T7.2] propagates a real ReserveDB count failure through the Rule query', async () => {
        const failure = new Error('synthetic-rule-count-failure');
        const provider = new ReserveDB(silentLoggerModel, {}, {});
        const countRuleIds = vi.fn(async () => Promise.reject(failure));
        provider.countRuleIds = countRuleIds;
        const query = new RuleApiModel({ rule: {} }, { findAll: vi.fn(async () => [[{ id: 81 }], 1]) }, provider);

        await expect(query.gets({ limit: 1, offset: 0, type: 'skip' })).rejects.toBe(failure);

        expect(countRuleIds).toHaveBeenCalledExactlyOnceWith([81], 'skip');
    });
});

describe('candidate handoff transaction and event integration', () => {
    it('[RR-8.3][RR-8.4][RR-T8.7] commits the actual candidate transaction before one event on the same coordinator', async () => {
        const fixture = await createDialectPersistence('sqlite');
        const ledger: string[] = [];
        const coordinator = new ExecutionManagementModel(
            { getLogger: () => ({ system: { error: vi.fn() } }) },
            undefined,
            true,
        );
        const getExecution = coordinator.getExecution.bind(coordinator);
        vi.spyOn(coordinator, 'getExecution').mockImplementation(async (priority: number, timeout?: number) => {
            const id = await getExecution(priority, timeout);
            ledger.push(`lock:${id}`);
            return id;
        });
        const unLockExecution = coordinator.unLockExecution.bind(coordinator);
        vi.spyOn(coordinator, 'unLockExecution').mockImplementation((id: number) => {
            ledger.push(`unlock:${id}`);
            unLockExecution(id);
        });
        const reserveEvent = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
        const consumer = vi.fn((diff: unknown) => {
            ledger.push('event');
            return diff;
        });
        reserveEvent.setUpdated(consumer);
        const queryRunnerSpy = observeReservationTransaction(fixture.source, ledger);
        const ruleId = 87;
        const candidate = makeProgram({ id: 8_701, programId: undefined });

        try {
            await fixture.ruleDB.insertOnce(makeRule({ id: ruleId }));
            const harness = makeReservationHarness({
                execution: coordinator,
                programDB: { findRule: vi.fn(async () => [candidate]) },
                reserveDB: fixture.reserveDB,
                reserveEvent,
                ruleDB: fixture.ruleDB,
            });
            const createDiff = observeCreateDiff(harness.model);

            await harness.model.updateRule(ruleId);

            expect(createDiff).toHaveBeenCalledOnce();
            expect((createDiff.mock.calls[0][1] as Candidate[]).map(reserve => reserve.programId)).toEqual([8_701]);
            expect(ledger).toEqual([
                'lock:1',
                'transaction:start',
                'transaction:commit',
                'transaction:release',
                'unlock:1',
                'event',
            ]);
            expect(consumer).toHaveBeenCalledOnce();
            await expect(
                fixture.reserveDB.findRuleId({
                    hasConflict: true,
                    hasEventRelay: false,
                    hasOverlap: true,
                    hasSkip: true,
                    ruleId,
                }),
            ).resolves.toEqual([expect.objectContaining({ programId: 8_701, ruleId })]);

            const successor = await coordinator.getExecution(0, 1);
            coordinator.unLockExecution(successor);
        } finally {
            queryRunnerSpy.mockRestore();
            await fixture.cleanup();
        }
    });

    it('[RR-8.3][RR-8.4][RR-T8.7] rolls the actual candidate transaction back without an event and releases its owner', async () => {
        const fixture = await createDialectPersistence('sqlite');
        const ruleId = 88;
        await fixture.ruleDB.insertOnce(makeRule({ id: ruleId }));
        const coordinator = new ExecutionManagementModel(
            { getLogger: () => ({ system: { error: vi.fn() } }) },
            undefined,
            true,
        );
        const unLockExecution = vi.spyOn(coordinator, 'unLockExecution');
        const reserveEvent = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
        const consumer = vi.fn();
        reserveEvent.setUpdated(consumer);
        const transactionLedger: string[] = [];
        const queryRunnerSpy = observeReservationTransaction(fixture.source, transactionLedger, true);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            const harness = makeReservationHarness({
                execution: coordinator,
                programDB: { findRule: vi.fn(async () => [makeProgram({ id: 8_801, programId: undefined })]) },
                reserveDB: fixture.reserveDB,
                reserveEvent,
                ruleDB: fixture.ruleDB,
            });
            const createDiff = observeCreateDiff(harness.model);

            await expect(harness.model.updateRule(ruleId)).rejects.toThrow('ReserveUpdateManyError');

            expect(createDiff).toHaveBeenCalledOnce();
            expect(transactionLedger).toEqual(['transaction:start', 'transaction:rollback', 'transaction:release']);
            expect(consumer).not.toHaveBeenCalled();
            await expect(
                fixture.reserveDB.findRuleId({
                    hasConflict: true,
                    hasEventRelay: false,
                    hasOverlap: true,
                    hasSkip: true,
                    ruleId,
                }),
            ).resolves.toEqual([]);
            expect(unLockExecution).toHaveBeenCalledExactlyOnceWith(1);

            const successor = await coordinator.getExecution(0, 1);
            coordinator.unLockExecution(successor);
        } finally {
            error.mockRestore();
            queryRunnerSpy.mockRestore();
            await fixture.cleanup();
        }
    });

    it('[RR-8.3][RR-8.4][RR-T8.7] retains the overdue candidate owner until one late transaction settlement releases all resources', async () => {
        const fixture = await createDialectPersistence('sqlite');
        const ruleId = 89;
        await fixture.ruleDB.insertOnce(makeRule({ id: ruleId }));
        vi.useFakeTimers();
        const ledger: string[] = [];
        const overdueLog = vi.fn();
        const coordinator = new ExecutionManagementModel(
            { getLogger: () => ({ system: { error: overdueLog } }) },
            undefined,
            true,
        );
        const getExecution = coordinator.getExecution.bind(coordinator);
        vi.spyOn(coordinator, 'getExecution').mockImplementation(async (priority: number, timeout?: number) => {
            const id = await getExecution(priority, timeout);
            ledger.push(`lock:${id}`);
            return id;
        });
        const unLockExecution = coordinator.unLockExecution.bind(coordinator);
        vi.spyOn(coordinator, 'unLockExecution').mockImplementation((id: number) => {
            ledger.push(`unlock:${id}`);
            unLockExecution(id);
        });
        const reserveEvent = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
        const consumer = vi.fn((diff: unknown) => {
            ledger.push('event');
            return diff;
        });
        reserveEvent.setUpdated(consumer);
        const transactionLedger: string[] = [];
        const queryRunnerSpy = observeReservationTransaction(fixture.source, transactionLedger);
        const actualFindTimeRanges = fixture.reserveDB.findTimeRanges.bind(fixture.reserveDB);
        const readEntered = deferred<void>();
        const settleRead = deferred<void>();
        const findTimeRanges = vi.spyOn(fixture.reserveDB, 'findTimeRanges').mockImplementation(async option => {
            readEntered.resolve();
            await settleRead.promise;
            return await actualFindTimeRanges(option);
        });

        try {
            const harness = makeReservationHarness({
                execution: coordinator,
                programDB: { findRule: vi.fn(async () => [makeProgram({ id: 8_901, programId: undefined })]) },
                reserveDB: fixture.reserveDB,
                reserveEvent,
                ruleDB: fixture.ruleDB,
            });
            const createDiff = observeCreateDiff(harness.model);
            const pendingUpdate = harness.model.updateRule(ruleId);
            await readEntered.promise;
            const successor = coordinator.getExecution(0, 600_002);
            const successorGranted = vi.fn();
            void successor.then(successorGranted);

            await vi.advanceTimersByTimeAsync(600_000);

            expect(overdueLog).toHaveBeenCalledExactlyOnceWith('reservation execution overdue: 1');
            expect(successorGranted).not.toHaveBeenCalled();
            expect(transactionLedger).toEqual([]);
            expect(consumer).not.toHaveBeenCalled();

            settleRead.resolve();
            await pendingUpdate;

            expect(createDiff).toHaveBeenCalledOnce();
            expect(findTimeRanges).toHaveBeenCalledOnce();
            expect(transactionLedger).toEqual(['transaction:start', 'transaction:commit', 'transaction:release']);
            expect(ledger.slice(0, 3)).toEqual(['lock:1', 'unlock:1', 'event']);
            expect(consumer).toHaveBeenCalledOnce();
            const successorId = await successor;
            expect(successorGranted).toHaveBeenCalledExactlyOnceWith(successorId);
            coordinator.unLockExecution(successorId);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
            findTimeRanges.mockRestore();
            queryRunnerSpy.mockRestore();
            await fixture.cleanup();
        }
    });
});
