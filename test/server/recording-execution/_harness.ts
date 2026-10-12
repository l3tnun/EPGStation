import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');

export const load = <T>(...segments: string[]): T => (require(join(snapshot, ...segments)) as { default: T }).default;
export const Reserve = load<new () => Record<string, any>>('db', 'entities', 'Reserve.js');
export const Recorded = load<new () => Record<string, any>>('db', 'entities', 'Recorded.js');
export const RecordedHistory = load<new () => Record<string, any>>('db', 'entities', 'RecordedHistory.js');
export const VideoFile = load<new () => Record<string, any>>('db', 'entities', 'VideoFile.js');
export const DropLogFile = load<new () => Record<string, any>>('db', 'entities', 'DropLogFile.js');
export const RecordingManageModel = load<new (...args: any[]) => any>(
    'model',
    'operator',
    'recording',
    'RecordingManageModel.js',
);
export const RecordingCandidateRegistry = load<new () => any>(
    'model',
    'operator',
    'recording',
    'RecordingCandidateRegistry.js',
);
const recordingScheduleControllerModule = require(
    join(snapshot, 'model', 'operator', 'recording', 'RecordingScheduleController.js'),
) as Record<string, any>;
export const RecordingScheduleController = recordingScheduleControllerModule.default as new (dependencies: any) => any;
export const computeNextRecordingScheduleDelay = recordingScheduleControllerModule.computeNextDelay as (
    now: number,
    deadlines: readonly number[],
) => number;
export const RecorderModel = load<new (...args: any[]) => any>('model', 'operator', 'recording', 'RecorderModel.js');
export const RecordingStreamCreator = load<new (...args: any[]) => any>(
    'model',
    'operator',
    'recording',
    'RecordingStreamCreator.js',
);
export const RecordingUtilModel = load<new (...args: any[]) => any>(
    'model',
    'operator',
    'recording',
    'RecordingUtilModel.js',
);
export const ExecutionManagementModel = load<new (...args: any[]) => any>('model', 'ExecutionManagementModel.js');
export const RecordingEvent = load<new (...args: any[]) => any>('model', 'event', 'RecordingEvent.js');
export const IPCServer = load<new (...args: any[]) => any>('model', 'ipc', 'IPCServer.js');
export const ReserveDB = load<new (...args: any[]) => any>('model', 'db', 'ReserveDB.js');
export const RecordedDB = load<new (...args: any[]) => any>('model', 'db', 'RecordedDB.js');
export const RecordedHistoryDB = load<new (...args: any[]) => any>('model', 'db', 'RecordedHistoryDB.js');
export const VideoFileDB = load<new (...args: any[]) => any>('model', 'db', 'VideoFileDB.js');
export const DropLogFileDB = load<new (...args: any[]) => any>('model', 'db', 'DropLogFileDB.js');
export const ProgramDB = load<new (...args: any[]) => any>('model', 'db', 'ProgramDB.js');

export const makeReserve = (overrides: Record<string, any> = {}) =>
    Object.assign(new Reserve(), {
        id: 1,
        ruleId: null,
        programId: 101,
        channelId: 10,
        channel: 'synthetic-channel',
        channelType: 'GR',
        startAt: Date.now() + 20_000,
        endAt: Date.now() + 60_000,
        isSkip: false,
        isOverlap: false,
        isConflict: false,
        isTimeSpecified: false,
        isEventRelay: false,
        allowEndLack: false,
        parentDirectoryName: null,
        directory: null,
        recordedFormat: null,
        name: 'synthetic-program',
        halfWidthName: 'synthetic-program',
        description: null,
        halfWidthDescription: null,
        extended: null,
        halfWidthExtended: null,
        rawExtended: null,
        rawHalfWidthExtended: null,
        ...overrides,
    });

export const makeRecorded = (overrides: Record<string, any> = {}) =>
    Object.assign(new Recorded(), {
        id: 21,
        reserveId: 1,
        ruleId: null,
        programId: 101,
        channelId: 10,
        isProtected: false,
        startAt: 1_000,
        endAt: 2_000,
        duration: 1_000,
        name: 'synthetic-program',
        halfWidthName: 'synthetic-program',
        rawExtended: null,
        rawHalfWidthExtended: null,
        isRecording: true,
        dropLogFileId: null,
        ...overrides,
    });

