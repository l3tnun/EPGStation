import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDialectPersistence, type DatabaseDialect } from '../fixtures/reservation-rules/runtime';

interface RuleOption {
    encodeOption?: Record<string, unknown>;
    id?: number;
    isTimeSpecification: boolean;
    reserveOption: Record<string, unknown>;
    saveOption?: Record<string, unknown>;
    searchOption: Record<string, unknown>;
    updateCnt?: number;
}

type StoredRule = Record<string, unknown> & { id: number; updateCnt: number };

interface RuleRepository {
    deleteOnce(ruleId: number): Promise<void>;
    disableOnce(ruleId: number): Promise<void>;
    enableOnce(ruleId: number): Promise<void>;
    findId(ruleId: number, isNeedCnt?: boolean): Promise<RuleOption | null>;
    insertOnce(rule: RuleOption): Promise<number>;
    updateOnce(rule: RuleOption & { id: number }): Promise<void>;
}

interface RuleRepositoryConstructor {
    new (operator: unknown, retry: unknown): RuleRepository;
}

interface RuleManager {
    delete(ruleId: number): Promise<void>;
    disable(ruleId: number): Promise<void>;
    enable(ruleId: number): Promise<void>;
    update(rule: RuleOption & { id: number }): Promise<void>;
}

interface RuleManagerConstructor {
    new (logger: unknown, checker: unknown, repository: unknown, event: unknown): RuleManager;
}

interface RuleOptionChecker {
    checkRuleOption(rule: RuleOption): boolean;
}

interface RuleOptionCheckerConstructor {
    new (configuration: unknown): RuleOptionChecker;
}

interface RuleQueryApi {
    get(ruleId: number): Promise<RuleOption | null>;
    gets(
        option: Record<string, unknown>,
    ): Promise<{ rules: Array<RuleOption & { id: number; reservesCnt?: number }>; total: number }>;
    searchKeyword(option: Record<string, unknown>): Promise<Array<{ id: number; keyword: string }>>;
}

interface RuleQueryApiConstructor {
    new (ipc: unknown, repository: unknown, reservationCountPort: unknown): RuleQueryApi;
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
}

