import 'reflect-metadata';

import * as fs from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { provisionMariaDb, type MariaDbRuntime, type MysqlSchema } from '../persistence/mysql-runtime';
import {
    deferred,
    loadTool,
    makeDependencies,
    oldRecorded,
    oldRule,
    v1Backup,
    versionlessBackup,
    withProcess,
} from './_harness';
import { createRecordingLoggerModel } from '../harness/silent-logger-model';

const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT!;
const require = createRequire(join(process.cwd(), 'package.json'));
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;

const entities = {
    Rule: load<new () => any>('db/entities/Rule.js'),
    Reserve: load<new () => any>('db/entities/Reserve.js'),
    DropLogFile: load<new () => any>('db/entities/DropLogFile.js'),
    RecordedEntity: load<new () => any>('db/entities/Recorded.js'),
    Thumbnail: load<new () => any>('db/entities/Thumbnail.js'),
    VideoFile: load<new () => any>('db/entities/VideoFile.js'),
    RecordedHistory: load<new () => any>('db/entities/RecordedHistory.js'),
    RecordedTag: load<new () => any>('db/entities/RecordedTag.js'),
};
const repositories = {
    IRuleDB: load<new (...args: any[]) => any>('model/db/RuleDB.js'),
    IReserveDB: load<new (...args: any[]) => any>('model/db/ReserveDB.js'),
    IDropLogFileDB: load<new (...args: any[]) => any>('model/db/DropLogFileDB.js'),
    IRecordedDB: load<new (...args: any[]) => any>('model/db/RecordedDB.js'),
    IThumbnailDB: load<new (...args: any[]) => any>('model/db/ThumbnailDB.js'),
    IVideoFileDB: load<new (...args: any[]) => any>('model/db/VideoFileDB.js'),
    IRecordedHistoryDB: load<new (...args: any[]) => any>('model/db/RecordedHistoryDB.js'),
    IRecordedTagDB: load<new (...args: any[]) => any>('model/db/RecordedTagDB.js'),
};

