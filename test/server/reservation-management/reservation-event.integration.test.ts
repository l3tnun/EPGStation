import { describe, expect, it, vi } from 'vitest';
import { type DataSource } from 'typeorm';
import { createPersistence, EventSetter, load, makeModel, makeReserve, Reserve, ReserveEvent } from './_harness';
import { makeScheduleHarness } from '../recording-execution/_harness';

type Coordinator = {
    getExecution(priority: number, timeout?: number): Promise<number>;
    unLockExecution(id: number): void;
};

const ExecutionManagementModel = load<
    new (
        logger: { getLogger(): { system: { error: (message: string) => void } } },
        maxExecutionId?: number,
        reservationOwnerWatchdog?: boolean,
    ) => Coordinator
>('model', 'ExecutionManagementModel.js');

const makeCoordinator = (): Coordinator =>
    new ExecutionManagementModel(
        {
            getLogger: () => ({ system: { error: vi.fn() } }),
        },
        undefined,
        true,
    );

const makeRuleCoordinator = (ledger: string[], overdueLog: ReturnType<typeof vi.fn> = vi.fn()) => {
    const coordinator = new ExecutionManagementModel(
        {
            getLogger: () => ({ system: { error: overdueLog } }),
        },
        undefined,
        true,
    );
    const getExecution = coordinator.getExecution.bind(coordinator);
    const unlock = vi.spyOn(coordinator, 'unLockExecution');
    return {
        coordinator,
        execution: {
            getExecution: async (priority: number, timeout?: number) => {
                const id = await getExecution(priority, timeout);
                ledger.push(`lock:${id}`);
                return id;
            },
            unLockExecution: (id: number) => {
                ledger.push(`unlock:${id}`);
                coordinator.unLockExecution(id);
            },
        },
        overdueLog,
        unlock,
    };
};

