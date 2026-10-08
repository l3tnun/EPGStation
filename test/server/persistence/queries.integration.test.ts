import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { makeProgram } from '../fixtures/reservation-rules/runtime';
import { cleanupInOrder, type TestLogger } from './harness';
import {
    EXPECTED_MYSQL_MIGRATIONS,
    MYSQL_MIGRATION_CASE_TIMEOUT_MS,
    appliedMigrationNames,
    createBackendRuntime,
    type BackendDialect,
    type BackendRuntime,
} from './backend-runtime';
import { MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS, provisionMySql, type MySqlRuntime } from './mysql-runtime';

const require = createRequire(join(process.cwd(), 'package.json'));

const logger = (): TestLogger => ({ system: { error: () => undefined, info: () => undefined } });

const loadCompiledDefault = <Value>(snapshot: string, relativePath: string): Value =>
    (require(join(snapshot, relativePath)) as { default: Value }).default;

const createProgramDB = (snapshot: string, operator: object, retry: object) => {
    const ProgramDB = loadCompiledDefault<
        new (...arguments_: any[]) => Record<string, (...arguments_: any[]) => Promise<any>>
    >(snapshot, 'model/db/ProgramDB.js');
    return new ProgramDB(
        { getLogger: () => logger() },
        { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
        operator,
        retry,
    );
};

const installProgramFindIdDriverFault = (source: DataSource, programId: number, failures: number, error: Error) => {
    const originalFactory = source.createQueryRunner.bind(source);
    const runners: Array<{
        query: (...arguments_: any[]) => Promise<unknown>;
        release: (...arguments_: any[]) => Promise<void>;
    }> = [];
    const querySpies: Array<ReturnType<typeof vi.spyOn>> = [];
    const releaseSpies: Array<ReturnType<typeof vi.spyOn>> = [];
    // sqlite の QueryRunner はドライバーに 1 個だけキャッシュされ、`createQueryRunner()` を retry の
    // たびに呼んでも同じ instance が返る（`AbstractSqliteQueryRunner.release` のコメントどおり複数
    // connection/query runner を持たない仕様）。Vitest 5 の `vi.spyOn` は対象が既に mock だとその mock を
    // そのまま返すため、instance ごとに `runner.query.bind(runner)` を取り直すと 2 回目以降は「元の実装」の
    // つもりで直前の mock 自身を捕まえてしまい、`mockImplementation` の上書き後に自己再帰する。そのため
    // 真の original はこの runner について最初の 1 回だけ取得し、以降の呼び出しはその参照を使い回す。
    const releaseCallCountsByCall: number[] = [];
    let faultCalls = 0;
    let remainingFailures = failures;
    // sqlite では同じ instance が返るため runner ごとに true original を一度だけ記録し、mysql のように
    // 毎回別 instance が返るドライバーでは instance ごとに独立して instrument する。
    const trueOriginalQueryByRunner = new WeakMap<object, (...arguments_: any[]) => Promise<unknown>>();
    const trueOriginalReleaseByRunner = new WeakMap<object, (...arguments_: any[]) => Promise<void>>();
    let currentCallIndex = -1;

    const factory = vi.spyOn(source, 'createQueryRunner').mockImplementation((mode?: any) => {
        const runner = originalFactory(mode);
        runners.push(runner);
        releaseCallCountsByCall.push(0);
        currentCallIndex = releaseCallCountsByCall.length - 1;

        const isAlreadyInstrumented = trueOriginalQueryByRunner.has(runner);
        if (!isAlreadyInstrumented) {
            const trueOriginalQuery = runner.query.bind(runner);
            const trueOriginalRelease = runner.release.bind(runner);
            trueOriginalQueryByRunner.set(runner, trueOriginalQuery);
            trueOriginalReleaseByRunner.set(runner, trueOriginalRelease);

            releaseSpies.push(
                vi.spyOn(runner, 'release').mockImplementation(async (...arguments_: any[]) => {
                    releaseCallCountsByCall[currentCallIndex] += 1;
                    return trueOriginalRelease(...arguments_);
                }) as any,
            );
            querySpies.push(
                vi
                    .spyOn(runner, 'query')
                    .mockImplementation(
                        async (query: string, parameters?: unknown[], useStructuredResult?: boolean) => {
                            const matchesProgramId =
                                parameters?.some(parameter => Number(parameter) === programId) === true ||
                                new RegExp('["`]?id["`]?\\s*=\\s*' + programId + '\\b', 'iu').test(query);
                            const isTargetQuery =
                                /^\s*select\b/iu.test(query) &&
                                /\bfrom\s+["`]program["`]/iu.test(query) &&
                                matchesProgramId;
                            if (isTargetQuery) {
                                if (remainingFailures > 0) {
                                    remainingFailures -= 1;
                                    faultCalls += 1;
                                    throw error;
                                }
                            }
                            return trueOriginalQuery(query, parameters, useStructuredResult);
                        },
                    ) as any,
            );
        }
        return runner;
    });

    return {
        get faultCalls() {
            return faultCalls;
        },
        get releaseCalls() {
            return releaseCallCountsByCall.reduce((total, count) => total + count, 0);
        },
        get releaseCallCounts() {
            return releaseCallCountsByCall.slice();
        },
        get runnerCount() {
            return runners.length;
        },
        restore() {
            factory.mockRestore();
            for (const spy of [...querySpies, ...releaseSpies]) spy.mockRestore();
        },
    };
};

let mysqlRuntime: MySqlRuntime;

beforeAll(async () => {
    mysqlRuntime = await provisionMySql();
}, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

/**
 * The MySQL cases of this file use one backend: its schema is migrated through the operator once, in
 * `[PERSIST-6.1-MYSQL-QUERY-SCHEMA]` below (about 245 sequential DDL statements, around one second, which
 * that case pays under its own explicit timeout), and the query cases reuse that schema and operator
 * instead of each migrating another one. Each case starts from an empty `program` table. A case that runs
 * without the schema case before it (a filtered run) creates the backend itself, migration included.
 * SQLite cases keep a backend of their own: creating one is cheap.
 */
let sharedMysqlBackend: Promise<BackendRuntime> | undefined;

const acquireSharedMysqlBackend = (): Promise<BackendRuntime> => {
    sharedMysqlBackend ??= createBackendRuntime('mysql', mysqlRuntime, logger());
    return sharedMysqlBackend;
};

const acquireBackend = async (
    dialect: BackendDialect,
): Promise<{ readonly runtime: BackendRuntime; readonly release: () => Promise<void> }> => {
    if (dialect === 'sqlite') {
        const runtime = await createBackendRuntime('sqlite', mysqlRuntime, logger());
        return { runtime, release: () => runtime.cleanup() };
    }
    const runtime = await acquireSharedMysqlBackend();
    await runtime.source
        .createQueryBuilder()
        .delete()
        .from(loadCompiledDefault<new () => Record<string, unknown>>(runtime.snapshot, 'db/entities/Program.js'))
        .execute();
    return { runtime, release: async () => undefined };
};

const releaseSharedMysqlBackend = async (): Promise<void> => {
    const pending = sharedMysqlBackend;
    sharedMysqlBackend = undefined;
    // A backend whose creation failed has already released what it acquired.
    const runtime = await pending?.catch(() => undefined);
    await runtime?.cleanup();
};

afterAll(async () => {
    await cleanupInOrder([releaseSharedMysqlBackend, async () => mysqlRuntime.cleanup()]);
});

it(
    '[PERSIST-6.1-MYSQL-QUERY-SCHEMA] applies the operator-managed forward migrations to the schema the MySQL query cases share',
    async () => {
        const runtime = await acquireSharedMysqlBackend();
        expect(runtime.source.isInitialized).toBe(true);
        await expect(appliedMigrationNames(runtime.source)).resolves.toEqual(EXPECTED_MYSQL_MIGRATIONS);
        await expect(runtime.operator.checkConnection()).resolves.toBeUndefined();
    },
    MYSQL_MIGRATION_CASE_TIMEOUT_MS,
);

describe.each(['sqlite', 'mysql'] as const)('backend query integration through real %s', dialect => {
    it('[PERSIST-2.6-BACKEND-LIFECYCLE] applies backend-specific search capability after operator-managed migrations', async () => {
        const { runtime, release } = await acquireBackend(dialect as BackendDialect);
        try {
            const Program = loadCompiledDefault<new () => Record<string, unknown>>(
                runtime.snapshot,
                'db/entities/Program.js',
            );
            const programDB = createProgramDB(runtime.snapshot, runtime.operator, {
                run: <Value>(job: () => Promise<Value>): Promise<Value> => job(),
            });
            await runtime.source
                .getRepository(Program)
                .insert([
                    makeProgram({ id: 701, name: 'Alpha Beta', halfWidthName: 'Alpha Beta', isFree: true }),
                    makeProgram({ id: 702, name: 'alpha beta', halfWidthName: 'alpha beta', isFree: true }),
                    makeProgram({ id: 703, name: 'Alpha X Beta', halfWidthName: 'Alpha X Beta', isFree: false }),
                ]);

            const likeResult = await programDB.findRule({
                searchOption: {
                    channelIds: [101],
                    keyCS: true,
                    keyRegExp: false,
                    keyword: 'Alpha Beta',
                    name: true,
                },
            });
            expect(likeResult.map((program: { id: number }) => Number(program.id))).toEqual(
                dialect === 'mysql' ? [701, 703] : [701, 702, 703],
            );

            const regexpResult = await programDB.findRule({
                searchOption: {
                    channelIds: [101],
                    keyCS: true,
                    keyRegExp: true,
                    keyword: '^Alpha.*Beta$',
                    name: true,
                },
            });
            expect(regexpResult.map((program: { id: number }) => Number(program.id))).toEqual(
                dialect === 'mysql' ? [701, 703] : [],
            );

            const freeResult = await programDB.findRule({
                searchOption: { channelIds: [101], isFree: true },
            });
            expect(freeResult.map((program: { id: number }) => Number(program.id))).toEqual([701, 702]);
            await expect(runtime.operator.checkConnection()).resolves.toBeUndefined();
        } finally {
            await release();
        }
    });

    it('[PERSIST-7.4-REAL-DRIVER-RETRY] retries real QueryRunner faults, preserves the final error, and releases each query runner', async () => {
        const { runtime, release } = await acquireBackend(dialect as BackendDialect);
        try {
            const Program = loadCompiledDefault<new () => Record<string, unknown>>(
                runtime.snapshot,
                'db/entities/Program.js',
            );
            const PromiseRetry = loadCompiledDefault<
                new () => { run<Value>(job: () => Promise<Value>): Promise<Value> }
            >(runtime.snapshot, 'model/PromiseRetry.js');
            const repository = runtime.source.getRepository(Program);
            const programDB = createProgramDB(runtime.snapshot, runtime.operator, new PromiseRetry());
            await repository.insert(makeProgram({ id: 704, name: 'Retry program', halfWidthName: 'Retry program' }));

            const temporaryError = new Error('SYNTHETIC_DRIVER_TRANSIENT_FAILURE');
            const transientFault = installProgramFindIdDriverFault(runtime.source, 704, 1, temporaryError);

            await expect(programDB.findId(704)).resolves.toMatchObject({ id: 704 });
            expect(transientFault.faultCalls).toBe(1);
            expect(transientFault.runnerCount).toBe(2);
            expect(transientFault.releaseCalls).toBe(transientFault.runnerCount);
            expect(transientFault.releaseCallCounts).toEqual([1, 1]);
            transientFault.restore();
            expect(runtime.source.isInitialized).toBe(true);
            await expect(runtime.operator.checkConnection()).resolves.toBeUndefined();

            const finalError = new Error('SYNTHETIC_DRIVER_FINAL_FAILURE');
            const finalFault = installProgramFindIdDriverFault(runtime.source, 704, 5, finalError);

            await expect(programDB.findId(704)).rejects.toBe(finalError);
            expect(finalFault.faultCalls).toBe(5);
            expect(finalFault.runnerCount).toBe(5);
            expect(finalFault.releaseCalls).toBe(finalFault.runnerCount);
            expect(finalFault.releaseCallCounts).toEqual([1, 1, 1, 1, 1]);
            finalFault.restore();
            await expect(programDB.findId(704)).resolves.toMatchObject({ id: 704 });
            expect(runtime.source.isInitialized).toBe(true);
            await expect(runtime.operator.checkConnection()).resolves.toBeUndefined();
        } finally {
            await release();
        }
    }, 15_000);
});

// The container is removed here, in a test of its own with the budget its provisioning has, rather than in
// `afterAll`: the Docker daemon answers `docker rm --force` late while it is busy (an image export holds
// it for tens of seconds), and a hook only has Vitest's default 10 s. The `afterAll` above confirms the
// container is gone and removes it itself only when this test did not run (a filtered or aborted file).
it(
    'releases the isolated MySQL fixture container after every case of the file',
    async () => {
        await releaseSharedMysqlBackend();
        await mysqlRuntime.cleanup();
    },
    MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS,
);
