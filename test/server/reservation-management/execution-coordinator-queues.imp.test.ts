import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Coordinator = {
    getExecution(priority: number, timeout?: number): Promise<number>;
    unLockExecution(id: number): void;
};

interface QueueEntry {
    id: number | null;
    state: string;
}

interface CoordinatorInternals {
    allocationQueue: QueueEntry[];
    exeQueue: QueueEntry[];
}

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');
const ExecutionManagementModel = (
    require(join(snapshot, 'model', 'ExecutionManagementModel.js')) as {
        default: new (
            logger: { getLogger(): { system: { error: (message: string) => void } } },
            maxExecutionId?: number,
            reservationOwnerWatchdog?: boolean,
        ) => Coordinator;
    }
).default;

const makeCoordinator = (maxExecutionId?: number): Coordinator =>
    new ExecutionManagementModel({ getLogger: () => ({ system: { error: vi.fn() } }) }, maxExecutionId);

const internalsOf = (coordinator: Coordinator): CoordinatorInternals => coordinator as unknown as CoordinatorInternals;

const flushMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

afterEach(() => {
    vi.useRealTimers();
});

describe('execution coordinator waiting queues', () => {
    it('[RM-8.15] gives a request without an explicit timeout a 60 second deadline', async () => {
        vi.useFakeTimers();
        const coordinator = makeCoordinator();
        const ownerId = await coordinator.getExecution(0);
        const waiting = coordinator.getExecution(0);
        const outcome = vi.fn();
        waiting.then(
            () => outcome('granted'),
            (error: Error) => outcome(error.message),
        );

        await vi.advanceTimersByTimeAsync(59_999);
        expect(outcome).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(outcome).toHaveBeenCalledExactlyOnceWith('GetExecutionTimeoutError');
        coordinator.unLockExecution(ownerId);
    });

    it('[RM-8.16] resolves only the head waiter with its own ID when several requests wait for the lock', async () => {
        const coordinator = makeCoordinator();
        const ownerId = await coordinator.getExecution(0);
        const first = coordinator.getExecution(0);
        const second = coordinator.getExecution(0);
        const firstGranted = vi.fn();
        const secondGranted = vi.fn();
        void first.then(firstGranted);
        void second.then(secondGranted);

        coordinator.unLockExecution(ownerId);
        await flushMicrotasks();

        expect(firstGranted).toHaveBeenCalledExactlyOnceWith(2);
        expect(secondGranted).not.toHaveBeenCalled();

        coordinator.unLockExecution(2);
        await flushMicrotasks();

        expect(secondGranted).toHaveBeenCalledExactlyOnceWith(3);
        coordinator.unLockExecution(3);
    });

    it('[RM-8.15] removes an expired waiting request from the lock queue', async () => {
        vi.useFakeTimers();
        const coordinator = makeCoordinator();
        const ownerId = await coordinator.getExecution(0);
        const expired = coordinator.getExecution(0, 10);
        const expiredResult = expect(expired).rejects.toThrow('GetExecutionTimeoutError');
        const [expiredEntry] = internalsOf(coordinator).exeQueue;
        expect(expiredEntry.state).toBe('waiting');

        await vi.advanceTimersByTimeAsync(10);
        await expiredResult;

        expect(internalsOf(coordinator).exeQueue).not.toContain(expiredEntry);
        expect(expiredEntry.state).toBe('expired');
        coordinator.unLockExecution(ownerId);
    });

    it('[RM-8.15] removes an expired allocating request from the allocation queue', async () => {
        vi.useFakeTimers();
        const coordinator = makeCoordinator(1);
        const ownerId = await coordinator.getExecution(0);
        const expired = coordinator.getExecution(0, 10);
        const expiredResult = expect(expired).rejects.toThrow('GetExecutionTimeoutError');
        const [expiredEntry] = internalsOf(coordinator).allocationQueue;
        expect(expiredEntry.state).toBe('allocating');

        await vi.advanceTimersByTimeAsync(10);
        await expiredResult;

        expect(internalsOf(coordinator).allocationQueue).not.toContain(expiredEntry);
        coordinator.unLockExecution(ownerId);
    });

    it('[RM-8.15] keeps the other queued requests when one request expires', async () => {
        vi.useFakeTimers();
        const coordinator = makeCoordinator();
        const ownerId = await coordinator.getExecution(0);
        const survivor = coordinator.getExecution(0, 100);
        const expired = coordinator.getExecution(0, 10);
        const expiredResult = expect(expired).rejects.toThrow('GetExecutionTimeoutError');
        const [survivorEntry] = internalsOf(coordinator).exeQueue;

        await vi.advanceTimersByTimeAsync(10);
        await expiredResult;

        expect(internalsOf(coordinator).exeQueue).toEqual([survivorEntry]);
        coordinator.unLockExecution(ownerId);
        const survivorId = await survivor;
        coordinator.unLockExecution(survivorId);
    });

    it('[RM-8.16] does not treat the ID of an expired queue entry as held', async () => {
        const coordinator = makeCoordinator(1);
        // No production path leaves an expired entry in the lock queue; inject one to drive the
        // check that decides which entries still hold their ID.
        internalsOf(coordinator).exeQueue.push({ id: 1, state: 'expired' });

        const settled = vi.fn();
        void coordinator.getExecution(0).then(settled);
        await flushMicrotasks();

        expect(settled).toHaveBeenCalledExactlyOnceWith(1);
        coordinator.unLockExecution(1);
    });

    it('[RM-8.16] skips a stale waiting entry that holds no ID and grants the next real waiter', async () => {
        const coordinator = makeCoordinator();
        // A waiting entry always has an ID in production; inject one without to drive the guard.
        internalsOf(coordinator).exeQueue.push({ id: null, state: 'waiting' });

        const settled = vi.fn();
        void coordinator.getExecution(0).then(settled);
        await flushMicrotasks();

        expect(settled).toHaveBeenCalledOnce();
        coordinator.unLockExecution(settled.mock.calls[0][0] as number);
    });
});
