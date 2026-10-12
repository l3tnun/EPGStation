import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStorageManager, deferred, settleMicrotasks, syntheticSpawnResult } from './_storage-harness';

const MEBIBYTE = 1024 * 1024;
const WATCHDOG_MS = 600_000;

afterEach(() => {
    vi.useRealTimers();
});

describe('storage monitoring interval characterization', () => {
    it('[SM-2.1][SM-2.8] monitors only threshold entries in configured order using seconds as milliseconds', async () => {
        vi.useFakeTimers();
        const entries = [
            { name: 'unmonitored-a', path: 'synthetic-storage/a' },
            { limitThreshold: 0, name: 'monitored-b', path: 'synthetic-storage/b' },
            { name: 'unmonitored-c', path: 'synthetic-storage/c' },
            { limitThreshold: 0, name: 'monitored-d', path: 'synthetic-storage/d' },
        ];
        const { manager } = createStorageManager({ entries, intervalSeconds: 2.5 });
        const reads = vi.fn<(path: string) => Promise<number>>(async () => 1024 * 1024);
        manager.getFreeSize = reads;

        manager.start();
        await vi.advanceTimersByTimeAsync(2_500);

        expect(reads.mock.calls.map(([path]) => path)).toEqual(['synthetic-storage/b', 'synthetic-storage/d']);
        manager.stop();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[SM-2.2] registers no interval and performs no read when no entry has a threshold', async () => {
        vi.useFakeTimers();
        const { manager } = createStorageManager({
            entries: [
                { name: 'plain-a', path: 'synthetic-storage/a' },
                { action: 'remove', name: 'plain-b', path: 'synthetic-storage/b' },
            ],
        });
        const reads = vi.fn(async () => 0);
        manager.getFreeSize = reads;

        manager.start();
        await vi.advanceTimersByTimeAsync(10_000);

        expect(reads).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[SM-2.3] performs no immediate read and starts the first read exactly at one interval', async () => {
        vi.useFakeTimers();
        const { manager } = createStorageManager({
            entries: [{ limitThreshold: 0, name: 'timed', path: 'synthetic-storage/timed' }],
            intervalSeconds: 3,
        });
        const reads = vi.fn(async () => 1024 * 1024);
        manager.getFreeSize = reads;

        manager.start();
        await settleMicrotasks();
        expect(reads).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(2_999);
        expect(reads).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(reads).toHaveBeenCalledOnce();

        manager.stop();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        ['above', 10 * 1024 * 1024 + 1, 0],
        ['equal', 10 * 1024 * 1024, 1],
        ['below without rounding', 10 * 1024 * 1024 - 1, 1],
    ] as const)(
        '[SM-2.5][SM-2.6] treats an available byte value %s the exact 10 MB threshold',
        async (_label, availableBytes, expectedCommandCalls) => {
            vi.useFakeTimers();
            const spawn = vi.fn((_bin: string, _args: readonly string[], _options: unknown) => syntheticSpawnResult());
            const { manager } = createStorageManager({
                entries: [
                    {
                        action: 'none',
                        limitCmd: '%NODE%',
                        limitThreshold: 10,
                        name: 'threshold',
                        path: 'synthetic-storage/threshold',
                    },
                ],
                spawn,
            });
            manager.getFreeSize = vi.fn(async () => availableBytes);

            manager.start();
            await vi.advanceTimersByTimeAsync(1_000);

            expect(spawn).toHaveBeenCalledTimes(expectedCommandCalls);
            manager.stop();
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('[SM-2.4][SM-2.9][SM-2.10][SM-2.11] keeps a pending entry isolated, starts the next entry, and releases only after settlement', async () => {
        const pending = deferred<number>();
        const first = { action: 'none' as const, limitThreshold: 1, name: 'first', path: 'synthetic-storage/first' };
        const second = {
            action: 'none' as const,
            limitThreshold: 1,
            name: 'second',
            path: 'synthetic-storage/second',
        };
        const { manager } = createStorageManager({ entries: [first, second] });
        const reads = vi.fn((path: string) => (path === first.path ? pending.promise : Promise.resolve(2 * MEBIBYTE)));
        manager.getFreeSize = reads;

        const firstCheck = manager.check([first, second]);
        await settleMicrotasks();
        expect(reads.mock.calls.map(([path]) => path)).toEqual([first.path, second.path]);
        expect(manager.isRunning).toBe(true);

        await manager.check([first, second]);
        expect(reads.mock.calls.map(([path]) => path)).toEqual([first.path, second.path, second.path]);

        pending.resolve(2 * MEBIBYTE);
        await firstCheck;
        expect(manager.isRunning).toBe(false);

        await manager.check([first]);
        expect(reads.mock.calls.filter(([path]) => path === first.path)).toHaveLength(2);
    });

    it('[SM-2.12] leaves an overdue entry active without retrying it while another entry continues until late settlement', async () => {
        vi.useFakeTimers();
        const pending = deferred<number>();
        const overdue = {
            action: 'none' as const,
            limitThreshold: 1,
            name: 'overdue',
            path: 'synthetic-storage/overdue',
        };
        const continuing = {
            action: 'none' as const,
            limitThreshold: 1,
            name: 'continuing',
            path: 'synthetic-storage/continuing',
        };
        const { logger, manager } = createStorageManager({ entries: [overdue, continuing] });
        const reads = vi.fn((path: string) =>
            path === overdue.path ? pending.promise : Promise.resolve(2 * MEBIBYTE),
        );
        manager.getFreeSize = reads;

        const firstCheck = manager.check([overdue, continuing]);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
        expect(logger.system.error).toHaveBeenCalledWith(`storage operation overdue: capacity: ${overdue.name}`);
        expect(manager.isRunning).toBe(true);

        await manager.check([overdue, continuing]);
        expect(reads.mock.calls.filter(([path]) => path === overdue.path)).toHaveLength(1);
        expect(reads.mock.calls.filter(([path]) => path === continuing.path)).toHaveLength(2);

        pending.resolve(2 * MEBIBYTE);
        await firstCheck;
        expect(manager.isRunning).toBe(false);
    });

    it('[SM-2.7] logs one entry read failure and continues with the following configured entry', async () => {
        const { deleteRecorded, logger, manager } = createStorageManager();
        const failure = new Error('synthetic first storage read failure');
        const reads = vi
            .fn<(path: string) => Promise<number>>()
            .mockRejectedValueOnce(failure)
            .mockResolvedValueOnce(2 * 1024 * 1024);
        manager.getFreeSize = reads;
        const entries = [
            { action: 'remove' as const, limitThreshold: 1, name: 'failure', path: 'synthetic-storage/failure' },
            { action: 'remove' as const, limitThreshold: 1, name: 'following', path: 'synthetic-storage/following' },
        ];

        await manager.check(entries);

        expect(reads.mock.calls.map(([path]) => path)).toEqual([
            'synthetic-storage/failure',
            'synthetic-storage/following',
        ]);
        expect(deleteRecorded).not.toHaveBeenCalled();
        expect(logger.system.error).toHaveBeenCalledWith('get disk info error: synthetic-storage/failure');
        expect(logger.system.error).toHaveBeenCalledWith(failure);
    });
});
