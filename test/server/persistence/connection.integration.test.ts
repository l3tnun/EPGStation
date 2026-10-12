import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DataSource, DataSourceOptions } from 'typeorm';
import { DataSource as RealDataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { useFakeClock } from '../harness/async';
import {
    cleanupInOrder,
    createIsolatedCompiledRuntime,
    createOperator,
    createStartWatchdog,
    installDataSourceFactory,
    type IsolatedCompiledRuntime,
    type StartWatchdog,
    type TestLogger,
} from './harness';
import {
    EXPECTED_MYSQL_MIGRATIONS,
    MYSQL_MIGRATION_CASE_TIMEOUT_MS,
    createBackendRuntime,
    createMigratedMysqlSchemaHolder,
} from './backend-runtime';
import { MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS, provisionMySql, type MySqlRuntime } from './mysql-runtime';

const logger = (): TestLogger => ({ system: { error: vi.fn(), info: vi.fn() } });

type OperatorConstructor = NonNullable<Parameters<typeof createOperator>[2]>;

/**
 * `createIsolatedCompiledRuntime()` resolves the isolated snapshot's compiled `DBOperator` module
 * (and its `import { DataSource } from 'typeorm'` binding) before `installDataSourceFactory` mocks
 * `typeorm`. ES module import bindings are fixed at module-evaluation time, so `runtime.createOperator`
 * never observes a mock installed afterward, regardless of call order. Re-import the isolated
 * snapshot's `DBOperator` after the mock is installed so this operator's `new DataSource(...)`
 * calls route through the installed factory.
 */
async function createMockedOperator(
    runtime: Pick<IsolatedCompiledRuntime, 'compiledSnapshot'>,
    config: Record<string, unknown>,
    testLogger: TestLogger,
): Promise<ReturnType<typeof createOperator>> {
    const module = (await import(
        pathToFileURL(join(runtime.compiledSnapshot, 'model', 'db', 'DBOperator.js')).href
    )) as { default: OperatorConstructor };
    return createOperator(config, testLogger, module.default);
}

const expectedSQLiteMigrations = [
    'Init1601185891878',
    'AddRawExtended1624085241577',
    'AddEventRelay1716647355956',
    'AddRuleBS4K1790497623886',
] as const;

interface Deferred<Value> {
    readonly promise: Promise<Value>;
    resolve(value: Value): void;
}

const createDeferred = <Value>(): Deferred<Value> => {
    let resolve!: (value: Value) => void;
    const promise = new Promise<Value>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const migrationNames = async (source: DataSource): Promise<string[]> => {
    const rows = (await source.query('SELECT name FROM migrations ORDER BY id ASC')) as Array<{ name: string }>;
    return rows.map(row => row.name);
};

let mysqlRuntime: MySqlRuntime;

beforeAll(async () => {
    mysqlRuntime = await provisionMySql();
}, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

// The MySQL schema is migrated by the operator once, in `[PERSIST-6.1-MYSQL-CONNECTION-SCHEMA]` below, under
// its own explicit timeout; the lifecycle case connects to that schema instead of paying about 245 sequential
// DDL statements of migration inside its default 5 s. A lifecycle case run without it (a filtered run)
// prepares the schema itself.
const migratedSchema = createMigratedMysqlSchemaHolder(
    () => mysqlRuntime,
    () => logger(),
);

afterAll(async () => {
    await cleanupInOrder([() => migratedSchema.release(), async () => mysqlRuntime.cleanup()]);
});

describe('DBOperator SQLite connection integration', () => {
    // [PERSIST-1.10-SQLITE-EXTENSION-PENDING] originally observed a "second extension callback
    // still pending" state: the first configured extension resolved its callback immediately and
    // the second one held its callback open, so a late `getConnection()` caller could be shown
    // joining the same candidate while extension loading was itself in flight. better-sqlite3's
    // `loadExtension` is synchronous (see src/model/db/DBOperator.ts `setSQLiteExtensions`), so a
    // real invocation can no longer be paused mid-loop between two extensions — the whole loop
    // runs to completion (or throws) without yielding. The only real, awaitable step left in
    // `initializeConnection` before extensions run is `candidate.initialize()` itself, so the wait
    // point moves there: this test now holds up the real `initialize()` call, observes concurrent
    // callers joining that one candidate without adding a retry timer, then releases it and checks
    // that both configured extensions are still loaded exactly once, in configured order, only
    // after initialize completes.
    it('[PERSIST-1.10-SQLITE-INITIALIZE-PENDING] joins concurrent callers to one real candidate until the real initialize completes, then loads both extensions once in configured order', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        await mkdir(dirname(runtime.sqliteDatabasePath), { recursive: true });
        const initializeStarted = createDeferred<void>();
        const initializeRelease = createDeferred<void>();
        const initializeStartWatchdog = createStartWatchdog(initializeStarted.promise, 'SQLite real initialize');
        const candidates: DataSource[] = [];
        const extensionCalls: string[] = [];
        const restore = await installDataSourceFactory((options: DataSourceOptions) => {
            const source = new RealDataSource(options);
            const initialize = source.initialize.bind(source);
            vi.spyOn(source, 'initialize').mockImplementation(async () => {
                initializeStarted.resolve();
                await initializeRelease.promise;
                const initialized = await initialize();
                const databaseConnection = source.driver as unknown as {
                    databaseConnection: {
                        loadExtension(extension: string): void;
                    };
                };
                vi.spyOn(databaseConnection.databaseConnection, 'loadExtension').mockImplementation(
                    (extension: string) => {
                        extensionCalls.push(extension);
                    },
                );
                return initialized;
            });
            candidates.push(source);
            return source;
        });
        const operator = await createMockedOperator(
            runtime,
            {
                dbtype: 'sqlite',
                sqlite: { extensions: ['synthetic-extension-first', 'synthetic-extension-held'] },
            },
            logger(),
        );
        let first: Promise<DataSource> | undefined;
        let second: Promise<DataSource> | undefined;
        let late: Promise<DataSource> | undefined;
        let clock: ReturnType<typeof useFakeClock> | undefined;
        try {
            clock = useFakeClock(0);
            first = operator.getConnection();
            second = operator.getConnection();

            await initializeStartWatchdog.wait;
            late = operator.getConnection();
            let settled = false;
            void first.then(() => {
                settled = true;
            });

            expect(second).toBe(first);
            expect(late).toBe(first);
            expect(candidates).toHaveLength(1);
            expect(candidates[0].isInitialized).toBe(false);
            expect(extensionCalls).toEqual([]);
            await Promise.resolve();
            expect(settled).toBe(false);
            await clock.advanceBy(30_001);
            expect(settled).toBe(false);
            expect(candidates).toHaveLength(1);
            expect(vi.getTimerCount()).toBe(0);

            initializeRelease.resolve();
            const [firstSource, secondSource, lateSource] = await Promise.all([first, second, late]);
            expect(firstSource).toBe(candidates[0]);
            expect(secondSource).toBe(firstSource);
            expect(lateSource).toBe(firstSource);
            expect(extensionCalls).toEqual(['synthetic-extension-first', 'synthetic-extension-held']);
            await expect(migrationNames(firstSource)).resolves.toEqual(expectedSQLiteMigrations);
        } finally {
            initializeRelease.resolve();
            await Promise.allSettled(
                [first, second, late].filter((operation): operation is Promise<DataSource> => operation !== undefined),
            );
            initializeStartWatchdog.cancel();
            clock?.restore();
            restore();
            await cleanupInOrder([
                ...candidates.map(source => async () => {
                    if (source.isInitialized) {
                        await source.destroy();
                    }
                }),
                runtime.cleanup,
            ]);
        }
    });

    it('[PERSIST-1.8-SQLITE-CHECK-PENDING] waits for the real saved connection query without starting a second candidate', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        await mkdir(dirname(runtime.sqliteDatabasePath), { recursive: true });
        const queryStarted = createDeferred<void>();
        const queryRelease = createDeferred<void>();
        const candidates: DataSource[] = [];
        const restore = await installDataSourceFactory((options: DataSourceOptions) => {
            const candidate = new RealDataSource(options);
            candidates.push(candidate);
            return candidate;
        });
        const operator = await createMockedOperator(runtime, { dbtype: 'sqlite' }, logger());
        let source: DataSource | undefined;
        let restoreQuery: (() => void) | undefined;
        let check: Promise<void> | undefined;
        let queryStartWatchdog: StartWatchdog<void> | undefined;
        let clock: ReturnType<typeof useFakeClock> | undefined;
        try {
            source = await operator.getConnection();
            const query = source.manager.query.bind(source.manager);
            restoreQuery = vi.spyOn(source.manager, 'query').mockImplementation(async (sql, parameters) => {
                if (sql === 'select 1') {
                    queryStarted.resolve();
                    await queryRelease.promise;
                }
                return query(sql, parameters);
            }).mockRestore;

            queryStartWatchdog = createStartWatchdog(queryStarted.promise, 'SQLite select 1 query');
            clock = useFakeClock(0);
            check = operator.checkConnection();
            await queryStartWatchdog.wait;
            const shared = operator.getConnection();
            let settled = false;
            void check.then(() => {
                settled = true;
            });

            await expect(shared).resolves.toBe(source);
            await Promise.resolve();
            expect(settled).toBe(false);
            await clock.advanceBy(30_001);
            expect(settled).toBe(false);
            expect(candidates).toHaveLength(1);
            expect(vi.getTimerCount()).toBe(0);

            queryRelease.resolve();
            await expect(check).resolves.toBeUndefined();
            expect(source.manager.query).toHaveBeenCalledTimes(1);
            expect(source.manager.query).toHaveBeenCalledWith('select 1');
        } finally {
            queryRelease.resolve();
            await check?.catch(() => undefined);
            queryStartWatchdog?.cancel();
            clock?.restore();
            restoreQuery?.();
            restore();
            await cleanupInOrder([
                async () => {
                    if (source?.isInitialized === true) {
                        await source.destroy();
                    }
                },
                runtime.cleanup,
            ]);
        }
    });

    it('[PERSIST-1.11-SQLITE-EXTENSION-RETRY] closes an unpublished real extension candidate and creates a fresh candidate for the next request', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        await mkdir(dirname(runtime.sqliteDatabasePath), { recursive: true });
        const primaryError = new Error('SYNTHETIC_SQLITE_EXTENSION_REJECTION');
        const candidates: DataSource[] = [];
        const destroySpies: Array<ReturnType<typeof vi.spyOn>> = [];
        const extensionCalls: string[] = [];
        const restore = await installDataSourceFactory((options: DataSourceOptions) => {
            const source = new RealDataSource(options);
            const initialize = source.initialize.bind(source);
            vi.spyOn(source, 'initialize').mockImplementation(async () => {
                const initialized = await initialize();
                const databaseConnection = source.driver as unknown as {
                    databaseConnection: {
                        loadExtension(extension: string): void;
                    };
                };
                // better-sqlite3 の loadExtension は同期で、失敗は例外で返る。node-sqlite3 の
                // callback 形式とは異なる。
                vi.spyOn(databaseConnection.databaseConnection, 'loadExtension').mockImplementation(
                    (extension: string) => {
                        extensionCalls.push(extension);
                        const isFirstCandidate = candidates.indexOf(source) === 0;
                        if (isFirstCandidate && extension === 'synthetic-extension-middle') {
                            throw primaryError;
                        }
                    },
                );
                return initialized;
            });
            candidates.push(source);
            destroySpies.push(vi.spyOn(source, 'destroy'));
            return source;
        });
        const operator = await createMockedOperator(
            runtime,
            {
                dbtype: 'sqlite',
                sqlite: {
                    extensions: [
                        'synthetic-extension-first',
                        'synthetic-extension-middle',
                        'synthetic-extension-later',
                    ],
                },
            },
            logger(),
        );
        try {
            const first = operator.getConnection();
            const second = operator.getConnection();
            const [firstError, secondError] = await Promise.all([
                first.catch(error => error),
                second.catch(error => error),
            ]);

            expect(firstError).toBe(primaryError);
            expect(secondError).toBe(primaryError);
            expect(candidates).toHaveLength(1);
            expect(candidates[0].isInitialized).toBe(false);
            expect(destroySpies[0]).toHaveBeenCalledTimes(1);
            expect(extensionCalls).toEqual(['synthetic-extension-first', 'synthetic-extension-middle']);

            const recovered = await operator.getConnection();
            expect(candidates).toHaveLength(2);
            expect(recovered).toBe(candidates[1]);
            expect(recovered).not.toBe(candidates[0]);
            expect(extensionCalls).toEqual([
                'synthetic-extension-first',
                'synthetic-extension-middle',
                'synthetic-extension-first',
                'synthetic-extension-middle',
                'synthetic-extension-later',
            ]);
            await expect(migrationNames(recovered)).resolves.toEqual(expectedSQLiteMigrations);
        } finally {
            restore();
            destroySpies.forEach(spy => spy.mockRestore());
            await cleanupInOrder([
                ...candidates.map(source => async () => {
                    if (source.isInitialized) {
                        await source.destroy();
                    }
                }),
                runtime.cleanup,
            ]);
        }
    });

    it('[PERSIST-1.11-SQLITE-INITIALIZE-RETRY] disconnects a real failed initialization candidate before retrying with a fresh candidate', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        const dataDirectory = dirname(runtime.sqliteDatabasePath);
        await writeFile(dataDirectory, 'synthetic-not-a-directory', 'utf8');
        const candidates: DataSource[] = [];
        const disconnectSpies: Array<ReturnType<typeof vi.spyOn>> = [];
        const restore = await installDataSourceFactory((options: DataSourceOptions) => {
            const source = new RealDataSource(options);
            candidates.push(source);
            disconnectSpies.push(vi.spyOn(source.driver, 'disconnect'));
            return source;
        });
        const operator = await createMockedOperator(runtime, { dbtype: 'sqlite' }, logger());
        try {
            const first = operator.getConnection();
            const second = operator.getConnection();
            const [firstError, secondError] = await Promise.all([
                first.catch(error => error),
                second.catch(error => error),
            ]);

            expect(firstError).toBe(secondError);
            expect(firstError).toMatchObject({ code: 'EEXIST' });
            expect(candidates).toHaveLength(1);
            expect(candidates[0].isInitialized).toBe(false);
            expect(disconnectSpies[0]).toHaveBeenCalledTimes(1);

            await rm(dataDirectory, { force: true });
            await mkdir(dataDirectory, { recursive: true });
            const recovered = await operator.getConnection();
            expect(candidates).toHaveLength(2);
            expect(recovered).toBe(candidates[1]);
            expect(recovered).not.toBe(candidates[0]);
            await expect(migrationNames(recovered)).resolves.toEqual(expectedSQLiteMigrations);
        } finally {
            restore();
            disconnectSpies.forEach(spy => spy.mockRestore());
            await cleanupInOrder([
                ...candidates.map(source => async () => {
                    if (source.isInitialized) {
                        await source.destroy();
                    }
                }),
                runtime.cleanup,
            ]);
        }
    });

    it('[PERSIST-1.3-SQLITE-CLOSE-NOOP] closes before initialization without creating a database file', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        try {
            const operator = runtime.createOperator({ dbtype: 'sqlite' }, logger());
            await expect(operator.closeConnection()).resolves.toBeUndefined();
            await expect(access(runtime.sqliteDatabasePath)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await runtime.cleanup();
        }
    });

    it('[PERSIST-1.3-SQLITE-LIFECYCLE] initializes the temporary file, checks select 1, reuses identity, and destroys it', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        await mkdir(dirname(runtime.sqliteDatabasePath), { recursive: true });
        const operator = runtime.createOperator({ dbtype: 'sqlite' }, logger());
        let source: DataSource | undefined;
        try {
            source = await operator.getConnection();
            await expect(access(runtime.sqliteDatabasePath)).resolves.toBeUndefined();
            await expect(operator.checkConnection()).resolves.toBeUndefined();
            await expect(operator.getConnection()).resolves.toBe(source);
            expect(source.isInitialized).toBe(true);

            await expect(operator.closeConnection()).resolves.toBeUndefined();
            expect(source.isInitialized).toBe(false);
        } finally {
            await cleanupInOrder([
                async () => {
                    if (source?.isInitialized === true) {
                        await source.destroy();
                    }
                },
                runtime.cleanup,
            ]);
        }
    });

    it('[PERSIST-1.3-SQLITE-DESTROY-ERROR] returns the real destroy error while retaining the terminal instance', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        await mkdir(dirname(runtime.sqliteDatabasePath), { recursive: true });
        try {
            const operator = runtime.createOperator({ dbtype: 'sqlite' }, logger());
            const source = await operator.getConnection();

            await operator.closeConnection();
            const secondClose = operator.closeConnection();
            await expect(secondClose).rejects.toBeInstanceOf(Error);
            await expect(operator.getConnection()).resolves.toBe(source);
            expect(source.isInitialized).toBe(false);
        } finally {
            await runtime.cleanup();
        }
    });
});

