import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';

import { cleanupInOrder, compiledSnapshot, type DBOperatorRuntime, type TestLogger } from './harness';
import { provisionMySql, type MySqlRuntime } from './mysql-runtime';

const require = createRequire(join(process.cwd(), 'package.json'));

type Constructor<T = object> = new (...arguments_: never[]) => T;

export const loadCompiledDefault = <T>(relativePath: string): Constructor<T> =>
    (require(join(compiledSnapshot, relativePath)) as { default: Constructor<T> }).default;

export const loadCompiled = <T>(relativePath: string): T =>
    (require(join(compiledSnapshot, relativePath)) as { default: T }).default;

export const immediateRetry = {
    run: <T>(job: () => Promise<T>): Promise<T> => job(),
};

export const silentLogger = (): TestLogger => ({
    system: { error: () => undefined, info: () => undefined },
});

export const repositoryOperator = (connection: object, dialect: 'mysql' | 'sqlite' = 'sqlite') =>
    ({
        checkConnection: async () => undefined,
        closeConnection: async () => undefined,
        convertBoolean: (value: boolean) => (dialect === 'sqlite' ? (value ? 1 : 0) : value),
        getConnection: async () => connection,
        getLikeStr: (cs: boolean) => (dialect === 'mysql' && cs ? 'like binary' : 'like'),
        getRegexpStr: (cs: boolean) => (dialect === 'mysql' && cs ? 'regexp binary' : 'regexp'),
        isEnableCS: () => dialect === 'mysql',
        isEnabledRegexp: () => dialect === 'mysql',
    }) as unknown as DBOperatorRuntime;

export type RepositoryDialect = 'mysql' | 'sqlite';

const entityNames = [
    'Channel',
    'Program',
    'Reserve',
    'Rule',
    'Recorded',
    'RecordedHistory',
    'VideoFile',
    'DropLogFile',
    'Thumbnail',
    'RecordedTag',
] as const;

const repositoryNames = [
    'ChannelDB',
    'ProgramDB',
    'ReserveDB',
    'RuleDB',
    'RecordedDB',
    'RecordedHistoryDB',
    'VideoFileDB',
    'DropLogFileDB',
    'ThumbnailDB',
    'RecordedTagDB',
] as const;

export interface RepositoryPersistence {
    readonly dialect: RepositoryDialect;
    readonly source: DataSource;
    readonly entities: Record<(typeof entityNames)[number], Constructor<Record<string, unknown>>>;
    readonly db: Record<(typeof repositoryNames)[number], Record<string, (...arguments_: any[]) => Promise<any>>>;
    readonly logMessages: unknown[];
    readonly retry: { readonly calls: number; run<T>(job: () => Promise<T>): Promise<T> };
    cleanup(): Promise<void>;
}

export interface RepositoryPersistenceDependencies {
    readonly createDataSource?: (options: DataSourceOptions) => DataSource;
    readonly provisionMySql?: () => Promise<MySqlRuntime>;
    readonly sqliteRegexpExtension?: string;
}

