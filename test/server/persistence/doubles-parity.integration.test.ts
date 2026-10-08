import 'reflect-metadata';

import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { makeRule } from '../fixtures/reservation-rules/runtime';
import { makeModel, makeReserve } from '../reservation-management/_harness';
import { createBackendRuntime, type BackendRuntime } from './backend-runtime';
import { cleanupInOrder, createIsolatedCompiledRuntime, type TestLogger } from './harness';
import { MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS, provisionMySql, type MySqlRuntime } from './mysql-runtime';
import {
    createRepositoryPersistence,
    immediateRetry,
    loadCompiledDefault,
    type RepositoryDialect,
    type RepositoryPersistence,
} from './repository-harness';
import { silentLoggerModel } from '../harness/silent-logger-model';

/*
 * 永続化の test が使う偽物（synchronize で作る schema、手書きの operator、即時の retry、microtask だけで解決する
 * DB model、SQL を作らない query builder）が、本番の部品（migration で作る schema、本物の DBOperator、本物の
 * PromiseRetry、本物の better-sqlite3 と MySQL の driver）と同じに振る舞うことを確かめる。
 */

const require = createRequire(join(process.cwd(), 'package.json'));
const { getLoadablePath } = require('sqlite-regex') as { getLoadablePath(): string };
const PromiseRetry = loadCompiledDefault<{ run<T>(job: () => Promise<T>, option?: unknown): Promise<T> }>(
    'model/PromiseRetry.js',
);
const ReserveDB = loadCompiledDefault<Record<string, (...arguments_: any[]) => Promise<any>>>('model/db/ReserveDB.js');

let mysqlRuntime: MySqlRuntime | undefined;