export const deferred = <T = void>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
};

export const flushImmediate = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

export const logger = {
    system: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
    stream: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
};

export const makeFakeRecordingScheduler = () => {
    const timers: Array<{
        callback: () => void;
        cancelled: boolean;
        delayMs: number;
        fired: boolean;
    }> = [];
    const microtasks: Array<() => void> = [];
    let activeTimerCount = 0;
    let maximumActiveTimerCount = 0;
    const scheduler = {
        setTimeout: vi.fn((callback: () => void, delayMs: number) => {
            const timer = { callback, cancelled: false, delayMs, fired: false };
            timers.push(timer);
            activeTimerCount += 1;
            maximumActiveTimerCount = Math.max(maximumActiveTimerCount, activeTimerCount);
            return {
                cancel: vi.fn(() => {
                    if (!timer.cancelled && !timer.fired) activeTimerCount -= 1;
                    timer.cancelled = true;
                }),
            };
        }),
        queueMicrotask: vi.fn((callback: () => void) => {
            microtasks.push(callback);
        }),
    };
    const activeTimers = () => timers.filter(timer => !timer.cancelled && !timer.fired);
    const fire = (timer = activeTimers()[0], force = false) => {
        if (timer === undefined) throw new Error('No recording scheduler timer is available');
        if (timer.cancelled && !force) return;
        if (!timer.cancelled && !timer.fired) activeTimerCount -= 1;
        timer.fired = true;
        timer.callback();
    };
    const flushMicrotasks = (limit = 100) => {
        let count = 0;
        while (microtasks.length > 0) {
            if (count >= limit) throw new Error('Recording scheduler microtask limit exceeded');
            count += 1;
            microtasks.shift()!();
        }
    };
    return {
        activeTimers,
        activeTimerCount: () => activeTimerCount,
        fire,
        flushMicrotasks,
        maximumActiveTimerCount: () => maximumActiveTimerCount,
        microtasks,
        scheduler,
        timers,
    };
};

export const makeScheduleHarness = (overrides: Record<string, any> = {}) => {
    const now = { value: overrides.now ?? 1_000_000 };
    const registry = overrides.registry ?? new RecordingCandidateRegistry();
    for (const reservation of overrides.reservations ?? []) registry.upsert(reservation);
    const fakeScheduler = overrides.fakeScheduler ?? makeFakeRecordingScheduler();
    const dispatchPreparation = overrides.dispatchPreparation ?? vi.fn(() => undefined);
    const dispatchTimeSpecifiedEnd = overrides.dispatchTimeSpecifiedEnd ?? vi.fn(() => undefined);
    const dispatchMutation = overrides.dispatchMutation ?? vi.fn(() => undefined);
    const dispatchReset = overrides.dispatchReset ?? vi.fn(() => undefined);
    const reportDispatchError = overrides.reportDispatchError ?? vi.fn();
    const clock = overrides.clock ?? { now: vi.fn(() => now.value) };
    const controller = new RecordingScheduleController({
        candidateRegistry: registry,
        clock,
        dispatchMutation,
        dispatchPreparation,
        dispatchReset,
        dispatchTimeSpecifiedEnd,
        reportDispatchError,
        scheduler: fakeScheduler.scheduler,
    });
    return {
        clock,
        controller,
        dispatchMutation,
        dispatchPreparation,
        dispatchReset,
        dispatchTimeSpecifiedEnd,
        fakeScheduler,
        now,
        registry,
        reportDispatchError,
    };
};

export const makeRecordingSessionBinding = (reservation: any, overrides: Record<string, any> = {}) => {
    const state = {
        current: true,
        phase: overrides.phase ?? 'Preparing',
    };
    const binding = {
        generation: overrides.generation ?? 1n,
        phase: state.phase,
        registerTimeSpecifiedEnd: vi.fn(),
        removeTimeSpecifiedEnd: vi.fn(),
        reservation,
        reservationId: reservation.id,
        sessionToken: overrides.sessionToken ?? 1n,
        isCurrent: vi.fn((expectedPhase: string) => state.current && state.phase === expectedPhase),
        tryTransition: vi.fn((expectedPhase: string, nextPhase: string) => {
            if (!state.current || state.phase !== expectedPhase) return false;
            state.phase = nextPhase;
            return true;
        }),
    };
    return { binding, state };
};

