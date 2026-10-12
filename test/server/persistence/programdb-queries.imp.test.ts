import { In, LessThan, LessThanOrEqual, MoreThan, MoreThanOrEqual } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFluentBuilder, createRunnerDouble, immediateRun, loadEntity, type RunnerFaults } from './db-unit-fakes';
import { loadCompiled, repositoryOperator, type RepositoryDialect } from './repository-harness';

type ProgramProvider = {
    insert(channelTypes: object, programs: object[], deleteChannelIds?: number[]): Promise<void>;
    update(channelTypes: object, values: { insert: object[]; update: object[]; delete: number[] }): Promise<void>;
    deleteOld(time: number): Promise<void>;
    findRule(option: { searchOption: object; reserveOption?: object; limit?: number }): Promise<any[]>;
    findChannelIdAndTime(channelId: number, startAt: number): Promise<unknown>;
    findAll(): Promise<unknown[]>;
    findSchedule(option: object): Promise<unknown[]>;
    findBroadcasting(option: object): Promise<unknown[]>;
};

const Program = loadEntity('Program');
const ProgramDB = loadCompiled<new (...arguments_: any[]) => ProgramProvider>('model/db/ProgramDB.js');

const channelTypes = { 32736: { 1024: { id: 327361024, type: 'GR', channel: '27' } } };
const program = (id: number, extra: object = {}) => ({
    id,
    eventId: 5,
    serviceId: 1024,
    networkId: 32736,
    startAt: 1_800_000_000_000,
    duration: 600_000,
    isFree: true,
    name: `program ${id}`,
    ...extra,
});
const stored = (id: number) =>
    expect.objectContaining({
        id,
        channelId: 327361024,
        channelType: 'GR',
        channel: '27',
        eventId: 5,
        serviceId: 1024,
        networkId: 32736,
        startAt: 1_800_000_000_000,
        endAt: 1_800_000_600_000,
        duration: 600_000,
        isFree: true,
        name: `program ${id}`,
    });

interface Wiring {
    readonly connection: object;
    readonly dialect?: RepositoryDialect;
    readonly operatorOverride?: Record<string, unknown>;
}