export async function createRepositoryPersistence(
    dialect: RepositoryDialect,
    sharedMySql?: MySqlRuntime,
    dependencies: RepositoryPersistenceDependencies = {},
): Promise<RepositoryPersistence> {
    const entities = Object.fromEntries(
        entityNames.map(name => [name, loadCompiled<Constructor<Record<string, unknown>>>(`db/entities/${name}.js`)]),
    ) as RepositoryPersistence['entities'];
    let ownedMySql: MySqlRuntime | undefined;
    let schema: Awaited<ReturnType<MySqlRuntime['createSchema']>> | undefined;
    let sqliteRoot: string | undefined;
    let source: DataSource | undefined;
    const cleanup = () =>
        cleanupInOrder([
            async () => {
                if (source?.isInitialized === true) await source.destroy();
            },
            async () => schema?.cleanup(),
            async () => ownedMySql?.cleanup(),
            async () => {
                if (sqliteRoot !== undefined) await rm(sqliteRoot, { force: true, recursive: true });
            },
        ]);
    try {
        if (dialect === 'mysql' && sharedMySql === undefined) {
            ownedMySql = await (dependencies.provisionMySql ?? provisionMySql)();
        }
        const mysqlRuntime = sharedMySql ?? ownedMySql;
        schema = dialect === 'mysql' ? await mysqlRuntime!.createSchema() : undefined;
        if (dialect === 'sqlite') {
            const sqliteArtifactRoot = join(process.cwd(), 'test', 'server', '.artifacts', 'persistence');
            await mkdir(sqliteArtifactRoot, { recursive: true });
            sqliteRoot = await mkdtemp(join(sqliteArtifactRoot, 'repository-'));
        }
        const options: DataSourceOptions =
            dialect === 'sqlite'
                ? {
                      type: 'better-sqlite3',
                      database: join(sqliteRoot!, 'database.db'),
                      entities: Object.values(entities),
                      logging: false,
                      synchronize: true,
                  }
                : {
                      type: 'mysql',
                      host: schema!.config.host,
                      port: schema!.config.port,
                      username: schema!.config.user,
                      password: schema!.config.password,
                      database: schema!.config.database,
                      charset: 'utf8mb4',
                      bigNumberStrings: false,
                      entities: Object.values(entities),
                      logging: false,
                      synchronize: true,
                  };
        source = (dependencies.createDataSource ?? (dataSourceOptions => new DataSource(dataSourceOptions)))(options);
        await source.initialize();
        if (dialect === 'sqlite' && dependencies.sqliteRegexpExtension !== undefined) {
            // better-sqlite3 の loadExtension は同期で、失敗は例外で返る（node-sqlite3 の callback 形式とは異なる）。
            (source as any).driver.databaseConnection.loadExtension(dependencies.sqliteRegexpExtension);
        }
        const logMessages: unknown[] = [];
        const loggerModel = {
            getLogger: () => ({
                system: {
                    error: (message: unknown) => logMessages.push(message),
                    info: () => undefined,
                },
            }),
        };
        const DBOperator = loadCompiled<new (...arguments_: any[]) => any>('model/db/DBOperator.js');
        const operator = new DBOperator(loggerModel, {
            getConfig: () => ({
                dbtype: dialect,
                ...(dialect === 'sqlite'
                    ? { sqlite: { regexp: dependencies.sqliteRegexpExtension !== undefined } }
                    : {}),
            }),
        });
        Object.assign(operator, { connection: source });
        const retry = {
            calls: 0,
            run<T>(job: () => Promise<T>): Promise<T> {
                this.calls += 1;
                return job();
            },
        };
        const configuration = { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) };
        const constructors = Object.fromEntries(
            repositoryNames.map(name => [name, loadCompiled<new (...arguments_: any[]) => any>(`model/db/${name}.js`)]),
        ) as Record<(typeof repositoryNames)[number], new (...arguments_: any[]) => any>;
        const db = {
            ChannelDB: new constructors.ChannelDB(loggerModel, configuration, operator, retry),
            ProgramDB: new constructors.ProgramDB(loggerModel, configuration, operator, retry),
            ReserveDB: new constructors.ReserveDB(operator, retry),
            RuleDB: new constructors.RuleDB(operator, retry),
            RecordedDB: new constructors.RecordedDB(operator, retry),
            RecordedHistoryDB: new constructors.RecordedHistoryDB(operator, retry),
            VideoFileDB: new constructors.VideoFileDB(operator, retry),
            DropLogFileDB: new constructors.DropLogFileDB(operator, retry),
            ThumbnailDB: new constructors.ThumbnailDB(operator, retry),
            RecordedTagDB: new constructors.RecordedTagDB(operator, retry),
        };
        return {
            dialect,
            source,
            entities,
            db,
            logMessages,
            retry,
            cleanup,
        };
    } catch (error) {
        try {
            await cleanup();
        } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Repository fixture setup and cleanup failed');
        }
        throw error;
    }
}
