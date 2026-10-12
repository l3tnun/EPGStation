import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStorageManager, deferred, settleMicrotasks } from './_storage-harness';

const WATCHDOG_MS = 600_000;
const ENOUGH_BYTES = 2 * 1024 * 1024;

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('storage entry monitoring ownership: entry identity, same path, stop, overdue, late settlement', () => {
    it('[SM-2.4] ignores a direct unmonitored entry while starting the monitored entry', async () => {
        const entries = [
            { action: 'none' as const, name: 'unmonitored', path: 'synthetic-storage/unmonitored' },
            { action: 'none' as const, limitThreshold: 0, name: 'monitored', path: 'synthetic-storage/monitored' },
        ];
        const { manager } = createStorageManager({ entries });
        const reads = vi.fn(async () => ENOUGH_BYTES);
        manager.getFreeSize = reads;

        await manager.check(entries);

        expect(reads).toHaveBeenCalledOnce();
        expect(reads).toHaveBeenCalledWith('synthetic-storage/monitored');
    });

    it('[SM-2.4] assigns snapshot-indexed opaque identities and stable fallback identities', async () => {
        const configuredEntries = [
            { action: 'none' as const, limitThreshold: 0, name: 'configured-a', path: 'synthetic-storage/shared' },
            { action: 'none' as const, limitThreshold: 0, name: 'configured-b', path: 'synthetic-storage/shared' },
        ];
        const { manager } = createStorageManager({ entries: configuredEntries });
        manager.getFreeSize = vi.fn(async () => ENOUGH_BYTES);
        const internals = manager as unknown as {
            entryIds: Map<object, Array<{ identity: symbol; snapshotIndex: number }>>;
        };
        const configuredEntryIds = [...internals.entryIds.values()].flat();

        expect(configuredEntryIds).toEqual([
            { identity: expect.any(Symbol), snapshotIndex: 0 },
            { identity: expect.any(Symbol), snapshotIndex: 1 },
        ]);
        expect(new Set(configuredEntryIds.map(({ identity }) => identity)).size).toBe(2);

        const fallbackA = {
            action: 'none' as const,
            limitThreshold: 0,
            name: 'fallback-a',
            path: 'synthetic-storage/a',
        };
        const fallbackB = {
            action: 'none' as const,
            limitThreshold: 0,
            name: 'fallback-b',
            path: 'synthetic-storage/b',
        };
        await manager.check([fallbackA, fallbackB]);
        expect([
            internals.entryIds.get(fallbackA)?.[0].snapshotIndex,
            internals.entryIds.get(fallbackB)?.[0].snapshotIndex,
        ]).toEqual([-1, -2]);
        expect(internals.entryIds.get(fallbackA)?.[0].identity).not.toBe(
            internals.entryIds.get(fallbackB)?.[0].identity,
        );
    });

    it('[SM-2.4] creates only the requested sparse fallback identity and reuses it', () => {
        const { manager } = createStorageManager({ entries: [] });
        const internals = manager as unknown as {
            entryIds: Map<object, Array<{ identity: symbol; snapshotIndex: number }>>;
            fallbackEntryIndex: number;
            getEntryId: (entry: object, occurrenceIndex: number) => { identity: symbol; snapshotIndex: number };
        };
        const entry = {
            action: 'none' as const,
            limitThreshold: 0,
            name: 'sparse-fallback',
            path: 'synthetic-storage/sparse-fallback',
        };

        const created = internals.getEntryId(entry, 3);

        expect(created.snapshotIndex).toBe(-1);
        expect(internals.fallbackEntryIndex).toBe(-2);
        expect(Object.keys(internals.entryIds.get(entry)!)).toEqual(['3']);
        expect(internals.entryIds.get(entry)?.[3]).toBe(created);
        expect(internals.getEntryId(entry, 3)).toBe(created);
        expect(internals.fallbackEntryIndex).toBe(-2);
    });

    it('[SM-2.4][SM-2.11] owns repeated snapshot occurrences independently with stable identities', async () => {
        const firstRead = deferred<number>();
        const secondRead = deferred<number>();
        const sharedEntry = {
            action: 'none' as const,
            limitThreshold: 0,
            name: 'shared-reference',
            path: 'synthetic-storage/shared-reference',
        };
        const { manager } = createStorageManager({ entries: [sharedEntry, sharedEntry] });
        const reads = vi
            .fn<(path: string) => Promise<number>>()
            .mockImplementationOnce(() => firstRead.promise)
            .mockImplementationOnce(() => secondRead.promise)
            .mockResolvedValue(ENOUGH_BYTES);
        manager.getFreeSize = reads;
        const internals = manager as unknown as {
            activeOperations: Map<{ identity: symbol; snapshotIndex: number }, object>;
            entryIds: Map<object, Array<{ identity: symbol; snapshotIndex: number }>>;
        };

        const firstTick = manager.check([sharedEntry, sharedEntry]);
        await settleMicrotasks();

        expect(reads).toHaveBeenCalledTimes(2);
        const entryIds = internals.entryIds.get(sharedEntry)!;
        expect(entryIds.map(({ snapshotIndex }) => snapshotIndex)).toEqual([0, 1]);
        expect(entryIds[0].identity).not.toBe(entryIds[1].identity);
        expect(internals.activeOperations.has(entryIds[0])).toBe(true);
        expect(internals.activeOperations.has(entryIds[1])).toBe(true);

        firstRead.resolve(ENOUGH_BYTES);
        await settleMicrotasks();
        expect(internals.activeOperations.has(entryIds[0])).toBe(false);
        expect(internals.activeOperations.has(entryIds[1])).toBe(true);
        expect(manager.isRunning).toBe(true);

        secondRead.resolve(ENOUGH_BYTES);
        await firstTick;
        expect(manager.isRunning).toBe(false);

        await manager.check([sharedEntry, sharedEntry]);
        expect(reads).toHaveBeenCalledTimes(4);
        expect(internals.entryIds.get(sharedEntry)?.[0]).toBe(entryIds[0]);
        expect(internals.entryIds.get(sharedEntry)?.[1]).toBe(entryIds[1]);
    });

    it('[SM-2.4][SM-2.9][SM-2.11] starts distinct entries without awaiting the preceding entry and releases only the settled entry', async () => {
        const firstRead = deferred<number>();
        const entries = [
            { action: 'none' as const, limitThreshold: 0, name: 'first', path: 'synthetic-storage/shared' },
            { action: 'none' as const, limitThreshold: 0, name: 'same-path', path: 'synthetic-storage/shared' },
            { action: 'none' as const, limitThreshold: 0, name: 'third', path: 'synthetic-storage/third' },
        ];
        const { manager } = createStorageManager({ entries });
        const reads = vi
            .fn<(path: string) => Promise<number>>()
            .mockImplementationOnce(() => firstRead.promise)
            .mockResolvedValue(ENOUGH_BYTES);
        manager.getFreeSize = reads;

        const firstTick = manager.check(entries);
        await settleMicrotasks();
        expect(reads.mock.calls.map(([path]) => path)).toEqual([
            'synthetic-storage/shared',
            'synthetic-storage/shared',
            'synthetic-storage/third',
        ]);

        await settleMicrotasks();
        await manager.check(entries);
        expect(reads.mock.calls.map(([path]) => path)).toEqual([
            'synthetic-storage/shared',
            'synthetic-storage/shared',
            'synthetic-storage/third',
            'synthetic-storage/shared',
            'synthetic-storage/third',
        ]);

        firstRead.resolve(ENOUGH_BYTES);
        await firstTick;
        await manager.check([entries[0]]);
        expect(reads).toHaveBeenCalledTimes(6);
        expect(manager.isRunning).toBe(false);
    });

    it('[SM-2.11] confines one entry rejection and release to its exact operation', async () => {
        const rejectedRead = deferred<number>();
        const entries = [
            { action: 'none' as const, limitThreshold: 0, name: 'rejected', path: 'synthetic-storage/rejected' },
            { action: 'none' as const, limitThreshold: 0, name: 'healthy', path: 'synthetic-storage/healthy' },
        ];
        const { manager } = createStorageManager({ entries });
        const reads = vi.fn((path: string) =>
            path === 'synthetic-storage/rejected' ? rejectedRead.promise : Promise.resolve(ENOUGH_BYTES),
        );
        manager.getFreeSize = reads;

        const tick = manager.check(entries);
        await settleMicrotasks();
        expect(reads).toHaveBeenCalledTimes(2);
        rejectedRead.reject(new Error('synthetic-capacity-rejection'));
        await tick;

        await manager.check(entries);
        expect(reads).toHaveBeenCalledTimes(4);
        expect(manager.isRunning).toBe(false);
    });

    it('[SM-2.11] prevents an old settlement callback from releasing a replacement generation', async () => {
        const read = deferred<number>();
        const entry = {
            action: 'none' as const,
            limitThreshold: 0,
            name: 'generation',
            path: 'synthetic-storage/generation',
        };
        const { manager } = createStorageManager({ entries: [entry] });
        manager.getFreeSize = vi.fn(() => read.promise);
        const internals = manager as unknown as {
            activeOperations: Map<object, object>;
            entryIds: Map<object, object[]>;
        };

        const oldOperation = manager.check([entry]);
        await settleMicrotasks();
        const entryId = internals.entryIds.get(entry)?.[0];
        expect(entryId).toBeDefined();
        const replacement = {};
        internals.activeOperations.set(entryId!, replacement);
        read.resolve(ENOUGH_BYTES);
        await oldOperation;

        expect(internals.activeOperations.get(entryId!)).toBe(replacement);
        expect(manager.isRunning).toBe(true);
        internals.activeOperations.delete(entryId!);
        expect(manager.isRunning).toBe(false);
    });

    it('[SM-2.12] prevents an old watchdog from marking a replacement generation overdue', async () => {
        vi.useFakeTimers();
        const read = deferred<number>();
        const entry = {
            action: 'none' as const,
            limitThreshold: 0,
            name: 'stale-watchdog',
            path: 'synthetic-storage/stale',
        };
        const { logger, manager } = createStorageManager({ entries: [entry] });
        manager.getFreeSize = vi.fn(() => read.promise);
        const internals = manager as unknown as {
            activeOperations: Map<object, object>;
            entryIds: Map<object, object[]>;
        };

        const oldOperation = manager.check([entry]);
        await vi.advanceTimersByTimeAsync(0);
        const entryId = internals.entryIds.get(entry)![0];
        const original = internals.activeOperations.get(entryId)!;
        internals.activeOperations.set(entryId, {});
        await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
        expect(logger.system.error).not.toHaveBeenCalledWith(`storage operation overdue: capacity: ${entry.name}`);

        internals.activeOperations.set(entryId, original);
        read.resolve(ENOUGH_BYTES);
        await oldOperation;
        expect(manager.isRunning).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[SM-2.11][SM-2.12] clears the watchdog and exact ownership after a synchronous stage failure', async () => {
        vi.useFakeTimers();
        const entry = {
            action: 'none' as const,
            limitThreshold: 0,
            name: 'sync-failure',
            path: 'synthetic-storage/sync',
        };
        const { logger, manager } = createStorageManager({ entries: [entry] });
        const sentinel = new Error('synthetic-synchronous-stage-failure');
        manager.getFreeSize = vi.fn(() => {
            throw sentinel;
        });

        await manager.check([entry]);

        expect(logger.system.error).toHaveBeenCalledWith(sentinel);
        expect(manager.isRunning).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });
});

