import { afterEach, describe, expect, it, vi } from 'vitest';
import { load, makeModel, makeReserve, ReservationManageModel, ReserveEvent } from './_harness';

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

const makeCoordinator = (maxExecutionId?: number): Coordinator =>
    new ExecutionManagementModel(
        {
            getLogger: () => ({ system: { error: vi.fn() } }),
        },
        maxExecutionId,
        true,
    );

const deferred = <T = void>() => {
    let resolve: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve: resolve! };
};

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('reservation refresh batch characterization', () => {
    it('[RM-8.1] enumerates three groups and settles each item in order', async () => {
        vi.useFakeTimers();
        const harness = makeModel();
        harness.reserveDB.getManualIds.mockResolvedValue([1, 2]);
        harness.reserveDB.getRuleEventRelayIds.mockResolvedValue([3]);
        harness.ruleDB.getIds.mockResolvedValue([4, 5]);
        const calls: string[] = [];
        harness.model.update = vi.fn(async (id: number) => calls.push(`reserve:${id}`));
        harness.model.updateRule = vi.fn(async (id: number) => calls.push(`rule:${id}`));
        const pending = harness.model.updateAll(false);
        await vi.runAllTimersAsync();
        await pending;
        expect(calls).toEqual(['reserve:1', 'reserve:2', 'reserve:3', 'rule:4', 'rule:5']);
        expect(vi.getTimerCount()).toBe(0);
        vi.useRealTimers();
    });

    it('[RM-8.13] keeps overlapping calls and promises independent', async () => {
        vi.useFakeTimers();
        const harness = makeModel();
        harness.reserveDB.getManualIds.mockResolvedValueOnce([1]).mockResolvedValueOnce([2]);
        harness.model.update = vi.fn(async () => undefined);
        harness.model.updateRule = vi.fn(async () => undefined);
        const first = harness.model.updateAll(false);
        const second = harness.model.updateAll(false);
        expect(first).not.toBe(second);
        await vi.runAllTimersAsync();
        await Promise.all([first, second]);
        expect(harness.model.update.mock.calls.map((call: any[]) => call[0])).toEqual([1, 2]);
        vi.useRealTimers();
    });

    it('[RM-8.12] continues with the next item after one update rejects', async () => {
        vi.useFakeTimers();
        const harness = makeModel();
        harness.reserveDB.getManualIds.mockResolvedValue([1, 2]);
        harness.model.update = vi
            .fn()
            .mockRejectedValueOnce(new Error('synthetic item failure'))
            .mockResolvedValue(undefined);
        harness.model.updateRule = vi.fn(async () => undefined);
        const pending = harness.model.updateAll(false);
        await vi.runAllTimersAsync();
        await pending;
        expect(harness.model.update.mock.calls.map((call: any[]) => call[0])).toEqual([1, 2]);
        vi.useRealTimers();
    });

    it('[RM-8.2] sweeps persisted normal and conflict reservations after every batch, including time manual conflicts', async () => {
        vi.useFakeTimers();
        const timeManual = makeReserve({ id: 11, programId: null, isTimeSpecified: true, isConflict: false });
        const conflictingProgram = makeReserve({ id: 12, programId: 202, isConflict: true });
        const skipped = makeReserve({ id: 13, programId: 203, isConflict: true, isSkip: true });
        const overlapped = makeReserve({ id: 14, programId: 204, isConflict: true, isOverlap: true });
        const execution = makeCoordinator();
        const harness = makeModel({ execution });
        harness.model.setTuners([]);
        harness.reserveDB.getManualIds.mockResolvedValue([1]);
        harness.reserveDB.findLists.mockResolvedValue([timeManual, conflictingProgram, skipped, overlapped]);
        harness.model.update = vi.fn(async () => undefined);
        harness.model.updateRule = vi.fn(async () => undefined);
        const sweepEntered = deferred();
        const continueSweep = deferred();
        const originalSweep = harness.model.createConflictSweepDiff.bind(harness.model);
        const sweep = vi.spyOn(harness.model, 'createConflictSweepDiff').mockImplementation(async (...args: any[]) => {
            sweepEntered.resolve();
            await continueSweep.promise;
            return originalSweep(...args);
        });

        const pending = harness.model.updateAll(false);
        await vi.runAllTimersAsync();
        await sweepEntered.promise;

        expect(harness.model.update).toHaveBeenCalledWith(1, false);
        expect(sweep).toHaveBeenCalledWith(
            [timeManual, conflictingProgram, skipped, overlapped],
            [timeManual, conflictingProgram],
            [skipped, overlapped],
            false,
        );

        let successorGrants = 0;
        const successor = execution.getExecution(ReservationManageModel.UPDATE_RESERVE_PRIORITY, 20).then(
            id => {
                successorGrants += 1;
                return { error: null, id };
            },
            error => ({ error, id: null }),
        );
        await Promise.resolve();
        expect(successorGrants).toBe(0);

        continueSweep.resolve();
        await pending;
        await vi.advanceTimersByTimeAsync(20);
        const successorResult = await successor;

        expect(harness.reserveDB.findLists).toHaveBeenCalledOnce();
        expect(harness.model.update.mock.invocationCallOrder[0]).toBeLessThan(
            harness.reserveDB.findLists.mock.invocationCallOrder[0],
        );
        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith({
            delete: [],
            insert: [],
            isSuppressLog: false,
            update: [expect.objectContaining({ id: 11, isConflict: true, isTimeSpecified: true })],
        });
        expect(harness.reserveEvent.emitUpdated).toHaveBeenCalledWith({
            delete: [],
            insert: [],
            isSuppressLog: false,
            update: [expect.objectContaining({ id: 11, isConflict: true, isTimeSpecified: true })],
        });
        expect(successorGrants).toBe(1);
        expect(successorResult.error).toBeNull();
        expect(successorResult.id).toEqual(expect.any(Number));
        execution.unLockExecution(successorResult.id!);
        vi.useRealTimers();
    });

    it('[RM-8.3] leaves a time manual channel and time untouched by a program update', async () => {
        const timeManual = makeReserve({
            id: 15,
            programId: null,
            isTimeSpecified: true,
            isEventRelay: true,
            channelId: 10,
            startAt: 1_000,
            endAt: 2_000,
        });
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(timeManual);

        await harness.model.update(15);
        expect(harness.programDB.findId).not.toHaveBeenCalled();
        expect(timeManual).toMatchObject({ channelId: 10, startAt: 1_000, endAt: 2_000 });
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
    });

    it('[RM-8.6] delivers confirmed normal and conflict rows through the reservation event', () => {
        const event = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
        const delivered = vi.fn();
        event.setUpdated(delivered);
        const normal = makeReserve({ id: 16, isConflict: false });
        const conflict = makeReserve({ id: 17, isConflict: true });

        event.emitUpdated({ insert: [normal, conflict], isSuppressLog: false });
        expect(delivered).toHaveBeenCalledWith({ insert: [normal, conflict], isSuppressLog: false });
    });

    it('[RM-8.7] requests startup recalculation for persisted rule identifiers before publishing a diff', async () => {
        vi.useFakeTimers();
        const persisted = makeReserve({ id: 18, programId: 218, isConflict: false });
        const harness = makeModel();
        harness.model.setTuners([{ types: ['GR'] }]);
        harness.reserveDB.findLists.mockResolvedValue([persisted]);
        harness.ruleDB.getIds.mockResolvedValue([71]);
        harness.model.update = vi.fn(async () => undefined);
        harness.model.updateRule = vi.fn(async () => undefined);

        const pending = harness.model.updateAll(true);
        await vi.runAllTimersAsync();
        await pending;

        expect(harness.reserveDB.findLists).toHaveBeenCalledTimes(2);
        expect(harness.model.updateRule).toHaveBeenCalledWith(71, false, true);
        expect(harness.reserveEvent.emitUpdated).toHaveBeenCalledWith(
            expect.objectContaining({ update: [persisted], isSuppressLog: false }),
        );
    });

    it('[RM-8.10] performs a relay duplicate precheck only before execution and not again before insert', async () => {
        const successor = makeReserve({ id: 19, programId: 219 });
        const harness = makeModel({ programDB: { findId: vi.fn(async () => successor), findRule: vi.fn() } });
        harness.model.setTuners([{ types: ['GR'] }]);

        await harness.model.addEventRelay(219, makeReserve({ id: 20 }));
        expect(harness.reserveDB.findProgramId).toHaveBeenCalledExactlyOnceWith(219);
        expect(harness.reserveDB.insertOnce).toHaveBeenCalledOnce();
    });

    it('[RM-8.14] keeps concurrent add, edit, and cancel inputs and completion results distinct', async () => {
        const execution = makeCoordinator();
        const event = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
        const delivered = vi.fn();
        event.setUpdated(delivered);
        const harness = makeModel({
            execution,
            reserveEvent: event,
            programDB: {
                findId: vi.fn(async (programId: number) => makeReserve({ id: programId, programId })),
                findRule: vi.fn(),
            },
        });
        harness.model.setTuners([{ types: ['GR'] }]);
        harness.reserveDB.findId.mockImplementation(async (id: number) =>
            id === 222 ? makeReserve({ id, tags: '["old"]' }) : makeReserve({ id, programId: 223 }),
        );

        const add = harness.model.add({ programId: 221, allowEndLack: false });
        const edit = harness.model.edit(222, { allowEndLack: true, tags: ['edited'] });
        const cancel = harness.model.cancel(223);
        expect(new Set([add, edit, cancel]).size).toBe(3);

        await expect(Promise.all([add, edit, cancel])).resolves.toEqual([41, undefined, undefined]);
        expect(harness.programDB.findId).toHaveBeenCalledExactlyOnceWith(221);
        expect(harness.reserveDB.findId).toHaveBeenCalledWith(222);
        expect(harness.reserveDB.findId).toHaveBeenCalledWith(223);
        expect(harness.reserveDB.updateOnce).toHaveBeenCalledWith(
            expect.objectContaining({ id: 222, allowEndLack: true, tags: '["edited"]' }),
        );
        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ delete: [expect.objectContaining({ id: 223 })] }),
        );
        expect(delivered).toHaveBeenCalledTimes(3);
        expect(delivered.mock.calls.map(call => call[0])).toEqual([
            {
                insert: [expect.objectContaining({ id: 41, programId: 221 })],
                isSuppressLog: false,
            },
            {
                update: [expect.objectContaining({ id: 222, tags: '["edited"]' })],
                isSuppressLog: false,
            },
            {
                delete: [expect.objectContaining({ id: 223 })],
                insert: [],
                isSuppressLog: false,
                update: [],
            },
        ]);
    });
});

