import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    deferred,
    flushImmediate,
    makeLogger,
    makeRecorded,
    makeReserve,
    makeSetter,
    PromiseQueue,
    RecordingEvent,
    ReserveEvent,
} from '../_harness';

const signalFixture = join(process.cwd(), 'test/server/fixtures/event-and-hook-delivery/ignore-sigint-command.cjs');
const captureFixture = join(process.cwd(), 'test/server/fixtures/event-and-hook-delivery/capture-command.cjs');
const require = createRequire(join(process.cwd(), 'package.json'));

/**
 * The compiled model is ES modules (`import { spawn } from 'child_process'`), a static binding a plain
 * `require('child_process').spawn = ...` mutation never reaches (the ESM import for this suite resolves
 * through the test runner's own module graph, not the CommonJS loader that mutation goes through). Real
 * OS children are still wanted here (this is an integration test), so `spawnStub` wraps the *real*
 * `child_process.spawn` obtained via `require` before the module is mocked, and the compiled model is
 * reloaded once through `vi.doMock` + `vi.resetModules` + a dynamic `import()` (mirrors
 * `application-runtime/_runtime-harness.ts#evaluateCompiledRuntime`) so its internal `spawn(...)` calls
 * resolve to `spawnStub`. Individual tests then swap behavior with `spawnStub.mockImplementation(...)` /
 * `mockImplementationOnce(...)` instead of mutating `child_process` directly.
 */
const realChildProcess = require('child_process') as { spawn: (...args: any[]) => any };
const realSpawn = realChildProcess.spawn;
const spawnStub = vi.fn((...args: any[]) => realSpawn(...args));
let ExternalCommandManageModelCtor: (new (...args: any[]) => any) | undefined;

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

class UnconfirmedChild extends EventEmitter {
    public exitCode: number | null = null;
    public readonly kill = vi.fn();
    public readonly pid = 9_991;
}

const trackSpawnedChildren = () => {
    const originalSpawn = spawnStub.getMockImplementation() ?? realSpawn;
    const children: Array<{ child: any; closeCount: number }> = [];
    let active = 0;
    let peak = 0;
    let cleaning = false;
    spawnStub.mockImplementation((...args: any[]) => {
        const child = originalSpawn(...args);
        const entry = { child, closeCount: 0 };
        children.push(entry);
        active += 1;
        peak = Math.max(peak, active);
        child.once('close', () => {
            entry.closeCount += 1;
            active -= 1;
        });
        if (cleaning && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        return child;
    });
    return {
        children,
        cleanupUnclosed: async () => {
            // 終了で次の待機jobが起動しても、このwrapperを通るchildを即座に回収する。
            cleaning = true;
            const unclosed = children.filter(
                ({ child, closeCount }) =>
                    closeCount === 0 &&
                    Number.isSafeInteger(child.pid) &&
                    child.exitCode === null &&
                    child.signalCode === null &&
                    typeof child.kill === 'function',
            );
            for (const { child } of unclosed) {
                try {
                    child.kill('SIGKILL');
                } catch {
                    // ChildProcess may reject a late cleanup signal.
                }
            }
            await vi.waitFor(() => expect(children.every(entry => entry.closeCount === 1)).toBe(true), {
                timeout: 2_000,
            });
        },
        assertReleased: async () => {
            await vi.waitFor(() => expect(children.every(entry => entry.closeCount === 1)).toBe(true), {
                timeout: 2_000,
            });
            expect(peak).toBe(1);
            expect(active).toBe(0);
            for (const { child } of children) {
                expect(child.listenerCount('error')).toBe(0);
                expect(child.listenerCount('exit')).toBe(0);
                if (Number.isSafeInteger(child.pid)) expect(() => process.kill(child.pid, 0)).toThrow(/ESRCH/u);
                else expect(child.pid).toBeUndefined();
            }
        },
        restore: () => {
            spawnStub.mockImplementation(originalSpawn);
        },
    };
};

const trackHookTimers = () => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const timerObservations = new Map<
        ReturnType<typeof setTimeout>,
        { delay: unknown; active: boolean; cleared: boolean }
    >();
    const observations: Array<{ delay: unknown; active: boolean; cleared: boolean }> = [];
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    global.setTimeout = ((callback: (...args: any[]) => void, ...args: any[]) => {
        let timer!: ReturnType<typeof setTimeout>;
        const observation = { delay: args[0], active: true, cleared: false };
        observations.push(observation);
        timer = originalSetTimeout(
            (...callbackArgs: any[]) => {
                timers.delete(timer);
                observation.active = false;
                callback(...callbackArgs);
            },
            ...args,
        );
        timers.add(timer);
        timerObservations.set(timer, observation);
        return timer;
    }) as typeof setTimeout;
    global.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
        timers.delete(timer);
        const observation = timerObservations.get(timer);
        if (observation !== undefined) {
            observation.active = false;
            observation.cleared = true;
        }
        return originalClearTimeout(timer);
    }) as typeof clearTimeout;
    return {
        observations,
        assertReleased: () => expect(timers.size).toBe(0),
        restore: () => {
            global.setTimeout = originalSetTimeout;
            global.clearTimeout = originalClearTimeout;
        },
    };
};

