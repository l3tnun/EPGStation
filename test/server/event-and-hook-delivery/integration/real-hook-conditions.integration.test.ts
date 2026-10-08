import 'reflect-metadata';

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync, unwatchFile, watchFile } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    createRepositoryPersistence,
    loadCompiledDefault,
    type RepositoryPersistence,
} from '../../persistence/repository-harness';
import {
    makeLogger,
    makeRecorded,
    makeReserve,
    makeSetter,
    OperatorEncodeEvent,
    PromiseQueue,
    RecordingEvent,
    ReserveEvent,
} from '../_harness';

/*
 * hook の外部 command を、実の子 process・実の設定の再読込（config.yml の実 file）・実 SQLite・実の event と setter・実の
 * log4js の出力 file・実時計で確かめる。時間の長い条件（300 秒の既定値）だけは、時計の部品（vitest の fake timer）で
 * model の timer だけを進め、子 process は実物のままにする。
 */

const require = createRequire(join(process.cwd(), 'package.json'));
const realChildProcess = require('child_process') as { spawn: (...args: any[]) => any };
const realSpawn = realChildProcess.spawn;
const realSetTimeout = setTimeout;
const spawnStub = vi.fn((...args: any[]) => realSpawn(...args));
let ExternalCommandManageModelCtor: (new (...args: any[]) => any) | undefined;

const recorderFixture = join(process.cwd(), 'test/server/fixtures/event-and-hook-delivery/hook-recorder.cjs');
const grandchildFixture = join(process.cwd(), 'test/server/fixtures/event-and-hook-delivery/grandchild-command.cjs');
const ignoreSigintFixture = join(
    process.cwd(),
    'test/server/fixtures/event-and-hook-delivery/ignore-sigint-command.cjs',
);
const captureFixture = join(process.cwd(), 'test/server/fixtures/event-and-hook-delivery/capture-command.cjs');
const templatePath = join(process.cwd(), 'config', 'config.yml.template');

const Configuration = loadCompiledDefault<any>('model/Configuration.js') as unknown as new (
    logger: { getLogger(): Record<string, unknown> },
    access: Record<string, unknown>,
) => { getConfig(): Record<string, any> };
const LoggerModel = loadCompiledDefault<any>('model/LoggerModel.js') as unknown as new () => {
    getLogger(): any;
    initialize(filePath?: string): void;
};
const VideoUtil = loadCompiledDefault<any>('model/api/video/VideoUtil.js') as unknown as new (
    ...args: any[]
) => unknown;

beforeAll(async () => {
    const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
    if (snapshot === undefined || !isAbsolute(snapshot)) throw new Error('The compiled server snapshot is required');
    const modelPath = join(snapshot, 'model', 'operator', 'externalCommand', 'ExternalCommandManageModel.js');
    const childProcessMock = { spawn: spawnStub };
    vi.doMock('child_process', () => childProcessMock);
    vi.doMock('node:child_process', () => childProcessMock);
    try {
        vi.resetModules();
        const imported = (await import(modelPath)) as { default: new (...args: any[]) => any };
        ExternalCommandManageModelCtor = imported.default;
    } finally {
        vi.doUnmock('child_process');
        vi.doUnmock('node:child_process');
    }
});

afterAll(() => {
    ExternalCommandManageModelCtor = undefined;
});

const temporaryRoots: string[] = [];
const cleanups: Array<() => Promise<void> | void> = [];
const spawnedPids = new Set<number>();

afterEach(async () => {
    vi.useRealTimers();
    spawnStub.mockImplementation((...args: any[]) => realSpawn(...args));
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    for (const pid of spawnedPids) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // already gone
        }
    }
    spawnedPids.clear();
    for (const root of temporaryRoots.splice(0)) await rm(root, { force: true, recursive: true });
});

const sleep = (ms: number): Promise<void> => new Promise(resolve => realSetTimeout(resolve, ms));
const readLines = async (path: string): Promise<string[]> =>
    (await readFile(path, 'utf8').catch(() => '')).split('\n').filter(line => line !== '');
const isAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};
const startedPids = (lines: readonly string[]): number[] =>
    lines.filter(line => line.startsWith('started:')).map(line => Number(line.split(':')[1]));

interface KillCall {
    readonly at: number;
    readonly pid: number;
    readonly signal: NodeJS.Signals | number | undefined;
}

/** spawn した実の子の kill() を記録する。swallow なら signal を子へ届けず、終了しない子を作る。 */
const observeKills = (options: { swallow?: boolean } = {}) => {
    const calls: KillCall[] = [];
    const children: any[] = [];
    spawnStub.mockImplementation((...args: any[]) => {
        const child = realSpawn(...args);
        children.push(child);
        if (Number.isSafeInteger(child.pid)) spawnedPids.add(child.pid);
        const kill = child.kill.bind(child);
        child.kill = (signal?: NodeJS.Signals | number) => {
            calls.push({ at: Date.now(), pid: child.pid, signal });
            return options.swallow === true ? true : kill(signal);
        };
        return child;
    });
    return { calls, children };
};

/** 設定と同じ形の config を、実の Configuration（実 config.yml・実の file 監視）で読む。 */
const makeRealConfiguration = async (hookLines: readonly string[]) => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-synthetic-hook-'));
    temporaryRoots.push(root);
    const configPath = join(root, 'config.yml');
    const body = (lines: readonly string[]): string =>
        [
            'port: 8888',
            "recorded: [{ name: 'synthetic-hook', path: '%ROOT%/recorded' }]",
            "thumbnail: '%ROOT%/thumbnail'",
            "streamFilePath: '%ROOT%/streamfiles'",
            'stream: { live: { ts: {} }, recorded: { ts: {}, encoded: {} } }',
            ...lines,
            '',
        ].join('\n');
    await writeFile(configPath, body(hookLines), 'utf8');
    const logger = makeLogger();
    const access = {
        configPath,
        templatePath,
        readSync: (path: string) => readFileSync(path, 'utf8'),
        read: async (path: string) => readFile(path, 'utf8'),
        watch: (path: string, listener: () => void) => watchFile(path, { interval: 50 }, listener),
        unwatch: (path: string, listener: () => void) => unwatchFile(path, listener),
    };
    const configuration = new Configuration({ getLogger: () => logger }, access);
    cleanups.push(() => unwatchFile(configPath));
    const rewrite = async (lines: readonly string[]) => {
        const reloaded = logger.system.info.mock.calls.filter(([text]) => text === 'updated config file').length;
        // 前回の更新と mtime が同じにならないよう、少し待ってから書き換える
        await sleep(30);
        await writeFile(configPath, body(lines), 'utf8');
        await vi.waitFor(
            () =>
                expect(
                    logger.system.info.mock.calls.filter(([text]) => text === 'updated config file').length,
                ).toBeGreaterThan(reloaded),
            { timeout: 8_000, interval: 25 },
        );
    };
    return { configuration, logger, rewrite };
};

const makeModel = (
    configuration: { getConfig(): unknown },
    options: {
        channelDB?: unknown;
        logger?: ReturnType<typeof makeLogger>;
        queue?: unknown;
        recordedDB?: unknown;
        videoUtil?: unknown;
    } = {},
) => {
    if (ExternalCommandManageModelCtor === undefined) throw new Error('ExternalCommandManageModelCtor not ready');
    const logger = options.logger ?? makeLogger();
    const model = new ExternalCommandManageModelCtor(
        { getLogger: () => logger },
        configuration,
        options.queue ?? new PromiseQueue(),
        options.channelDB ?? {
            findId: vi.fn(async () => ({ halfWidthName: 'synthetic-half', name: 'synthetic-channel' })),
        },
        options.recordedDB ?? { findId: vi.fn() },
        options.videoUtil ?? { getFullFilePathFromId: vi.fn(async () => null) },
    );
    return { logger, model };
};

