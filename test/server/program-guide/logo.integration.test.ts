import 'reflect-metadata';

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadProduction, loggerModel, type DatabaseDialect } from '../fixtures/reservation-rules/runtime';
import { provisionMariaDb } from '../persistence/mysql-runtime';

const Channel = loadProduction<new () => Record<string, unknown>>('db', 'entities', 'Channel.js');
const ChannelDB = loadProduction<new (...args: any[]) => any>('model', 'db', 'ChannelDB.js');
const DBOperator = loadProduction<new (...args: any[]) => any>('model', 'db', 'DBOperator.js');
const ChannelApiModel = loadProduction<new (...args: any[]) => any>('model', 'api', 'channel', 'ChannelApiModel.js');
const require = createRequire(join(process.cwd(), 'package.json'));
const { IChannelApiModelError } = require(
    join(process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT!, 'model', 'api', 'channel', 'IChannelApiModel.js'),
) as any;

const makeChannel = (id: number, hasLogoData: boolean) => ({
    id,
    serviceId: 100 + id,
    networkId: 10,
    name: `synthetic-channel-${id}`,
    halfWidthName: `synthetic-channel-${id}`,
    remoteControlKeyId: id,
    hasLogoData,
    channelTypeId: 0,
    channelType: 'GR',
    channel: `${id}`,
    type: 1,
});

const createChannelPersistence = async (dialect: DatabaseDialect) => {
    let maria: Awaited<ReturnType<typeof provisionMariaDb>> | undefined;
    let schema: Awaited<ReturnType<Awaited<ReturnType<typeof provisionMariaDb>>['createSchema']>> | undefined;
    let source: DataSource | undefined;
    try {
        const config: Record<string, unknown> = { dbtype: dialect };
        let options: DataSourceOptions;
        if (dialect === 'sqlite') {
            options = { type: 'better-sqlite3', database: ':memory:', entities: [Channel], logging: false, synchronize: true };
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
                entities: [Channel],
                logging: false,
                synchronize: true,
            };
        }
        source = new DataSource(options);
        await source.initialize();
        const operator = new DBOperator(loggerModel, { getConfig: () => config });
        operator.connection = source;
        const retry = { run: async <T>(job: () => Promise<T>) => job() };
        const channelDB = new ChannelDB(loggerModel, { getConfig: () => config }, operator, retry);
        return {
            channelDB,
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

const snapshotChannels = async (source: DataSource) =>
    (await source.getRepository(Channel).find({ order: { id: 'ASC' } as any })).map(value => ({ ...value }));

const tryChangeCwd = (directory: string): boolean => {
    try {
        process.chdir(directory);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_WORKER_UNSUPPORTED_OPERATION') return false;
        throw error;
    }
};

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('program guide production logo boundary characterization', () => {
    // Recorded up to ~4.2-4.3s across three canonical coverage runs, so it gets an explicit larger
    // timeout budget.
    it('[PG-T2.4] uses persisted existence/logo flags and performs two uncached upstream requests without persistence', async () => {
        for (const dialect of ['sqlite', 'mysql'] as DatabaseDialect[]) {
            const fixture = await createChannelPersistence(dialect);
            let temporaryRoot: string | undefined;
            const originalWorkingDirectory = process.cwd();
            let workingDirectoryChanged = false;
            try {
                temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-program-guide-logo-'));
                await fixture.source.getRepository(Channel).insert([makeChannel(301, true), makeChannel(302, false)]);
                const first = Buffer.from('synthetic-logo-first');
                const second = Buffer.from('synthetic-logo-second');
                const getLogo = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
                const model = new ChannelApiModel(fixture.channelDB, { getLogo });

                await expect(model.getLogo(303)).rejects.toThrow(IChannelApiModelError.NOT_FOUND);
                await expect(model.getLogo(302)).rejects.toThrow(IChannelApiModelError.NOT_FOUND);
                expect(getLogo).not.toHaveBeenCalled();

                const databaseBefore = await snapshotChannels(fixture.source);
                const filesystemBefore = await readdir(temporaryRoot, { recursive: true });
                workingDirectoryChanged = tryChangeCwd(temporaryRoot);
                const firstResult = await model.getLogo(301);
                const secondResult = await model.getLogo(301);
                if (workingDirectoryChanged) {
                    process.chdir(originalWorkingDirectory);
                    workingDirectoryChanged = false;
                }

                expect.soft(firstResult).toBe(first);
                expect.soft(secondResult).toBe(second);
                expect.soft(getLogo.mock.calls).toEqual([[301], [301]]);
                expect.soft(await snapshotChannels(fixture.source)).toEqual(databaseBefore);
                expect.soft(await readdir(temporaryRoot, { recursive: true })).toEqual(filesystemBefore);
            } finally {
                vi.useRealTimers();
                if (workingDirectoryChanged) process.chdir(originalWorkingDirectory);
                try {
                    if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true });
                } finally {
                    await fixture.cleanup();
                }
            }
        }
    }, 30_000);

    it('[PG-T2.4] preserves an upstream acquisition failure instead of converting it to not-found', async () => {
        for (const dialect of ['sqlite', 'mysql'] as DatabaseDialect[]) {
            const fixture = await createChannelPersistence(dialect);
            try {
                await fixture.source.getRepository(Channel).insert(makeChannel(304, true));
                const failure = Object.assign(new Error('synthetic-logo-timeout'), { code: 'ETIMEDOUT' });
                const getLogo = vi.fn().mockRejectedValue(failure);
                const model = new ChannelApiModel(fixture.channelDB, { getLogo });

                await expect(model.getLogo(304)).rejects.toBe(failure);
                expect(getLogo).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
                await fixture.cleanup();
            }
        }
    }, 30_000);
});
