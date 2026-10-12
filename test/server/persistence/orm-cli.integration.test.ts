import { execFile } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIsolatedCompiledRuntime, type IsolatedCompiledRuntime } from './harness';
import {
    MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS,
    provisionMySql,
    type MySqlRuntime,
    type MysqlSchema,
    type SslOnlyUser,
} from './mysql-runtime';
import { listenOnUnixSocket, type UnixSocketListener } from './unix-socket-listener';

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
const listeners: UnixSocketListener[] = [];

afterAll(async () => {
    await Promise.all(runtimes.splice(0).map(runtime => runtime.cleanup()));
    await Promise.all(listeners.splice(0).map(listener => listener.close()));
});

/**
 * 実際の `package.json` の `orm-run`・`orm-gen` と同じ形で `typeorm` の CLI を動かす作業用の directory を作る。
 * `ormconfig.js` は repository のものをそのまま複写し、`dist` は compile 済みの snapshot の複製を使う。
 */
const createProject = async (
    dbtype: string,
    extraConfig = '',
): Promise<{ readonly project: string; readonly runtime: IsolatedCompiledRuntime }> => {
    const runtime = await createIsolatedCompiledRuntime();
    runtimes.push(runtime);
    const project = runtime.root;
    await mkdir(join(project, 'config'), { recursive: true });
    await mkdir(join(project, 'data'), { recursive: true });
    await writeFile(join(project, 'config', 'config.yml'), `dbtype: ${dbtype}\n${extraConfig}`);
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'orm-cli-project', type: 'module' }));
    await copyFile(join(repositoryRoot, 'ormconfig.js'), join(project, 'ormconfig.js'));
    await symlink(join(repositoryRoot, 'node_modules'), join(project, 'node_modules'), 'dir');
    return { project, runtime };
};