interface PersistenceQueryBuilder {
    delete(): PersistenceQueryBuilder;
    execute(): Promise<{ affected?: number; identifiers?: Array<{ id: number }> }>;
    from(entity: unknown): PersistenceQueryBuilder;
    insert(): PersistenceQueryBuilder;
    into(entity: unknown): PersistenceQueryBuilder;
    set(values: Record<string, unknown>): PersistenceQueryBuilder;
    update(entity: unknown): PersistenceQueryBuilder;
    values(values: Record<string, unknown>): PersistenceQueryBuilder;
    where(clause: string, parameters: { id: number }): PersistenceQueryBuilder;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const RuleDB = (
    require(join(compiledSnapshot, 'model', 'db', 'RuleDB.js')) as {
        default: RuleRepositoryConstructor;
    }
).default;
const RuleManageModel = (
    require(join(compiledSnapshot, 'model', 'operator', 'rule', 'RuleManageModel.js')) as {
        default: RuleManagerConstructor;
    }
).default;
const ReserveOptionChecker = (
    require(join(compiledSnapshot, 'model', 'operator', 'ReserveOptionChecker.js')) as {
        default: RuleOptionCheckerConstructor;
    }
).default;
const RuleApiModel = (
    require(join(compiledSnapshot, 'model', 'api', 'rule', 'RuleApiModel.js')) as {
        default: RuleQueryApiConstructor;
    }
).default;

const logger = { system: { error: vi.fn(), info: vi.fn() } };
const loggerModel = { getLogger: () => logger };
const configuration = {
    getConfig: () => ({
        encode: [
            { name: 'archive', cmd: 'synthetic-archive' },
            { name: 'mobile', cmd: 'synthetic-mobile' },
            { name: 'review', cmd: 'synthetic-review' },
        ],
    }),
};

const programRule = (): RuleOption => ({
    isTimeSpecification: false,
    searchOption: {
        keyword: 'Ｓynthetic keyword',
        ignoreKeyword: 'Ｓynthetic exclusion',
        keyCS: true,
        keyRegExp: false,
        name: true,
        description: true,
        extended: true,
        ignoreKeyCS: false,
        ignoreKeyRegExp: true,
        ignoreName: true,
        ignoreDescription: false,
        ignoreExtended: false,
        channelIds: [101, 202],
        genres: [
            { genre: 0, subGenre: 1 },
            { genre: 15, subGenre: 15 },
        ],
        times: [{ week: 0x7f, start: 0, range: 23 }],
        isFree: true,
        durationMin: 0,
        durationMax: 7_200_000,
        searchPeriods: [{ startAt: 1_000, endAt: 2_000 }],
    },
    reserveOption: {
        enable: true,
        allowEndLack: true,
        avoidDuplicate: true,
        periodToAvoidDuplicate: 86_400_000,
        tags: [7, 8],
    },
    saveOption: {
        parentDirectoryName: 'synthetic-parent',
        directory: 'synthetic/program',
        recordedFormat: 'synthetic-format',
    },
    encodeOption: {
        mode1: 'archive',
        encodeParentDirectoryName1: 'synthetic-encoded-parent',
        directory1: 'synthetic/archive',
        mode2: 'mobile',
        directory2: 'synthetic/mobile',
        mode3: 'review',
        directory3: 'synthetic/review',
        isDeleteOriginalAfterEncode: true,
    },
});

const timeRule = (): RuleOption => ({
    isTimeSpecification: true,
    searchOption: {
        keyword: 'synthetic time rule',
        channelIds: [],
        times: [
            { week: 0, start: 0, range: 1 },
            { week: 0x40, start: 172_800, range: 90_000 },
        ],
    },
    reserveOption: {
        enable: false,
        allowEndLack: false,
        avoidDuplicate: false,
        tags: [],
    },
    saveOption: {
        parentDirectoryName: 'synthetic-time-parent',
        directory: 'synthetic/time',
        recordedFormat: 'synthetic-time-format',
    },
    encodeOption: {
        isDeleteOriginalAfterEncode: false,
    },
});

const programProjection = (id: number, updateCnt?: number): RuleOption => {
    const input = programRule();
    return {
        ...input,
        id,
        ...(updateCnt === undefined ? {} : { updateCnt }),
        searchOption: {
            ...input.searchOption,
            GR: false,
            BS: false,
            CS: false,
            SKY: false,
            BS4K: false,
        },
    };
};

const timeProjection = (id: number, updateCnt?: number): RuleOption => {
    const input = timeRule();
    return {
        id,
        ...(updateCnt === undefined ? {} : { updateCnt }),
        isTimeSpecification: true,
        searchOption: {
            keyword: input.searchOption.keyword,
            channelIds: input.searchOption.channelIds,
            times: input.searchOption.times,
            keyCS: false,
            keyRegExp: false,
            name: false,
            description: false,
            extended: false,
            ignoreKeyCS: false,
            ignoreKeyRegExp: false,
            ignoreName: false,
            ignoreDescription: false,
            ignoreExtended: false,
            GR: false,
            BS: false,
            CS: false,
            SKY: false,
            BS4K: false,
            isFree: false,
        },
        reserveOption: clone(input.reserveOption),
        saveOption: clone(input.saveOption),
    };
};

const clone = <T>(value: T): T => structuredClone(value);

const deferred = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const makePersistenceBoundary = (firstGeneratedId = 41) => {
    const rows = new Map<number, StoredRule>();
    let nextId = firstGeneratedId;
    let operation: 'delete' | 'insert' | 'update' | undefined;
    let values: Record<string, unknown> | undefined;
    let whereId: number | undefined;

    const queryBuilder: PersistenceQueryBuilder = {
        delete: vi.fn(() => {
            operation = 'delete';
            return queryBuilder;
        }),
        execute: vi.fn(async () => {
            if (operation === 'insert' && values !== undefined) {
                const id = nextId++;
                rows.set(id, { ...clone(values), id, updateCnt: (values.updateCnt as number | undefined) ?? 0 });
                return { identifiers: [{ id }] };
            }
            if (operation === 'update' && values !== undefined && whereId !== undefined) {
                const current = rows.get(whereId);
                if (current !== undefined)
                    rows.set(whereId, { ...current, ...clone(values), id: whereId } as StoredRule);
                return { affected: current === undefined ? 0 : 1 };
            }
            if (operation === 'delete' && whereId !== undefined) {
                return { affected: rows.delete(whereId) ? 1 : 0 };
            }
            throw new Error('Unexpected persistence boundary operation');
        }),
        from: vi.fn(() => queryBuilder),
        insert: vi.fn(() => {
            operation = 'insert';
            return queryBuilder;
        }),
        into: vi.fn(() => queryBuilder),
        set: vi.fn((nextValues: Record<string, unknown>) => {
            values = nextValues;
            return queryBuilder;
        }),
        update: vi.fn(() => {
            operation = 'update';
            return queryBuilder;
        }),
        values: vi.fn((nextValues: Record<string, unknown>) => {
            values = nextValues;
            return queryBuilder;
        }),
        where: vi.fn((_clause: string, parameters: { id: number }) => {
            whereId = parameters.id;
            return queryBuilder;
        }),
    };
    const repository = {
        findOne: vi.fn(async ({ where }: { where: { id: number } }) => {
            const row = rows.get(where.id);
            return row === undefined ? null : clone(row);
        }),
    };
    const connection = {
        createQueryBuilder: vi.fn(() => {
            operation = undefined;
            values = undefined;
            whereId = undefined;
            return queryBuilder;
        }),
        getRepository: vi.fn(() => repository),
    };
    const operator = { getConnection: vi.fn(async () => connection) };
    const retry = { run: vi.fn(async <T>(job: () => Promise<T>) => job()) };
    const ruleDB = new RuleDB(operator, retry);

    return { queryBuilder, retry, rows, ruleDB };
};

const makeCoordinatorRepository = () => ({
    deleteOnce: vi.fn<(ruleId: number) => Promise<void>>().mockResolvedValue(undefined),
    disableOnce: vi.fn<(ruleId: number) => Promise<void>>().mockResolvedValue(undefined),
    enableOnce: vi.fn<(ruleId: number) => Promise<void>>().mockResolvedValue(undefined),
    findId: vi.fn<(ruleId: number) => Promise<RuleOption | null>>().mockResolvedValue(null),
    insertOnce: vi.fn<(rule: RuleOption) => Promise<number>>(),
    updateOnce: vi.fn<(rule: RuleOption & { id: number }) => Promise<void>>().mockResolvedValue(undefined),
});

const makeCoordinatorHarness = (repository = makeCoordinatorRepository()) => {
    const event = {
        emitAdded: vi.fn<(ruleId: number) => void>(),
        emitDeleted: vi.fn<(ruleId: number) => void>(),
        emitDisabled: vi.fn<(ruleId: number) => void>(),
        emitEnabled: vi.fn<(ruleId: number) => void>(),
        emitUpdated: vi.fn<(ruleId: number) => void>(),
    };
    const manager = new RuleManageModel(loggerModel, new ReserveOptionChecker(configuration), repository, event);
    return { event, manager, repository };
};

const expectNoCoordinatorEvent = (event: ReturnType<typeof makeCoordinatorHarness>['event']): void => {
    expect(Object.values(event).every(spy => spy.mock.calls.length === 0)).toBe(true);
};

const coordinatorMutationMethods = ['updateOnce', 'enableOnce', 'disableOnce', 'deleteOnce'] as const;

const expectOnlyCoordinatorMutation = (
    repository: ReturnType<typeof makeCoordinatorRepository>,
    expectedMethod: (typeof coordinatorMutationMethods)[number],
): void => {
    expect(repository.insertOnce).not.toHaveBeenCalled();
    for (const method of coordinatorMutationMethods) {
        if (method === expectedMethod) {
            expect(repository[method]).toHaveBeenCalledOnce();
        } else {
            expect(repository[method]).not.toHaveBeenCalled();
        }
    }
};

const expectOnlyCoordinatorEvent = (
    event: ReturnType<typeof makeCoordinatorHarness>['event'],
    expectedMethod: 'emitDeleted' | 'emitDisabled' | 'emitEnabled' | 'emitUpdated',
    ruleId: number,
): void => {
    for (const [method, spy] of Object.entries(event)) {
        if (method === expectedMethod) {
            expect(spy).toHaveBeenCalledOnce();
            expect(spy).toHaveBeenCalledWith(ruleId);
        } else {
            expect(spy).not.toHaveBeenCalled();
        }
    }
};

const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('rule management specification characterization', () => {
    it('[RR-1.1] preserves distinct program and time Rule projections', async () => {
        for (const [_name, makeRule, makeProjection, generatedId, isTimeSpecification] of [
            ['program', programRule, programProjection, 41, false],
            ['time', timeRule, timeProjection, 42, true],
        ] as const) {
            const { rows, ruleDB } = makePersistenceBoundary(generatedId);
            const input = makeRule();

            await expect(ruleDB.insertOnce(input)).resolves.toBe(generatedId);

            const stored = rows.get(generatedId);
            expect(stored).toMatchObject({
                id: generatedId,
                updateCnt: 0,
                isTimeSpecification,
                enable: input.reserveOption.enable,
                allowEndLack: input.reserveOption.allowEndLack,
                avoidDuplicate: input.reserveOption.avoidDuplicate,
                channelIds: JSON.stringify(input.searchOption.channelIds),
                times: JSON.stringify(input.searchOption.times),
                tags: JSON.stringify(input.reserveOption.tags),
            });
            expect(stored).not.toHaveProperty('searchOption');
            expect(stored).not.toHaveProperty('reserveOption');
            if (isTimeSpecification === false) {
                expect(stored).toMatchObject({
                    halfWidthKeyword: 'Synthetic keyword',
                    genres: JSON.stringify(input.searchOption.genres),
                    searchPeriods: JSON.stringify(input.searchOption.searchPeriods),
                });
            }

            await expect(ruleDB.findId(generatedId)).resolves.toEqual(makeProjection(generatedId));
            await expect(ruleDB.findId(generatedId, true)).resolves.toEqual(makeProjection(generatedId, 0));
        }
    });

    it('[RR-1.2] assigns and persists the generated Rule ID', async () => {
        const { rows, ruleDB } = makePersistenceBoundary(43);

        await expect(ruleDB.insertOnce(programRule())).resolves.toBe(43);

        expect(rows.get(43)).toMatchObject({ id: 43, isTimeSpecification: false, updateCnt: 0 });
    });

    it('[RR-1.3] replaces a stored time rule with a program projection and increments updateCnt', async () => {
        const { rows, ruleDB } = makePersistenceBoundary(51);
        const id = await ruleDB.insertOnce(timeRule());
        const replacement = { ...programRule(), id };

        await expect(ruleDB.updateOnce(replacement)).resolves.toBeUndefined();

        expect(rows.get(id)).toMatchObject({
            id,
            updateCnt: 1,
            isTimeSpecification: false,
            channelIds: JSON.stringify(replacement.searchOption.channelIds),
            genres: JSON.stringify(replacement.searchOption.genres),
            times: JSON.stringify(replacement.searchOption.times),
            tags: JSON.stringify(replacement.reserveOption.tags),
        });
        await expect(ruleDB.findId(id, true)).resolves.toEqual(programProjection(id, 1));
    });

    it('[RR-1.4] changes state and updateCnt only when the requested state differs', async () => {
        const { queryBuilder, rows, ruleDB } = makePersistenceBoundary(61);
        const id = await ruleDB.insertOnce(timeRule());

        await ruleDB.enableOnce(id);
        expect(rows.get(id)).toMatchObject({ enable: true, updateCnt: 1 });
        await ruleDB.enableOnce(id);
        expect(rows.get(id)).toMatchObject({ enable: true, updateCnt: 1 });

        await ruleDB.disableOnce(id);
        expect(rows.get(id)).toMatchObject({ enable: false, updateCnt: 2 });
        await ruleDB.disableOnce(id);
        expect(rows.get(id)).toMatchObject({ enable: false, updateCnt: 2 });
        expect(queryBuilder.update).toHaveBeenCalledTimes(2);
    });

    it('[RR-1.5] deletes only the requested stored row', async () => {
        const { rows, ruleDB } = makePersistenceBoundary(71);
        const firstId = await ruleDB.insertOnce(programRule());
        const secondId = await ruleDB.insertOnce(timeRule());

        await expect(ruleDB.deleteOnce(firstId)).resolves.toBeUndefined();

        expect(rows.has(firstId)).toBe(false);
        expect(rows.has(secondId)).toBe(true);
        await expect(ruleDB.findId(firstId)).resolves.toBeNull();
        await expect(ruleDB.findId(secondId)).resolves.toMatchObject({ id: secondId, isTimeSpecification: true });
    });

    it.each([
        ['update', (ruleDB: RuleRepository) => ruleDB.updateOnce({ ...programRule(), id: 81 })],
        ['enable', (ruleDB: RuleRepository) => ruleDB.enableOnce(82)],
        ['disable', (ruleDB: RuleRepository) => ruleDB.disableOnce(83)],
    ] as const)('rejects %s when the stored row does not exist', async (_name, operation) => {
        const { rows, ruleDB } = makePersistenceBoundary();

        await expect(operation(ruleDB)).rejects.toThrow('RuleIsNull');

        expect(rows.size).toBe(0);
    });
});

describe('rule list and keyword query specification characterization', () => {
    // Exercises both the sqlite and mysql dialects with real persistence fixtures in one case; that real
    // dual-dialect DB setup/teardown work reliably approaches Vitest's default 5000ms testTimeout under
    // full-suite contention, so this needs an explicit, generous budget.
    it('[RR-1.6] preserves actual detail, token AND, paging, total, ID order, and type count in both dialects', async () => {
        for (const dialect of ['sqlite', 'mysql'] as DatabaseDialect[]) {
            const fixtureStartedAt = Date.now();
            const fixture = await createDialectPersistence(dialect);
            console.error(`[timing] createDialectPersistence(${dialect}): ${Date.now() - fixtureStartedAt}ms`);
            try {
                const first = programRule();
                first.id = 3;
                first.searchOption.keyword = 'Alpha Beta';
                const second = timeRule();
                second.id = 5;
                second.searchOption.keyword = 'Alpha Beta';
                const third = programRule();
                third.id = 8;
                third.searchOption.keyword = 'Alpha only';
                await fixture.ruleDB.insertOnce(first);
                await fixture.ruleDB.insertOnce(second);
                await fixture.ruleDB.insertOnce(third);
                const reservationCountPort = {
                    countByRuleIds: vi.fn(async () => [{ ruleId: 5, count: 2 }]),
                };
                const api = new RuleApiModel({}, fixture.ruleDB, reservationCountPort);

                await expect(api.get(3)).resolves.toMatchObject({ id: 3, isTimeSpecification: false });
                await expect(api.get(404)).resolves.toBeNull();
                await expect(api.gets({ keyword: 'Alpha Beta', offset: 1, limit: 1, type: 'normal' })).resolves.toEqual(
                    {
                        rules: [expect.objectContaining({ id: 5, reservesCnt: 2 })],
                        total: 2,
                    },
                );
                expect(reservationCountPort.countByRuleIds).toHaveBeenCalledWith([5], 'normal');
                await expect(api.gets({ keyword: 'Alpha Beta', offset: 0, limit: 2 })).resolves.toEqual({
                    rules: [expect.objectContaining({ id: 3 }), expect.objectContaining({ id: 5 })],
                    total: 2,
                });
                await expect(api.gets({ offset: 99, limit: 1 })).resolves.toEqual({ rules: [], total: 3 });
                expect(reservationCountPort.countByRuleIds).toHaveBeenCalledTimes(1);
            } finally {
                await fixture.cleanup();
            }
        }
    }, 20_000);

    it('[RR-1.7] returns program and time Rule keywords separately in ascending ID order', async () => {
        const fixture = await createDialectPersistence('sqlite');
        try {
            const program = programRule();
            program.id = 7;
            program.searchOption = { keyword: 'same keyword' };
            const time = timeRule();
            time.id = 3;
            time.searchOption = { channelIds: [], keyword: 'same keyword', times: [] };
            await fixture.ruleDB.insertOnce(program);
            await fixture.ruleDB.insertOnce(time);
            const api = new RuleApiModel({}, fixture.ruleDB, { countByRuleIds: vi.fn() });

            await expect(api.searchKeyword({ keyword: 'same' })).resolves.toEqual([
                { id: 3, keyword: 'same keyword' },
                { id: 7, keyword: 'same keyword' },
            ]);
        } finally {
            await fixture.cleanup();
        }
    });

    it.each(['all', 'normal', 'conflict', 'skip', 'overlap'] as const)(
        'sends the page IDs and canonical %s filter once and projects unordered partial counts in Rule order',
        async filter => {
            const rules = [{ id: 3 }, { id: 7 }, { id: 9 }];
            const repository = {
                findAll: vi.fn(async () => [rules, 91] as const),
            };
            const counts = Object.freeze([
                Object.freeze({ ruleId: 9, count: 2 }),
                Object.freeze({ ruleId: 3, count: 4 }),
            ]);
            const reservationCountPort = {
                countByRuleIds: vi.fn(async () => counts),
            };
            const api = new RuleApiModel({}, repository, reservationCountPort);

            await expect(api.gets({ type: filter })).resolves.toEqual({
                rules: [
                    { id: 3, reservesCnt: 4 },
                    { id: 7, reservesCnt: 0 },
                    { id: 9, reservesCnt: 2 },
                ],
                total: 91,
            });

            expect(reservationCountPort.countByRuleIds).toHaveBeenCalledOnce();
            expect(reservationCountPort.countByRuleIds).toHaveBeenCalledWith([3, 7, 9], filter);
            expect(counts).toEqual([
                { ruleId: 9, count: 2 },
                { ruleId: 3, count: 4 },
            ]);
        },
    );

    it('does not call the reservation count port for an empty page or an absent filter', async () => {
        const reservationCountPort = { countByRuleIds: vi.fn() };
        const emptyApi = new RuleApiModel({}, { findAll: vi.fn(async () => [[], 4] as const) }, reservationCountPort);
        const unfilteredApi = new RuleApiModel(
            {},
            { findAll: vi.fn(async () => [[{ id: 1 }], 1] as const) },
            reservationCountPort,
        );

        await expect(emptyApi.gets({ type: 'normal' })).resolves.toEqual({ rules: [], total: 4 });
        await expect(unfilteredApi.gets({})).resolves.toEqual({ rules: [{ id: 1 }], total: 1 });

        expect(reservationCountPort.countByRuleIds).not.toHaveBeenCalled();
    });

    it('propagates the exact reservation count rejection without changing the page', async () => {
        const rules = [{ id: 4 }, { id: 6 }];
        const rejection = new Error('synthetic reservation count rejection');
        const reservationCountPort = {
            countByRuleIds: vi.fn(async () => Promise.reject(rejection)),
        };
        const api = new RuleApiModel({}, { findAll: vi.fn(async () => [rules, 2] as const) }, reservationCountPort);

        await expect(api.gets({ type: 'skip' })).rejects.toBe(rejection);

        expect(reservationCountPort.countByRuleIds).toHaveBeenCalledOnce();
        expect(rules).toEqual([{ id: 4 }, { id: 6 }]);
    });
});

describe('rule management coordinator characterization', () => {
    it('confirms the update target and delegates the complete replacement exactly once', async () => {
        const repository = makeCoordinatorRepository();
        const replacement = { ...programRule(), id: 101 };
        repository.findId.mockResolvedValue({ ...timeRule(), id: replacement.id });
        const { event, manager } = makeCoordinatorHarness(repository);

        await expect(manager.update(replacement)).resolves.toBeUndefined();

        expect(repository.findId).toHaveBeenCalledOnce();
        expect(repository.findId).toHaveBeenCalledWith(replacement.id);
        expect(repository.updateOnce).toHaveBeenCalledWith(replacement);
        expectOnlyCoordinatorMutation(repository, 'updateOnce');
        expectOnlyCoordinatorEvent(event, 'emitUpdated', replacement.id);
    });

    it('rejects a missing update target with RuleIsNotFound before mutation or event effects', async () => {
        const repository = makeCoordinatorRepository();
        const { event, manager } = makeCoordinatorHarness(repository);

        const error = await manager.update({ ...programRule(), id: 102 }).catch(reason => reason as Error);

        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error)) throw new Error('Expected RuleIsNotFound');
        expect(error.message).toBe('RuleIsNotFound');
        expect(repository.findId).toHaveBeenCalledOnce();
        expect(repository.findId).toHaveBeenCalledWith(102);
        expect(repository.insertOnce).not.toHaveBeenCalled();
        expect(repository.updateOnce).not.toHaveBeenCalled();
        expect(repository.enableOnce).not.toHaveBeenCalled();
        expect(repository.disableOnce).not.toHaveBeenCalled();
        expect(repository.deleteOnce).not.toHaveBeenCalled();
        expectNoCoordinatorEvent(event);
    });

