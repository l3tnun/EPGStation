import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    EXPECTED_MYSQL_MIGRATIONS,
    MYSQL_MIGRATION_CASE_TIMEOUT_MS,
    createBackendRuntime,
    createMigratedMysqlSchemaHolder,
    type BackendDialect,
} from './backend-runtime';
import { cleanupInOrder, type TestLogger } from './harness';
import { MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS, provisionMySql, type MySqlRuntime } from './mysql-runtime';

const logger = (): TestLogger => ({ system: { error: () => undefined, info: () => undefined } });

let mysqlRuntime: MySqlRuntime;

beforeAll(async () => {
    mysqlRuntime = await provisionMySql();
}, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

// The MySQL schema is migrated by the operator once, in `[PERSIST-6.1-MYSQL-CLOSE-SCHEMA]` below, under its own
// explicit timeout; the close case connects to that schema instead of paying about 245 sequential DDL
// statements of migration inside its default 5 s. A close case run without it (a filtered run) prepares the
// schema itself.
const migratedSchema = createMigratedMysqlSchemaHolder(() => mysqlRuntime, logger);

afterAll(async () => {
    await cleanupInOrder([() => migratedSchema.release(), async () => mysqlRuntime.cleanup()]);
});

it(
    '[PERSIST-6.1-MYSQL-CLOSE-SCHEMA] applies the operator-managed forward migrations to the schema the MySQL close case uses',
    async () => {
        const { appliedMigrations } = await migratedSchema.acquire();
        expect(appliedMigrations).toEqual(EXPECTED_MYSQL_MIGRATIONS);
    },
    MYSQL_MIGRATION_CASE_TIMEOUT_MS,
);

describe.each(['sqlite', 'mysql'] as const)('terminal close through real %s', dialect => {
    it('[PERSIST-1.9-BACKEND-LIFECYCLE] closes an initialized backend once and leaves the cached instance terminal', async () => {
        const runtime = await createBackendRuntime(
            dialect as BackendDialect,
            mysqlRuntime,
            logger(),
            dialect === 'mysql' ? { schema: (await migratedSchema.acquire()).schema } : {},
        );
        try {
            await expect(runtime.operator.getConnection()).resolves.toBe(runtime.source);
            await expect(runtime.operator.checkConnection()).resolves.toBeUndefined();

            await expect(runtime.operator.closeConnection()).resolves.toBeUndefined();
            expect(runtime.source.isInitialized).toBe(false);
            await expect(runtime.operator.getConnection()).resolves.toBe(runtime.source);
            await expect(runtime.operator.checkConnection()).rejects.toBeInstanceOf(Error);
            await expect(runtime.operator.closeConnection()).rejects.toBeInstanceOf(Error);
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