beforeAll(async () => {
    mysqlRuntime = await provisionMySql();
}, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

afterAll(async () => {
    await cleanupInOrder([async () => mysqlRuntime?.cleanup()]);
}, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

const silent = (): TestLogger => ({ system: { error: vi.fn(), info: vi.fn() } });

const withRepository = async (
    dialect: RepositoryDialect,
    run: (fixture: RepositoryPersistence) => Promise<void>,
): Promise<void> => {
    const fixture = await createRepositoryPersistence(dialect, mysqlRuntime);
    try {
        await run(fixture);
    } finally {
        await fixture.cleanup();
    }
};

const withBackend = async (dialect: RepositoryDialect, run: (backend: BackendRuntime) => Promise<void>) => {
    const backend = await createBackendRuntime(dialect, mysqlRuntime!, silent());
    try {
        await run(backend);
    } finally {
        await backend.cleanup();
    }
};

interface ColumnShape {
    readonly name: string;
    readonly type: string;
    readonly nullable: boolean;
    readonly defaultValue: string | null;
    readonly primary: boolean;
}

interface IndexShape {
    readonly columns: string;
    readonly unique: boolean;
}

interface TableShape {
    readonly columns: ColumnShape[];
    readonly indexes: IndexShape[];
}

const normalizeDefault = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value).replace(/^'(.*)'$/u, '$1');

const readSchema = async (source: DataSource, dialect: RepositoryDialect): Promise<Record<string, TableShape>> => {
    const shapes: Record<string, TableShape> = {};
    if (dialect === 'sqlite') {
        const tables = (await source.query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'migrations' ORDER BY name",
        )) as Array<{ name: string }>;
        for (const { name } of tables) {
            const columns = (await source.query(`PRAGMA table_info("${name}")`)) as Array<{
                name: string;
                type: string;
                notnull: number;
                dflt_value: unknown;
                pk: number;
            }>;
            const indexList = (await source.query(`PRAGMA index_list("${name}")`)) as Array<{
                name: string;
                unique: number;
                origin: string;
            }>;
            const indexes: IndexShape[] = [];
            for (const index of indexList) {
                const indexColumns = (await source.query(`PRAGMA index_info("${index.name}")`)) as Array<{
                    name: string;
                }>;
                indexes.push({
                    columns: `${index.origin}:${indexColumns.map(column => column.name).join(',')}`,
                    unique: index.unique === 1,
                });
            }
            shapes[name] = {
                columns: columns
                    .map(column => ({
                        name: column.name,
                        type: column.type.toLowerCase(),
                        nullable: column.notnull === 0,
                        defaultValue: normalizeDefault(column.dflt_value),
                        primary: column.pk > 0,
                    }))
                    .sort((left, right) => left.name.localeCompare(right.name)),
                indexes: indexes.sort((left, right) => left.columns.localeCompare(right.columns)),
            };
        }
        return shapes;
    }
    const database = ((await source.query('SELECT DATABASE() AS name')) as Array<{ name: string }>)[0].name;
    const columns = (await source.query(
        `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
                COLUMN_DEFAULT AS defaultValue, COLUMN_KEY AS columnKey
           FROM information_schema.columns WHERE TABLE_SCHEMA = ? AND TABLE_NAME <> 'migrations'`,
        [database],
    )) as Array<{
        tableName: string;
        name: string;
        type: string;
        nullable: string;
        defaultValue: unknown;
        columnKey: string;
    }>;
    const statistics = (await source.query(
        `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
                GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnNames
           FROM information_schema.statistics WHERE TABLE_SCHEMA = ? AND TABLE_NAME <> 'migrations'
          GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE`,
        [database],
    )) as Array<{ tableName: string; indexName: string; nonUnique: number | string; columnNames: string }>;
    for (const column of columns) {
        shapes[column.tableName] ??= { columns: [], indexes: [] };
        shapes[column.tableName].columns.push({
            name: column.name,
            type: column.type.toLowerCase(),
            nullable: column.nullable === 'YES',
            defaultValue: normalizeDefault(column.defaultValue),
            primary: column.columnKey === 'PRI',
        });
    }
    for (const index of statistics) {
        shapes[index.tableName] ??= { columns: [], indexes: [] };
        shapes[index.tableName].indexes.push({
            columns: `${index.indexName === 'PRIMARY' ? 'pk' : 'index'}:${index.columnNames}`,
            unique: Number(index.nonUnique) === 0,
        });
    }
    for (const shape of Object.values(shapes)) {
        shape.columns.sort((left, right) => left.name.localeCompare(right.name));
        shape.indexes.sort((left, right) => left.columns.localeCompare(right.columns));
    }
    return Object.fromEntries(Object.entries(shapes).sort(([left], [right]) => left.localeCompare(right)));
};

describe('test schema harness against the production migrations', () => {
    it.each(['sqlite', 'mysql'] as const)(
        '[PERSIST-DOUBLE-PARITY-SCHEMA] builds the same tables, columns, defaults, nullability, and indexes from entity synchronize as the production migrations on %s',
        async dialect => {
            let synchronized: Record<string, TableShape> | undefined;
            await withRepository(dialect, async ({ source }) => {
                synchronized = await readSchema(source, dialect);
            });
            let migrated: Record<string, TableShape> | undefined;
            await withBackend(dialect, async ({ source }) => {
                migrated = await readSchema(source, dialect);
            });

            expect(Object.keys(synchronized!)).toEqual(Object.keys(migrated!));
            for (const table of Object.keys(migrated!)) {
                expect({ table, columns: synchronized![table].columns }).toEqual({
                    table,
                    columns: migrated![table].columns,
                });
                expect({ table, indexes: synchronized![table].indexes }).toEqual({
                    table,
                    indexes: migrated![table].indexes,
                });
            }
        },
        120_000,
    );
});

