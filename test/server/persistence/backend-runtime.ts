import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DataSource } from 'typeorm';

import {
    cleanupInOrder,
    compiledSnapshot,
    createIsolatedCompiledRuntime,
    createOperator,
    type DBOperatorRuntime,
    type IsolatedCompiledRuntime,
    type TestLogger,
} from './harness';
import type { MySqlRuntime, MysqlSchema } from './mysql-runtime';

export type BackendDialect = 'mysql' | 'sqlite';

export interface BackendRuntime {
    readonly dialect: BackendDialect;
    readonly operator: DBOperatorRuntime;
    readonly snapshot: string;
    readonly source: DataSource;
    cleanup(): Promise<void>;
}

export interface BackendRuntimeOptions {
    /**
     * An existing MySQL schema this backend connects to instead of creating one. The caller owns it: this
     * backend's `cleanup()` destroys the data source and leaves the schema in place.
     */
    readonly schema?: MysqlSchema;
}

export async function createBackendRuntime(
    dialect: BackendDialect,
    mysqlRuntime: MySqlRuntime,
    logger: TestLogger,
    options: BackendRuntimeOptions = {},
): Promise<BackendRuntime> {
    let runtime: IsolatedCompiledRuntime | undefined;
    let schema: MysqlSchema | undefined;
    let source: DataSource | undefined;
    const ownedSchema = (): MysqlSchema | undefined => (options.schema === undefined ? schema : undefined);

    try {
        let operator: DBOperatorRuntime;
        let snapshot: string;
        if (dialect === 'sqlite') {
            runtime = await createIsolatedCompiledRuntime();
            await mkdir(dirname(runtime.sqliteDatabasePath), { recursive: true });
            operator = runtime.createOperator({ dbtype: 'sqlite' }, logger);
            snapshot = runtime.compiledSnapshot;
        } else {
            schema = options.schema ?? (await mysqlRuntime.createSchema());
            operator = createOperator({ dbtype: 'mysql', mysql: schema.config }, logger);
            snapshot = compiledSnapshot;
        }
        source = await operator.getConnection();

        return {
            dialect,
            operator,
            snapshot,
            source,
            cleanup: () =>
                cleanupInOrder([
                    async () => {
                        if (source?.isInitialized === true) await source.destroy();
                    },
                    async () => ownedSchema()?.cleanup(),
                    async () => runtime?.cleanup(),
                ]),
        };
    } catch (error) {
        try {
            await cleanupInOrder([
                async () => {
                    if (source?.isInitialized === true) await source.destroy();
                },
                async () => ownedSchema()?.cleanup(),
                async () => runtime?.cleanup(),
            ]);
        } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Backend persistence fixture setup and cleanup failed');
        }
        throw error;
    }
}

/** The forward migrations the MySQL operator applies to an empty schema, in order. */
export const EXPECTED_MYSQL_MIGRATIONS = [
    'Init1601186196169',
    'AddRawExtended1624084351785',
    'AddEventRelay1716647383635',
    'AddRuleBS4K1790497623885',
] as const;

/** The explicit budget of a case that applies the operator's forward migrations to an empty MySQL schema. */
export const MYSQL_MIGRATION_CASE_TIMEOUT_MS = 60_000;

export const appliedMigrationNames = async (source: DataSource): Promise<string[]> => {
    const rows = (await source.query('SELECT name FROM migrations ORDER BY id ASC')) as Array<{ name: string }>;
    return rows.map(row => row.name);
};

export interface MigratedMysqlSchema {
    readonly appliedMigrations: readonly string[];
    readonly schema: MysqlSchema;
}

/**
 * Creates a MySQL schema and lets the operator apply its forward migrations to it (about 245 sequential DDL
 * statements, around one second), then returns the schema with the migration names the operator recorded.
 * A fixture file whose cases need a migrated schema pays that once, in a case of its own that asserts the
 * recorded names within `MYSQL_MIGRATION_CASE_TIMEOUT_MS`, and hands the schema to `createBackendRuntime` through
 * `options.schema` for the cases that follow, so none of them repeats the migration. The caller releases
 * the schema through `schema.cleanup()`.
 */
export async function prepareMigratedMysqlSchema(
    mysqlRuntime: MySqlRuntime,
    logger: TestLogger,
): Promise<MigratedMysqlSchema> {
    const schema = await mysqlRuntime.createSchema();
    try {
        const backend = await createBackendRuntime('mysql', mysqlRuntime, logger, { schema });
        try {
            return { appliedMigrations: await appliedMigrationNames(backend.source), schema };
        } finally {
            await backend.cleanup();
        }
    } catch (error) {
        try {
            await schema.cleanup();
        } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Migrated MySQL schema setup and cleanup failed');
        }
        throw error;
    }
}

export interface MigratedMysqlSchemaHolder {
    /** The file's migrated schema; the first caller pays the migration, later callers reuse it. */
    acquire(): Promise<MigratedMysqlSchema>;
    /** Drops the schema if it was created. Call it before the MySQL container is removed. */
    release(): Promise<void>;
}

export function createMigratedMysqlSchemaHolder(
    mysqlRuntime: () => MySqlRuntime,
    logger: () => TestLogger,
): MigratedMysqlSchemaHolder {
    let pending: Promise<MigratedMysqlSchema> | undefined;
    return {
        acquire: () => {
            pending ??= prepareMigratedMysqlSchema(mysqlRuntime(), logger());
            return pending;
        },
        release: async () => {
            const taken = pending;
            pending = undefined;
            // A schema whose preparation failed has already been released by the preparation.
            const migrated = await taken?.catch(() => undefined);
            await migrated?.schema.cleanup();
        },
    };
}
