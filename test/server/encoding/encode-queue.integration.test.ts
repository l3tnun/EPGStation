import 'reflect-metadata';

import { spawn, type ChildProcess } from 'node:child_process';
import { link, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as apid from '../../../api';
import type { EncodeQueueRecord } from '../../../src/model/operator/encode/IEncodeQueueStore';
import type { EncodeOption } from '../../../src/model/service/encode/IEncoderModel';
import { createDeferred } from '../harness/async';
import { cleanupInOrder } from '../persistence/harness';
import { MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS, provisionMySql, type MySqlRuntime } from '../persistence/mysql-runtime';
import {
    createRepositoryPersistence,
    loadCompiled,
    type RepositoryDialect,
    type RepositoryPersistence,
} from '../persistence/repository-harness';

/*
 * 依頼の記録（`encode_queue`）の結合 test（design §9.4 の `EN-INTEGRATION-QUEUE-*`）。
 * DB は persistence の共有 fixture（SQLite の一時 file と MySQL の container）、IPC は実際の子 process の
 * `IPCClient` と親の `IPCServer` を使う。
 */

interface EncodeQueueStoreRuntime {
    add(option: apid.AddEncodeProgramOption, requestToken?: string): Promise<number>;
    abandon(requestToken: string): Promise<void>;
    updateOutputPath(encodeId: number, outputPath: string): Promise<void>;
    remove(encodeId: number): Promise<void>;
    list(): Promise<EncodeQueueRecord[]>;
}

interface EncodeQueueRow {
    id: number;
    option: string;
    outputPath: string | null;
    createdAt: number;
}

interface EncodeManageRuntime {
    restore(): Promise<void>;
    getEncodeInfo(): {
        runningQueue: Array<{ id: number; recordedId: number }>;
        waitQueue: Array<{ id: number; recordedId: number }>;
    };
}

const EncodeQueueStore = loadCompiled<new (logger: unknown, db: unknown) => EncodeQueueStoreRuntime>(
    'model/operator/encode/EncodeQueueStore.js',
);
const EncodeManageModel = loadCompiled<
    (new (...args: unknown[]) => EncodeManageRuntime) & { isSameFile(a: string, b: string): Promise<boolean> }
>('model/service/encode/EncodeManageModel.js');
const FileUtil = loadCompiled<{ unlink(filePath: string): Promise<void> }>('util/FileUtil.js');
const IPCServer = loadCompiled<new (...args: unknown[]) => IPCServerRuntime>('model/ipc/IPCServer.js');

interface IPCServerRuntime {
    register(child: ChildProcess): void;
    setEncode(option: apid.AddEncodeProgramOption): void;
}

const MAX = Number.MAX_SAFE_INTEGER;

const option = (recordedId: number, parentDir = 'synthetic-parent'): apid.AddEncodeProgramOption => ({
    recordedId,
    sourceVideoFileId: recordedId * 10,
    parentDir,
    directory: `synthetic-directory-${recordedId}`,
    mode: 'synthetic-mode',
    removeOriginal: false,
});

const makeLoggerModel = () => {
    const logger = {
        access: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
        encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
        stream: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
        system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
    };
    return { logger, loggerModel: { getLogger: () => logger } };
};

const queueDB = (fixture: RepositoryPersistence) =>
    fixture.db.EncodeQueueDB as unknown as {
        insertOnce(row: EncodeQueueRow): Promise<void>;
        findAll(): Promise<EncodeQueueRow[]>;
    };

let mysqlRuntime: MySqlRuntime | undefined;

beforeAll(async () => {
    mysqlRuntime = await provisionMySql();
}, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

// 末尾の case で container を外す。ここは、その case が走らなかった（絞り込み・中断）ときの軽い fallback。
afterAll(async () => {
    await cleanupInOrder([async () => mysqlRuntime?.cleanup()]);
});

const withPersistence = async (
    dialect: RepositoryDialect,
    run: (fixture: RepositoryPersistence) => Promise<void>,
): Promise<void> => {
    const fixture = await createRepositoryPersistence(dialect, dialect === 'mysql' ? mysqlRuntime : undefined);
    try {
        await run(fixture);
    } catch (error) {
        if (error instanceof Error) error.message = `[${dialect}] ${error.message}`;
        throw error;
    } finally {
        await fixture.cleanup();
    }
};

const dialects: readonly RepositoryDialect[] = ['sqlite', 'mysql'];
const dbCaseTimeout = 60_000;

describe('encode request records over a real database (EN-INTEGRATION-QUEUE-DB / -RELOAD)', () => {
    it.each(dialects)(
        '[EN-INTEGRATION-QUEUE-DB] keeps the row values through add, updateOutputPath, remove, list and abandon on %s',
        async dialect => {
            await withPersistence(dialect, async fixture => {
                const db = queueDB(fixture);
                const { logger, loggerModel } = makeLoggerModel();
                // 最大安全整数の識別番号の記録を先に置く。次の割当ては最大値の次の 1 になる。
                await db.insertOnce({
                    id: MAX,
                    option: JSON.stringify(option(1)),
                    outputPath: null,
                    createdAt: 1_700_000_000_001,
                });
                const store = new EncodeQueueStore(loggerModel, db);

                await expect(store.add(option(2), 'synthetic-token-2')).resolves.toBe(1);
                await expect(store.add(option(3))).resolves.toBe(2);
                await expect(store.add(option(4), 'synthetic-token-4')).resolves.toBe(3);
                await store.updateOutputPath(MAX, 'synthetic-output/encoded-max.mp4');
                await store.updateOutputPath(1, 'synthetic-output/encoded-1.mp4');

                const listed = await store.list();
                expect(listed.map(record => record.id)).toEqual([MAX, 1, 2, 3]);
                expect(listed).toEqual([
                    {
                        id: MAX,
                        option: option(1),
                        outputPath: 'synthetic-output/encoded-max.mp4',
                        createdAt: 1_700_000_000_001,
                    },
                    {
                        id: 1,
                        option: option(2),
                        outputPath: 'synthetic-output/encoded-1.mp4',
                        createdAt: expect.any(Number),
                    },
                    { id: 2, option: option(3), outputPath: null, createdAt: expect.any(Number) },
                    { id: 3, option: option(4), outputPath: null, createdAt: expect.any(Number) },
                ]);
                const rows = await db.findAll();
                expect(rows).toEqual(
                    [listed[1], listed[2], listed[3], listed[0]].map(record => ({
                        id: record.id,
                        option: JSON.stringify(record.option),
                        outputPath: record.outputPath,
                        createdAt: record.createdAt,
                    })),
                );

                // 存在しない識別番号の更新・削除は、ほかの行を変えない。
                await expect(store.updateOutputPath(404, 'synthetic-output/missing.mp4')).resolves.toBeUndefined();
                await expect(store.remove(404)).resolves.toBeUndefined();
                await expect(store.abandon('synthetic-unknown-token')).resolves.toBeUndefined();
                await expect(db.findAll()).resolves.toEqual(rows);

                // 削除と、要求ごとの値による取消し。
                await store.remove(2);
                await store.abandon('synthetic-token-4');
                await expect(db.findAll()).resolves.toEqual([rows[0], rows[3]]);
                await expect(store.list()).resolves.toEqual([listed[0], listed[1]]);
                expect(logger.encode.error).not.toHaveBeenCalled();
            });
        },
        dbCaseTimeout,
    );

    it.each(dialects)(
        '[EN-INTEGRATION-QUEUE-RELOAD] lists records across the maximum id in acceptance order after the store is rebuilt on %s',
        async dialect => {
            await withPersistence(dialect, async fixture => {
                const db = queueDB(fixture);
                const { logger, loggerModel } = makeLoggerModel();
                await db.insertOnce({
                    id: MAX - 1,
                    option: JSON.stringify(option(11)),
                    outputPath: 'synthetic-output/encoded-11.mp4',
                    createdAt: 1_700_000_000_011,
                });
                const first = new EncodeQueueStore(loggerModel, db);
                await expect(first.add(option(12))).resolves.toBe(MAX);
                await expect(first.add(option(13))).resolves.toBe(1);
                await expect(first.add(option(14))).resolves.toBe(2);
                await first.updateOutputPath(1, 'synthetic-output/encoded-13.mp4');
                const before = await first.list();
                const rowsBefore = await db.findAll();
                expect(rowsBefore.map(row => row.id)).toEqual([1, 2, MAX - 1, MAX]);

                const rebuilt = new EncodeQueueStore(loggerModel, db);
                const listed = await rebuilt.list();
                expect(listed.map(record => record.id)).toEqual([MAX - 1, MAX, 1, 2]);
                expect(listed).toEqual(before);
                expect(listed.map(record => record.option.recordedId)).toEqual([11, 12, 13, 14]);
                expect(listed[2].outputPath).toBe('synthetic-output/encoded-13.mp4');
                await expect(db.findAll()).resolves.toEqual(rowsBefore);

                // 次の識別番号は最後に受け付けた 2 の次に続く。
                await expect(rebuilt.add(option(15))).resolves.toBe(3);
                await expect(rebuilt.list()).resolves.toEqual([
                    ...before,
                    { id: 3, option: option(15), outputPath: null, createdAt: expect.any(Number) },
                ]);
                expect((await db.findAll()).map(row => row.id)).toEqual([1, 2, 3, MAX - 1, MAX]);
                expect(logger.encode.error).not.toHaveBeenCalled();
            });
        },
        dbCaseTimeout,
    );
});

/*
 * 子 process（Web・API 側処理の代わり）。compile 済みの `IPCClient` を作り、親からの命令で `encodeQueue` の
 * 操作を送り、結果と `pushEncode` の受け取り（`pushPersisted`）を標準出力の JSON 行で知らせる。
 */
const childProgram = String.raw`
const { join } = require('node:path');
require('reflect-metadata');

const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (typeof snapshot !== 'string' || typeof process.send !== 'function') process.exit(90);

const observe = (event, values = {}) =>
    process.stdout.write(JSON.stringify({ testControl: 'observation', event, ...values }) + '\n');
const IPCClient = require(join(snapshot, 'model/ipc/IPCClient.js')).default;
const logger = {
    system: {
        error: value => observe('log', { value: String(value) }),
        fatal: value => observe('log', { value: String(value) }),
        info: () => undefined,
    },
};
const client = new IPCClient(
    { getLogger: () => logger },
    { notifyClient: () => undefined },
    {
        push: value => observe('push', { value }),
        pushPersisted: async (encodeId, value) => observe('pushPersisted', { encodeId, value }),
    },
);

process.on('message', message => {
    if (!message || message.testControl !== 'command') return;
    switch (message.kind) {
        case 'encodeQueue':
            client.encodeQueue[message.func](...message.args).then(
                value => observe('settled', { key: message.key, status: 'resolved', value }),
                error => observe('settled', { error: error.message, key: message.key, status: 'rejected' }),
            );
            return;
        case 'state':
            observe('state', { key: message.key, pending: client.pending.size, retired: client.retired.size });
            return;
        case 'shutdown':
            process.exit(0);
    }
});
observe('ready');
`;

interface Observation {
    readonly event: string;
    readonly [key: string]: unknown;
}

interface ObservationWaiter {
    readonly predicate: (observation: Observation) => boolean;
    readonly resolve: (observation: Observation) => void;
    readonly reject: (error: Error) => void;
}

const activeChildren = new Set<QueueChild>();

class QueueChild {
    public readonly observations: Observation[] = [];
    private readonly waiters = new Set<ObservationWaiter>();
    private stdoutBuffer = '';
    private stderrText = '';
    private exited = false;

    public constructor(public readonly child: ChildProcess) {
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', this.onStdout);
        child.stderr?.on('data', this.onStderr);
        child.once('exit', this.onExit);
    }

    public waitFor(event: string, predicate: (observation: Observation) => boolean = () => true): Promise<Observation> {
        const matches = (observation: Observation) => observation.event === event && predicate(observation);
        const observed = this.observations.find(matches);
        if (observed !== undefined) return Promise.resolve(observed);
        if (this.exited) return Promise.reject(this.exitError());
        return new Promise((resolve, reject) => this.waiters.add({ predicate: matches, reject, resolve }));
    }

    public command(command: Record<string, unknown>): Promise<void> {
        return new Promise((resolve, reject) => {
            this.child.send({ testControl: 'command', ...command }, error => (error ? reject(error) : resolve()));
        });
    }

    public async call(key: string, func: string, args: unknown[]): Promise<Observation> {
        await this.command({ kind: 'encodeQueue', key, func, args });
        return this.waitFor('settled', observation => observation.key === key);
    }

    public async state(key: string): Promise<Observation> {
        await this.command({ kind: 'state', key });
        return this.waitFor('state', observation => observation.key === key);
    }

    public async stop(): Promise<void> {
        if (this.child.exitCode === null && this.child.signalCode === null) {
            const exited = new Promise<void>(resolve => this.child.once('exit', () => resolve()));
            if (this.child.connected) this.child.send({ testControl: 'command', kind: 'shutdown' });
            else this.child.kill('SIGTERM');
            await exited;
        }
        this.release();
    }

    /** 軽い fallback。まだ終わっていなければ強制終了し、listener と stdio を外す。 */
    public forceRelease(): void {
        if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
        this.release();
    }

    private release(): void {
        this.child.stdout?.removeListener('data', this.onStdout);
        this.child.stderr?.removeListener('data', this.onStderr);
        this.child.removeListener('exit', this.onExit);
        this.child.stdout?.destroy();
        this.child.stderr?.destroy();
        activeChildren.delete(this);
    }

    private readonly onStdout = (chunk: string): void => {
        this.stdoutBuffer += chunk;
        let newline = this.stdoutBuffer.indexOf('\n');
        while (newline >= 0) {
            const line = this.stdoutBuffer.slice(0, newline);
            this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
            newline = this.stdoutBuffer.indexOf('\n');
            let parsed: unknown;
            try {
                parsed = JSON.parse(line);
            } catch {
                continue;
            }
            const record = parsed as Record<string, unknown>;
            if (record.testControl !== 'observation' || typeof record.event !== 'string') continue;
            const observation = record as unknown as Observation;
            this.observations.push(observation);
            for (const waiter of [...this.waiters]) {
                if (!waiter.predicate(observation)) continue;
                this.waiters.delete(waiter);
                waiter.resolve(observation);
            }
        }
    };

    private readonly onStderr = (chunk: string): void => {
        this.stderrText += chunk;
    };

    private readonly onExit = (): void => {
        this.exited = true;
        const error = this.exitError();
        for (const waiter of this.waiters) waiter.reject(error);
        this.waiters.clear();
    };

    private exitError(): Error {
        return new Error(
            `queue child exited before the observation: ${this.child.exitCode}/${this.child.signalCode} ${this.stderrText}`,
        );
    }
}

const startQueueChild = async (): Promise<QueueChild> => {
    const child = spawn(process.execPath, ['-e', childProgram], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const harness = new QueueChild(child);
    activeChildren.add(harness);
    await harness.waitFor('ready');
    return harness;
};

afterEach(() => {
    for (const child of [...activeChildren]) child.forceRelease();
});

const makeIPCServer = (store: EncodeQueueStoreRuntime, loggerModel: unknown) =>
    new IPCServer(
        {},
        {},
        {},
        { cancelForDeletion: async () => undefined, hasReserve: () => false },
        {},
        {},
        loggerModel,
        {
            adopt: async () => {
                throw new Error('UploadAdoptionNotComposed');
            },
        },
        store,
    );

describe('encode request record operations over a real child IPC channel (EN-INTEGRATION-QUEUE-IPC)', () => {
    it(
        '[EN-INTEGRATION-QUEUE-IPC] delivers add, updateOutputPath, remove, list and abandon to the real store and returns its reject',
        async () => {
            await withPersistence('sqlite', async fixture => {
                const db = queueDB(fixture);
                const { logger, loggerModel } = makeLoggerModel();
                const store = new EncodeQueueStore(loggerModel, db);
                const server = makeIPCServer(store, loggerModel);
                const queueChild = await startQueueChild();
                try {
                    server.register(queueChild.child);

                    await expect(
                        queueChild.call('add-1', 'add', [option(21), 'synthetic-token-21']),
                    ).resolves.toMatchObject({
                        status: 'resolved',
                        value: 1,
                    });
                    await expect(
                        queueChild.call('add-2', 'add', [option(22), 'synthetic-token-22']),
                    ).resolves.toMatchObject({
                        status: 'resolved',
                        value: 2,
                    });
                    await expect(
                        queueChild.call('update-1', 'updateOutputPath', [1, 'synthetic-output/encoded-21.mp4']),
                    ).resolves.toMatchObject({ status: 'resolved' });
                    await expect(queueChild.call('remove-2', 'remove', [2])).resolves.toMatchObject({
                        status: 'resolved',
                    });
                    await expect(
                        queueChild.call('add-3', 'add', [option(23), 'synthetic-token-23']),
                    ).resolves.toMatchObject({
                        status: 'resolved',
                        value: 3,
                    });
                    await expect(
                        queueChild.call('abandon-3', 'abandon', ['synthetic-token-23']),
                    ).resolves.toMatchObject({
                        status: 'resolved',
                    });
                    const listed = await queueChild.call('list', 'list', []);
                    expect(listed).toMatchObject({ status: 'resolved' });
                    expect(listed.value).toEqual([
                        {
                            id: 1,
                            option: option(21),
                            outputPath: 'synthetic-output/encoded-21.mp4',
                            createdAt: expect.any(Number),
                        },
                    ]);
                    const record = (listed.value as EncodeQueueRecord[])[0];
                    await expect(db.findAll()).resolves.toEqual([
                        {
                            id: 1,
                            option: JSON.stringify(option(21)),
                            outputPath: 'synthetic-output/encoded-21.mp4',
                            createdAt: record.createdAt,
                        },
                    ]);

                    // 録画完了の依頼は、親が記録してから識別番号付きで子へ渡す。
                    expect(server.setEncode(option(24))).toBeUndefined();
                    await expect(queueChild.waitFor('pushPersisted')).resolves.toMatchObject({
                        encodeId: 4,
                        value: option(24),
                    });
                    const rowsAfterPush = await db.findAll();
                    expect(rowsAfterPush.map(row => [row.id, JSON.parse(row.option)])).toEqual([
                        [1, option(21)],
                        [4, option(24)],
                    ]);

                    // 窓口の reject（DB の主キー違反）は子へ返り、ほかの行は変わらない。
                    await db.insertOnce({
                        id: 5,
                        option: JSON.stringify(option(25)),
                        outputPath: null,
                        createdAt: 1_700_000_000_025,
                    });
                    const rowsBeforeReject = await db.findAll();
                    const rejected = await queueChild.call('add-conflict', 'add', [option(26), 'synthetic-token-26']);
                    expect(rejected).toMatchObject({ status: 'rejected', error: expect.stringMatching(/UNIQUE/u) });
                    await expect(db.findAll()).resolves.toEqual(rowsBeforeReject);

                    // 応答の待ちが残らない。
                    await expect(queueChild.state('final')).resolves.toMatchObject({ pending: 0, retired: 0 });
                    expect(queueChild.observations.filter(observation => observation.event === 'log')).toEqual([]);
                    expect(logger.system.error).not.toHaveBeenCalled();
                } finally {
                    await queueChild.stop();
                }
                expect(queueChild.child.connected).toBe(false);
                expect(queueChild.child.listenerCount('message')).toBe(0);
            });
        },
        dbCaseTimeout,
    );
});

/** 録画済み番組（fake）。録画ファイルは識別番号と親保存先からの相対 path を持つ。 */
type RecordedFiles = Record<number, Array<{ id: number; filePath: string }>>;

interface SyntheticEncoder {
    option: EncodeOption | null;
}

const restoreScenario = async (removeInterruptedOutput: boolean) => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-encode-queue-restore-'));
    const fixture = await createRepositoryPersistence('sqlite').catch(async (error: unknown) => {
        await rm(root, { force: true, recursive: true });
        throw error;
    });
    try {
        const parentDir = join(root, 'synthetic-parent');
        await mkdir(parentDir);
        const interrupted = join(parentDir, 'interrupted-32.mp4');
        const registered = join(parentDir, 'registered-33.mp4');
        const converted = join(parentDir, 'converted-33.mp4');
        await writeFile(interrupted, 'synthetic-interrupted');
        await writeFile(registered, 'synthetic-registered');
        // 登録済みの file と同じ実体を別の名前で指す（path の比較では一致せず、実体の比較で一致する）。
        await link(registered, converted);

        const db = queueDB(fixture);
        const { logger, loggerModel } = makeLoggerModel();
        await db.insertOnce({
            id: MAX,
            option: JSON.stringify(option(30)),
            outputPath: null,
            createdAt: 1_700_000_000_030,
        });
        const store = new EncodeQueueStore(loggerModel, db);
        expect(await store.add(option(31))).toBe(1);
        expect(await store.add(option(32))).toBe(2);
        expect(await store.add(option(33))).toBe(3);
        expect(await store.add(option(34))).toBe(4);
        await store.updateOutputPath(2, interrupted);
        await store.updateOutputPath(3, converted);
        // 記録の窓口を作り直す（起動し直した管理側に相当する）。
        const restartedStore = new EncodeQueueStore(loggerModel, db);

        const recordedFiles: RecordedFiles = {
            30: [{ id: 300, filePath: 'source-30.m2ts' }],
            31: [{ id: 310, filePath: 'source-31.m2ts' }],
            32: [{ id: 320, filePath: 'source-32.m2ts' }],
            33: [
                { id: 330, filePath: 'source-33.m2ts' },
                { id: 331, filePath: 'registered-33.mp4' },
            ],
            // 34 の録画済み番組は無い。
        };
        const findId = vi.fn(async (recordedId: number) =>
            recordedFiles[recordedId] === undefined
                ? null
                : { id: recordedId, videoFiles: recordedFiles[recordedId].map(file => ({ ...file })) },
        );
        const isSameFile = vi.fn((a: string, b: string) => EncodeManageModel.isSameFile(a, b));
        const removeFile = vi.fn((filePath: string) => FileUtil.unlink(filePath));
        const restoreDependencies = {
            recordedDB: { findId },
            videoUtil: {
                getFullFilePathFromVideoFile: (file: { filePath: string }) => join(parentDir, file.filePath),
                getParentDirPath: (name: string) => (name === 'synthetic-parent' ? parentDir : null),
            },
            isSameFile,
            removeFile,
        };

        const encoders: SyntheticEncoder[] = [];
        const firstStarted = createDeferred<number>();
        const provider = vi.fn(async () => {
            const encoder: SyntheticEncoder & Record<string, unknown> = {
                option: null,
                cancel: vi.fn(async () => undefined),
                getEncodeId: () => encoder.option?.encodeId ?? null,
                getEncodeOption: () => encoder.option,
                getProgressInfo: () => null,
                setOnFinish: vi.fn(),
                setOption: (value: EncodeOption) => {
                    encoder.option = value;
                },
                start: vi.fn(async () => {
                    firstStarted.resolve(encoder.option?.encodeId ?? 0);
                }),
            };
            encoders.push(encoder);
            return encoder;
        });
        const acquired: number[] = [];
        const resourceUse = {
            acquire: vi.fn(async (recordedId: number) => {
                acquired.push(recordedId);
                return { token: {} };
            }),
            release: vi.fn(async () => undefined),
        };
        const encodeEvent = {
            emitAddEncode: vi.fn(),
            emitCancelEncode: vi.fn(),
            emitErrorEncode: vi.fn(),
            emitFinishEncode: vi.fn(),
            emitUpdateEncodeProgress: vi.fn(),
        };
        const manage = new EncodeManageModel(
            loggerModel,
            {
                getConfig: () => ({
                    concurrentEncodeNum: 1,
                    encodeRemoveInterruptedOutput: removeInterruptedOutput,
                }),
            },
            { getExecution: vi.fn(async () => 'synthetic-execution'), unLockExecution: vi.fn() },
            provider,
            encodeEvent,
            resourceUse,
            undefined,
            restartedStore,
            restoreDependencies,
        );

        await manage.restore();
        // 復元後の待機列確認で、先頭の 1 件だけが開始される。
        await expect(firstStarted.promise).resolves.toBe(MAX);

        return {
            acquired,
            converted,
            db,
            encoders,
            interrupted,
            isSameFile,
            logger,
            manage,
            registered,
            removeFile,
            restartedStore,
            cleanup: () => cleanupInOrder([() => fixture.cleanup(), () => rm(root, { force: true, recursive: true })]),
        };
    } catch (error) {
        await cleanupInOrder([() => fixture.cleanup(), () => rm(root, { force: true, recursive: true })]);
        throw error;
    }
};

const exists = (filePath: string): Promise<boolean> =>
    stat(filePath).then(
        () => true,
        () => false,
    );

describe('restoring encode requests from the real database (EN-INTEGRATION-QUEUE-RESTORE)', () => {
    it(
        '[EN-INTEGRATION-QUEUE-RESTORE] returns records to the wait queue in acceptance order and deletes an unregistered interrupted output',
        async () => {
            const scenario = await restoreScenario(true);
            try {
                // 受け付け順（MAX → 1 → 2）に戻し、先頭が実行中、残りが待機中になる。
                expect(scenario.encoders.map(encoder => encoder.option?.encodeId)).toEqual([MAX, 1, 2]);
                expect(scenario.acquired).toEqual([30, 31, 32]);
                expect(scenario.manage.getEncodeInfo()).toEqual({
                    runningQueue: [{ id: MAX, mode: 'synthetic-mode', recordedId: 30 }],
                    waitQueue: [
                        { id: 1, mode: 'synthetic-mode', recordedId: 31 },
                        { id: 2, mode: 'synthetic-mode', recordedId: 32 },
                    ],
                });

                // 未登録の途中出力は削除し、登録済みの file（同じ実体）は残して記録だけを消す。
                expect(scenario.removeFile.mock.calls).toEqual([[scenario.interrupted]]);
                await expect(exists(scenario.interrupted)).resolves.toBe(false);
                expect(scenario.isSameFile).toHaveBeenCalledWith(scenario.registered, scenario.converted);
                await expect(exists(scenario.registered)).resolves.toBe(true);
                await expect(exists(scenario.converted)).resolves.toBe(true);

                // 変換済みの記録（3）と録画済み番組が無い記録（4）は DB から消える。
                expect((await scenario.db.findAll()).map(row => row.id)).toEqual([1, 2, MAX]);
                expect((await scenario.restartedStore.list()).map(record => record.id)).toEqual([MAX, 1, 2]);
                expect(scenario.logger.encode.error).toHaveBeenCalledWith(
                    expect.stringContaining('recorded program or the source file is missing: 4'),
                );
            } finally {
                await scenario.cleanup();
            }
        },
        dbCaseTimeout,
    );

    it(
        '[EN-INTEGRATION-QUEUE-RESTORE] keeps the interrupted output when encodeRemoveInterruptedOutput is false',
        async () => {
            const scenario = await restoreScenario(false);
            try {
                expect(scenario.encoders.map(encoder => encoder.option?.encodeId)).toEqual([MAX, 1, 2]);
                expect(scenario.removeFile).not.toHaveBeenCalled();
                await expect(exists(scenario.interrupted)).resolves.toBe(true);
                await expect(exists(scenario.registered)).resolves.toBe(true);
                await expect(exists(scenario.converted)).resolves.toBe(true);
                expect((await scenario.db.findAll()).map(row => [row.id, row.outputPath])).toEqual([
                    [1, null],
                    [2, scenario.interrupted],
                    [MAX, null],
                ]);
            } finally {
                await scenario.cleanup();
            }
        },
        dbCaseTimeout,
    );
});

// MySQL の container は、作ったときと同じ時間の上限を持つ独立した case で外す（hook の既定の 10 秒では
// Docker の daemon が忙しいときに足りない）。
it(
    'releases the isolated MySQL fixture container after every case of the file',
    async () => {
        await cleanupInOrder([async () => mysqlRuntime?.cleanup()]);
    },
    MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS,
);