export const makeManager = (overrides: Record<string, any> = {}) => {
    const callbacks: Record<string, (...args: any[]) => any> = {};
    const recordingEvent = {
        setCancelPrepRecording: vi.fn((callback: any) => (callbacks.cancelPrep = callback)),
        setPrepRecordingFailed: vi.fn((callback: any) => (callbacks.prepFailed = callback)),
        setRecordingFailed: vi.fn((callback: any) => (callbacks.failed = callback)),
        setFinishRecording: vi.fn((callback: any) => (callbacks.finish = callback)),
        emitRecordingRetryOver: vi.fn(),
        emitFinishRecording: vi.fn(),
        ...overrides.recordingEvent,
    };
    const recorder = {
        bindScheduleSession: vi.fn(),
        setTimer: vi.fn(() => true),
        update: vi.fn(async () => undefined),
        cancel: vi.fn(async () => undefined),
        resetTimer: vi.fn(() => true),
        ...overrides.recorder,
    };
    const dependencies = {
        provider: vi.fn(async () => recorder),
        streamCreator: { setTuner: vi.fn() },
        recordedDB: { findAll: vi.fn(async () => [[], 0]), findReserveId: vi.fn(async () => []), findId: vi.fn() },
        reserveDB: { findId: vi.fn() },
        recordingUtil: {
            movingFromTmp: vi.fn(async () => '/synthetic-root/synthetic.ts'),
            updateVideoFileSize: vi.fn(async () => undefined),
        },
        ...overrides,
    };
    const model = new RecordingManageModel(
        { getLogger: () => logger },
        { getConfig: () => ({ recordedTmp: '/synthetic-tmp' }) },
        dependencies.provider,
        recordingEvent,
        dependencies.streamCreator,
        dependencies.recordedDB,
        dependencies.reserveDB,
        dependencies.recordingUtil,
    );
    if (overrides.startupCompleted ?? true) model.candidateStartupState = 'Started';
    return { model, callbacks, recordingEvent, recorder, ...dependencies };
};

const makeDropChecker = () => ({
    prepare: vi.fn(async () => undefined),
    attach: vi.fn(),
    stop: vi.fn(async () => undefined),
    getFilePath: vi.fn(() => null),
    getResult: vi.fn(async () => ({})),
});

/**
 * 実物の `DropCheckerModel` が始めたログの書き込みを追跡し、tmp dir を消す前に出し切るために待つ。
 *
 * drop・error・scrambling の行は event handler から await されずに追記され、終了時の集計行は
 * `getResult()` が戻った後も `onFinish` が書き続ける。書き込みが残ったまま dir を消すと、
 * 追記が dir の削除と競合して `ENOTEMPTY` で後片付けが落ちるか、消えた dir への追記が未処理の拒否になる。
 * 時間を置くのではなく、始まった `appendFile` と `onFinish` の完了を待つ。
 */
export const makeDropCheckerWriteTracker = () => {
    const pending = new Set<Promise<unknown>>();
    const track = <T extends object>(checker: T): T => {
        for (const name of ['appendFile', 'onFinish'] as const) {
            const original = (checker as any)[name].bind(checker) as (...args: unknown[]) => Promise<unknown>;
            (checker as any)[name] = (...args: unknown[]) => {
                const result = original(...args);
                pending.add(result.catch(() => undefined));
                return result;
            };
        }
        return checker;
    };
    // 待っている間に `onFinish` が次の追記を始めるので、追跡が空になるまで繰り返す。
    const settle = async (): Promise<void> => {
        while (pending.size > 0) {
            const batch = [...pending];
            pending.clear();
            await Promise.all(batch);
        }
    };
    return { settle, track };
};

