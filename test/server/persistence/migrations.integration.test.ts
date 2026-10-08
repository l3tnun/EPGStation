import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DataSource, DataSourceOptions } from 'typeorm';
import { DataSource as RealDataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDeferred, type Deferred } from '../harness/async';
import {
    cleanupInOrder,
    cleanupTestOperationsAfterStartWatchdog,
    createIsolatedCompiledRuntime,
    createOperator,
    createStartWatchdog,
    installDataSourceFactory,
    type IsolatedCompiledRuntime,
    type StartWatchdog,
    type TestLogger,
} from './harness';
import { MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS, provisionMySql, type MySqlRuntime } from './mysql-runtime';

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

/** Real MySQL migration start budget (CI hosts are slower than a developer machine). */
const MYSQL_MIGRATION_START_BUDGET_MS = 10_000;

const expectedSQLiteMigrations = [
    'Init1601185891878',
    'AddRawExtended1624085241577',
    'AddEventRelay1716647355956',
    'AddRuleBS4K1790497623886',
] as const;
const expectedMysqlMigrations = [
    'Init1601186196169',
    'AddRawExtended1624084351785',
    'AddEventRelay1716647383635',
    'AddRuleBS4K1790497623885',
] as const;
const syntheticAttemptKey = '__EPGSTATION_PERSISTENCE_SYNTHETIC_MIGRATION_ATTEMPT__';

const logger = (): TestLogger => ({ system: { error: vi.fn(), info: vi.fn() } });

const cleanup = async (runtime: IsolatedCompiledRuntime): Promise<void> => {
    delete (globalThis as Record<string, unknown>)[syntheticAttemptKey];
    await runtime.cleanup();
};

const migrationNames = async (source: DataSource): Promise<string[]> => {
    const rows = (await source.query('SELECT name FROM migrations ORDER BY id ASC')) as Array<{ name: string }>;
    return rows.map(row => row.name);
};