type Stage = 'capacity' | 'use-snapshot' | 'candidate' | 'delete' | 're-read';

const createStageScenario = (stage: Stage) => {
    const gate = deferred<number | { id: number } | { status: 'unknown' } | null | void>();
    const stageEntry = {
        action: 'remove' as const,
        limitThreshold: 1,
        name: `${stage}-entry`,
        path: `synthetic-storage/${stage}`,
    };
    const probeEntry = {
        action: 'none' as const,
        limitThreshold: 0,
        name: 'probe-entry',
        path: 'synthetic-storage/probe',
    };
    let stageCapacityReads = 0;
    const harness = createStorageManager({
        deleteRecorded: async () => {
            if (stage === 'delete') await gate.promise;
        },
        entries: [stageEntry, probeEntry],
        getSnapshot: async () => {
            if (stage === 'use-snapshot') {
                return (await gate.promise) as { status: 'unknown' };
            }
            return { recordedIds: new Set<number>(), status: 'known' as const };
        },
        findOld: async () => {
            if (stage === 'candidate') return (await gate.promise) as { id: number } | null;
            return { id: 41 };
        },
    });
    const reads = vi.fn(async (path: string) => {
        if (path === probeEntry.path) return ENOUGH_BYTES;
        stageCapacityReads += 1;
        if (stage === 'capacity' && stageCapacityReads === 1) return (await gate.promise) as number;
        if (stage === 're-read' && stageCapacityReads === 2) return (await gate.promise) as number;
        return stageCapacityReads === 1 ? 0 : ENOUGH_BYTES;
    });
    harness.manager.getFreeSize = reads;
    return {
        ...harness,
        gate,
        probeEntry,
        reads,
        stageEntry,
        targetCallCount: () => {
            if (stage === 'use-snapshot') return harness.getSnapshot.mock.calls.length;
            if (stage === 'candidate') return harness.findOld.mock.calls.length;
            if (stage === 'delete') return harness.deleteRecorded.mock.calls.length;
            return reads.mock.calls.filter(([path]) => path === stageEntry.path).length;
        },
    };
};