const typeorm = async (project: string, args: readonly string[], env: Record<string, string> = {}) => {
    try {
        const result = await run(typeormBin, [...args], {
            cwd: project,
            env: { ...process.env, NODE_OPTIONS: '', ...env },
        });
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

const recordedJournalMode = async (databasePath: string): Promise<string> => {
    const source = new DataSource({ type: 'better-sqlite3', database: databasePath });
    await source.initialize();
    try {
        const rows = (await source.query('PRAGMA journal_mode')) as Array<{ journal_mode: string }>;
        return rows[0]?.journal_mode ?? '';
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

    it('[PERSIST-6.1-ORM-CLI-ENV] expands an !env value of config.yml the same way the server does', async () => {
        const { project, runtime } = await createProject('!env EPGS_SYNTHETIC_ORM_DBTYPE');

        const result = await typeorm(project, ['migration:run', '-d', './ormconfig.js'], {
            EPGS_SYNTHETIC_ORM_DBTYPE: 'sqlite',
        });

        expect(result.code).toBe(0);
        expect(await appliedMigrations(runtime.sqliteDatabasePath)).toEqual([...expectedSQLiteMigrations]);
    });

    it('[PERSIST-6.1-ORM-CLI-MERGE-KEY] expands a merge key of config.yml the same way the server does', async () => {
        const { project, runtime } = await createProject(
            'sqlite',
            'x-base: &base\n    wal: true\nsqlite:\n    <<: *base\n',
        );

        const result = await typeorm(project, ['migration:run', '-d', './ormconfig.js']);

        expect(result.code).toBe(0);
        expect(await recordedJournalMode(runtime.sqliteDatabasePath)).toBe('wal');
    });

    it('[PERSIST-6.1-ORM-CLI-ENV-UNDEFINED] fails naming the undefined environment variable', async () => {
        const { project } = await createProject('sqlite', 'sqlite:\n    extensions: [!env EPGS_SYNTHETIC_ORM_UNDEFINED]\n');
        const result = await typeorm(project, ['migration:run', '-d', './ormconfig.js']);

        expect(result.code).not.toBe(0);
        expect(result.output).toContain('environment variable EPGS_SYNTHETIC_ORM_UNDEFINED is not defined');
    });

    it('[PERSIST-6.1-ORM-CLI-BETTER-SQLITE3] treats dbtype better-sqlite3 as sqlite', async () => {
        const { project, runtime } = await createProject('better-sqlite3');

        const result = await typeorm(project, ['migration:run', '-d', './ormconfig.js']);

        expect(result.code).toBe(0);
        expect(await appliedMigrations(runtime.sqliteDatabasePath)).toEqual([...expectedSQLiteMigrations]);
    });

    it('[PERSIST-1.12-ORM-CLI-WAL] puts the migrated SQLite file in WAL mode only when sqlite.wal is true', async () => {
        const enabled = await createProject('sqlite', 'sqlite:\n    wal: true\n');
        const disabled = await createProject('sqlite', 'sqlite:\n    wal: false\n');

        expect((await typeorm(enabled.project, ['migration:run', '-d', './ormconfig.js'])).code).toBe(0);
        expect((await typeorm(disabled.project, ['migration:run', '-d', './ormconfig.js'])).code).toBe(0);

        expect(await recordedJournalMode(enabled.runtime.sqliteDatabasePath)).toBe('wal');
        expect(await recordedJournalMode(disabled.runtime.sqliteDatabasePath)).toBe('delete');
    });

    it('[PERSIST-1.13-ORM-CLI-WAL-RETURN] returns a WAL database file to the delete journal when sqlite.wal is not true', async () => {
        const { project, runtime } = await createProject('sqlite', 'sqlite:\n    wal: true\n');
        expect((await typeorm(project, ['migration:run', '-d', './ormconfig.js'])).code).toBe(0);
        expect(await recordedJournalMode(runtime.sqliteDatabasePath)).toBe('wal');
        await writeFile(join(project, 'config', 'config.yml'), 'dbtype: sqlite\n');

        const result = await typeorm(project, ['migration:run', '-d', './ormconfig.js']);

        expect(result.code).toBe(0);
        expect(await recordedJournalMode(runtime.sqliteDatabasePath)).toBe('delete');
        expect(await appliedMigrations(runtime.sqliteDatabasePath)).toEqual([...expectedSQLiteMigrations]);
    });

    it('[PERSIST-6.1-ORM-CLI-MYSQL-SOCKET] connects through the configured MySQL UNIX socket', async () => {
        const listener = await listenOnUnixSocket();
        listeners.push(listener);
        const { project } = await createProject(
            'mysql',
            [
                'mysql:',
                '    host: synthetic-db.invalid',
                '    port: 3307',
                `    socketPath: ${listener.socketPath}`,
                '    user: synthetic_user',
                '    password: <synthetic-password>',
                '    database: synthetic_database',
                '',
            ].join('\n'),
        );

        const result = await typeorm(project, ['migration:run', '-d', './ormconfig.js']);

        expect(result.code).not.toBe(0);
        expect(listener.accepted()).toBeGreaterThanOrEqual(1);
    });
});

/** `ormconfig.js` が組み立てた DataSource の option を、CLI と同じ作業 directory で読み込んで JSON で返す。 */
const ormOptions = async (project: string): Promise<Record<string, unknown>> => {
    const result = await run(
        process.execPath,
        [
            '--input-type=module',
            '--eval',
            "const { ormConfig } = await import('./ormconfig.js'); process.stdout.write(JSON.stringify(ormConfig.options));",
        ],
        { cwd: project, env: { ...process.env, NODE_OPTIONS: '' } },
    );
    return JSON.parse(result.stdout) as Record<string, unknown>;
};

const mysqlConfigYaml = (settings: Record<string, string | number>, extra = ''): string =>
    ['mysql:', ...Object.entries(settings).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`), extra].join(
        '\n',
    );

describe('ormconfig.js MySQL ssl option', () => {
    const baseSettings = {
        host: 'synthetic-db.invalid',
        port: 3307,
        user: 'synthetic_user',
        password: '<synthetic-password>',
        database: 'synthetic_database',
    };

    it('[PERSIST-1.4-ORM-CLI-MYSQL-SSL] passes the configured ssl value unchanged as the ssl option', async () => {
        const { project } = await createProject(
            'mysql',
            mysqlConfigYaml(
                baseSettings,
                [
                    '    ssl:',
                    '        ca: |',
                    '            -----BEGIN CERTIFICATE-----',
                    '            SYNTHETIC',
                    '            -----END CERTIFICATE-----',
                    '        minVersion: TLSv1.2',
                    '        verifyIdentity: true',
                    '',
                ].join('\n'),
            ),
        );

        const options = await ormOptions(project);

        expect(options.ssl).toEqual({
            ca: '-----BEGIN CERTIFICATE-----\nSYNTHETIC\n-----END CERTIFICATE-----\n',
            minVersion: 'TLSv1.2',
            verifyIdentity: true,
        });
    });

    it('[PERSIST-1.4-ORM-CLI-MYSQL-SSL-OMITTED] leaves ssl out of the options when none is configured', async () => {
        const { project } = await createProject('mysql', mysqlConfigYaml(baseSettings, ''));

        const options = await ormOptions(project);

        expect(options.type).toBe('mysql');
        expect(Object.keys(options)).not.toContain('ssl');
    });
});

describe('typeorm migration CLI with the repository ormconfig against a REQUIRE SSL MySQL user', () => {
    let mysqlRuntime: MySqlRuntime;
    let schema: MysqlSchema;
    let sslUser: SslOnlyUser;
    let serverCa: string;

    beforeAll(async () => {
        mysqlRuntime = await provisionMySql();
        schema = await mysqlRuntime.createSchema();
        sslUser = await mysqlRuntime.createSslOnlyUser(schema.config.database);
        serverCa = await mysqlRuntime.readCaCertificate();
    }, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

    afterAll(async () => {
        await mysqlRuntime?.cleanup();
    }, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

    const settings = () => ({
        host: schema.config.host,
        port: schema.config.port,
        ...sslUser.login,
        database: schema.config.database,
    });

    it('[PERSIST-1.4-ORM-CLI-MYSQL-SSL-CONNECT] connects over TLS when ssl.ca is the server CA', async () => {
        const indentedCa = serverCa
            .split('\n')
            .filter(line => line.trim() !== '')
            .map(line => `            ${line}`)
            .join('\n');
        const { project } = await createProject(
            'mysql',
            mysqlConfigYaml(settings(), `    ssl:\n        ca: |\n${indentedCa}\n`),
        );

        const result = await typeorm(project, ['migration:show', '-d', './ormconfig.js']);

        expect(result.output).not.toContain('Access denied');
        expect(result.code).toBe(0);
    });

    it('[PERSIST-1.4-ORM-CLI-MYSQL-SSL-REQUIRED] is refused when ssl is omitted', async () => {
        const { project } = await createProject('mysql', mysqlConfigYaml(settings(), ''));

        const result = await typeorm(project, ['migration:show', '-d', './ormconfig.js']);

        expect(result.code).not.toBe(0);
        expect(result.output).toContain('Access denied');
    });

    it(
        'releases the isolated MySQL fixture container after every case of the file',
        async () => {
            await mysqlRuntime.cleanup();
        },
        MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS,
    );
});

describe('ormconfig.js SQLite busyTimeout option', () => {
    it.each([
        ['a configured value', 'sqlite:\n    busyTimeout: 200\n', 200],
        ['omitted', 'sqlite:\n    wal: false\n', 5000],
    ])('[PERSIST-1.14-ORM-CLI-BUSY-TIMEOUT] passes sqlite.busyTimeout as the timeout option (%s)', async (_scenario, yaml, expected) => {
        const { project } = await createProject('sqlite', yaml);

        const options = await ormOptions(project);

        expect(options.type).toBe('better-sqlite3');
        expect(options.timeout).toBe(expected);
    });
});
