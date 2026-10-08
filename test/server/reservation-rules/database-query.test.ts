import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Container } from 'inversify';
import { describe, expect, it, vi } from 'vitest';

import { createDialectPersistence, type DatabaseDialect, makeProgram } from '../fixtures/reservation-rules/runtime';

interface RuleQueryApi {
    gets(option: { type?: 'all' | 'normal' | 'conflict' | 'skip' | 'overlap' }): Promise<{
        rules: Array<{ id: number; reservesCnt?: number }>;
        total: number;
    }>;
}

interface RuleQueryApiConstructor {
    new (ipc: unknown, repository: unknown, reservationCountPort: unknown): RuleQueryApi;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const RuleApiModel = (
    require(join(compiledSnapshot, 'model', 'api', 'rule', 'RuleApiModel.js')) as {
        default: RuleQueryApiConstructor;
    }
).default;
const setModelContainer = (
    require(join(compiledSnapshot, 'model', 'ModelContainerSetter.js')) as {
        set(container: Container): void;
    }
).set;

const queryDialectBranches = async () => {
    const results: Record<
        DatabaseDialect,
        {
            bindValues: unknown[];
            candidateIds: number[];
            caseSensitive: number[];
            endAtBoundary: number[];
            filter: string;
            regularExpression: number[];
        }
    > = {
        mysql: {
            bindValues: [],
            candidateIds: [],
            caseSensitive: [],
            endAtBoundary: [],
            filter: '',
            regularExpression: [],
        },
        sqlite: {
            bindValues: [],
            candidateIds: [],
            caseSensitive: [],
            endAtBoundary: [],
            filter: '',
            regularExpression: [],
        },
    };

    for (const dialect of ['sqlite', 'mysql'] as const) {
        const fixture = await createDialectPersistence(dialect);
        try {
            vi.useFakeTimers();
            vi.setSystemTime(1_800_000_000_000);
            await fixture.source.getRepository(fixture.Program).insert([
                makeProgram({
                    endAt: 1_800_000_000_001,
                    halfWidthName: 'Alpha Beta',
                    id: 701,
                    name: 'Alpha Beta',
                    shortName: 'Alpha Beta',
                    startAt: 10,
                }),
                makeProgram({
                    endAt: 1_800_000_000_001,
                    halfWidthName: 'alpha beta',
                    id: 702,
                    name: 'alpha beta',
                    shortName: 'alpha beta',
                    startAt: 20,
                }),
                makeProgram({
                    endAt: 1_800_000_000_000,
                    halfWidthName: 'Boundary',
                    id: 703,
                    name: 'Boundary',
                    shortName: 'Boundary',
                    startAt: 30,
                }),
                makeProgram({
                    endAt: 1_799_999_999_999,
                    halfWidthName: 'Boundary',
                    id: 704,
                    name: 'Boundary',
                    shortName: 'Boundary',
                    startAt: 40,
                }),
                makeProgram({
                    channelId: 101,
                    endAt: 1_800_000_001_000,
                    halfWidthName: 'ordered target',
                    id: 705,
                    name: 'ordered target',
                    shortName: 'ordered target',
                    startAt: 1_800_000_000_300,
                }),
                makeProgram({
                    channelId: 101,
                    endAt: 1_800_000_001_000,
                    halfWidthName: 'ordered target',
                    id: 706,
                    name: 'ordered target',
                    shortName: 'ordered target',
                    startAt: 1_800_000_000_100,
                }),
                makeProgram({
                    channelId: 202,
                    endAt: 1_800_000_001_000,
                    halfWidthName: 'ordered target',
                    id: 707,
                    name: 'ordered target',
                    shortName: 'ordered target',
                    startAt: 1_800_000_000_050,
                }),
                makeProgram({
                    channelId: 101,
                    endAt: 1_800_000_001_000,
                    halfWidthName: 'other target',
                    id: 708,
                    name: 'other target',
                    shortName: 'other target',
                    startAt: 1_800_000_000_025,
                }),
            ]);
            const queryLedger = vi.spyOn(fixture.source.logger, 'logQuery');

            const caseSensitive = await fixture.programDB.findRule({
                reserveOption: { avoidDuplicate: false },
                searchOption: { channelIds: [101], keyCS: true, keyword: 'Alpha Beta', name: true },
            });
            const regularExpression = await fixture.programDB.findRule({
                reserveOption: { avoidDuplicate: false },
                searchOption: {
                    channelIds: [101],
                    keyCS: true,
                    keyRegExp: true,
                    keyword: '^Alpha.*Beta$',
                    name: true,
                },
            });
            const endAtBoundary = await fixture.programDB.findRule({
                reserveOption: { avoidDuplicate: false },
                searchOption: { channelIds: [101], keyword: 'Boundary', name: true },
            });
            const orderedCandidates = await fixture.programDB.findRule({
                reserveOption: { avoidDuplicate: false },
                searchOption: { channelIds: [101], keyword: 'ordered target', name: true },
            });
            const filter = queryLedger.mock.calls.at(-1);
            if (filter === undefined) throw new Error('ProgramDB findRule did not execute a program query');
            results[dialect] = {
                bindValues: filter[1] ?? [],
                candidateIds: orderedCandidates.map((program: { id: number }) => program.id),
                caseSensitive: caseSensitive.map((program: { id: number }) => program.id),
                endAtBoundary: endAtBoundary.map((program: { id: number }) => program.id),
                filter: filter[0],
                regularExpression: regularExpression.map((program: { id: number }) => program.id),
            };
        } finally {
            vi.useRealTimers();
            await fixture.cleanup();
        }
    }

    return results;
};

describe('Rule reservation count query implementation', () => {
    it('resolves through the production container IReserveDB binding and projects legacy counts', async () => {
        const container = new Container();
        setModelContainer(container);
        const countRuleIds = vi.fn(async () => [{ ruleId: 4, ruleIdCnt: 6 }]);
        container.rebind('IIPCClient').toConstantValue({});
        container.rebind('IRuleDB').toConstantValue({ findAll: vi.fn(async () => [[{ id: 4 }], 1]) });
        container.rebind('IReserveDB').toConstantValue({ countRuleIds });

        const api = container.get<RuleQueryApi>('IRuleApiModel');

        await expect(api.gets({ type: 'conflict' })).resolves.toEqual({
            rules: [{ id: 4, reservesCnt: 6 }],
            total: 1,
        });
        expect(countRuleIds).toHaveBeenCalledWith([4], 'conflict');
    });

    it('indexes a frozen unordered provider result without reordering the Rule page', async () => {
        const rules = [{ id: 8 }, { id: 2 }];
        const repository = { findAll: vi.fn(async () => [rules, 12] as const) };
        const reservationCountPort = {
            countByRuleIds: vi.fn(async () =>
                Object.freeze([Object.freeze({ ruleId: 2, count: 1 }), Object.freeze({ ruleId: 8, count: 3 })]),
            ),
        };
        const api = new RuleApiModel({}, repository, reservationCountPort);

        await expect(api.gets({ type: 'overlap' })).resolves.toEqual({
            rules: [
                { id: 8, reservesCnt: 3 },
                { id: 2, reservesCnt: 1 },
            ],
            total: 12,
        });
        expect(reservationCountPort.countByRuleIds).toHaveBeenCalledWith([8, 2], 'overlap');
    });

    it('[IMP-DB-DIALECT-BRANCHES] preserves case and regular-expression results for each persistence dialect', async () => {
        await expect(queryDialectBranches()).resolves.toMatchObject({
            mysql: { caseSensitive: [701], endAtBoundary: [703], regularExpression: [701] },
            sqlite: { caseSensitive: [701, 702], endAtBoundary: [703], regularExpression: [] },
        });
        // `queryDialectBranches()` boots a real `mysql:8.4` container
        // (`test/server/persistence/mysql-runtime.ts:236-267`), measured at 3441ms idle and 4857ms at
        // 14-way concurrency. Nothing hangs; the default 5000ms is simply smaller than contended
        // provisioning plus the query work. Same budget as `program-search.spec.test.ts:107-109`.
    }, 20_000);

    it('[IMP-M2-QUERY-BOUNDARY] executes filter bindings and startAt ordering alongside the endAt boundary', async () => {
        const queryLedger = await queryDialectBranches();
        expect(queryLedger.mysql.endAtBoundary).toEqual([703]);
        expect(queryLedger.sqlite.endAtBoundary).toEqual([703]);
        expect(queryLedger.sqlite.candidateIds).toEqual([706, 705]);
        expect(queryLedger.sqlite.filter).toMatch(/halfWidthName.+like/iu);
        expect(queryLedger.sqlite.filter).toMatch(/channelId.+in/iu);
        expect(queryLedger.sqlite.filter).toMatch(/ORDER BY.+startAt.+ASC/u);
        expect(queryLedger.sqlite.bindValues).toEqual(expect.arrayContaining(['%ordered%', '%target%', 101]));
        expect(queryLedger.mysql.candidateIds).toEqual([706, 705]);
        expect(queryLedger.mysql.filter).toMatch(/halfWidthName.+like/iu);
        expect(queryLedger.mysql.filter).toMatch(/channelId.+in/iu);
        expect(queryLedger.mysql.filter).toMatch(/ORDER BY.+startAt.+ASC/u);
        expect(queryLedger.mysql.bindValues).toEqual(expect.arrayContaining(['%ordered%', '%target%', 101]));
        // `queryDialectBranches()` boots a real `mysql:8.4` container
        // (`test/server/persistence/mysql-runtime.ts:236-267`), measured at 3441ms idle and 4857ms at
        // 14-way concurrency. Nothing hangs; the default 5000ms is simply smaller than contended
        // provisioning plus the query work. Same budget as `program-search.spec.test.ts:107-109`.
    }, 20_000);

    it('[IMP-DB-DIALECT-MUTATION] detects a mutation to either dialect-specific query result', async () => {
        const result = await queryDialectBranches();

        expect(result.sqlite.caseSensitive).not.toEqual(result.mysql.caseSensitive);
        expect(result.sqlite.regularExpression).not.toEqual(result.mysql.regularExpression);
        // `queryDialectBranches()` boots a real `mysql:8.4` container
        // (`test/server/persistence/mysql-runtime.ts:236-267`), measured at 3441ms idle and 4857ms at
        // 14-way concurrency. Nothing hangs; the default 5000ms is simply smaller than contended
        // provisioning plus the query work. Same budget as `program-search.spec.test.ts:107-109`.
    }, 20_000);
});