describe('expired reservation cleanup', () => {
    it('[RM-8.4] deletes expired rows and replans overlapping survivors in one committed diff', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(2_000);
        const expired = makeReserve({ id: 21, programId: 301, startAt: 1_000, endAt: 1_999 });
        const survivor = makeReserve({ id: 22, programId: 302, startAt: 1_500, endAt: 3_000, isConflict: false });
        const harness = makeModel();
        harness.model.setTuners([]);
        harness.reserveDB.findOldTime.mockResolvedValue([expired]);
        harness.reserveDB.findTimeRanges
            .mockResolvedValueOnce([expired, survivor])
            .mockResolvedValueOnce([survivor])
            .mockRejectedValue(new Error('unexpected cleanup closure range query'));

        await harness.model.cleanup();

        expect(harness.reserveDB.findOldTime).toHaveBeenCalledWith(2_000);
        expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledWith({
            hasConflict: true,
            hasOverlap: false,
            hasSkip: false,
            times: [{ startAt: 1_000, endAt: 1_999 }],
        });
        expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledTimes(2);
        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith({
            delete: [expired],
            insert: [],
            isSuppressLog: false,
            update: [expect.objectContaining({ id: 22, isConflict: true })],
        });
        expect(harness.ledger).toEqual(['lock', 'commit', 'unlock', 'event']);
        expect(harness.reserveEvent.emitUpdated).toHaveBeenCalledOnce();
        expect(harness.log.system.info).toHaveBeenCalledWith('finish reserves cleanup');
        vi.useRealTimers();
    });

    it('[RM-8.5] preserves the transitive survivor conflict and publishes a normalized conflict update', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(15);
        const expired = makeReserve({ id: 31, programId: 401, startAt: 0, endAt: 10 });
        const survivor = makeReserve({
            id: 32,
            programId: 402,
            ruleId: 5,
            channel: 'survivor-channel',
            startAt: 5,
            endAt: 20,
            isConflict: true,
        });
        const higherPriority = makeReserve({
            id: 33,
            programId: 403,
            ruleId: null,
            isTimeSpecified: true,
            channel: 'higher-priority-channel',
            startAt: 15,
            endAt: 25,
            isConflict: true,
        });
        const harness = makeModel();
        harness.model.setTuners([{ types: ['GR'] }]);
        harness.reserveDB.findOldTime.mockResolvedValue([expired]);
        harness.reserveDB.findTimeRanges
            .mockResolvedValueOnce([expired, survivor, higherPriority])
            .mockResolvedValueOnce([survivor, higherPriority])
            .mockResolvedValueOnce([survivor, higherPriority])
            .mockRejectedValue(new Error('unexpected cleanup closure range query'));

        await harness.model.cleanup();

        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith({
            delete: [expired],
            insert: [],
            isSuppressLog: false,
            update: [expect.objectContaining({ id: higherPriority.id, isConflict: false })],
        });
        expect(harness.reserveEvent.emitUpdated).toHaveBeenCalledWith({
            delete: [expired],
            insert: [],
            isSuppressLog: false,
            update: [expect.objectContaining({ id: higherPriority.id, isConflict: false })],
        });
        expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledTimes(3);
        expect(harness.ledger).toEqual(['lock', 'commit', 'unlock', 'event']);
        expect(harness.log.system.info).toHaveBeenCalledWith('finish reserves cleanup');
        vi.useRealTimers();
    });

    it('releases cleanup after a range lookup failure without committing or emitting', async () => {
        const expired = makeReserve({ id: 41, programId: 501, startAt: 0, endAt: 10 });
        const rangeFailure = new Error('synthetic cleanup range failure');
        const harness = makeModel();
        harness.reserveDB.findOldTime.mockResolvedValue([expired]);
        harness.reserveDB.findTimeRanges.mockRejectedValue(rangeFailure);

        await expect(harness.model.cleanup()).rejects.toBe(rangeFailure);

        expect(harness.log.system.error).toHaveBeenCalledWith('delete old reservation error');
        expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
        expect(harness.ledger).toEqual(['lock', 'unlock']);
        vi.useRealTimers();
    });
});

