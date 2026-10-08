import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createOperator, type TestLogger } from './harness';
import {
    captureOfficialMySqlLtsSchemaSnapshot,
    cleanupOfficialMySqlLtsSession,
    provisionOfficialMySqlLts,
} from './mysql-lts-runtime';

const logger = (): TestLogger => ({ system: { error: vi.fn(), info: vi.fn() } });
const fixtureRoot = resolve(process.cwd(), 'test/server/fixtures/persistence/mysql-inplace');
const expectedMigrations = [
    'Init1601186196169',
    'AddRawExtended1624084351785',
    'AddEventRelay1716647383635',
    'AddRuleBS4K1790497623885',
] as const;

describe('DBOperator official MySQL LTS in-place stored data', () => {
    it('[PERSIST-8.3-INPLACE-SCHEMA-ORACLE] distinguishes index-only schema changes that column names would miss', async () => {
        const createWithoutIndex =
            'recorded\tCREATE TABLE `recorded` (\n  `id` int NOT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB';
        const createWithIndex =
            'recorded\tCREATE TABLE `recorded` (\n  `id` int NOT NULL,\n  UNIQUE INDEX `REL_x` (`dropLogFileId`),\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB';
        const apply = (createTable: string) => async (sql: string): Promise<string> => {
            if (sql.includes('information_schema.TABLES')) {
                return 'recorded';
            }
            if (sql.includes('SHOW CREATE TABLE')) {
                return createTable;
            }
            throw new Error(`unexpected sql: ${sql}`);
        };

        expect(await captureOfficialMySqlLtsSchemaSnapshot(apply(createWithoutIndex))).not.toEqual(
            await captureOfficialMySqlLtsSchemaSnapshot(apply(createWithIndex)),
        );
    });

    it('[PERSIST-8.3-INPLACE-STORED-DATA] reads and updates preexisting LTS rows, applying only the pending BS4K rule-column migration and changing nothing else in schema or migration history', async () => {
        const [schemaSql, seedSql] = await Promise.all([
            readFile(resolve(fixtureRoot, 'schema.sql'), 'utf8'),
            readFile(resolve(fixtureRoot, 'seed.sql'), 'utf8'),
        ]);

        const runtime = await provisionOfficialMySqlLts();
        let schema: Awaited<ReturnType<typeof runtime.createSchema>> | undefined;
        let operator: ReturnType<typeof createOperator> | undefined;
        let source: { isInitialized: boolean } | undefined;
        try {
            const activeSchema = await runtime.createSchema();
            schema = activeSchema;
            await activeSchema.applySql(schemaSql);
            await activeSchema.applySql(seedSql);
            const schemaBefore = await captureOfficialMySqlLtsSchemaSnapshot(sql => activeSchema.applySql(sql));
            // `schemaSql` fixes an LTS DB as it existed before the BS4K rule-column migration, so
            // connecting the operator here is expected to apply exactly that one pending migration
            // (adding `rule`.`BS4K`) and nothing else. Capture the `rule` table's own CREATE TABLE
            // separately so the assertions below can prove that migration touched only this table.
            const stabilize = (createTable: string) => createTable.replace(/AUTO_INCREMENT=\d+/gu, 'AUTO_INCREMENT=N');
            const ruleDdlBefore = stabilize(await activeSchema.applySql('SHOW CREATE TABLE `rule`'));
            expect(ruleDdlBefore).not.toContain('`BS4K`');
            operator = createOperator({ dbtype: 'mysql', mysql: activeSchema.config }, logger());
            source = await operator.getConnection();

            const channels = (await source.query('SELECT id, name FROM channel ORDER BY id ASC')) as Array<{
                id: string | number;
                name: string;
            }>;
            const programs = (await source.query('SELECT id, name FROM program ORDER BY id ASC')) as Array<{
                id: string | number;
                name: string;
            }>;
            expect(channels).toEqual([{ id: expect.anything(), name: 'synthetic-gr-channel' }]);
            expect(String(channels[0].id)).toBe('3273601024');
            expect(programs).toEqual([{ id: expect.anything(), name: 'synthetic-program' }]);
            expect(String(programs[0].id)).toBe('327360102400001');

            await source.query("UPDATE program SET name = 'synthetic-program-updated' WHERE id = 327360102400001");
            const reread = (await source.query('SELECT name FROM program WHERE id = 327360102400001')) as Array<{
                name: string;
            }>;
            expect(reread).toEqual([{ name: 'synthetic-program-updated' }]);

            const migrations = (await source.query('SELECT name FROM migrations ORDER BY id ASC')) as Array<{
                name: string;
            }>;
            expect(migrations.map(row => row.name)).toEqual([...expectedMigrations]);

            const ruleDdlAfter = stabilize(await activeSchema.applySql('SHOW CREATE TABLE `rule`'));
            expect(ruleDdlAfter).toContain('`BS4K` tinyint NOT NULL DEFAULT');
            const schemaAfter = await captureOfficialMySqlLtsSchemaSnapshot(sql => activeSchema.applySql(sql));
            expect(schemaAfter).not.toBe(schemaBefore);
            // Substituting the post-migration `rule` DDL back for its pre-migration form must reproduce
            // `schemaBefore` byte-for-byte: proves the BS4K migration changed the `rule` table only, and
            // every other table (including `migrations`' own structure) is untouched.
            expect(schemaAfter.split(ruleDdlAfter).join(ruleDdlBefore)).toBe(schemaBefore);

            await expect(operator.closeConnection()).resolves.toBeUndefined();
            expect(source.isInitialized).toBe(false);
        } finally {
            await cleanupOfficialMySqlLtsSession({ operator, source, schema, runtime });
        }
    }, 90_000);
});