const staticConfiguration = (values: Record<string, unknown>) => ({
    getConfig: () => ({
        dropLog: 'synthetic-drop-root',
        hookCommandMaxPending: 64,
        hookCommandTimeoutMs: 10_000,
        ...values,
    }),
});

const recorderCommand = (log: string, mode = 'record'): string =>
    `${process.execPath} ${recorderFixture} ${log} ${mode}`;

// --- 実 SQLite・実の event と setter から hook の 9 種を起こす土台 ------------------------------------------------

const channelRow = (id: number) => ({
    id,
    serviceId: id,
    networkId: 1,
    name: `synthetic-channel-${id}`,
    remoteControlKeyId: id,
    hasLogoData: false,
    channel: { type: 'GR', channel: `synthetic-${id}` },
    type: 1,
});

const HOOK_KEYS = [
    'reserveNewAddtionCommand',
    'reserveUpdateCommand',
    'reservedeletedCommand',
    'recordingPreStartCommand',
    'recordingPrepRecFailedCommand',
    'recordingStartCommand',
    'recordingFailedCommand',
    'recordingFinishCommand',
    'encodingFinishCommand',
] as const;

const makeChain = async (config: Record<string, unknown>) => {
    const persistence: RepositoryPersistence = await createRepositoryPersistence('sqlite');
    cleanups.push(() => persistence.cleanup());
    const storageRoot = await mkdtemp(join(tmpdir(), 'epgstation-synthetic-storage-'));
    temporaryRoots.push(storageRoot);
    await persistence.db.ChannelDB.insert([channelRow(21)]);
    const recordedId = Number(
        await persistence.db.RecordedDB.insertOnce({
            reserveId: null,
            ruleId: null,
            programId: null,
            channelId: 21,
            isProtected: false,
            startAt: 1_000,
            endAt: 2_500,
            duration: 1_500,
            name: 'synthetic-program',
            halfWidthName: 'synthetic-program',
            isRecording: false,
            dropLogFileId: null,
        }),
    );
    const videoFileId = Number(
        await persistence.db.VideoFileDB.insertOnce({
            recordedId,
            parentDirectoryName: 'synthetic-storage',
            filePath: 'synthetic-recorded.ts',
            type: 'ts',
            name: 'TS',
            size: 0,
        }),
    );
    const videoUtil = new VideoUtil(
        { getConfig: () => ({ recorded: [{ name: 'synthetic-storage', path: storageRoot }] }) },
        persistence.db.VideoFileDB,
    );
    const queue = new PromiseQueue();
    const add = queue.add.bind(queue);
    const jobs: Array<{ settled: boolean }> = [];
    queue.add = (<T>(job: () => Promise<T>): Promise<T> => {
        const state = { settled: false };
        jobs.push(state);
        const result = add(job);
        const settle = () => {
            state.settled = true;
        };
        void result.then(settle, settle);
        return result;
    }) as typeof queue.add;
    const { logger, model } = makeModel(staticConfiguration(config), {
        channelDB: persistence.db.ChannelDB,
        queue,
        recordedDB: persistence.db.RecordedDB,
        videoUtil,
    });
    const reserveEvent = new ReserveEvent({ getLogger: () => logger });
    const recordingEvent = new RecordingEvent({ getLogger: () => logger });
    const encodeEvent = new OperatorEncodeEvent({ getLogger: () => logger });
    const harness = makeSetter({ encodeEvent, externalCommandManage: model, logger, recordingEvent, reserveEvent });
    harness.setter.set();
    const reserve = (id: number) => makeReserve({ channelId: 21, id });
    const recorded = () => makeRecorded({ channelId: 21, id: recordedId, videoFiles: [{ id: videoFileId }] });
    const info = { mode: 'synthetic-mode', recordedId, videoFileId };
    /** 9 種の hook を 1 回ずつ起こす event。戻り値は呼び出し側から見える結果。 */
    const emitters: Array<() => unknown> = [
        () => reserveEvent.emitUpdated({ insert: [reserve(101)], isSuppressLog: false }),
        () => reserveEvent.emitUpdated({ update: [reserve(102)], isSuppressLog: false }),
        () => reserveEvent.emitUpdated({ delete: [reserve(103)], isSuppressLog: false }),
        () => recordingEvent.emitStartPrepRecording(reserve(104)),
        () => recordingEvent.emitPrepRecordingFailed(reserve(105)),
        () => recordingEvent.emitStartRecording(reserve(106), recorded()),
        () => recordingEvent.emitRecordingFailed(reserve(107), recorded()),
        () => recordingEvent.emitFinishRecording(reserve(108), recorded(), false),
        () => encodeEvent.emitFinishEncode(info),
    ];
    const dump = async (): Promise<string> =>
        JSON.stringify(
            await Promise.all(
                (['Channel', 'Recorded', 'VideoFile', 'Reserve'] as const).map(name =>
                    persistence.source.getRepository(persistence.entities[name] as any).find(),
                ),
            ),
        );
    const settled = async (expected: number): Promise<void> => {
        await vi.waitFor(
            () => {
                expect(jobs.length).toBe(expected);
                expect(jobs.every(job => job.settled)).toBe(true);
            },
            { timeout: 20_000, interval: 25 },
        );
    };
    const destinationCalls = (): string =>
        JSON.stringify({
            ipc: harness.ipc.notifyClient.mock.calls.length,
            accept: harness.recordingManage.acceptMutation.mock.calls.length,
            cancel: harness.reservationManage.cancel.mock.calls.map((call: unknown[]) => call[0]),
            historyCleanup: harness.recordedManage.historyCleanup.mock.calls.length,
        });
    return { dump, destinationCalls, emitters, harness, jobs, logger, model, recordedId, settled };
};