describe('DataSource double against real driver failures', () => {
    const unusedPort = async (): Promise<number> =>
        new Promise((resolve, reject) => {
            const server = createServer();
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                server.close(() => resolve(typeof address === 'object' && address !== null ? address.port : 0));
            });
        });

    it('[PERSIST-DOUBLE-PARITY-CONNECTION] rejects a real MySQL authentication failure on every call without publishing a connection', async () => {
        const schema = await mysqlRuntime!.createSchema();
        const runtime = await createIsolatedCompiledRuntime();
        try {
            const logger = silent();
            const operator = runtime.createOperator(
                { dbtype: 'mysql', mysql: { ...schema.config, password: '<synthetic-wrong-password>' } },
                logger,
            );
            const first = await operator.getConnection().catch((error: unknown) => error);
            const second = await operator.getConnection().catch((error: unknown) => error);

            expect(first).toMatchObject({ code: 'ER_ACCESS_DENIED_ERROR' });
            expect(second).toMatchObject({ code: 'ER_ACCESS_DENIED_ERROR' });
            expect(second).not.toBe(first);
            await expect(operator.closeConnection()).resolves.toBeUndefined();
        } finally {
            await cleanupInOrder([() => runtime.cleanup(), () => schema.cleanup()]);
        }
    }, 60_000);

    it('[PERSIST-DOUBLE-PARITY-CONNECTION] rejects a refused real MySQL endpoint and retries with a fresh attempt on the next call', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        try {
            const port = await unusedPort();
            const operator = runtime.createOperator(
                {
                    dbtype: 'mysql',
                    mysql: {
                        host: '127.0.0.1',
                        port,
                        user: 'synthetic-user',
                        password: '<synthetic-password>',
                        database: 'synthetic_db',
                    },
                },
                silent(),
            );
            const first = await operator.getConnection().catch((error: unknown) => error);
            const second = await operator.getConnection().catch((error: unknown) => error);

            expect(first).toMatchObject({ code: 'ECONNREFUSED' });
            expect(second).toMatchObject({ code: 'ECONNREFUSED' });
            expect(second).not.toBe(first);
        } finally {
            await runtime.cleanup();
        }
    }, 60_000);

    it('[PERSIST-DOUBLE-PARITY-CONNECTION] loads a real sqlite extension listed in the configuration and makes regexp usable', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        let source: DataSource | undefined;
        try {
            await mkdir(dirname(runtime.sqliteDatabasePath), { recursive: true });
            const operator = runtime.createOperator(
                { dbtype: 'sqlite', sqlite: { extensions: [getLoadablePath()], regexp: true } },
                silent(),
            );
            source = await operator.getConnection();

            await expect(source.query("SELECT 'synthetic-value' REGEXP 'value$' AS matched")).resolves.toEqual([
                { matched: 1 },
            ]);
        } finally {
            await cleanupInOrder([
                async () => {
                    if (source?.isInitialized === true) await source.destroy();
                },
                () => runtime.cleanup(),
            ]);
        }
    }, 60_000);

    it('[PERSIST-DOUBLE-PARITY-CONNECTION] rejects a missing real sqlite extension with the driver error and leaves no published connection', async () => {
        const runtime = await createIsolatedCompiledRuntime();
        try {
            await mkdir(dirname(runtime.sqliteDatabasePath), { recursive: true });
            const logger = silent();
            const operator = runtime.createOperator(
                { dbtype: 'sqlite', sqlite: { extensions: [join(runtime.root, 'synthetic-missing-extension')] } },
                logger,
            );

            await expect(operator.getConnection()).rejects.toBeInstanceOf(Error);
            expect(logger.system.error).toHaveBeenCalledWith(
                `failed to load extension: ${join(runtime.root, 'synthetic-missing-extension')}`,
            );
            await expect(operator.getConnection()).rejects.toBeInstanceOf(Error);
        } finally {
            await runtime.cleanup();
        }
    }, 60_000);
});

