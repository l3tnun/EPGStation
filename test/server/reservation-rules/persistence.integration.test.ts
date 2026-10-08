import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    createDialectPersistence,
    type DatabaseDialect,
    makeProgram,
    makeRule,
} from '../fixtures/reservation-rules/runtime';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const withDialects = async (run: (fixture: Awaited<ReturnType<typeof createDialectPersistence>>) => Promise<void>) => {
    for (const dialect of ['sqlite', 'mysql'] as DatabaseDialect[]) {
        const fixture = await createDialectPersistence(dialect);
        try {
            await run(fixture);
        } finally {
            vi.useRealTimers();
            await fixture.cleanup();
        }
    }
};

describe('Rule persistence integration', () => {
    // Isolated single-file coverage was 3/3 PASS (no timeout/unhandled);
    // all three cases below get the same explicit budget.
    it('[RR-T8.4][INTEGRATION-8.4] keeps a saved Rule searchable and uses its saved history options in both dialects', async () => {
        await withDialects(async fixture => {
            const now = 1_800_000_000_000;
            vi.useFakeTimers();
            vi.setSystemTime(now);

            await fixture.ruleDB.insertOnce(
                makeRule({
                    id: 841,
                    searchOption: {
                        GR: true,
                        channelIds: [101],
                        keyword: 'Ｐersist Alpha',
                        name: true,
                    },
                    reserveOption: {
                        allowEndLack: false,
                        avoidDuplicate: true,
                        enable: true,
                        periodToAvoidDuplicate: 3,
                    },
                }),
            );
            await fixture.source.getRepository(fixture.Program).insert(
                makeProgram({
                    channelId: 101,
                    endAt: now + 60_000,
                    halfWidthName: 'Persist Alpha',
                    id: 8411,
                    name: 'Persist Alpha',
                    shortName: 'persisted-history-name',
                    startAt: now + 1,
                }),
            );
            await fixture.recordedHistoryDB.insertOnce({
                channelId: 101,
                endAt: now,
                name: 'persisted-history-name',
            });

            const saved = await fixture.ruleDB.findId(841, true);
            const [found, total] = await fixture.ruleDB.findAll({ keyword: 'Persist Alpha' }, true);
            const candidates = await fixture.programDB.findRule({
                reserveOption: saved.reserveOption,
                searchOption: saved.searchOption,
            });

            expect(saved).toMatchObject({
                id: 841,
                reserveOption: { avoidDuplicate: true, periodToAvoidDuplicate: 3 },
                searchOption: { channelIds: [101], keyword: 'Ｐersist Alpha', name: true },
            });
            expect(found.map(rule => rule.id)).toEqual([841]);
            expect(total).toBe(1);
            expect(candidates.map(program => ({ id: program.id, overlap: program.overlap }))).toEqual([
                { id: 8411, overlap: true },
            ]);
        });
    }, 30_000);

    it("[RR-T8.4][INTEGRATION-8.4] preserves each dialect's saved case and regular-expression Rule results", async () => {
        await withDialects(async fixture => {
            const now = 1_800_000_000_000;
            vi.useFakeTimers();
            vi.setSystemTime(now);

            await fixture.ruleDB.insertOnce(
                makeRule({
                    id: 842,
                    searchOption: {
                        channelIds: [101],
                        keyCS: true,
                        keyword: 'Persist Alpha',
                        name: true,
                    },
                    reserveOption: { allowEndLack: false, avoidDuplicate: false, enable: true },
                }),
            );
            await fixture.ruleDB.insertOnce(
                makeRule({
                    id: 843,
                    searchOption: {
                        channelIds: [101],
                        keyCS: true,
                        keyRegExp: true,
                        keyword: '^Persist Alpha$',
                        name: true,
                    },
                    reserveOption: { allowEndLack: false, avoidDuplicate: false, enable: true },
                }),
            );
            await fixture.source.getRepository(fixture.Program).insert([
                makeProgram({
                    channelId: 101,
                    endAt: now + 60_000,
                    halfWidthName: 'Persist Alpha',
                    id: 8421,
                    name: 'Persist Alpha',
                    shortName: 'regexp-history-name',
                    startAt: now + 1,
                }),
                makeProgram({
                    channelId: 101,
                    endAt: now + 60_000,
                    halfWidthName: 'persist alpha',
                    id: 8422,
                    name: 'persist alpha',
                    shortName: 'case-history-name',
                    startAt: now + 2,
                }),
            ]);

            const saved = await fixture.ruleDB.findId(842);
            const caseCandidates = await fixture.programDB.findRule({
                reserveOption: saved.reserveOption,
                searchOption: saved.searchOption,
            });
            const savedRegexp = await fixture.ruleDB.findId(843);
            const candidates = await fixture.programDB.findRule({
                reserveOption: savedRegexp.reserveOption,
                searchOption: savedRegexp.searchOption,
            });

            expect(saved.searchOption).toMatchObject({ keyCS: true, keyRegExp: false, keyword: 'Persist Alpha' });
            expect(caseCandidates.map(program => program.id)).toEqual(
                fixture.dialect === 'mysql' ? [8421] : [8421, 8422],
            );
            expect(savedRegexp.searchOption).toMatchObject({
                keyCS: true,
                keyRegExp: true,
                keyword: '^Persist Alpha$',
            });
            expect(candidates.map(program => program.id)).toEqual(fixture.dialect === 'mysql' ? [8421] : []);
        });
    }, 30_000);

    it('[RR-T8.4][INTEGRATION-8.4] keeps Rule insertion outside the reservation update transaction', async () => {
        await withDialects(async fixture => {
            const originalCreateQueryRunner = fixture.source.createQueryRunner.bind(fixture.source);
            const transactionLifecycle: string[] = [];
            const instrumentedRunners = new WeakSet<object>();
            const createQueryRunner = vi.spyOn(fixture.source, 'createQueryRunner').mockImplementation((mode?: any) => {
                const runner = originalCreateQueryRunner(mode);
                if (instrumentedRunners.has(runner) === false) {
                    instrumentedRunners.add(runner);
                    const commitTransaction = runner.commitTransaction.bind(runner);
                    const startTransaction = runner.startTransaction.bind(runner);
                    vi.spyOn(runner, 'commitTransaction').mockImplementation(async () => {
                        transactionLifecycle.push('commit');
                        await commitTransaction();
                    });
                    vi.spyOn(runner, 'startTransaction').mockImplementation(async () => {
                        transactionLifecycle.push('start');
                        await startTransaction();
                    });
                }
                return runner;
            });

            await fixture.ruleDB.insertOnce(makeRule({ id: 843 }));

            expect(transactionLifecycle).toEqual([]);
            await fixture.reserveDB.updateMany({
                insert: [
                    Object.assign(new fixture.Reserve(), {
                        channel: 'synthetic-channel',
                        channelId: 101,
                        channelType: 'GR',
                        endAt: 1_800_000_060_000,
                        id: 843,
                        programId: 843,
                        ruleId: 843,
                        startAt: 1_800_000_000_000,
                        updateTime: 1_800_000_000_000,
                    }),
                ],
            });

            expect(createQueryRunner).toHaveBeenCalled();
            expect(transactionLifecycle).toEqual(['start', 'commit']);

            createQueryRunner.mockRestore();
            await expect(fixture.ruleDB.findId(843)).resolves.toMatchObject({ id: 843 });
            await expect(
                fixture.source.getRepository(fixture.Reserve).findOneByOrFail({ id: 843 }),
            ).resolves.toMatchObject({
                id: 843,
                ruleId: 843,
            });
        });
    }, 30_000);
});