const noHookConfig = {};
/** 9 種の event のうち、通知（ipc.notifyClient）を出すもの（encode 完了を除く 8 つ）。 */
const IPC_NOTIFICATIONS = 8;
const allHooks = (command: string) => Object.fromEntries(HOOK_KEYS.map(key => [key, command]));

describe('hook delivery with real child processes, real events, and real SQLite', () => {
    it('[EH-3.11] starts the command once per accepted request without deduplicating identical state changes', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-synthetic-hook-'));
        temporaryRoots.push(root);
        const log = join(root, 'calls.log');
        const chain = await makeChain(allHooks(recorderCommand(log)));
        const before = await chain.dump();

        chain.emitters[1](); // 同じ内容の予約変更を 2 回
        chain.emitters[1]();
        chain.emitters[7](); // 同じ録画の終了を 2 回
        chain.emitters[7]();
        chain.emitters[8](); // 同じ番組・同じ mode の encode 完了を 2 回
        chain.emitters[8]();
        await vi.waitFor(() => expect(chain.jobs.length).toBe(6), { timeout: 5_000 });
        await chain.settled(6);

        const lines = await readLines(log);
        expect(lines).toHaveLength(6);
        const ids = lines.map(line => line.split(':').slice(2).join(':'));
        expect(ids.filter(id => id === '102:')).toHaveLength(2);
        expect(ids.filter(id => id === `${chain.recordedId}:`)).toHaveLength(2);
        expect(ids.filter(id => id.endsWith(':synthetic-mode'))).toHaveLength(2);
        expect(new Set(startedPids(lines)).size).toBe(6);
        expect(chain.logger.system.error).not.toHaveBeenCalled();
        expect(await chain.dump()).toBe(before);
    }, 20_000);

    it.each([
        ['exit 1 immediately', 'exit1'],
        ['sleep until the deadline', 'sleep'],
        ['a command file that does not exist', 'missing'],
    ])(
        '[EH-3.12][EH-6.5] leaves every caller result, collaborator call, and database row as without any hook when the command is %s',
        async (_label, kind) => {
            const root = await mkdtemp(join(tmpdir(), 'epgstation-synthetic-hook-'));
            temporaryRoots.push(root);
            const log = join(root, 'calls.log');
            const command = kind === 'missing' ? join(root, 'does-not-exist') : recorderCommand(log, kind);
            const baseline = await makeChain({ ...noHookConfig, hookCommandTimeoutMs: 300 });
            const baselineBefore = await baseline.dump();
            const baselineResults = baseline.emitters.map(emit => emit());
            await vi.waitFor(() => expect(JSON.parse(baseline.destinationCalls()).ipc).toBe(IPC_NOTIFICATIONS), {
                timeout: 3_000,
            });
            const baselineCalls = baseline.destinationCalls();
            expect(baseline.jobs).toHaveLength(0);

            const chain = await makeChain({ ...allHooks(command), hookCommandTimeoutMs: 300 });
            const before = await chain.dump();
            expect(before).toBe(baselineBefore);
            const results = chain.emitters.map(emit => emit());
            await vi.waitFor(() => expect(chain.jobs.length).toBe(9), { timeout: 5_000 });
            await chain.settled(9);
            await vi.waitFor(() => expect(JSON.parse(chain.destinationCalls()).ipc).toBe(IPC_NOTIFICATIONS), {
                timeout: 3_000,
            });

            expect(results).toEqual(baselineResults);
            expect(results.every(result => result === undefined)).toBe(true);
            expect(chain.destinationCalls()).toBe(baselineCalls);
            expect(await chain.dump()).toBe(before);
            if (kind === 'missing') {
                expect(
                    chain.logger.system.error.mock.calls.filter(([text]) =>
                        String(text).startsWith('execute cmd error'),
                    ),
                ).toHaveLength(9);
            } else {
                expect(
                    await readLines(log).then(lines => lines.filter(line => line.startsWith('started:'))),
                ).toHaveLength(9);
            }
            if (kind === 'sleep') {
                expect(
                    chain.logger.system.error.mock.calls.filter(([text]) =>
                        String(text).startsWith('hook command timed out'),
                    ),
                ).toHaveLength(9);
                expect((await readLines(log)).filter(line => line.startsWith('SIGINT:'))).toHaveLength(9);
            }
        },
        30_000,
    );

    it('[EH-6.6] completes the other follow-up work of an event without waiting for its hook, and a later hook failure changes none of it', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-synthetic-hook-'));
        temporaryRoots.push(root);
        const log = join(root, 'calls.log');
        const chain = await makeChain({
            recordingPrepRecFailedCommand: recorderCommand(log, 'sleep'),
            recordingFinishCommand: recorderCommand(log, 'sleep'),
            hookCommandTimeoutMs: 1_500,
        });

        chain.emitters[4](); // 録画準備の失敗: 予約の取消し・通知を hook と別に行う
        chain.emitters[7](); // 録画の終了: 通知を hook と別に行う
        await vi.waitFor(() => expect(chain.harness.ipc.notifyClient.mock.calls.length).toBe(2), { timeout: 3_000 });
        const withinHook = chain.destinationCalls();
        await vi.waitFor(async () => expect(startedPids(await readLines(log))).toHaveLength(1), { timeout: 3_000 });
        const [runningPid] = startedPids(await readLines(log));

        // hook はまだ終わっていないのに、予約の取消しと通知は終わっている
        expect(isAlive(runningPid)).toBe(true);
        expect(withinHook).toContain('"cancel":[105]');
        expect(chain.jobs.some(job => !job.settled)).toBe(true);

        await chain.settled(2);
        expect(
            chain.logger.system.error.mock.calls.some(([text]) => String(text).startsWith('hook command timed out')),
        ).toBe(true);
        // 時間制限で打ち切られても、業務側の呼び出しは増えも減りもしない
        expect(chain.destinationCalls()).toBe(withinHook);
    }, 20_000);
});

