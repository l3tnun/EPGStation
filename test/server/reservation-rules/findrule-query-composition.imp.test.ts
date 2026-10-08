import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const ProgramDB = (
    require(join(compiledSnapshot, 'model', 'db', 'ProgramDB.js')) as {
        default: new (...args: unknown[]) => {
            findRule(option: Record<string, unknown>): Promise<unknown[]>;
        };
    }
).default;

const logger = () => ({ system: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } });

/**
 * Real ProgramDB + fluent createQueryBuilder mock.
 * Forces CS/regexp dialect capabilities so residual keyword/query branches execute under coverage.
 */
const makeFindRuleFixture = () => {
    const queryBuilder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['select', 'addSelect', 'from', 'where', 'andWhere', 'orderBy', 'limit'] as const) {
        queryBuilder[method] = vi.fn(() => queryBuilder);
    }
    queryBuilder.getRawAndEntities = vi.fn(async () => ({ entities: [], raw: [] }));

    const createQueryBuilder = vi.fn(() => queryBuilder);
    const getConnection = vi.fn(async () => ({ createQueryBuilder }));
    const convertBoolean = vi.fn((value: boolean) => value);
    const getRegexpStr = vi.fn((cs: boolean) => (cs ? 'regexp binary' : 'regexp'));
    const getLikeStr = vi.fn((cs: boolean) => (cs ? 'like binary' : 'like'));
    const isEnableCS = vi.fn(() => true);
    const isEnabledRegexp = vi.fn(() => true);
    const retry = { run: vi.fn(async (job: () => Promise<unknown>) => job()) };

    const provider = new ProgramDB(
        { getLogger: logger },
        { getConfig: () => ({}) },
        {
            getConnection,
            convertBoolean,
            getRegexpStr,
            getLikeStr,
            isEnableCS,
            isEnabledRegexp,
        },
        retry,
    );

    return {
        provider,
        queryBuilder,
        createQueryBuilder,
        convertBoolean,
        getRegexpStr,
        getLikeStr,
        isEnableCS,
        isEnabledRegexp,
        retry,
    };
};

const whereSql = (fixture: ReturnType<typeof makeFindRuleFixture>): string => {
    const call = fixture.queryBuilder.where.mock.calls[0];
    if (call === undefined) throw new Error('findRule did not build a where clause');
    return String(call[0]);
};

const whereParams = (fixture: ReturnType<typeof makeFindRuleFixture>): Record<string, unknown> => {
    const call = fixture.queryBuilder.where.mock.calls[0];
    if (call === undefined) throw new Error('findRule did not build a where clause');
    return (call[1] ?? {}) as Record<string, unknown>;
};

