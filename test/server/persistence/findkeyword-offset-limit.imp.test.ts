import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { silentLoggerModel } from '../harness/silent-logger-model';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RuleDB = (
    require(join(snapshot, 'model', 'db', 'RuleDB.js')) as {
        default: new (...args: unknown[]) => {
            findKeyword(option: {
                keyword?: string;
                offset?: number;
                limit?: number;
            }): Promise<Array<{ id: number; keyword: string }>>;
        };
    }
).default;
const Rule = (
    require(join(snapshot, 'db', 'entities', 'Rule.js')) as {
        default: new () => Record<string, unknown>;
    }
).default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real RuleDB.findKeyword with connection/queryBuilder/retry mocked.
 * Keyword predicate assembly and getRawMany happy path are reached elsewhere;
 * residual is option.offset→skip and option.limit→take (L557–564).
 */
const makeFixture = (rawRows: Array<{ id: number; keyword: string | null }> = []) => {
    const queryBuilder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['select', 'from', 'orderBy', 'andWhere', 'skip', 'take'] as const) {
        queryBuilder[method] = vi.fn(() => queryBuilder);
    }
    queryBuilder.getRawMany = vi.fn(async () => rawRows);

    const createQueryBuilder = vi.fn(() => queryBuilder);
    const getLikeStr = vi.fn((cs: boolean) => (cs ? 'like binary' : 'like'));
    const getConnection = vi.fn(async () => ({ createQueryBuilder }));
    const retry = { run: vi.fn(async (job: () => Promise<unknown>) => job()) };
    const provider = new RuleDB(silentLoggerModel, { getConnection, getLikeStr }, retry);

    return { createQueryBuilder, getConnection, getLikeStr, provider, queryBuilder, retry };
};

describe('RuleDB.findKeyword offset/limit (unittest/imp)', () => {
    it('[R2-RULEDB-FINDKEYWORD-OFFSET-LIMIT] applies skip/take after keyword andWhere and maps raw rows', async () => {
        const fixture = makeFixture([
            { id: 11, keyword: 'Alpha Show' },
            { id: 12, keyword: null },
        ]);
        const option = { keyword: 'alpha', offset: 5, limit: 20 };

        await expect(fixture.provider.findKeyword(option)).resolves.toEqual([
            { id: 11, keyword: 'Alpha Show' },
            { id: 12, keyword: '' },
        ]);

        expect(fixture.getConnection).toHaveBeenCalledOnce();
        expect(fixture.createQueryBuilder).toHaveBeenCalledOnce();
        expect(fixture.getLikeStr).toHaveBeenCalledExactlyOnceWith(false);
        expect(fixture.retry.run).toHaveBeenCalledOnce();

        expect(fixture.queryBuilder.select).toHaveBeenCalledExactlyOnceWith('rule.id, rule.keyword');
        expect(fixture.queryBuilder.from).toHaveBeenCalledExactlyOnceWith(Rule, 'rule');
        expect(fixture.queryBuilder.orderBy).toHaveBeenCalledExactlyOnceWith('rule.id', 'ASC');

        expect(fixture.queryBuilder.andWhere).toHaveBeenCalledOnce();
        const [predicateSql, predicateValues] = fixture.queryBuilder.andWhere.mock.calls[0] as [
            string,
            Record<string, string>,
        ];
        expect(predicateSql).toContain('halfWidthKeyword like :keyword0');
        expect(predicateValues).toEqual({ keyword0: '%alpha%' });

        expect(fixture.queryBuilder.skip).toHaveBeenCalledExactlyOnceWith(5);
        expect(fixture.queryBuilder.take).toHaveBeenCalledExactlyOnceWith(20);
        expect(fixture.queryBuilder.getRawMany).toHaveBeenCalledOnce();

        // skip/take run after keyword predicate assembly
        const order = (
            [
                'select',
                'from',
                'orderBy',
                'andWhere',
                'skip',
                'take',
                'getRawMany',
            ] as const
        ).map(method => fixture.queryBuilder[method].mock.invocationCallOrder[0]);
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('[R2-RULEDB-FINDKEYWORD-OFFSET-LIMIT] omits skip/take when offset and limit are absent', async () => {
        const fixture = makeFixture([{ id: 3, keyword: 'only-keyword' }]);

        await expect(fixture.provider.findKeyword({ keyword: 'only-keyword' })).resolves.toEqual([
            { id: 3, keyword: 'only-keyword' },
        ]);

        expect(fixture.queryBuilder.andWhere).toHaveBeenCalledOnce();
        expect(fixture.queryBuilder.skip).not.toHaveBeenCalled();
        expect(fixture.queryBuilder.take).not.toHaveBeenCalled();
        expect(fixture.queryBuilder.getRawMany).toHaveBeenCalledOnce();
    });

    it.each([
        {
            title: 'offset 0 only calls skip(0)',
            option: { keyword: 'bound', offset: 0 },
            expectSkip: 0 as number | null,
            expectTake: null as number | null,
        },
        {
            title: 'limit 0 (no row limit) calls neither skip nor take',
            option: { keyword: 'bound', limit: 0 },
            expectSkip: null as number | null,
            expectTake: null as number | null,
        },
    ])(
        '[R2-RULEDB-FINDKEYWORD-OFFSET-LIMIT] independent zero boundary: $title',
        async ({ option, expectSkip, expectTake }) => {
            const fixture = makeFixture([{ id: 9, keyword: 'bound' }]);

            await expect(fixture.provider.findKeyword(option)).resolves.toEqual([{ id: 9, keyword: 'bound' }]);

            expect(fixture.queryBuilder.andWhere).toHaveBeenCalledOnce();
            if (expectSkip === null) {
                expect(fixture.queryBuilder.skip).not.toHaveBeenCalled();
            } else {
                expect(fixture.queryBuilder.skip).toHaveBeenCalledExactlyOnceWith(expectSkip);
            }
            if (expectTake === null) {
                expect(fixture.queryBuilder.take).not.toHaveBeenCalled();
            } else {
                expect(fixture.queryBuilder.take).toHaveBeenCalledExactlyOnceWith(expectTake);
            }
            expect(fixture.queryBuilder.getRawMany).toHaveBeenCalledOnce();
        },
    );
});