describe('hook limits that follow the configuration read at start', () => {
    it('[EH-4.6] keeps the pending-request limit read at start after config.yml changes, and applies the new value to a restarted model', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-synthetic-hook-'));
        temporaryRoots.push(root);
        const log = join(root, 'calls.log');
        const real = await makeRealConfiguration([
            'hookCommandMaxPending: 2',
            'hookCommandTimeoutMs: 5000',
            `reserveNewAddtionCommand: '${recorderCommand(log)}'`,
        ]);
        const running = makeModel(real.configuration);
        expect(real.configuration.getConfig().hookCommandMaxPending).toBe(2);

        await real.rewrite([
            'hookCommandMaxPending: 100',
            'hookCommandTimeoutMs: 5000',
            `reserveNewAddtionCommand: '${recorderCommand(log)}'`,
        ]);
        expect(real.configuration.getConfig().hookCommandMaxPending).toBe(100);

        for (let id = 1; id <= 5; id += 1) {
            running.model.addUpdateReseves({ insert: [makeReserve({ id })], isSuppressLog: false });
        }
        await vi.waitFor(async () => expect(await readLines(log)).toHaveLength(2), { timeout: 5_000 });
        await sleep(300);
        expect(await readLines(log)).toHaveLength(2);
        expect(
            running.logger.system.error.mock.calls.filter(([text]) =>
                String(text).startsWith('hook command queue is full'),
            ),
        ).toHaveLength(3);

        // 再起動（新しい model）では読み直した 100 件までを受け付ける
        const restarted = makeModel(real.configuration);
        for (let id = 11; id <= 15; id += 1) {
            restarted.model.addUpdateReseves({ insert: [makeReserve({ id })], isSuppressLog: false });
        }
        await vi.waitFor(async () => expect(await readLines(log)).toHaveLength(7), { timeout: 8_000 });
        expect(restarted.logger.system.error).not.toHaveBeenCalled();
    }, 25_000);

    it('[EH-4.10] keeps the deadline read at start after config.yml changes, and applies the new value to a restarted model', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-synthetic-hook-'));
        temporaryRoots.push(root);
        const log = join(root, 'calls.log');
        const lines = (timeout: number): string[] => [
            'hookCommandMaxPending: 8',
            `hookCommandTimeoutMs: ${timeout}`,
            `reserveNewAddtionCommand: '${recorderCommand(log, 'sleep')}'`,
        ];
        const real = await makeRealConfiguration(lines(600));
        const running = makeModel(real.configuration);
        await real.rewrite(lines(60_000));
        expect(real.configuration.getConfig().hookCommandTimeoutMs).toBe(60_000);

        const acceptedAt = Date.now();
        running.model.addUpdateReseves({ insert: [makeReserve({ id: 1 })], isSuppressLog: false });
        await vi.waitFor(
            async () => expect((await readLines(log)).some(line => line.startsWith('SIGINT:'))).toBe(true),
            {
                timeout: 8_000,
                interval: 25,
            },
        );
        const elapsed = Date.now() - acceptedAt;
        expect(elapsed).toBeGreaterThanOrEqual(590);
        expect(elapsed).toBeLessThan(7_500);
        const [oldPid] = startedPids(await readLines(log));
        await vi.waitFor(() => expect(isAlive(oldPid)).toBe(false), { timeout: 3_000 });

        // 再起動後（新しい model）の制限は 60 秒。同じ時間が過ぎても SIGINT は届かず、子は動き続ける
        const restarted = makeModel(real.configuration);
        restarted.model.addUpdateReseves({ insert: [makeReserve({ id: 2 })], isSuppressLog: false });
        await vi.waitFor(async () => expect(startedPids(await readLines(log))).toHaveLength(2), { timeout: 5_000 });
        const newPid = startedPids(await readLines(log))[1];
        spawnedPids.add(newPid);
        await sleep(1_500);
        expect(isAlive(newPid)).toBe(true);
        expect((await readLines(log)).filter(line => line.startsWith('SIGINT:'))).toHaveLength(1);
        process.kill(newPid, 'SIGKILL');
        await vi.waitFor(() => expect(isAlive(newPid)).toBe(false), { timeout: 3_000 });
    }, 25_000);

    it('[EH-4.9] uses 300 seconds when hookCommandTimeoutMs is unset: no signal at 299.999 seconds, SIGINT at 300 seconds, SIGKILL 3 seconds later', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-synthetic-hook-'));
        temporaryRoots.push(root);
        const log = join(root, 'signals.log');
        const real = await makeRealConfiguration([
            `recordingPreStartCommand: '${process.execPath} ${ignoreSigintFixture} ${log}'`,
        ]);
        expect(real.configuration.getConfig().hookCommandTimeoutMs).toBe(300_000);
        const kills = observeKills();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const { model } = makeModel(real.configuration);
        model.addRecordingPrepStartCmd(makeReserve({ id: 9 }));
        // 子の起動は実時間で待つ（model の timer だけが fake）
        for (let attempt = 0; attempt < 400 && (await readLines(log)).length === 0; attempt += 1) await sleep(25);
        const [started] = await readLines(log);
        expect(started).toMatch(/^started:\d+$/u);
        const pid = Number(started.split(':')[1]);

        await vi.advanceTimersByTimeAsync(299_999);
        await sleep(200);
        expect(kills.calls).toEqual([]);
        expect(await readLines(log)).toEqual([started]);

        await vi.advanceTimersByTimeAsync(1);
        // fake timer の最中は vi.waitFor が時計を進めるので、実時間で待つ
        for (let attempt = 0; attempt < 120 && (await readLines(log)).length < 2; attempt += 1) await sleep(25);
        expect(await readLines(log)).toEqual([started, 'SIGINT']);
        expect(kills.calls.map(call => [call.signal, call.pid])).toEqual([['SIGINT', pid]]);

        await vi.advanceTimersByTimeAsync(2_999);
        expect(kills.calls).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(kills.calls.map(call => [call.signal, call.pid])).toEqual([
            ['SIGINT', pid],
            ['SIGKILL', pid],
        ]);
        vi.useRealTimers();
        await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 3_000 });
    }, 20_000);
});

