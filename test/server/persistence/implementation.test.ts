import type { DataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, useFakeClock } from '../harness/async';
import {
    createOperator,
    installDataSourceFactory,
    type TestLogger,
} from './harness';
import { immediateRetry, loadCompiled, repositoryOperator, silentLogger } from './repository-harness';
import { silentLoggerModel } from '../harness/silent-logger-model';

const restores: Array<() => void> = [];

afterEach(() => {
    vi.useRealTimers();
    while (restores.length > 0) {
        restores.pop()?.();
    }
    vi.restoreAllMocks();
});

const logger = (): TestLogger => ({ system: { error: vi.fn(), info: vi.fn() } });

const candidate = (overrides: Partial<DataSource> = {}): DataSource =>
    ({
        destroy: vi.fn(async () => undefined),
        driver: { databaseConnection: { loadExtension: vi.fn() } },
        initialize: vi.fn(async function (this: DataSource) {
            return this;
        }),
        manager: { query: vi.fn(async () => [1]) },
        ...overrides,
    }) as unknown as DataSource;

const persistedRule = {
    id: 1,
    updateCnt: 0,
    isTimeSpecification: false,
    keyword: 'synthetic',
    ignoreKeyword: null,
    keyCS: false,
    keyRegExp: false,
    name: true,
    description: false,
    extended: false,
    ignoreKeyCS: false,
    ignoreKeyRegExp: false,
    ignoreName: false,
    ignoreDescription: false,
    ignoreExtended: false,
    GR: true,
    BS: false,
    CS: false,
    SKY: false,
    channelIds: '[0,1,1]',
    genres: '[]',
    times: '[]',
    isFree: false,
    durationMin: null,
    durationMax: null,
    searchPeriods: '[]',
    enable: true,
    allowEndLack: true,
    avoidDuplicate: false,
    periodToAvoidDuplicate: null,
    tags: '[]',
    parentDirectoryName: null,
    directory: null,
    recordedFormat: null,
    mode1: null,
    parentDirectoryName1: null,
    directory1: null,
    mode2: null,
    parentDirectoryName2: null,
    directory2: null,
    mode3: null,
    parentDirectoryName3: null,
    directory3: null,
};

const fluentQueryBuilder = (result: unknown) => {
    const builder = {
        getMany: vi.fn(async () => result),
        leftJoinAndSelect: vi.fn(),
        orderBy: vi.fn(),
        where: vi.fn(),
    };
    for (const method of [builder.leftJoinAndSelect, builder.orderBy, builder.where]) {
        method.mockReturnValue(builder);
    }
    return builder;
};

type OperationSettlement<T> =
    | { readonly status: 'resolved'; readonly value: T }
    | { readonly reason: unknown; readonly status: 'rejected' };

const observeOperation = <T>(operation: Promise<T>): OperationSettlement<T>[] => {
    const ledger: OperationSettlement<T>[] = [];
    void operation.then(
        value => ledger.push({ status: 'resolved', value }),
        reason => ledger.push({ reason, status: 'rejected' }),
    );
    return ledger;
};

