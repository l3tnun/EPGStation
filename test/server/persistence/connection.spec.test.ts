import { join } from 'node:path';
import { DataSource as RealDataSource } from 'typeorm';
import type { DataSource, DataSourceOptions } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, useFakeClock } from '../harness/async';
import { compiledRoot, createOperator, installDataSourceFactory, type TestLogger } from './harness';

const restores: Array<() => void> = [];

afterEach(() => {
    while (restores.length > 0) {
        restores.pop()?.();
    }
    vi.restoreAllMocks();
});

const createLogger = (): TestLogger => ({
    system: { error: vi.fn(), info: vi.fn() },
});

const createDataSourceDouble = (overrides: Partial<DataSource> = {}): DataSource =>
    ({
        destroy: vi.fn(async () => undefined),
        driver: { databaseConnection: { loadExtension: vi.fn() } },
        initialize: vi.fn(async function (this: DataSource) {
            return this;
        }),
        manager: { query: vi.fn(async () => [1]) },
        ...overrides,
    }) as unknown as DataSource;

const createTypeOrmSelfCleaningDataSource = (overrides: Partial<DataSource> = {}) => {
    let candidate!: DataSource;
    const destroy = vi.fn(async () => {
        if (!candidate.isInitialized) {
            throw new Error('CannotExecuteNotConnectedError');
        }
        await candidate.driver.disconnect();
        candidate.isInitialized = false;
    });
    candidate = createDataSourceDouble({
        destroy,
        driver: {
            connect: vi.fn(async () => undefined),
            databaseConnection: { loadExtension: vi.fn() },
            disconnect: vi.fn(async () => undefined),
        } as DataSource['driver'],
        isInitialized: false,
        ...overrides,
    });
    return { candidate, destroy };
};

const captureCandidate = async (candidate: DataSource) => {
    const options: DataSourceOptions[] = [];
    restores.push(
        await installDataSourceFactory(option => {
            options.push(option);
            return candidate;
        }),
    );
    return options;
};

