import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    createDialectPersistence,
    loadProduction,
    logger,
    makeProgram,
    makeReservationHarness,
    makeRule,
} from '../fixtures/reservation-rules/runtime';

type Coordinator = {
    getExecution(priority: number, timeout?: number): Promise<number>;
    unLockExecution(id: number): void;
};

type ReserveDiff = {
    insert?: Array<{ ruleId?: number }>;
};

const ExecutionManagementModel = loadProduction<
    new (
        logger: { getLogger(): { system: { error(message: string): void } } },
        maxExecutionId?: number,
        reservationOwnerWatchdog?: boolean,
    ) => Coordinator
>('model', 'ExecutionManagementModel.js');

const drainMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 32; i++) await Promise.resolve();
};

const deferred = <T>() => {
    let reject: (error: Error) => void;
    let resolve: (value: T) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject: reject!, resolve: resolve! };
};

const observeActualCoordinator = (
    loggerModel: { getLogger(): { system: { error(message: string): void } } } = {
        getLogger: () => ({ system: { error: vi.fn() } }),
    },
) => {
    const coordinator = new ExecutionManagementModel(loggerModel, undefined, true);
    const acquired: number[] = [];
    const originalGetExecution = coordinator.getExecution.bind(coordinator);
    vi.spyOn(coordinator, 'getExecution').mockImplementation(async (priority: number, timeout?: number) => {
        const id = await originalGetExecution(priority, timeout);
        acquired.push(id);
        return id;
    });
    const release = vi.spyOn(coordinator, 'unLockExecution');
    return { acquired, coordinator, release };
};

const activeCandidateId = (observation: ReturnType<typeof observeActualCoordinator>): number => {
    const id = observation.acquired.at(-1);
    expect(id).toEqual(expect.any(Number));
    expect(observation.release.mock.calls.map(([releasedId]) => releasedId)).not.toContain(id);
    return id!;
};

const runProgramCandidate = async () => {
    const harness = makeReservationHarness({
        programDB: { findRule: vi.fn(async () => [makeProgram({ id: 801 })]) },
        ruleDB: { findId: vi.fn(async () => makeRule({ id: 81 })), getIds: vi.fn(async () => [81]) },
    });
    await harness.model.updateRule(81);
    return harness;
};

const runTimeCandidate = async () => {
    const harness = makeReservationHarness({
        channelDB: {
            findId: vi.fn(async () => ({
                channel: 'synthetic-channel',
                channelType: 'GR',
                id: 101,
                name: 'Synthetic',
            })),
        },
        ruleDB: {
            findId: vi.fn(async () =>
                makeRule({
                    id: 82,
                    isTimeSpecification: true,
                    searchOption: {
                        channelIds: [101],
                        keyword: 'synthetic',
                        times: [{ range: 60, start: 0, week: 0x7f }],
                    },
                }),
            ),
            getIds: vi.fn(async () => [82]),
        },
    });
    await harness.model.updateRule(82);
    return harness;
};

const runSequentialBatch = async () => {
    vi.useFakeTimers();
    const harness = makeReservationHarness({ ruleDB: { findId: vi.fn(), getIds: vi.fn(async () => [3, 5]) } });
    const updateRule = vi.fn(async () => undefined);
    harness.model.updateRule = updateRule;
    const batch = harness.model.updateAll();
    await drainMicrotasks();
    await vi.runAllTimersAsync();
    await batch;
    return updateRule;
};

afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('candidate recalculation with the reservation execution owner', () => {
    it('[RR-6.1] recalculates a Rule through the candidate entrypoint', async () => {
        const harness = await runProgramCandidate();
        expect(harness.reserveDB.updateMany).toHaveBeenCalledOnce();
    });

    it('[RR-6.2] rereads the stored Rule before a full candidate batch', async () => {
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
            const acquired: number[] = [];
            const getExecution = coordinator.getExecution.bind(coordinator);
            vi.spyOn(coordinator, 'getExecution').mockImplementation(async (priority: number, timeout?: number) => {
                const id = await getExecution(priority, timeout);
                acquired.push(id);
                return id;
            });
            const release = vi.spyOn(coordinator, 'unLockExecution');
            const findId = fixture.ruleDB.findId.bind(fixture.ruleDB);
            const reread = vi
                .spyOn(fixture.ruleDB, 'findId')
                .mockImplementation((id: number, needCnt?: boolean) => findId(id, needCnt));
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
                programDB: { findRule: vi.fn(async () => [makeProgram({ id: 912 })]) },
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
            expect(acquired).toEqual([1, 2, 3]);
            expect(
                updateMany.mock.calls.some(([diff]) =>
                    (diff.delete as Array<{ id: number }>).some(reserve => reserve.id === disabledReserve.id),
                ),
            ).toBe(true);
            expect(release).toHaveBeenCalledTimes(3);
        } finally {
            await fixture.cleanup();
        }
    });

    it('[RR-6.3] turns matching Program search results into candidate updates', async () => {
        const harness = await runProgramCandidate();
        expect(harness.programDB.findRule).toHaveBeenCalledOnce();
    });

    it('[RR-6.4] turns expanded time ranges into candidate updates', async () => {
        const harness = await runTimeCandidate();
        expect(harness.reserveDB.updateMany).toHaveBeenCalledOnce();
    });

    it('[RR-6.5] hands Rule and candidate data to the reservation update path', async () => {
        const harness = await runProgramCandidate();
        expect(harness.reserveDB.updateMany.mock.calls[0][0].insert[0]).toMatchObject({ ruleId: 81 });
    });

    it('[RR-6.6] delegates the final candidate diff to reservation management', async () => {
        const harness = await runProgramCandidate();
        expect(harness.reserveEvent.emitUpdated).toHaveBeenCalledOnce();
    });

    it('[RR-6.7] continues sequential processing after an individual Rule failure', async () => {
        vi.useFakeTimers();
        const coordinator = observeActualCoordinator();
        const failure = new Error('synthetic-first-rule-failure');
        const ruleDB = {
            findId: vi.fn(async (id: number) => makeRule({ id })),
            getIds: vi.fn(async () => [61, 62]),
        };
        const programDB = {
            findRule: vi
                .fn()
                .mockRejectedValueOnce(failure)
                .mockResolvedValueOnce([makeProgram({ id: 962 })]),
        };
        const harness = makeReservationHarness({
            execution: coordinator.coordinator,
            programDB,
            ruleDB,
        });

        const batch = harness.model.updateAll();
        await drainMicrotasks();
        await vi.runAllTimersAsync();
        await expect(batch).resolves.toBeUndefined();

        expect(ruleDB.findId.mock.calls).toEqual([
            [61, true],
            [62, true],
        ]);
        expect(programDB.findRule).toHaveBeenCalledTimes(2);
        expect(coordinator.release).toHaveBeenCalledTimes(3);
        expect(coordinator.release.mock.invocationCallOrder[0]).toBeLessThan(ruleDB.findId.mock.invocationCallOrder[1]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RR-6.8] keeps repeated candidate recalculation calls distinct', async () => {
        const first = await runProgramCandidate();
        const second = await runProgramCandidate();
        expect(first.reserveDB.updateMany).toHaveBeenCalledOnce();
        expect(second.reserveDB.updateMany).toHaveBeenCalledOnce();
    });

    it('[RR-6.9] reads Rule IDs for each full candidate recalculation request', async () => {
        vi.useFakeTimers();
        const harness = makeReservationHarness({ ruleDB: { findId: vi.fn(), getIds: vi.fn(async () => []) } });
        await Promise.all([harness.model.updateAll(), harness.model.updateAll()]);
        expect(harness.ruleDB.getIds).toHaveBeenCalledTimes(2);
    });

    it('[RR-6.11] processes full-batch Rule IDs in ascending order without eager starts', async () => {
        const updateRule = await runSequentialBatch();
        expect(updateRule.mock.calls).toEqual([
            [3, false, false],
            [5, false, false],
        ]);
    });

    it('[RR-6.12] treats overlapping full candidate batches as independent requests', async () => {
        vi.useFakeTimers();
        const harness = makeReservationHarness({
            ruleDB: {
                findId: vi.fn(),
                getIds: vi.fn().mockResolvedValueOnce([1]).mockResolvedValueOnce([2]),
            },
        });
        const updateRule = vi.fn(async () => undefined);
        harness.model.updateRule = updateRule;

        const batches = Promise.all([harness.model.updateAll(), harness.model.updateAll()]);
        await vi.runAllTimersAsync();
        await batches;

        expect(updateRule.mock.calls.map(([id]) => id).sort()).toEqual([1, 2]);
    });

    it('[RR-6.10] holds the actual owner through time-Rule Channel reads until the candidate diff settles', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2030-01-07T00:00:00+09:00').getTime());
        const observation = observeActualCoordinator();
        const held: Array<[string, number]> = [];
        const observe = (stage: string) => held.push([stage, activeCandidateId(observation)]);
        const ruleDB = {
            findId: vi.fn(async () => {
                observe('rule');
                return makeRule({
                    id: 52,
                    isTimeSpecification: true,
                    searchOption: {
                        channelIds: [101],
                        keyword: 'synthetic time candidate',
                        times: [{ range: 60, start: 0, week: 0x7f }],
                    },
                });
            }),
            getIds: vi.fn(async () => []),
        };
        const channelDB = {
            findId: vi.fn(async () => {
                observe('channel');
                return { channel: 'synthetic-channel', channelType: 'GR', id: 101, name: 'Synthetic Channel' };
            }),
        };
        const harness = makeReservationHarness({ channelDB, execution: observation.coordinator, ruleDB });
        harness.reserveDB.findRuleId.mockImplementation(async () => {
            observe('related reservation');
            return [];
        });
        harness.reserveDB.findTimeRanges.mockImplementation(async () => {
            observe('candidate diff');
            return [];
        });

        await harness.model.updateRule(52);

        expect(held.map(([stage]) => stage)).toEqual(['rule', 'related reservation', 'channel', 'candidate diff']);
        expect(new Set(held.map(([, id]) => id))).toEqual(new Set([1]));
        expect(harness.reserveDB.updateMany).toHaveBeenCalledOnce();
        expect(harness.reserveEvent.emitUpdated).toHaveBeenCalledOnce();
        expect(observation.release).toHaveBeenCalledExactlyOnceWith(1);
    });

    it.each([
        ['Rule read rejection', 'rule'],
        ['missing time field synchronous exception', 'time'],
        ['Program/history read rejection', 'program'],
        ['Channel read rejection', 'channel'],
        ['candidate diff rejection', 'diff'],
        ['synchronous logger exception', 'sync'],
        ['empty Rule early candidate path', 'early'],
    ] as const)('releases exactly once and continues the batch after %s', async (_name, failure) => {
        vi.useFakeTimers();
        const observation = observeActualCoordinator();
        const firstFailure = new Error(`synthetic-${failure}-failure`);
        const readOwners: number[] = [];
        const normalRule = makeRule({ id: 62 });
        const timeRule = makeRule({
            id: 61,
            isTimeSpecification: true,
            searchOption: {
                channelIds: [101],
                keyword: 'synthetic time candidate',
                times: [{ range: 60, week: 1 }],
            },
        });
        const ruleDB = {
            findId: vi.fn(async (ruleId: number) => {
                readOwners.push(activeCandidateId(observation));
                if (ruleId === 61) {
                    if (failure === 'rule') throw firstFailure;
                    if (failure === 'time') {
                        return makeRule({
                            id: 61,
                            isTimeSpecification: true,
                            searchOption: {
                                channelIds: [101],
                                keyword: 'synthetic time candidate',
                                times: [{ range: 60, week: 1 }],
                            },
                        });
                    }
                    if (failure === 'early') return null;
                    if (failure === 'channel') return timeRule;
                }
                return normalRule;
            }),
            getIds: vi.fn(async () => [61, 62]),
        };
        const programDB = {
            findRule: vi.fn(async () => {
                if (failure === 'program') throw firstFailure;
                return [makeProgram({ id: 961 })];
            }),
        };
        const channelDB = {
            findId: vi.fn(async () => {
                if (failure === 'channel') throw firstFailure;
                return { channel: 'synthetic-channel', channelType: 'GR', id: 101, name: 'Synthetic Channel' };
            }),
        };
        const harness = makeReservationHarness({
            channelDB,
            execution: observation.coordinator,
            programDB,
            ruleDB,
        });
        (harness.reserveDB as typeof harness.reserveDB & { findLists: ReturnType<typeof vi.fn> }).findLists = vi.fn(
            async () => [],
        );
        if (failure === 'diff') harness.reserveDB.findTimeRanges.mockRejectedValueOnce(firstFailure);
        // `logger.system.info` is a plain `vi.fn()` from the shared fixture, not the original
        // production method, so `vi.spyOn` here just re-decorates the same mock function in place
        // and this file's `afterEach(() => vi.clearAllMocks())` only clears call history -- it does
        // not undo a `mockImplementation()` (that needs `mockReset`/`restoreAllMocks`). Without an
        // explicit restore, this synchronous-throw implementation stayed attached to
        // `logger.system.info` for every subsequent `it.each` case (here, the next case --
        // 'empty Rule early candidate path' -- inherited it and had its own "update rule
        // reservation: 61" log line throw this case's `firstFailure`, aborting that case's rule 61
        // update before `ruleDB.findId(61, true)` was ever reached).
        if (failure === 'sync') {
            vi.spyOn(logger.system, 'info').mockImplementation(message => {
                if (message === 'update rule reservation: 61') throw firstFailure;
            });
        }

        try {
            const batch = harness.model.updateAll();
            await drainMicrotasks();
            await vi.advanceTimersByTimeAsync(10);
            await drainMicrotasks();
            await vi.advanceTimersByTimeAsync(10);
            await drainMicrotasks();
            await expect(batch).resolves.toBeUndefined();
        } finally {
            if (failure === 'sync') {
                vi.mocked(logger.system.info).mockRestore();
            }
        }

        expect(ruleDB.findId.mock.calls).toEqual(
            failure === 'sync'
                ? [[62, true]]
                : [
                      [61, true],
                      [62, true],
                  ],
        );
        expect(observation.release).toHaveBeenCalledTimes(3);
        expect(observation.release.mock.calls.slice(0, 2).flat()).toEqual(expect.arrayContaining([1, 2]));
        expect(new Set(observation.release.mock.calls.slice(0, 2).flat())).toHaveLength(2);
        expect(observation.release.mock.invocationCallOrder[0]).toBeLessThan(
            ruleDB.findId.mock.invocationCallOrder.at(-1)!,
        );
        expect(readOwners.at(-1)).toBe(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RR-6.13] holds the overdue owner for 600 seconds and settles each late result once without restarting', async () => {
        for (const settlement of ['success', 'rejection'] as const) {
            vi.useFakeTimers();
            const overdueLog = vi.fn();
            const fatal = vi.fn();
            const observation = observeActualCoordinator({
                getLogger: () => ({ system: { error: overdueLog, fatal } }),
            });
            const firstProgram = deferred<Array<Record<string, unknown>>>();
            const candidateOwners: number[] = [];
            const ledger: string[] = [];
            const ruleDB = {
                findId: vi.fn(async (ruleId: number) => {
                    const id = activeCandidateId(observation);
                    candidateOwners.push(id);
                    ledger.push(`rule:${ruleId}:${id}`);
                    return makeRule({ id: ruleId });
                }),
                getIds: vi.fn(async () => [71, 72]),
            };
            const programDB = {
                findRule: vi
                    .fn()
                    .mockImplementationOnce(async () => {
                        ledger.push(`program:71:${activeCandidateId(observation)}`);
                        return firstProgram.promise;
                    })
                    .mockImplementationOnce(async () => {
                        ledger.push(`program:72:${activeCandidateId(observation)}`);
                        return [makeProgram({ id: 972 })];
                    }),
            };
            const harness = makeReservationHarness({ execution: observation.coordinator, programDB, ruleDB });
            (harness.reserveDB as typeof harness.reserveDB & { findLists: ReturnType<typeof vi.fn> }).findLists = vi.fn(
                async () => [],
            );
            harness.reserveDB.findRuleId.mockImplementation(async option => {
                ledger.push(`related:${option.ruleId}`);
                return [];
            });
            harness.reserveDB.findTimeRanges.mockImplementation(async option => {
                ledger.push(`diff:${option.excludeRuleId}`);
                return [];
            });
            harness.reserveDB.updateMany.mockImplementation(async (diff: ReserveDiff) => {
                ledger.push(`update:${diff.insert?.[0]?.ruleId ?? 'sweep'}`);
            });
            harness.reserveEvent.emitUpdated.mockImplementation((diff: ReserveDiff) => {
                ledger.push(`event:${diff.insert?.[0]?.ruleId ?? 'sweep'}`);
            });

            const batch = harness.model.updateAll();
            await drainMicrotasks();
            const ownerId = activeCandidateId(observation);
            expect(ledger).toEqual([`rule:71:${ownerId}`, 'related:71', `program:71:${ownerId}`]);
            const sameLane = observation.coordinator.getExecution(0, 600_020);
            let sameLaneSettled = false;
            void sameLane.then(() => {
                sameLaneSettled = true;
            });

            await vi.advanceTimersByTimeAsync(599_999);
            expect(overdueLog).not.toHaveBeenCalled();
            expect(observation.release).not.toHaveBeenCalled();
            expect(ruleDB.findId.mock.calls).toEqual([[71, true]]);
            expect(sameLaneSettled).toBe(false);

            await vi.advanceTimersByTimeAsync(1);
            expect(overdueLog).toHaveBeenCalledExactlyOnceWith(`reservation execution overdue: ${ownerId}`);
            expect(observation.release).not.toHaveBeenCalled();
            expect(ruleDB.findId.mock.calls).toEqual([[71, true]]);
            expect(sameLaneSettled).toBe(false);

            await vi.advanceTimersByTimeAsync(1);
            expect(overdueLog).toHaveBeenCalledOnce();
            expect(observation.release).not.toHaveBeenCalled();
            expect(ruleDB.findId.mock.calls).toEqual([[71, true]]);
            expect(sameLaneSettled).toBe(false);

            const generic = new ExecutionManagementModel({ getLogger: () => ({ system: { error: vi.fn() } }) });
            const genericRelease = vi.spyOn(generic, 'unLockExecution');
            const genericId = await generic.getExecution(0);
            const nonLaneQuery = vi.fn(async () => 'synthetic query result');
            await expect(nonLaneQuery()).resolves.toBe('synthetic query result');
            generic.unLockExecution(genericId);
            expect(genericRelease).toHaveBeenCalledExactlyOnceWith(genericId);
            expect(nonLaneQuery).toHaveBeenCalledOnce();
            expect(fatal).not.toHaveBeenCalled();

            if (settlement === 'success') firstProgram.resolve([makeProgram({ id: 971 })]);
            else firstProgram.reject(new Error('synthetic-late-program-rejection'));
            await drainMicrotasks();

            const sameLaneId = await sameLane;
            expect(sameLaneSettled).toBe(true);
            expect(observation.release).toHaveBeenCalledExactlyOnceWith(ownerId);
            observation.coordinator.unLockExecution(sameLaneId);
            await vi.advanceTimersByTimeAsync(10);
            await drainMicrotasks();
            await vi.advanceTimersByTimeAsync(10);
            await drainMicrotasks();
            await expect(batch).resolves.toBeUndefined();

            const firstDiffCount = ledger.filter(entry => entry === 'diff:71').length;
            const firstUpdateCount = ledger.filter(entry => entry === 'update:71').length;
            const firstEventCount = ledger.filter(entry => entry === 'event:71').length;
            expect(firstDiffCount).toBe(settlement === 'success' ? 1 : 0);
            expect(firstUpdateCount).toBe(settlement === 'success' ? 1 : 0);
            expect(firstEventCount).toBe(settlement === 'success' ? 1 : 0);
            expect(ledger.filter(entry => entry.startsWith('program:71:'))).toHaveLength(1);
            expect(ledger.filter(entry => entry.startsWith('rule:72:'))).toHaveLength(1);
            expect(ledger.filter(entry => entry.startsWith('program:72:'))).toHaveLength(1);
            expect(ledger.filter(entry => entry === 'diff:72')).toHaveLength(1);
            expect(ledger.filter(entry => entry === 'update:72')).toHaveLength(1);
            expect(ledger.filter(entry => entry === 'event:72')).toHaveLength(1);
            expect(new Set(candidateOwners)).toHaveLength(2);
            expect(candidateOwners[0]).toBe(ownerId);
            expect(observation.release.mock.calls.filter(([id]) => id === ownerId)).toHaveLength(1);
            expect(overdueLog).toHaveBeenCalledOnce();
            expect(fatal).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        }
    });
});
