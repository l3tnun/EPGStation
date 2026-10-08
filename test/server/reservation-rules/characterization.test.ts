import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    loadProduction,
    logger,
    loggerModel,
    createDialectPersistence,
    type DatabaseDialect,
    makeReservationHarness,
    makeRule,
} from '../fixtures/reservation-rules/runtime';

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe('isolated pre-fix rule defects', () => {
    it('[CHAR-MUTATION-TIMER-REENTRY][RR-CHAR-5.2] queues an overlapping add behind the first add and runs it only once the first settles', async () => {
        vi.useFakeTimers();
        const RuleManageModel = loadProduction<new (...args: unknown[]) => { add(rule: unknown): Promise<number> }>(
            'model',
            'operator',
            'rule',
            'RuleManageModel.js',
        );
        const releases: Array<(id: number) => void> = [];
        const repository = {
            insertOnce: vi.fn(
                () =>
                    new Promise<number>(resolve => {
                        releases.push(resolve);
                    }),
            ),
        };
        const event = { emitAdded: vi.fn() };
        const manager = new RuleManageModel(loggerModel, { checkRuleOption: () => true }, repository, event);

        const first = manager.add(makeRule());
        const second = manager.add(makeRule());
        await Promise.resolve();

        // 1本目が保留の間、2本目は queue の安全弁 timer が1本登録されたまま後ろで待つ
        // （2本目自身は実行を開始していないので insertOnce はまだ1回しか呼ばれていない）。
        expect(repository.insertOnce).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);

        releases[0](41);
        await expect(first).resolves.toBe(41);
        expect(event.emitAdded.mock.calls).toEqual([[41]]);

        // 1本目が確定したので queue が進み、2本目がすぐ実行を開始する。
        for (let i = 0; i < 10; i += 1) {
            await Promise.resolve();
        }
        expect(repository.insertOnce).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(1);

        releases[1](42);
        await expect(second).resolves.toBe(42);
        expect(event.emitAdded.mock.calls).toEqual([[41], [42]]);

        // 2本目自身の安全弁 timer も、確定を受けて解除される。
        for (let i = 0; i < 10; i += 1) {
            await Promise.resolve();
        }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[CHAR-TIME-KEYWORD-SCHEMA][RR-CHAR-5.3] keeps public schema keyword optional while runtime validator rejects an omitted time keyword', async () => {
        const apiSchema = await readFile('api.yml', 'utf8');
        const ruleSearchSection = apiSchema.slice(
            apiSchema.indexOf('RuleSearchOption:'),
            apiSchema.indexOf('RuleReserveOption:'),
        );
        const ReserveOptionChecker = loadProduction<
            new (configuration: unknown) => { checkRuleOption(rule: unknown): boolean }
        >('model', 'operator', 'ReserveOptionChecker.js');
        const checker = new ReserveOptionChecker({ getConfig: () => ({ encode: [] }) });
        const timeRuleWithoutKeyword = makeRule({
            isTimeSpecification: true,
            searchOption: { channelIds: [101], times: [{ week: 1, start: 0, range: 60 }] },
        });

        expect(ruleSearchSection).toContain('keyword:');
        expect(ruleSearchSection).not.toMatch(/required:\s*\n\s*- keyword/u);
        expect(checker.checkRuleOption(timeRuleWithoutKeyword)).toBe(false);

        const harness = makeReservationHarness({
            ruleDB: { findId: vi.fn(async () => timeRuleWithoutKeyword), getIds: vi.fn() },
        });
        await expect(harness.model.updateRule(17)).rejects.toThrow('RuleSearchOptionError');
    });

    it('[CHAR-KEYWORD-BOTH-RULE-TYPES][RR-CHAR-5.4] keyword repository returns program/time rows separately, keeps duplicates, and maps null', async () => {
        for (const dialect of ['sqlite', 'mysql'] as DatabaseDialect[]) {
            const fixture = await createDialectPersistence(dialect);
            try {
                await fixture.ruleDB.insertOnce(
                    makeRule({ id: 31, isTimeSpecification: false, searchOption: { keyword: 'same', name: true } }),
                );
                await fixture.ruleDB.insertOnce(
                    makeRule({ id: 32, isTimeSpecification: true, searchOption: { keyword: 'same' } }),
                );
                await fixture.ruleDB.insertOnce(
                    makeRule({ id: 33, isTimeSpecification: false, searchOption: { name: true } }),
                );

                await expect(fixture.ruleDB.findKeyword({})).resolves.toEqual([
                    { id: 31, keyword: 'same' },
                    { id: 32, keyword: 'same' },
                    { id: 33, keyword: '' },
                ]);
            } finally {
                await fixture.cleanup();
            }
        }
        // Same budget and same reason as the spec-layer siblings (`program-search.spec.test.ts:107-109`,
        // `duplicate-history.spec.test.ts:129`, `management.spec.test.ts:545`): the mysql dialect boots a
        // real `mysql:8.4` container (`test/server/persistence/mysql-runtime.ts:236-267`), which alone
        // measured 3441ms idle and 4857ms at 14-way concurrency. Nothing hangs; the default 5000ms is
        // simply smaller than contended provisioning plus the query work.
    }, 20_000);
});
