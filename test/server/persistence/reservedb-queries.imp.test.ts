import { IsNull, LessThan, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFluentBuilder, immediateRun, loadEntity } from './db-unit-fakes';
import { loadCompiled, repositoryOperator } from './repository-harness';
import { silentLoggerModel } from '../harness/silent-logger-model';

type ReserveProvider = {
    insertOnce(reserve: object): Promise<number>;
    updateOnce(reserve: object): Promise<void>;
    findId(reserveId: number): Promise<unknown>;
    findAll(option: object): Promise<[unknown[], number]>;
    findLists(option?: object): Promise<unknown[]>;
    findProgramId(programId: number): Promise<unknown[]>;
    findOldTime(baseTime: number): Promise<unknown[]>;
    findTimeSpecification(option: object): Promise<unknown>;
};

const Reserve = loadEntity('Reserve');
const ReserveDB = loadCompiled<new (...arguments_: any[]) => ReserveProvider>('model/db/ReserveDB.js');

const makeProvider = (repositoryResults: Record<string, unknown> = {}, builder = createFluentBuilder()) => {
    const repository = Object.fromEntries(
        Object.entries(repositoryResults).map(([name, value]) => [name, vi.fn(async () => value)]),
    ) as Record<string, ReturnType<typeof vi.fn>>;
    const getRepository = vi.fn(() => repository);
    const connection = { getRepository, createQueryBuilder: vi.fn(() => builder.builder) };
    const retry = { run: vi.fn(immediateRun) };
    return {
        builder,
        getRepository,
        provider: new ReserveDB(silentLoggerModel, repositoryOperator(connection), retry),
        repository,
        retry,
    };
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ReserveDB single-row writes (unittest/imp)', () => {
    it('[3.1] insertOnce inserts into Reserve and returns the first generated id', async () => {
        const reserve = { programId: 3 };
        const builder = createFluentBuilder({ execute: async () => ({ identifiers: [{ id: 44 }, { id: 45 }] }) });
        const fixture = makeProvider({}, builder);

        await expect(fixture.provider.insertOnce(reserve)).resolves.toBe(44);

        expect(builder.methods()).toEqual(['insert', 'into', 'values', 'execute']);
        expect(builder.argsOf('into')).toEqual([[Reserve]]);
        expect(builder.argsOf('values')).toEqual([[reserve]]);
        expect(fixture.retry.run).toHaveBeenCalledOnce();
    });

    it('[3.1] updateOnce sets every field of the reserve on the row with the same id', async () => {
        const reserve = { id: 12, programId: 3 };
        const fixture = makeProvider();

        await expect(fixture.provider.updateOnce(reserve)).resolves.toBeUndefined();

        expect(fixture.builder.methods()).toEqual(['update', 'set', 'where', 'execute']);
        expect(fixture.builder.argsOf('update')).toEqual([[Reserve]]);
        expect(fixture.builder.argsOf('set')).toEqual([[reserve]]);
        expect(fixture.builder.argsOf('where')).toEqual([['id = :id', { id: 12 }]]);
        expect(fixture.retry.run).toHaveBeenCalledOnce();
    });
});

describe('ReserveDB lookups (unittest/imp)', () => {
    it.each([
        { found: { id: 9 }, expected: { id: 9 } },
        { found: undefined, expected: null },
    ])('[3.2] findId maps $found to $expected', async ({ found, expected }) => {
        const fixture = makeProvider({ findOne: found });

        await expect(fixture.provider.findId(9)).resolves.toEqual(expected);

        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(Reserve);
        expect(fixture.repository.findOne).toHaveBeenCalledExactlyOnceWith({ where: { id: 9 } });
    });

    it.each([
        { found: { id: 5 }, expected: { id: 5 } },
        { found: undefined, expected: null },
    ])('[3.2] findTimeSpecification maps $found to $expected', async ({ found, expected }) => {
        const fixture = makeProvider({ findOne: found });

        await expect(
            fixture.provider.findTimeSpecification({ channelId: 31, startAt: 100, endAt: 200 }),
        ).resolves.toEqual(expected);

        expect(fixture.repository.findOne).toHaveBeenCalledExactlyOnceWith({
            where: { channelId: 31, startAt: 100, endAt: 200, ruleId: IsNull() },
        });
    });

    it('[3.2] findProgramId returns the reserves of the program', async () => {
        const rows = [{ id: 1 }];
        const fixture = makeProvider({ find: rows });

        await expect(fixture.provider.findProgramId(77)).resolves.toBe(rows);

        expect(fixture.repository.find).toHaveBeenCalledExactlyOnceWith({ where: { programId: 77 } });
    });

    it('[3.2] findOldTime returns the reserves that ended before the base time', async () => {
        const rows = [{ id: 1 }];
        const fixture = makeProvider({ find: rows });

        await expect(fixture.provider.findOldTime(5000)).resolves.toBe(rows);

        expect(fixture.repository.find).toHaveBeenCalledExactlyOnceWith({ where: { endAt: LessThan(5000) } });
    });

    it('[3.2] findLists without an option reads every reserve', async () => {
        const rows = [{ id: 1 }];
        const fixture = makeProvider({ find: rows });

        await expect(fixture.provider.findLists()).resolves.toBe(rows);

        expect(fixture.repository.find).toHaveBeenCalledExactlyOnceWith();
    });

    it('[3.2] findLists with an option reads the reserves that overlap the time range', async () => {
        const rows = [{ id: 1 }];
        const fixture = makeProvider({ find: rows });

        await expect(fixture.provider.findLists({ startAt: 100, endAt: 200 })).resolves.toBe(rows);

        expect(fixture.repository.find).toHaveBeenCalledExactlyOnceWith({
            where: { startAt: LessThanOrEqual(200), endAt: MoreThanOrEqual(100) },
        });
    });
});