describe('SQLite forward migration integration', () => {
    it('[PERSIST-1.4-SQLITE-FORWARD] applies only the selected forward migrations with synchronize disabled', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        await mkdir(dirname(runtime.sqliteDatabasePath), { recursive: true });
        const candidates: DataSource[] = [];
        const restore = await installDataSourceFactory((options: DataSourceOptions) => {
            const source = new RealDataSource(options);
            candidates.push(source);
            return source;
        });
        const operator = await createMockedOperator(runtime, { dbtype: 'sqlite' }, logger());
        let source: DataSource | undefined;
        try {
            const [first, second, late] = await Promise.all([
                operator.getConnection(),
                operator.getConnection(),
                operator.getConnection(),
            ]);
            source = first;

            expect(candidates).toHaveLength(1);
            expect(second).toBe(first);
            expect(late).toBe(first);
            await expect(migrationNames(source)).resolves.toEqual(expectedSQLiteMigrations);
            const programColumns = (await source.query('PRAGMA table_info("program")')) as Array<{ name: string }>;
            const reserveColumns = (await source.query('PRAGMA table_info("reserve")')) as Array<{ name: string }>;
            expect(programColumns.map(column => column.name)).toContain('rawExtended');
            expect(reserveColumns.map(column => column.name)).toContain('isEventRelay');
        } finally {
            restore();
            await cleanupInOrder([
                async () => {
                    if (source?.isInitialized === true) {
                        await source.destroy();
                    }
                },
                () => cleanup(runtime),
            ]);
        }
    });

    it('[PERSIST-1.4-SQLITE-APPLIED] preserves already-applied migrations without adding or downgrading history', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        let first: DataSource | undefined;
        let second: DataSource | undefined;
        try {
            await mkdir(dirname(runtime.sqliteDatabasePath), { recursive: true });
            const firstOperator = runtime.createOperator({ dbtype: 'sqlite' }, logger());
            first = await firstOperator.getConnection();
            const before = await migrationNames(first);
            await firstOperator.closeConnection();

            const secondOperator = runtime.createOperator({ dbtype: 'sqlite' }, logger());
            second = await secondOperator.getConnection();
            expect(second).not.toBe(first);
            await expect(migrationNames(second)).resolves.toEqual(before);
            expect(before).toEqual(expectedSQLiteMigrations);
        } finally {
            await cleanupInOrder([
                async () => {
                    if (second?.isInitialized === true) {
                        await second.destroy();
                    }
                },
                async () => {
                    if (first?.isInitialized === true) {
                        await first.destroy();
                    }
                },
                () => cleanup(runtime),
            ]);
        }
    });

    it('[PERSIST-1.4-SQLITE-RETRY] does not publish a failed migration candidate, leaves its cleanup to TypeORM, and retries pending work with a new candidate', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        const syntheticMigrationPath = join(
            runtime.compiledSnapshot,
            'db',
            'migrations',
            'sqlite',
            '1900000000000-SyntheticRetry.js',
        );
        await mkdir(dirname(runtime.sqliteDatabasePath), { recursive: true });
        const migrationStarted = createDeferred<void>();
        const migrationRelease = createDeferred<void>();
        const migrationControlKey = `${syntheticAttemptKey}_SQLITE_CONTROL`;
        (globalThis as Record<string, unknown>)[migrationControlKey] = {
            release: migrationRelease.promise,
            started: () => migrationStarted.resolve(undefined),
        };
        await writeFile(
            syntheticMigrationPath,
            `export class SyntheticRetry1900000000000 {\n  constructor() { this.name = 'SyntheticRetry1900000000000'; }\n  async up(queryRunner) {\n    const control = globalThis['${migrationControlKey}'];\n    control.started();\n    await control.release;\n    const key = '${syntheticAttemptKey}';\n    if (globalThis[key] !== true) { globalThis[key] = true; throw new Error('SYNTHETIC_MIGRATION_REJECTION'); }\n    await queryRunner.query('CREATE TABLE "synthetic_retry" ("id" integer PRIMARY KEY NOT NULL)');\n  }\n  async down() { throw new Error('SYNTHETIC_DOWN_MUST_NOT_RUN'); }\n}\n`,
            'utf8',
        );

        const candidates: DataSource[] = [];
        const destroySpies: Array<ReturnType<typeof vi.spyOn>> = [];
        const restore = await installDataSourceFactory((options: DataSourceOptions) => {
            const source = new RealDataSource(options);
            candidates.push(source);
            destroySpies.push(vi.spyOn(source, 'destroy'));
            return source;
        });
        const testLogger = logger();
        const operator = await createMockedOperator(runtime, { dbtype: 'sqlite' }, testLogger);
        let first: Promise<DataSource> | undefined;
        let second: Promise<DataSource> | undefined;
        let late: Promise<DataSource> | undefined;
        let migrationStartWatchdog: StartWatchdog<void> | undefined;
        let migrationStartObserved = false;
        try {
            migrationStartWatchdog = createStartWatchdog(migrationStarted.promise, 'SQLite retry migration');
            first = operator.getConnection();
            second = operator.getConnection();
            await migrationStartWatchdog.wait;
            migrationStartObserved = true;
            migrationStartWatchdog.cancel();
            late = operator.getConnection();

            expect(second).toBe(first);
            expect(late).toBe(first);
            expect(candidates).toHaveLength(1);
            migrationRelease.resolve(undefined);
            const [firstError, secondError, lateError] = await Promise.all([
                first.catch(error => error),
                second.catch(error => error),
                late.catch(error => error),
            ]);

            expect(firstError).toBe(secondError);
            expect(lateError).toBe(firstError);
            expect(firstError).toMatchObject({ message: 'SYNTHETIC_MIGRATION_REJECTION' });
            expect(candidates).toHaveLength(1);
            expect(candidates[0].isInitialized).toBe(false);
            expect(destroySpies[0]).toHaveBeenCalledTimes(1);
            expect(testLogger.system.error).not.toHaveBeenCalled();

            const recovered = await operator.getConnection();
            expect(candidates).toHaveLength(2);
            expect(recovered).toBe(candidates[1]);
            expect(recovered).not.toBe(candidates[0]);
            await expect(migrationNames(recovered)).resolves.toEqual([
                ...expectedSQLiteMigrations,
                'SyntheticRetry1900000000000',
            ]);
            const migrationsTable = (await recovered.query(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migrations'",
            )) as Array<{ name: string }>;
            expect(migrationsTable).toEqual([{ name: 'migrations' }]);
            const table = (await recovered.query(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'synthetic_retry'",
            )) as Array<{ name: string }>;
            expect(table).toEqual([{ name: 'synthetic_retry' }]);
        } finally {
            migrationStartWatchdog?.cancel();
            await cleanupTestOperationsAfterStartWatchdog(
                migrationStartObserved,
                () => migrationRelease.resolve(undefined),
                [first, second, late].filter((operation): operation is Promise<DataSource> => operation !== undefined),
            );
            delete (globalThis as Record<string, unknown>)[migrationControlKey];
            restore();
            destroySpies.forEach(spy => spy.mockRestore());
            await cleanupInOrder([
                ...candidates.map(source => async () => {
                    if (source.isInitialized) {
                        await source.destroy();
                    }
                }),
                () => cleanup(runtime),
            ]);
        }
    });

    it('[PERSIST-1.4-SQLITE-DOWN] reverts the four forward migrations through undoLastMigration in reverse order', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        await mkdir(dirname(runtime.sqliteDatabasePath), { recursive: true });
        const operator = runtime.createOperator({ dbtype: 'sqlite' }, logger());
        let source: DataSource | undefined;
        try {
            source = await operator.getConnection();
            await expect(migrationNames(source)).resolves.toEqual(expectedSQLiteMigrations);

            await source.undoLastMigration();
            await expect(migrationNames(source)).resolves.toEqual(expectedSQLiteMigrations.slice(0, 3));
            const ruleAfterBS4KRevert = (await source.query('PRAGMA table_info("rule")')) as Array<{
                name: string;
            }>;
            expect(ruleAfterBS4KRevert.map(column => column.name)).not.toContain('BS4K');
            expect(ruleAfterBS4KRevert.map(column => column.name)).toContain('SKY');

            await source.undoLastMigration();
            await expect(migrationNames(source)).resolves.toEqual(expectedSQLiteMigrations.slice(0, 2));
            const reserveAfterEventRelayRevert = (await source.query('PRAGMA table_info("reserve")')) as Array<{
                name: string;
            }>;
            expect(reserveAfterEventRelayRevert.map(column => column.name)).not.toContain('isEventRelay');
            expect(reserveAfterEventRelayRevert.map(column => column.name)).toContain('rawExtended');
            const recreatedIndexes = (await source.query(
                `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('IDX_4bf93992f2a6020b74bbf80cf4', 'IDX_c5315b388628971c92d241be9c')`,
            )) as Array<{ name: string }>;
            expect(recreatedIndexes.map(index => index.name).sort()).toEqual([
                'IDX_4bf93992f2a6020b74bbf80cf4',
                'IDX_c5315b388628971c92d241be9c',
            ]);

            await source.undoLastMigration();
            await expect(migrationNames(source)).resolves.toEqual(expectedSQLiteMigrations.slice(0, 1));
            const programAfterRawExtendedRevert = (await source.query('PRAGMA table_info("program")')) as Array<{
                name: string;
            }>;
            const reserveAfterRawExtendedRevert = (await source.query('PRAGMA table_info("reserve")')) as Array<{
                name: string;
            }>;
            expect(programAfterRawExtendedRevert.map(column => column.name)).not.toContain('rawExtended');
            expect(reserveAfterRawExtendedRevert.map(column => column.name)).not.toContain('rawExtended');

            await source.undoLastMigration();
            await expect(migrationNames(source)).resolves.toEqual([]);
            const remainingProductTables = (await source.query(
                `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('reserve', 'program', 'recorded', 'rule', 'channel', 'recorded_tag', 'recorded_history', 'video_file', 'thumbnail', 'drop_log_file', 'recorded_tags_recorded_tag')`,
            )) as Array<{ name: string }>;
            expect(remainingProductTables).toEqual([]);
        } finally {
            await cleanupInOrder([
                async () => {
                    if (source?.isInitialized === true) {
                        await source.destroy();
                    }
                },
                () => cleanup(runtime),
            ]);
        }
    }, 30_000);

    it('[PERSIST-1.4-SQLITE-BS4K-PRESERVE] applies AddRuleBS4K onto a preexisting rule row, defaulting BS4K to false without disturbing its other columns', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        await mkdir(dirname(runtime.sqliteDatabasePath), { recursive: true });
        const operator = runtime.createOperator({ dbtype: 'sqlite' }, logger());
        let source: DataSource | undefined;
        try {
            source = await operator.getConnection();
            await expect(migrationNames(source)).resolves.toEqual(expectedSQLiteMigrations);

            // Revert only AddRuleBS4K so the row inserted below lands on the pre-migration `rule`
            // schema, the same shape a v2 database being moved onto this candidate would have.
            await source.undoLastMigration();
            await expect(migrationNames(source)).resolves.toEqual(expectedSQLiteMigrations.slice(0, 3));
            await source.query(
                `INSERT INTO "rule" ("keyword", "GR", "BS", "CS", "SKY", "enable", "allowEndLack", "tags") VALUES ('v2 imported keyword', 1, 0, 1, 0, 1, 0, 'tag-a,tag-b')`,
            );
            const beforeRows = (await source.query(
                `SELECT * FROM "rule" WHERE "keyword" = 'v2 imported keyword'`,
            )) as Array<Record<string, unknown>>;
            expect(beforeRows).toHaveLength(1);
            expect(Object.keys(beforeRows[0])).not.toContain('BS4K');
            const insertedId = beforeRows[0].id;

            await source.runMigrations();
            await expect(migrationNames(source)).resolves.toEqual(expectedSQLiteMigrations);

            const afterRows = (await source.query('SELECT * FROM "rule" WHERE "id" = ?', [
                insertedId,
            ])) as Array<Record<string, unknown>>;
            expect(afterRows).toHaveLength(1);
            const [row] = afterRows;
            expect(row.id).toBe(insertedId);
            expect(Number(row.BS4K)).toBe(0);
            expect(row.keyword).toBe('v2 imported keyword');
            expect(Number(row.GR)).toBe(1);
            expect(Number(row.BS)).toBe(0);
            expect(Number(row.CS)).toBe(1);
            expect(Number(row.SKY)).toBe(0);
            expect(Number(row.enable)).toBe(1);
            expect(Number(row.allowEndLack)).toBe(0);
            expect(row.tags).toBe('tag-a,tag-b');
        } finally {
            await cleanupInOrder([
                async () => {
                    if (source?.isInitialized === true) {
                        await source.destroy();
                    }
                },
                () => cleanup(runtime),
            ]);
        }
    }, 30_000);

    it('[PERSIST-1.4-SQLITE-RETRY-WATCHDOG-TEARDOWN] reaches a never-starting migration through operator.getConnection, then finishes test teardown without awaiting that product promise', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        const syntheticMigrationPath = join(
            runtime.compiledSnapshot,
            'db',
            'migrations',
            'sqlite',
            '1900000000002-SyntheticNeverStarting.js',
        );
        await mkdir(dirname(runtime.sqliteDatabasePath), { recursive: true });
        const migrationEntered = createDeferred<void>();
        const migrationStarted = createDeferred<void>();
        const migrationControlKey = `${syntheticAttemptKey}_SQLITE_NEVER_STARTING_CONTROL`;
        (globalThis as Record<string, unknown>)[migrationControlKey] = {
            entered: () => migrationEntered.resolve(undefined),
        };
        await writeFile(
            syntheticMigrationPath,
            `export class SyntheticNeverStarting1900000000002 {\n  constructor() { this.name = 'SyntheticNeverStarting1900000000002'; }\n  async up() {\n    globalThis['${migrationControlKey}'].entered();\n    await new Promise(() => {});\n  }\n  async down() { throw new Error('SYNTHETIC_NEVER_STARTING_DOWN_MUST_NOT_RUN'); }\n}\n`,
            'utf8',
        );

        const candidates: DataSource[] = [];
        const restore = await installDataSourceFactory((options: DataSourceOptions) => {
            const source = new RealDataSource(options);
            candidates.push(source);
            return source;
        });
        const operator = await createMockedOperator(runtime, { dbtype: 'sqlite' }, logger());
        let first: Promise<DataSource> | undefined;
        let migrationEnteredWatchdog: StartWatchdog<void> | undefined;
        let migrationStartWatchdog: StartWatchdog<void> | undefined;
        let migrationStartObserved = false;
        let productPromiseSettled = false;
        let teardownCompleted = false;
        try {
            migrationEnteredWatchdog = createStartWatchdog(
                migrationEntered.promise,
                'SQLite never-starting migration entry',
            );
            migrationStartWatchdog = createStartWatchdog(migrationStarted.promise, 'SQLite never-starting migration');
            first = operator.getConnection();
            void first.then(
                () => {
                    productPromiseSettled = true;
                },
                () => {
                    productPromiseSettled = true;
                },
            );
            await migrationEnteredWatchdog.wait;
            await expect(migrationStartWatchdog.wait).rejects.toThrow('SQLite never-starting migration did not start');
            expect(candidates).toHaveLength(1);
            expect(productPromiseSettled).toBe(false);
        } finally {
            migrationEnteredWatchdog?.cancel();
            migrationStartWatchdog?.cancel();
            await cleanupTestOperationsAfterStartWatchdog(migrationStartObserved, () => undefined, [first]);
            delete (globalThis as Record<string, unknown>)[migrationControlKey];
            restore();
            await cleanupInOrder([
                ...candidates.map(source => async () => {
                    if (source.isInitialized) {
                        await source.destroy();
                    }
                }),
                () => cleanup(runtime),
            ]);
            teardownCompleted = true;
        }

        expect(migrationStartObserved).toBe(false);
        expect(productPromiseSettled).toBe(false);
        expect(teardownCompleted).toBe(true);
    });
});

