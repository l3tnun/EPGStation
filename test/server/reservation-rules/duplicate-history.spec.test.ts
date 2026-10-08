import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    createDialectPersistence,
    type DatabaseDialect,
    makeProgram,
    makeReservationHarness,
    makeRule,
} from '../fixtures/reservation-rules/runtime';

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('recorded-history possible duplicate characterization', () => {
    it('[RR-5.1] preserves duplicate-avoidance configuration and its period on a saved Rule', async () => {
        const fixture = await createDialectPersistence('sqlite');
        try {
            await fixture.ruleDB.insertOnce(
                makeRule({
                    id: 19,
                    reserveOption: {
                        allowEndLack: false,
                        avoidDuplicate: true,
                        enable: true,
                        periodToAvoidDuplicate: 3,
                    },
                }),
            );

            await expect(fixture.ruleDB.findId(19)).resolves.toMatchObject({
                reserveOption: { avoidDuplicate: true, periodToAvoidDuplicate: 3 },
            });
        } finally {
            await fixture.cleanup();
        }
    });

    // Exercises both the sqlite and mysql dialects with real persistence fixtures in one case; that real
    // dual-dialect DB setup/teardown work reliably approaches Vitest's default 5000ms testTimeout under
    // full-suite contention, so this needs an explicit, generous budget.
    it('[RR-5.2] compares matching recorded history within the configured period', async () => {
        for (const dialect of ['sqlite', 'mysql'] as DatabaseDialect[]) {
            const fixtureStartedAt = Date.now();
            const fixture = await createDialectPersistence(dialect);
            console.error(`[timing] createDialectPersistence(${dialect}): ${Date.now() - fixtureStartedAt}ms`);
            try {
                vi.useFakeTimers();
                vi.setSystemTime(1_800_000_000_000);
                await fixture.source
                    .getRepository(fixture.Program)
                    .insert([
                        makeProgram({ id: 711, shortName: 'same', channelId: 101, endAt: 1_800_000_000_001 }),
                        makeProgram({ id: 712, shortName: 'different', channelId: 101, endAt: 1_800_000_000_001 }),
                        makeProgram({ id: 713, shortName: 'same', channelId: 202, endAt: 1_800_000_000_001 }),
                        makeProgram({ id: 714, shortName: 'same', channelId: 101, endAt: 1_800_345_600_000 }),
                    ]);
                await fixture.source.getRepository(fixture.RecordedHistory).insert([
                    { name: 'same', channelId: 101, endAt: 1_800_000_000_000 },
                    { name: 'different', channelId: 101, endAt: 1_800_000_000_001 },
                ]);
                const searchOption = { keyword: 'synthetic', name: true, channelIds: [101, 202] };
                await fixture.ruleDB.insertOnce(
                    makeRule({
                        id: 21,
                        searchOption,
                        reserveOption: { enable: true, allowEndLack: false, avoidDuplicate: false },
                    }),
                );
                await fixture.ruleDB.insertOnce(
                    makeRule({
                        id: 22,
                        searchOption,
                        reserveOption: { enable: true, allowEndLack: false, avoidDuplicate: true },
                    }),
                );
                await fixture.ruleDB.insertOnce(
                    makeRule({
                        id: 23,
                        searchOption,
                        reserveOption: {
                            enable: true,
                            allowEndLack: false,
                            avoidDuplicate: true,
                            periodToAvoidDuplicate: 3,
                        },
                    }),
                );

                const candidateWrites: Array<Array<{ isOverlap: boolean; programId: number }>> = [];
                const harness = makeReservationHarness({
                    programDB: fixture.programDB,
                    ruleDB: fixture.ruleDB,
                    reserveDB: {
                        findRuleId: vi.fn(async () => []),
                        findTimeRanges: vi.fn(async () => []),
                        updateMany: vi.fn(async diff => candidateWrites.push(diff.insert ?? [])),
                    },
                });

                await harness.model.updateRule(21);
                await harness.model.updateRule(22);
                await harness.model.updateRule(23);

                expect(candidateWrites).toHaveLength(3);
                expect(candidateWrites[0].map(({ programId, isOverlap }) => ({ programId, isOverlap }))).toEqual([
                    { programId: 711, isOverlap: false },
                    { programId: 712, isOverlap: false },
                    { programId: 713, isOverlap: false },
                    { programId: 714, isOverlap: false },
                ]);
                expect(candidateWrites[1].map(({ programId, isOverlap }) => ({ programId, isOverlap }))).toEqual([
                    { programId: 711, isOverlap: true },
                    { programId: 712, isOverlap: false },
                    { programId: 713, isOverlap: false },
                    { programId: 714, isOverlap: true },
                ]);
                expect(candidateWrites[2].map(({ programId, isOverlap }) => ({ programId, isOverlap }))).toEqual([
                    { programId: 711, isOverlap: true },
                    { programId: 712, isOverlap: false },
                    { programId: 713, isOverlap: false },
                    { programId: 714, isOverlap: false },
                ]);
                expect(harness.execution.unLockExecution).toHaveBeenCalledTimes(3);
            } finally {
                vi.useRealTimers();
                await fixture.cleanup();
            }
        }
    }, 20_000);

    it('[RR-5.3] forwards a possible-duplicate marker to the reservation candidate consumer', async () => {
        const fixture = await createDialectPersistence('sqlite');
        try {
            vi.useFakeTimers();
            vi.setSystemTime(1_800_000_000_000);
            await fixture.source
                .getRepository(fixture.Program)
                .insert(makeProgram({ id: 831, channelId: 101, endAt: 1_800_000_000_001, shortName: 'same' }));
            await fixture.source.getRepository(fixture.RecordedHistory).insert({
                channelId: 101,
                endAt: 1_800_000_000_000,
                name: 'same',
            });
            await fixture.ruleDB.insertOnce(
                makeRule({
                    id: 31,
                    reserveOption: {
                        allowEndLack: false,
                        avoidDuplicate: true,
                        enable: true,
                        periodToAvoidDuplicate: 3,
                    },
                    searchOption: { channelIds: [101], keyword: 'synthetic', name: true },
                }),
            );
            const writes: Array<Array<{ isOverlap: boolean }>> = [];
            const harness = makeReservationHarness({
                programDB: fixture.programDB,
                reserveDB: {
                    findRuleId: vi.fn(async () => []),
                    findTimeRanges: vi.fn(async () => []),
                    updateMany: vi.fn(async diff => writes.push(diff.insert ?? [])),
                },
                ruleDB: fixture.ruleDB,
            });

            await harness.model.updateRule(31);

            expect(writes).toEqual([[expect.objectContaining({ isOverlap: true })]]);
        } finally {
            await fixture.cleanup();
        }
    });

    it('[RR-5.4] rejects an actual candidate query before consumer writes and preserves history rows', async () => {
        const fixture = await createDialectPersistence('sqlite');
        try {
            const historyRepository = fixture.source.getRepository(fixture.RecordedHistory);
            await historyRepository.insert({ name: 'same', channelId: 101, endAt: 1_800_000_000_000 });
            await fixture.ruleDB.insertOnce(
                makeRule({
                    id: 24,
                    searchOption: { keyword: 'synthetic', name: true, channelIds: [101] },
                    reserveOption: { enable: true, allowEndLack: false, avoidDuplicate: true },
                }),
            );
            const savedRule = await fixture.ruleDB.findId(24, true);
            const before = await historyRepository.find({ order: { id: 'ASC' } });
            const updateMany = vi.fn(async () => undefined);
            const harness = makeReservationHarness({
                programDB: fixture.programDB,
                ruleDB: { findId: vi.fn(async () => savedRule) },
                reserveDB: {
                    findRuleId: vi.fn(async () => []),
                    findTimeRanges: vi.fn(async () => []),
                    updateMany,
                },
            });
            const sentinel = new Error('synthetic-history-query-failure');
            const createQueryRunner = vi.spyOn(fixture.source, 'createQueryRunner').mockImplementation(() => {
                throw sentinel;
            });

            await expect(harness.model.updateRule(24)).rejects.toBe(sentinel);
            expect(updateMany).not.toHaveBeenCalled();
            expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
            expect(harness.execution.unLockExecution).toHaveBeenCalledTimes(1);

            createQueryRunner.mockRestore();
            await expect(historyRepository.find({ order: { id: 'ASC' } })).resolves.toEqual(before);
        } finally {
            await fixture.cleanup();
        }
    });

    it('[RR-5.5] leaves final duplicate resolution to the reservation update consumer', async () => {
        const reserveDB = {
            findRuleId: vi.fn(async () => []),
            findTimeRanges: vi.fn(async () => []),
            updateMany: vi.fn(async () => undefined),
        };
        const harness = makeReservationHarness({
            programDB: { findRule: vi.fn(async () => [makeProgram({ overlap: true })]) },
            reserveDB,
        });

        await harness.model.updateRule(17);

        expect(reserveDB.updateMany).toHaveBeenCalledOnce();
        expect(harness.reserveEvent.emitUpdated).toHaveBeenCalledOnce();
    });
});