describe('ReserveDB.findAll conditions (unittest/imp)', () => {
    it.each([
        { type: undefined, where: {} },
        { type: 'normal', where: { isConflict: false, isSkip: false, isOverlap: false } },
        { type: 'conflict', where: { isConflict: true, isSkip: false, isOverlap: false } },
        { type: 'skip', where: { isConflict: false, isSkip: true, isOverlap: false } },
        { type: 'overlap', where: { isConflict: false, isSkip: false, isOverlap: true } },
    ])('[3.3] type=$type selects the matching state flags and orders by start time', async ({ type, where }) => {
        const tuple: [unknown[], number] = [[{ id: 1 }], 30];
        const fixture = makeProvider({ findAndCount: tuple });

        await expect(fixture.provider.findAll({ type })).resolves.toBe(tuple);

        expect(fixture.repository.findAndCount).toHaveBeenCalledExactlyOnceWith({
            where,
            order: { startAt: 'ASC' },
        });
    });

    it('[3.3] adds the rule id, offset and limit as skip and take', async () => {
        const fixture = makeProvider({ findAndCount: [[], 0] });

        await fixture.provider.findAll({ type: 'normal', ruleId: 6, offset: 10, limit: 5 });

        expect(fixture.repository.findAndCount).toHaveBeenCalledExactlyOnceWith({
            where: { isConflict: false, isSkip: false, isOverlap: false, ruleId: 6 },
            skip: 10,
            take: 5,
            order: { startAt: 'ASC' },
        });
    });
});

describe('ReserveDB.findTimeRanges exclusions (unittest/imp)', () => {
    const makeRangeProvider = (rows: unknown[]) => {
        const builder = createFluentBuilder({ getMany: async () => rows });
        const createQueryBuilder = vi.fn(() => builder.builder);
        const connection = { getRepository: vi.fn(() => ({ createQueryBuilder })) };
        const provider = new ReserveDB(silentLoggerModel, repositoryOperator(connection), { run: vi.fn(immediateRun) });
        return { builder, createQueryBuilder, provider };
    };

    it('[3.3] keeps separate ranges, drops overlap and rule exclusions in order, and returns the rows', async () => {
        const rows = [{ id: 3 }];
        const fixture = makeRangeProvider(rows);

        await expect(
            fixture.provider.findTimeRanges({
                times: [
                    { startAt: 1000, endAt: 2000 },
                    { startAt: 5000, endAt: 6000 },
                ],
                hasSkip: true,
                hasConflict: true,
                hasOverlap: false,
                excludeRuleId: 12,
            }),
        ).resolves.toBe(rows);

        expect(fixture.createQueryBuilder).toHaveBeenCalledExactlyOnceWith('reserve');
        expect(fixture.builder.argsOf('where')).toEqual([
            [
                '((reserve.endAt >= :startAt0 and reserve.startAt < :endAt0) or (reserve.endAt >= :startAt1 and reserve.startAt < :endAt1))',
                { startAt0: 1000, endAt0: 2000, startAt1: 5000, endAt1: 6000 },
            ],
        ]);
        expect(fixture.builder.argsOf('andWhere')).toEqual([
            ['reserve.isOverlap = :isOverlap', { isOverlap: false }],
            ['(reserve.ruleId <> :ruleId or reserve.ruleId is null)', { ruleId: 12 }],
        ]);
        expect(fixture.builder.argsOf('orderBy')).toEqual([['reserve.startAt', 'ASC']]);
    });
});