export const makeRecorder = (overrides: Record<string, any> = {}) => {
    const dependencies = {
        programDB: { findId: vi.fn(async () => makeReserve()), findChannelIdAndTime: vi.fn(async () => null) },
        reserveDB: { findId: vi.fn(async () => makeReserve()) },
        recordedDB: {
            insertOnce: vi.fn(async () => 21),
            deleteOnce: vi.fn(async () => undefined),
            removeRecording: vi.fn(async () => undefined),
            findId: vi.fn(async () => Object.assign(new Recorded(), { id: 21, halfWidthName: 'synthetic-program' })),
            updateOnce: vi.fn(async () => undefined),
        },
        recordedHistoryDB: { insertOnce: vi.fn(async () => 1) },
        videoFileDB: { insertOnce: vi.fn(async () => 31) },
        dropLogFileDB: {
            deleteOnce: vi.fn(async () => true),
            insertOnce: vi.fn(async () => 41),
            updateCnt: vi.fn(async () => undefined),
        },
        streamCreator: { create: vi.fn(async () => new PassThrough()), changeEndAt: vi.fn() },
        dropChecker: makeDropChecker(),
        recordingUtil: {
            getRecPath: vi.fn(async () => ({
                parendDir: { name: 'synthetic-root', path: '/synthetic-root' },
                subDir: '',
                fileName: 'synthetic.ts',
                fullPath: '/synthetic-root/synthetic.ts',
            })),
            movingFromTmp: vi.fn(async () => '/synthetic-root/synthetic.ts'),
            updateVideoFileSize: vi.fn(async () => undefined),
        },
        recordingEvent: {
            emitStartPrepRecording: vi.fn(),
            emitPrepRecordingFailed: vi.fn(),
            emitCancelPrepRecording: vi.fn(),
            emitStartRecording: vi.fn(),
            emitRecordingFailed: vi.fn(),
            emitFinishRecording: vi.fn(),
            emitEventRelay: vi.fn(),
        },
        recordedUseProvider: undefined,
        // 実物の tuner server access は番組情報を返すか例外を投げるかのどちらかで、undefined は返さない。録画開始が張る
        // イベントリレー確認の timer は test の終了後に走りうるので、既定は relatedItems を持たない番組情報を返す。
        tunerServerAccess: {
            getProgram: vi.fn(async (programId: number) => ({ id: programId, eventId: 1, networkId: 1, serviceId: 1 })),
        },
        ...overrides,
    };
    const config = {
        isEnabledDropCheck: false,
        dropLog: '/synthetic-drop',
        recordedTmp: undefined,
        ...overrides.config,
    };
    // `RecorderModelClass` lets a test substitute a freshly `vi.doMock` + dynamic-`import()`-loaded
    // RecorderModel (needed to intercept its `import * as fs from 'fs'` calls, a static ESM binding
    // that a `require('fs')` mutation never reaches) while reusing this factory's default
    // dependency wiring. Defaults to the shared, eagerly `require`d `RecorderModel` used everywhere
    // else in this suite.
    const RecorderModelClass = overrides.RecorderModelClass ?? RecorderModel;
    const model = new RecorderModelClass(
        { getLogger: () => logger },
        { getConfig: () => config },
        dependencies.programDB,
        dependencies.reserveDB,
        dependencies.recordedDB,
        dependencies.recordedHistoryDB,
        dependencies.videoFileDB,
        dependencies.dropLogFileDB,
        dependencies.streamCreator,
        dependencies.dropChecker,
        dependencies.recordingUtil,
        dependencies.recordingEvent,
        dependencies.tunerServerAccess,
        dependencies.recordedUseProvider,
    );
    return { model, config, ...dependencies };
};

export const makeStreamCreator = (overrides: Record<string, any> = {}) => {
    const tunerServerAccess = {
        openProgramStream: vi.fn(async () => ({ stream: new PassThrough(), close: vi.fn() })),
        openServiceStream: vi.fn(async () => ({ stream: new PassThrough(), close: vi.fn() })),
        getProgram: vi.fn(),
        ...overrides.tunerServerAccess,
    };
    const config = { recPriority: 2, conflictPriority: 9, timeSpecifiedEndMargin: 0, timeSpecifiedStartMargin: 0 };
    const model = new RecordingStreamCreator(
        { getLogger: () => logger },
        { getConfig: () => ({ ...config, ...overrides.config }) },
        tunerServerAccess,
    );
    return { model, tunerServerAccess };
};