describe('DBOperator Risk A implementation characterization', () => {
    it('[PERSIST-1.2-PENDING-INITIALIZE] adds no EPGStation timer, retry, or abort while initialize is pending', async () => {
        const deferred = createDeferred<DataSource>();
        const source = candidate({ initialize: vi.fn(() => deferred.promise) as DataSource['initialize'] });
        const factory = vi.fn(() => source);
        restores.push(await installDataSourceFactory(factory));
        const clock = useFakeClock(0);
        const operation = createOperator({ dbtype: 'sqlite' }, logger()).getConnection();
        const operationSettlementLedger = observeOperation(operation);

        await clock.advanceBy(120_000);
        expect(deferred.state()).toEqual({ status: 'pending' });
        expect(operationSettlementLedger).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        expect(factory).toHaveBeenCalledTimes(1);
        deferred.resolve(source);
        await expect(operation).resolves.toBe(source);
        expect(operationSettlementLedger).toEqual([{ status: 'resolved', value: source }]);
        clock.restore();
    });

    it('[PERSIST-1.2-EXTENSION-FAILURE-NO-RETRY] surfaces the extension failure once without adding a retry timer', async () => {
        // better-sqlite3 の loadExtension は同期で、失敗は例外で返る。node-sqlite3 のように
        // callback を握ったまま待ち続ける状態は存在しない。検査するのは、失敗がそのまま一度だけ
        // 表に出ること、再試行の timer を足さないこと、候補を作り直さないことである。
        const failure = new Error('SYNTHETIC_PENDING_EXTENSION_REJECTION');
        const loadExtension = vi.fn((_extension: string) => {
            throw failure;
        });
        const source = candidate({ driver: { databaseConnection: { loadExtension } } } as Partial<DataSource>);
        const factory = vi.fn(() => source);
        restores.push(await installDataSourceFactory(factory));
        const clock = useFakeClock(0);
        const operation = createOperator(
            { dbtype: 'sqlite', sqlite: { extensions: ['synthetic-extension'] } },
            logger(),
        ).getConnection();
        const operationSettlementLedger = observeOperation(operation);

        await expect(operation).rejects.toBe(failure);
        await clock.advanceBy(120_000);
        expect(vi.getTimerCount()).toBe(0);
        expect(factory).toHaveBeenCalledTimes(1);
        expect(loadExtension).toHaveBeenCalledTimes(1);
        expect(operationSettlementLedger).toEqual([{ reason: failure, status: 'rejected' }]);
        clock.restore();
    });

    it('[PERSIST-1.2-PENDING-QUERY] waits indefinitely for the original select result without retry', async () => {
        const deferred = createDeferred<unknown>();
        const query = vi.fn(() => deferred.promise);
        const source = candidate({ manager: { query } as DataSource['manager'] });
        const factory = vi.fn(() => source);
        restores.push(await installDataSourceFactory(factory));
        const clock = useFakeClock(0);
        const operation = createOperator({ dbtype: 'sqlite' }, logger()).checkConnection();
        const operationSettlementLedger = observeOperation(operation);

        await clock.advanceBy(120_000);
        expect(operationSettlementLedger).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        expect(factory).toHaveBeenCalledTimes(1);
        expect(query).toHaveBeenCalledTimes(1);
        const failure = new Error('SYNTHETIC_PENDING_QUERY_REJECTION');
        deferred.reject(failure);
        await expect(operation).rejects.toBe(failure);
        expect(operationSettlementLedger).toEqual([{ reason: failure, status: 'rejected' }]);
        clock.restore();
    });

    it('[PERSIST-4.1-IMP-EXTENSION-CANDIDATE] discards an extension-failed candidate before a later initialization', async () => {
        const failure = new Error('SYNTHETIC_EXTENSION_REJECTION');
        const loadExtension = vi.fn((_extension: string) => {
            throw failure;
        });
        const failedSource = candidate({ driver: { databaseConnection: { loadExtension } } } as Partial<DataSource>);
        const recoveredSource = candidate({
            driver: {
                databaseConnection: {
                    loadExtension: vi.fn((_extension: string) => undefined),
                },
            },
        } as Partial<DataSource>);
        const factory = vi.fn().mockReturnValueOnce(failedSource).mockReturnValueOnce(recoveredSource);
        restores.push(await installDataSourceFactory(factory));
        const operator = createOperator(
            { dbtype: 'sqlite', sqlite: { extensions: ['synthetic-extension'] } },
            logger(),
        );

        await expect(operator.getConnection()).rejects.toBe(failure);
        await expect(operator.getConnection()).resolves.toBe(recoveredSource);
        expect(factory).toHaveBeenCalledTimes(2);
        expect(failedSource.initialize).toHaveBeenCalledTimes(1);
        expect(failedSource.destroy).toHaveBeenCalledTimes(1);
        expect(loadExtension).toHaveBeenCalledTimes(1);
        expect(recoveredSource.initialize).toHaveBeenCalledTimes(1);
    });

    it('[PERSIST-RISK-A-CLOSE-RETENTION] currently retains the terminal field after destroy success and error', async () => {
        const failure = new Error('SYNTHETIC_DESTROY_REJECTION');
        const destroy = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
        const source = candidate({ destroy });
        const factory = vi.fn(() => source);
        restores.push(await installDataSourceFactory(factory));
        const operator = createOperator({ dbtype: 'sqlite' }, logger());

        await operator.getConnection();
        await expect(operator.closeConnection()).resolves.toBeUndefined();
        await expect(operator.getConnection()).resolves.toBe(source);
        await expect(operator.closeConnection()).rejects.toBe(failure);
        await expect(operator.getConnection()).resolves.toBe(source);
        expect(factory).toHaveBeenCalledTimes(1);
        expect(destroy).toHaveBeenCalledTimes(2);
    });

    it('[PERSIST-4.1-IMP-SINGLE-FLIGHT] retains one initialization promise until a cold candidate settles', async () => {
        const firstInitialize = createDeferred<DataSource>();
        const first = candidate({ initialize: vi.fn(() => firstInitialize.promise) as DataSource['initialize'] });
        const factory = vi.fn(() => first);
        restores.push(await installDataSourceFactory(factory));
        const operator = createOperator({ dbtype: 'sqlite' }, logger());

        const firstCall = operator.getConnection();
        const secondCall = operator.getConnection();
        expect(factory).toHaveBeenCalledTimes(1);
        expect(first.initialize).toHaveBeenCalledTimes(1);
        firstInitialize.resolve(first);
        await expect(firstCall).resolves.toBe(first);
        await expect(secondCall).resolves.toBe(first);
    });

    it('[PERSIST-4.1-IMP-UNADOPTED-CANDIDATE] closes a candidate that loses the publication guard', async () => {
        const initialized = createDeferred<DataSource>();
        const candidateSource = candidate({
            initialize: vi.fn(() => initialized.promise) as DataSource['initialize'],
        });
        const adoptedSource = candidate();
        const factory = vi.fn(() => candidateSource);
        restores.push(await installDataSourceFactory(factory));
        const operator = createOperator({ dbtype: 'sqlite' }, logger());

        const operation = operator.getConnection();
        (operator as unknown as { connection: DataSource | null }).connection = adoptedSource;
        initialized.resolve(candidateSource);

        await expect(operation).resolves.toBe(adoptedSource);
        expect(candidateSource.destroy).toHaveBeenCalledTimes(1);
        expect(factory).toHaveBeenCalledTimes(1);
    });
});