const cleanups: Array<() => Promise<void>> = [];
const drainCleanups = async () => {
    const failures: unknown[] = [];
    while (cleanups.length > 0) {
        try {
            await cleanups.pop()!();
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'management integration cleanup failed');
};
// The cases that use a MySQL database drain their cleanups in a `finally` of their own body, not in an
// `afterEach`: draining removes the case's fixture container, which the Docker daemon answers late while
// it is busy (an image export holds `docker rm --force` for tens of seconds), so it is awaited with the
// case's timeout rather than with Vitest's default hook timeout of 10 s.

const acquire = async <T>(create: () => Promise<T>, dispose: (value: T) => Promise<void>): Promise<T> => {
    const value = await create();
    cleanups.push(() => dispose(value));
    return value;
};

interface InitializableResource {
    readonly isInitialized: boolean;
    destroy(): Promise<void>;
    initialize(): Promise<unknown>;
}

const initialize = async <T extends InitializableResource>(create: () => T): Promise<T> => {
    const resource = create();
    cleanups.push(async () => {
        if (resource.isInitialized) await resource.destroy();
    });
    await resource.initialize();
    return resource;
};

interface BackendHooks {
    readonly createDataSource?: (options: DataSourceOptions) => DataSource;
    readonly createRoot?: () => Promise<string>;
    readonly removeRoot?: (root: string) => Promise<void>;
}

const backend = async (dialect: 'sqlite' | 'mysql', hooks: BackendHooks = {}) => {
    const root = await acquire(
        hooks.createRoot ?? (() => mkdtemp(join(tmpdir(), 'synthetic-management-tools-'))),
        hooks.removeRoot ?? (value => rm(value, { recursive: true, force: true })),
    );
    let maria: MariaDbRuntime | undefined;
    let schema: MysqlSchema | undefined;
    if (dialect === 'mysql') {
        maria = await acquire(provisionMariaDb, value => value.cleanup());
        schema = await acquire(
            () => maria!.createSchema(),
            value => value.cleanup(),
        );
    }
    const common = { entities: [join(snapshot, 'db', 'entities', '*.js')], logging: false, synchronize: true };
    const options: DataSourceOptions =
        dialect === 'sqlite'
            ? { ...common, type: 'better-sqlite3', database: join(root, 'management.db') }
            : {
                  ...common,
                  type: 'mysql',
                  host: schema!.config.host,
                  port: schema!.config.port,
                  username: schema!.config.user,
                  password: schema!.config.password,
                  database: schema!.config.database,
                  charset: 'utf8mb4',
                  bigNumberStrings: false,
              };
    const source = await initialize(() => hooks.createDataSource?.(options) ?? new DataSource(options));
    const operator = {
        closeConnection: vi.fn(async () => await source.destroy()),
        getConnection: async () => source,
        getLikeStr: () => 'like',
        convertBoolean: (value: boolean) => value,
    };
    const retry = { run: <T>(operation: () => Promise<T>): Promise<T> => operation() };
    const repositoryLog = createRecordingLoggerModel();
    const ports = Object.fromEntries(
        Object.entries(repositories).map(([name, Repository]) => [
            name,
            new Repository(repositoryLog.loggerModel, operator, retry),
        ]),
    ) as Record<string, any>;
    return { operator, options, ports, repositoryErrors: repositoryLog.error, root, source };
};

const inspectPersisted = async <T>(
    options: DataSourceOptions,
    inspect: (source: DataSource) => Promise<T>,
): Promise<T> => {
    const source = await initialize(() => new DataSource(options));
    try {
        return await inspect(source);
    } finally {
        if (source.isInitialized) await source.destroy();
    }
};

const restoreDocument = () => ({
    ruleItems: [
        {
            id: 11,
            updateCnt: 12,
            isTimeSpecification: false,
            searchOption: { keyword: 'synthetic-rule' },
            reserveOption: { enable: true, allowEndLack: false, avoidDuplicate: false },
            saveOption: { parentDirectoryName: 'synthetic-root' },
        },
    ],
    reserveItems: [
        {
            id: 21,
            updateTime: 22,
            channelId: 23,
            channel: 'synthetic-channel',
            channelType: 'GR',
            startAt: 24,
            endAt: 25,
            name: 'synthetic-reserve',
            halfWidthName: 'synthetic-reserve',
        },
    ],
    dropLogFileItems: [{ id: 31, errorCnt: 1, dropCnt: 2, scramblingCnt: 3, filePath: 'synthetic-drop.log' }],
    recordedItems: [
        {
            id: 41,
            reserveId: null,
            ruleId: null,
            programId: null,
            channelId: 23,
            isProtected: false,
            startAt: 24,
            endAt: 25,
            duration: 1,
            name: 'synthetic-recorded',
            halfWidthName: 'synthetic-recorded',
            rawExtended: null,
            rawHalfWidthExtended: null,
            isRecording: false,
            dropLogFileId: 31,
        },
    ],
    thumbnailItems: [{ id: 51, recordedId: 41, filePath: 'synthetic-thumbnail.jpg' }],
    videoFileItems: [
        {
            id: 61,
            recordedId: 41,
            parentDirectoryName: 'synthetic-root',
            filePath: 'synthetic-video.ts',
            type: 'ts',
            name: 'synthetic-video',
            size: 62,
        },
    ],
    recordedHistoryItems: [{ id: 71, name: 'synthetic-history', channelId: 23, endAt: 25 }],
    recordedTagItems: [{ id: 81, name: 'synthetic-tag', halfWidthName: 'synthetic-tag', color: 'synthetic-color' }],
});

const toolHarness = (ports: Record<string, any>, overrides: Record<string, unknown> = {}) =>
    makeDependencies({
        ...ports,
        IDBOperator: {
            checkConnection: vi.fn(async () => undefined),
            closeConnection: vi.fn(async () => undefined),
        },
        IConnectionCheckModel: { checkDB: vi.fn(async () => undefined) },
        ...overrides,
    });

const restoreStages = [
    { name: 'rule', port: 'IRuleDB', entity: 'Rule', id: 11 },
    { name: 'reserve', port: 'IReserveDB', entity: 'Reserve', id: 21 },
    { name: 'drop-log', port: 'IDropLogFileDB', entity: 'DropLogFile', id: 31 },
    { name: 'recorded', port: 'IRecordedDB', entity: 'RecordedEntity', id: 41 },
    { name: 'thumbnail', port: 'IThumbnailDB', entity: 'Thumbnail', id: 51 },
    { name: 'video-file', port: 'IVideoFileDB', entity: 'VideoFile', id: 61 },
    { name: 'recorded-history', port: 'IRecordedHistoryDB', entity: 'RecordedHistory', id: 71 },
    { name: 'recorded-tag', port: 'IRecordedTagDB', entity: 'RecordedTag', id: 81 },
] as const;
type RestoreStage = (typeof restoreStages)[number];
type RestoreFault = 'start' | 'insert' | 'commit' | 'insert-rollback' | 'release' | 'release-barrier';

const mediaDocument = (paths: { dropLog: string; thumbnail: string; video: string }) => {
    const document = restoreDocument();
    document.dropLogFileItems[0].filePath = paths.dropLog;
    document.thumbnailItems[0].filePath = paths.thumbnail;
    document.videoFileItems[0].filePath = paths.video;
    return document;
};

const setStageMarker = (document: ReturnType<typeof restoreDocument>, stage: RestoreStage, marker: string) => {
    switch (stage.name) {
        case 'rule':
            document.ruleItems[0].searchOption.keyword = marker;
            return;
        case 'reserve':
            document.reserveItems[0].name = marker;
            return;
        case 'drop-log':
            document.dropLogFileItems[0].filePath = marker;
            return;
        case 'recorded':
            document.recordedItems[0].name = marker;
            return;
        case 'thumbnail':
            document.thumbnailItems[0].filePath = marker;
            return;
        case 'video-file':
            document.videoFileItems[0].filePath = marker;
            return;
        case 'recorded-history':
            document.recordedHistoryItems[0].name = marker;
            return;
        case 'recorded-tag':
            document.recordedTagItems[0].name = marker;
            return;
    }
};

const readStageMarker = async (source: DataSource, stage: RestoreStage) => {
    const item = await source.getRepository(entities[stage.entity]).findOneBy({ id: stage.id });
    if (item === null) return null;
    switch (stage.name) {
        case 'rule':
            return item.keyword;
        case 'reserve':
        case 'recorded':
        case 'recorded-history':
        case 'recorded-tag':
            return item.name;
        case 'drop-log':
        case 'thumbnail':
        case 'video-file':
            return item.filePath;
    }
};

const makeRestoreTool = async (ports: Record<string, any>, input: string) => {
    const harness = toolHarness(ports);
    const DBTools = await loadTool('DBTools.js', harness.container, fs);
    return await withProcess(['-m', 'restore', '-o', input], () => new DBTools());
};

const startRestore = (tool: any, stage: RestoreStage): Promise<unknown> => {
    if (stage.name === 'drop-log') return withProcess([], () => tool.restore());
    return tool.restore();
};

const expectRestoreRejection = async (
    restore: Promise<unknown>,
    stage: RestoreStage,
    diagnostics: () => readonly unknown[],
) => {
    if (stage.name === 'drop-log') {
        await expect(restore).rejects.toEqual(expect.objectContaining({ code: 1 }));
        expect(diagnostics().some(value => value instanceof Error && value.message === 'restore error')).toBe(true);
        return;
    }
    const rejection = await restore.then(
        () => undefined,
        reason => reason,
    );
    expect(rejection).toEqual(expect.objectContaining({ message: 'restore error' }));
};

const expectRestoreError = async (tool: any, stage: RestoreStage, repositoryErrors: { mock: { calls: unknown[][] } }) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const recorded = () => [...error.mock.calls.flat(), ...repositoryErrors.mock.calls.flat()];
    try {
        await expectRestoreRejection(startRestore(tool, stage), stage, recorded);
        return recorded();
    } finally {
        error.mockRestore();
    }
};