describe('MySQL forward migration integration', () => {
    let databaseRuntime: MySqlRuntime;

    beforeAll(async () => {
        databaseRuntime = await provisionMySql();
    }, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

    afterAll(async () => {
        await databaseRuntime?.cleanup();
    }, 30_000);

    it('[PERSIST-1.4-MYSQL-FORWARD] connects through the real driver and applies only the MySQL forward migrations', async () => {
        let runtime: IsolatedCompiledRuntime | undefined;
        let schema: Awaited<ReturnType<MySqlRuntime['createSchema']>> | undefined;
        let source: DataSource | undefined;
        const candidates: DataSource[] = [];
        let restore: (() => void) | undefined;
        try {
            runtime = await createIsolatedCompiledRuntime();
            schema = await databaseRuntime.createSchema();
            restore = await installDataSourceFactory((options: DataSourceOptions) => {
                const candidate = new RealDataSource(options);
                candidates.push(candidate);
                return candidate;
            });
            const operator = await createMockedOperator(runtime, { dbtype: 'mysql', mysql: schema.config }, logger());
            const [first, second, late] = await Promise.all([
                operator.getConnection(),
                operator.getConnection(),
                operator.getConnection(),
            ]);
            source = first;

            expect(candidates).toHaveLength(1);
            expect(second).toBe(first);
            expect(late).toBe(first);
            await expect(operator.checkConnection()).resolves.toBeUndefined();
            await expect(operator.getConnection()).resolves.toBe(source);
            await expect(migrationNames(source)).resolves.toEqual(expectedMysqlMigrations);
            const programColumns = (await source.query('SHOW COLUMNS FROM `program`')) as Array<{ Field: string }>;
            const reserveColumns = (await source.query('SHOW COLUMNS FROM `reserve`')) as Array<{ Field: string }>;
            expect(programColumns.map(column => column.Field)).toContain('rawExtended');
            expect(reserveColumns.map(column => column.Field)).toContain('isEventRelay');
        } finally {
            await cleanupInOrder([
                async () => {
                    restore?.();
                },
                async () => {
                    if (source?.isInitialized === true) {
                        await source.destroy();
                    }
                },
                async () => schema?.cleanup(),
                async () => runtime?.cleanup(),
            ]);
        }
    }, 60_000);

    it('[PERSIST-1.4-MYSQL-APPLIED] preserves already-applied MySQL history on a new connection without downgrade', async () => {
        let runtime: IsolatedCompiledRuntime | undefined;
        let schema: Awaited<ReturnType<MySqlRuntime['createSchema']>> | undefined;
        let first: DataSource | undefined;
        let second: DataSource | undefined;
        try {
            runtime = await createIsolatedCompiledRuntime();
            schema = await databaseRuntime.createSchema();
            const firstOperator = runtime.createOperator({ dbtype: 'mysql', mysql: schema.config }, logger());
            first = await firstOperator.getConnection();
            const before = await migrationNames(first);
            await firstOperator.closeConnection();

            const secondOperator = runtime.createOperator({ dbtype: 'mysql', mysql: schema.config }, logger());
            second = await secondOperator.getConnection();
            expect(second).not.toBe(first);
            expect(before).toEqual(expectedMysqlMigrations);
            await expect(migrationNames(second)).resolves.toEqual(before);
        } finally {
            await cleanupInOrder([
                ...[first, second].map(source => async () => {
                    if (source?.isInitialized === true) {
                        await source.destroy();
                    }
                }),
                async () => schema?.cleanup(),
                async () => runtime?.cleanup(),
            ]);
        }
    }, 60_000);

    it('[PERSIST-1.4-MYSQL-RETRY] preserves the migration error when TypeORM cleanup fails and retries it with a new MySQL candidate', async () => {
        let runtime: IsolatedCompiledRuntime | undefined;
        let schema: Awaited<ReturnType<MySqlRuntime['createSchema']>> | undefined;
        let restore: (() => void) | undefined;
        const mysqlAttemptKey = `${syntheticAttemptKey}_MYSQL`;
        const primaryErrorKey = `${syntheticAttemptKey}_MYSQL_PRIMARY_ERROR`;
        const migrationControlKey = `${syntheticAttemptKey}_MYSQL_CONTROL`;
        const primaryError = new Error('SYNTHETIC_MYSQL_MIGRATION_REJECTION');
        const cleanupError = new Error('SYNTHETIC_MYSQL_DESTROY_REJECTION');
        const candidates: DataSource[] = [];
        const destroySpies: Array<ReturnType<typeof vi.spyOn>> = [];
        let migrationRelease: Deferred<void> | undefined;
        let first: Promise<DataSource> | undefined;
        let second: Promise<DataSource> | undefined;
        let late: Promise<DataSource> | undefined;
        let migrationStartWatchdog: StartWatchdog<void> | undefined;
        let migrationStartObserved = false;
        try {
            runtime = await createIsolatedCompiledRuntime();
            schema = await databaseRuntime.createSchema();
            const syntheticMigrationPath = join(
                runtime.compiledSnapshot,
                'db',
                'migrations',
                'mysql',
                '1900000000001-SyntheticMysqlRetry.js',
            );
            (globalThis as Record<string, unknown>)[primaryErrorKey] = primaryError;
            const migrationStarted = createDeferred<void>();
            migrationRelease = createDeferred<void>();
            (globalThis as Record<string, unknown>)[migrationControlKey] = {
                release: migrationRelease.promise,
                started: () => migrationStarted.resolve(undefined),
            };
            await writeFile(
                syntheticMigrationPath,
                `export class SyntheticMysqlRetry1900000000001 {\n  constructor() { this.name = 'SyntheticMysqlRetry1900000000001'; }\n  async up(queryRunner) {\n    const control = globalThis['${migrationControlKey}'];\n    control.started();\n    await control.release;\n    const key = '${mysqlAttemptKey}';\n    if (globalThis[key] !== true) { globalThis[key] = true; throw globalThis['${primaryErrorKey}']; }\n    await queryRunner.query('CREATE TABLE synthetic_mysql_retry (id int NOT NULL PRIMARY KEY)');\n  }\n  async down() { throw new Error('SYNTHETIC_MYSQL_DOWN_MUST_NOT_RUN'); }\n}\n`,
                'utf8',
            );
            restore = await installDataSourceFactory((options: DataSourceOptions) => {
                const source = new RealDataSource(options);
                candidates.push(source);
                const destroy = source.destroy.bind(source);
                destroySpies.push(
                    vi.spyOn(source, 'destroy').mockImplementation(async () => {
                        await destroy();
                        throw cleanupError;
                    }),
                );
                return source;
            });
            const testLogger = logger();
            const operator = await createMockedOperator(
                runtime,
                { dbtype: 'mysql', mysql: schema.config },
                testLogger,
            );
            // A real MySQL connection under a loaded 4-vCPU CI host can take several seconds to
            // reach the migration; the oracle is that it starts, not that it starts within 1 s.
            migrationStartWatchdog = createStartWatchdog(
                migrationStarted.promise,
                'MySQL retry migration',
                MYSQL_MIGRATION_START_BUDGET_MS,
            );
            first = operator.getConnection();
            second = operator.getConnection();
            await migrationStartWatchdog.wait;
            migrationStartObserved = true;
            migrationStartWatchdog.cancel();
            late = operator.getConnection();

            expect(second).toBe(first);
            expect(late).toBe(first);
            expect(candidates).toHaveLength(1);
            migrationRelease.resolve(undefined);
            const [firstError, secondError, lateError] = await Promise.all([
                first.catch(error => error),
                second.catch(error => error),
                late.catch(error => error),
            ]);

            expect(firstError).toBe(primaryError);
            expect(secondError).toBe(primaryError);
            expect(lateError).toBe(primaryError);
            expect(candidates).toHaveLength(1);
            expect(candidates[0].isInitialized).toBe(false);
            expect(destroySpies[0]).toHaveBeenCalledTimes(1);
            expect(testLogger.system.error).toHaveBeenCalledTimes(2);
            expect(testLogger.system.error).toHaveBeenNthCalledWith(
                1,
                'failed to close database initialization candidate',
            );
            expect(testLogger.system.error).toHaveBeenNthCalledWith(2, cleanupError);

            const recovered = await operator.getConnection();
            expect(candidates).toHaveLength(2);
            expect(recovered).toBe(candidates[1]);
            expect(recovered).not.toBe(candidates[0]);
            await expect(migrationNames(recovered)).resolves.toEqual([
                ...expectedMysqlMigrations,
                'SyntheticMysqlRetry1900000000001',
            ]);
            const migrationsTable = (await recovered.query("SHOW TABLES LIKE 'migrations'")) as unknown[];
            expect(migrationsTable).toHaveLength(1);
            const table = (await recovered.query("SHOW TABLES LIKE 'synthetic_mysql_retry'")) as unknown[];
            expect(table).toHaveLength(1);
        } finally {
            migrationStartWatchdog?.cancel();
            await cleanupTestOperationsAfterStartWatchdog(
                migrationStartObserved,
                () => migrationRelease?.resolve(undefined),
                [first, second, late].filter((operation): operation is Promise<DataSource> => operation !== undefined),
            );
            delete (globalThis as Record<string, unknown>)[mysqlAttemptKey];
            delete (globalThis as Record<string, unknown>)[primaryErrorKey];
            delete (globalThis as Record<string, unknown>)[migrationControlKey];
            await cleanupInOrder([
                async () => {
                    restore?.();
                    destroySpies.forEach(spy => spy.mockRestore());
                },
                ...candidates.map(source => async () => {
                    if (source.isInitialized) {
                        await source.destroy();
                    }
                }),
                async () => schema?.cleanup(),
                async () => runtime?.cleanup(),
            ]);
        }
    }, 60_000);

    it('[PERSIST-1.4-MYSQL-DOWN] reverts the four forward migrations through undoLastMigration in reverse order', async () => {
        let runtime: IsolatedCompiledRuntime | undefined;
        let schema: Awaited<ReturnType<MySqlRuntime['createSchema']>> | undefined;
        let source: DataSource | undefined;
        try {
            runtime = await createIsolatedCompiledRuntime();
            schema = await databaseRuntime.createSchema();
            const operator = runtime.createOperator({ dbtype: 'mysql', mysql: schema.config }, logger());
            source = await operator.getConnection();
            await expect(migrationNames(source)).resolves.toEqual(expectedMysqlMigrations);

            await source.undoLastMigration();
            await expect(migrationNames(source)).resolves.toEqual(expectedMysqlMigrations.slice(0, 3));
            const ruleAfterBS4KRevert = (await source.query('SHOW COLUMNS FROM `rule`')) as Array<{
                Field: string;
            }>;
            expect(ruleAfterBS4KRevert.map(column => column.Field)).not.toContain('BS4K');
            expect(ruleAfterBS4KRevert.map(column => column.Field)).toContain('SKY');

            await source.undoLastMigration();
            await expect(migrationNames(source)).resolves.toEqual(expectedMysqlMigrations.slice(0, 2));
            const reserveAfterEventRelayRevert = (await source.query('SHOW COLUMNS FROM `reserve`')) as Array<{
                Field: string;
            }>;
            expect(reserveAfterEventRelayRevert.map(column => column.Field)).not.toContain('isEventRelay');
            expect(reserveAfterEventRelayRevert.map(column => column.Field)).toContain('rawExtended');

            await source.undoLastMigration();
            await expect(migrationNames(source)).resolves.toEqual(expectedMysqlMigrations.slice(0, 1));
            const programAfterRawExtendedRevert = (await source.query('SHOW COLUMNS FROM `program`')) as Array<{
                Field: string;
            }>;
            const reserveAfterRawExtendedRevert = (await source.query('SHOW COLUMNS FROM `reserve`')) as Array<{
                Field: string;
            }>;
            expect(programAfterRawExtendedRevert.map(column => column.Field)).not.toContain('rawExtended');
            expect(reserveAfterRawExtendedRevert.map(column => column.Field)).not.toContain('rawExtended');

            await source.undoLastMigration();
            await expect(migrationNames(source)).resolves.toEqual([]);
            const remainingTables = (await source.query('SHOW TABLES')) as Array<Record<string, string>>;
            const remainingTableNames = remainingTables.map(row => Object.values(row)[0]);
            expect(remainingTableNames).not.toContain('reserve');
            expect(remainingTableNames).not.toContain('program');
            expect(remainingTableNames).not.toContain('channel');
        } finally {
            await cleanupInOrder([
                async () => {
                    if (source?.isInitialized === true) {
                        await source.destroy();
                    }
                },
                async () => schema?.cleanup(),
                async () => runtime?.cleanup(),
            ]);
        }
    }, 60_000);

    it('[PERSIST-1.4-MYSQL-BS4K-PRESERVE] applies AddRuleBS4K onto a preexisting rule row, defaulting BS4K to false without disturbing its other columns', async () => {
        let runtime: IsolatedCompiledRuntime | undefined;
        let schema: Awaited<ReturnType<MySqlRuntime['createSchema']>> | undefined;
        let source: DataSource | undefined;
        try {
            runtime = await createIsolatedCompiledRuntime();
            schema = await databaseRuntime.createSchema();
            const operator = runtime.createOperator({ dbtype: 'mysql', mysql: schema.config }, logger());
            source = await operator.getConnection();
            await expect(migrationNames(source)).resolves.toEqual(expectedMysqlMigrations);

            // Revert only AddRuleBS4K so the row inserted below lands on the pre-migration `rule`
            // schema, the same shape a v2 database being moved onto this candidate would have.
            await source.undoLastMigration();
            await expect(migrationNames(source)).resolves.toEqual(expectedMysqlMigrations.slice(0, 3));
            await source.query(
                'INSERT INTO `rule` (`keyword`, `GR`, `BS`, `CS`, `SKY`, `enable`, `allowEndLack`, `tags`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                ['v2 imported keyword', 1, 0, 1, 0, 1, 0, 'tag-a,tag-b'],
            );
            const beforeRows = (await source.query('SELECT * FROM `rule` WHERE `keyword` = ?', [
                'v2 imported keyword',
            ])) as Array<Record<string, unknown>>;
            expect(beforeRows).toHaveLength(1);
            expect(Object.keys(beforeRows[0])).not.toContain('BS4K');
            const insertedId = beforeRows[0].id;

            await source.runMigrations();
            await expect(migrationNames(source)).resolves.toEqual(expectedMysqlMigrations);

            const afterRows = (await source.query('SELECT * FROM `rule` WHERE `id` = ?', [
                insertedId,
            ])) as Array<Record<string, unknown>>;
            expect(afterRows).toHaveLength(1);
            const [row] = afterRows;
            expect(row.id).toBe(insertedId);
            expect(Number(row.BS4K)).toBe(0);
            expect(row.keyword).toBe('v2 imported keyword');
            expect(Number(row.GR)).toBe(1);
            expect(Number(row.BS)).toBe(0);
            expect(Number(row.CS)).toBe(1);
            expect(Number(row.SKY)).toBe(0);
            expect(Number(row.enable)).toBe(1);
            expect(Number(row.allowEndLack)).toBe(0);
            expect(row.tags).toBe('tag-a,tag-b');
        } finally {
            await cleanupInOrder([
                async () => {
                    if (source?.isInitialized === true) {
                        await source.destroy();
                    }
                },
                async () => schema?.cleanup(),
                async () => runtime?.cleanup(),
            ]);
        }
    }, 60_000);

    it('[PERSIST-1.4-MYSQL-RETRY-WATCHDOG-TEARDOWN] reaches a never-starting migration through operator.getConnection, then finishes test teardown without awaiting that product promise', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        const schema = await databaseRuntime.createSchema();
        const syntheticMigrationPath = join(
            runtime.compiledSnapshot,
            'db',
            'migrations',
            'mysql',
            '1900000000002-SyntheticMysqlNeverStarting.js',
        );
        const migrationEntered = createDeferred<void>();
        const migrationStarted = createDeferred<void>();
        const migrationControlKey = `${syntheticAttemptKey}_MYSQL_NEVER_STARTING_CONTROL`;
        (globalThis as Record<string, unknown>)[migrationControlKey] = {
            entered: () => migrationEntered.resolve(undefined),
        };
        await writeFile(
            syntheticMigrationPath,
            `export class SyntheticMysqlNeverStarting1900000000002 {\n  constructor() { this.name = 'SyntheticMysqlNeverStarting1900000000002'; }\n  async up() {\n    globalThis['${migrationControlKey}'].entered();\n    await new Promise(() => {});\n  }\n  async down() { throw new Error('SYNTHETIC_MYSQL_NEVER_STARTING_DOWN_MUST_NOT_RUN'); }\n}\n`,
            'utf8',
        );

        const candidates: DataSource[] = [];
        const restore = await installDataSourceFactory((options: DataSourceOptions) => {
            const source = new RealDataSource(options);
            candidates.push(source);
            return source;
        });
        const operator = await createMockedOperator(runtime, { dbtype: 'mysql', mysql: schema.config }, logger());
        let first: Promise<DataSource> | undefined;
        let migrationEnteredWatchdog: StartWatchdog<void> | undefined;
        let migrationStartWatchdog: StartWatchdog<void> | undefined;
        let migrationStartObserved = false;
        let productPromiseSettled = false;
        let teardownCompleted = false;
        try {
            migrationEnteredWatchdog = createStartWatchdog(
                migrationEntered.promise,
                'MySQL never-starting migration entry',
                MYSQL_MIGRATION_START_BUDGET_MS,
            );
            migrationStartWatchdog = createStartWatchdog(migrationStarted.promise, 'MySQL never-starting migration');
            first = operator.getConnection();
            void first.then(
                () => {
                    productPromiseSettled = true;
                },
                () => {
                    productPromiseSettled = true;
                },
            );
            await migrationEnteredWatchdog.wait;
            await expect(migrationStartWatchdog.wait).rejects.toThrow('MySQL never-starting migration did not start');
            expect(candidates).toHaveLength(1);
            expect(productPromiseSettled).toBe(false);
        } finally {
            migrationEnteredWatchdog?.cancel();
            migrationStartWatchdog?.cancel();
            await cleanupTestOperationsAfterStartWatchdog(migrationStartObserved, () => undefined, [first]);
            delete (globalThis as Record<string, unknown>)[migrationControlKey];
            restore();
            await cleanupInOrder([
                ...candidates.map(source => async () => {
                    if (source.isInitialized) {
                        await source.destroy();
                    }
                }),
                async () => schema.cleanup(),
                () => cleanup(runtime),
            ]);
            teardownCompleted = true;
        }

        expect(migrationStartObserved).toBe(false);
        expect(productPromiseSettled).toBe(false);
        expect(teardownCompleted).toBe(true);
    }, 10_000);

    // The container is removed here, in a test of its own with the budget its provisioning has, rather than in
    // `afterAll`: the Docker daemon answers `docker rm --force` late while it is busy (an image export holds
    // it for tens of seconds), and a hook only has a fixed budget. The `afterAll` above confirms the
    // container is gone and removes it itself only when this test did not run (a filtered or aborted file).
    it(
        'releases the isolated MySQL fixture container after every case of the file',
        async () => {
            await databaseRuntime?.cleanup();
        },
        MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS,
    );
});
