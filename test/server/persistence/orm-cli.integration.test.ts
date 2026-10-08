import { execFile } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DataSource } from 'typeorm';
import { afterAll, describe, expect, it } from 'vitest';

import { createIsolatedCompiledRuntime, type IsolatedCompiledRuntime } from './harness';

const run = promisify(execFile);
const repositoryRoot = process.cwd();
const typeormBin = join(repositoryRoot, 'node_modules', '.bin', 'typeorm');
const expectedSQLiteMigrations = [
    'Init1601185891878',
    'AddRawExtended1624085241577',
    'AddEventRelay1716647355956',
    'AddRuleBS4K1790497623886',
] as const;

const runtimes: IsolatedCompiledRuntime[] = [];

afterAll(async () => {
    await Promise.all(runtimes.splice(0).map(runtime => runtime.cleanup()));
});

/**
 * 実際の `package.json` の `orm-run`・`orm-gen` と同じ形で `typeorm` の CLI を動かす作業用の directory を作る。
 * `ormconfig.js` は repository のものをそのまま複写し、`dist` は compile 済みの snapshot の複製を使う。
 */
const createProject = async (
    dbtype: string,
): Promise<{ readonly project: string; readonly runtime: IsolatedCompiledRuntime }> => {
    const runtime = await createIsolatedCompiledRuntime();
    runtimes.push(runtime);
    const project = runtime.root;
    await mkdir(join(project, 'config'), { recursive: true });
    await mkdir(join(project, 'data'), { recursive: true });
    await writeFile(join(project, 'config', 'config.yml'), `dbtype: ${dbtype}\n`);
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'orm-cli-project', type: 'module' }));
    await copyFile(join(repositoryRoot, 'ormconfig.js'), join(project, 'ormconfig.js'));
    await symlink(join(repositoryRoot, 'node_modules'), join(project, 'node_modules'), 'dir');
    return { project, runtime };
};

const typeorm = async (project: string, args: readonly string[]) => {
    try {
        const result = await run(typeormBin, [...args], { cwd: project, env: { ...process.env, NODE_OPTIONS: '' } });
        return { code: 0, output: `${result.stdout}${result.stderr}` };
    } catch (error) {
        const failure = error as { code?: number; stdout?: string; stderr?: string };
        return { code: failure.code ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
};

const appliedMigrations = async (databasePath: string): Promise<string[]> => {
    const source = new DataSource({ type: 'better-sqlite3', database: databasePath });
    await source.initialize();
    try {
        const rows = (await source.query('SELECT name FROM migrations ORDER BY id ASC')) as Array<{ name: string }>;
        return rows.map(row => row.name);
    } finally {
        await source.destroy();
    }
};

describe('typeorm migration CLI with the repository ormconfig (npm run orm-run / orm-gen)', () => {
    it('[PERSIST-6.1-ORM-CLI-RUN] runs the SQLite migrations against an empty database', async () => {
        const { project, runtime } = await createProject('sqlite');

        const result = await typeorm(project, ['migration:run', '-d', './ormconfig.js']);

        expect(result.output).not.toContain('Unable to open file');
        expect(result.code).toBe(0);
        expect(await appliedMigrations(runtime.sqliteDatabasePath)).toEqual([...expectedSQLiteMigrations]);
    });

    it('[PERSIST-6.1-ORM-CLI-RUN-AGAIN] has nothing left to run once the migrations are applied', async () => {
        const { project, runtime } = await createProject('sqlite');
        expect((await typeorm(project, ['migration:run', '-d', './ormconfig.js'])).code).toBe(0);

        const result = await typeorm(project, ['migration:run', '-d', './ormconfig.js']);

        expect(result.code).toBe(0);
        expect(await appliedMigrations(runtime.sqliteDatabasePath)).toEqual([...expectedSQLiteMigrations]);
    });

    it('[PERSIST-6.1-ORM-CLI-GEN] generates a migration for an empty database from the compiled entities', async () => {
        const { project } = await createProject('sqlite');

        const result = await typeorm(project, ['migration:generate', 'generated/Sample', '-d', './ormconfig.js']);

        expect(result.output).not.toContain('Unable to open file');
        expect(result.code).toBe(0);
        const generated = await readdir(join(project, 'generated'));
        expect(generated).toHaveLength(1);
        expect(generated[0]).toMatch(/Sample\.(ts|js)$/u);
        expect(await readFile(join(project, 'generated', generated[0] as string), 'utf8')).toContain('CREATE TABLE');
    });

    it('[PERSIST-6.1-ORM-CLI-GEN-NODIFF] finds no difference for a migrated database', async () => {
        const { project } = await createProject('sqlite');
        expect((await typeorm(project, ['migration:run', '-d', './ormconfig.js'])).code).toBe(0);

        const result = await typeorm(project, ['migration:generate', 'generated/Sample', '-d', './ormconfig.js']);

        expect(result.output).toContain('No changes in database schema were found');
    });

    it('[PERSIST-6.1-ORM-CLI-DBTYPE] fails with the database configuration error for an unsupported dbtype', async () => {
        const { project } = await createProject('postgres');

        const result = await typeorm(project, ['migration:run', '-d', './ormconfig.js']);

        expect(result.code).not.toBe(0);
        expect(result.output).toContain('db config error');
    });
});