const injectRestoreFault = (source: DataSource, target: number, fault: RestoreFault) => {
    const events: string[] = [];
    const targetStage = restoreStages[target];
    const errors = {
        commit: new Error(`synthetic ${targetStage.name} commit failure`),
        primary: new Error(`synthetic ${targetStage.name} insert failure`),
        release: new Error(`synthetic ${targetStage.name} release failure`),
        rollback: new Error(`synthetic ${targetStage.name} rollback cleanup failure`),
        start: new Error(`synthetic ${targetStage.name} start failure`),
    };
    const releaseBarrier =
        fault === 'release-barrier' ? { entered: deferred<void>(), proceed: deferred<void>() } : undefined;
    let queryRunnerIndex = 0;
    const createQueryRunner = source.createQueryRunner.bind(source) as (...args: any[]) => any;
    const spy = vi.spyOn(source, 'createQueryRunner').mockImplementation((...args: any[]) => {
        const index = queryRunnerIndex++;
        const stage = restoreStages[index];
        const queryRunner = createQueryRunner(...args);
        const record = (operation: string) => events.push(`${stage?.name ?? 'unexpected'}:${operation}`);
        const manager = new Proxy(queryRunner.manager, {
            get(current, property) {
                if (property === 'insert') {
                    return async (...methodArgs: any[]) => {
                        record('insert');
                        if (index === target && (fault === 'insert' || fault === 'insert-rollback')) {
                            throw errors.primary;
                        }
                        return await current.insert(...methodArgs);
                    };
                }
                const value = Reflect.get(current, property);
                return typeof value === 'function' ? value.bind(current) : value;
            },
        });
        return new Proxy(queryRunner, {
            get(current, property) {
                if (property === 'manager') return manager;
                if (property === 'startTransaction') {
                    return async (...methodArgs: any[]) => {
                        record('start');
                        if (index === target && fault === 'start') {
                            throw errors.start;
                        }
                        return await current.startTransaction(...methodArgs);
                    };
                }
                if (property === 'commitTransaction') {
                    return async (...methodArgs: any[]) => {
                        record('commit');
                        if (index === target && fault === 'commit') throw errors.commit;
                        return await current.commitTransaction(...methodArgs);
                    };
                }
                if (property === 'rollbackTransaction') {
                    return async (...methodArgs: any[]) => {
                        record('rollback');
                        await current.rollbackTransaction(...methodArgs);
                        if (index === target && fault === 'insert-rollback') throw errors.rollback;
                    };
                }
                if (property === 'release') {
                    return async (...methodArgs: any[]) => {
                        if (index === target && fault === 'release-barrier') {
                            releaseBarrier!.entered.resolve();
                            await releaseBarrier!.proceed.promise;
                        }
                        await current.release(...methodArgs);
                        record('release');
                        if (index === target && (fault === 'release' || fault === 'release-barrier')) {
                            throw errors.release;
                        }
                    };
                }
                const value = Reflect.get(current, property);
                return typeof value === 'function' ? value.bind(current) : value;
            },
        });
    });
    return { errors, events, releaseBarrier, restore: () => spy.mockRestore() };
};

const clearDatabase = async (source: DataSource) => {
    for (const Entity of Object.values(entities).reverse()) {
        await source.createQueryBuilder().delete().from(Entity).execute();
    }
};

const observeRestoreTransactions = (source: DataSource) => {
    const events: string[] = [];
    let queryRunnerIndex = 0;
    const createQueryRunner = source.createQueryRunner.bind(source) as (...args: any[]) => any;
    const spy = vi.spyOn(source, 'createQueryRunner').mockImplementation((...args: any[]) => {
        const stage = restoreStages[queryRunnerIndex++];
        const queryRunner = createQueryRunner(...args);
        return new Proxy(queryRunner, {
            get(current, property) {
                if (
                    property === 'startTransaction' ||
                    property === 'commitTransaction' ||
                    property === 'rollbackTransaction' ||
                    property === 'release'
                ) {
                    const original = current[property].bind(current);
                    return async (...operationArgs: any[]) => {
                        events.push(`${stage?.name ?? 'unexpected'}:${property}`);
                        return await original(...operationArgs);
                    };
                }
                const value = Reflect.get(current, property);
                return typeof value === 'function' ? value.bind(current) : value;
            },
        });
    });
    return { events, restore: () => spy.mockRestore() };
};

