import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DataSource as RealDataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIsolatedCompiledRuntime, type IsolatedCompiledRuntime, type TestLogger } from './harness';

const logger = (): TestLogger => ({ system: { error: vi.fn(), info: vi.fn() } });

const runtimes: IsolatedCompiledRuntime[] = [];
const holders: RealDataSource[] = [];

afterEach(async () => {
    await Promise.all(holders.splice(0).map(holder => holder.destroy()));
    await Promise.all(runtimes.splice(0).map(runtime => runtime.cleanup()));
});

const createRuntime = async (): Promise<IsolatedCompiledRuntime> => {
    const runtime = await createIsolatedCompiledRuntime();
    runtimes.push(runtime);
    await mkdir(dirname(runtime.sqliteDatabasePath), { recursive: true });
    return runtime;
};

/** 別の接続で同じ file の書き込みロックを取って持ち続ける（接続を閉じるまで解放しない）。 */
const holdWriteLock = async (path: string): Promise<void> => {
    const holder = new RealDataSource({ type: 'better-sqlite3', database: path });
    await holder.initialize();
    holders.push(holder);
    await holder.query('BEGIN IMMEDIATE');
};

const errorCode = (error: unknown): string | undefined => {
    const failure = error as { code?: string; driverError?: { code?: string } };
    return failure.code ?? failure.driverError?.code;
};

describe('DBOperator SQLite busyTimeout integration (two connections on one database file)', () => {
    it('[PERSIST-1.14-BUSY-TIMEOUT-WAITS] waits for the configured time for another connection’s lock, then fails with SQLITE_BUSY', async () => {
        const runtime = await createRuntime();
        const operator = runtime.createOperator({ dbtype: 'sqlite', sqlite: { busyTimeout: 200 } }, logger());
        const source = await operator.getConnection();
        await holdWriteLock(runtime.sqliteDatabasePath);

        const started = performance.now();
        const failure = await source.query('CREATE TABLE busy_probe (id INTEGER PRIMARY KEY)').then(
            () => undefined,
            (error: unknown) => error,
        );
        const waited = performance.now() - started;

        expect(failure).toBeInstanceOf(Error);
        expect(errorCode(failure)).toBe('SQLITE_BUSY');
        expect((failure as Error).message).toMatch(/database is locked/u);
        // 設定した 200 ms は待つ（下限は余裕を見る）。既定の 5000 ms までは待たない。
        expect(waited).toBeGreaterThanOrEqual(150);
        expect(waited).toBeLessThan(3000);
        await operator.closeConnection();
    });

    it('[PERSIST-1.14-BUSY-TIMEOUT-ZERO] does not wait at all when sqlite.busyTimeout is 0', async () => {
        const runtime = await createRuntime();
        const operator = runtime.createOperator({ dbtype: 'sqlite', sqlite: { busyTimeout: 0 } }, logger());
        const source = await operator.getConnection();
        await holdWriteLock(runtime.sqliteDatabasePath);

        const started = performance.now();
        const failure = await source.query('CREATE TABLE busy_probe (id INTEGER PRIMARY KEY)').then(
            () => undefined,
            (error: unknown) => error,
        );
        const waited = performance.now() - started;

        expect(errorCode(failure)).toBe('SQLITE_BUSY');
        expect(waited).toBeLessThan(1000);
        await operator.closeConnection();
    });

    it.each([
        ['negative', -1],
        ['not an integer', 1.5],
        ['a string', '200'],
        ['above the SQLite limit', 2_147_483_648],
    ])('[PERSIST-1.14-BUSY-TIMEOUT-INVALID] the driver rejects the connection when sqlite.busyTimeout is %s', async (_scenario, busyTimeout) => {
        const runtime = await createRuntime();
        const operator = runtime.createOperator({ dbtype: 'sqlite', sqlite: { busyTimeout } }, logger());

        await expect(operator.getConnection()).rejects.toThrow(/timeout/u);
    });
});
