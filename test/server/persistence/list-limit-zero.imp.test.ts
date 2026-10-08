import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFluentBuilder, immediateRun } from './db-unit-fakes';
import { loadCompiled, repositoryOperator } from './repository-harness';
import { silentLoggerModel } from '../harness/silent-logger-model';

type Pagination = { skip: number | undefined; take: number | undefined };
type Option = { offset?: number; limit?: number };

const DBUtil = loadCompiled<{
    UNLIMITED_TAKE: number;
    resolvePagination(option: Option): Pagination;
}>('model/db/DBUtil.js');
const RuleDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/RuleDB.js');
const RecordedDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/RecordedDB.js');
const RecordedTagDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/RecordedTagDB.js');
const ReserveDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/ReserveDB.js');

const relations = { isNeedVideoFiles: false, isNeedThumbnails: false, isNeedsDropLog: false, isNeedTags: false };

afterEach(() => {
    vi.restoreAllMocks();
});

describe('一覧の limit 0（件数の制限なし）の変換 (unittest/imp)', () => {
    it.each<[string, Option, Pagination]>([
        ['どちらも省略すると何も適用しない', {}, { skip: undefined, take: undefined }],
        ['limit だけなら take へそのまま渡す', { limit: 20 }, { skip: undefined, take: 20 }],
        ['offset と limit はそのまま渡す', { offset: 5, limit: 20 }, { skip: 5, take: 20 }],
        ['offset だけなら skip へそのまま渡す', { offset: 5 }, { skip: 5, take: undefined }],
        ['limit 0 は take を付けない', { limit: 0 }, { skip: undefined, take: undefined }],
        ['limit 0 と offset 0 は何も適用しない', { limit: 0, offset: 0 }, { skip: undefined, take: undefined }],
        [
            'limit 0 と offset 1 以上は十分大きな take で offset 以降の全件にする',
            { limit: 0, offset: 1 },
            { skip: 1, take: 2147483647 },
        ],
    ])('%s', (_name, option, expected) => {
        expect(DBUtil.resolvePagination(option)).toEqual(expected);
        expect(DBUtil.UNLIMITED_TAKE).toBe(2147483647);
    });
});

describe('一覧の limit 0 を各 DB 層が件数の制限なしにする (unittest/imp)', () => {
    const retry = { run: vi.fn(immediateRun) };

    it('RuleDB.findAll は limit 0 で take を呼ばず、offset 付きなら大きな take を付ける', async () => {
        for (const [option, skip, take] of [
            [{ limit: 0 }, [], []],
            [{ limit: 0, offset: 2 }, [[2]], [[2147483647]]],
        ] as const) {
            const builder = createFluentBuilder({ getManyAndCount: async () => [[], 0] });
            const connection = { getRepository: vi.fn(() => ({ createQueryBuilder: () => builder.builder })) };
            const provider = new RuleDB(silentLoggerModel, repositoryOperator(connection), retry);

            await provider.findAll(option);

            expect(builder.argsOf('skip')).toEqual(skip);
            expect(builder.argsOf('take')).toEqual(take);
        }
    });

    it('RuleDB.findKeyword は limit 0 で take を呼ばず、offset 付きなら大きな take を付ける', async () => {
        for (const [option, skip, take] of [
            [{ limit: 0 }, [], []],
            [{ limit: 0, offset: 2 }, [[2]], [[2147483647]]],
        ] as const) {
            const builder = createFluentBuilder({ getRawMany: async () => [] });
            const connection = { createQueryBuilder: vi.fn(() => builder.builder) };
            const provider = new RuleDB(silentLoggerModel, repositoryOperator(connection), retry);

            await provider.findKeyword(option);

            expect(builder.argsOf('skip')).toEqual(skip);
            expect(builder.argsOf('take')).toEqual(take);
        }
    });

    it('RecordedDB.findAll は limit 0 で take を呼ばず、offset 付きなら大きな take を付ける', async () => {
        for (const [option, skip, take] of [
            [{ limit: 0 }, [], []],
            [{ limit: 0, offset: 2 }, [[2]], [[2147483647]]],
        ] as const) {
            const builder = createFluentBuilder({ getManyAndCount: async () => [[], 0] });
            const connection = { getRepository: vi.fn(() => ({ createQueryBuilder: () => builder.builder })) };
            const provider = new RecordedDB(silentLoggerModel, repositoryOperator(connection), retry);

            await provider.findAll(option, relations);

            expect(builder.argsOf('skip')).toEqual(skip);
            expect(builder.argsOf('take')).toEqual(take);
        }
    });

    it('RecordedTagDB.findAll は limit 0 で take を呼ばず、offset 付きなら大きな take を付ける', async () => {
        for (const [option, skip, take] of [
            [{ limit: 0 }, [], []],
            [{ limit: 0, offset: 2 }, [[2]], [[2147483647]]],
        ] as const) {
            const builder = createFluentBuilder({ getManyAndCount: async () => [[], 0] });
            const connection = { getRepository: vi.fn(() => ({ createQueryBuilder: () => builder.builder })) };
            const provider = new RecordedTagDB(silentLoggerModel, repositoryOperator(connection), retry);

            await provider.findAll(option);

            expect(builder.argsOf('skip')).toEqual(skip);
            expect(builder.argsOf('take')).toEqual(take);
        }
    });

    it('ReserveDB.findAll は limit 0 で take を付けず、offset 付きなら大きな take を付ける', async () => {
        for (const [option, expected] of [
            [{ type: 'normal', limit: 0 }, {}],
            [
                { type: 'normal', limit: 0, offset: 2 },
                { skip: 2, take: 2147483647 },
            ],
        ] as const) {
            const findAndCount = vi.fn(async () => [[], 0]);
            const connection = { getRepository: vi.fn(() => ({ findAndCount })) };
            const provider = new ReserveDB(silentLoggerModel, repositoryOperator(connection), retry);

            await provider.findAll(option);

            expect(findAndCount).toHaveBeenCalledExactlyOnceWith({
                where: { isConflict: false, isSkip: false, isOverlap: false },
                ...expected,
                order: { startAt: 'ASC' },
            });
        }
    });
});