describe('Persistence repository value and dialect implementation characterization', () => {
    /*
     * Task 7.2 の入力分類: 承認済みの各区分には実caseまたは型付きportのN/A理由を一つだけ割り当てる。
     *
     * | 入力区分 | 実caseまたはN/A理由 |
     * | --- | --- |
     * | null | N/A: IRecordedDB.findIds(recordedIds: apid.RecordedId[]) はnullを受理しない。 |
     * | 空配列 | [PERSIST-7.2-INPUT-EMPTY-ONE-MULTIPLE] |
     * | 0件 | [PERSIST-7.2-INPUT-ZERO-RESULTS] |
     * | 1件 | [PERSIST-7.2-INPUT-EMPTY-ONE-MULTIPLE] |
     * | 最小 | N/A: 型付きpersistence portに最小値の契約はない。 |
     * | 最大 | N/A: 型付きpersistence portに最大値の契約はない。 |
     * | 範囲外 | N/A: 承認済みのpublic port値域はなく、private query helperをoracleにしない。 |
     * | 不正型 | N/A: callerは型付きportを渡し、runtime validationはpersistenceの責務外である。 |
     * | 重複 | [PERSIST-7.2-INPUT-DUPLICATE-CHARACTERIZATION] は内部の非重複排除characterizationだけを固定する。 |
     */
    it('[PERSIST-7.2-INPUT-EMPTY-ONE-MULTIPLE] preserves an empty early return and distinct one and multiple results', async () => {
        const one = { id: 1 };
        const multiple = [{ id: 2 }, { id: 3 }];
        const builder = fluentQueryBuilder([]);
        builder.getMany.mockResolvedValueOnce([one]).mockResolvedValueOnce(multiple);
        const connection = { getRepository: vi.fn(() => ({ createQueryBuilder: vi.fn(() => builder) })) };
        const RecordedDB = loadCompiled<
            new (...arguments_: any[]) => {
                findIds(ids: number[], columns?: object): Promise<unknown[]>;
            }
        >('model/db/RecordedDB.js');
        const repository = new RecordedDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);
        const selectedRelations = {
            isNeedVideoFiles: true,
            isNeedThumbnails: false,
            isNeedsDropLog: true,
            isNeedTags: false,
        };

        await expect(repository.findIds([], selectedRelations)).resolves.toEqual([]);
        expect(connection.getRepository).not.toHaveBeenCalled();
        await expect(repository.findIds([1], selectedRelations)).resolves.toEqual([one]);
        await expect(repository.findIds([2, 3], selectedRelations)).resolves.toEqual(multiple);
        expect(builder.leftJoinAndSelect.mock.calls).toEqual([
            ['recorded.videoFiles', 'videoFiles'],
            ['recorded.dropLogFile', 'dropLogFile'],
            ['recorded.videoFiles', 'videoFiles'],
            ['recorded.dropLogFile', 'dropLogFile'],
        ]);
    });

    it('[PERSIST-7.2-INPUT-ZERO-RESULTS] runs a nonempty id query and returns zero rows distinctly from the empty-input early return', async () => {
        const builder = fluentQueryBuilder([]);
        const connection = { getRepository: vi.fn(() => ({ createQueryBuilder: vi.fn(() => builder) })) };
        const RecordedDB = loadCompiled<
            new (...arguments_: any[]) => {
                findIds(ids: number[], columns?: object): Promise<unknown[]>;
            }
        >('model/db/RecordedDB.js');
        const repository = new RecordedDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(
            repository.findIds([404], {
                isNeedVideoFiles: false,
                isNeedThumbnails: false,
                isNeedsDropLog: false,
                isNeedTags: false,
            }),
        ).resolves.toEqual([]);
        expect(connection.getRepository).toHaveBeenCalledOnce();
        expect(builder.getMany).toHaveBeenCalledOnce();
    });

    it('[PERSIST-7.2-RELATIONS-EXPLICIT] joins only explicitly requested thumbnail and tag relations', async () => {
        const builder = fluentQueryBuilder([]);
        const connection = { getRepository: vi.fn(() => ({ createQueryBuilder: vi.fn(() => builder) })) };
        const RecordedDB = loadCompiled<
            new (...arguments_: any[]) => {
                findIds(ids: number[], columns?: object): Promise<unknown[]>;
            }
        >('model/db/RecordedDB.js');
        const repository = new RecordedDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(
            repository.findIds([1], {
                isNeedVideoFiles: false,
                isNeedThumbnails: true,
                isNeedsDropLog: false,
                isNeedTags: true,
            }),
        ).resolves.toEqual([]);
        expect(builder.leftJoinAndSelect.mock.calls).toEqual([
            ['recorded.thumbnails', 'thumbnails'],
            ['recorded.tags', 'tags'],
        ]);
    });

    it('[PERSIST-7.2-RELATIONS-DEFAULT] joins only default video-file and thumbnail relations when columnOption is omitted', async () => {
        const builder = fluentQueryBuilder([]);
        const connection = { getRepository: vi.fn(() => ({ createQueryBuilder: vi.fn(() => builder) })) };
        const RecordedDB = loadCompiled<
            new (...arguments_: any[]) => {
                findIds(ids: number[], columns?: object): Promise<unknown[]>;
            }
        >('model/db/RecordedDB.js');
        const repository = new RecordedDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.findIds([1])).resolves.toEqual([]);
        expect(builder.leftJoinAndSelect.mock.calls).toEqual([
            ['recorded.videoFiles', 'videoFiles'],
            ['recorded.thumbnails', 'thumbnails'],
        ]);
    });

    it('[PERSIST-7.2-INPUT-DUPLICATE-CHARACTERIZATION] preserves duplicate ids in the internal query input without deduplicating', async () => {
        const builder = fluentQueryBuilder([]);
        const connection = { getRepository: vi.fn(() => ({ createQueryBuilder: vi.fn(() => builder) })) };
        const RecordedDB = loadCompiled<
            new (...arguments_: any[]) => {
                findIds(ids: number[], columns?: object): Promise<unknown[]>;
            }
        >('model/db/RecordedDB.js');
        const repository = new RecordedDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.findIds([1, 1])).resolves.toEqual([]);

        // Internal characterization only: this private TypeORM value is not a public repository contract.
        expect((builder.where.mock.calls[0][0] as { id: { _value: unknown } }).id._value).toEqual([1, 1]);
    });

    it('[PERSIST-7.2-RULE-RESTORE] restores persisted JSON values without defaults', async () => {
        const connection = {
            getRepository: vi.fn(() => ({ findOne: vi.fn(async () => ({ ...persistedRule })) })),
        };
        const RuleDB =
            loadCompiled<new (...arguments_: any[]) => { findId(id: number): Promise<unknown> }>('model/db/RuleDB.js');
        const repository = new RuleDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.findId(1)).resolves.toMatchObject({
            searchOption: {
                channelIds: [0, 1, 1],
                genres: [],
                times: [],
                searchPeriods: [],
            },
            reserveOption: { tags: [] },
        });
    });

    it.each(['channelIds', 'genres', 'times', 'searchPeriods', 'tags'] as const)(
        '[PERSIST-7.2-RULE-CORRUPT-%s] rejects corrupt persisted JSON through the public rule read',
        async field => {
            const connection = {
                getRepository: vi.fn(() => ({
                    findOne: vi.fn(async () => ({ ...persistedRule, [field]: '{broken-json' })),
                })),
            };
            const RuleDB =
                loadCompiled<new (...arguments_: any[]) => { findId(id: number): Promise<unknown> }>(
                    'model/db/RuleDB.js',
                );
            const repository = new RuleDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

            await expect(repository.findId(1)).rejects.toBeInstanceOf(SyntaxError);
        },
    );

    it('[PERSIST-7.2-RETRY-FINAL-WAIT] keeps the fifth-failure timer pending through 999ms and rejects with the same final error at 1000ms', async () => {
        vi.useFakeTimers();
        const failures = Array.from({ length: 5 }, (_, index) => new Error(`synthetic-${index + 1}`));
        const job = vi.fn(async () => {
            throw failures[job.mock.calls.length - 1];
        });
        const PromiseRetry =
            loadCompiled<new () => { run<T>(job: () => Promise<T>, option?: object): Promise<T> }>(
                'model/PromiseRetry.js',
            );
        const operation = new PromiseRetry().run(job);
        const settlement = observeOperation(operation);
        const rejection = expect(operation).rejects.toBe(failures[4]);

        await Promise.resolve();
        for (let nextAttempt = 2; nextAttempt <= 5; nextAttempt++) {
            await vi.advanceTimersByTimeAsync(1_000);
            expect(job).toHaveBeenCalledTimes(nextAttempt);
        }
        await vi.advanceTimersByTimeAsync(999);
        expect(settlement).toEqual([]);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        await rejection;
        expect(settlement).toEqual([{ reason: failures[4], status: 'rejected' }]);
        expect(job).toHaveBeenCalledTimes(5);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[PERSIST-7.2-PROGRAM-RAW] returns stored raw extended text without reinterpreting it', async () => {
        const rawExtended = '{"synthetic":"stored"}';
        const stored = {
            id: 41,
            extended: 'synthetic display text',
            rawExtended,
            isFree: false,
        };
        const connection = { getRepository: vi.fn(() => ({ findOne: vi.fn(async () => stored) })) };
        const ProgramDB =
            loadCompiled<new (...arguments_: any[]) => { findId(id: number): Promise<unknown> }>(
                'model/db/ProgramDB.js',
            );
        const repository = new ProgramDB(
            { getLogger: silentLogger },
            { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
            repositoryOperator(connection),
            immediateRetry,
        );

        const result = (await repository.findId(41)) as { rawExtended: unknown };

        expect(result.rawExtended).toBeTypeOf('string');
        expect(result.rawExtended).toBe(rawExtended);
        expect(result).toBe(stored);
    });

    it.each([
        ['sqlite', undefined, false, 1, 0, false, 'like', 'like', 'regexp', 'regexp'],
        ['sqlite', { regexp: false }, false, 1, 0, false, 'like', 'like', 'regexp', 'regexp'],
        ['sqlite', { regexp: true }, true, 1, 0, false, 'like', 'like', 'regexp', 'regexp'],
        ['mysql', undefined, true, true, false, true, 'like', 'like binary', 'regexp', 'regexp binary'],
    ])(
        '[PERSIST-7.2-DIALECT-%s-%j] preserves boolean, LIKE, regexp, and binary operator branches',
        (dbtype, sqlite, regexp, truthy, falsy, caseSensitive, like, binaryLike, regex, binaryRegex) => {
            const operator = createOperator({ dbtype, sqlite }, logger()) as ReturnType<typeof createOperator> & {
                convertBoolean(value: boolean): boolean | number;
                getLikeStr(cs: boolean): string;
                getRegexpStr(cs: boolean): string;
                isEnableCS(): boolean;
                isEnabledRegexp(): boolean;
            };

            expect(operator.isEnabledRegexp()).toBe(regexp);
            expect(operator.convertBoolean(true)).toBe(truthy);
            expect(operator.convertBoolean(false)).toBe(falsy);
            expect(operator.isEnableCS()).toBe(caseSensitive);
            expect(operator.getLikeStr(false)).toBe(like);
            expect(operator.getLikeStr(true)).toBe(binaryLike);
            expect(operator.getRegexpStr(false)).toBe(regex);
            expect(operator.getRegexpStr(true)).toBe(binaryRegex);
        },
    );
});