describe('ProgramDB.findRule query composition residual edges', () => {
    it('rejects an empty search option with InvalidFindRuleOption', async () => {
        const fixture = makeFindRuleFixture();

        await expect(fixture.provider.findRule({ searchOption: {} })).rejects.toThrow('InvalidFindRuleOption');
        expect(fixture.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('composes case-sensitive regexp predicates across name, description, and extended', async () => {
        const fixture = makeFindRuleFixture();

        await expect(
            fixture.provider.findRule({
                searchOption: {
                    keyword: '^Alpha.*Beta$',
                    keyCS: true,
                    keyRegExp: true,
                    name: true,
                    description: true,
                    extended: true,
                    channelIds: [11],
                },
            }),
        ).resolves.toEqual([]);

        const sql = whereSql(fixture);
        expect(sql).toContain('CAST(halfWidthName AS BINARY) regexp binary :keywordRegexp');
        expect(sql).toContain("CAST(COALESCE(halfWidthDescription,'') AS BINARY) regexp binary :keywordRegexp");
        expect(sql).toContain("CAST(COALESCE(halfWidthExtended,'') AS BINARY) regexp binary :keywordRegexp");
        expect(whereParams(fixture).keywordRegexp).toBe('^Alpha.*Beta$');
        expect(fixture.getRegexpStr).toHaveBeenCalledWith(true);
    });

    it('composes case-insensitive regexp predicates for description and extended', async () => {
        const fixture = makeFindRuleFixture();

        await expect(
            fixture.provider.findRule({
                searchOption: {
                    keyword: 'wave',
                    keyCS: false,
                    keyRegExp: true,
                    name: false,
                    description: true,
                    extended: true,
                    channelIds: [11],
                },
            }),
        ).resolves.toEqual([]);

        const sql = whereSql(fixture);
        expect(sql).toContain("COALESCE(halfWidthDescription,'') regexp :keywordRegexp");
        expect(sql).toContain("COALESCE(halfWidthExtended,'') regexp :keywordRegexp");
        expect(sql).not.toContain('CAST(halfWidthName AS BINARY)');
        expect(fixture.getRegexpStr).toHaveBeenCalledWith(false);
    });

    it('composes fuzzy keyword predicates for description and extended token lists', async () => {
        const fixture = makeFindRuleFixture();

        await expect(
            fixture.provider.findRule({
                searchOption: {
                    keyword: 'Alpha Beta',
                    name: false,
                    description: true,
                    extended: true,
                    channelIds: [11],
                },
            }),
        ).resolves.toEqual([]);

        const sql = whereSql(fixture);
        const params = whereParams(fixture);
        expect(sql).toContain("COALESCE(halfWidthDescription,'') like :keywordDescription0");
        expect(sql).toContain("COALESCE(halfWidthDescription,'') like :keywordDescription1");
        expect(sql).toContain("COALESCE(halfWidthExtended,'') like :keywordExtended0");
        expect(sql).toContain("COALESCE(halfWidthExtended,'') like :keywordExtended1");
        expect(params.keywordDescription0).toBe('%Alpha%');
        expect(params.keywordDescription1).toBe('%Beta%');
        expect(params.keywordExtended0).toBe('%Alpha%');
        expect(params.keywordExtended1).toBe('%Beta%');
    });

    it('enumerates CS and SKY channelType waves when channelIds are absent', async () => {
        const fixture = makeFindRuleFixture();

        await expect(
            fixture.provider.findRule({
                searchOption: {
                    keyword: 'wave',
                    name: true,
                    CS: true,
                    SKY: true,
                },
            }),
        ).resolves.toEqual([]);

        const sql = whereSql(fixture);
        const params = whereParams(fixture);
        expect(sql).toContain('channelType in (:...channelType)');
        expect(params.channelType).toEqual(['CS', 'SKY']);
    });

    // BS4KはGR/BS/CS/SKYと対等な5つ目のchannelType wave（setChannelQuery）。既存の4種別と同じ
    // in句へ加わることを、既存4種別に混ぜて確認する。
    it('enumerates BS4K alongside GR in the channelType wave when channelIds are absent', async () => {
        const fixture = makeFindRuleFixture();

        await expect(
            fixture.provider.findRule({
                searchOption: {
                    keyword: 'wave',
                    name: true,
                    GR: true,
                    BS4K: true,
                },
            }),
        ).resolves.toEqual([]);

        const sql = whereSql(fixture);
        const params = whereParams(fixture);
        expect(sql).toContain('channelType in (:...channelType)');
        expect(params.channelType).toEqual(['GR', 'BS4K']);
    });

    // F5（設計調査）: GR/BS/CS/SKY/BS4Kが全てfalse（かつchannelIds未指定）のルールは、
    // createInQuery(query, 'channelType', [])が空配列なら何もqueryへ追加しないため、
    // channelType列自体を絞り込まない。BS4Kという列を追加した後も、この「全種別false＝無絞り込み」
    // という既存の挙動（BS4K・未知種別の番組にもヒットする）は変わらないことを確認する。
    it('adds no channelType filter at all when GR/BS/CS/SKY/BS4K are all false, unchanged by adding the BS4K wave', async () => {
        const fixture = makeFindRuleFixture();

        await expect(
            fixture.provider.findRule({
                searchOption: {
                    keyword: 'wave',
                    name: true,
                    GR: false,
                    BS: false,
                    CS: false,
                    SKY: false,
                    BS4K: false,
                },
            }),
        ).resolves.toEqual([]);

        const sql = whereSql(fixture);
        const params = whereParams(fixture);
        expect(sql).not.toContain('channelType in (:...channelType)');
        expect(params.channelType).toBeUndefined();
    });

    it('matches genres without a subGenre on any of the three genre slots', async () => {
        const fixture = makeFindRuleFixture();

        await expect(
            fixture.provider.findRule({
                searchOption: {
                    keyword: 'genre',
                    name: true,
                    channelIds: [11],
                    genres: [{ genre: 7 }],
                },
            }),
        ).resolves.toEqual([]);

        const sql = whereSql(fixture);
        expect(sql).toContain('genre1 = :genre0 or genre2 = :genre0 or genre3 = :genre0');
        expect(sql).not.toContain('subGenre1');
        expect(whereParams(fixture).genre0).toBe(7);
    });

    it('expands residual week bits, skips empty week masks, and ranges multi-hour startHour sets', async () => {
        const fixture = makeFindRuleFixture();

        await expect(
            fixture.provider.findRule({
                searchOption: {
                    keyword: 'times',
                    name: true,
                    channelIds: [11],
                    times: [
                        { week: 0x00 }, // empty mask → skipped
                        { week: 0x7f, start: 22, range: 4 }, // all days, multi-hour wrap
                    ],
                },
            }),
        ).resolves.toEqual([]);

        const sql = whereSql(fixture);
        const params = whereParams(fixture);
        expect(sql).toContain('week in (:...week1)');
        expect(sql).toContain('startHour in (:...time1)');
        expect(params.week1).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(params.time1).toEqual([22, 23, 0, 1]);
        // only one times clause is pushed (empty mask skipped)
        expect(sql.match(/week in/g)?.length).toBe(1);
    });

    /**
     * ProgramDB.findRule L464-466: empty query.strs entries are skipped when joining.
     * No public setter currently pushes '', so inject via the private free-query seam
     * (imp characterization of the defensive continue branch).
     */
    it('skips empty query.strs fragments when joining the where clause', async () => {
        const fixture = makeFindRuleFixture();
        const provider = fixture.provider as {
            setFreeQuery: (option: Record<string, unknown>, query: { strs: string[] }) => void;
            findRule: (option: Record<string, unknown>) => Promise<unknown[]>;
        };
        const originalSetFreeQuery = provider.setFreeQuery.bind(provider);
        provider.setFreeQuery = (option, query) => {
            // Empty fragment between channel and free clauses → continue skips it (L464-466).
            query.strs.push('');
            originalSetFreeQuery(option, query);
        };

        await expect(
            provider.findRule({
                searchOption: {
                    channelIds: [11],
                    isFree: true,
                },
            }),
        ).resolves.toEqual([]);

        // Without the empty-skip continue, SQL would include a bare `()` group from the injected ''.
        expect(whereSql(fixture)).toBe('(channelId in (:...channelId)) and (isFree = :isFree)');
        expect(whereParams(fixture)).toMatchObject({
            channelId: [11],
            isFree: true,
        });
    });
});