const makeProvider = ({ connection, dialect = 'sqlite', operatorOverride = {} }: Wiring) => {
    const error = vi.fn();
    const retry = { run: vi.fn(immediateRun) };
    const provider = new ProgramDB(
        { getLogger: () => ({ system: { error } }) },
        { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
        { ...repositoryOperator(connection, dialect), ...operatorOverride },
        retry,
    );
    return { error, provider, retry };
};

const makeTransactional = (faults: RunnerFaults = {}) => {
    const double = createRunnerDouble(faults);
    const wiring = makeProvider({ connection: { createQueryRunner: () => double.runner } });
    return { ...double, ...wiring };
};

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('ProgramDB.insert transaction lifecycle (unittest/imp)', () => {
    it('[4.2] replaces every program with the converted rows and skips programs that cannot be stored', async () => {
        const fixture = makeTransactional();

        await fixture.provider.insert(channelTypes, [
            program(1),
            program(2, { name: undefined }),
            program(3, { networkId: 1 }),
            program(4, { serviceId: 5 }),
        ]);

        expect(fixture.deletedEntities).toEqual([Program]);
        expect(fixture.runner.manager.insert.mock.calls).toEqual([[Program, stored(1)]]);
        expect(fixture.events).toEqual(['start', 'delete-all', 'insert', 'commit', 'release']);
    });

    it('[4.2] deletes only the listed channels when deleteChannelIds is given', async () => {
        const fixture = makeTransactional();

        await fixture.provider.insert(channelTypes, [program(1)], [327361024]);

        expect(fixture.runner.manager.delete).toHaveBeenCalledExactlyOnceWith(Program, { channelId: In([327361024]) });
        expect(fixture.deletedEntities).toEqual([]);
        expect(fixture.events).toEqual(['start', 'delete', 'insert', 'commit', 'release']);
    });

    it('[4.4] rolls back, releases and reports InsertError when an insert fails', async () => {
        const fixture = makeTransactional({ insert: true });
        const diagnostic = fixture.error;

        await expect(fixture.provider.insert(channelTypes, [program(1)])).rejects.toThrow('InsertError');

        expect(fixture.events.slice(-2)).toEqual(['rollback', 'release']);
        expect(fixture.runner.commitTransaction).not.toHaveBeenCalled();
        expect(diagnostic.mock.calls).toEqual([[fixture.primary]]);
    });

    it('[4.9] keeps InsertError as the public error when the rollback also fails', async () => {
        const fixture = makeTransactional({ insert: true, rollback: true });
        const diagnostic = fixture.error;

        await expect(fixture.provider.insert(channelTypes, [program(1)])).rejects.toThrow('InsertError');

        expect(fixture.runner.release).toHaveBeenCalledOnce();
        expect(diagnostic.mock.calls).toEqual([[fixture.primary], [fixture.rollbackFailure]]);
    });

    it('[4.9] keeps InsertError as the public error when only the release fails after a commit', async () => {
        const fixture = makeTransactional({ release: true });
        const diagnostic = fixture.error;

        await expect(fixture.provider.insert(channelTypes, [program(1)])).rejects.toThrow('InsertError');

        expect(fixture.runner.commitTransaction).toHaveBeenCalledOnce();
        expect(diagnostic.mock.calls).toEqual([[fixture.releaseFailure]]);
    });
});

describe('ProgramDB.update incremental transaction (unittest/imp)', () => {
    it('[4.6] deletes the listed ids and inserts both the inserted and the updated programs', async () => {
        const fixture = makeTransactional();

        await fixture.provider.update(channelTypes, {
            insert: [program(1), program(2, { name: undefined })],
            update: [program(3), program(4, { networkId: 1 })],
            delete: [8, 9],
        });

        expect(fixture.runner.manager.delete.mock.calls).toEqual([
            [Program, 8],
            [Program, 9],
        ]);
        expect(fixture.runner.manager.insert.mock.calls).toEqual([
            [Program, stored(1)],
            [Program, stored(3)],
        ]);
        expect(fixture.runner.manager.update).not.toHaveBeenCalled();
        expect(fixture.events).toEqual(['start', 'delete', 'delete', 'insert', 'insert', 'commit', 'release']);
        expect(fixture.error).not.toHaveBeenCalled();
    });

    it('[4.6] logs a failed delete and keeps going to commit', async () => {
        const fixture = makeTransactional();
        const failure = new Error('synthetic-delete-failure');
        fixture.runner.manager.delete.mockRejectedValueOnce(failure);

        await fixture.provider.update(channelTypes, { insert: [], update: [], delete: [8] });

        expect(fixture.error.mock.calls).toEqual([['program delete error: 8'], [failure]]);
        expect(fixture.runner.commitTransaction).toHaveBeenCalledOnce();
    });

    it('[4.6] falls back to an update of the same row when the insert fails, without logging', async () => {
        const fixture = makeTransactional();
        fixture.runner.manager.insert.mockRejectedValueOnce(new Error('synthetic-duplicate'));

        await fixture.provider.update(channelTypes, { insert: [program(1)], update: [], delete: [] });

        expect(fixture.runner.manager.update).toHaveBeenCalledExactlyOnceWith(Program, 1, stored(1));
        expect(fixture.error).not.toHaveBeenCalled();
        expect(fixture.runner.commitTransaction).toHaveBeenCalledOnce();
    });

    it('[4.6] logs both failures and still commits the rest when the update fallback also fails', async () => {
        const fixture = makeTransactional();
        const insertFailure = new Error('synthetic-insert-failure');
        const updateFailure = new Error('synthetic-update-failure');
        fixture.runner.manager.insert.mockRejectedValueOnce(insertFailure);
        fixture.runner.manager.update.mockRejectedValueOnce(updateFailure);

        await fixture.provider.update(channelTypes, { insert: [program(1), program(2)], update: [], delete: [] });

        expect(fixture.error.mock.calls).toEqual([['program update error'], [insertFailure], [updateFailure]]);
        expect(fixture.runner.manager.insert).toHaveBeenCalledTimes(2);
        expect(fixture.runner.commitTransaction).toHaveBeenCalledOnce();
    });

    it('[4.4] rolls back, releases and reports UpdateError when the transaction fails to commit', async () => {
        const fixture = makeTransactional({ commit: true });
        const diagnostic = fixture.error;

        await expect(fixture.provider.update(channelTypes, { insert: [], update: [], delete: [] })).rejects.toThrow(
            'UpdateError',
        );

        expect(fixture.events.slice(-2)).toEqual(['rollback', 'release']);
        expect(diagnostic.mock.calls).toEqual([[fixture.primary]]);
    });

    it('[4.9] keeps UpdateError as the public error when the rollback also fails', async () => {
        const fixture = makeTransactional({ commit: true, rollback: true });
        const diagnostic = fixture.error;

        await expect(fixture.provider.update(channelTypes, { insert: [], update: [], delete: [] })).rejects.toThrow(
            'UpdateError',
        );

        expect(diagnostic.mock.calls).toEqual([[fixture.primary], [fixture.rollbackFailure]]);
    });

    it('[4.9] keeps UpdateError as the public error when only the release fails', async () => {
        const fixture = makeTransactional({ release: true });
        const diagnostic = fixture.error;

        await expect(fixture.provider.update(channelTypes, { insert: [], update: [], delete: [] })).rejects.toThrow(
            'UpdateError',
        );

        expect(diagnostic.mock.calls).toEqual([[fixture.releaseFailure]]);
    });
});

const makeRuleQuery = (
    dialect: RepositoryDialect = 'mysql',
    result: { entities: object[]; raw: object[] } = { entities: [], raw: [] },
    operatorOverride: Record<string, unknown> = {},
) => {
    const builder = createFluentBuilder({ getRawAndEntities: async () => result });
    const connection = { createQueryBuilder: vi.fn(() => builder.builder) };
    return { builder, ...makeProvider({ connection, dialect, operatorOverride }) };
};

const whereOf = (builder: ReturnType<typeof createFluentBuilder>) =>
    builder.argsOf('where')[0] as [string, Record<string, unknown>];

describe('ProgramDB.findRule keyword conditions (unittest/imp)', () => {
    it('[R7.2] builds the case-insensitive regexp condition over the name only', async () => {
        const fixture = makeRuleQuery();

        await fixture.provider.findRule({ searchOption: { keyword: 'a.+b', keyRegExp: true, name: true, GR: true } });

        const [str, param] = whereOf(fixture.builder);
        expect(str).toBe('(((halfWidthName regexp :keywordRegexp))) and (channelType in (:...channelType))');
        expect(param).toEqual({ keywordRegexp: 'a.+b', channelType: ['GR'] });
    });

    it('[R7.2] builds the case-sensitive regexp condition over name, description and extended', async () => {
        const fixture = makeRuleQuery();

        await fixture.provider.findRule({
            searchOption: {
                keyword: 'x',
                keyRegExp: true,
                keyCS: true,
                name: true,
                description: true,
                extended: true,
                BS: true,
            },
        });

        const [str, param] = whereOf(fixture.builder);
        expect(str).toContain('CAST(halfWidthName AS BINARY) regexp binary :keywordRegexp');
        expect(str).toContain("CAST(COALESCE(halfWidthDescription,'') AS BINARY) regexp binary :keywordRegexp");
        expect(str).toContain("CAST(COALESCE(halfWidthExtended,'') AS BINARY) regexp binary :keywordRegexp");
        expect(param).toEqual({ keywordRegexp: 'x', channelType: ['BS'] });
    });

    it('[R7.2] builds the case-insensitive regexp condition over description and extended', async () => {
        const fixture = makeRuleQuery();

        await fixture.provider.findRule({
            searchOption: { keyword: 'x', keyRegExp: true, description: true, extended: true, CS: true },
        });

        const [str] = whereOf(fixture.builder);
        expect(str).toContain("COALESCE(halfWidthDescription,'') regexp :keywordRegexp");
        expect(str).toContain("COALESCE(halfWidthExtended,'') regexp :keywordRegexp");
        expect(str).not.toContain('halfWidthName');
    });

    it('[R7.2] binds the regexp keyword with full-width characters converted and full-width symbols escaped', async () => {
        const fixture = makeRuleQuery();

        await fixture.provider.findRule({
            searchOption: { keyword: 'ＡＢ　１２（再）なぜ？^.*$', keyRegExp: true, name: true, GR: true },
        });

        const [str, param] = whereOf(fixture.builder);
        expect(str).toBe('(((halfWidthName regexp :keywordRegexp))) and (channelType in (:...channelType))');
        expect(param).toEqual({ keywordRegexp: 'AB 12\\(再\\)なぜ\\?^.*$', channelType: ['GR'] });
    });

    it('[R7.2] converts the ignore regexp keyword the same way and leaves the fuzzy keyword unchanged', async () => {
        const fixture = makeRuleQuery();

        await fixture.provider.findRule({
            searchOption: {
                keyword: '（Ａ）',
                name: true,
                ignoreKeyword: '［Ｂ］￥',
                ignoreKeyRegExp: true,
                ignoreName: true,
                BS: true,
            },
        });

        const [, param] = whereOf(fixture.builder);
        expect(param).toEqual({
            keywordName0: '%(A)%',
            ignoreKeywordRegexp: '\\[B\\]\\\\',
            channelType: ['BS'],
        });
    });

    it('[R7.2] negates the ignore keyword and reads its own option flags', async () => {
        const fixture = makeRuleQuery();

        await fixture.provider.findRule({
            searchOption: {
                keyword: 'keep',
                name: true,
                ignoreKeyword: 'ＮＧ word',
                ignoreKeyCS: true,
                ignoreName: true,
                ignoreDescription: true,
                ignoreExtended: true,
                SKY: true,
            },
        });

        const [str, param] = whereOf(fixture.builder);
        expect(param).toEqual({
            keywordName0: '%keep%',
            ignoreKeywordName0: '%NG%',
            ignoreKeywordName1: '%word%',
            ignoreKeywordDescription0: '%NG%',
            ignoreKeywordDescription1: '%word%',
            ignoreKeywordExtended0: '%NG%',
            ignoreKeywordExtended1: '%word%',
            channelType: ['SKY'],
        });
        expect(str).toContain('(not (');
        expect(str).toContain('halfWidthName like binary :ignoreKeywordName0');
        expect(str).toContain("COALESCE(halfWidthDescription,'') like binary :ignoreKeywordDescription1");
        expect(str).toContain("COALESCE(halfWidthExtended,'') like binary :ignoreKeywordExtended0");
    });

    it('[3.6] drops the case-sensitive binary form but keeps the regexp when SQLite has regexp enabled without case sensitivity', async () => {
        const fixture = makeRuleQuery('sqlite', undefined, {
            isEnableCS: () => false,
            isEnabledRegexp: () => true,
            getRegexpStr: () => 'regexp',
        });

        await fixture.provider.findRule({
            searchOption: { keyword: 'a.+b', keyRegExp: true, keyCS: true, name: true, GR: true },
        });

        const [str, param] = whereOf(fixture.builder);
        expect(str).toBe('(((halfWidthName regexp :keywordRegexp))) and (channelType in (:...channelType))');
        expect(str).not.toContain('CAST(');
        expect(str).not.toContain('binary');
        expect(param).toEqual({ keywordRegexp: 'a.+b', channelType: ['GR'] });
    });

    it('[3.7] forces case-insensitive fuzzy matching when the backend has neither case sensitivity nor regexp', async () => {
        const fixture = makeRuleQuery('sqlite');

        await fixture.provider.findRule({
            searchOption: { keyword: 'a.b', keyRegExp: true, keyCS: true, name: true, BS4K: true },
        });

        const [str, param] = whereOf(fixture.builder);
        expect(param).toEqual({ keywordName0: '%a.b%', channelType: ['BS4K'] });
        expect(str).toContain('halfWidthName like :keywordName0');
        expect(str).not.toContain('regexp');
        expect(str).not.toContain('binary');
    });
});

describe('ProgramDB.findRule structural conditions (unittest/imp)', () => {
    it('[3.3] prefers explicit channel ids over the broadcast type flags', async () => {
        const fixture = makeRuleQuery();

        await fixture.provider.findRule({ searchOption: { channelIds: [11, 12], GR: true, BS: true } });

        const [str, param] = whereOf(fixture.builder);
        expect(str).toBe('(channelId in (:...channelId))');
        expect(param).toEqual({ channelId: [11, 12] });
    });

    it('[3.3] lists every enabled broadcast type', async () => {
        const fixture = makeRuleQuery();

        await fixture.provider.findRule({ searchOption: { GR: true, BS: true, CS: true, SKY: true, BS4K: true } });

        expect(whereOf(fixture.builder)[1]).toEqual({ channelType: ['GR', 'BS', 'CS', 'SKY', 'BS4K'] });
    });

    it('[3.3] expresses genres with and without a sub genre', async () => {
        const fixture = makeRuleQuery();

        await fixture.provider.findRule({ searchOption: { genres: [{ genre: 1 }, { genre: 2, subGenre: 3 }] } });

        const [str, param] = whereOf(fixture.builder);
        expect(param).toEqual({ genre0: 1, genre1: 2, subgenre1: 3 });
        expect(str).toContain('(genre1 = :genre0 or genre2 = :genre0 or genre3 = :genre0)');
        expect(str).toContain(
            '((genre1 = :genre1 and subGenre1 = :subgenre1) or (genre2 = :genre1 and subGenre2 = :subgenre1) or (genre3 = :genre1 and subGenre3 = :subgenre1))',
        );
    });

    it('[3.3] expresses weekday masks with a single hour, a wrapping hour range and no hour range', async () => {
        const fixture = makeRuleQuery();

        await fixture.provider.findRule({
            searchOption: {
                times: [
                    { week: 0x01 | 0x02 | 0x04 | 0x08 | 0x10 | 0x20 | 0x40, start: 5, range: 1 },
                    { week: 0x40, start: 23, range: 3 },
                    { week: 0x02 },
                    { week: 0 },
                ],
            },
        });

        const [str, param] = whereOf(fixture.builder);
        expect(param).toEqual({
            week0: [0, 1, 2, 3, 4, 5, 6],
            time0: 5,
            week1: [6],
            time1: [23, 0, 1],
            week2: [1],
        });
        expect(str).toContain('week in (:...week0) and startHour = :time0');
        expect(str).toContain('week in (:...week1)and startHour in (:...time1)');
        expect(str).toContain('week in (:...week2)');
        expect(str).not.toContain('week3');
    });

    it('[3.5] binds isFree through the backend boolean conversion', async () => {
        const fixture = makeRuleQuery('sqlite');

        await fixture.provider.findRule({ searchOption: { isFree: true } });

        expect(whereOf(fixture.builder)).toEqual(['(isFree = :isFree)', { isFree: 1 }]);
    });

    it('[3.3] converts the duration limits from seconds to milliseconds', async () => {
        const fixture = makeRuleQuery();

        await fixture.provider.findRule({ searchOption: { durationMin: 60, durationMax: 120 } });

        expect(whereOf(fixture.builder)).toEqual([
            '(duration >= :durationMin) and (duration <= :durationMax)',
            { durationMin: 60_000, durationMax: 120_000 },
        ]);
    });

    it('[3.3] ORs the search periods as inclusive start ranges', async () => {
        const fixture = makeRuleQuery();

        await fixture.provider.findRule({
            searchOption: {
                searchPeriods: [
                    { startAt: 100, endAt: 200 },
                    { startAt: 300, endAt: 400 },
                ],
            },
        });

        const [str, param] = whereOf(fixture.builder);
        expect(param).toEqual({
            sarchPeriodsStartAt0: 100,
            sarchPeriodsEndAt0: 200,
            sarchPeriodsStartAt1: 300,
            sarchPeriodsEndAt1: 400,
        });
        expect(str).toContain('(startAt >= :sarchPeriodsStartAt0 and startAt <= :sarchPeriodsEndAt0)');
        expect(str).toContain('(startAt >= :sarchPeriodsStartAt1 and startAt <= :sarchPeriodsEndAt1)');
    });

    it('[R7.2] rejects a rule that yields no condition', async () => {
        const fixture = makeRuleQuery();

        await expect(fixture.provider.findRule({ searchOption: {} })).rejects.toThrow('InvalidFindRuleOption');

        expect(fixture.builder.calls).toEqual([]);
    });

    it('[3.3] applies the future-only filter, start order and limit, and marks overlap when duplicates are avoided', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_800_000_000_000);
        const fixture = makeRuleQuery('mysql', {
            entities: [{ id: 1 }, { id: 2 }],
            raw: [{ overlap: 1 }, { overlap: 0 }],
        });

        const result = await fixture.provider.findRule({
            searchOption: { durationMin: 1 },
            reserveOption: { avoidDuplicate: true, periodToAvoidDuplicate: 2 },
            limit: 7,
        });

        expect(result).toEqual([
            { id: 1, overlap: true },
            { id: 2, overlap: false },
        ]);
        expect(fixture.builder.argsOf('select')).toEqual([['program']]);
        const day = 24 * 60 * 60 * 1000;
        expect(fixture.builder.argsOf('addSelect')).toEqual([
            [
                'case when id in (select P.id from program as P, recorded_history as R where P.shortName = R.name and P.channelId = R.channelId ' +
                    `and R.endAt >= ${1_800_000_000_000 - 2 * day} and R.endAt <= 1800000000000 and P.endAt <= (R.endAt + ${2 * day}) ) then 1 else 0 end`,
                'overlap',
            ],
        ]);
        expect(fixture.builder.argsOf('from')).toEqual([[Program, 'program']]);
        expect(fixture.builder.argsOf('andWhere')).toEqual([['1800000000000 <= program.endAt']]);
        expect(fixture.builder.argsOf('orderBy')).toEqual([['program.startAt', 'ASC']]);
        expect(fixture.builder.argsOf('limit')).toEqual([[7]]);
    });

    it.each([
        { limit: 0, expected: [[undefined]] },
        { limit: undefined, expected: [[undefined]] },
        { limit: 1, expected: [[1]] },
    ])('[3.3] treats limit $limit as $expected (limit 0 means no row limit)', async ({ limit, expected }) => {
        const fixture = makeRuleQuery('mysql', { entities: [], raw: [] });

        await fixture.provider.findRule({ searchOption: { durationMin: 1 }, limit });

        expect(fixture.builder.argsOf('limit')).toEqual(expected);
    });

    it('[3.3] counts every earlier record as a duplicate when no period is given', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_800_000_000_000);
        const fixture = makeRuleQuery();

        await fixture.provider.findRule({
            searchOption: { durationMin: 1 },
            reserveOption: { avoidDuplicate: true },
        });

        const [[overlap]] = fixture.builder.argsOf('addSelect') as [[string, string]];
        expect(overlap).toContain('and R.endAt <= 1800000000000 ) then 1 else 0 end');
        expect(overlap).not.toContain('R.endAt >=');
    });
});

