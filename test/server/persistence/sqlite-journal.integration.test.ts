import { access, copyFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DataSource } from 'typeorm';
import { DataSource as RealDataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIsolatedCompiledRuntime, type IsolatedCompiledRuntime, type TestLogger } from './harness';

const logger = (): TestLogger => ({ system: { error: vi.fn(), info: vi.fn() } });

const runtimes: IsolatedCompiledRuntime[] = [];

afterEach(async () => {
    await Promise.all(runtimes.splice(0).map(runtime => runtime.cleanup()));
});

const createRuntime = async (): Promise<IsolatedCompiledRuntime> => {
    const runtime = await createIsolatedCompiledRuntime();
    runtimes.push(runtime);
    await mkdir(dirname(runtime.sqliteDatabasePath), { recursive: true });
    return runtime;
};

const journalMode = async (source: DataSource): Promise<string> => {
    const rows = (await source.query('PRAGMA journal_mode')) as Array<{ journal_mode: string }>;
    return rows[0]?.journal_mode ?? '';
};

const exists = async (path: string): Promise<boolean> =>
    access(path).then(
        () => true,
        () => false,
    );

/** 設定どおりに operator を開き、1 件書き込み、journal_mode と副ファイルの有無を調べて閉じる。 */
const openAndInspect = async (runtime: IsolatedCompiledRuntime, sqlite: Record<string, unknown> | undefined) => {
    const operator = runtime.createOperator(
        sqlite === undefined ? { dbtype: 'sqlite' } : { dbtype: 'sqlite', sqlite },
        logger(),
    );
    const source = await operator.getConnection();
    await source.query('CREATE TABLE IF NOT EXISTS journal_probe (id INTEGER PRIMARY KEY)');
    await source.query('INSERT INTO journal_probe DEFAULT VALUES');
    const observed = {
        mode: await journalMode(source),
        wal: await exists(`${runtime.sqliteDatabasePath}-wal`),
        shm: await exists(`${runtime.sqliteDatabasePath}-shm`),
    };
    await operator.closeConnection();
    return observed;
};

/** 接続を閉じた後の file に記録されている journal_mode を、別の接続で読む。 */
const recordedJournalMode = async (path: string): Promise<string> => {
    const source = new RealDataSource({ type: 'better-sqlite3', database: path });
    await source.initialize();
    try {
        return await journalMode(source);
    } finally {
        await source.destroy();
    }
};