    it.each([
        ['update', 'updateOnce', 111],
        ['enable', 'enableOnce', 112],
        ['disable', 'disableOnce', 113],
        ['delete', 'deleteOnce', 114],
    ] as const)(
        'propagates the exact repository rejection from %s without an event',
        async (operation, repositoryMethod, ruleId) => {
            const repository = makeCoordinatorRepository();
            const sentinel = new Error(`synthetic-${operation}-failure`);
            repository.findId.mockResolvedValue({ ...programRule(), id: ruleId });
            repository[repositoryMethod].mockRejectedValue(sentinel);
            const { event, manager } = makeCoordinatorHarness(repository);

            const result =
                operation === 'update' ? manager.update({ ...timeRule(), id: ruleId }) : manager[operation](ruleId);
            await expect(result).rejects.toBe(sentinel);

            expectOnlyCoordinatorMutation(repository, repositoryMethod);
            expectNoCoordinatorEvent(event);
        },
    );

    it.each([
        ['enable', 'enableOnce', 'emitEnabled', 121],
        ['disable', 'disableOnce', 'emitDisabled', 122],
        ['delete', 'deleteOnce', 'emitDeleted', 123],
    ] as const)(
        'delegates %s to the exact ID and emits only after repository settlement',
        async (operation, repositoryMethod, eventMethod, ruleId) => {
            const repository = makeCoordinatorRepository();
            const pending = deferred<void>();
            repository[repositoryMethod].mockReturnValue(pending.promise);
            const { event, manager } = makeCoordinatorHarness(repository);

            const result = manager[operation](ruleId);
            await settle();

            expect(repository.findId).not.toHaveBeenCalled();
            expect(repository[repositoryMethod]).toHaveBeenCalledWith(ruleId);
            expectOnlyCoordinatorMutation(repository, repositoryMethod);
            expectNoCoordinatorEvent(event);

            pending.resolve(undefined);
            await expect(result).resolves.toBeUndefined();
            expectOnlyCoordinatorEvent(event, eventMethod, ruleId);
        },
    );
});