const insertReserves = async (db: RepositoryPersistence['db']) => {
    const ids: Record<string, number> = {};
    const rows: Array<[string, Record<string, unknown>]> = [
        ['plain', { ruleId: 7, startAt: 1_000, endAt: 2_000 }],
        ['contiguous', { ruleId: 7, startAt: 2_000, endAt: 3_000 }],
        ['skip', { ruleId: 7, startAt: 2_500, endAt: 2_800, isSkip: true }],
        ['conflict', { ruleId: 7, startAt: 1_500, endAt: 2_500, isConflict: true }],
        ['overlap', { ruleId: 7, startAt: 1_200, endAt: 1_800, isOverlap: true }],
        ['relay', { ruleId: 7, startAt: 2_600, endAt: 2_900, isEventRelay: true }],
        ['otherRule', { ruleId: 8, startAt: 1_100, endAt: 1_900 }],
        ['manual', { ruleId: null, startAt: 1_300, endAt: 1_400 }],
        ['manualTime', { ruleId: null, programId: null, isTimeSpecified: true, startAt: 900, endAt: 950 }],
        ['outside', { ruleId: 7, startAt: 5_000, endAt: 6_000 }],
    ];
    for (const [name, overrides] of rows) {
        ids[name] = Number(await db.ReserveDB.insertOnce(makeReserve({ id: undefined, ...overrides })));
    }
    return ids;
};

const idsOf = (rows: Array<{ id: number }>): number[] => rows.map(row => Number(row.id));