describe('DBOperator connection contract characterization', () => {
    it('[PERSIST-1.1-SQLITE-OPTIONS] selects the managed SQLite file and forward-only migration options', async () => {
        const candidate = createDataSourceDouble();
        const options = await captureCandidate(candidate);

        await createOperator({ dbtype: 'sqlite' }, createLogger()).getConnection();

        expect(options).toStrictEqual([
            {
                database: join(compiledRoot, 'data', 'database.db'),
                entities: [join(compiledRoot, 'dist', 'db', 'entities', '**', '*.js')],
                logging: false,
                migrations: [join(compiledRoot, 'dist', 'db', 'migrations', 'sqlite', '**', '*.js')],
                migrationsRun: true,
                subscribers: [join(compiledRoot, 'dist', 'db', 'subscribers', '**', '*.js')],
                synchronize: false,
                type: 'better-sqlite3',
            },
        ]);
        expect(candidate.initialize).toHaveBeenCalledTimes(1);
    });

    it('[PERSIST-1.1-MYSQL-OPTIONS] forwards required MySQL values and defaults charset to utf8mb4', async () => {
        const candidate = createDataSourceDouble();
        const options = await captureCandidate(candidate);
        const mysql = {
            database: 'synthetic_database',
            host: 'synthetic-db.invalid',
            password: 'synthetic-password-value',
            port: 3307,
            user: 'synthetic_user',
        };

        await createOperator({ dbtype: 'mysql', mysql }, createLogger()).getConnection();

        expect(options).toStrictEqual([
            {
                bigNumberStrings: false,
                charset: 'utf8mb4',
                database: mysql.database,
                entities: [join(compiledRoot, 'dist', 'db', 'entities', '**', '*.js')],
                host: mysql.host,
                logging: false,
                migrations: [join(compiledRoot, 'dist', 'db', 'migrations', 'mysql', '**', '*.js')],
                migrationsRun: true,
                password: mysql.password,
                port: mysql.port,
                subscribers: [join(compiledRoot, 'dist', 'db', 'subscribers', '**', '*.js')],
                synchronize: false,
                type: 'mysql',
                username: mysql.user,
            },
        ]);
    });

    it('[PERSIST-7.1-R6.1-SQLITE-MYSQL-MIGRATIONS] selects the backend-specific forward migration sets through public connections', async () => {
        const sqlite = createDataSourceDouble();
        const mysql = createDataSourceDouble();
        const options: DataSourceOptions[] = [];
        restores.push(
            await installDataSourceFactory(option => {
                options.push(option);
                return options.length === 1 ? sqlite : mysql;
            }),
        );
        const mysqlConfig = {
            database: 'synthetic_database',
            host: 'synthetic-db.invalid',
            password: 'synthetic-password-value',
            port: 3307,
            user: 'synthetic_user',
        };

        await expect(createOperator({ dbtype: 'sqlite' }, createLogger()).getConnection()).resolves.toBe(sqlite);
        await expect(
            createOperator({ dbtype: 'mysql', mysql: mysqlConfig }, createLogger()).getConnection(),
        ).resolves.toBe(mysql);

        expect(options).toEqual([
            expect.objectContaining({
                migrations: [join(compiledRoot, 'dist', 'db', 'migrations', 'sqlite', '**', '*.js')],
                migrationsRun: true,
                type: 'better-sqlite3',
            }),
            expect.objectContaining({
                migrations: [join(compiledRoot, 'dist', 'db', 'migrations', 'mysql', '**', '*.js')],
                migrationsRun: true,
                type: 'mysql',
            }),
        ]);
        expect(sqlite.initialize).toHaveBeenCalledOnce();
        expect(mysql.initialize).toHaveBeenCalledOnce();
    });

    it('[PERSIST-7.1-R6.4-NO-DOWNGRADE] initializes forward migrations without invoking a public downgrade operation', async () => {
        const undoLastMigration = vi.fn(async () => undefined);
        const candidate = createDataSourceDouble({ undoLastMigration } as Partial<DataSource>);
        const options = await captureCandidate(candidate);

        await expect(createOperator({ dbtype: 'sqlite' }, createLogger()).getConnection()).resolves.toBe(candidate);

        expect(candidate.initialize).toHaveBeenCalledOnce();
        expect(undoLastMigration).not.toHaveBeenCalled();
        expect(options).toEqual([
            expect.objectContaining({
                migrationsRun: true,
                synchronize: false,
                type: 'better-sqlite3',
            }),
        ]);
    });

    it('[PERSIST-1.1-MYSQL-SOCKET-PATH] forwards a configured UNIX socket path next to the host and port values', async () => {
        const candidate = createDataSourceDouble();
        const options = await captureCandidate(candidate);
        const mysql = {
            database: 'synthetic_database',
            host: 'synthetic-db.invalid',
            password: '<synthetic-password>',
            port: 3307,
            socketPath: '/synthetic/run/mysqld.sock',
            user: 'synthetic_user',
        };

        await createOperator({ dbtype: 'mysql', mysql }, createLogger()).getConnection();

        expect(options).toHaveLength(1);
        expect(options[0]).toMatchObject({
            host: mysql.host,
            port: mysql.port,
            socketPath: mysql.socketPath,
            type: 'mysql',
        });
    });

    it('[PERSIST-1.1-MYSQL-SOCKET-PATH-OMITTED] leaves socketPath out of the options when none is configured', async () => {
        const candidate = createDataSourceDouble();
        const options = await captureCandidate(candidate);

        await createOperator(
            {
                dbtype: 'mysql',
                mysql: {
                    database: 'synthetic_database',
                    host: 'synthetic-db.invalid',
                    password: '<synthetic-password>',
                    port: 3307,
                    user: 'synthetic_user',
                },
            },
            createLogger(),
        ).getConnection();

        expect(options).toHaveLength(1);
        expect(Object.keys(options[0])).not.toContain('socketPath');
    });

    it('[PERSIST-1.1-MYSQL-CHARSET] preserves an explicitly configured MySQL charset', async () => {
        const candidate = createDataSourceDouble();
        const options = await captureCandidate(candidate);

        await createOperator(
            {
                dbtype: 'mysql',
                mysql: {
                    charset: 'utf8mb4_bin',
                    database: 'synthetic_database',
                    host: 'synthetic-db.invalid',
                    password: 'synthetic-password-value',
                    port: 3307,
                    user: 'synthetic_user',
                },
            },
            createLogger(),
        ).getConnection();

        expect(options[0]).toMatchObject({ charset: 'utf8mb4_bin' });
    });

    it.each([{ dbtype: 'postgres' }, { dbtype: 'mysql' }])(
        '[PERSIST-1.1-INVALID-BACKEND] rejects unsupported or incompletely configured backend before driver initialization',
        async config => {
            const factory = vi.fn(() => createDataSourceDouble());
            const logger = createLogger();
            restores.push(await installDataSourceFactory(factory));

            await expect(createOperator(config, logger).getConnection()).rejects.toThrow('DBTypeError');
            expect(factory).not.toHaveBeenCalled();
            expect(logger.system.error).toHaveBeenCalledTimes(0);
        },
    );

    it('[PERSIST-1.1-BACKEND-SELECTOR] rejects an unsupported dbtype even when a complete MySQL block is present', async () => {
        const factory = vi.fn(() => createDataSourceDouble());
        restores.push(await installDataSourceFactory(factory));

        await expect(
            createOperator(
                {
                    dbtype: 'postgres',
                    mysql: {
                        database: 'synthetic_database',
                        host: 'synthetic-db.invalid',
                        password: 'synthetic-password-value',
                        port: 3307,
                        user: 'synthetic_user',
                    },
                },
                createLogger(),
            ).getConnection(),
        ).rejects.toThrow('DBTypeError');
        expect(factory).not.toHaveBeenCalled();
    });

    it('[PERSIST-1.1-DRIVER-ERROR] returns the driver initialization error object without credential decoration', async () => {
        const failure = new Error('SYNTHETIC_DRIVER_REJECTION');
        const initialize = vi.fn(async () => {
            throw failure;
        });
        const candidate = createDataSourceDouble({ initialize: initialize as DataSource['initialize'] });
        const logger = createLogger();
        await captureCandidate(candidate);

        await expect(
            createOperator(
                {
                    dbtype: 'mysql',
                    mysql: {
                        database: 'synthetic_database',
                        host: 'synthetic-db.invalid',
                        password: 'synthetic-password-value',
                        port: 3307,
                        user: 'synthetic_user',
                    },
                },
                logger,
            ).getConnection(),
        ).rejects.toBe(failure);
        expect(logger.system.info).not.toHaveBeenCalled();
        expect(logger.system.error).not.toHaveBeenCalled();
    });

    it('[PERSIST-1.2-EXTENSION-ORDER] loads SQLite extensions in configured order without deduplicating', async () => {
        const calls: string[] = [];
        const logger = createLogger();
        // better-sqlite3 の loadExtension は同期で、失敗は例外で返る。node-sqlite3 の callback
        // 形式とは異なる。
        const loadExtension = vi.fn((extension: string) => {
            calls.push(extension);
        });
        const candidate = createDataSourceDouble({
            driver: { databaseConnection: { loadExtension } },
        } as Partial<DataSource>);
        await captureCandidate(candidate);

        await createOperator(
            { dbtype: 'sqlite', sqlite: { extensions: ['synthetic-a', 'synthetic-b', 'synthetic-a'] } },
            logger,
        ).getConnection();

        expect(calls).toEqual(['synthetic-a', 'synthetic-b', 'synthetic-a']);
        expect(logger.system.info).toHaveBeenNthCalledWith(1, 'load extension: synthetic-a');
        expect(logger.system.info).toHaveBeenNthCalledWith(3, 'load extension: synthetic-b');
    });

    it.each([
        ['sqlite-without-sqlite-settings', { dbtype: 'sqlite' }],
        ['sqlite-without-extensions', { dbtype: 'sqlite', sqlite: {} }],
        [
            'mysql-with-extra-sqlite-settings',
            {
                dbtype: 'mysql',
                mysql: {
                    database: 'synthetic_database',
                    host: 'synthetic-db.invalid',
                    password: 'synthetic-password-value',
                    port: 3307,
                    user: 'synthetic_user',
                },
                sqlite: { extensions: ['synthetic-extension'] },
            },
        ],
    ])('[PERSIST-1.2-EXTENSION-GUARD] does not load an extension for %s', async (_scenario, config) => {
        const loadExtension = vi.fn((_extension: string) => undefined);
        const candidate = createDataSourceDouble({
            driver: { databaseConnection: { loadExtension } },
        } as Partial<DataSource>);
        await captureCandidate(candidate);

        await expect(createOperator(config, createLogger()).getConnection()).resolves.toBe(candidate);
        expect(loadExtension).not.toHaveBeenCalled();
    });

    it('[PERSIST-1.2-EXTENSION-FAILURE] stops at the first extension error and returns the same error', async () => {
        const failure = new Error('SYNTHETIC_EXTENSION_REJECTION');
        const calls: string[] = [];
        const logger = createLogger();
        const loadExtension = vi.fn((extension: string) => {
            calls.push(extension);
            if (extension === 'synthetic-b') {
                throw failure;
            }
        });
        const candidate = createDataSourceDouble({
            driver: { databaseConnection: { loadExtension } },
        } as Partial<DataSource>);
        await captureCandidate(candidate);

        await expect(
            createOperator(
                { dbtype: 'sqlite', sqlite: { extensions: ['synthetic-a', 'synthetic-b', 'synthetic-c'] } },
                logger,
            ).getConnection(),
        ).rejects.toBe(failure);
        expect(calls).toEqual(['synthetic-a', 'synthetic-b']);
        expect(logger.system.info).toHaveBeenCalledTimes(3);
        expect(logger.system.info).toHaveBeenNthCalledWith(1, 'load extension: synthetic-a');
        expect(logger.system.info).toHaveBeenNthCalledWith(2, 'loaded extension success: synthetic-a');
        expect(logger.system.info).toHaveBeenNthCalledWith(3, 'load extension: synthetic-b');
        expect(logger.system.error).toHaveBeenCalledTimes(1);
        expect(logger.system.error).toHaveBeenCalledWith('failed to load extension: synthetic-b');
    });

    it('[PERSIST-1.3-SEQUENTIAL-REUSE] returns the same initialized instance to sequential callers', async () => {
        const candidate = createDataSourceDouble();
        const factory = vi.fn(() => candidate);
        restores.push(await installDataSourceFactory(factory));
        const operator = createOperator({ dbtype: 'sqlite' }, createLogger());

        const first = await operator.getConnection();
        const second = await operator.getConnection();

        expect(first).toBe(candidate);
        expect(second).toBe(first);
        expect(factory).toHaveBeenCalledTimes(1);
        expect(candidate.initialize).toHaveBeenCalledTimes(1);
    });

    it('[PERSIST-1.10-CLEAR-AFTER-PUBLISH] clears the shared initialization promise once a cold connection publishes', async () => {
        const candidate = createDataSourceDouble();
        const factory = vi.fn(() => candidate);
        restores.push(await installDataSourceFactory(factory));
        const operator = createOperator({ dbtype: 'sqlite' }, createLogger());

        await operator.getConnection();

        expect((operator as unknown as { connectionInitialization: unknown }).connectionInitialization).toBeNull();
    });

    it('[PERSIST-1.10-SINGLE-FLIGHT] joins simultaneous cold callers to one fully initialized candidate', async () => {
        const initialized = createDeferred<DataSource>();
        const extensionCalls: string[] = [];
        const loadExtension = vi.fn((extension: string) => {
            extensionCalls.push(extension);
        });
        const candidate = createDataSourceDouble({
            driver: { databaseConnection: { loadExtension } },
            initialize: vi.fn(() => initialized.promise) as DataSource['initialize'],
        } as Partial<DataSource>);
        const factory = vi.fn(() => candidate);
        restores.push(await installDataSourceFactory(factory));
        const operator = createOperator(
            { dbtype: 'sqlite', sqlite: { extensions: ['synthetic-a', 'synthetic-b'] } },
            createLogger(),
        );

        const callers = [operator.getConnection(), operator.getConnection(), operator.getConnection()];

        expect(factory).toHaveBeenCalledTimes(1);
        expect(candidate.initialize).toHaveBeenCalledTimes(1);
        expect(loadExtension).not.toHaveBeenCalled();
        initialized.resolve(candidate);

        await expect(Promise.all(callers)).resolves.toEqual([candidate, candidate, candidate]);
        expect(extensionCalls).toEqual(['synthetic-a', 'synthetic-b']);
        expect(loadExtension).toHaveBeenCalledTimes(2);
    });

    it('[PERSIST-1.10-SYNCHRONOUS-REENTRY] publishes the shared initialization promise before candidate construction', async () => {
        const initialized = createDeferred<DataSource>();
        const candidate = createDataSourceDouble({
            initialize: vi.fn(() => initialized.promise) as DataSource['initialize'],
        });
        let reentered: Promise<DataSource> | null = null;
        let hasReentered = false;
        let operator: ReturnType<typeof createOperator>;
        const factory = vi.fn(() => {
            if (!hasReentered) {
                hasReentered = true;
                reentered = operator.getConnection();
            }
            return candidate;
        });
        restores.push(await installDataSourceFactory(factory));
        operator = createOperator({ dbtype: 'sqlite' }, createLogger());

        const first = operator.getConnection();
        await Promise.resolve();

        expect(reentered).toBe(first);
        expect(factory).toHaveBeenCalledTimes(1);
        expect(candidate.initialize).toHaveBeenCalledTimes(1);
        initialized.resolve(candidate);

        await expect(Promise.all([first, reentered])).resolves.toEqual([candidate, candidate]);
    });

    it.each([
        ['initialize', 'success'],
        ['initialize', 'failure'],
        ['extension', 'success'],
        ['extension', 'failure'],
    ] as const)(
        '[PERSIST-1.10-PENDING-%s-%s] joins a late caller without adding an initialization timeout',
        async (stage, outcome) => {
            const clock = useFakeClock(1_700_000_000_000);
            const failure = new Error(`SYNTHETIC_${stage.toUpperCase()}_PENDING_REJECTION`);
            const initialized = createDeferred<DataSource>();
            // better-sqlite3 の loadExtension は同期で、途中で止められない。extension の段でも
            // 合流を観測できるよう、待ち合わせは初期化側に置き、拡張はその後に走らせる。
            const loadExtension = vi.fn((_extension: string) => {
                if (outcome === 'failure') {
                    throw failure;
                }
            });
            const candidate = createDataSourceDouble({
                driver: { databaseConnection: { loadExtension } },
                initialize: vi.fn(() => initialized.promise) as DataSource['initialize'],
            } as Partial<DataSource>);
            const factory = vi.fn(() => candidate);
            restores.push(await installDataSourceFactory(factory));
            const operator = createOperator(
                stage === 'extension'
                    ? { dbtype: 'sqlite', sqlite: { extensions: ['synthetic-extension'] } }
                    : { dbtype: 'sqlite' },
                createLogger(),
            );

            try {
                const first = operator.getConnection();
                await Promise.resolve();
                await clock.advanceBy(30_001);
                const late = operator.getConnection();

                expect(late).toBe(first);
                expect(factory).toHaveBeenCalledTimes(1);
                expect(vi.getTimerCount()).toBe(0);

                if (stage === 'initialize' && outcome === 'failure') {
                    initialized.reject(failure);
                } else {
                    initialized.resolve(candidate);
                }

                if (outcome === 'success') {
                    await expect(Promise.all([first, late])).resolves.toEqual([candidate, candidate]);
                } else {
                    await expect(Promise.all([first, late])).rejects.toBe(failure);
                }
            } finally {
                clock.restore();
            }
        },
    );

    it.each([
        ['cleanup-success', false],
        ['cleanup-failure', true],
    ] as const)(
        '[PERSIST-1.11-PARTIAL-DRIVER-CONNECTION-%s] closes a rejected pre-initialization driver resource once and preserves the primary error',
        async (_caseName, disconnectFails) => {
            const primaryError = new Error('SYNTHETIC_PARTIAL_DRIVER_REJECTION');
            const cleanupError = new Error('SYNTHETIC_DRIVER_DISCONNECT_REJECTION');
            let resourceOpen = false;
            const disconnect = vi.fn(async () => {
                resourceOpen = false;
                if (disconnectFails) {
                    throw cleanupError;
                }
            });
            const driver = {
                connect: vi.fn(async () => {
                    resourceOpen = true;
                    throw primaryError;
                }),
                databaseConnection: { loadExtension: vi.fn() },
                disconnect,
            };
            const rejectedCandidate = createDataSourceDouble({
                driver: driver as DataSource['driver'],
                initialize: vi.fn(async function (this: DataSource) {
                    await this.driver.connect();
                    return this;
                }) as DataSource['initialize'],
            });
            const recoveredCandidate = createDataSourceDouble();
            const factory = vi.fn().mockReturnValueOnce(rejectedCandidate).mockReturnValueOnce(recoveredCandidate);
            const logger = createLogger();
            restores.push(await installDataSourceFactory(factory));
            const operator = createOperator({ dbtype: 'sqlite' }, logger);

            await expect(Promise.all([operator.getConnection(), operator.getConnection()])).rejects.toBe(primaryError);

            expect(resourceOpen).toBe(false);
            expect(disconnect).toHaveBeenCalledTimes(1);
            expect(rejectedCandidate.destroy).not.toHaveBeenCalled();
            if (disconnectFails) {
                expect(logger.system.error).toHaveBeenCalledTimes(2);
                expect(logger.system.error).toHaveBeenNthCalledWith(
                    1,
                    'failed to close database initialization candidate',
                );
                expect(logger.system.error).toHaveBeenNthCalledWith(2, cleanupError);
            } else {
                expect(logger.system.error).not.toHaveBeenCalled();
            }
            await expect(operator.getConnection()).resolves.toBe(recoveredCandidate);
            expect(factory).toHaveBeenCalledTimes(2);
        },
    );

    it('[PERSIST-1.11-SELF-DESTROY] does not close a TypeORM self-cleaned candidate twice after initialization fails', async () => {
        const primaryError = new Error('SYNTHETIC_SELF_DESTROY_REJECTION');
        let rejectedCandidate!: DataSource;
        const initializedStateAtDisconnect: boolean[] = [];
        const connect = vi.fn(async () => undefined);
        const disconnect = vi.fn(async () => {
            initializedStateAtDisconnect.push(rejectedCandidate.isInitialized);
        });
        const selfCleaningCandidate = createTypeOrmSelfCleaningDataSource({
            driver: {
                connect,
                databaseConnection: { loadExtension: vi.fn() },
                disconnect,
            } as DataSource['driver'],
            initialize: vi.fn(async function (this: DataSource) {
                await this.driver.connect();
                this.isInitialized = true;
                await this.destroy();
                throw primaryError;
            }) as DataSource['initialize'],
        });
        rejectedCandidate = selfCleaningCandidate.candidate;
        const recoveredCandidate = createDataSourceDouble();
        const factory = vi.fn().mockReturnValueOnce(rejectedCandidate).mockReturnValueOnce(recoveredCandidate);
        restores.push(await installDataSourceFactory(factory));
        const operator = createOperator({ dbtype: 'sqlite' }, createLogger());

        await expect(operator.getConnection()).rejects.toBe(primaryError);

        expect(connect).toHaveBeenCalledTimes(1);
        expect(selfCleaningCandidate.destroy).toHaveBeenCalledTimes(1);
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(initializedStateAtDisconnect).toEqual([true]);
        expect(rejectedCandidate.isInitialized).toBe(false);
        await expect(operator.getConnection()).resolves.toBe(recoveredCandidate);
        expect(factory).toHaveBeenCalledTimes(2);
    });

    it('[PERSIST-1.11-SELF-DISCONNECT] forwards TypeORM self-cleanup through destroy after driver connection', async () => {
        const primaryError = new Error('SYNTHETIC_SELF_DISCONNECT_REJECTION');
        let resourceOpen = false;
        let rejectedCandidate!: DataSource;
        const initializedStateAtDisconnect: boolean[] = [];
        const disconnect = vi.fn(async () => {
            initializedStateAtDisconnect.push(rejectedCandidate.isInitialized);
            resourceOpen = false;
        });
        const driver = {
            connect: vi.fn(async () => {
                resourceOpen = true;
            }),
            databaseConnection: { loadExtension: vi.fn() },
            disconnect,
        };
        const selfCleaningCandidate = createTypeOrmSelfCleaningDataSource({
            driver: driver as DataSource['driver'],
            initialize: vi.fn(async function (this: DataSource) {
                await this.driver.connect();
                this.isInitialized = true;
                await this.destroy();
                throw primaryError;
            }) as DataSource['initialize'],
        });
        rejectedCandidate = selfCleaningCandidate.candidate;
        const recoveredCandidate = createDataSourceDouble();
        const factory = vi.fn().mockReturnValueOnce(rejectedCandidate).mockReturnValueOnce(recoveredCandidate);
        restores.push(await installDataSourceFactory(factory));
        const operator = createOperator({ dbtype: 'sqlite' }, createLogger());

        await expect(operator.getConnection()).rejects.toBe(primaryError);

        expect(resourceOpen).toBe(false);
        expect(driver.connect).toHaveBeenCalledTimes(1);
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(selfCleaningCandidate.destroy).toHaveBeenCalledTimes(1);
        expect(initializedStateAtDisconnect).toEqual([true]);
        expect(rejectedCandidate.isInitialized).toBe(false);
        await expect(operator.getConnection()).resolves.toBe(recoveredCandidate);
        expect(factory).toHaveBeenCalledTimes(2);
    });

    it('[PERSIST-1.11-SELF-DESTROY-NO-DISCONNECT] does not repeat driver cleanup after a candidate closes itself', async () => {
        const primaryError = new Error('SYNTHETIC_SELF_CLEANUP_REJECTION');
        let resourceOpen = false;
        const disconnect = vi.fn(async () => {
            resourceOpen = false;
        });
        const candidate = createDataSourceDouble({
            driver: {
                connect: vi.fn(async () => {
                    resourceOpen = true;
                }),
                databaseConnection: { loadExtension: vi.fn() },
                disconnect,
            } as DataSource['driver'],
            destroy: vi.fn(async () => {
                resourceOpen = false;
            }),
            initialize: vi.fn(async function (this: DataSource) {
                await this.driver.connect();
                await this.destroy();
                throw primaryError;
            }) as DataSource['initialize'],
        });
        const recoveredCandidate = createDataSourceDouble();
        const factory = vi.fn().mockReturnValueOnce(candidate).mockReturnValueOnce(recoveredCandidate);
        restores.push(await installDataSourceFactory(factory));
        const operator = createOperator({ dbtype: 'sqlite' }, createLogger());

        await expect(operator.getConnection()).rejects.toBe(primaryError);

        expect(resourceOpen).toBe(false);
        expect(candidate.destroy).toHaveBeenCalledTimes(1);
        expect(disconnect).not.toHaveBeenCalled();
        await expect(operator.getConnection()).resolves.toBe(recoveredCandidate);
    });

    it('[PERSIST-1.11-CLEANUP-DOUBLE-FAULT] logs a cleanup error when TypeORM self-destroy during initialization also fails', async () => {
        // This one deliberately does NOT go through `installDataSourceFactory`: that patches
        // `DataSource` behind a fresh dynamic `import()` of DBOperator.js, and this file's own
        // `createConnection()` (DBOperator.ts:118-129) wraps `candidate.destroy` -- reachable only
        // through the require()-loaded DBOperator instance that `createOperator` otherwise defaults
        // to. `vi.spyOn` on the real `typeorm` `DataSource.prototype` affects that same require()-side
        // class regardless, since both the require() and import() specifiers resolve to the same
        // underlying CJS `typeorm` package instance.
        const primaryError = new Error('SYNTHETIC_SELF_CLEANUP_DOUBLE_FAULT_INIT');
        const cleanupFailure = new Error('SYNTHETIC_SELF_CLEANUP_DOUBLE_FAULT_DESTROY');
        vi.spyOn(RealDataSource.prototype, 'initialize').mockImplementationOnce(async function (
            this: DataSource,
        ) {
            await this.destroy();
            throw primaryError;
        });
        vi.spyOn(RealDataSource.prototype, 'destroy').mockImplementationOnce(async () => {
            throw cleanupFailure;
        });
        const logger = createLogger();
        const operator = createOperator({ dbtype: 'sqlite' }, logger);

        await expect(operator.getConnection()).rejects.toBe(primaryError);

        expect(logger.system.error).toHaveBeenCalledWith('failed to close database initialization candidate');
        expect(logger.system.error).toHaveBeenCalledWith(cleanupFailure);
    });

    it('[PERSIST-1.11-SELF-DISCONNECT-NO-DESTROY] does not repeat driver cleanup after a driver disconnects itself', async () => {
        const primaryError = new Error('SYNTHETIC_SELF_DISCONNECT_REJECTION');
        let resourceOpen = false;
        const disconnect = vi.fn(async () => {
            resourceOpen = false;
        });
        const candidate = createDataSourceDouble({
            driver: {
                connect: vi.fn(async () => {
                    resourceOpen = true;
                }),
                databaseConnection: { loadExtension: vi.fn() },
                disconnect,
            } as DataSource['driver'],
            initialize: vi.fn(async function (this: DataSource) {
                await this.driver.connect();
                await this.driver.disconnect();
                throw primaryError;
            }) as DataSource['initialize'],
        });
        const recoveredCandidate = createDataSourceDouble();
        const factory = vi.fn().mockReturnValueOnce(candidate).mockReturnValueOnce(recoveredCandidate);
        restores.push(await installDataSourceFactory(factory));
        const operator = createOperator({ dbtype: 'sqlite' }, createLogger());

        await expect(operator.getConnection()).rejects.toBe(primaryError);

        expect(resourceOpen).toBe(false);
        expect(disconnect).toHaveBeenCalledTimes(1);
        await expect(operator.getConnection()).resolves.toBe(recoveredCandidate);
    });

    it('[PERSIST-1.11-INITIALIZED-EXTENSION-FAILURE] closes an initialized candidate through TypeORM destroy and driver disconnect', async () => {
        const primaryError = new Error('SYNTHETIC_INITIALIZED_EXTENSION_REJECTION');
        let rejectedCandidate!: DataSource;
        const initializedStateAtDisconnect: boolean[] = [];
        const disconnect = vi.fn(async () => undefined);
        const driver = {
            connect: vi.fn(async () => undefined),
            databaseConnection: {
                loadExtension: vi.fn((_extension: string) => {
                    throw primaryError;
                }),
            },
            disconnect: vi.fn(async () => {
                initializedStateAtDisconnect.push(rejectedCandidate.isInitialized);
                await disconnect();
            }),
        };
        const selfCleaningCandidate = createTypeOrmSelfCleaningDataSource({
            driver: driver as DataSource['driver'],
            initialize: vi.fn(async function (this: DataSource) {
                await this.driver.connect();
                this.isInitialized = true;
                return this;
            }) as DataSource['initialize'],
        });
        rejectedCandidate = selfCleaningCandidate.candidate;
        const recoveredCandidate = createDataSourceDouble({
            driver: {
                databaseConnection: {
                    loadExtension: vi.fn((_extension: string) => undefined),
                },
            },
        } as Partial<DataSource>);
        const factory = vi.fn().mockReturnValueOnce(rejectedCandidate).mockReturnValueOnce(recoveredCandidate);
        restores.push(await installDataSourceFactory(factory));
        const operator = createOperator(
            { dbtype: 'sqlite', sqlite: { extensions: ['synthetic-extension'] } },
            createLogger(),
        );

        await expect(operator.getConnection()).rejects.toBe(primaryError);

        expect(selfCleaningCandidate.destroy).toHaveBeenCalledTimes(1);
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(initializedStateAtDisconnect).toEqual([true]);
        expect(rejectedCandidate.isInitialized).toBe(false);
        await expect(operator.getConnection()).resolves.toBe(recoveredCandidate);
        expect(factory).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['connection', { dbtype: 'sqlite' }],
        ['migration', { dbtype: 'sqlite' }],
        ['extension', { dbtype: 'sqlite', sqlite: { extensions: ['synthetic-extension'] } }],
    ])(
        '[PERSIST-1.11-FAILED-%s-INITIALIZATION] closes the unpublished candidate, shares the primary error, and permits a later initialization',
        async (stage, config) => {
            const primaryError = new Error(`SYNTHETIC_${stage.toUpperCase()}_REJECTION`);
            const initialize =
                stage === 'extension'
                    ? vi.fn(async function (this: DataSource) {
                          return this;
                      })
                    : vi.fn(async () => {
                          throw primaryError;
                      });
            const loadExtension = vi.fn((_extension: string) => {
                throw primaryError;
            });
            const rejectedCandidate = createDataSourceDouble({
                driver: { databaseConnection: { loadExtension } },
                initialize: initialize as DataSource['initialize'],
            } as Partial<DataSource>);
            const recoveredCandidate = createDataSourceDouble({
                driver: {
                    databaseConnection: {
                        loadExtension: vi.fn((_extension: string) => undefined),
                    },
                },
            } as Partial<DataSource>);
            const factory = vi.fn().mockReturnValueOnce(rejectedCandidate).mockReturnValueOnce(recoveredCandidate);
            restores.push(await installDataSourceFactory(factory));
            const operator = createOperator(config, createLogger());

            const callers = [operator.getConnection(), operator.getConnection()];
            const outcomes = await Promise.allSettled(callers);

            expect(outcomes).toEqual([
                { reason: primaryError, status: 'rejected' },
                { reason: primaryError, status: 'rejected' },
            ]);
            expect(factory).toHaveBeenCalledTimes(1);
            expect(rejectedCandidate.destroy).toHaveBeenCalledTimes(1);
            await expect(operator.getConnection()).resolves.toBe(recoveredCandidate);
            expect(factory).toHaveBeenCalledTimes(2);
            expect(recoveredCandidate.initialize).toHaveBeenCalledTimes(1);
        },
    );

    it('[PERSIST-1.11-CLEANUP-DIAGNOSTIC] preserves the initialization error when candidate cleanup also fails', async () => {
        const primaryError = new Error('SYNTHETIC_INITIALIZATION_REJECTION');
        const cleanupError = new Error('SYNTHETIC_CLEANUP_REJECTION');
        const candidate = createDataSourceDouble({
            destroy: vi.fn(async () => {
                throw cleanupError;
            }),
            initialize: vi.fn(async () => {
                throw primaryError;
            }) as DataSource['initialize'],
        });
        const factory = vi.fn(() => candidate);
        const logger = createLogger();
        restores.push(await installDataSourceFactory(factory));
        const operator = createOperator({ dbtype: 'sqlite' }, logger);

        await expect(Promise.all([operator.getConnection(), operator.getConnection()])).rejects.toBe(primaryError);

        expect(factory).toHaveBeenCalledTimes(1);
        expect(candidate.destroy).toHaveBeenCalledTimes(1);
        expect(logger.system.error).toHaveBeenCalledTimes(2);
        expect(logger.system.error).toHaveBeenNthCalledWith(1, 'failed to close database initialization candidate');
        expect(logger.system.error).toHaveBeenNthCalledWith(2, cleanupError);
    });

    it('[PERSIST-1.3-CHECK] runs select 1 and preserves its success or original error', async () => {
        const failure = new Error('SYNTHETIC_QUERY_REJECTION');
        const query = vi
            .fn()
            .mockResolvedValueOnce([{ one: 1 }])
            .mockRejectedValueOnce(failure);
        const candidate = createDataSourceDouble({ manager: { query } as DataSource['manager'] });
        await captureCandidate(candidate);
        const operator = createOperator({ dbtype: 'sqlite' }, createLogger());

        await expect(operator.checkConnection()).resolves.toBeUndefined();
        await expect(operator.checkConnection()).rejects.toBe(failure);
        expect(query).toHaveBeenNthCalledWith(1, 'select 1');
        expect(query).toHaveBeenNthCalledWith(2, 'select 1');
    });

    it('[PERSIST-1.3-CLOSE] treats an absent connection as a no-op and settles only after destroy', async () => {
        const destroyed = createDeferred<void>();
        const destroy = vi.fn(() => destroyed.promise);
        const candidate = createDataSourceDouble({ destroy });
        await captureCandidate(candidate);
        const operator = createOperator({ dbtype: 'sqlite' }, createLogger());

        await expect(operator.closeConnection()).resolves.toBeUndefined();
        expect(candidate.destroy).not.toHaveBeenCalled();
        await operator.getConnection();
        const close = operator.closeConnection();
        const closeSettlement = createDeferred<void>();
        void close.then(closeSettlement.resolve, closeSettlement.reject);
        await Promise.resolve();
        await Promise.resolve();

        expect(destroy).toHaveBeenCalledTimes(1);
        expect(closeSettlement.state()).toEqual({ status: 'pending' });
        destroyed.resolve(undefined);
        await expect(close).resolves.toBeUndefined();
    });
});