describe('SQLite journal mode with a real better-sqlite3 database file', () => {
    it('[PERSIST-1.13-JOURNAL-DEFAULT] keeps the delete journal and creates no WAL side files when sqlite.wal is omitted', async () => {
        const runtime = await createRuntime();

        const observed = await openAndInspect(runtime, undefined);

        expect(observed).toEqual({ mode: 'delete', wal: false, shm: false });
        expect(await recordedJournalMode(runtime.sqliteDatabasePath)).toBe('delete');
    });

    it('[PERSIST-1.13-JOURNAL-DEFAULT-DATA] opens an existing delete-journal database without changing its rows or journal mode', async () => {
        const runtime = await createRuntime();
        await openAndInspect(runtime, undefined);

        const observed = await openAndInspect(runtime, { wal: false });

        expect(observed).toEqual({ mode: 'delete', wal: false, shm: false });
        const source = new RealDataSource({ type: 'better-sqlite3', database: runtime.sqliteDatabasePath });
        await source.initialize();
        try {
            const rows = (await source.query('SELECT COUNT(*) AS count FROM journal_probe')) as Array<{
                count: number;
            }>;
            expect(rows[0]?.count).toBe(2);
        } finally {
            await source.destroy();
        }
    });

    it('[PERSIST-1.12-JOURNAL-WAL] uses the WAL journal and creates the -wal and -shm files when sqlite.wal is true', async () => {
        const runtime = await createRuntime();
        const operator = runtime.createOperator({ dbtype: 'sqlite', sqlite: { wal: true } }, logger());
        const source = await operator.getConnection();
        try {
            await source.query('CREATE TABLE journal_probe (id INTEGER PRIMARY KEY)');
            await source.query('INSERT INTO journal_probe DEFAULT VALUES');

            expect(await journalMode(source)).toBe('wal');
            expect(await exists(`${runtime.sqliteDatabasePath}-wal`)).toBe(true);
            expect(await exists(`${runtime.sqliteDatabasePath}-shm`)).toBe(true);
        } finally {
            await operator.closeConnection();
        }
        expect(await recordedJournalMode(runtime.sqliteDatabasePath)).toBe('wal');
    });

    it('[PERSIST-1.13-JOURNAL-RETURN] returns a database file that was left in WAL mode to the delete journal when sqlite.wal is no longer true', async () => {
        const runtime = await createRuntime();
        const first = await openAndInspect(runtime, { wal: true });
        expect(first.mode).toBe('wal');
        expect(await recordedJournalMode(runtime.sqliteDatabasePath)).toBe('wal');

        const second = await openAndInspect(runtime, {});

        expect(second).toEqual({ mode: 'delete', wal: false, shm: false });
        expect(await recordedJournalMode(runtime.sqliteDatabasePath)).toBe('delete');
    });

    it('[PERSIST-1.13-JOURNAL-RETURN-WAL-CONTENT] keeps rows that exist only in the -wal file when a WAL database is opened with sqlite.wal disabled', async () => {
        const origin = await createRuntime();
        const operator = origin.createOperator({ dbtype: 'sqlite', sqlite: { wal: true } }, logger());
        const source = await operator.getConnection();
        const restored = await createRuntime();
        try {
            await source.query('PRAGMA wal_autocheckpoint = 0');
            await source.query('CREATE TABLE journal_probe (id INTEGER PRIMARY KEY)');
            await source.query('INSERT INTO journal_probe DEFAULT VALUES');
            await source.query('INSERT INTO journal_probe DEFAULT VALUES');
            // 接続が開いたまま（checkpoint 前）の file を写し、-wal にだけ在る行を持つ状態を作る。
            await copyFile(origin.sqliteDatabasePath, restored.sqliteDatabasePath);
            await copyFile(`${origin.sqliteDatabasePath}-wal`, `${restored.sqliteDatabasePath}-wal`);
        } finally {
            await operator.closeConnection();
        }

        const reopened = restored.createOperator({ dbtype: 'sqlite' }, logger());
        const connection = await reopened.getConnection();
        try {
            expect(await journalMode(connection)).toBe('delete');
            const rows = (await connection.query('SELECT COUNT(*) AS count FROM journal_probe')) as Array<{
                count: number;
            }>;
            expect(rows[0]?.count).toBe(2);
        } finally {
            await reopened.closeConnection();
        }
        expect(await exists(`${restored.sqliteDatabasePath}-wal`)).toBe(false);
    });

    it('[PERSIST-1.12-JOURNAL-REENABLE] uses WAL again when sqlite.wal is switched back on', async () => {
        const runtime = await createRuntime();
        await openAndInspect(runtime, {});

        const observed = await openAndInspect(runtime, { wal: true });

        expect(observed.mode).toBe('wal');
        expect(await recordedJournalMode(runtime.sqliteDatabasePath)).toBe('wal');
    });

    it('[PERSIST-1.13-JOURNAL-RETURN-BLOCKED] fails the initialization without publishing a connection while another connection keeps the WAL journal in use', async () => {
        const runtime = await createRuntime();
        await openAndInspect(runtime, { wal: true });
        const other = new RealDataSource({ type: 'better-sqlite3', database: runtime.sqliteDatabasePath });
        await other.initialize();
        // 読み取りの transaction を開いたままにして、別の接続が file を使っている状態にする。
        const reader = other.createQueryRunner();
        await reader.startTransaction();
        await reader.query('SELECT COUNT(*) FROM journal_probe');
        try {
            const operator = runtime.createOperator({ dbtype: 'sqlite' }, logger());

            await expect(operator.getConnection()).rejects.toThrow('database is locked');
        } finally {
            await reader.rollbackTransaction();
            await reader.release();
            await other.destroy();
        }
        expect(await recordedJournalMode(runtime.sqliteDatabasePath)).toBe('wal');
    });
});