describe('query builder doubles against real SQL', () => {
    it.each(['sqlite', 'mysql'] as const)(
        '[PERSIST-DOUBLE-PARITY-QUERY] findTimeRanges returns the rows the builder double expects for every flag and exclusion combination on %s',
        async dialect => {
            await withRepository(dialect, async ({ db }) => {
                const ids = await insertReserves(db);
                const all = [
                    ids.plain,
                    ids.otherRule,
                    ids.overlap,
                    ids.manual,
                    ids.conflict,
                    ids.contiguous,
                    ids.skip,
                    ids.relay,
                ];
                const sortByStart = (selected: number[]) => all.filter(id => selected.includes(id));
                for (const hasSkip of [true, false]) {
                    for (const hasConflict of [true, false]) {
                        for (const hasOverlap of [true, false]) {
                            for (const exclusion of [{}, { excludeReserveId: ids.plain }, { excludeRuleId: 8 }]) {
                                const expected = sortByStart(
                                    all.filter(
                                        id =>
                                            (hasSkip || id !== ids.skip) &&
                                            (hasConflict || id !== ids.conflict) &&
                                            (hasOverlap || id !== ids.overlap) &&
                                            ('excludeReserveId' in exclusion ? id !== ids.plain : true) &&
                                            ('excludeRuleId' in exclusion ? id !== ids.otherRule : true),
                                    ),
                                );
                                const actual = await db.ReserveDB.findTimeRanges({
                                    // 連続する 2 区間と重複した区間（実装が 1 区間にまとめる）
                                    times: [
                                        { startAt: 1_000, endAt: 2_000 },
                                        { startAt: 2_000, endAt: 3_000 },
                                        { startAt: 1_000, endAt: 2_000 },
                                    ],
                                    hasSkip,
                                    hasConflict,
                                    hasOverlap,
                                    ...exclusion,
                                });
                                expect({ hasSkip, hasConflict, hasOverlap, exclusion, ids: idsOf(actual) }).toEqual({
                                    hasSkip,
                                    hasConflict,
                                    hasOverlap,
                                    exclusion,
                                    ids: expected,
                                });
                            }
                        }
                    }
                }
                await expect(
                    db.ReserveDB.findTimeRanges({ times: [], hasSkip: true, hasConflict: true, hasOverlap: true }),
                ).resolves.toEqual([]);
                const disjoint = await db.ReserveDB.findTimeRanges({
                    times: [
                        { startAt: 900, endAt: 960 },
                        { startAt: 5_500, endAt: 5_600 },
                    ],
                    hasSkip: true,
                    hasConflict: true,
                    hasOverlap: true,
                });
                expect(idsOf(disjoint)).toEqual([ids.manualTime, ids.outside]);
            });
        },
        120_000,
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[PERSIST-DOUBLE-PARITY-QUERY] findRuleId and findLists apply the same flag and window conditions the find-option double records on %s',
        async dialect => {
            await withRepository(dialect, async ({ db }) => {
                const ids = await insertReserves(db);
                await expect(
                    db.ReserveDB.findRuleId({
                        ruleId: 7,
                        hasSkip: false,
                        hasConflict: false,
                        hasOverlap: false,
                        hasEventRelay: false,
                    }),
                ).resolves.toMatchObject([{ id: ids.plain }, { id: ids.contiguous }, { id: ids.outside }]);
                const inclusive = await db.ReserveDB.findRuleId({
                    ruleId: 7,
                    hasSkip: true,
                    hasConflict: true,
                    hasOverlap: true,
                    hasEventRelay: true,
                });
                expect(idsOf(inclusive)).toEqual([
                    ids.plain,
                    ids.overlap,
                    ids.conflict,
                    ids.contiguous,
                    ids.skip,
                    ids.relay,
                    ids.outside,
                ]);
                const window = await db.ReserveDB.findLists({ startAt: 2_900, endAt: 5_000 });
                expect(idsOf(window).sort((left, right) => left - right)).toEqual(
                    [ids.contiguous, ids.relay, ids.outside].sort((left, right) => left - right),
                );
                expect(await db.ReserveDB.findLists()).toHaveLength(Object.keys(ids).length);
                await expect(db.ReserveDB.getManualIds({ hasTimeReserve: false })).resolves.toEqual([ids.manual]);
                await expect(db.ReserveDB.getManualIds({ hasTimeReserve: true })).resolves.toEqual([
                    ids.manual,
                    ids.manualTime,
                ]);
                await expect(db.ReserveDB.getRuleEventRelayIds()).resolves.toEqual([ids.relay]);
            });
        },
        120_000,
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[PERSIST-DOUBLE-PARITY-QUERY] findKeyword turns the offset and limit the builder double records into the same rows on %s',
        async dialect => {
            await withRepository(dialect, async ({ db }) => {
                const ruleIds: number[] = [];
                for (const keyword of [
                    'synthetic-alpha-1',
                    'synthetic-alpha-2',
                    'synthetic-beta',
                    'synthetic-alpha-3',
                ]) {
                    ruleIds.push(
                        Number(
                            await db.RuleDB.insertOnce(
                                makeRule({ id: undefined, searchOption: { keyword, name: true } }),
                            ),
                        ),
                    );
                }
                const alpha = [ruleIds[0], ruleIds[1], ruleIds[3]];
                const keywordIds = async (option: Record<string, unknown>) =>
                    idsOf(await db.RuleDB.findKeyword(option));

                await expect(keywordIds({ keyword: 'alpha' })).resolves.toEqual(alpha);
                await expect(keywordIds({ keyword: 'alpha', offset: 1, limit: 1 })).resolves.toEqual([alpha[1]]);
                await expect(keywordIds({ keyword: 'alpha', limit: 2 })).resolves.toEqual(alpha.slice(0, 2));
                // builder の偽物は skip(n)・take(n) を呼んだことを記録するだけで、SQL にならない。本物の TypeORM は
                // take(0) を `LIMIT 0`（0 件）にするので、limit 0（件数の制限なし）は take を付けずに全件を返す。
                // limit 0 に offset が付くときは、両 DB とも offset 以降の全件を返す。
                // limit の無い skip は sqlite では `LIMIT -1 OFFSET n` にするが、
                // MySQL では OffsetWithoutLimitNotSupportedError で拒む（offset が 0 でも拒む）。
                await expect(keywordIds({ keyword: 'alpha', limit: 0 })).resolves.toEqual(alpha);
                await expect(keywordIds({ keyword: 'alpha', limit: 0, offset: 1 })).resolves.toEqual(alpha.slice(1));
                await expect(keywordIds({ keyword: 'alpha', limit: 0, offset: 0 })).resolves.toEqual(alpha);
                if (dialect === 'sqlite') {
                    await expect(keywordIds({ keyword: 'alpha', offset: 1 })).resolves.toEqual(alpha.slice(1));
                    await expect(keywordIds({ keyword: 'alpha', offset: 0 })).resolves.toEqual(alpha);
                } else {
                    await expect(keywordIds({ keyword: 'alpha', offset: 1 })).rejects.toMatchObject({
                        name: 'OffsetWithoutLimitNotSupportedError',
                    });
                    await expect(keywordIds({ keyword: 'alpha', offset: 0 })).rejects.toMatchObject({
                        name: 'OffsetWithoutLimitNotSupportedError',
                    });
                }
                await expect(keywordIds({})).resolves.toEqual(ruleIds);
                await expect(db.RuleDB.findKeyword({ keyword: 'alpha', limit: 1 })).resolves.toEqual([
                    { id: alpha[0], keyword: 'synthetic-alpha-1' },
                ]);
            });
        },
        120_000,
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[PERSIST-DOUBLE-PARITY-QUERY] removeRecording and changeProtect keep the early returns the builder double checks on %s',
        async dialect => {
            await withRepository(dialect, async ({ db }) => {
                const recordedBase = {
                    reserveId: null,
                    ruleId: null,
                    programId: null,
                    channelId: 10,
                    startAt: 1_000,
                    endAt: 2_000,
                    duration: 1_000,
                    name: 'synthetic-recorded',
                    halfWidthName: 'synthetic-recorded',
                    isProtected: false,
                    isRecording: false,
                    dropLogFileId: null,
                };
                const stoppedId = Number(await db.RecordedDB.insertOnce({ ...recordedBase }));
                const recordingId = Number(await db.RecordedDB.insertOnce({ ...recordedBase, isRecording: true }));

                await expect(db.RecordedDB.removeRecording(404_404)).rejects.toThrow('RecordedIsNull');
                await expect(db.RecordedDB.changeProtect(404_404, true)).rejects.toThrow('RecordedIsNull');
                await expect(db.RecordedDB.removeRecording(stoppedId)).resolves.toBeUndefined();
                await expect(db.RecordedDB.findId(stoppedId)).resolves.toMatchObject({ isRecording: false });
                await expect(db.RecordedDB.removeRecording(recordingId)).resolves.toBeUndefined();
                await expect(db.RecordedDB.findId(recordingId)).resolves.toMatchObject({ isRecording: false });
                await expect(db.RecordedDB.changeProtect(stoppedId, false)).resolves.toBeUndefined();
                await expect(db.RecordedDB.changeProtect(stoppedId, true)).resolves.toBeUndefined();
                await expect(db.RecordedDB.findId(stoppedId)).resolves.toMatchObject({ isProtected: true });
            });
        },
        120_000,
    );
});

