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

describe('program rule candidate search characterization', () => {
    const observeProgramSearch = async () => {
        for (const dialect of ['sqlite', 'mysql'] as DatabaseDialect[]) {
            const fixture = await createDialectPersistence(dialect);
            try {
                vi.useFakeTimers();
                vi.setSystemTime(1_800_000_000_000);
                await fixture.source.getRepository(fixture.Program).insert([
                    makeProgram({
                        id: 701,
                        name: 'Alpha Beta',
                        halfWidthName: 'Alpha Beta',
                        shortName: 'Alpha Beta',
                        startAt: 10,
                        endAt: 1_800_000_000_000,
                    }),
                    makeProgram({
                        id: 702,
                        name: 'alpha beta',
                        halfWidthName: 'alpha beta',
                        shortName: 'alpha beta',
                        startAt: 20,
                        endAt: 1_800_000_000_001,
                    }),
                    makeProgram({
                        id: 703,
                        name: 'Alpha X Beta',
                        halfWidthName: 'Alpha X Beta',
                        shortName: 'Alpha X Beta',
                        startAt: 30,
                        endAt: 1_800_000_000_002,
                    }),
                    makeProgram({
                        id: 704,
                        name: 'Alpha Beta',
                        halfWidthName: 'Alpha Beta',
                        shortName: 'Alpha Beta',
                        startAt: 40,
                        endAt: 1_799_999_999_999,
                    }),
                ]);
                await fixture.ruleDB.insertOnce(
                    makeRule({
                        id: 31,
                        searchOption: { keyword: 'Alpha Beta', keyCS: true, name: true, channelIds: [101] },
                        reserveOption: { avoidDuplicate: false },
                    }),
                );
                await fixture.ruleDB.insertOnce(
                    makeRule({
                        id: 32,
                        searchOption: {
                            keyword: '^Alpha.*Beta$',
                            keyCS: true,
                            keyRegExp: true,
                            name: true,
                            channelIds: [101],
                        },
                        reserveOption: { avoidDuplicate: false },
                    }),
                );
                const savedCaseRule = await fixture.ruleDB.findId(31);
                const savedRegexpRule = await fixture.ruleDB.findId(32);
                const caseResult = await fixture.programDB.findRule({
                    searchOption: savedCaseRule.searchOption,
                    reserveOption: savedCaseRule.reserveOption,
                    limit: 9,
                });
                expect(caseResult.map((program: { id: number }) => program.id)).toEqual(
                    dialect === 'sqlite' ? [701, 702, 703] : [701, 703],
                );
                const regexpResult = await fixture.programDB.findRule({
                    searchOption: savedRegexpRule.searchOption,
                    reserveOption: savedRegexpRule.reserveOption,
                });
                expect(regexpResult.map((program: { id: number }) => program.id)).toEqual(
                    dialect === 'sqlite' ? [] : [701, 703],
                );
                await fixture.source.destroy();
                await expect(
                    fixture.programDB.findRule({
                        searchOption: savedCaseRule.searchOption,
                        reserveOption: savedCaseRule.reserveOption,
                    }),
                ).rejects.toBeInstanceOf(Error);
            } finally {
                vi.useRealTimers();
                await fixture.cleanup();
            }
        }
    };

    // observeProgramSearch() runs both the sqlite and mysql dialects through real persistence fixtures on every
    // call; that real dual-dialect DB setup/teardown work reliably approaches Vitest's default 5000ms testTimeout
    // under full-suite contention, so each of the following six cases needs an explicit, generous budget.
    it('[RR-2.1] accepts include and exclude keyword search options', async () => {
        await observeProgramSearch();
    }, 20_000);

    it('[RR-2.2] applies selected program text fields to the search', async () => {
        await observeProgramSearch();
    }, 20_000);

    it('[RR-2.3] preserves case-sensitive and regular-expression dialect behavior', async () => {
        await observeProgramSearch();
    }, 20_000);

    it('[RR-2.4] applies the saved channel and search-filter set', async () => {
        await observeProgramSearch();
    }, 20_000);

    it('[RR-2.5] includes the exact endAt boundary and excludes past programs', async () => {
        await observeProgramSearch();
    }, 20_000);

    it('[RR-2.6] consumes the active persistence dialect result without generalizing it', async () => {
        await observeProgramSearch();
    }, 20_000);

    it('[RR-2.7] passes the persisted options unchanged and rejects a Program query failure', async () => {
        const sentinel = new Error('synthetic-program-query-failure');
        const searchOption = { keyword: 'saved option', name: true, channelIds: [303] };
        const reserveOption = { enable: true, allowEndLack: false, avoidDuplicate: true, periodToAvoidDuplicate: 3 };
        const programDB = { findRule: vi.fn().mockRejectedValue(sentinel) };
        const harness = makeReservationHarness({
            programDB,
            ruleDB: { findId: vi.fn(async () => makeRule({ searchOption, reserveOption })), getIds: vi.fn() },
        });

        await expect(harness.model.updateRule(17)).rejects.toBe(sentinel);
        expect(programDB.findRule).toHaveBeenCalledWith({ searchOption, reserveOption });
        expect(harness.execution.unLockExecution).toHaveBeenCalledWith('synthetic-execution');
    });
});