describe('management SQLite/MySQL and filesystem characterization', () => {
    it('[MT-5.1/MT-5.2] releases every acquired DB resource after a partially initialized setup rejects', async () => {
        const events: string[] = [];
        const failure = new Error('synthetic DB setup failure');
        const resource = {
            isInitialized: true,
            initialize: vi.fn(async () => {
                events.push('initialize:source');
                throw failure;
            }),
            destroy: vi.fn(async () => {
                events.push('dispose:source');
            }),
        };
        await expect(
            backend('sqlite', {
                createRoot: async () => 'root',
                removeRoot: async value => {
                    events.push(`dispose:${value}`);
                },
                createDataSource: () => resource as unknown as DataSource,
            }),
        ).rejects.toBe(failure);
        await drainCleanups();
        expect(events).toEqual(['initialize:source', 'dispose:source', 'dispose:root']);
    });

    it('[MT-5.1/MT-5.2] attempts every cleanup and aggregates cleanup failures', async () => {
        const events: string[] = [];
        const firstFailure = new Error('synthetic first cleanup failure');
        const secondFailure = new Error('synthetic second cleanup failure');
        cleanups.push(
            async () => {
                events.push('cleanup:first');
                throw firstFailure;
            },
            async () => {
                events.push('cleanup:middle');
            },
            async () => {
                events.push('cleanup:last');
                throw secondFailure;
            },
        );
        const rejection = await drainCleanups().catch((error: unknown) => error);
        expect(rejection).toBeInstanceOf(AggregateError);
        expect((rejection as AggregateError).errors).toEqual([secondFailure, firstFailure]);
        expect(events).toEqual(['cleanup:last', 'cleanup:middle', 'cleanup:first']);
    });

    it.each(['sqlite', 'mysql'] as const)(
        '[INT-BOUNDARY-MT-7.4/INT-DBFS/sqlite-mysql-json-transaction-cleanup] keeps the %s success boundary transactional, compact, and closed exactly once',
        async dialect => {
            try {
                const database = await backend(dialect);
                const restoreInput = join(database.root, 'synthetic-int-dbfs-restore.json');
                const backupOutput = join(database.root, 'synthetic-int-dbfs-backup.json');
                const v1Input = join(database.root, 'synthetic-int-dbfs-v1.json');
                const media = {
                    dropLog: join(database.root, 'synthetic-int-dbfs-drop.log'),
                    thumbnail: join(database.root, 'synthetic-int-dbfs-thumbnail.jpg'),
                    video: join(database.root, 'synthetic-int-dbfs-video.ts'),
                };
                const mediaContents = {
                    dropLog: 'synthetic int dbfs drop log bytes',
                    thumbnail: 'synthetic int dbfs thumbnail bytes',
                    video: 'synthetic int dbfs video bytes',
                };
                await Promise.all([
                    writeFile(media.dropLog, mediaContents.dropLog, 'utf8'),
                    writeFile(media.thumbnail, mediaContents.thumbnail, 'utf8'),
                    writeFile(media.video, mediaContents.video, 'utf8'),
                ]);
                const document = mediaDocument(media);
                const restoreBytes = JSON.stringify(document);
                await writeFile(restoreInput, restoreBytes, 'utf8');

                const restoreHarness = toolHarness(database.ports, { IDBOperator: database.operator });
                const DBTools = await loadTool('DBTools.js', restoreHarness.container, fs);
                const restoreTool = await withProcess(['-m', 'restore', '-o', restoreInput], () => new DBTools());
                const lifecycle = observeRestoreTransactions(database.source);
                try {
                    await expect(withProcess([], () => restoreTool.run())).rejects.toEqual(
                        expect.objectContaining({ code: 0 }),
                    );
                } finally {
                    lifecycle.restore();
                }
                expect(restoreHarness.dependencies.IConnectionCheckModel.checkDB).toHaveBeenCalledOnce();
                expect(restoreHarness.dependencies.IDBOperator).toBe(database.operator);
                expect(database.operator.closeConnection).toHaveBeenCalledOnce();
                expect(database.source.isInitialized).toBe(false);
                expect(lifecycle.events).toEqual(
                    restoreStages.flatMap(stage => [
                        `${stage.name}:startTransaction`,
                        `${stage.name}:commitTransaction`,
                        `${stage.name}:release`,
                    ]),
                );
                await inspectPersisted(database.options, async source => {
                    for (const Entity of Object.values(entities)) {
                        expect(await source.getRepository(Entity).count()).toBe(1);
                    }
                });
                await expect(readFile(restoreInput, 'utf8')).resolves.toBe(restoreBytes);
                await expect(readFile(media.dropLog, 'utf8')).resolves.toBe(mediaContents.dropLog);
                await expect(readFile(media.thumbnail, 'utf8')).resolves.toBe(mediaContents.thumbnail);
                await expect(readFile(media.video, 'utf8')).resolves.toBe(mediaContents.video);

                await database.source.initialize();
                const backupHarness = toolHarness(database.ports, { IDBOperator: database.operator });
                const BackupDBTools = await loadTool('DBTools.js', backupHarness.container, fs);
                const backupTool = await withProcess(['-m', 'backup', '-o', backupOutput], () => new BackupDBTools());
                await expect(withProcess([], () => backupTool.run())).rejects.toEqual(
                    expect.objectContaining({ code: 0 }),
                );
                const backupBytes = await readFile(backupOutput, 'utf8');
                expect(backupBytes).toBe(JSON.stringify(JSON.parse(backupBytes)));
                const backupCollections = Object.values(JSON.parse(backupBytes));
                expect(backupCollections).toHaveLength(8);
                for (const collection of backupCollections) {
                    expect(collection).toEqual(expect.any(Array));
                    expect(collection).toHaveLength(1);
                }
                expect(backupHarness.dependencies.IConnectionCheckModel.checkDB).toHaveBeenCalledOnce();
                expect(backupHarness.dependencies.IDBOperator).toBe(database.operator);
                expect(database.operator.closeConnection).toHaveBeenCalledTimes(2);
                expect(database.source.isInitialized).toBe(false);

                await inspectPersisted(database.options, clearDatabase);
                const v1Bytes = JSON.stringify(v1Backup());
                await writeFile(v1Input, v1Bytes, 'utf8');
                await database.source.initialize();
                const v1Harness = toolHarness(database.ports, { IDBOperator: database.operator });
                const V1Tool = await loadTool('V1MigrationTool.js', v1Harness.container, fs);
                const v1Tool = await withProcess(['-i', v1Input], () => new V1Tool());
                await expect(withProcess([], () => v1Tool.run())).rejects.toEqual(expect.objectContaining({ code: 0 }));
                expect(v1Harness.dependencies.IConnectionCheckModel.checkDB).toHaveBeenCalledOnce();
                expect(v1Harness.dependencies.IDBOperator).toBe(database.operator);
                expect(database.operator.closeConnection).toHaveBeenCalledTimes(3);
                expect(database.source.isInitialized).toBe(false);
                await inspectPersisted(database.options, async source => {
                    expect(await source.getRepository(entities.Rule).count()).toBe(1);
                    expect(await source.getRepository(entities.RecordedEntity).count()).toBe(1);
                    expect(await source.getRepository(entities.Thumbnail).count()).toBe(1);
                    expect(await source.getRepository(entities.VideoFile).count()).toBe(2);
                    expect(await source.getRepository(entities.RecordedHistory).count()).toBe(1);
                });
                await expect(readFile(v1Input, 'utf8')).resolves.toBe(v1Bytes);
            } finally {
                await drainCleanups();
            }
        },
        120_000,
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[INT-BOUNDARY-MT-7.4/INT-DBFS/sqlite-mysql-json-transaction-cleanup] keeps %s JSON parse and direct-write failures inside their observed filesystem boundary',
        async dialect => {
            try {
                const database = await backend(dialect);
                const invalidInput = join(database.root, 'synthetic-int-dbfs-invalid.json');
                const partialOutput = join(database.root, 'synthetic-int-dbfs-partial.json');
                const media = {
                    dropLog: join(database.root, 'synthetic-int-dbfs-invalid-drop.log'),
                    thumbnail: join(database.root, 'synthetic-int-dbfs-invalid-thumbnail.jpg'),
                    video: join(database.root, 'synthetic-int-dbfs-invalid-video.ts'),
                };
                const mediaContents = {
                    dropLog: 'synthetic invalid dbfs drop log bytes',
                    thumbnail: 'synthetic invalid dbfs thumbnail bytes',
                    video: 'synthetic invalid dbfs video bytes',
                };
                const invalidBytes = '{"synthetic":"invalid"';
                await Promise.all([
                    writeFile(invalidInput, invalidBytes, 'utf8'),
                    writeFile(media.dropLog, mediaContents.dropLog, 'utf8'),
                    writeFile(media.thumbnail, mediaContents.thumbnail, 'utf8'),
                    writeFile(media.video, mediaContents.video, 'utf8'),
                ]);

                const readFileSync = vi.fn(fs.readFileSync);
                const invalidHarness = toolHarness(database.ports);
                const DBTools = await loadTool('DBTools.js', invalidHarness.container, {
                    readFileSync,
                    writeFileSync: fs.writeFileSync,
                });
                const invalidTool = await withProcess(['-m', 'restore', '-o', invalidInput], () => new DBTools());
                const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
                try {
                    await expect(withProcess([], () => invalidTool.run())).rejects.toEqual(
                        expect.objectContaining({ code: 1 }),
                    );
                } finally {
                    consoleError.mockRestore();
                }
                expect(readFileSync).toHaveBeenCalledWith(invalidInput, 'utf-8');
                expect(invalidHarness.dependencies.IConnectionCheckModel.checkDB).toHaveBeenCalledOnce();
                expect(invalidHarness.dependencies.IDBOperator.closeConnection).not.toHaveBeenCalled();
                for (const Entity of Object.values(entities)) {
                    expect(await database.source.getRepository(Entity).count()).toBe(0);
                }
                await expect(readFile(invalidInput, 'utf8')).resolves.toBe(invalidBytes);
                await expect(readFile(media.dropLog, 'utf8')).resolves.toBe(mediaContents.dropLog);
                await expect(readFile(media.thumbnail, 'utf8')).resolves.toBe(mediaContents.thumbnail);
                await expect(readFile(media.video, 'utf8')).resolves.toBe(mediaContents.video);

                const partialBytes = '{"synthetic":"partial"';
                const writeFailure = new Error('synthetic direct write failure');
                const writeFileSync = vi.fn((path: any, _contents: any, options: any) => {
                    expect(path).toBe(partialOutput);
                    expect(options).toEqual({ encoding: 'utf-8' });
                    fs.writeFileSync(partialOutput, partialBytes, { encoding: 'utf-8' });
                    throw writeFailure;
                });
                const writeHarness = toolHarness(database.ports);
                const WriteDBTools = await loadTool('DBTools.js', writeHarness.container, {
                    readFileSync: fs.readFileSync,
                    writeFileSync,
                });
                const writeTool = await withProcess(['-m', 'backup', '-o', partialOutput], () => new WriteDBTools());
                await expect(withProcess([], () => writeTool.run())).rejects.toBe(writeFailure);
                expect(writeFileSync).toHaveBeenCalledOnce();
                expect(writeFileSync.mock.calls[0][0]).toBe(partialOutput);
                expect(writeFileSync.mock.calls[0][1]).toBe(JSON.stringify(JSON.parse(writeFileSync.mock.calls[0][1])));
                expect(writeFileSync.mock.calls[0][2]).toEqual({ encoding: 'utf-8' });
                expect(writeHarness.dependencies.IConnectionCheckModel.checkDB).toHaveBeenCalledOnce();
                expect(writeHarness.dependencies.IDBOperator.closeConnection).not.toHaveBeenCalled();
                await expect(readFile(partialOutput, 'utf8')).resolves.toBe(partialBytes);
            } finally {
                await drainCleanups();
            }
        },
        120_000,
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[MT-2.1-MT-4.13/MT-5.1/MT-5.2] uses actual %s entities, repositories, and transactions for backup, restore, partial commit, and v1 rerun',
        async dialect => {
            try {
                const database = await backend(dialect);
                const directory = database.root;
                const restoreInput = join(directory, 'synthetic-restore.json');
                const backupOutput = join(directory, 'synthetic-backup.json');
                const v1Input = join(directory, 'synthetic-v1.json');
                const document = restoreDocument();
                await writeFile(restoreInput, JSON.stringify(document), 'utf8');

                const restoreHarness = toolHarness(database.ports);
                const DBTools = await loadTool('DBTools.js', restoreHarness.container, fs);
                const restoreTool = await withProcess(['-m', 'restore', '-o', restoreInput], () => new DBTools());
                await restoreTool.restore();
                for (const [name, Entity] of Object.entries(entities)) {
                    expect(await database.source.getRepository(Entity).count(), `${name} restore row count`).toBe(1);
                }
                expect(await database.source.getRepository(entities.Rule).findOneByOrFail({ id: 11 })).toMatchObject({
                    id: 11,
                    keyword: 'synthetic-rule',
                    updateCnt: 12,
                });
                expect(await database.source.getRepository(entities.Reserve).findOneByOrFail({ id: 21 })).toMatchObject(
                    {
                        id: 21,
                        name: 'synthetic-reserve',
                    },
                );
                expect(
                    await database.source.getRepository(entities.RecordedEntity).findOneByOrFail({ id: 41 }),
                ).toMatchObject({
                    id: 41,
                    isProtected: false,
                    isRecording: false,
                    name: 'synthetic-recorded',
                });

                const backupTool = await withProcess(['-m', 'backup', '-o', backupOutput], () => new DBTools());
                await backupTool.backup();
                const backup = JSON.parse(await readFile(backupOutput, 'utf8'));
                expect(Object.keys(backup)).toEqual(Object.keys(versionlessBackup()));
                for (const [name, collection] of Object.entries(backup)) {
                    expect(collection, `${name} backup collection`).toHaveLength(1);
                }
                expect(backup.ruleItems[0]).toMatchObject({ id: 11, updateCnt: 12 });
                expect(backup.recordedItems[0]).not.toHaveProperty('videoFiles');
                expect(backup.recordedItems[0]).not.toHaveProperty('thumbnails');
                expect(backup.recordedItems[0]).not.toHaveProperty('dropLogFile');
                expect(backup.recordedItems[0]).not.toHaveProperty('tags');
                expect(await readFile(restoreInput, 'utf8')).toBe(JSON.stringify(document));

                const partialDocument = restoreDocument();
                partialDocument.ruleItems[0].searchOption.keyword = 'synthetic-partial-rule';
                partialDocument.reserveItems[0].name = 'synthetic-partial-reserve';
                const failure = new Error('synthetic committed recorded-stage failure');
                const failingRecorded = {
                    restore: async (items: unknown) => {
                        await database.ports.IRecordedDB.restore(items);
                        throw failure;
                    },
                };
                const partialHarness = toolHarness({ ...database.ports, IRecordedDB: failingRecorded });
                const PartialDBTools = await loadTool('DBTools.js', partialHarness.container, {
                    readFileSync: vi.fn(() => JSON.stringify(partialDocument)),
                    writeFileSync: vi.fn(),
                });
                const partialTool = await withProcess(
                    ['-m', 'restore', '-o', restoreInput],
                    () => new PartialDBTools(),
                );
                await expect(partialTool.restore()).rejects.toBe(failure);
                expect((await database.source.getRepository(entities.Rule).findOneByOrFail({ id: 11 })).keyword).toBe(
                    'synthetic-partial-rule',
                );
                expect((await database.source.getRepository(entities.Reserve).findOneByOrFail({ id: 21 })).name).toBe(
                    'synthetic-partial-reserve',
                );
                expect(await database.source.getRepository(entities.Thumbnail).count()).toBe(0);

                for (const Entity of Object.values(entities).reverse()) {
                    await database.source.createQueryBuilder().delete().from(Entity).execute();
                }
                await writeFile(v1Input, JSON.stringify(v1Backup()), 'utf8');
                const v1Harness = toolHarness(database.ports);
                const V1Tool = await loadTool('V1MigrationTool.js', v1Harness.container, fs);
                const v1Tool = await withProcess(['-i', v1Input], () => new V1Tool());
                await expect(withProcess([], () => v1Tool.run())).rejects.toEqual(expect.objectContaining({ code: 0 }));
                await expect(withProcess([], () => v1Tool.run())).rejects.toEqual(expect.objectContaining({ code: 0 }));
                expect(await database.source.getRepository(entities.Rule).count()).toBe(2);
                expect(await database.source.getRepository(entities.RecordedEntity).count()).toBe(2);
                expect(await database.source.getRepository(entities.Thumbnail).count()).toBe(2);
                expect(await database.source.getRepository(entities.VideoFile).count()).toBe(4);
                expect(await database.source.getRepository(entities.RecordedHistory).count()).toBe(2);
                expect(await database.source.getRepository(entities.Reserve).count()).toBe(0);
                expect(await database.source.getRepository(entities.DropLogFile).count()).toBe(0);
                expect(await database.source.getRepository(entities.RecordedTag).count()).toBe(0);
                expect(await database.source.getRepository(entities.RecordedEntity).find()).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            isProtected: false,
                            isRecording: false,
                            name: 'synthetic-recorded',
                        }),
                    ]),
                );
                expect(await database.source.getRepository(entities.VideoFile).find()).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ name: 'ts', size: 0, type: 'ts' }),
                        expect.objectContaining({ name: 'synthetic-encoded', size: 7, type: 'encoded' }),
                    ]),
                );
            } finally {
                await drainCleanups();
            }
        },
        120_000,
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[MT-5.1/MT-5.2] keeps %s backup input and rows untouched until DB availability settles',
        async dialect => {
            try {
                const database = await backend(dialect);
                const input = join(database.root, 'synthetic-delayed-restore.json');
                const gate = deferred<void>();
                const readFileSync = vi.fn(fs.readFileSync);
                await writeFile(input, JSON.stringify(restoreDocument()), 'utf8');

                const harness = toolHarness(database.ports, {
                    IConnectionCheckModel: { checkDB: vi.fn(() => gate.promise) },
                });
                const DBTools = await loadTool('DBTools.js', harness.container, {
                    readFileSync,
                    writeFileSync: fs.writeFileSync,
                });
                const tool = await withProcess(['-m', 'restore', '-o', input], () => new DBTools());
                const running = withProcess([], () => tool.run());
                try {
                    await Promise.resolve();

                    expect(harness.dependencies.IConnectionCheckModel.checkDB).toHaveBeenCalledOnce();
                    expect(readFileSync).not.toHaveBeenCalled();
                    for (const Entity of Object.values(entities)) {
                        expect(await database.source.getRepository(Entity).count()).toBe(0);
                    }
                    expect(harness.dependencies.IDBOperator.closeConnection).not.toHaveBeenCalled();
                    expect(harness.log.system.info).not.toHaveBeenCalledWith('--- finish ---');

                    gate.resolve();
                    await expect(running).rejects.toEqual(expect.objectContaining({ code: 0 }));
                    expect(readFileSync).toHaveBeenCalledWith(input, 'utf-8');
                    expect(await database.source.getRepository(entities.Rule).count()).toBe(1);
                    expect(harness.dependencies.IDBOperator.closeConnection).toHaveBeenCalledOnce();
                } finally {
                    gate.resolve();
                    await running.catch(() => undefined);
                }
            } finally {
                await drainCleanups();
            }
        },
        120_000,
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[MT-3.8] routes every %s restore transaction failure through DBTools after release',
        async dialect => {
            try {
                const database = await backend(dialect);
                const input = join(database.root, 'synthetic-r3-8-restore.json');
                const media = {
                    dropLog: join(database.root, 'synthetic-drop.log'),
                    thumbnail: join(database.root, 'synthetic-thumbnail.jpg'),
                    video: join(database.root, 'synthetic-video.ts'),
                };
                const mediaContents = {
                    dropLog: 'synthetic drop log bytes',
                    thumbnail: 'synthetic thumbnail bytes',
                    video: 'synthetic video bytes',
                };
                await Promise.all([
                    writeFile(media.dropLog, mediaContents.dropLog, 'utf8'),
                    writeFile(media.thumbnail, mediaContents.thumbnail, 'utf8'),
                    writeFile(media.video, mediaContents.video, 'utf8'),
                ]);

                for (const fault of [
                    'start',
                    'insert',
                    'commit',
                    'insert-rollback',
                    'release',
                    'release-barrier',
                ] as const) {
                    for (const [index, stage] of restoreStages.entries()) {
                        await clearDatabase(database.source);
                        await writeFile(input, JSON.stringify(mediaDocument(media)), 'utf8');
                        await (await makeRestoreTool(database.ports, input)).restore();

                        const document = mediaDocument(media);
                        const targetBefore = await readStageMarker(database.source, stage);
                        const targetAtStageStart = ['recorded', 'thumbnail', 'video-file'].includes(stage.name)
                            ? null
                            : targetBefore;
                        const targetMarker = `synthetic-${fault}-${stage.name}`;
                        setStageMarker(document, stage, targetMarker);
                        const predecessor = restoreStages[index - 1];
                        const predecessorMarker =
                            predecessor === undefined ? undefined : `synthetic-prior-${fault}-${stage.name}`;
                        if (predecessor !== undefined) setStageMarker(document, predecessor, predecessorMarker!);
                        await writeFile(input, JSON.stringify(document), 'utf8');

                        const lifecycle = injectRestoreFault(database.source, index, fault);
                        let diagnostics: readonly unknown[] = [];
                        try {
                            const tool = await makeRestoreTool(database.ports, input);
                            if (fault !== 'release-barrier') {
                                diagnostics = await expectRestoreError(tool, stage, database.repositoryErrors);
                            } else {
                                const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
                                const recorded = () => [
                                    ...error.mock.calls.flat(),
                                    ...database.repositoryErrors.mock.calls.flat(),
                                ];
                                try {
                                    const restore = startRestore(tool, stage);
                                    await lifecycle.releaseBarrier!.entered.promise;
                                    let settled = false;
                                    const settlement = restore.then(
                                        () => {
                                            settled = true;
                                        },
                                        () => {
                                            settled = true;
                                        },
                                    );
                                    await Promise.resolve();
                                    expect(settled).toBe(false);
                                    expect(lifecycle.events).not.toContain(`${stage.name}:release`);
                                    for (const laterStage of restoreStages.slice(index + 1)) {
                                        expect(lifecycle.events).not.toContain(`${laterStage.name}:start`);
                                    }
                                    lifecycle.releaseBarrier!.proceed.resolve();
                                    await expectRestoreRejection(restore, stage, recorded);
                                    await settlement;
                                    diagnostics = recorded();
                                } finally {
                                    error.mockRestore();
                                }
                            }
                        } finally {
                            lifecycle.restore();
                        }

                        const targetEvents = lifecycle.events.filter(event => event.startsWith(`${stage.name}:`));
                        expect(targetEvents).toEqual(
                            fault === 'start'
                                ? [`${stage.name}:start`, `${stage.name}:release`]
                                : fault === 'insert' || fault === 'insert-rollback'
                                  ? [
                                        `${stage.name}:start`,
                                        `${stage.name}:insert`,
                                        `${stage.name}:rollback`,
                                        `${stage.name}:release`,
                                    ]
                                  : fault === 'commit'
                                    ? [
                                          `${stage.name}:start`,
                                          `${stage.name}:insert`,
                                          `${stage.name}:commit`,
                                          `${stage.name}:rollback`,
                                          `${stage.name}:release`,
                                      ]
                                    : [
                                          `${stage.name}:start`,
                                          `${stage.name}:insert`,
                                          `${stage.name}:commit`,
                                          `${stage.name}:release`,
                                      ],
                        );
                        expect(lifecycle.events.filter(event => event.endsWith(':rollback'))).toHaveLength(
                            ['insert', 'commit', 'insert-rollback'].includes(fault) ? 1 : 0,
                        );
                        expect(lifecycle.events.filter(event => event.endsWith(':release'))).toHaveLength(index + 1);
                        expect(lifecycle.events.filter(event => event.endsWith(':commit'))).toHaveLength(
                            index + (['commit', 'release', 'release-barrier'].includes(fault) ? 1 : 0),
                        );
                        expect(lifecycle.events.filter(event => event.endsWith(':start'))).toHaveLength(index + 1);
                        for (const laterStage of restoreStages.slice(index + 1)) {
                            expect(lifecycle.events).not.toContain(`${laterStage.name}:start`);
                        }
                        if (predecessor !== undefined) {
                            expect(await readStageMarker(database.source, predecessor)).toBe(predecessorMarker);
                        }
                        if (fault === 'insert-rollback') {
                            expect(diagnostics).toContain(lifecycle.errors.primary);
                            expect(diagnostics).toContain(lifecycle.errors.rollback);
                        }
                        expect(await readStageMarker(database.source, stage)).toBe(
                            ['release', 'release-barrier'].includes(fault) ? targetMarker : targetAtStageStart,
                        );
                    }
                }

                await expect(readFile(media.dropLog, 'utf8')).resolves.toBe(mediaContents.dropLog);
                await expect(readFile(media.thumbnail, 'utf8')).resolves.toBe(mediaContents.thumbnail);
                await expect(readFile(media.video, 'utf8')).resolves.toBe(mediaContents.video);
            } finally {
                await drainCleanups();
            }
        },
        120_000,
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[MT-5.2/T-RACE] lets a second restore run to completion while the first is parked and leaves the rows the database wrote last on actual %s',
        async dialect => {
            try {
                const database = await backend(dialect);
                const firstInput = join(database.root, 'synthetic-first-restore.json');
                const secondInput = join(database.root, 'synthetic-second-restore.json');
                const firstDocument = restoreDocument();
                const secondDocument = restoreDocument();
                for (const stage of restoreStages) {
                    setStageMarker(firstDocument, stage, `synthetic-first-${stage.name}`);
                    setStageMarker(secondDocument, stage, `synthetic-second-${stage.name}`);
                }
                await writeFile(firstInput, JSON.stringify(firstDocument), 'utf8');
                await writeFile(secondInput, JSON.stringify(secondDocument), 'utf8');

                // 最初の restore は、最初の種類 (rule) の書込み直前で保留する。
                const gate = deferred<void>();
                const entered = deferred<void>();
                const firstHarness = toolHarness({
                    ...database.ports,
                    IRuleDB: {
                        restore: async (items: unknown) => {
                            entered.resolve();
                            await gate.promise;
                            return database.ports.IRuleDB.restore(items);
                        },
                    },
                });
                const secondHarness = toolHarness(database.ports);
                const FirstTool = await loadTool('DBTools.js', firstHarness.container, fs);
                const SecondTool = await loadTool('DBTools.js', secondHarness.container, fs);
                const firstTool = await withProcess(['-m', 'restore', '-o', firstInput], () => new FirstTool());
                const secondTool = await withProcess(['-m', 'restore', '-o', secondInput], () => new SecondTool());
                const kill = vi.spyOn(process, 'kill');
                const firstRun = withProcess([], () => firstTool.run());
                try {
                    await entered.promise;
                    expect(firstHarness.dependencies.IDBOperator.closeConnection).not.toHaveBeenCalled();

                    // 管理 command 同士を直列にする lock は無いので、保留中の最初を待たずに 2 つ目が完了する。
                    await expect(withProcess([], () => secondTool.run())).rejects.toEqual(
                        expect.objectContaining({ code: 0 }),
                    );
                    for (const stage of restoreStages) {
                        expect(await readStageMarker(database.source, stage)).toBe(`synthetic-second-${stage.name}`);
                    }
                    expect(secondHarness.dependencies.IDBOperator.closeConnection).toHaveBeenCalledOnce();
                    expect(firstHarness.dependencies.IDBOperator.closeConnection).not.toHaveBeenCalled();

                    // 保留を解くと最初が完了し、行は DB に最後に書かれた内容になる。
                    gate.resolve();
                    await expect(firstRun).rejects.toEqual(expect.objectContaining({ code: 0 }));
                    for (const stage of restoreStages) {
                        expect(await readStageMarker(database.source, stage)).toBe(`synthetic-first-${stage.name}`);
                        expect(await database.source.getRepository(entities[stage.entity]).count()).toBe(1);
                    }
                    expect(kill).not.toHaveBeenCalled();
                    const requested = [firstHarness, secondHarness].flatMap(harness =>
                        harness.container.get.mock.calls.map(([name]) => name),
                    );
                    for (const name of requested) {
                        expect(name).toMatch(
                            /^(ILoggerModel|IConfiguration|IConnectionCheckModel|IDBOperator|I\w+DB)$/,
                        );
                    }
                } finally {
                    gate.resolve();
                    await firstRun.catch(() => undefined);
                    kill.mockRestore();
                }
            } finally {
                await drainCleanups();
            }
        },
        120_000,
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[MT-4.12/MT-4.13] keeps rows inserted before a v1 stage failure and starts no later stage on actual %s',
        async dialect => {
            try {
                const database = await backend(dialect);
                const input = join(database.root, 'synthetic-v1-stage-failure.json');
                const itemCount = 3;
                const range = Array.from({ length: itemCount }, (_unused, index) => index);
                await writeFile(
                    input,
                    JSON.stringify(
                        v1Backup({
                            rules: range.map(index => oldRule({ id: index + 1, keyword: `synthetic-rule-${index}` })),
                            recorded: range.map(index =>
                                oldRecorded({
                                    id: 10 + index,
                                    ruleId: index + 1,
                                    name: `synthetic-recorded-${index}`,
                                    recPath: `synthetic-media-${index}.ts`,
                                    thumbnailPath: `synthetic-thumbnail-${index}.jpg`,
                                }),
                            ),
                            encoded: range.map(index => ({
                                recordedId: 10 + index,
                                path: `synthetic-encoded-${index}.mp4`,
                                name: `synthetic-encoded-${index}`,
                                filesize: 7,
                            })),
                            recordedHistory: range.map(index => ({
                                name: `synthetic-history-${index}`,
                                channelId: 2,
                                endAt: 20 + index,
                            })),
                        }),
                    ),
                    'utf8',
                );

                const kinds = ['rule', 'recorded', 'thumbnail', 'original-video', 'encoded-video', 'history'] as const;
                type Kind = (typeof kinds)[number];
                const countRows = async () => ({
                    rule: await database.source.getRepository(entities.Rule).count(),
                    recorded: await database.source.getRepository(entities.RecordedEntity).count(),
                    thumbnail: await database.source.getRepository(entities.Thumbnail).count(),
                    'original-video': await database.source.getRepository(entities.VideoFile).countBy({ type: 'ts' }),
                    'encoded-video': await database.source.getRepository(entities.VideoFile).countBy({
                        type: 'encoded',
                    }),
                    history: await database.source.getRepository(entities.RecordedHistory).count(),
                });
                // 追加の順は、rule、recorded 1 件ごとの recorded・thumbnail・original-video、encoded-video、history。
                // 失敗した 1 件までの試行と、その手前までに成功した件数を、この順から求める。
                const sequence: Kind[] = [
                    ...range.map((): Kind => 'rule'),
                    ...range.flatMap((): Kind[] => ['recorded', 'thumbnail', 'original-video']),
                    ...range.map((): Kind => 'encoded-video'),
                    ...range.map((): Kind => 'history'),
                ];
                const zero = (): Record<Kind, number> => ({
                    rule: 0,
                    recorded: 0,
                    thumbnail: 0,
                    'original-video': 0,
                    'encoded-video': 0,
                    history: 0,
                });
                const expectedAt = (failing: Kind, index: number) => {
                    const attempts = zero();
                    const rows = zero();
                    for (const kind of sequence) {
                        const attempt = attempts[kind]++;
                        if (kind === failing && attempt === index) break;
                        rows[kind]++;
                    }
                    return { attempts, rows };
                };

                for (const failing of kinds) {
                    for (const index of [0, 1, itemCount - 1]) {
                        const label = `${failing} #${index}`;
                        const failure = new Error(`synthetic v1 ${failing} failure at ${index}`);
                        const attempts = zero();
                        const guard = (
                            kind: (value: any) => Kind,
                            port: { insertOnce(value: any): Promise<number> },
                        ) => ({
                            insertOnce: async (value: any) => {
                                const current = kind(value);
                                const attempt = attempts[current]++;
                                if (current === failing && attempt === index) throw failure;
                                return await port.insertOnce(value);
                            },
                        });
                        const harness = toolHarness({
                            ...database.ports,
                            IRuleDB: guard(() => 'rule', database.ports.IRuleDB),
                            IRecordedDB: guard(() => 'recorded', database.ports.IRecordedDB),
                            IThumbnailDB: guard(() => 'thumbnail', database.ports.IThumbnailDB),
                            IVideoFileDB: guard(
                                value => (value.type === 'ts' ? 'original-video' : 'encoded-video'),
                                database.ports.IVideoFileDB,
                            ),
                            IRecordedHistoryDB: guard(() => 'history', database.ports.IRecordedHistoryDB),
                        });
                        const V1Tool = await loadTool('V1MigrationTool.js', harness.container, fs);
                        const tool = await withProcess(['-i', input], () => new V1Tool());

                        await expect(
                            withProcess([], () => tool.run()),
                            label,
                        ).rejects.toBe(failure);

                        const expected = expectedAt(failing, index);
                        expect(await countRows(), label).toEqual(expected.rows);
                        expect(attempts, label).toEqual(expected.attempts);
                        expect(harness.dependencies.IDBOperator.closeConnection, label).not.toHaveBeenCalled();
                        expect(harness.log.system.info, label).not.toHaveBeenCalledWith('--- finish ---');

                        for (const Entity of Object.values(entities).reverse()) {
                            await database.source.createQueryBuilder().delete().from(Entity).execute();
                        }
                    }
                }
            } finally {
                await drainCleanups();
            }
        },
        180_000,
    );
});