describe('immediate retry double against the real PromiseRetry', () => {
    it.each(['sqlite', 'mysql'] as const)(
        '[PERSIST-DOUBLE-PARITY-RETRY] re-executes a reservation insert after a transient real driver failure and stores one row on %s',
        async dialect => {
            await withRepository(dialect, async ({ source, db, entities }) => {
                const blocker = Number(await db.ReserveDB.insertOnce(makeReserve({ id: 4_001, ruleId: 9 })));
                const operator = { getConnection: async () => source };
                const doubled = new ReserveDB(silentLoggerModel, operator, immediateRetry);
                const real = new ReserveDB(silentLoggerModel, operator, new PromiseRetry());

                // 偽物の retry は 1 回で諦め、本物の driver の一意制約 error をそのまま返す。
                const immediateFailure = await doubled
                    .insertOnce(makeReserve({ id: blocker, ruleId: 10 }))
                    .catch((error: unknown) => error);
                expect(immediateFailure).toBeInstanceOf(Error);

                // 本物の retry は 1000 ms 待って同じ query をやり直す。待つ間に衝突する行が消えれば 1 件だけ入る。
                const started = Date.now();
                const release = new Promise<void>((resolve, reject) => {
                    setTimeout(() => {
                        source
                            .getRepository(entities.Reserve)
                            .delete({ id: blocker })
                            .then(() => resolve(), reject);
                    }, 200);
                });
                const insertedId = await real.insertOnce(makeReserve({ id: blocker, ruleId: 10 }));
                await release;

                expect(Number(insertedId)).toBe(blocker);
                expect(Date.now() - started).toBeGreaterThanOrEqual(950);
                await expect(db.ReserveDB.findId(blocker)).resolves.toMatchObject({ id: blocker, ruleId: 10 });
                await expect(db.ReserveDB.findLists()).resolves.toHaveLength(1);
            });
        },
        120_000,
    );
});

