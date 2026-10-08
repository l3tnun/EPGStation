import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { vi } from 'vitest';

import { provisionMariaDb } from '../../persistence/mysql-runtime';
import { silentLoggerModel } from '../../harness/silent-logger-model';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

export const loadProduction = <T>(...segments: string[]): T =>
    (require(join(compiledSnapshot, ...segments)) as { default: T }).default;

export const logger = {
    system: {
        debug: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        info: vi.fn(),
    },
};

export const loggerModel = { getLogger: () => logger };

export type DatabaseDialect = 'sqlite' | 'mysql';

export interface DialectPersistenceOptions {
    /**
     * SQLite has no built-in REGEXP function; the server loads an extension when `sqlite.regexp` is set.
     * With this option the in-memory SQLite connection reports the capability and a JavaScript function
     * stands in for the extension (`X regexp Y` calls `regexp(Y, X)`).
     */
    readonly sqliteRegexp?: boolean;
}

export const createDialectPersistence = async (
    dialect: DatabaseDialect,
    persistenceOptions: DialectPersistenceOptions = {},
) => {
    const Rule = loadProduction<new () => Record<string, unknown>>('db', 'entities', 'Rule.js');
    const Program = loadProduction<new () => Record<string, unknown>>('db', 'entities', 'Program.js');
    const RecordedHistory = loadProduction<new () => Record<string, unknown>>('db', 'entities', 'RecordedHistory.js');
    const Reserve = loadProduction<new () => Record<string, unknown>>('db', 'entities', 'Reserve.js');
    let maria: Awaited<ReturnType<typeof provisionMariaDb>> | undefined;
    let schema: Awaited<ReturnType<Awaited<ReturnType<typeof provisionMariaDb>>['createSchema']>> | undefined;
    let source: DataSource | undefined;
    try {
        const config: Record<string, unknown> = { dbtype: dialect };
        let options: DataSourceOptions;
        if (dialect === 'sqlite') {
            options = {
                type: 'better-sqlite3',
                database: ':memory:',
                entities: [Rule, Program, RecordedHistory, Reserve],
                logging: false,
                synchronize: true,
            };
        } else {
            maria = await provisionMariaDb();
            schema = await maria.createSchema();
            config.mysql = schema.config;
            options = {
                type: 'mysql',
                host: schema.config.host as string,
                port: schema.config.port as number,
                username: schema.config.user as string,
                password: schema.config.password as string,
                database: schema.config.database as string,
                charset: 'utf8mb4',
                bigNumberStrings: false,
                entities: [Rule, Program, RecordedHistory, Reserve],
                logging: false,
                synchronize: true,
            };
        }
        source = new DataSource(options);
        await source.initialize();
        if (dialect === 'sqlite' && persistenceOptions.sqliteRegexp === true) {
            config.sqlite = { regexp: true };
            (
                source.driver as unknown as {
                    databaseConnection: {
                        function(
                            name: string,
                            options: { deterministic: boolean },
                            implementation: (pattern: string, text: string) => number,
                        ): void;
                    };
                }
            ).databaseConnection.function('regexp', { deterministic: true }, (pattern, text) =>
                new RegExp(pattern, 'u').test(text) ? 1 : 0,
            );
        }
        const DBOperator = loadProduction<new (...args: unknown[]) => Record<string, unknown>>(
            'model',
            'db',
            'DBOperator.js',
        );
        const operator = new DBOperator(loggerModel, { getConfig: () => config }) as Record<string, unknown> & {
            connection: DataSource | null;
        };
        operator.connection = source;
        const retry = { run: async <T>(job: () => Promise<T>) => job() };
        const RuleDB = loadProduction<new (...args: unknown[]) => Record<string, (...args: any[]) => Promise<any>>>(
            'model',
            'db',
            'RuleDB.js',
        );
        const ProgramDB = loadProduction<new (...args: unknown[]) => Record<string, (...args: any[]) => Promise<any>>>(
            'model',
            'db',
            'ProgramDB.js',
        );
        const RecordedHistoryDB = loadProduction<
            new (...args: unknown[]) => Record<string, (...args: any[]) => Promise<any>>
        >('model', 'db', 'RecordedHistoryDB.js');
        const ReserveDB = loadProduction<new (...args: unknown[]) => Record<string, (...args: any[]) => Promise<any>>>(
            'model',
            'db',
            'ReserveDB.js',
        );
        const ruleDB = new RuleDB(silentLoggerModel, operator, retry);
        const recordedHistoryDB = new RecordedHistoryDB(silentLoggerModel, operator, retry);
        const reserveDB = new ReserveDB(silentLoggerModel, operator, retry);
        const programDB = new ProgramDB(
            loggerModel,
            { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
            operator,
            retry,
        );
        return {
            dialect,
            Program,
            RecordedHistory,
            Reserve,
            Rule,
            programDB,
            recordedHistoryDB,
            reserveDB,
            ruleDB,
            source,
            cleanup: async () => {
                if (source?.isInitialized === true) await source.destroy();
                await schema?.cleanup();
                await maria?.cleanup();
            },
        };
    } catch (error) {
        if (source?.isInitialized === true) await source.destroy();
        await schema?.cleanup();
        await maria?.cleanup();
        throw error;
    }
};

export const makeRule = (overrides: Record<string, unknown> = {}) => ({
    id: 17,
    updateCnt: 2,
    isTimeSpecification: false,
    searchOption: { keyword: 'synthetic candidate', name: true, GR: true },
    reserveOption: { enable: true, allowEndLack: false, avoidDuplicate: false },
    ...overrides,
});

export const makeProgram = (overrides: Record<string, unknown> = {}) => ({
    id: 701,
    updateTime: 11,
    channelId: 101,
    eventId: 701,
    serviceId: 101,
    networkId: 1,
    channel: 'synthetic-channel',
    channelType: 'GR',
    startAt: 1_900_000_000_000,
    endAt: 1_900_000_060_000,
    duration: 60_000,
    startHour: 0,
    week: 1,
    isFree: true,
    name: 'synthetic program',
    shortName: 'synthetic program',
    halfWidthName: 'synthetic program',
    description: null,
    halfWidthDescription: null,
    extended: null,
    halfWidthExtended: null,
    rawExtended: null,
    rawHalfWidthExtended: null,
    genre1: null,
    subGenre1: null,
    genre2: null,
    subGenre2: null,
    genre3: null,
    subGenre3: null,
    videoType: null,
    videoResolution: null,
    videoComponentType: null,
    videoStreamContent: null,
    audioSamplingRate: null,
    audioComponentType: null,
    overlap: false,
    ...overrides,
});

export const makeReservationHarness = (overrides: Record<string, unknown> = {}) => {
    const ReservationManageModel = loadProduction<
        new (...args: unknown[]) => {
            updateAll(first?: boolean): Promise<void>;
            updateRule(id: number, suppress?: boolean, first?: boolean): Promise<void>;
        }
    >('model', 'operator', 'reservation', 'ReservationManageModel.js');
    const execution = {
        getExecution: vi.fn(async () => 'synthetic-execution'),
        unLockExecution: vi.fn(),
    };
    const reserveDB = {
        findLists: vi.fn(async () => []),
        findRuleId: vi.fn(async () => []),
        findTimeRanges: vi.fn(async () => []),
        getManualIds: vi.fn(async () => []),
        getRuleEventRelayIds: vi.fn(async () => []),
        updateMany: vi.fn(async () => undefined),
    };
    const channelDB = { findId: vi.fn(async () => null) };
    const programDB = { findRule: vi.fn(async () => []) };
    const ruleDB = { findId: vi.fn(async () => makeRule()), getIds: vi.fn(async () => []) };
    const reserveEvent = { emitUpdated: vi.fn() };
    const dependencies = {
        execution,
        reserveDB,
        channelDB,
        programDB,
        ruleDB,
        reserveEvent,
        ...overrides,
    } as typeof overrides & {
        execution: typeof execution;
        reserveDB: typeof reserveDB;
        channelDB: typeof channelDB;
        programDB: typeof programDB;
        ruleDB: typeof ruleDB;
        reserveEvent: typeof reserveEvent;
    };
    const model = new ReservationManageModel(
        loggerModel,
        { getConfig: () => ({ isSuppressReservesUpdateAllLog: false }) },
        dependencies.execution,
        { checkEncodeOption: () => true },
        dependencies.reserveDB,
        dependencies.channelDB,
        dependencies.programDB,
        dependencies.ruleDB,
        dependencies.reserveEvent,
    );
    return { model, ...dependencies };
};