describe('reservation execution coordinator public contract', () => {
    it('[RM-8.11] releases the acquired mutation execution when a rule read rejects', async () => {
        const failure = new Error('synthetic post-acquisition read failure');
        const harness = makeModel();
        harness.ruleDB.findId.mockRejectedValue(failure);

        await expect(harness.model.updateRule(1)).rejects.toBe(failure);

        expect(harness.execution.getExecution).toHaveBeenCalledOnce();
        expect(harness.execution.unLockExecution).toHaveBeenCalledWith(7);
        expect(harness.execution.unLockExecution).toHaveBeenCalledOnce();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
    });

    it('releases the acquired cleanup execution when its snapshot read rejects', async () => {
        const failure = new Error('synthetic cleanup snapshot failure');
        const harness = makeModel();
        harness.reserveDB.findOldTime.mockRejectedValue(failure);

        await expect(harness.model.cleanup()).rejects.toBe(failure);

        expect(harness.execution.getExecution).toHaveBeenCalledOnce();
        expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
    });

    it('releases the acquired cleanup execution when its start logger throws synchronously', async () => {
        const failure = new Error('synthetic cleanup start log failure');
        const harness = makeModel();
        harness.log.system.info.mockImplementationOnce(() => {
            throw failure;
        });

        await expect(harness.model.cleanup()).rejects.toBe(failure);

        expect(harness.execution.getExecution).toHaveBeenCalledOnce();
        expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
        expect(harness.reserveDB.findOldTime).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
    });

    // 599_999 / 600_002 bracket ExecutionManagementModel.OWNER_WATCHDOG_TIMEOUT = 600_000
    // (src/model/ExecutionManagementModel.ts:220), a v3-only contract with no v2 counterpart --
    // approved in .kiro/specs/server-reservation-management/design.md:309-310, RM-8.18.
    it('[RM-8.18] keeps an overdue owner in its reservation lane until that owner settles late', async () => {
        vi.useFakeTimers();
        const overdueLog = vi.fn();
        const coordinator = new ExecutionManagementModel(
            {
                getLogger: () => ({ system: { error: overdueLog } }),
            },
            undefined,
            true,
        );

        try {
            const ownerId = await coordinator.getExecution(0);
            let successorGranted = false;
            const successor = coordinator.getExecution(0, 600_002).then(id => {
                successorGranted = true;
                return id;
            });

            await vi.advanceTimersByTimeAsync(599_999);
            expect(overdueLog).not.toHaveBeenCalled();
            expect(successorGranted).toBe(false);

            await vi.advanceTimersByTimeAsync(1);
            expect(overdueLog).toHaveBeenCalledWith(`reservation execution overdue: ${ownerId}`);
            expect(successorGranted).toBe(false);

            await vi.advanceTimersByTimeAsync(1);
            expect(overdueLog).toHaveBeenCalledOnce();
            expect(successorGranted).toBe(false);

            coordinator.unLockExecution(ownerId);
            const successorId = await successor;
            expect(successorGranted).toBe(true);
            coordinator.unLockExecution(successorId);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('[RM-8.9] grants higher priority waiters before lower priority waiters and keeps equal priorities FIFO', async () => {
        const coordinator = makeCoordinator();
        const ownerId = await coordinator.getExecution(0);
        const grants: string[] = [];
        const lower = coordinator.getExecution(1).then(id => {
            grants.push('lower');
            return id;
        });
        const firstHigher = coordinator.getExecution(2).then(id => {
            grants.push('first-higher');
            return id;
        });
        const secondHigher = coordinator.getExecution(2).then(id => {
            grants.push('second-higher');
            return id;
        });

        coordinator.unLockExecution(ownerId);
        const firstHigherId = await firstHigher;
        expect(grants).toEqual(['first-higher']);

        coordinator.unLockExecution(firstHigherId);
        const secondHigherId = await secondHigher;
        expect(grants).toEqual(['first-higher', 'second-higher']);

        coordinator.unLockExecution(secondHigherId);
        const lowerId = await lower;
        expect(grants).toEqual(['first-higher', 'second-higher', 'lower']);
        coordinator.unLockExecution(lowerId);
    });

    it('[RM-8.15] rejects a timed-out waiter and lets the following request acquire after its owner releases', async () => {
        vi.useFakeTimers();
        const coordinator = makeCoordinator();
        const ownerId = await coordinator.getExecution(0);
        const timedOut = coordinator.getExecution(0, 10);
        const timedOutResult = expect(timedOut).rejects.toThrow('GetExecutionTimeoutError');

        await vi.advanceTimersByTimeAsync(10);
        await timedOutResult;

        coordinator.unLockExecution(ownerId);
        const successor = coordinator.getExecution(0, 10);
        const successorId = await successor;
        expect(successorId).toEqual(expect.any(Number));
        coordinator.unLockExecution(successorId);
    });

    it('[RM-8.16] allocates through a bounded ID wrap after release without colliding with a waiting owner', async () => {
        vi.useFakeTimers();
        const coordinator = makeCoordinator(2);
        const firstId = await coordinator.getExecution(0);
        const secondRequest = coordinator.getExecution(0);
        const thirdRequest = coordinator.getExecution(0);

        coordinator.unLockExecution(firstId);
        const secondId = await secondRequest;
        let thirdGranted = false;
        void thirdRequest.then(() => {
            thirdGranted = true;
        });
        await Promise.resolve();
        expect(thirdGranted).toBe(false);

        coordinator.unLockExecution(secondId);
        const thirdId = await thirdRequest;

        expect([firstId, secondId, thirdId]).toEqual([1, 2, 1]);
        expect([firstId, secondId, thirdId].every(Number.isSafeInteger)).toBe(true);
        coordinator.unLockExecution(thirdId);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RM-8.17] ignores a non-owner and duplicate unlock without transferring ownership', async () => {
        const coordinator = makeCoordinator();
        const ownerId = await coordinator.getExecution(0);
        const waiter = coordinator.getExecution(0);
        const waiterGranted = vi.fn();
        void waiter.then(waiterGranted);

        coordinator.unLockExecution(ownerId + 1);
        await Promise.resolve();
        expect(waiterGranted).not.toHaveBeenCalled();

        coordinator.unLockExecution(ownerId);
        const waiterId = await waiter;
        coordinator.unLockExecution(ownerId);
        await Promise.resolve();

        const afterDuplicate = coordinator.getExecution(0);
        const afterDuplicateGranted = vi.fn();
        void afterDuplicate.then(afterDuplicateGranted);
        await Promise.resolve();
        expect(afterDuplicateGranted).not.toHaveBeenCalled();

        coordinator.unLockExecution(waiterId);
        const afterDuplicateId = await afterDuplicate;
        coordinator.unLockExecution(afterDuplicateId);
    });

    it('[RM-8.8] keeps the execution lock while edit() waits for its reservation read', async () => {
        const execution = makeCoordinator();
        const harness = makeModel({ execution });
        let resolveRead: (reserve: ReturnType<typeof makeReserve>) => void;
        const pendingRead = new Promise<ReturnType<typeof makeReserve>>(resolve => {
            resolveRead = resolve;
        });
        harness.reserveDB.findId.mockReturnValue(pendingRead);

        const edit = harness.model.edit(1, { allowEndLack: true });
        await Promise.resolve();
        await Promise.resolve();
        expect(harness.reserveDB.findId).toHaveBeenCalledWith(1);

        let laterExecutionGranted = false;
        const laterExecution = execution.getExecution(0).then(id => {
            laterExecutionGranted = true;
            return id;
        });
        await Promise.resolve();
        expect(laterExecutionGranted).toBe(false);

        resolveRead!(makeReserve());
        await edit;

        const laterExecutionId = await laterExecution;
        expect(laterExecutionGranted).toBe(true);
        execution.unLockExecution(laterExecutionId);
    });
});