describe('identity convertBoolean operator against the real DBOperator', () => {
    it('[PERSIST-DOUBLE-PARITY-OPERATOR] returns the same rows through the identity convertBoolean operator and the real sqlite DBOperator on a migrated schema', async () => {
        await withBackend('sqlite', async ({ source, operator, snapshot }) => {
            // 隔離した compiled snapshot の DBOperator が作る接続には、同じ snapshot の entity と DB model を使う。
            const SnapshotReserveDB = (
                require(join(snapshot, 'model', 'db', 'ReserveDB.js')) as { default: typeof ReserveDB }
            ).default;
            const realDb = new SnapshotReserveDB(silentLoggerModel, operator, immediateRetry);
            const identityDb = new SnapshotReserveDB(
                silentLoggerModel,
                { getConnection: async () => source, convertBoolean: (value: boolean) => value },
                immediateRetry,
            );
            for (const overrides of [
                { ruleId: 3, startAt: 30 },
                { ruleId: 3, startAt: 20, isConflict: true },
                { ruleId: 3, startAt: 10, isConflict: true, isSkip: true },
                { ruleId: 4, startAt: 40, isConflict: true },
                { ruleId: 3, startAt: 50, isSkip: true },
                { ruleId: 3, startAt: 60, isOverlap: true },
                { ruleId: 3, startAt: 70, isEventRelay: true },
                { ruleId: null, startAt: 80 },
            ]) {
                await realDb.insertOnce(makeReserve({ id: undefined, endAt: 1_000, ...overrides }));
            }
            for (const type of [undefined, 'normal', 'conflict', 'skip', 'overlap'] as const) {
                for (const ruleId of [undefined, 3]) {
                    const option = { type, ruleId, offset: 0, limit: 10 };
                    const [realRows, realTotal] = await realDb.findAll(option);
                    const [identityRows, identityTotal] = await identityDb.findAll(option);
                    expect({ option, ids: idsOf(identityRows), total: identityTotal }).toEqual({
                        option,
                        ids: idsOf(realRows),
                        total: realTotal,
                    });
                }
            }
            await expect(identityDb.getRuleEventRelayIds()).resolves.toEqual(await realDb.getRuleEventRelayIds());
            const flags = { ruleId: 3, hasSkip: false, hasConflict: false, hasOverlap: false, hasEventRelay: false };
            expect(idsOf(await identityDb.findRuleId(flags))).toEqual(idsOf(await realDb.findRuleId(flags)));
            const countRule = await realDb.countRuleIds([3, 4], 'conflict');
            await expect(identityDb.countRuleIds([3, 4], 'conflict')).resolves.toEqual(countRule);
        });
    }, 60_000);
});