const makeRealCommandModel = (
    config: Record<string, unknown>,
    channelDB: { findId: ReturnType<typeof vi.fn> } = {
        findId: vi.fn(async () => ({ halfWidthName: 'synthetic-half-channel', name: 'synthetic-channel' })),
    },
    queue = new PromiseQueue(),
) => {
    const logger = makeLogger();
    if (ExternalCommandManageModelCtor === undefined) throw new Error('ExternalCommandManageModelCtor not ready');
    const model = new ExternalCommandManageModelCtor(
        { getLogger: () => logger },
        {
            getConfig: () => ({
                dropLog: 'synthetic-drop-root',
                hookCommandMaxPending: 2,
                hookCommandTimeoutMs: 500,
                ...config,
            }),
        },
        queue,
        channelDB,
        { findId: vi.fn() },
        { getFullFilePathFromId: vi.fn() },
    );
    return { channelDB, logger, model };
};

describe('real EventEmitter wrapper and EventSetter integration', () => {
    it('[supporting event integration] preserves destination start order without awaiting reservation work', () => {
        const logger = makeLogger();
        const reserveEvent = new ReserveEvent({ getLogger: () => logger });
        const ledger: string[] = [];
        const harness = makeSetter({
            logger,
            reserveEvent,
            ipc: { notifyClient: vi.fn(() => ledger.push('ipc')), setEncode: vi.fn() },
            recordingManage: { acceptMutation: vi.fn(() => ledger.push('recording')) },
            externalCommandManage: {
                addUpdateReseves: vi.fn(() => ledger.push('hook')),
                addRecordingPrepStartCmd: vi.fn(),
                addRecordingPrepRecFailedCmd: vi.fn(),
                addRecordingStartCmd: vi.fn(),
                addRecordingFailedCmd: vi.fn(),
                addRecordingFinishCmd: vi.fn(),
                addEncodingFinishCmd: vi.fn(),
            },
        });
        harness.setter.set();
        const diff = { insert: [makeReserve()], isSuppressLog: false };
        expect(reserveEvent.emitUpdated(diff)).toBeUndefined();
        expect(ledger).toEqual(['ipc', 'recording', 'hook']);
        expect(harness.recordingManage.acceptMutation).toHaveBeenCalledWith(diff);
    });

    it('[supporting event integration] crosses real recording carriers and keeps recorded-null failure hook disabled', async () => {
        const logger = makeLogger();
        const recordingEvent = new RecordingEvent({ getLogger: () => logger });
        const harness = makeSetter({ logger, recordingEvent });
        harness.setter.set();
        const reserve = makeReserve();
        const recorded = makeRecorded();
        recordingEvent.emitStartPrepRecording(reserve);
        recordingEvent.emitCancelPrepRecording(reserve);
        recordingEvent.emitPrepRecordingFailed(reserve);
        recordingEvent.emitStartRecording(reserve, recorded);
        recordingEvent.emitRecordingFailed(reserve, null);
        recordingEvent.emitRecordingFailed(reserve, recorded);
        recordingEvent.emitFinishRecording(reserve, recorded, false);
        await flushImmediate();
        expect(harness.externalCommandManage.addRecordingPrepStartCmd).toHaveBeenCalledOnce();
        expect(harness.externalCommandManage.addRecordingPrepRecFailedCmd).toHaveBeenCalledTimes(2);
        expect(harness.externalCommandManage.addRecordingStartCmd).toHaveBeenCalledOnce();
        expect(harness.externalCommandManage.addRecordingFailedCmd).toHaveBeenCalledOnce();
        expect(harness.externalCommandManage.addRecordingFinishCmd).toHaveBeenCalledOnce();
    });

    it('[EH-7.4] leaves a SIGTERM-exited real child untouched until its close event', async () => {
        const spawnedChildren = trackSpawnedChildren();
        try {
            const child = spawnStub(process.execPath, ['-e', 'setInterval(() => undefined, 1_000)']);
            const kill = vi.spyOn(child, 'kill');
            const cleanupAfterExit = new Promise<void>((resolve, reject) => {
                child.once('exit', () => {
                    try {
                        expect(child.exitCode).toBeNull();
                        expect(child.signalCode).toBe('SIGTERM');
                        void spawnedChildren.cleanupUnclosed().then(resolve, reject);
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            expect(child.kill('SIGTERM')).toBe(true);
            await cleanupAfterExit;
            expect(kill).toHaveBeenCalledTimes(1);
            expect(kill).toHaveBeenCalledWith('SIGTERM');
            await spawnedChildren.assertReleased();
        } finally {
            await spawnedChildren.cleanupUnclosed();
            spawnedChildren.restore();
        }
    });

    it('[EH-7.4] advances real child work after nonzero exit, spawn failure, and preparation rejection', async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-hook-failures-'));
        const hookTimers = trackHookTimers();
        const spawnedChildren = trackSpawnedChildren();
        try {
            for (const scenario of ['nonzero-exit', 'spawn-failure', 'preparation-rejection'] as const) {
                const nextItemLog = join(temporaryRoot, `${scenario}.json`);
                const command =
                    scenario === 'nonzero-exit'
                        ? `${process.execPath} -e process.exit(23)`
                        : scenario === 'spawn-failure'
                          ? captureFixture
                          : `${process.execPath} ${captureFixture} ${nextItemLog}`;
                const channelDB = {
                    findId:
                        scenario === 'preparation-rejection'
                            ? vi
                                  .fn()
                                  .mockRejectedValueOnce(new Error('synthetic database rejection'))
                                  .mockResolvedValue({
                                      halfWidthName: 'synthetic-half-channel',
                                      name: 'synthetic-channel',
                                  })
                            : vi.fn(async () => ({
                                  halfWidthName: 'synthetic-half-channel',
                                  name: 'synthetic-channel',
                              })),
                };
                const { logger, model } = makeRealCommandModel(
                    scenario === 'preparation-rejection'
                        ? { recordingPreStartCommand: command }
                        : {
                              recordingFinishCommand: `${process.execPath} ${captureFixture} ${nextItemLog}`,
                              recordingPreStartCommand: command,
                          },
                    channelDB,
                );
                const first = makeReserve({ id: 701 });
                const next = makeRecorded({ id: 702 });

                model.addRecordingPrepStartCmd(first);
                if (scenario === 'preparation-rejection') model.addRecordingPrepStartCmd(makeReserve({ id: 702 }));
                else model.addRecordingFinishCmd(next);

                await vi.waitFor(() => expect(readFile(nextItemLog, 'utf8')).resolves.toContain('env'), {
                    timeout: 2_000,
                });
                expect(logger.system.error).toHaveBeenCalled();
                if (scenario === 'nonzero-exit') {
                    expect(logger.system.error).toHaveBeenCalledWith(`failed: ${command}. exit: 23`);
                }
                if (scenario === 'spawn-failure') {
                    expect(logger.system.error).toHaveBeenCalledWith(`failed: ${command}`);
                }
                if (scenario === 'preparation-rejection') {
                    expect(logger.system.error).toHaveBeenCalledWith(expect.any(Error));
                }
                await spawnedChildren.assertReleased();
            }
            await spawnedChildren.assertReleased();
            hookTimers.assertReleased();
        } finally {
            await spawnedChildren.cleanupUnclosed();
            spawnedChildren.restore();
            hookTimers.restore();
            await rm(temporaryRoot, { force: true, recursive: true });
        }
    }, 10_000);

    it('[EH-7.4] rejects a full queue and fences late preparation while preserving real process cleanup', async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-hook-admission-'));
        const signalLog = join(temporaryRoot, 'signals.log');
        const nextItemLog = join(temporaryRoot, 'next-item.json');
        let pid: number | undefined;
        const hookTimers = trackHookTimers();
        const spawnedChildren = trackSpawnedChildren();
        // Captured after trackHookTimers so finally can unwrap without losing the tracker restore chain.
        let setTimeoutAfterTrack: typeof setTimeout | undefined;
        try {
            const full = makeRealCommandModel({
                hookCommandMaxPending: 1,
                hookCommandTimeoutMs: 10_000,
                recordingPreStartCommand: `${process.execPath} ${signalFixture} ${signalLog}`,
            });
            full.model.addRecordingPrepStartCmd(makeReserve({ id: 711 }));
            full.model.addRecordingPrepStartCmd(makeReserve({ id: 712 }));
            await vi.waitFor(async () => expect(await readFile(signalLog, 'utf8')).toMatch(/^started:\d+$/mu), {
                timeout: 2_000,
            });
            pid = Number((await readFile(signalLog, 'utf8')).match(/^started:(\d+)$/mu)?.[1]);
            expect(full.logger.system.error).toHaveBeenCalledWith(
                expect.stringContaining('hook command queue is full'),
            );
            expect((await readFile(signalLog, 'utf8')).match(/^started:/gmu)).toHaveLength(1);
            process.kill(pid, 'SIGKILL');
            await vi.waitFor(() => expect(() => process.kill(pid as number, 0)).toThrow(/ESRCH/u), { timeout: 5_000 });

            // Phase B: prep keeps hookCommandTimeoutMs 50 (deferred findId). Finish must still write
            // next-item after prep times out. Production shares one timeout field, so the test gives
            // the first 50ms deadline timer to prep and remaps only subsequent 50ms deadlines to a
            // load-tolerant finish budget (does not change ExternalCommandManageModel).
            setTimeoutAfterTrack = global.setTimeout;
            let hookDeadlineOrdinal = 0;
            global.setTimeout = ((callback: (...args: any[]) => void, ms?: number, ...args: any[]) => {
                let delay = ms;
                if (ms === 50) {
                    delay = hookDeadlineOrdinal === 0 ? 50 : 5_000;
                    hookDeadlineOrdinal += 1;
                }
                return setTimeoutAfterTrack!(callback as TimerHandler, delay as number, ...args);
            }) as typeof setTimeout;

            const preparation = deferred<{ halfWidthName: string; name: string }>();
            const timeout = makeRealCommandModel(
                {
                    hookCommandTimeoutMs: 50,
                    recordingFinishCommand: `${process.execPath} ${captureFixture} ${nextItemLog}`,
                    recordingPreStartCommand: `${process.execPath} ${captureFixture} ${join(temporaryRoot, 'late.json')}`,
                },
                {
                    findId: vi
                        .fn()
                        .mockReturnValueOnce(preparation.promise)
                        .mockResolvedValue({ halfWidthName: 'synthetic-half-channel', name: 'synthetic-channel' }),
                },
            );
            timeout.model.addRecordingPrepStartCmd(makeReserve({ id: 721 }));
            timeout.model.addRecordingFinishCmd(makeRecorded({ id: 722 }));
            // Finish capture may start only after the 50ms prep timeout; observe next-item with a
            // bounded window that covers prep timeout + finish spawn/write under heavy suite load.
            await expect
                .poll(async () => readFile(nextItemLog, 'utf8'), { timeout: 5_000, interval: 25 })
                .toContain('RECORDEDID');
            preparation.resolve({ halfWidthName: 'late', name: 'late' });
            await flushImmediate();
            expect(timeout.logger.system.error).toHaveBeenCalledWith(
                expect.stringContaining('hook command timed out: '),
            );
            await expect(readFile(join(temporaryRoot, 'late.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
            await spawnedChildren.assertReleased();
            hookTimers.assertReleased();
        } finally {
            if (setTimeoutAfterTrack !== undefined) {
                global.setTimeout = setTimeoutAfterTrack;
            }
            await spawnedChildren.cleanupUnclosed();
            spawnedChildren.restore();
            hookTimers.restore();
            await rm(temporaryRoot, { force: true, recursive: true });
        }
    }, 10_000);

    it('[EH-7.4] fault-injects termination-unconfirmed and a late child event while a following OS child still completes', async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-hook-race-'));
        const nextItemLog = join(temporaryRoot, 'next-item.json');
        const spawnedChildren = trackSpawnedChildren();
        const originalSpawn = spawnStub.getMockImplementation()!;
        const unconfirmed = new UnconfirmedChild();
        let lateErrorObservations = 0;
        unconfirmed.on('error', () => {
            lateErrorObservations += 1;
        });
        try {
            spawnStub.mockImplementationOnce(() => unconfirmed).mockImplementation(originalSpawn);
            vi.useFakeTimers();
            const { logger, model } = makeRealCommandModel({
                hookCommandTimeoutMs: 1,
                recordingFinishCommand: `${process.execPath} ${captureFixture} ${nextItemLog}`,
                recordingPreStartCommand: `${process.execPath} ${captureFixture} ${join(temporaryRoot, 'first.json')}`,
            });
            model.addRecordingPrepStartCmd(makeReserve({ id: 731 }));
            model.addRecordingFinishCmd(makeRecorded({ id: 732 }));
            await vi.advanceTimersByTimeAsync(6_001);
            expect(unconfirmed.kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGINT', 'SIGKILL']);
            expect(logger.system.error).toHaveBeenCalledWith(
                expect.stringContaining('termination-unconfirmed forced-release'),
            );
            unconfirmed.emit('exit', 137, null);
            unconfirmed.emit('error', new Error('late child event'));
            await Promise.resolve();
            expect(lateErrorObservations).toBe(1);
            expect(unconfirmed.listenerCount('exit')).toBe(0);
            expect(unconfirmed.listenerCount('error')).toBe(1);
            vi.useRealTimers();
            await vi.waitFor(() => expect(readFile(nextItemLog, 'utf8')).resolves.toContain('RECORDEDID'), {
                timeout: 2_000,
            });
            await spawnedChildren.assertReleased();
        } finally {
            vi.useRealTimers();
            spawnStub.mockImplementation(originalSpawn);
            await spawnedChildren.cleanupUnclosed();
            spawnedChildren.restore();
            await rm(temporaryRoot, { force: true, recursive: true });
        }
    }, 10_000);

    it('[EH-7.4] connects DB and PM ports to a temporary-file child lifecycle without private model state', async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-hook-lifecycle-'));
        const signalLog = join(temporaryRoot, 'signals.log');
        const nextItemLog = join(temporaryRoot, 'next-item.json');
        const hookTimers = trackHookTimers();
        const spawnedChildren = trackSpawnedChildren();
        const logger = makeLogger();
        const channelDB = {
            findId: vi.fn(async () => ({ halfWidthName: 'synthetic-half-channel', name: 'synthetic-channel' })),
        };
        const ipc = { notifyClient: vi.fn(), setEncode: vi.fn() };
        if (ExternalCommandManageModelCtor === undefined) throw new Error('ExternalCommandManageModelCtor not ready');
        const model = new ExternalCommandManageModelCtor(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    dropLog: 'synthetic-drop-root',
                    hookCommandMaxPending: 2,
                    hookCommandTimeoutMs: 500,
                    recordingPreStartCommand: `${process.execPath} ${signalFixture} ${signalLog}`,
                    recordingFinishCommand: `${process.execPath} ${captureFixture} ${nextItemLog}`,
                }),
            },
            new PromiseQueue(),
            channelDB,
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        try {
            const reserveEvent = new ReserveEvent({ getLogger: () => logger });
            const recordingEvent = new RecordingEvent({ getLogger: () => logger });
            const harness = makeSetter({ externalCommandManage: model, ipc, logger, recordingEvent, reserveEvent });
            harness.setter.set();

            const reserve = makeReserve();
            const recorded = makeRecorded();
            reserveEvent.emitUpdated({ insert: [reserve], isSuppressLog: false });
            recordingEvent.emitStartPrepRecording(reserve);
            recordingEvent.emitFinishRecording(reserve, recorded, false);

            expect(ipc.notifyClient).toHaveBeenCalledTimes(3);
            await vi.waitFor(async () => expect(await readFile(signalLog, 'utf8')).toMatch(/^started:\d+$/mu), {
                timeout: 2_000,
            });
            const startedPid = Number((await readFile(signalLog, 'utf8')).match(/^started:(\d+)$/mu)?.[1]);
            expect(Number.isSafeInteger(startedPid)).toBe(true);
            await vi.waitFor(async () => expect(await readFile(signalLog, 'utf8')).toContain('SIGINT'), {
                timeout: 2_000,
            });
            expect(() => process.kill(startedPid, 0)).not.toThrow();
            await vi.waitFor(() => expect(() => process.kill(startedPid, 0)).toThrow(/ESRCH/u), { timeout: 5_000 });
            await vi.waitFor(
                async () =>
                    expect(JSON.parse(await readFile(nextItemLog, 'utf8'))).toMatchObject({
                        args: [],
                        env: { RECORDEDID: String(recorded.id) },
                    }),
                { timeout: 2_000 },
            );

            const captured = JSON.parse(await readFile(nextItemLog, 'utf8')) as { env: Record<string, string> };
            // Node forwards the OUTER process's own `NODE_V8_COVERAGE` to every spawned child
            // regardless of an explicit `env` option, so under `test:server:coverage` this
            // fixed-allowlist spawn's captured env carries this one extra key.
            expect(Object.keys(captured.env).sort()).toEqual(
                [
                    'CHANNELID',
                    'CHANNELNAME',
                    'DROP_CNT',
                    'DURATION',
                    'ENDAT',
                    'ERROR_CNT',
                    'HALF_WIDTH_CHANNELNAME',
                    'HALF_WIDTH_NAME',
                    'LOGPATH',
                    'NAME',
                    'PATH',
                    'PROGRAMID',
                    'RECPATH',
                    'RECORDEDID',
                    'SCRAMBLING_CNT',
                    'STARTAT',
                    ...(process.env.NODE_V8_COVERAGE === undefined ? [] : ['NODE_V8_COVERAGE']),
                ].sort(),
            );
            await spawnedChildren.assertReleased();
            hookTimers.assertReleased();

            expect(channelDB.findId).toHaveBeenCalledWith(reserve.channelId);
            expect(await readFile(signalLog, 'utf8')).toEqual(`started:${startedPid}\nSIGINT\n`);
            expect(logger.system.error).toHaveBeenCalledWith(expect.stringContaining('hook command timed out: '));
        } finally {
            await spawnedChildren.cleanupUnclosed();
            spawnedChildren.restore();
            hookTimers.restore();
            await rm(temporaryRoot, { force: true, recursive: true });
        }
    }, 10_000);
});

// 録画の event の発行側の test と hook の test は、別々の偽物（`emit*` の vi.fn と、callback を直接呼ぶ受け口）で流れて
// いる。本物の RecordingEvent → 本物の EventSetter → 本物の ExternalCommandManageModel → 実 child をつなぎ、録画の
// 経路が渡す凍結した写しで event を出したとき、各 hook の command が 1 回ずつ、出した順に動くことを確かめる。
const runRecordingHookChain = async (
    observe?: (logPath: string, timers: ReturnType<typeof trackHookTimers>) => Promise<void>,
    scriptTail = '',
    options: { beforeObservation?: (logPath: string) => Promise<void>; removeDirectory?: typeof rm } = {},
): Promise<void> => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-hook-chain-'));
    const spawnedChildren = trackSpawnedChildren();
    const hookTimers = trackHookTimers();
    const queue = new PromiseQueue();
    const add = queue.add.bind(queue);
    const jobs: Array<{ settled: boolean }> = [];
    queue.add = (job: () => Promise<unknown>) => {
        const state = { settled: false };
        jobs.push(state);
        const result = add(job);
        void result.then(
            () => {
                state.settled = true;
            },
            () => {
                state.settled = true;
            },
        );
        return result;
    };
    let observationError: unknown;
    try {
        const script = join(temporaryRoot, 'append-label.cjs');
        const log = join(temporaryRoot, 'hook-calls.log');
        await writeFile(
            script,
            "require('node:fs').appendFileSync(process.argv[2], `${process.argv[3]}:${process.env.RESERVEID ?? ''}:${process.env.RECORDEDID ?? ''}\\n`);\n" +
                scriptTail,
        );
        const command = (label: string) => `%NODE% ${script} ${log} ${label}`;
        const { logger, model } = makeRealCommandModel(
            {
                recordingPreStartCommand: command('prep-start'),
                recordingPrepRecFailedCommand: command('prep-failed'),
                recordingStartCommand: command('start'),
                recordingFailedCommand: command('failed'),
                recordingFinishCommand: command('finish'),
                hookCommandMaxPending: 64,
                hookCommandTimeoutMs: 10_000,
            },
            undefined,
            queue,
        );
        const recordingEvent = new RecordingEvent({ getLogger: () => logger });
        const harness = makeSetter({ logger, recordingEvent, externalCommandManage: model });
        harness.setter.set();
        const reserve = Object.freeze({ ...makeReserve({ id: 71 }) });
        const recorded = Object.freeze({ ...makeRecorded({ id: 81, videoFiles: [] }) });
        const failedReserve = Object.freeze({ ...makeReserve({ id: 72 }) });
        const failedRecorded = Object.freeze({ ...makeRecorded({ id: 82, videoFiles: [] }) });

        recordingEvent.emitStartPrepRecording(reserve);
        recordingEvent.emitStartRecording(reserve, recorded);
        recordingEvent.emitFinishRecording(reserve, recorded, false);
        recordingEvent.emitStartPrepRecording(failedReserve);
        recordingEvent.emitPrepRecordingFailed(failedReserve);
        recordingEvent.emitRecordingFailed(failedReserve, failedRecorded);

        await options.beforeObservation?.(log);
        await vi.waitFor(
            async () => expect((await readFile(log, 'utf8').catch(() => '')).trim().split('\n')).toHaveLength(6),
            { timeout: 15_000, interval: 50 },
        );
        expect((await readFile(log, 'utf8')).trim().split('\n')).toEqual([
            'prep-start:71:',
            'start::81',
            'finish::81',
            'prep-start:72:',
            'prep-failed:72:',
            'failed::82',
        ]);
        expect(logger.system.error).not.toHaveBeenCalled();
        await observe?.(log, hookTimers);
        await spawnedChildren.assertReleased();
    } catch (error) {
        observationError = error;
        throw error;
    } finally {
        try {
            await vi.waitFor(
                async () => {
                    await spawnedChildren.cleanupUnclosed();
                    expect(jobs.every(job => job.settled)).toBe(true);
                },
                { timeout: 5_000 },
            );
            hookTimers.assertReleased();
            await (options.removeDirectory ?? rm)(temporaryRoot, { force: true, recursive: true });
        } catch (cleanupError) {
            if (observationError !== undefined) {
                throw new AggregateError([observationError, cleanupError], 'hook observation and cleanup failed', {
                    cause: observationError,
                });
            }
            throw cleanupError;
        } finally {
            spawnedChildren.restore();
            hookTimers.restore();
        }
    }
};

describe('recording event to hook command chain without doubles in between', () => {
    it('[supporting event integration] runs each recording hook command exactly once in event order through the real event, setter, and command model', async () => {
        await runRecordingHookChain();
    });

    it('[supporting cleanup integration] closes a still-running hook before returning an observation failure', async () => {
        const spawnedChildren = trackSpawnedChildren();
        const failure = new Error('synthetic hook observation failure');
        let observedTimers: ReturnType<typeof trackHookTimers> | undefined;
        try {
            await expect(
                runRecordingHookChain(async (_log, timers) => {
                    observedTimers = timers;
                    expect(timers.observations.filter(timer => timer.delay === 10_000 && timer.active)).toHaveLength(1);
                    throw failure;
                }, "if (process.argv[3] === 'failed') setInterval(() => undefined, 1_000);\n"),
            ).rejects.toBe(failure);
            expect(spawnedChildren.children).toHaveLength(6);
            expect(spawnedChildren.children.every(entry => entry.closeCount === 1)).toBe(true);
            const deadlines = observedTimers?.observations.filter(timer => timer.delay === 10_000);
            expect(deadlines).toHaveLength(6);
            expect(deadlines?.every(timer => !timer.active && timer.cleared)).toBe(true);
        } finally {
            await spawnedChildren.cleanupUnclosed();
            spawnedChildren.restore();
        }
    }, 20_000);
    it('[supporting cleanup integration] drains queued hooks after the first running hook fails observation', async () => {
        const spawnedChildren = trackSpawnedChildren();
        const failure = new Error('synthetic first-hook observation failure');
        try {
            await expect(
                runRecordingHookChain(undefined, 'setInterval(() => undefined, 1_000);\n', {
                    beforeObservation: async log => {
                        await vi.waitFor(async () => expect(await readFile(log, 'utf8')).toContain('prep-start:71:'), {
                            timeout: 2_000,
                        });
                        throw failure;
                    },
                }),
            ).rejects.toBe(failure);
            expect(spawnedChildren.children).toHaveLength(6);
            expect(spawnedChildren.children.every(entry => entry.closeCount === 1)).toBe(true);
        } finally {
            const original = spawnStub.getMockImplementation()!;
            spawnStub.mockImplementation((...args: any[]) => {
                const child = original(...args);
                child.kill('SIGKILL');
                return child;
            });
            await spawnedChildren.cleanupUnclosed();
            spawnedChildren.restore();
        }
    }, 20_000);

    it('[supporting cleanup integration] preserves hook observation and directory removal errors together', async () => {
        const observationError = new Error('synthetic observation error');
        const removalError = new Error('synthetic directory removal error');
        let directory: string | undefined;
        try {
            const result = await runRecordingHookChain(
                async () => {
                    throw observationError;
                },
                '',
                {
                    removeDirectory: async path => {
                        directory = String(path);
                        throw removalError;
                    },
                },
            ).catch(error => error);
            expect(result).toBeInstanceOf(AggregateError);
            expect(result.cause).toBe(observationError);
            expect(result.errors).toEqual([observationError, removalError]);
        } finally {
            if (directory !== undefined) await rm(directory, { force: true, recursive: true });
        }
    }, 10_000);
});
