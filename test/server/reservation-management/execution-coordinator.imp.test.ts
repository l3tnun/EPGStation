import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Container } from 'inversify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { load, makeModel, makeReserve } from './_harness';

type Coordinator = {
    getExecution(priority: number, timeout?: number): Promise<number>;
    unLockExecution(id: number): void;
};

type CoordinatorResources = {
    exeEventEmitter: {
        listenerCount(eventName: string): number;
    };
    owner: { state: string } | null;
};

type ReservationModel = {
    addEventRelay(programId: number, parentReserve: Record<string, unknown>): Promise<unknown>;
    setTuners(tuners: Array<{ types: string[] }>): void;
};

const ExecutionManagementModel = load<
    new (
        logger: { getLogger(): { system: { error: (message: string) => void } } },
        maxExecutionId?: number,
        reservationOwnerWatchdog?: boolean,
    ) => Coordinator
>('model', 'ExecutionManagementModel.js');

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');
const setModelContainer = (
    require(join(snapshot, 'model', 'ModelContainerSetter.js')) as { set(container: Container): void }
).set;

const makeCoordinator = (maxExecutionId?: number): Coordinator =>
    new ExecutionManagementModel(
        {
            getLogger: () => ({ system: { error: vi.fn() } }),
        },
        maxExecutionId,
        true,
    );

const listenerCount = (coordinator: Coordinator): number =>
    (coordinator as unknown as CoordinatorResources).exeEventEmitter.listenerCount('ExeUnlock');

