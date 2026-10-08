import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFluentBuilder, immediateRun, loadEntity } from './db-unit-fakes';
import { loadCompiled, repositoryOperator } from './repository-harness';

type RecordedProvider = {
    removeRecording(recordedId: number): Promise<void>;
    changeProtect(recordedId: number, isProtect: boolean): Promise<void>;
    findIds(recordedIds: number[], columnOption?: object, isReverse?: boolean): Promise<unknown[]>;
    findAll(option: object, columnOption: object): Promise<[unknown[], number]>;
    findChannelList(): Promise<unknown[]>;
    findGenreList(): Promise<unknown[]>;
    findReserveId(reserveId: number): Promise<unknown[]>;
};

const Recorded = loadEntity('Recorded');
const RecordedDB = loadCompiled<new (...arguments_: any[]) => RecordedProvider>('model/db/RecordedDB.js');

const noRelations = { isNeedVideoFiles: false, isNeedThumbnails: false, isNeedsDropLog: false, isNeedTags: false };
const allRelations = { isNeedVideoFiles: true, isNeedThumbnails: true, isNeedsDropLog: true, isNeedTags: true };

/** Repository query builders are handed out in order, so a re-fetch gets its own builder. */
const makeProvider = (builders: ReturnType<typeof createFluentBuilder>[], updateBuilder = createFluentBuilder()) => {
    const queue = [...builders];
    const getRepository = vi.fn(() => ({ createQueryBuilder: vi.fn(() => queue.shift()?.builder) }));
    const connection = { getRepository, createQueryBuilder: vi.fn(() => updateBuilder.builder) };
    const retry = { run: vi.fn(immediateRun) };
    return {
        connection,
        getRepository,
        provider: new RecordedDB(repositoryOperator(connection), retry),
        retry,
        updateBuilder,
    };
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('RecordedDB record updates (unittest/imp)', () => {
    it('[3.1] removeRecording clears isRecording on the row found by id through the common retry', async () => {
        const find = createFluentBuilder({ getMany: async () => [{ id: 7, isRecording: true }] });
        const fixture = makeProvider([find]);

        await expect(fixture.provider.removeRecording(7)).resolves.toBeUndefined();

        expect(fixture.updateBuilder.methods()).toEqual(['update', 'set', 'where', 'execute']);
        expect(fixture.updateBuilder.argsOf('update')).toEqual([[Recorded]]);
        expect(fixture.updateBuilder.argsOf('set')).toEqual([[{ isRecording: false }]]);
        expect(fixture.updateBuilder.argsOf('where')).toEqual([[{ id: 7 }]]);
        expect(fixture.retry.run).toHaveBeenCalledTimes(2);
    });

    it.each([
        { current: false, request: true },
        { current: true, request: false },
    ])(
        '[3.1] changeProtect writes isProtected=$request when the stored value is $current',
        async ({ current, request }) => {
            const find = createFluentBuilder({
                getMany: async () => [{ id: 8, isRecording: false, isProtected: current }],
            });
            const fixture = makeProvider([find]);

            await expect(fixture.provider.changeProtect(8, request)).resolves.toBeUndefined();

            expect(fixture.updateBuilder.argsOf('update')).toEqual([[Recorded]]);
            expect(fixture.updateBuilder.argsOf('set')).toEqual([[{ isProtected: request }]]);
            expect(fixture.updateBuilder.argsOf('where')).toEqual([[{ id: 8 }]]);
            expect(fixture.updateBuilder.methods().at(-1)).toBe('execute');
        },
    );
});

describe('RecordedDB.findIds ordering (unittest/imp)', () => {
    it.each([
        { isReverse: true, direction: 'ASC' },
        { isReverse: false, direction: 'DESC' },
    ])('[3.3] orders by startAt $direction when isReverse is $isReverse', async ({ isReverse, direction }) => {
        const rows = [{ id: 1 }, { id: 2 }];
        const builder = createFluentBuilder({ getMany: async () => rows });
        const fixture = makeProvider([builder]);

        await expect(fixture.provider.findIds([1, 2], noRelations, isReverse)).resolves.toBe(rows);

        expect(builder.argsOf('orderBy')).toEqual([['recorded.startAt', direction]]);
        expect(builder.argsOf('leftJoinAndSelect')).toEqual([]);
    });
});

describe('RecordedDB.findAll filters and relations (unittest/imp)', () => {
    it('[3.3] applies no filter, no paging and the DESC default, returning the count tuple unchanged', async () => {
        const tuple: [unknown[], number] = [[{ id: 1 }], 41];
        const builder = createFluentBuilder({ getManyAndCount: async () => tuple });
        const fixture = makeProvider([builder]);

        await expect(fixture.provider.findAll({}, noRelations)).resolves.toBe(tuple);

        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(Recorded);
        expect(builder.methods()).toEqual(['orderBy', 'getManyAndCount']);
        expect(builder.argsOf('orderBy')).toEqual([['recorded.startAt', 'DESC']]);
    });

    it('[3.3] translates isRecording, ruleId, channelId, genre, offset, limit and reverse order', async () => {
        const builder = createFluentBuilder({ getManyAndCount: async () => [[], 0] });
        const fixture = makeProvider([builder]);

        await fixture.provider.findAll(
            { isRecording: false, ruleId: 5, channelId: 31, genre: 7, offset: 20, limit: 10, isReverse: true },
            noRelations,
        );

        expect(builder.argsOf('andWhere')).toEqual([
            ['recorded.isRecording = :isRecording', { isRecording: false }],
            ['recorded.ruleId = :ruleId', { ruleId: 5 }],
            ['recorded.channelId = :channelId', { channelId: 31 }],
            ['(genre1 = :genre or genre2 = :genre or genre3 = :genre)', { genre: 7 }],
        ]);
        expect(builder.argsOf('skip')).toEqual([[20]]);
        expect(builder.argsOf('take')).toEqual([[10]]);
        expect(builder.argsOf('orderBy')).toEqual([['recorded.startAt', 'ASC']]);
    });

    it('[3.3] selects rows without a rule when ruleId is 0', async () => {
        const builder = createFluentBuilder({ getManyAndCount: async () => [[], 0] });
        const fixture = makeProvider([builder]);

        await fixture.provider.findAll({ ruleId: 0 }, noRelations);

        expect(builder.argsOf('andWhere')).toEqual([['recorded.ruleId is null', {}]]);
    });

    it('[3.3] converts the keyword to half width, splits on spaces and ORs the name and description conditions', async () => {
        const builder = createFluentBuilder({ getManyAndCount: async () => [[], 0] });
        const fixture = makeProvider([builder]);

        await fixture.provider.findAll({ keyword: 'ＡＢ cd' }, noRelations);

        const [[query, values]] = builder.argsOf('andWhere') as [[string, Record<string, string>]];
        expect(values).toEqual({ keywordName0: '%AB%', keywordName1: '%cd%' });
        expect(query).toBe(
            '(((((halfWidthName like :keywordName0) and (halfWidthName like :keywordName1)))) or' +
                '((((halfWidthDescription like :keywordName0) and (halfWidthDescription like :keywordName1)))))',
        );
    });

    it('[3.4] joins every requested relation after ordering when no original-file filter is asked', async () => {
        const builder = createFluentBuilder({ getManyAndCount: async () => [[], 0] });
        const fixture = makeProvider([builder]);

        await fixture.provider.findAll({}, allRelations);

        expect(builder.argsOf('leftJoinAndSelect')).toEqual([
            ['recorded.videoFiles', 'videoFiles'],
            ['recorded.thumbnails', 'thumbnails'],
            ['recorded.dropLogFile', 'dropLogFile'],
            ['recorded.tags', 'tags'],
        ]);
        expect(builder.argsOf('andWhere')).toEqual([]);
    });

    it('[3.4] excludes encoded video files then re-fetches the matched ids when hasOriginalFile is set', async () => {
        const main = createFluentBuilder({ getManyAndCount: async () => [[{ id: 3 }, { id: 4 }], 9] });
        const refetched = [{ id: 4 }, { id: 3 }];
        const refetch = createFluentBuilder({ getMany: async () => refetched });
        const fixture = makeProvider([main, refetch]);

        const result = await fixture.provider.findAll({ hasOriginalFile: true, isReverse: true }, allRelations);

        expect(main.argsOf('andWhere')).toEqual([['videoFiles.type <> :type', { type: 'encoded' }]]);
        expect(main.argsOf('leftJoinAndSelect')).toEqual([['recorded.videoFiles', 'videoFiles']]);
        expect(refetch.argsOf('leftJoinAndSelect')).toEqual([
            ['recorded.videoFiles', 'videoFiles'],
            ['recorded.thumbnails', 'thumbnails'],
            ['recorded.dropLogFile', 'dropLogFile'],
            ['recorded.tags', 'tags'],
        ]);
        expect(refetch.argsOf('orderBy')).toEqual([['recorded.startAt', 'ASC']]);
        expect(result).toEqual([refetched, 9]);
    });

    it('[3.4] keeps the original-file query free of the type filter and the video join when video files are not requested', async () => {
        const main = createFluentBuilder({ getManyAndCount: async () => [[{ id: 3 }], 1] });
        const refetch = createFluentBuilder({ getMany: async () => [{ id: 3 }] });
        const fixture = makeProvider([main, refetch]);

        await expect(fixture.provider.findAll({ hasOriginalFile: true }, noRelations)).resolves.toEqual([
            [{ id: 3 }],
            1,
        ]);

        expect(main.argsOf('andWhere')).toEqual([]);
        expect(main.argsOf('leftJoinAndSelect')).toEqual([]);
        expect(refetch.argsOf('where')).toHaveLength(1);
    });

    it('[3.4] joins video files without the type filter when hasOriginalFile is not requested', async () => {
        const builder = createFluentBuilder({ getManyAndCount: async () => [[], 0] });
        const fixture = makeProvider([builder]);

        await fixture.provider.findAll({ hasOriginalFile: false }, { ...noRelations, isNeedVideoFiles: true });

        expect(builder.argsOf('andWhere')).toEqual([]);
        expect(builder.argsOf('leftJoinAndSelect')).toEqual([['recorded.videoFiles', 'videoFiles']]);
    });
});

describe('RecordedDB aggregate and reserve queries (unittest/imp)', () => {
    it('[3.2] findChannelList groups the recorded rows by channelId and returns the raw rows', async () => {
        const raw = [{ cnt: 2, channelId: 31 }];
        const builder = createFluentBuilder({ getRawMany: async () => raw });
        const fixture = makeProvider([builder]);

        await expect(fixture.provider.findChannelList()).resolves.toBe(raw);

        expect(builder.argsOf('select')).toEqual([['count(*) as cnt, channelId']]);
        expect(builder.argsOf('groupBy')).toEqual([['channelId']]);
        expect(fixture.retry.run).toHaveBeenCalledOnce();
    });

    it('[3.2] findGenreList counts rows that have a genre1 and groups them by genre', async () => {
        const raw = [{ cnt: 3, genre: 1 }];
        const builder = createFluentBuilder({ getRawMany: async () => raw });
        const fixture = makeProvider([builder]);

        await expect(fixture.provider.findGenreList()).resolves.toBe(raw);

        expect(builder.argsOf('select')).toEqual([['count(*) as cnt, genre1 as genre']]);
        expect(builder.argsOf('groupBy')).toEqual([['genre']]);
        const [[where]] = builder.argsOf('where') as [[{ genre1: { type: string; child?: { type: string } } }]];
        expect(where.genre1.type).toBe('not');
        expect(where.genre1.child?.type).toBe('isNull');
    });

    it('[3.4] findReserveId returns the recorded rows of a reserve with all four relations', async () => {
        const rows = [{ id: 9, reserveId: 77 }];
        const builder = createFluentBuilder({ getMany: async () => rows });
        const fixture = makeProvider([builder]);

        await expect(fixture.provider.findReserveId(77)).resolves.toBe(rows);

        expect(builder.argsOf('where')).toEqual([[{ reserveId: 77 }]]);
        expect(builder.argsOf('leftJoinAndSelect')).toEqual([
            ['recorded.videoFiles', 'videoFiles'],
            ['recorded.thumbnails', 'thumbnails'],
            ['recorded.dropLogFile', 'dropLogFile'],
            ['recorded.tags', 'tags'],
        ]);
    });
});
