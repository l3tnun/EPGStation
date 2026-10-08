import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStorageManager, deferred, settleMicrotasks, syntheticSpawnResult } from './_storage-harness';

afterEach(() => {
    vi.useRealTimers();
});

describe('storage monitoring local failure and stop characterization', () => {
    it('[SM-5.1][SM-5.2][SM-5.3] clears only the interval, returns synchronously, and lets a started read settle', async () => {
        vi.useFakeTimers();
        const pendingRead = deferred<number>();
        const { manager } = createStorageManager({
            entries: [{ limitThreshold: 1, name: 'pending', path: 'synthetic-storage/pending' }],
        });
        const reads = vi.fn(() => pendingRead.promise);
        manager.getFreeSize = reads;

        manager.start();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(reads).toHaveBeenCalledOnce();
        expect(manager.isRunning).toBe(true);

        const returnValue = manager.stop();
        expect(returnValue).toBeUndefined();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(reads).toHaveBeenCalledOnce();
        expect(manager.isRunning).toBe(true);

        pendingRead.resolve(2 * 1024 * 1024);
        await settleMicrotasks();
        expect(manager.isRunning).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[SM-5.3-DELETE] does not cancel or await a started deletion and permits its normal post-stop settlement', async () => {
        vi.useFakeTimers();
        const pendingDelete = deferred<void>();
        const { deleteRecorded, manager } = createStorageManager({
            deleteRecorded: () => pendingDelete.promise,
            entries: [
                {
                    action: 'remove',
                    limitThreshold: 1,
                    name: 'deleting',
                    path: 'synthetic-storage/deleting',
                },
            ],
            findOld: async () => ({ id: 71 }),
        });
        const reads = vi
            .fn<(path: string) => Promise<number>>()
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(2 * 1024 * 1024);
        manager.getFreeSize = reads;

        manager.start();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(deleteRecorded).toHaveBeenCalledWith(71);

        manager.stop();
        expect(manager.isRunning).toBe(true);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(deleteRecorded).toHaveBeenCalledOnce();

        pendingDelete.resolve();
        await vi.advanceTimersByTimeAsync(100);
        expect(reads).toHaveBeenCalledTimes(2);
        expect(manager.isRunning).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[SM-5.4] continues command deadline supervision after the periodic monitor is stopped', async () => {
        vi.useFakeTimers();
        const child = syntheticSpawnResult(false);
        const spawn = vi.fn(() => child);
        const entry = {
            action: 'none' as const,
            limitCmd: '%NODE%',
            limitThreshold: 1,
            name: 'stop-supervision',
            path: 'synthetic-storage/stop-supervision',
        };
        const { manager } = createStorageManager({
            entries: [entry],
            intervalSeconds: 1,
            spawn,
            storageLimitCommandTimeoutMs: 10,
        });
        manager.getFreeSize = vi.fn(async () => 0);

        manager.start();
        await vi.advanceTimersByTimeAsync(1_000);
        child.emit('spawn');
        manager.stop();
        await vi.advanceTimersByTimeAsync(10);
        expect(child.kill).toHaveBeenCalledWith('SIGKILL');
        expect(manager.isRunning).toBe(true);

        child.emit('close', null, 'SIGKILL');
        await settleMicrotasks();
        expect(manager.isRunning).toBe(false);
    });
});