const observeReservationTransaction = (source: DataSource, ledger: string[], rejectInsert: boolean = false) => {
    const createQueryRunner = source.createQueryRunner.bind(source);
    const observedRunners = new WeakSet<object>();
    const observedManagers = new WeakSet<object>();
    return vi.spyOn(source, 'createQueryRunner').mockImplementation(() => {
        const runner = createQueryRunner();
        const manager = runner.manager;
        if (rejectInsert && !observedManagers.has(manager)) {
            observedManagers.add(manager);
            vi.spyOn(manager, 'insert').mockRejectedValueOnce(new Error('synthetic rule transaction failure'));
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

const makeProcessHandoff = (ledger: string[]) => {
    const logger = { system: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() } };
    const event = new ReserveEvent({ getLogger: () => logger });
    const port = new Proxy({}, { get: () => vi.fn() });
    const ipc = { notifyClient: vi.fn(() => ledger.push('process:ipc')), setEncode: vi.fn() };
    const recordingManage = { acceptMutation: vi.fn((diff: unknown) => (ledger.push('recording:accept'), diff)) };
    const externalCommandManage = { addUpdateReseves: vi.fn(() => ledger.push('process:hook')) };
    const setter = new EventSetter(
        { getLogger: () => logger },
        port,
        port,
        port,
        event,
        port,
        port,
        port,
        port,
        port,
        recordingManage,
        port,
        port,
        port,
        externalCommandManage,
        ipc,
        { getConfig: () => ({ recorded: [{ name: 'synthetic-root' }] }) },
        { setup: vi.fn() },
    );
    setter.set();
    return { event, externalCommandManage, ipc, logger, recordingManage };
};

const makeRuleCandidate = (id: number) => Object.assign(makeReserve({ id, programId: id }), { overlap: false });

const makeEnabledProgramRule = (id: number) => ({
    id,
    isTimeSpecification: false,
    reserveOption: { allowEndLack: false, avoidDuplicate: false, enable: true },
    searchOption: { keyword: 'synthetic rule candidate' },
    updateCnt: 3,
});

const makeObservedCoordinator = (ledger: string[]): Coordinator => {
    const coordinator = makeCoordinator();
    return {
        getExecution: coordinator.getExecution.bind(coordinator),
        unLockExecution: id => {
            ledger.push('unlock');
            coordinator.unLockExecution(id);
        },
    };
};

const deferred = <T>() => {
    let resolve: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve: resolve! };
};

const deferredFailure = () => {
    let reject: (error: Error) => void;
    const promise = new Promise<never>((_, fail) => {
        reject = fail;
    });
    return { promise, reject: reject! };
};

const actualEvent = (ledger: string[]) => {
    const log = { system: { error: vi.fn() } };
    const event = new ReserveEvent({ getLogger: () => log });
    const consumer = vi.fn(async (diff: unknown) => {
        ledger.push('consumer');
        return diff;
    });
    event.setUpdated(consumer);
    return { consumer, event, log };
};

const flushEvent = async (): Promise<void> => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

describe('reservation diff through the actual event adapter', () => {
    it('[RM-T16] retains a committed mutation when a registered callback throws synchronously', async () => {
        const callbackFailure = new Error('synthetic synchronous event failure');
        const eventLog = { system: { error: vi.fn() } };
        const event = new ReserveEvent({ getLogger: () => eventLog });
        const callback = vi.fn(() => {
            throw callbackFailure;
        });
        event.setUpdated(callback);
        const ledger: string[] = [];
        const harness = makeModel({ ledger, reserveEvent: event });

        await expect(harness.model.updateRule(8, true, false)).resolves.toBeUndefined();

        expect(ledger).toEqual(['lock', 'commit', 'unlock']);
        expect(harness.reserveDB.updateMany).toHaveBeenCalledOnce();
        expect(callback).toHaveBeenCalledOnce();
        await flushEvent();
        expect(eventLog.system.error).toHaveBeenCalledExactlyOnceWith(callbackFailure);
        expect(harness.reserveDB.updateMany).toHaveBeenCalledOnce();
        expect(callback).toHaveBeenCalledOnce();
    });

    it('[RM-T16] retains a committed mutation when a registered callback returns a rejected Promise', async () => {
        const callbackFailure = new Error('synthetic asynchronous event failure');
        const eventLog = { system: { error: vi.fn() } };
        const event = new ReserveEvent({ getLogger: () => eventLog });
        const callback = vi.fn(() => Promise.reject(callbackFailure));
        event.setUpdated(callback);
        const ledger: string[] = [];
        const harness = makeModel({ ledger, reserveEvent: event });

        await expect(harness.model.updateRule(8, true, false)).resolves.toBeUndefined();

        expect(ledger).toEqual(['lock', 'commit', 'unlock']);
        expect(harness.reserveDB.updateMany).toHaveBeenCalledOnce();
        expect(callback).toHaveBeenCalledOnce();
        await flushEvent();
        expect(eventLog.system.error).toHaveBeenCalledExactlyOnceWith(callbackFailure);
        expect(harness.reserveDB.updateMany).toHaveBeenCalledOnce();
        expect(callback).toHaveBeenCalledOnce();
    });

    it('[RM-T16] accepts a recording candidate synchronously and records its late evaluation failure at the recording boundary', async () => {
        const recordingFailure = new Error('synthetic recording evaluation failure');
        const recordingLog = vi.fn();
        const schedule = makeScheduleHarness({
            dispatchMutation: vi.fn(() => Promise.reject(recordingFailure)),
            reportDispatchError: recordingLog,
        });
        await schedule.controller.start();
        const eventLog = { system: { error: vi.fn() } };
        const event = new ReserveEvent({ getLogger: () => eventLog });
        const acceptMutation = vi.spyOn(schedule.controller, 'acceptMutation');
        event.setUpdated(diff => schedule.controller.acceptMutation(diff));
        const ledger: string[] = [];
        const program = makeReserve({ id: 202, programId: 202 });
        const harness = makeModel({
            ledger,
            programDB: { findId: vi.fn(async () => program), findRule: vi.fn() },
            reserveEvent: event,
        });
        harness.model.setTuners([{ types: ['GR'] }]);

        await expect(harness.model.addEventRelay(202, makeReserve())).resolves.toBe(41);

        expect(ledger).toEqual(['lock', 'commit', 'unlock']);
        expect(acceptMutation).toHaveBeenCalledOnce();
        expect(eventLog.system.error).not.toHaveBeenCalled();

        schedule.fakeScheduler.flushMicrotasks();
        await flushEvent();

        expect(recordingLog).toHaveBeenCalledExactlyOnceWith(
            recordingFailure,
            expect.objectContaining({ action: 'insert', reservationId: 41 }),
        );
        expect(eventLog.system.error).not.toHaveBeenCalled();
        expect(harness.reserveDB.insertOnce).toHaveBeenCalledOnce();
    });

    it('[RM-8.11/RM-8.17] grants an actual coordinator successor after an updateRule read rejects', async () => {
        const execution = makeCoordinator();
        const harness = makeModel({
            execution,
            ruleDB: { findId: vi.fn(async () => Promise.reject(new Error('synthetic rule read failure'))) },
        });

        await expect(harness.model.updateRule(8)).rejects.toThrow('synthetic rule read failure');

        const successorId = await execution.getExecution(0, 1);
        execution.unLockExecution(successorId);
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
    });

    it('[RM-8.11/RM-8.12/RM-8.17][RM-T7.5] continues an actual rule batch with the later rule after the first rule read fails', async () => {
        vi.useFakeTimers();
        const execution = makeCoordinator();
        const unlock = vi.spyOn(execution, 'unLockExecution');
        const firstFailure = new Error('synthetic first rule read failure');
        const harness = makeModel({ execution });
        harness.ruleDB.getIds.mockResolvedValue([8, 9]);
        harness.ruleDB.findId.mockRejectedValueOnce(firstFailure).mockResolvedValueOnce(null);

        const pending = harness.model.updateAll(false);
        await vi.runAllTimersAsync();
        await pending;

        expect(harness.ruleDB.findId.mock.calls).toEqual([
            [8, true],
            [9, true],
        ]);
        expect(harness.reserveDB.findRuleId).toHaveBeenCalledOnce();
        expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledOnce();
        expect(unlock).toHaveBeenCalledTimes(3);
        expect(harness.reserveEvent.emitUpdated).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RM-8.5/RM-8.17/RM-8.18][RM-T7.5] retains the overdue rule owner until its late update commits, unlocks, and emits while another domain continues', async () => {
        vi.useFakeTimers();
        const ledger: string[] = [];
        const overdueLog = vi.fn();
        const coordinator = new ExecutionManagementModel(
            {
                getLogger: () => ({ system: { error: overdueLog } }),
            },
            undefined,
            true,
        );
        const execution = {
            getExecution: async (priority: number, timeout?: number) => {
                ledger.push('lock');
                return await coordinator.getExecution(priority, timeout);
            },
            unLockExecution: (id: number) => {
                ledger.push('unlock');
                coordinator.unLockExecution(id);
            },
        };
        const adapter = actualEvent(ledger);
        const diffReadEntered = deferred<void>();
        const diffRead = deferred<ReturnType<typeof makeReserve>[]>();
        const harness = makeModel({ execution, ledger, reserveEvent: adapter.event });
        harness.reserveDB.findTimeRanges.mockImplementation(async () => {
            diffReadEntered.resolve();
            return await diffRead.promise;
        });

        try {
            const pendingUpdate = harness.model.updateRule(8);
            await diffReadEntered.promise;
            expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledOnce();
            expect(ledger).toEqual(['lock']);

            const queuedSameCoordinator = coordinator.getExecution(0, 600_002);
            const sameCoordinatorGranted = vi.fn();
            void queuedSameCoordinator.then(sameCoordinatorGranted);

            const otherDomain = new ExecutionManagementModel(
                {
                    getLogger: () => ({ system: { error: vi.fn() } }),
                },
                undefined,
                false,
            );
            const otherDomainId = await otherDomain.getExecution(0, 1);
            otherDomain.unLockExecution(otherDomainId);

            await vi.advanceTimersByTimeAsync(600_000);
            expect(overdueLog).toHaveBeenCalledWith('reservation execution overdue: 1');
            expect(sameCoordinatorGranted).not.toHaveBeenCalled();
            expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
            expect(adapter.consumer).not.toHaveBeenCalled();

            diffRead.resolve([]);
            await pendingUpdate;

            expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledOnce();
            expect(harness.reserveDB.updateMany).toHaveBeenCalledOnce();
            expect(ledger).toEqual(['lock', 'commit', 'unlock', 'consumer']);
            expect(adapter.consumer).toHaveBeenCalledOnce();

            const successorId = await queuedSameCoordinator;
            expect(sameCoordinatorGranted).toHaveBeenCalledWith(successorId);
            coordinator.unLockExecution(successorId);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('[RM-8.18] holds a relay lane after the owner watchdog until the original operation releases it', async () => {
        vi.useFakeTimers();
        const ledger: string[] = [];
        const adapter = actualEvent(ledger);
        const overdueLog = vi.fn();
        const execution = new ExecutionManagementModel(
            {
                getLogger: () => ({ system: { error: overdueLog } }),
            },
            undefined,
            true,
        );
        const firstProgram = deferred<ReturnType<typeof makeReserve>>();
        const harness = makeModel({
            execution,
            ledger,
            programDB: { findId: vi.fn(() => firstProgram.promise), findRule: vi.fn() },
            reserveEvent: adapter.event,
        });
        harness.model.setTuners([{ types: ['GR'] }]);

        try {
            const first = harness.model.addEventRelay(202, makeReserve());
            await Promise.resolve();
            await Promise.resolve();
            expect(harness.programDB.findId).toHaveBeenCalledWith(202);

            const successor = execution.getExecution(0, 600_002);
            const successorGranted = vi.fn();
            void successor.then(successorGranted);
            await vi.advanceTimersByTimeAsync(600_000);

            expect(overdueLog).toHaveBeenCalledOnce();
            expect(successorGranted).not.toHaveBeenCalled();
            expect(adapter.consumer).not.toHaveBeenCalled();

            firstProgram.resolve(makeReserve({ id: 202, programId: 202 }));
            await first;
            expect(ledger).toEqual(['commit', 'consumer']);
            expect(adapter.consumer).toHaveBeenCalledOnce();

            const successorId = await successor;
            expect(successorGranted).toHaveBeenCalledWith(successorId);
            execution.unLockExecution(successorId);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('[RM-8.18] releases an overdue rejected relay once without rerunning its database work or event', async () => {
        vi.useFakeTimers();
        const ledger: string[] = [];
        const adapter = actualEvent(ledger);
        const overdueLog = vi.fn();
        const execution = new ExecutionManagementModel(
            {
                getLogger: () => ({ system: { error: overdueLog } }),
            },
            undefined,
            true,
        );
        const unlock = vi.spyOn(execution, 'unLockExecution');
        const lateFailure = deferredFailure();
        const harness = makeModel({
            execution,
            ledger,
            programDB: { findId: vi.fn(() => lateFailure.promise), findRule: vi.fn() },
            reserveEvent: adapter.event,
        });
        harness.model.setTuners([{ types: ['GR'] }]);

        try {
            const rejectedRelay = harness.model.addEventRelay(202, makeReserve());
            await Promise.resolve();
            await Promise.resolve();
            expect(harness.programDB.findId).toHaveBeenCalledWith(202);

            const firstSuccessor = execution.getExecution(0, 600_002);
            const secondSuccessor = execution.getExecution(0, 600_002);
            const secondGranted = vi.fn();
            void secondSuccessor.then(secondGranted);
            await vi.advanceTimersByTimeAsync(600_000);
            expect(overdueLog).toHaveBeenCalledWith('reservation execution overdue: 1');

            lateFailure.reject(new Error('synthetic late rejection'));
            await expect(rejectedRelay).rejects.toThrow('synthetic late rejection');
            expect(harness.programDB.findId).toHaveBeenCalledTimes(1);
            expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
            expect(adapter.consumer).not.toHaveBeenCalled();
            expect(unlock.mock.calls).toEqual([[1]]);

            const firstSuccessorId = await firstSuccessor;
            await Promise.resolve();
            expect(secondGranted).not.toHaveBeenCalled();

            execution.unLockExecution(firstSuccessorId);
            const secondSuccessorId = await secondSuccessor;
            expect(secondGranted).toHaveBeenCalledWith(secondSuccessorId);
            execution.unLockExecution(secondSuccessorId);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('[RM-4.1/RM-8.5] delivers one relay insert to a real registered consumer after commit and unlock', async () => {
        const ledger: string[] = [];
        const adapter = actualEvent(ledger);
        const program = makeReserve({ id: 202, programId: 202 });
        const execution = makeObservedCoordinator(ledger);
        const harness = makeModel({
            execution,
            ledger,
            programDB: { findId: vi.fn(async () => program), findRule: vi.fn() },
            reserveEvent: adapter.event,
        });
        harness.model.setTuners([{ types: ['GR'] }]);
        await harness.model.addEventRelay(202, makeReserve());
        expect(harness.ledger).toEqual(['commit', 'unlock', 'consumer']);
        expect(adapter.consumer).toHaveBeenCalledOnce();
        expect(adapter.consumer.mock.calls[0][0]).toMatchObject({ insert: [{ id: 41, programId: 202 }] });

        const followUpId = await execution.getExecution(0, 1);
        execution.unLockExecution(followUpId);
    });

    it('[RM-4.1/RM-6.1/RM-6.7][RM-T8.3] retains startup tuner ability after caller mutates its input and delivers the relay diff', async () => {
        const ledger: string[] = [];
        const adapter = actualEvent(ledger);
        const execution = makeObservedCoordinator(ledger);
        const program = makeReserve({ id: 203, programId: 203, channelType: 'GR' });
        const harness = makeModel({
            execution,
            ledger,
            programDB: { findId: vi.fn(async () => program), findRule: vi.fn() },
            reserveEvent: adapter.event,
        });
        const types = ['GR'];

        expect(harness.model.setTuners([{ types }])).toBeUndefined();
        types.splice(0, types.length);
        await Promise.resolve();
        expect(harness.reserveDB.findLists).not.toHaveBeenCalled();
        expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
        expect(adapter.consumer).not.toHaveBeenCalled();

        await expect(harness.model.addEventRelay(program.programId, makeReserve())).resolves.toBe(41);

        expect(harness.reserveDB.insertOnce).toHaveBeenCalledOnce();
        expect(ledger).toEqual(['commit', 'unlock', 'consumer']);
        expect(adapter.consumer).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ insert: [expect.objectContaining({ id: 41, programId: program.programId })] }),
        );

        const followUpId = await execution.getExecution(0, 1);
        execution.unLockExecution(followUpId);
    });

    it('[RM-4.5/RM-6.7/RM-8.17] rejects a conflicting relay without a commit or event and releases the actual coordinator', async () => {
        const ledger: string[] = [];
        const adapter = actualEvent(ledger);
        const execution = makeObservedCoordinator(ledger);
        const existingConflict = makeReserve({ id: 11, programId: 11, ruleId: 2, isConflict: true });
        const successor = makeReserve({ id: 102, programId: 102, ruleId: 3, channel: 'synthetic-other-channel' });
        const harness = makeModel({
            execution,
            ledger,
            programDB: { findId: vi.fn(async () => successor), findRule: vi.fn() },
            reserveEvent: adapter.event,
        });
        harness.reserveDB.findTimeRanges.mockImplementation(async ({ hasConflict }: { hasConflict: boolean }) =>
            hasConflict ? [existingConflict] : [],
        );
        harness.model.setTuners([{ types: ['GR'] }]);

        await expect(harness.model.addEventRelay(102, makeReserve({ ruleId: 3 }))).rejects.toThrow(
            'ReservationManageModelAddReserveConflict',
        );

        expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledWith({
            times: [{ startAt: successor.startAt, endAt: successor.endAt }],
            hasSkip: false,
            hasConflict: true,
            hasOverlap: false,
        });
        expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
        expect(adapter.consumer).not.toHaveBeenCalled();
        expect(ledger).toEqual(['unlock']);

        const followUpId = await execution.getExecution(0, 1);
        execution.unLockExecution(followUpId);
    });

    it('[RM-3.1/RM-8.5] delivers an authoritative empty rule diff through the actual adapter once', async () => {
        const ledger: string[] = [];
        const adapter = actualEvent(ledger);
        const execution = makeObservedCoordinator(ledger);
        const harness = makeModel({ execution, ledger, reserveEvent: adapter.event });
        await harness.model.updateRule(8, true, false);
        expect(harness.ledger).toEqual(['commit', 'unlock', 'consumer']);
        expect(adapter.consumer).toHaveBeenCalledWith(expect.objectContaining({ insert: [], update: [], delete: [] }));
        expect(adapter.consumer).toHaveBeenCalledOnce();

        const followUpId = await execution.getExecution(0, 1);
        execution.unLockExecution(followUpId);
    });

    it('[RM-8.1/RM-8.17][RM-T8.3] releases the owner when a saved Program reservation has no current Program, without a replan or event', async () => {
        const ledger: string[] = [];
        const adapter = actualEvent(ledger);
        const execution = makeObservedCoordinator(ledger);
        const oldReserve = makeReserve({ id: 701, programId: 7_701 });
        const harness = makeModel({
            execution,
            ledger,
            programDB: { findId: vi.fn(async () => null), findRule: vi.fn() },
            reserveEvent: adapter.event,
        });
        harness.reserveDB.findId.mockResolvedValue(oldReserve);

        await expect(harness.model.update(oldReserve.id)).resolves.toBeUndefined();

        expect(harness.programDB.findId).toHaveBeenCalledExactlyOnceWith(oldReserve.programId);
        expect(harness.reserveDB.findTimeRanges).not.toHaveBeenCalled();
        expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
        expect(adapter.consumer).not.toHaveBeenCalled();
        expect(ledger).toEqual(['unlock']);

        const followUpId = await execution.getExecution(0, 1);
        execution.unLockExecution(followUpId);
    });

    it('[RM-5.6/RM-6.7/RM-8.2/RM-8.5] delivers a time manual conflict-only update through a real registered consumer', async () => {
        const ledger: string[] = [];
        const adapter = actualEvent(ledger);
        const harness = makeModel({ ledger, reserveEvent: adapter.event });
        const oldReserve = makeReserve({
            id: 301,
            programId: null,
            ruleId: null,
            isTimeSpecified: true,
            isEventRelay: true,
        });

        const diff = harness.model.createReservesDiff(
            [oldReserve],
            [Object.assign({}, oldReserve, { isConflict: true })],
            false,
        );
        adapter.event.emitUpdated(diff);

        expect(adapter.consumer).toHaveBeenCalledOnce();
        expect(adapter.consumer.mock.calls[0][0]).toMatchObject({
            update: [
                {
                    id: 301,
                    isConflict: true,
                    isTimeSpecified: true,
                    isEventRelay: true,
                },
            ],
        });
        expect(ledger).toEqual(['consumer']);
    });

    it('[RM-8.9/RM-8.17] binds concurrent relay operations to the actual coordinator until the first lifecycle releases', async () => {
        const ledger: string[] = [];
        const adapter = actualEvent(ledger);
        const execution = makeCoordinator();
        const firstProgram = deferred<ReturnType<typeof makeReserve>>();
        const harness = makeModel({
            execution,
            ledger,
            programDB: {
                findId: vi.fn((id: number) =>
                    id === 202 ? firstProgram.promise : Promise.resolve(makeReserve({ id, programId: id })),
                ),
                findRule: vi.fn(),
            },
            reserveEvent: adapter.event,
        });
        harness.model.setTuners([{ types: ['GR'] }]);

        const first = harness.model.addEventRelay(202, makeReserve());
        await Promise.resolve();
        await Promise.resolve();
        expect(harness.programDB.findId).toHaveBeenCalledWith(202);

        const second = harness.model.addEventRelay(203, makeReserve());
        await Promise.resolve();
        await Promise.resolve();
        expect(harness.programDB.findId).toHaveBeenCalledTimes(1);

        firstProgram.resolve(makeReserve({ id: 202, programId: 202 }));
        await first;
        await second;

        expect(harness.programDB.findId.mock.calls.map((call: [number]) => call[0])).toEqual([202, 203]);
        expect(adapter.consumer).toHaveBeenCalledTimes(2);

        const followUpId = await execution.getExecution(0, 1);
        execution.unLockExecution(followUpId);
    });

    describe('rule-candidate-to-commit-unlock-diff-and-consumers', () => {
        it('[RM-8.5][RM-T16] hands one Rule candidate through the committed transaction, process event, and recording boundary', async () => {
            const persistence = await createPersistence('sqlite');
            try {
                const ledger: string[] = [];
                const process = makeProcessHandoff(ledger);
                const coordination = makeRuleCoordinator(ledger);
                const transaction = observeReservationTransaction(persistence.source, ledger);
                const rule = makeEnabledProgramRule(801);
                const candidate = makeRuleCandidate(9_801);
                const harness = makeModel({
                    execution: coordination.execution,
                    ledger,
                    programDB: {
                        findId: vi.fn(async () => null),
                        findRule: vi.fn(async option => {
                            ledger.push('candidate:input');
                            expect(option).toEqual({
                                reserveOption: rule.reserveOption,
                                searchOption: rule.searchOption,
                            });
                            return [candidate];
                        }),
                    },
                    reserveDB: persistence.db,
                    reserveEvent: process.event,
                    ruleDB: { findId: vi.fn(async () => rule), getIds: vi.fn(async () => []) },
                });
                harness.model.setTuners([{ types: ['GR'] }]);

                await expect(harness.model.updateRule(rule.id)).resolves.toBeUndefined();

                expect(ledger).toEqual([
                    'lock:1',
                    'candidate:input',
                    'transaction:start',
                    'transaction:commit',
                    'transaction:release',
                    'unlock:1',
                    'process:ipc',
                    'recording:accept',
                    'process:hook',
                ]);
                expect(coordination.unlock).toHaveBeenCalledExactlyOnceWith(1);
                expect(process.recordingManage.acceptMutation).toHaveBeenCalledExactlyOnceWith(
                    expect.objectContaining({
                        insert: [expect.objectContaining({ programId: candidate.id, ruleId: rule.id })],
                    }),
                );
                expect(process.ipc.notifyClient).toHaveBeenCalledOnce();
                expect(process.externalCommandManage.addUpdateReseves).toHaveBeenCalledOnce();
                expect(await persistence.source.getRepository(Reserve).find()).toEqual([
                    expect.objectContaining({ programId: candidate.id, ruleId: rule.id }),
                ]);
                transaction.mockRestore();
            } finally {
                await persistence.cleanup();
            }
        });

        it('[RM-8.5][RM-T16] rolls back a Rule candidate transaction before release without process event or recording handoff', async () => {
            const persistence = await createPersistence('sqlite');
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            try {
                const ledger: string[] = [];
                const process = makeProcessHandoff(ledger);
                const coordination = makeRuleCoordinator(ledger);
                const transaction = observeReservationTransaction(persistence.source, ledger, true);
                const rule = makeEnabledProgramRule(802);
                const candidate = makeRuleCandidate(9_802);
                const harness = makeModel({
                    execution: coordination.execution,
                    ledger,
                    programDB: {
                        findId: vi.fn(async () => null),
                        findRule: vi.fn(async () => {
                            ledger.push('candidate:input');
                            return [candidate];
                        }),
                    },
                    reserveDB: persistence.db,
                    reserveEvent: process.event,
                    ruleDB: { findId: vi.fn(async () => rule), getIds: vi.fn(async () => []) },
                });
                harness.model.setTuners([{ types: ['GR'] }]);

                await expect(harness.model.updateRule(rule.id)).rejects.toThrow('ReserveUpdateManyError');

                expect(ledger).toEqual([
                    'lock:1',
                    'candidate:input',
                    'transaction:start',
                    'transaction:rollback',
                    'transaction:release',
                    'unlock:1',
                ]);
                expect(coordination.unlock).toHaveBeenCalledExactlyOnceWith(1);
                expect(process.ipc.notifyClient).not.toHaveBeenCalled();
                expect(process.recordingManage.acceptMutation).not.toHaveBeenCalled();
                expect(process.externalCommandManage.addUpdateReseves).not.toHaveBeenCalled();
                expect(await persistence.source.getRepository(Reserve).find()).toEqual([]);
                transaction.mockRestore();
            } finally {
                consoleError.mockRestore();
                await persistence.cleanup();
            }
        });

        it('[RM-8.18][RM-T16] settles an overdue Rule transaction once, releases its resources, and then emits its process handoff', async () => {
            vi.useFakeTimers();
            const persistence = await createPersistence('sqlite');
            try {
                const ledger: string[] = [];
                const process = makeProcessHandoff(ledger);
                const coordination = makeRuleCoordinator(ledger);
                const transaction = observeReservationTransaction(persistence.source, ledger);
                const rule = makeEnabledProgramRule(803);
                const candidate = makeRuleCandidate(9_803);
                const pendingRangeRead = deferred<ReturnType<typeof makeReserve>[]>();
                const rangeReadEntered = deferred<void>();
                vi.spyOn(persistence.db, 'findTimeRanges').mockImplementation(async () => {
                    ledger.push('diff:blocked');
                    rangeReadEntered.resolve();
                    return await pendingRangeRead.promise;
                });
                const harness = makeModel({
                    execution: coordination.execution,
                    ledger,
                    programDB: {
                        findId: vi.fn(async () => null),
                        findRule: vi.fn(async () => {
                            ledger.push('candidate:input');
                            return [candidate];
                        }),
                    },
                    reserveDB: persistence.db,
                    reserveEvent: process.event,
                    ruleDB: { findId: vi.fn(async () => rule), getIds: vi.fn(async () => []) },
                });
                harness.model.setTuners([{ types: ['GR'] }]);

                const pendingUpdate = harness.model.updateRule(rule.id);
                await rangeReadEntered.promise;
                const queuedSuccessor = coordination.coordinator.getExecution(0, 600_002);
                const successorGranted = vi.fn();
                void queuedSuccessor.then(successorGranted);

                await vi.advanceTimersByTimeAsync(600_000);
                expect(coordination.overdueLog).toHaveBeenCalledExactlyOnceWith('reservation execution overdue: 1');
                expect(successorGranted).not.toHaveBeenCalled();
                expect(process.recordingManage.acceptMutation).not.toHaveBeenCalled();

                pendingRangeRead.resolve([]);
                await expect(pendingUpdate).resolves.toBeUndefined();

                expect(ledger).toEqual([
                    'lock:1',
                    'candidate:input',
                    'diff:blocked',
                    'transaction:start',
                    'transaction:commit',
                    'transaction:release',
                    'unlock:1',
                    'process:ipc',
                    'recording:accept',
                    'process:hook',
                ]);
                expect(coordination.unlock).toHaveBeenCalledExactlyOnceWith(1);
                expect(process.recordingManage.acceptMutation).toHaveBeenCalledOnce();

                const successorId = await queuedSuccessor;
                expect(successorGranted).toHaveBeenCalledExactlyOnceWith(successorId);
                coordination.coordinator.unLockExecution(successorId);
                expect(vi.getTimerCount()).toBe(0);
                transaction.mockRestore();
            } finally {
                vi.useRealTimers();
                await persistence.cleanup();
            }
        });
    });
});