describe('DBOperator MySQL connection integration', () => {
    it(
        '[PERSIST-6.1-MYSQL-CONNECTION-SCHEMA] applies the operator-managed forward migrations to the schema the MySQL lifecycle case uses',
        async () => {
            const { appliedMigrations } = await migratedSchema.acquire();
            expect(appliedMigrations).toEqual(EXPECTED_MYSQL_MIGRATIONS);
        },
        MYSQL_MIGRATION_CASE_TIMEOUT_MS,
    );

    it('[PERSIST-1.4-MYSQL-LIFECYCLE] initializes an isolated schema, checks select 1, reuses identity, and destroys its pool', async () => {
        const runtime = await createBackendRuntime('mysql', mysqlRuntime, logger(), {
            schema: (await migratedSchema.acquire()).schema,
        });
        try {
            await expect(runtime.operator.checkConnection()).resolves.toBeUndefined();
            await expect(runtime.operator.getConnection()).resolves.toBe(runtime.source);
            expect(runtime.source.isInitialized).toBe(true);

            await expect(runtime.operator.closeConnection()).resolves.toBeUndefined();
            expect(runtime.source.isInitialized).toBe(false);
        } finally {
            await runtime.cleanup();
        }
    });
});

// The container is removed here, in a test of its own with the budget its provisioning has, rather than in
// `afterAll`: the Docker daemon answers `docker rm --force` late while it is busy (an image export holds
// it for tens of seconds), and a hook only has Vitest's default 10 s. The `afterAll` above confirms the
// container is gone and removes it itself only when this test did not run (a filtered or aborted file).
it(
    'releases the isolated MySQL fixture container after every case of the file',
    async () => {
        await migratedSchema.release();
        await mysqlRuntime.cleanup();
    },
    MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS,
);
