import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { vi } from 'vitest';
import { provisionMariaDb, type MariaDbRuntime, type MysqlSchema } from '../persistence/mysql-runtime';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');

export const load = <T>(...segments: string[]): T => (require(join(snapshot, ...segments)) as { default: T }).default;

export const Reserve = load<new () => Record<string, any>>('db', 'entities', 'Reserve.js');
export const ReservationManageModel = load<new (...args: any[]) => any>(
    'model',
    'operator',
    'reservation',
    'ReservationManageModel.js',
);
export const ReserveApiModel = load<new (...args: any[]) => any>('model', 'api', 'reserve', 'ReserveApiModel.js');
export const ReserveDB = load<new (...args: any[]) => any>('model', 'db', 'ReserveDB.js');
export const ReserveEvent = load<new (...args: any[]) => any>('model', 'event', 'ReserveEvent.js');
export const EventSetter = load<new (...args: any[]) => any>('model', 'event', 'EventSetter.js');

export const makeReserve = (overrides: Record<string, any> = {}) =>
    Object.assign(new Reserve(), {
        id: 1,
        updateTime: 100,
        ruleId: null,
        ruleUpdateCnt: null,
        isSkip: false,
        isConflict: false,
        allowEndLack: false,
        tags: null,
        isOverlap: false,
        isIgnoreOverlap: false,
        isTimeSpecified: false,
        isEventRelay: false,
        parentDirectoryName: null,
        directory: null,
        recordedFormat: null,
        encodeMode1: null,
        encodeParentDirectoryName1: null,
        encodeDirectory1: null,
        encodeMode2: null,
        encodeParentDirectoryName2: null,
        encodeDirectory2: null,
        encodeMode3: null,
        encodeParentDirectoryName3: null,
        encodeDirectory3: null,
        isDeleteOriginalAfterEncode: false,
        programId: 101,
        programUpdateTime: 1,
        channelId: 10,
        channel: 'synthetic-channel',
        channelType: 'GR',
        startAt: 1_000,
        endAt: 2_000,
        name: 'synthetic-name',
        halfWidthName: 'synthetic-half-name',
        shortName: null,
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
        videoStreamContent: null,
        videoComponentType: null,
        audioSamplingRate: null,
        audioComponentType: null,
        ...overrides,
    });

export const makeModel = (overrides: Record<string, any> = {}) => {
    const ledger: string[] = overrides.ledger ?? [];
    const execution = {
        getExecution: vi.fn(async () => {
            ledger.push('lock');
            return 7;
        }),
        unLockExecution: vi.fn(() => ledger.push('unlock')),
    };
    const reserveDB = {
        findAll: vi.fn(async () => [[], 0]),
        findId: vi.fn(async () => null),
        findLists: vi.fn(async () => []),
        findOldTime: vi.fn(async () => []),
        findProgramId: vi.fn(async () => []),
        findTimeSpecification: vi.fn(async () => null),
        findTimeRanges: vi.fn(async () => []),
        findRuleId: vi.fn(async () => []),
        getManualIds: vi.fn(async () => []),
        getRuleEventRelayIds: vi.fn(async () => []),
        insertOnce: vi.fn(async () => {
            ledger.push('commit');
            return 41;
        }),
        updateMany: vi.fn(async () => ledger.push('commit')),
        updateOnce: vi.fn(async () => ledger.push('commit')),
    };
    const reserveEvent = { emitUpdated: vi.fn(() => ledger.push('event')) };
    const dependencies = {
        execution,
        optionChecker: { checkEncodeOption: vi.fn(() => true) },
        reserveDB,
        reserveEvent,
        channelDB: { findId: vi.fn(async () => null) },
        programDB: { findId: vi.fn(async () => null), findRule: vi.fn(async () => []) },
        ruleDB: { findId: vi.fn(async () => null), getIds: vi.fn(async () => []) },
        ...overrides,
    };
    const log = {
        system: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
        stream: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    };
    const model = new ReservationManageModel(
        { getLogger: () => log },
        { getConfig: () => ({ isSuppressReservesUpdateAllLog: false }) },
        dependencies.execution,
        dependencies.optionChecker,
        dependencies.reserveDB,
        dependencies.channelDB,
        dependencies.programDB,
        dependencies.ruleDB,
        dependencies.reserveEvent,
    );
    return { model, ledger, log, ...dependencies };
};

interface PersistenceDependencies {
    readonly createDataSource?: (options: DataSourceOptions) => DataSource;
    readonly provisionMariaDb?: () => Promise<MariaDbRuntime>;
    readonly retry?: {
        run<T>(job: () => Promise<T>): Promise<T>;
    };
}

const cleanupPersistence = async (
    source: DataSource | undefined,
    schema: MysqlSchema | undefined,
    maria: MariaDbRuntime | undefined,
): Promise<void> => {
    let firstError: unknown;
    for (const cleanup of [
        async () => {
            if (source?.isInitialized === true) await source.destroy();
        },
        async () => schema?.cleanup(),
        async () => maria?.cleanup(),
    ]) {
        try {
            await cleanup();
        } catch (error) {
            firstError ??= error;
        }
    }
    if (firstError !== undefined) throw firstError;
};

export const createPersistence = async (dialect: 'sqlite' | 'mysql', dependencies: PersistenceDependencies = {}) => {
    const provision = dependencies.provisionMariaDb ?? provisionMariaDb;
    const makeDataSource = dependencies.createDataSource ?? (options => new DataSource(options));
    const maria = dialect === 'mysql' ? await provision() : undefined;
    let schema: MysqlSchema | undefined;
    let source: DataSource | undefined;
    try {
        schema = maria === undefined ? undefined : await maria.createSchema();
        source = makeDataSource(
            dialect === 'sqlite'
                ? {
                      type: 'better-sqlite3',
                      database: ':memory:',
                      entities: [Reserve],
                      synchronize: true,
                      logging: false,
                  }
                : {
                      type: 'mysql',
                      host: schema!.config.host as string,
                      port: schema!.config.port as number,
                      username: schema!.config.user as string,
                      password: schema!.config.password as string,
                      database: schema!.config.database as string,
                      charset: 'utf8mb4',
                      bigNumberStrings: false,
                      entities: [Reserve],
                      synchronize: true,
                      logging: false,
                  },
        );
        await source.initialize();
    } catch (error) {
        await cleanupPersistence(source, schema, maria).catch(() => undefined);
        throw error;
    }
    const operator = {
        getConnection: async () => source,
        convertBoolean: (value: boolean) => value,
    };
    const retry = dependencies.retry ?? { run: async <T>(job: () => Promise<T>) => job() };
    return {
        db: new ReserveDB(operator, retry),
        source,
        cleanup: async () => cleanupPersistence(source, schema, maria),
    };
};