describe('microtask-only DB doubles against the event loop behavior of the real drivers', () => {
    const observeIoTurn = async (query: () => Promise<unknown>): Promise<string[]> => {
        const order: string[] = [];
        setImmediate(() => order.push('event-loop-check'));
        await query();
        order.push('query-settled');
        await new Promise(resolve => setImmediate(resolve));
        return order;
    };

    it('[PERSIST-DOUBLE-PARITY-EVENT-LOOP] settles a real better-sqlite3 query without returning to the event loop, the same as the harness double', async () => {
        await withRepository('sqlite', async ({ db }) => {
            const id = Number(await db.ReserveDB.insertOnce(makeReserve({ id: undefined })));
            const stored = await db.ReserveDB.findId(id);
            const harness = makeModel();
            harness.reserveDB.findId.mockResolvedValue(makeReserve({ id }));

            await expect(observeIoTurn(() => db.ReserveDB.findId(id))).resolves.toEqual([
                'query-settled',
                'event-loop-check',
            ]);
            await expect(observeIoTurn(() => harness.reserveDB.findId(id))).resolves.toEqual([
                'query-settled',
                'event-loop-check',
            ]);
            // 更新の transaction（delete → insert → update）も event loop に戻らずに終わる。
            await expect(
                observeIoTurn(() =>
                    db.ReserveDB.updateMany({
                        insert: [makeReserve({ id: undefined, startAt: 9_000, endAt: 9_500 })],
                        update: [],
                        delete: [stored],
                        isSuppressLog: true,
                    }),
                ),
            ).resolves.toEqual(['query-settled', 'event-loop-check']);
        });
    }, 60_000);

    it('[PERSIST-DOUBLE-PARITY-EVENT-LOOP] returns to the event loop before a real MySQL query settles, unlike the harness double', async () => {
        await withRepository('mysql', async ({ db }) => {
            const id = Number(await db.ReserveDB.insertOnce(makeReserve({ id: undefined })));

            await expect(observeIoTurn(() => db.ReserveDB.findId(id))).resolves.toEqual([
                'event-loop-check',
                'query-settled',
            ]);
        });
    }, 60_000);

    it.each(['sqlite', 'mysql'] as const)(
        '[PERSIST-DOUBLE-PARITY-RESERVATION-OPERATOR] applies exact state and rule filters with matching totals through the real DBOperator and the migrated schema on %s',
        async dialect => {
            await withBackend(dialect, async ({ operator, snapshot }) => {
                const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
                const SnapshotReserveDB = load<typeof ReserveDB>('model/db/ReserveDB.js');
                const SnapshotPromiseRetry =
                    load<new () => { run<T>(job: () => Promise<T>): Promise<T> }>('model/PromiseRetry.js');
                const db = new SnapshotReserveDB(silentLoggerModel, operator, new SnapshotPromiseRetry());
                for (const row of [
                    makeReserve({ id: undefined, ruleId: 3, startAt: 30 }),
                    makeReserve({ id: undefined, ruleId: 3, startAt: 20, isConflict: true }),
                    makeReserve({ id: undefined, ruleId: 3, startAt: 10, isConflict: true, isSkip: true }),
                    makeReserve({ id: undefined, ruleId: 4, startAt: 40, isConflict: true }),
                    makeReserve({ id: undefined, ruleId: 3, startAt: 50, isSkip: true }),
                    makeReserve({ id: undefined, ruleId: 3, startAt: 60, isOverlap: true }),
                ]) {
                    await db.insertOnce(row);
                }

                const [rows, total] = await db.findAll({ type: 'conflict', ruleId: 3, offset: 0, limit: 10 });
                expect(rows.map((row: any) => row.startAt)).toEqual([20]);
                expect(total).toBe(1);
                expect(await db.countRuleIds([3, 4], 'conflict')).toEqual([
                    { ruleId: 3, ruleIdCnt: 1 },
                    { ruleId: 4, ruleIdCnt: 1 },
                ]);

                const count = async (state: 'all' | 'normal' | 'conflict' | 'skip' | 'overlap') =>
                    [...(await db.countByRuleIds([3, 99, 4], state))].sort(
                        (left: any, right: any) => left.ruleId - right.ruleId,
                    );
                await expect(db.countByRuleIds([], 'all')).resolves.toEqual([]);
                await expect(count('all')).resolves.toEqual([
                    { ruleId: 3, count: 5 },
                    { ruleId: 4, count: 1 },
                ]);
                await expect(count('normal')).resolves.toEqual([{ ruleId: 3, count: 1 }]);
                await expect(count('conflict')).resolves.toEqual([
                    { ruleId: 3, count: 1 },
                    { ruleId: 4, count: 1 },
                ]);
                await expect(count('skip')).resolves.toEqual([{ ruleId: 3, count: 1 }]);
                await expect(count('overlap')).resolves.toEqual([{ ruleId: 3, count: 1 }]);
            });
        },
        60_000,
    );
});