const settleStage = (stage: Stage, scenario: ReturnType<typeof createStageScenario>, reject: boolean): void => {
    if (reject) {
        scenario.gate.reject(new Error(`synthetic-${stage}-rejection`));
        return;
    }
    if (stage === 'use-snapshot') {
        scenario.gate.resolve({ status: 'unknown' });
        return;
    }
    if (stage === 'candidate') {
        scenario.gate.resolve(null);
        return;
    }
    if (stage === 'delete') {
        scenario.gate.resolve(undefined);
        return;
    }
    scenario.gate.resolve(ENOUGH_BYTES);
};

// WATCHDOG_MS (600_000 / 600s) is STORAGE_OPERATION_WATCHDOG_MS
// (src/model/operator/storage/StorageManageModel.ts:15), a v3-only per-stage owner watchdog with
// no v2 counterpart -- approved in .kiro/specs/server-storage-management/design.md:865 (SM-2.12).
describe.each(['capacity', 'use-snapshot', 'candidate', 'delete', 're-read'] as const)(
    '%s stage ownership watchdog',
    stage => {
        it('[SM-2.12] clears the stage watchdog when the operation settles at 599,999 ms', async () => {
            vi.useFakeTimers();
            const scenario = createStageScenario(stage);
            const operation = scenario.manager.check([scenario.stageEntry]);
            await vi.advanceTimersByTimeAsync(0);

            await vi.advanceTimersByTimeAsync(WATCHDOG_MS - 1);
            settleStage(stage, scenario, stage === 'capacity' || stage === 'delete');
            await settleMicrotasks();
            if (stage === 'delete' || stage === 're-read') await vi.advanceTimersByTimeAsync(100);
            await operation;
            expect(vi.getTimerCount()).toBe(0);
            await vi.advanceTimersByTimeAsync(1);

            expect(scenario.logger.system.error).not.toHaveBeenCalledWith(
                `storage operation overdue: ${stage}: ${scenario.stageEntry.name}`,
            );
            expect(scenario.manager.isRunning).toBe(false);
        });

        it('[SM-2.10][SM-2.12] records overdue without retrying, releasing, or blocking another entry', async () => {
            vi.useFakeTimers();
            const scenario = createStageScenario(stage);
            const operation = scenario.manager.check([scenario.stageEntry, scenario.probeEntry]);
            await vi.advanceTimersByTimeAsync(0);
            const targetCalls = scenario.targetCallCount();

            await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
            expect(scenario.logger.system.error).toHaveBeenCalledWith(
                `storage operation overdue: ${stage}: ${scenario.stageEntry.name}`,
            );

            await scenario.manager.check([scenario.stageEntry, scenario.probeEntry]);
            expect(scenario.targetCallCount()).toBe(targetCalls);
            expect(scenario.reads.mock.calls.filter(([path]) => path === scenario.probeEntry.path)).toHaveLength(2);
            expect(scenario.manager.isRunning).toBe(true);

            settleStage(stage, scenario, stage === 'capacity' || stage === 'delete');
            await settleMicrotasks();
            if (stage === 'delete' || stage === 're-read') await vi.advanceTimersByTimeAsync(100);
            await operation;
            expect(scenario.targetCallCount()).toBe(targetCalls);
            expect(scenario.manager.isRunning).toBe(false);
            expect(vi.getTimerCount()).toBe(0);

            await scenario.manager.check([scenario.stageEntry]);
            expect(
                scenario.reads.mock.calls.filter(([path]) => path === scenario.stageEntry.path).length,
            ).toBeGreaterThan(stage === 're-read' ? 2 : 1);
        });

        it('[SM-2.12-DOMAIN-PROBE] keeps an independent domain probe running while the stage is overdue', async () => {
            vi.useFakeTimers();
            let domainRuns = 0;
            let domainContinuations = 0;
            const domainProbe = setInterval(() => {
                domainRuns += 1;
                void Promise.resolve().then(() => {
                    domainContinuations += 1;
                });
            }, 1_000);
            try {
                const scenario = createStageScenario(stage);
                const operation = scenario.manager.check([scenario.stageEntry, scenario.probeEntry]);
                await vi.advanceTimersByTimeAsync(0);

                await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
                const overdue = `storage operation overdue: ${stage}: ${scenario.stageEntry.name}`;
                expect(scenario.logger.system.error.mock.calls.filter(([message]) => message === overdue)).toHaveLength(
                    1,
                );
                expect(domainRuns).toBe(600);
                expect(domainContinuations).toBe(600);
                expect(scenario.manager.isRunning).toBe(true);

                await vi.advanceTimersByTimeAsync(10_000);
                expect(domainRuns).toBe(610);
                expect(domainContinuations).toBe(610);
                expect(scenario.reads.mock.calls.filter(([path]) => path === scenario.probeEntry.path)).toHaveLength(1);

                settleStage(stage, scenario, stage === 'capacity' || stage === 'delete');
                await settleMicrotasks();
                if (stage === 'delete' || stage === 're-read') await vi.advanceTimersByTimeAsync(100);
                await operation;
                expect(scenario.manager.isRunning).toBe(false);
            } finally {
                clearInterval(domainProbe);
            }
        });
    },
);