describe('ProgramDB finders (unittest/imp)', () => {
    const makeRepository = (methods: Record<string, unknown>) => {
        const repository = Object.fromEntries(
            Object.entries(methods).map(([name, value]) => [name, vi.fn(async () => value)]),
        );
        const getRepository = vi.fn(() => repository);
        return {
            repository: repository as Record<string, ReturnType<typeof vi.fn>>,
            ...makeProvider({ connection: { getRepository } }),
            getRepository,
        };
    };

    it('[3.1] deleteOld deletes the programs that ended before the given time', async () => {
        const fixture = makeRepository({ delete: undefined });

        await fixture.provider.deleteOld(1234);

        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(Program);
        expect(fixture.repository.delete).toHaveBeenCalledExactlyOnceWith({ endAt: LessThan(1234) });
    });

    it.each([
        { rows: [{ id: 1 }, { id: 2 }], expected: { id: 1 } },
        { rows: [], expected: null },
    ])(
        '[3.2] findChannelIdAndTime returns the first airing row or null ($rows.length rows)',
        async ({ rows, expected }) => {
            const fixture = makeRepository({ find: rows });

            await expect(fixture.provider.findChannelIdAndTime(31, 5000)).resolves.toEqual(expected);

            expect(fixture.repository.find).toHaveBeenCalledExactlyOnceWith({
                where: { channelId: 31, startAt: LessThanOrEqual(5000), endAt: MoreThan(5000) },
            });
        },
    );

    it('[3.2] findAll returns every program ordered by start time', async () => {
        const rows = [{ id: 1 }];
        const fixture = makeRepository({ find: rows });

        await expect(fixture.provider.findAll()).resolves.toBe(rows);

        expect(fixture.repository.find).toHaveBeenCalledExactlyOnceWith({ order: { startAt: 'ASC' } });
    });

    it.each([
        { isFree: undefined, extra: {} },
        { isFree: true, extra: { isFree: true } },
    ])('[3.2] findSchedule by channel id applies isFree=$isFree only when given', async ({ isFree, extra }) => {
        const rows = [{ id: 1 }];
        const fixture = makeRepository({ find: rows });

        await expect(fixture.provider.findSchedule({ startAt: 100, endAt: 200, channelId: 31, isFree })).resolves.toBe(
            rows,
        );

        expect(fixture.repository.find).toHaveBeenCalledExactlyOnceWith({
            where: { startAt: LessThanOrEqual(200), endAt: MoreThanOrEqual(100), channelId: 31, ...extra },
            order: { startAt: 'ASC' },
        });
    });

    it.each([
        { isFree: undefined, extra: {} },
        { isFree: false, extra: { isFree: false } },
    ])(
        '[3.2] findSchedule by broadcast types builds one condition per type with isFree=$isFree',
        async ({ isFree, extra }) => {
            const fixture = makeRepository({ find: [] });

            await fixture.provider.findSchedule({ startAt: 100, endAt: 200, types: ['GR', 'BS'], isFree });

            expect(fixture.repository.find).toHaveBeenCalledExactlyOnceWith({
                where: [
                    { startAt: LessThanOrEqual(200), endAt: MoreThanOrEqual(100), channelType: 'GR', ...extra },
                    { startAt: LessThanOrEqual(200), endAt: MoreThanOrEqual(100), channelType: 'BS', ...extra },
                ],
                order: { startAt: 'ASC' },
            });
        },
    );

    it.each([{ types: [] }, {}])(
        '[3.2] findSchedule rejects an option with neither channel id nor types (%j)',
        async extra => {
            const fixture = makeRepository({ find: [] });

            await expect(fixture.provider.findSchedule({ startAt: 100, endAt: 200, ...extra })).rejects.toThrow(
                'FindScheduleOptionError',
            );

            expect(fixture.repository.find).not.toHaveBeenCalled();
        },
    );

    it.each([
        { option: {}, now: 1_800_000_000_000 },
        { option: { time: 5000 }, now: 1_800_000_005_000 },
    ])('[3.2] findBroadcasting looks up the programs on air at now + ($option)', async ({ option, now }) => {
        vi.useFakeTimers();
        vi.setSystemTime(1_800_000_000_000);
        const fixture = makeRepository({ find: [] });

        await fixture.provider.findBroadcasting(option);

        expect(fixture.repository.find).toHaveBeenCalledExactlyOnceWith({
            where: { startAt: LessThanOrEqual(now), endAt: MoreThanOrEqual(now) },
            order: { startAt: 'ASC' },
        });
    });
});