describe('hook termination with real child processes and the real clock', () => {
    it('[EH-4.14] signals only the directly spawned child and leaves its grandchild running', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-synthetic-hook-'));
        temporaryRoots.push(root);
        const log = join(root, 'processes.log');
        const kills = observeKills();
        const { logger, model } = makeModel(
            staticConfiguration({
                hookCommandTimeoutMs: 700,
                recordingPreStartCommand: `${process.execPath} ${grandchildFixture} ${log}`,
            }),
        );
        model.addRecordingPrepStartCmd(makeReserve({ id: 14 }));
        await vi.waitFor(async () => expect(await readLines(log)).toHaveLength(2), { timeout: 5_000 });
        const [direct, grandchild] = (await readLines(log)).map(line => Number(line.split(':')[1]));
        spawnedPids.add(grandchild);
        expect(kills.children[0].pid).toBe(direct);

        await vi.waitFor(() => expect(isAlive(direct)).toBe(false), { timeout: 5_000 });
        await vi.waitFor(
            () => expect(logger.system.error).toHaveBeenCalledWith(expect.stringContaining('hook command timed out')),
            {
                timeout: 2_000,
            },
        );
        expect(kills.calls.map(call => [call.signal, call.pid])).toEqual([['SIGINT', direct]]);
        expect(isAlive(grandchild)).toBe(true);
        await sleep(300);
        expect(isAlive(grandchild)).toBe(true);
        expect(kills.calls).toHaveLength(1);
    }, 15_000);

    it('[EH-4.15] sends SIGKILL once, three seconds after the SIGINT the child ignored, to the same child', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-synthetic-hook-'));
        temporaryRoots.push(root);
        const log = join(root, 'signals.log');
        const kills = observeKills();
        const { model } = makeModel(
            staticConfiguration({
                hookCommandTimeoutMs: 400,
                recordingPreStartCommand: `${process.execPath} ${ignoreSigintFixture} ${log}`,
            }),
        );
        const acceptedAt = Date.now();
        model.addRecordingPrepStartCmd(makeReserve({ id: 15 }));
        await vi.waitFor(() => expect(kills.calls).toHaveLength(2), { timeout: 9_000, interval: 25 });
        const [sigint, sigkill] = kills.calls;
        const [started] = await readLines(log);
        const pid = Number(started.split(':')[1]);

        expect(sigint).toMatchObject({ pid, signal: 'SIGINT' });
        expect(sigkill).toMatchObject({ pid, signal: 'SIGKILL' });
        expect(sigint.at - acceptedAt).toBeGreaterThanOrEqual(390);
        expect(sigkill.at - sigint.at).toBeGreaterThanOrEqual(2_990);
        expect(sigkill.at - sigint.at).toBeLessThan(10_000);
        await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 3_000 });
        expect(await readLines(log)).toEqual([started, 'SIGINT']);
        await sleep(500);
        expect(kills.calls).toHaveLength(2);
    }, 20_000);

    it('[EH-4.16][EH-4.17][EH-4.18] waits up to three seconds after SIGKILL, records the forced release in the real log file, runs the next command, and signals nothing more', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-synthetic-hook-'));
        temporaryRoots.push(root);
        const processLog = join(root, 'processes.log');
        const nextLog = join(root, 'next.json');
        const logFile = join(root, 'system.log');
        const logConfig = join(root, 'log.yml');
        await writeFile(
            logConfig,
            [
                'appenders:',
                '  system:',
                '    type: file',
                `    filename: ${logFile}`,
                '    layout: { type: pattern, pattern: "%p %m" }',
                'categories:',
                '  default: { appenders: [system], level: info }',
                '  system: { appenders: [system], level: info }',
            ].join('\n'),
        );
        const loggerModel = new LoggerModel();
        loggerModel.initialize(logConfig);
        const kills = observeKills({ swallow: true });
        const { model } = makeModel(
            staticConfiguration({
                hookCommandTimeoutMs: 500,
                recordingFinishCommand: `${process.execPath} ${captureFixture} ${nextLog}`,
                recordingPreStartCommand: `${process.execPath} ${grandchildFixture} ${processLog}`,
            }),
            { logger: loggerModel.getLogger() },
        );
        const acceptedAt = Date.now();
        model.addRecordingPrepStartCmd(makeReserve({ id: 16 }));
        model.addRecordingFinishCmd(makeRecorded({ id: 17 }));
        await vi.waitFor(async () => expect(await readLines(processLog)).toHaveLength(2), { timeout: 5_000 });
        const [direct, grandchild] = (await readLines(processLog)).map(line => Number(line.split(':')[1]));
        spawnedPids.add(grandchild);

        await vi.waitFor(
            async () => expect(await readFile(logFile, 'utf8').catch(() => '')).toContain('forced-release'),
            {
                timeout: 12_000,
                interval: 25,
            },
        );
        const releasedAt = Date.now();
        const [sigint, sigkill] = kills.calls;
        expect(kills.calls.map(call => [call.signal, call.pid])).toEqual([
            ['SIGINT', direct],
            ['SIGKILL', direct],
        ]);
        expect(sigint.at - acceptedAt).toBeGreaterThanOrEqual(490);
        expect(sigkill.at - sigint.at).toBeGreaterThanOrEqual(2_990);
        expect(releasedAt - sigkill.at).toBeGreaterThanOrEqual(2_990);
        expect(releasedAt - sigkill.at).toBeLessThan(10_000);

        const text = await readFile(logFile, 'utf8');
        expect(text).toContain(
            `ERROR hook command termination-unconfirmed forced-release: type=recording-prep-started pid=${direct} signals=SIGINT,SIGKILL`,
        );
        expect(text).toContain('ERROR hook command timed out: ');

        // 解放の直後に、待っていた次の実の command が走る
        await vi.waitFor(async () => expect(await readFile(nextLog, 'utf8')).toContain('RECORDEDID'), {
            timeout: 5_000,
        });

        // 強制解放の後は旧 process へ追加の signal を送らず、再起動もせず、孫も止めない
        await sleep(1_500);
        expect(kills.calls).toHaveLength(2);
        expect(await readLines(processLog)).toHaveLength(2);
        expect(isAlive(direct)).toBe(true);
        expect(isAlive(grandchild)).toBe(true);
    }, 30_000);
});