const resources = (coordinator: Coordinator): CoordinatorResources => coordinator as unknown as CoordinatorResources;

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('priority-timeout-wrap-unused-exact-release-overdue-late-settlement', () => {
    it('[RM-8.11/RM-8.17] releases the acquired owner exactly once when a rule read rejects', async () => {
        const failure = new Error('synthetic rule read failure');
        const harness = makeModel();
        harness.ruleDB.findId.mockRejectedValue(failure);

        await expect(harness.model.updateRule(1)).rejects.toBe(failure);

        expect(harness.execution.getExecution).toHaveBeenCalledOnce();
        expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
    });

    it('[RM-2.6/RM-8.8/RM-8.14] rejects invalid edit input before creating an execution request', async () => {
        const execution = {
            getExecution: vi.fn(async () => 7),
            unLockExecution: vi.fn(),
        };
        const ReservationManageModel = load<
            new (...args: any[]) => {
                edit(reserveId: number, option: { allowEndLack: boolean; encodeOption: object }): Promise<void>;
            }
        >('model', 'operator', 'reservation', 'ReservationManageModel.js');
        const model = new ReservationManageModel(
            { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn() } }) },
            { getConfig: () => ({}) },
            execution,
            { checkEncodeOption: vi.fn(() => false) },
            {},
            {},
            {},
            {},
            {},
        );

        await expect(model.edit(1, { allowEndLack: true, encodeOption: {} })).rejects.toThrow('ReservationEditError');

        expect(execution.getExecution).not.toHaveBeenCalled();
        expect(execution.unLockExecution).not.toHaveBeenCalled();
    });

    // The 600_000 (600s) below is ExecutionManagementModel.OWNER_WATCHDOG_TIMEOUT
    // (src/model/ExecutionManagementModel.ts:220). This watchdog has no v2 counterpart -- it is a
    // v3 contract approved in .kiro/specs/server-reservation-management/design.md:309-310, RM-8.18.
    it('[RM-8.18] reserves the owner watchdog for the reservation-specific DI binding', async () => {
        vi.useFakeTimers();
        const overdueLog = vi.fn();
        const container = new Container({ skipBaseClassChecks: true });
        setModelContainer(container);
        container.rebind('ILoggerModel').toConstantValue({
            getLogger: () => ({
                system: { debug: vi.fn(), error: overdueLog, info: vi.fn(), warn: vi.fn() },
            }),
        });

        const generic = container.get<Coordinator>('IExecutionManagementModel');
        const genericId = await generic.getExecution(0);
        await vi.advanceTimersByTimeAsync(600_000);
        expect(overdueLog).not.toHaveBeenCalled();
        generic.unLockExecution(genericId);

        let rejectLateProgram: (error: Error) => void;
        const lateProgram = new Promise<never>((_, reject) => {
            rejectLateProgram = reject;
        });
        container.rebind('IConfiguration').toConstantValue({
            getConfig: () => ({ isSuppressReservesUpdateAllLog: false }),
        });
        container.rebind('IReserveOptionChecker').toConstantValue({ checkEncodeOption: () => true });
        container.rebind('IReserveDB').toConstantValue({ findProgramId: vi.fn(async () => []) });
        container.rebind('IChannelDB').toConstantValue({});
        container.rebind('IProgramDB').toConstantValue({ findId: vi.fn(() => lateProgram) });
        container.rebind('IRuleDB').toConstantValue({});
        container.rebind('IReserveEvent').toConstantValue({ emitUpdated: vi.fn() });

        const reservation = container.get<ReservationModel>('IReservationManageModel');
        reservation.setTuners([{ types: ['GR'] }]);
        const lateRelay = reservation.addEventRelay(202, makeReserve());
        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(600_000);
        expect(overdueLog).toHaveBeenCalledWith('reservation execution overdue: 1');
        rejectLateProgram!(new Error('synthetic late program failure'));
        await expect(lateRelay).rejects.toThrow('synthetic late program failure');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RM-8.18] keeps an overdue owner in its lane until its original ID releases it exactly once', async () => {
        vi.useFakeTimers();
        const overdueLog = vi.fn();
        const coordinator = new ExecutionManagementModel(
            {
                getLogger: () => ({ system: { error: overdueLog } }),
            },
            undefined,
            true,
        );
        const ownerId = await coordinator.getExecution(0);
        const successor = coordinator.getExecution(0, 600_002);
        const successorGranted = vi.fn();
        void successor.then(successorGranted);

        await vi.advanceTimersByTimeAsync(600_000);
        expect(overdueLog).toHaveBeenCalledWith(`reservation execution overdue: ${ownerId}`);

        coordinator.unLockExecution(ownerId + 1);
        await Promise.resolve();
        expect(successorGranted).not.toHaveBeenCalled();

        coordinator.unLockExecution(ownerId);
        const successorId = await successor;
        expect(successorGranted).toHaveBeenCalledWith(successorId);

        const later = coordinator.getExecution(0, 1);
        const laterGranted = vi.fn();
        void later.then(laterGranted);
        coordinator.unLockExecution(ownerId);
        await Promise.resolve();
        expect(laterGranted).not.toHaveBeenCalled();

        coordinator.unLockExecution(successorId);
        const laterId = await later;
        coordinator.unLockExecution(laterId);

        expect(overdueLog).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        expect(listenerCount(coordinator)).toBe(0);
    });

    it('[RM-8.18] ignores invalid owner state until the same overdue owner releases the FIFO successor', async () => {
        vi.useFakeTimers();
        const coordinator = makeCoordinator();
        const ownerId = await coordinator.getExecution(0);
        const successor = coordinator.getExecution(0, 600_002);
        const successorGranted = vi.fn();
        void successor.then(successorGranted);

        await vi.advanceTimersByTimeAsync(600_000);
        const coordinatorResources = resources(coordinator);
        const owner = coordinatorResources.owner;
        expect(owner).not.toBeNull();
        if (owner === null) throw new Error('ExecutionOwnerMissing');

        coordinatorResources.owner = null;
        expect(() => coordinator.unLockExecution(ownerId)).not.toThrow();
        coordinatorResources.owner = owner;
        owner.state = 'released';
        coordinator.unLockExecution(ownerId);
        await Promise.resolve();
        expect(successorGranted).not.toHaveBeenCalled();

        owner.state = 'overdue';
        coordinator.unLockExecution(ownerId);
        expect(owner.state).toBe('released');
        const successorId = await successor;
        expect(successorGranted).toHaveBeenCalledWith(successorId);
        coordinator.unLockExecution(successorId);
    });

    it('[RM-8.18] clears a reservation owner watchdog when the owner settles before its deadline', async () => {
        vi.useFakeTimers();
        const overdueLog = vi.fn();
        const coordinator = new ExecutionManagementModel(
            {
                getLogger: () => ({ system: { error: overdueLog } }),
            },
            undefined,
            true,
        );
        const ownerId = await coordinator.getExecution(0);

        await vi.advanceTimersByTimeAsync(599_999);
        coordinator.unLockExecution(ownerId);
        expect(vi.getTimerCount()).toBe(0);

        await vi.advanceTimersByTimeAsync(1);
        expect(overdueLog).not.toHaveBeenCalled();
    });

    it('[RM-8.18] skips timer cleanup after a reservation owner watchdog has already fired', async () => {
        vi.useFakeTimers();
        const coordinator = makeCoordinator();
        const ownerId = await coordinator.getExecution(0);

        await vi.advanceTimersByTimeAsync(600_000);
        const clearTimeout = vi.spyOn(global, 'clearTimeout');
        coordinator.unLockExecution(ownerId);

        expect(clearTimeout).not.toHaveBeenCalled();
    });

    it('[RM-8.15] releases timer and listener resources after an expired waiter is removed', async () => {
        vi.useFakeTimers();
        const coordinator = makeCoordinator();
        const ownerId = await coordinator.getExecution(0);
        const expired = coordinator.getExecution(0);
        const expiredResult = expect(expired).rejects.toThrow('GetExecutionTimeoutError');

        await vi.advanceTimersByTimeAsync(60_000);
        await expiredResult;

        coordinator.unLockExecution(ownerId);
        const successor = coordinator.getExecution(0, 1);
        const successorResult = successor.then(
            id => ({ id, status: 'fulfilled' as const }),
            error => ({ error, status: 'rejected' as const }),
        );
        await vi.advanceTimersByTimeAsync(1);
        await expect(successorResult).resolves.toEqual({ id: 3, status: 'fulfilled' });
        coordinator.unLockExecution(3);

        expect(vi.getTimerCount()).toBe(0);
        expect(listenerCount(coordinator)).toBe(0);
    });

    it('[RM-8.15] settles exactly once when unlock and timeout fire at the same deadline in either registration order', async () => {
        vi.useFakeTimers();

        for (const unlockFirst of [true, false]) {
            const coordinator = makeCoordinator();
            const ownerId = await coordinator.getExecution(0);
            let contender: Promise<number>;
            if (unlockFirst) {
                setTimeout(() => coordinator.unLockExecution(ownerId), 10);
                contender = coordinator.getExecution(0, 10);
            } else {
                contender = coordinator.getExecution(0, 10);
                setTimeout(() => coordinator.unLockExecution(ownerId), 10);
            }
            const result = contender.then(
                id => ({ id, status: 'fulfilled' as const }),
                error => ({ message: (error as Error).message, status: 'rejected' as const }),
            );

            await vi.advanceTimersByTimeAsync(10);

            if (unlockFirst) {
                const granted = await result;
                expect(granted.status).toBe('fulfilled');
                if (granted.status === 'fulfilled') coordinator.unLockExecution(granted.id);
            } else {
                await expect(result).resolves.toEqual({ message: 'GetExecutionTimeoutError', status: 'rejected' });
            }

            const successorId = await coordinator.getExecution(0, 1);
            coordinator.unLockExecution(successorId);
            expect(vi.getTimerCount()).toBe(0);
            expect(listenerCount(coordinator)).toBe(0);
        }
    });

    it('[RM-8.16] uses collision-free safe-integer IDs instead of time or randomness', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const coordinator = makeCoordinator();
        const firstId = await coordinator.getExecution(0);
        const second = coordinator.getExecution(0);

        coordinator.unLockExecution(firstId);
        const secondId = await second;

        expect(firstId).toBe(1);
        expect(secondId).toBe(2);
        expect(secondId).not.toBe(firstId);
        expect(Number.isSafeInteger(firstId)).toBe(true);
        expect(Number.isSafeInteger(secondId)).toBe(true);
        coordinator.unLockExecution(secondId);
    });

    it('[RM-8.16] wraps and skips IDs still held by an owner after expired waiters are removed', async () => {
        vi.useFakeTimers();
        const coordinator = makeCoordinator(3);
        const firstId = await coordinator.getExecution(0);
        coordinator.unLockExecution(firstId);
        const secondId = await coordinator.getExecution(0);
        coordinator.unLockExecution(secondId);
        const ownerId = await coordinator.getExecution(0);
        expect(ownerId).toBe(3);

        const expiredFirst = coordinator.getExecution(0, 10);
        const expiredSecond = coordinator.getExecution(0, 10);
        const expiredFirstResult = expect(expiredFirst).rejects.toThrow('GetExecutionTimeoutError');
        const expiredSecondResult = expect(expiredSecond).rejects.toThrow('GetExecutionTimeoutError');
        await vi.advanceTimersByTimeAsync(10);
        await expiredFirstResult;
        await expiredSecondResult;

        const wrapped = coordinator.getExecution(0);
        coordinator.unLockExecution(ownerId);
        await expect(wrapped).resolves.toBe(1);
        coordinator.unLockExecution(1);
    });

    it('[RM-8.16] queues same-priority all-ID allocation requests FIFO and resumes them on exact release', async () => {
        const coordinator = makeCoordinator(2);
        const ownerId = await coordinator.getExecution(0);
        const assignedWaiter = coordinator.getExecution(0);
        const firstAllocating = coordinator.getExecution(0);
        const secondAllocating = coordinator.getExecution(0);
        const firstGranted = vi.fn();
        const secondGranted = vi.fn();
        void firstAllocating.then(firstGranted);
        void secondAllocating.then(secondGranted);

        await Promise.resolve();
        expect(firstGranted).not.toHaveBeenCalled();
        expect(secondGranted).not.toHaveBeenCalled();

        coordinator.unLockExecution(ownerId);
        const assignedWaiterId = await assignedWaiter;
        expect(assignedWaiterId).toBe(2);
        coordinator.unLockExecution(assignedWaiterId);

        const firstAllocatedId = await firstAllocating;
        expect(firstAllocatedId).toBe(1);
        expect(secondGranted).not.toHaveBeenCalled();
        coordinator.unLockExecution(firstAllocatedId);

        await expect(secondAllocating).resolves.toBe(2);
        coordinator.unLockExecution(2);
    });

    it('[RM-8.9/RM-8.15/RM-8.16] assigns an ID freed by a timed-out waiter to the older same-priority allocator', async () => {
        vi.useFakeTimers();
        const coordinator = makeCoordinator(2);
        const ownerId = await coordinator.getExecution(0);
        const timedOutWaiter = coordinator.getExecution(0, 10);
        const timedOutResult = timedOutWaiter.then(
            () => ({ status: 'fulfilled' as const }),
            error => ({ message: (error as Error).message, status: 'rejected' as const }),
        );
        const olderAllocator = coordinator.getExecution(0, 100);
        const grants: Array<{ request: 'older' | 'later'; id: number }> = [];
        void olderAllocator.then(id => grants.push({ request: 'older', id }));

        await vi.advanceTimersByTimeAsync(10);
        await expect(timedOutResult).resolves.toEqual({ message: 'GetExecutionTimeoutError', status: 'rejected' });

        const laterRequest = coordinator.getExecution(0, 100);
        void laterRequest.then(id => grants.push({ request: 'later', id }));
        coordinator.unLockExecution(ownerId);
        await Promise.resolve();
        coordinator.unLockExecution(grants[0].id);
        await Promise.resolve();
        coordinator.unLockExecution(grants[1].id);
        await Promise.resolve();

        expect(grants).toEqual([
            { request: 'older', id: 2 },
            { request: 'later', id: 1 },
        ]);
        expect(vi.getTimerCount()).toBe(0);
        expect(listenerCount(coordinator)).toBe(0);
    });

    it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
        '[RM-8.16] rejects unsafe test-only maxExecutionId values: %s',
        maxExecutionId => {
            expect(() => makeCoordinator(maxExecutionId)).toThrow('ExecutionManagementMaxIdError');
        },
    );

    it('[RM-8.16] accepts the minimum test-only maxExecutionId and reuses its only ID after release', async () => {
        vi.useFakeTimers();
        const coordinator = makeCoordinator(1);

        const firstId = await coordinator.getExecution(0);
        coordinator.unLockExecution(firstId);
        const secondId = await coordinator.getExecution(0);
        coordinator.unLockExecution(secondId);

        expect(firstId).toBe(1);
        expect(secondId).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
        expect(listenerCount(coordinator)).toBe(0);
    });

    it.each(['granted', 'overdue'])(
        '[RM-8.16] treats a %s id as still held when checking id reuse',
        async state => {
            vi.useFakeTimers();
            const coordinator = makeCoordinator(1);
            const internals = resources(coordinator) as unknown as {
                exeQueue: Array<{ id: number | null; state: string }>;
            };

            // No entry ever actually sits in `exeQueue` with state 'granted'/'overdue' (grantNext()
            // always shifts an entry out of exeQueue before setting either state) -- this directly
            // exercises `isIdHoldingState`'s 'granted'/'overdue' arms the same way the surrounding
            // 'waiting' arm is exercised by every other allocation test in this file. Pushing it
            // straight into exeQueue (bypassing enqueueWaiting) also means the very next
            // getExecution() call's own grantNext() will shift and discard it as a stale, non-
            // 'waiting' entry -- exactly the skip covered by the dedicated grantNext test below --
            // so nothing here still blocks id 1 by the time this call resolves.
            internals.exeQueue.push({ id: 1, state });
            const blocked = coordinator.getExecution(0);
            const settled = vi.fn();
            void blocked.then(settled);
            await Promise.resolve();
            expect(settled).not.toHaveBeenCalled();

            const granted = await coordinator.getExecution(0);
            expect(granted).toBe(1);
            coordinator.unLockExecution(granted);
        },
    );

    it('[RM-8.16] skips a stale non-waiting entry left in exeQueue and grants the next real waiter', async () => {
        const coordinator = makeCoordinator();
        const internals = resources(coordinator) as unknown as {
            exeQueue: Array<{ id: number | null; state: string }>;
        };

        // `grantNext` only ever shifts entries it itself enqueued in the 'waiting' state; this
        // injects a queue entry no production code path can leave behind, to exercise the
        // defensive skip-and-retry branch directly.
        internals.exeQueue.push({ id: 999, state: 'expired' });

        const id = await coordinator.getExecution(0);

        expect(id).not.toBe(999);
        expect(internals.exeQueue).toEqual([]);
        coordinator.unLockExecution(id);
    });

    it('[RM-8.16] skips a stale non-allocating entry left in allocationQueue and assigns the next real waiter', async () => {
        const coordinator = makeCoordinator(1);
        const internals = resources(coordinator) as unknown as {
            allocationQueue: Array<{ id: number | null; state: string }>;
        };
        const ownerId = await coordinator.getExecution(0);
        const waiting = coordinator.getExecution(0);
        const waitingGranted = vi.fn();
        void waiting.then(waitingGranted);
        await Promise.resolve();
        expect(waitingGranted).not.toHaveBeenCalled();

        // `assignAllocationWaiters` only ever shifts entries it itself enqueued in the 'allocating'
        // state; this injects a queue entry no production code path can leave behind, to exercise
        // the defensive skip branch directly.
        internals.allocationQueue.unshift({ id: null, state: 'expired' });

        coordinator.unLockExecution(ownerId);

        const waitingId = await waiting;
        expect(waitingId).toBe(1);
        coordinator.unLockExecution(waitingId);
    });

    it('[RM-8.9/RM-8.16] grants allocation waiters by priority and keeps equal priorities FIFO', async () => {
        const coordinator = makeCoordinator(2);
        const ownerId = await coordinator.getExecution(0);
        const assignedWaiter = coordinator.getExecution(0);
        const firstHighest = coordinator.getExecution(2);
        const lower = coordinator.getExecution(1);
        const secondHighest = coordinator.getExecution(2);
        const grants: string[] = [];
        void firstHighest.then(() => grants.push('first-highest'));
        void lower.then(() => grants.push('lower'));
        void secondHighest.then(() => grants.push('second-highest'));

        try {
            coordinator.unLockExecution(ownerId);
            await Promise.resolve();
            expect(grants).toEqual(['first-highest']);

            coordinator.unLockExecution(1);
            await Promise.resolve();
            expect(grants).toEqual(['first-highest', 'second-highest']);
        } finally {
            coordinator.unLockExecution(1);
            await Promise.resolve();
            coordinator.unLockExecution(1);
            await Promise.resolve();
            coordinator.unLockExecution(2);
            await Promise.resolve();
        }

        await expect(assignedWaiter).resolves.toBe(2);
    });

    it("[RM-8.15/RM-8.16] keeps an allocating waiter's original deadline after it receives an ID", async () => {
        vi.useFakeTimers();
        const coordinator = makeCoordinator(2);
        const ownerId = await coordinator.getExecution(0);
        const assignedWaiter = coordinator.getExecution(0);
        const allocating = coordinator.getExecution(0, 10);
        const allocatingResult = expect(allocating).rejects.toThrow('GetExecutionTimeoutError');

        await vi.advanceTimersByTimeAsync(9);
        coordinator.unLockExecution(ownerId);
        const assignedWaiterId = await assignedWaiter;
        expect(assignedWaiterId).toBe(2);

        await vi.advanceTimersByTimeAsync(1);
        await allocatingResult;
        coordinator.unLockExecution(assignedWaiterId);

        expect(vi.getTimerCount()).toBe(0);
        expect(listenerCount(coordinator)).toBe(0);
    });

    it('[RM-8.15/RM-8.16] expires an allocating waiter by identity and never assigns it a later ID', async () => {
        vi.useFakeTimers();
        const coordinator = makeCoordinator(2);
        const ownerId = await coordinator.getExecution(0);
        const assignedWaiter = coordinator.getExecution(0);
        const expiredAllocating = coordinator.getExecution(0, 10);
        const survivingAllocating = coordinator.getExecution(0, 60);
        const expiredResult = expect(expiredAllocating).rejects.toThrow('GetExecutionTimeoutError');

        await vi.advanceTimersByTimeAsync(10);
        await expiredResult;

        coordinator.unLockExecution(ownerId);
        const assignedWaiterId = await assignedWaiter;
        expect(assignedWaiterId).toBe(2);
        coordinator.unLockExecution(assignedWaiterId);

        await expect(survivingAllocating).resolves.toBe(1);
        coordinator.unLockExecution(1);
        expect(vi.getTimerCount()).toBe(0);
        expect(listenerCount(coordinator)).toBe(0);
    });

    it('[RM-8.16] ignores an expire timeout firing for an entry that already left allocating/waiting', async () => {
        const coordinator = makeCoordinator();
        const internals = resources(coordinator) as unknown as {
            exeQueue: Array<{ state: string }>;
            expire: (entry: { state: string }) => void;
        };
        const ownerId = await coordinator.getExecution(0);
        const waiting = coordinator.getExecution(0);
        await Promise.resolve();
        const [waitingEntry] = internals.exeQueue;
        expect(waitingEntry.state).toBe('waiting');

        // `grant()` always clearTimeout()s an entry's own expire timer before changing its state,
        // so no production sequence can reach expire() once an entry has left allocating/waiting;
        // this drives the guard directly, the same way the invalid-owner-state guard above is
        // driven directly rather than raced through real timers.
        waitingEntry.state = 'granted';
        expect(() => internals.expire(waitingEntry)).not.toThrow();
        expect(internals.exeQueue).toContain(waitingEntry);

        waitingEntry.state = 'waiting';
        coordinator.unLockExecution(ownerId);
        const waitingId = await waiting;
        coordinator.unLockExecution(waitingId);
    });

    it('[RM-8.18] ignores an owner watchdog firing after the owner reference changed without releasing its timer', async () => {
        vi.useFakeTimers();
        const overdueLog = vi.fn();
        const coordinator = new ExecutionManagementModel(
            { getLogger: () => ({ system: { error: overdueLog } }) },
            undefined,
            true,
        );
        const internals = resources(coordinator) as unknown as { owner: { state: string } | null };
        await coordinator.getExecution(0);
        const grantedEntry = internals.owner;
        expect(grantedEntry).not.toBeNull();

        // unLockExecution always clearOwnerWatchdog()s before changing `owner`, so no production
        // sequence leaves this timer pending once the owner reference has moved on; this bypasses
        // unLockExecution to drive the guard directly instead.
        internals.owner = null;
        await vi.advanceTimersByTimeAsync(600_000);

        expect(overdueLog).not.toHaveBeenCalled();
        expect(grantedEntry?.state).toBe('granted');
    });
});
