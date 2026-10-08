import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { PassThrough } from 'node:stream';
import 'reflect-metadata';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createDeferred } from '../../harness/async';
import {
    captureRuntimeListeners,
    compiledSnapshotRoot,
    evaluateCompiledRuntime,
    removeListenersAddedSince,
} from '../_runtime-harness';

type RuntimeFault = 'uncaughtException' | 'unhandledRejection';

interface SerializedFatalError {
    readonly kind: 'error';
    readonly message: string;
}

interface SerializedFatalString {
    readonly kind: 'string';
    readonly value: string;
}

type RuntimeLedgerArgument = SerializedFatalError | SerializedFatalString | string;

interface RuntimeLedgerEntry {
    readonly argument?: RuntimeLedgerArgument;
    readonly operation: string;
}

interface RuntimeObservation {
    readonly code: number | null;
    readonly ledger: RuntimeLedgerEntry[];
    readonly stderr: string;
}

/** The directory holding the shared child-side loader hooks. */
const harnessDirectory = (): string => fileURLToPath(new URL('../../harness/', import.meta.url));

const runtimeBoundaryPrelude = String.raw`
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const compiledRoot = path.dirname(process.argv[1]);
const StartupContinuationCoordinator = (await import(pathToFileURL(path.join(compiledRoot, 'model', 'workflow', 'StartupContinuationCoordinator.js')).href)).default;
const fixture = JSON.parse(process.env.EPGSTATION_RUNTIME_BOUNDARY_FIXTURE);
const ledger = [];
let published = false;
const record = (operation, argument) => {
    const entry = { operation };
    if (argument !== undefined) entry.argument = argument;
    ledger.push(entry);
};
// 起動 workflow の最終段（EPG supervisor の execute）に届いた印。届いた時点で fatal observer の登録
// （init）、admission-start、child-spawn、ipc-register、先行 3 段の ledger 記録はすべて済んでいる。
let startupWorkflowReachedLastStage = () => undefined;
const startupWorkflowReached = new Promise(resolve => {
    startupWorkflowReachedLastStage = resolve;
});
const originalExit = process.exit.bind(process);
const publish = code => {
    if (published) return;
    published = true;
    process.stdout.write(JSON.stringify({ ledger }) + '\n', () => {
        if (code !== undefined) originalExit(code);
    });
};
process.exit = code => {
    record('process.exit', String(code));
    publish(code);
};
process.once('beforeExit', () => publish());
// runtime は http server を持ち続けるため beforeExit へ到達しない。fault を観測したら窓を閉じる。
const closeObservationWindow = () => setTimeout(() => publish(0), 100);
const serializeFatalArgument = value => {
    if (value instanceof Error) return { kind: 'error', message: value.message };
    return { kind: 'string', value: String(value) };
};
const logger = {
    initialize: () => record('logger.initialize'),
    getLogger: () => ({
        system: {
            fatal: value => record('fatal-log', serializeFatalArgument(value)),
            info: () => record('logger.info'),
        },
    }),
};
const child = new EventEmitter();
child.pid = 721;
child.stderr = null;
child.stdout = null;
child.kill = signal => {
    record('child-reap', String(signal));
    return true;
};
const services = {
    IConnectionCheckModel: {
        checkDB: async () => record('dependency-wait'),
        checkMirakurun: async () => record('dependency-wait'),
    },
    IConfiguration: { getConfig: () => ({}) },
    IEPGUpdateExecutorManageModel: {
        execute: () => {
            record('operator');
            startupWorkflowReachedLastStage();
        },
    },
    IEventSetter: { set: () => record('operator') },
    IIPCServer: {
        initialize: async () => record('admission-start'),
        register: () => record('ipc-register'),
        stop: () => record('admission-stop'),
    },
    ILoggerModel: logger,
    IRecordingManageModel: {
        cleanup: async () => record('operator'),
        rebuildCandidatesAndStart: async () => record('operator'),
        setTuner: () => record('operator'),
    },
    IReservationManageModel: {
        cleanup: async () => record('operator'),
        setTuners: () => record('operator'),
    },
    IRuntimeStartupWorkflowPort: new StartupContinuationCoordinator(),
    IStorageManageModel: { start: () => record('operator') },
    TunerServerAccess: { getTuners: async () => (record('operator'), []) },
};
const container = { get: identifier => services[identifier] };
Object.defineProperty(process, 'getuid', { configurable: true, value: () => 1000 });
// 置き換えは entrypoint 自身の module graph の中で評価されるため、ここから渡したいものは
// globalThis を経由する。
globalThis.__epgstationChildOverrides = {
    container,
    spawnService: () => (record('child-spawn'), child),
};
const spawnSource = 'export const spawn = (...a) => globalThis.__epgstationChildOverrides.spawnService(...a); export default { spawn };';
const sourceMapSupportSource = 'export const install = () => undefined; export default { install };';
const setterSource = 'export const set = () => undefined;';
const { registerOverrides } = await import(pathToFileURL(process.env.EPGSTATION_TEST_HARNESS_DIR + '/child-module-overrides.mjs').href);
registerOverrides([
    { specifier: 'node:child_process', source: spawnSource },
    { specifier: 'child_process', source: spawnSource },
    { specifier: 'reflect-metadata', source: 'export default {};' },
    { specifier: 'source-map-support', source: sourceMapSupportSource },
    { specifier: './model/ModelContainer.js', source: 'export default globalThis.__epgstationChildOverrides.container;' },
    { specifier: './model/ModelContainerSetter.js', source: setterSource },
]);
// prelude は entrypoint より先に評価される（ここで await すると entrypoint の読み込みを塞ぐ）。
// runtime が fatal observer を登録し、起動 workflow の最終段まで済ませたことを状態として待ってから
// fault を起こす。setImmediate は、最終段の呼び出しに続く microtask（workflow の完了）が全て流れた
// 後に fault を投げるためで、時間の長さには依存しない。
void startupWorkflowReached.then(() => {
    setImmediate(() => {
        closeObservationWindow();
        if (fixture.fault === 'uncaughtException') {
            throw new Error('synthetic runtime uncaught exception');
        }
        void Promise.reject(new Error('synthetic runtime unhandled rejection'));
    });
});
`;

const compiledEntrypoint = (): string => {
    const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
    if (compiledSnapshot === undefined || !isAbsolute(compiledSnapshot)) {
        throw new Error('Server test runner did not provide an absolute compiled snapshot');
    }
    return join(compiledSnapshot, 'index.js');
};

const waitForClose = async (child: ChildProcess): Promise<{ code: number | null; stderr: string; stdout: string }> => {
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => {
        stdout += chunk;
    });
    child.stderr?.on('data', chunk => {
        stderr += chunk;
    });
    const [code] = (await once(child, 'close')) as [number | null, NodeJS.Signals | null];
    return { code, stderr, stdout };
};

const stopChild = async (child: ChildProcess): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }
    const closed = once(child, 'close');
    child.kill('SIGKILL');
    await closed;
};

const observeRuntimeFault = async (fault: RuntimeFault): Promise<RuntimeObservation> => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'epgstation-runtime-boundary-'));
    const preludePath = join(temporaryDirectory, 'runtime-boundary-prelude.mjs');
    let child: ChildProcess | undefined;
    let deadline: NodeJS.Timeout | undefined;

    try {
        await writeFile(preludePath, runtimeBoundaryPrelude, 'utf8');
        const entrypoint = compiledEntrypoint();
        child = spawn(process.execPath, ['--import', pathToFileURL(preludePath).href, entrypoint], {
            cwd: dirname(entrypoint),
            env: {
                ...process.env,
                EPGSTATION_TEST_HARNESS_DIR: harnessDirectory(),
                EPGSTATION_RUNTIME_BOUNDARY_FIXTURE: JSON.stringify({ fault }),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const close = waitForClose(child);
        const timeout = new Promise<never>((_, reject) => {
            deadline = setTimeout(() => reject(new Error('Runtime boundary child did not exit')), 2_000);
        });
        const observation = await Promise.race([close, timeout]);
        const records = observation.stdout.trim().split('\n');

        expect(records).toHaveLength(1);
        console.error('CHILDERR>>>', observation.stderr.slice(0, 400));
        return {
            code: observation.code,
            ledger: (JSON.parse(records[0]) as { ledger: RuntimeLedgerEntry[] }).ledger,
            stderr: observation.stderr,
        };
    } finally {
        if (deadline !== undefined) {
            clearTimeout(deadline);
        }
        if (child !== undefined) {
            await stopChild(child);
        }
        await rm(temporaryDirectory, { force: true, recursive: true });
    }
};

const fatalArguments = (ledger: readonly RuntimeLedgerEntry[]): Array<Error | string> =>
    ledger
        .filter(entry => entry.operation === 'fatal-log')
        .map(entry => {
            const argument = entry.argument;
            if (typeof argument === 'object' && argument !== null) {
                if (argument.kind === 'error') {
                    return new Error(argument.message);
                }
                return argument.value;
            }
            throw new Error('Fatal log ledger entry did not include a serialized argument');
        });

describe('runtime parent fatal observer boundaries', () => {
    it.each([
        {
            expectedFatalErrorMessage: 'synthetic runtime uncaught exception',
            expectedFatalSummary: 'uncaughtException: synthetic runtime uncaught exception',
            fault: 'uncaughtException',
        },
        {
            expectedFatalErrorMessage: 'synthetic runtime unhandled rejection',
            expectedFatalSummary: 'unhandledRejection',
            fault: 'unhandledRejection',
        },
    ] satisfies Array<{
        readonly expectedFatalErrorMessage: string;
        readonly expectedFatalSummary: string;
        readonly fault: RuntimeFault;
    }>)(
        '[AR-2.7] records summary and error once each without recovery actions for $fault',
        async ({ expectedFatalErrorMessage, expectedFatalSummary, fault }) => {
            const observation = await observeRuntimeFault(fault);
            const admissionStartIndex = observation.ledger.findIndex(entry => entry.operation === 'admission-start');
            const childSpawnIndex = observation.ledger.findIndex(entry => entry.operation === 'child-spawn');
            const firstFatalIndex = observation.ledger.findIndex(entry => entry.operation === 'fatal-log');
            const observedFatalArguments = fatalArguments(observation.ledger);

            expect(observation.code).toBe(0);
            expect(observation.stderr).toBe('');
            expect(observedFatalArguments).toEqual([expectedFatalSummary, expect.any(Error)]);
            expect(observedFatalArguments[1]).toMatchObject({ message: expectedFatalErrorMessage });
            expect(observation.ledger.filter(entry => entry.operation === 'admission-start')).toHaveLength(1);
            expect(observation.ledger.filter(entry => entry.operation === 'child-spawn')).toHaveLength(1);
            expect(admissionStartIndex).toBeGreaterThanOrEqual(0);
            expect(childSpawnIndex).toBeGreaterThan(admissionStartIndex);
            expect(firstFatalIndex).toBeGreaterThan(childSpawnIndex);
            expect(observation.ledger.slice(firstFatalIndex).map(entry => entry.operation)).toEqual([
                'fatal-log',
                'fatal-log',
            ]);
            expect(
                observation.ledger.filter(entry =>
                    ['admission-stop', 'child-reap', 'process.exit'].includes(entry.operation),
                ),
            ).toEqual([]);
        },
    );
});

interface ConnectionCheckModelLike {
    checkDB(): Promise<void>;
    checkMirakurun(): Promise<void>;
}

interface RuntimeStartupWorkflowInputLike {
    readonly runRecordingReconciliation: () => Promise<void>;
    readonly runRecordingCandidatesAndStart: () => Promise<void>;
    readonly runExpiredReservationCleanup: () => Promise<void>;
    readonly startEpgSupervisor: () => Promise<void>;
}

interface RuntimeStartupWorkflowPortLike {
    runAfterServiceSupervisionAccepted(input: RuntimeStartupWorkflowInputLike): Promise<{ readonly kind: string }>;
}

const compiledModuleRequire = createRequire(join(process.cwd(), 'package.json'));

const loadConnectionCheckModel = (): new (...arguments_: unknown[]) => ConnectionCheckModelLike =>
    (
        compiledModuleRequire(join(compiledSnapshotRoot(), 'model', 'ConnectionCheckModel.js')) as {
            readonly default: new (...arguments_: unknown[]) => ConnectionCheckModelLike;
        }
    ).default;

const loadStartupContinuationCoordinator = (): new () => RuntimeStartupWorkflowPortLike =>
    (
        compiledModuleRequire(
            join(compiledSnapshotRoot(), 'model', 'workflow', 'StartupContinuationCoordinator.js'),
        ) as {
            readonly default: new () => RuntimeStartupWorkflowPortLike;
        }
    ).default;

interface RealIpcPeer {
    send(message: unknown, callback?: (error: Error | null) => void): boolean;
}

interface RealIpcServerLike {
    initialize(): Promise<void>;
    register(child: RealIpcPeer): void;
    notifyClient(): void;
}

const loadIpcServer = (): new (...arguments_: unknown[]) => RealIpcServerLike =>
    (
        compiledModuleRequire(join(compiledSnapshotRoot(), 'model', 'ipc', 'IPCServer.js')) as {
            readonly default: new (...arguments_: unknown[]) => RealIpcServerLike;
        }
    ).default;

interface RealEpgUpdateEventLike {
    emitUpdated(): void;
    setUpdated(callback: () => void): void;
}

const loadEpgUpdateEvent = (): new (loggerModel: unknown) => RealEpgUpdateEventLike =>
    (
        compiledModuleRequire(join(compiledSnapshotRoot(), 'model', 'event', 'EPGUpdateEvent.js')) as {
            readonly default: new (loggerModel: unknown) => RealEpgUpdateEventLike;
        }
    ).default;

const loadEpgUpdateExecutorManageModel = (): new (
    loggerModel: unknown,
    epgUpdateEvent: unknown,
) => { execute(): Promise<void> } =>
    (
        compiledModuleRequire(
            join(compiledSnapshotRoot(), 'model', 'epgUpdater', 'EPGUpdateExecutorManageModel.js'),
        ) as {
            readonly default: new (loggerModel: unknown, epgUpdateEvent: unknown) => { execute(): Promise<void> };
        }
    ).default;

const noOpDomainPort = (methods: readonly string[]): Record<string, () => undefined> =>
    Object.fromEntries(methods.map(method => [method, () => undefined]));

/**
 * Constructs the real, production IPCServer class (not a stub `IIPCServer`) so that Service child
 * generation-replacement is verified against the actual process-messaging peer registry contract: exact current
 * peer routing, and old-peer listener release, rather than a Runtime-owned double.
 */
const buildRealIpcServer = (recordLogError: (message: string) => void): RealIpcServerLike => {
    const IPCServer = loadIpcServer();

    return new IPCServer(
        noOpDomainPort([
            'getBroadcastStatus',
            'add',
            'update',
            'updateRule',
            'updateAll',
            'cancel',
            'removeSkip',
            'removeOverlap',
            'edit',
        ]),
        noOpDomainPort([
            'updateVideoFileSize',
            'addVideoFile',
            'addUploadedVideoFile',
            'createNewRecorded',
            'deleteVideoFile',
            'changeProtect',
            'videoFileCleanup',
            'dropLogFileCleanup',
        ]),
        noOpDomainPort(['create', 'update', 'setRelation', 'delete', 'deleteRelation']),
        { cancelForDeletion: async () => undefined, hasReserve: () => false, resetTimer: () => undefined },
        noOpDomainPort(['add', 'update', 'enable', 'disable', 'delete']),
        { ...noOpDomainPort(['regenerate', 'fileCleanup', 'delete']), add: () => undefined },
        { getLogger: () => ({ system: { error: recordLogError, fatal: () => undefined, info: () => undefined } }) },
        {
            adopt: async () => {
                throw new Error('UploadAdoptionNotUsedInThisScenario');
            },
            initialize: async () => undefined,
        },
    );
};

interface RootIdentityOverride {
    readonly setgid: ReturnType<typeof vi.fn>;
    readonly setuid: ReturnType<typeof vi.fn>;
    restore(): void;
}

/**
 * Mirrors the isolated-process pattern in startup-preparation.spec.test.ts:76-84 (Object.defineProperty over a
 * saved-and-restored descriptor) instead of vi.spyOn, so the real syscall-backed process.setgid/setuid are
 * never reachable: their own-property slot on `process` is replaced for the override's entire lifetime and only
 * ever points at these local mocks, guarded the same way as the getuid overrides elsewhere in this file so a
 * platform without these methods (win32) is left untouched, matching src/index.ts:44's own platform guard.
 */
const overrideRootIdentityForTest = (record: (operation: string) => void): RootIdentityOverride => {
    const propertyNames = ['getuid', 'setgid', 'setuid'] as const;
    const descriptors = propertyNames.map(name => [name, Object.getOwnPropertyDescriptor(process, name)] as const);
    const setgid = vi.fn(() => {
        record('setgid');
    });
    const setuid = vi.fn(() => {
        record('setuid');
    });

    if (typeof process.getuid === 'function') {
        Object.defineProperty(process, 'getuid', { configurable: true, value: () => 0 });
    }
    if (typeof process.setgid === 'function') {
        Object.defineProperty(process, 'setgid', { configurable: true, value: setgid });
    }
    if (typeof process.setuid === 'function') {
        Object.defineProperty(process, 'setuid', { configurable: true, value: setuid });
    }

    return {
        restore: () => {
            for (const [name, descriptor] of descriptors) {
                if (descriptor === undefined) {
                    Reflect.deleteProperty(process, name);
                } else {
                    Object.defineProperty(process, name, descriptor);
                }
            }
        },
        setgid,
        setuid,
    };
};

describe('compiled runtime end-to-end composition', () => {
    it(
        '[AR-2.1][AR-2.2][AR-2.5][AR-3.1][AR-3.3][AR-3.5][AR-3.6][AR-3.7][AR-4.1][AR-4.2][AR-4.3]' +
            '[AR-4.4][AR-4.5][AR-5.1][AR-5.2][AR-6.1][AR-6.2][AR-6.6][AR-6.7][AR-6.8][AR-7.1] shows one call ledger ' +
            'from log/config/identity through EPG start while an unbounded dependency wait past 600000ms ' +
            'records zero stage-overdue outcomes and schedules zero timers',
        async () => {
            vi.useFakeTimers();
            const restoreListeners = captureRuntimeListeners();

            const ledger: string[] = [];
            const record = (operation: string): void => {
                ledger.push(operation);
            };
            const rootIdentity = overrideRootIdentityForTest(record);
            const overdue = vi.fn();
            const fatal = vi.fn();

            let tunerAttempts = 0;
            const tunerPending = createDeferred<void>();
            const ConnectionCheckModel = loadConnectionCheckModel();
            const connectionChecker = new ConnectionCheckModel(
                { getLogger: () => ({ system: { info: () => undefined } }) },
                {
                    checkAvailability: () => {
                        tunerAttempts += 1;
                        record('tuner-attempt');
                        return tunerAttempts === 1 ? tunerPending.promise : Promise.resolve();
                    },
                },
                { checkConnection: async () => record('database-attempt') },
            );
            const StartupContinuationCoordinator = loadStartupContinuationCoordinator();

            const serviceChild = Object.assign(new EventEmitter(), { pid: 9_100, stderr: null, stdout: null });
            let spawnCount = 0;

            const container = {
                get: (identifier: string): unknown => {
                    switch (identifier) {
                        case 'IConfiguration':
                            return {
                                getConfig: () => (
                                    record('configuration-snapshot'),
                                    { gid: 'recording-group', uid: 'recording-user' }
                                ),
                            };
                        case 'IConnectionCheckModel':
                            return connectionChecker;
                        case 'IEPGUpdateExecutorManageModel':
                            return { execute: () => record('epg-start') };
                        case 'IEventSetter':
                            return { set: () => record('event-binding') };
                        case 'IIPCServer':
                            return {
                                initialize: async () => record('ipc-initialize'),
                                register: () => record('ipc-register'),
                            };
                        case 'ILoggerModel':
                            return {
                                getLogger: () => ({
                                    system: {
                                        error: () => {
                                            overdue();
                                            record('overdue-log');
                                        },
                                        fatal: () => {
                                            fatal();
                                            record('fatal-log');
                                        },
                                        info: () => undefined,
                                    },
                                }),
                                initialize: (configurationPath?: string) =>
                                    record(configurationPath === undefined ? 'operational-log' : 'operator-log'),
                            };
                        case 'IRecordingManageModel':
                            return {
                                cleanup: async () => record('recording-reconciliation'),
                                rebuildCandidatesAndStart: async () => record('recording-candidates-and-start'),
                                setTuner: () => record('recording-set-tuner'),
                            };
                        case 'IReservationManageModel':
                            return {
                                cleanup: async () => record('reservation-cleanup'),
                                setTuners: () => record('reservation-set-tuners'),
                            };
                        case 'IRuntimeStartupWorkflowPort':
                            return new StartupContinuationCoordinator();
                        case 'IStorageManageModel':
                            return { start: () => record('storage-start') };
                        case 'TunerServerAccess':
                            return { getTuners: async () => (record('tuner-handoff'), []) };
                        default:
                            throw new Error(`Unexpected runtime dependency: ${identifier}`);
                    }
                },
            };

            try {
                await evaluateCompiledRuntime(container, () => {
                    spawnCount += 1;
                    record('service-spawn');
                    return serviceChild;
                });

                expect(ledger).toEqual([
                    'operational-log',
                    'configuration-snapshot',
                    'setgid',
                    'setuid',
                    'operator-log',
                    'tuner-attempt',
                ]);
                expect(vi.getTimerCount()).toBe(0);

                await vi.advanceTimersByTimeAsync(700_000);

                expect(ledger).toEqual([
                    'operational-log',
                    'configuration-snapshot',
                    'setgid',
                    'setuid',
                    'operator-log',
                    'tuner-attempt',
                ]);
                expect(overdue).not.toHaveBeenCalled();
                expect(vi.getTimerCount()).toBe(0);

                tunerPending.resolve();
                await vi.waitFor(() => expect(ledger).toContain('epg-start'));
                await vi.advanceTimersByTimeAsync(0);

                expect(ledger).toEqual([
                    'operational-log',
                    'configuration-snapshot',
                    'setgid',
                    'setuid',
                    'operator-log',
                    'tuner-attempt',
                    'database-attempt',
                    'ipc-initialize',
                    'event-binding',
                    'tuner-handoff',
                    'reservation-set-tuners',
                    'recording-set-tuner',
                    'storage-start',
                    'service-spawn',
                    'ipc-register',
                    'recording-reconciliation',
                    'recording-candidates-and-start',
                    'reservation-cleanup',
                    'epg-start',
                ]);
                expect(rootIdentity.setgid).toHaveBeenCalledTimes(1);
                expect(rootIdentity.setuid).toHaveBeenCalledTimes(1);
                expect(spawnCount).toBe(1);
                expect(overdue).not.toHaveBeenCalled();
                expect(fatal).not.toHaveBeenCalled();
                expect(vi.getTimerCount()).toBe(0);
                expect(serviceChild.listenerCount('exit')).toBe(1);
                expect(serviceChild.listenerCount('error')).toBe(1);
                expect(serviceChild.listenerCount('close')).toBe(1);
            } finally {
                rootIdentity.restore();
                removeListenersAddedSince(restoreListeners);
                vi.clearAllTimers();
                vi.useRealTimers();
            }
        },
    );

    it.each([
        {
            failingStage: 'recording-reconciliation' as const,
            label: 'recording-reconciliation rejects',
        },
        {
            failingStage: 'recording-candidates-and-start' as const,
            label: 'recording-candidates-and-start rejects',
        },
        {
            failingStage: 'expired-reservation-cleanup' as const,
            label: 'expired-reservation-cleanup rejects',
        },
    ])(
        '[AR-6.1][AR-6.4][AR-6.7] keeps every stage after $failingStage at zero when $label',
        async ({ failingStage }) => {
            vi.useFakeTimers();
            const restoreListeners = captureRuntimeListeners();
            const getuidSpy =
                typeof process.getuid === 'function' ? vi.spyOn(process, 'getuid').mockReturnValue(1_000) : undefined;

            let reconciliationCalls = 0;
            let rebuildCalls = 0;
            let reservationCleanupCalls = 0;
            let epgStartCalls = 0;
            const overdue = vi.fn();
            const fatal = vi.fn();
            const StartupContinuationCoordinator = loadStartupContinuationCoordinator();
            const serviceChild = Object.assign(new EventEmitter(), { pid: 9_200, stderr: null, stdout: null });

            const attemptsForFailingStage = (): number => {
                switch (failingStage) {
                    case 'recording-reconciliation':
                        return reconciliationCalls;
                    case 'recording-candidates-and-start':
                        return rebuildCalls;
                    case 'expired-reservation-cleanup':
                        return reservationCleanupCalls;
                }
            };

            const container = {
                get: (identifier: string): unknown => {
                    switch (identifier) {
                        case 'IConfiguration':
                            return { getConfig: () => ({}) };
                        case 'IConnectionCheckModel':
                            return { checkDB: async () => undefined, checkMirakurun: async () => undefined };
                        case 'IEPGUpdateExecutorManageModel':
                            return {
                                execute: () => {
                                    epgStartCalls += 1;
                                },
                            };
                        case 'IEventSetter':
                            return { set: () => undefined };
                        case 'IIPCServer':
                            return { initialize: async () => undefined, register: () => undefined };
                        case 'ILoggerModel':
                            return {
                                getLogger: () => ({ system: { error: overdue, fatal, info: () => undefined } }),
                                initialize: () => undefined,
                            };
                        case 'IRecordingManageModel':
                            return {
                                cleanup: async () => {
                                    reconciliationCalls += 1;
                                    if (failingStage === 'recording-reconciliation') {
                                        throw new Error('synthetic recording-reconciliation failure');
                                    }
                                },
                                rebuildCandidatesAndStart: async () => {
                                    rebuildCalls += 1;
                                    if (failingStage === 'recording-candidates-and-start') {
                                        throw new Error('synthetic recording-candidates-and-start failure');
                                    }
                                },
                                setTuner: () => undefined,
                            };
                        case 'IReservationManageModel':
                            return {
                                cleanup: async () => {
                                    reservationCleanupCalls += 1;
                                    if (failingStage === 'expired-reservation-cleanup') {
                                        throw new Error('synthetic expired-reservation-cleanup failure');
                                    }
                                },
                                setTuners: () => undefined,
                            };
                        case 'IRuntimeStartupWorkflowPort':
                            return new StartupContinuationCoordinator();
                        case 'IStorageManageModel':
                            return { start: () => undefined };
                        case 'TunerServerAccess':
                            return { getTuners: async () => [] };
                        default:
                            throw new Error(`Unexpected runtime dependency: ${identifier}`);
                    }
                },
            };

            try {
                await evaluateCompiledRuntime(container, () => serviceChild);
                await vi.waitFor(() => expect(attemptsForFailingStage()).toBe(1));
                await vi.advanceTimersByTimeAsync(0);

                expect(reconciliationCalls).toBe(1);
                if (failingStage === 'recording-reconciliation') {
                    expect(rebuildCalls).toBe(0);
                } else {
                    expect(rebuildCalls).toBe(1);
                }
                if (failingStage === 'expired-reservation-cleanup') {
                    expect(reservationCleanupCalls).toBe(1);
                } else {
                    expect(reservationCleanupCalls).toBe(0);
                }
                expect(epgStartCalls).toBe(0);
                expect(overdue).not.toHaveBeenCalled();
                // Requirements 2.7, 6.7: the fulfilled `Failed` outcome is recorded exactly once
                // through the existing fatal path, naming the failing stage and its cause.
                expect(fatal).toHaveBeenCalledOnce();
                const [fatalMessage] = fatal.mock.calls[0] as [string];
                expect(fatalMessage).toContain(failingStage);
                expect(fatalMessage).toContain(`synthetic ${failingStage} failure`);
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                getuidSpy?.mockRestore();
                removeListenersAddedSince(restoreListeners);
                vi.clearAllTimers();
                vi.useRealTimers();
            }
        },
    );

    it(
        '[AR-6.7][AR-6.8] observes one 600000ms overdue for a pending recording-candidates-and-start, keeps ' +
            'reservation cleanup and EPG start at zero while pending, then advances exactly once when it settles late',
        async () => {
            vi.useFakeTimers();
            const restoreListeners = captureRuntimeListeners();
            const getuidSpy =
                typeof process.getuid === 'function' ? vi.spyOn(process, 'getuid').mockReturnValue(1_000) : undefined;

            let rebuildCalls = 0;
            let reservationCleanupCalls = 0;
            let epgStartCalls = 0;
            const overdue = vi.fn();
            const fatal = vi.fn();
            const pendingRebuild = createDeferred<void>();
            const StartupContinuationCoordinator = loadStartupContinuationCoordinator();
            const serviceChild = Object.assign(new EventEmitter(), { pid: 9_300, stderr: null, stdout: null });

            const container = {
                get: (identifier: string): unknown => {
                    switch (identifier) {
                        case 'IConfiguration':
                            return { getConfig: () => ({}) };
                        case 'IConnectionCheckModel':
                            return { checkDB: async () => undefined, checkMirakurun: async () => undefined };
                        case 'IEPGUpdateExecutorManageModel':
                            return {
                                execute: () => {
                                    epgStartCalls += 1;
                                },
                            };
                        case 'IEventSetter':
                            return { set: () => undefined };
                        case 'IIPCServer':
                            return { initialize: async () => undefined, register: () => undefined };
                        case 'ILoggerModel':
                            return {
                                getLogger: () => ({ system: { error: overdue, fatal, info: () => undefined } }),
                                initialize: () => undefined,
                            };
                        case 'IRecordingManageModel':
                            return {
                                cleanup: async () => undefined,
                                rebuildCandidatesAndStart: () => {
                                    rebuildCalls += 1;
                                    return pendingRebuild.promise;
                                },
                                setTuner: () => undefined,
                            };
                        case 'IReservationManageModel':
                            return {
                                cleanup: async () => {
                                    reservationCleanupCalls += 1;
                                },
                                setTuners: () => undefined,
                            };
                        case 'IRuntimeStartupWorkflowPort':
                            return new StartupContinuationCoordinator();
                        case 'IStorageManageModel':
                            return { start: () => undefined };
                        case 'TunerServerAccess':
                            return { getTuners: async () => [] };
                        default:
                            throw new Error(`Unexpected runtime dependency: ${identifier}`);
                    }
                },
            };

            try {
                await evaluateCompiledRuntime(container, () => serviceChild);
                // vi.waitFor advances the fake clock by `interval` on every poll, including the first
                // (node_modules/vitest/dist/chunks/vi.bdSIJ99Y.js:3728). The 599_999/600_000/600_001 boundary
                // checks below are relative to the moment the second stage's own observer timer is scheduled, so
                // draining up to that point must not itself consume any of that budget: interval: 0 keeps every
                // poll's fake-time advance at zero while still repeatedly draining pending microtasks.
                await vi.waitFor(() => expect(rebuildCalls).toBe(1), { interval: 0 });

                expect(vi.getTimerCount()).toBe(1);
                expect(reservationCleanupCalls).toBe(0);
                expect(epgStartCalls).toBe(0);

                await vi.advanceTimersByTimeAsync(599_999);
                expect(overdue).not.toHaveBeenCalled();

                await vi.advanceTimersByTimeAsync(1);
                expect(overdue).toHaveBeenCalledTimes(1);
                expect(reservationCleanupCalls).toBe(0);
                expect(epgStartCalls).toBe(0);
                expect(vi.getTimerCount()).toBe(0);
                expect(fatal).not.toHaveBeenCalled();

                pendingRebuild.resolve();
                await vi.waitFor(() => expect(epgStartCalls).toBe(1));
                await vi.advanceTimersByTimeAsync(0);

                expect(reservationCleanupCalls).toBe(1);
                expect(epgStartCalls).toBe(1);
                expect(overdue).toHaveBeenCalledTimes(1);
                expect(overdue).toHaveBeenCalledWith('startup stage overdue: recording-candidates-and-start');
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                getuidSpy?.mockRestore();
                removeListenersAddedSince(restoreListeners);
                vi.clearAllTimers();
                vi.useRealTimers();
            }
        },
    );

    it.each([
        {
            hangStage: 'recording-reconciliation' as const,
            overdueMessage: 'startup stage overdue: recording-reconciliation',
            title: 'recording-reconciliation',
        },
        {
            hangStage: 'expired-reservation-cleanup' as const,
            overdueMessage: 'startup stage overdue: expired-reservation-cleanup',
            title: 'expired-reservation-cleanup',
        },
    ])(
        '[AR-6.2][AR-6.7][AR-6.8] observes one 600000ms overdue for a pending $title through real Workflow composition',
        async ({ hangStage, overdueMessage }) => {
            vi.useFakeTimers();
            const restoreListeners = captureRuntimeListeners();
            const getuidSpy =
                typeof process.getuid === 'function' ? vi.spyOn(process, 'getuid').mockReturnValue(1_000) : undefined;

            let recordingCleanupCalls = 0;
            let rebuildCalls = 0;
            let reservationCleanupCalls = 0;
            let epgStartCalls = 0;
            const overdue = vi.fn();
            const fatal = vi.fn();
            const pendingHang = createDeferred<void>();
            const StartupContinuationCoordinator = loadStartupContinuationCoordinator();
            const serviceChild = Object.assign(new EventEmitter(), { pid: 9_310, stderr: null, stdout: null });

            const container = {
                get: (identifier: string): unknown => {
                    switch (identifier) {
                        case 'IConfiguration':
                            return { getConfig: () => ({}) };
                        case 'IConnectionCheckModel':
                            return { checkDB: async () => undefined, checkMirakurun: async () => undefined };
                        case 'IEPGUpdateExecutorManageModel':
                            return {
                                execute: () => {
                                    epgStartCalls += 1;
                                },
                            };
                        case 'IEventSetter':
                            return { set: () => undefined };
                        case 'IIPCServer':
                            return { initialize: async () => undefined, register: () => undefined };
                        case 'ILoggerModel':
                            return {
                                getLogger: () => ({ system: { error: overdue, fatal, info: () => undefined } }),
                                initialize: () => undefined,
                            };
                        case 'IRecordingManageModel':
                            return {
                                cleanup: () => {
                                    recordingCleanupCalls += 1;
                                    if (hangStage === 'recording-reconciliation') {
                                        return pendingHang.promise;
                                    }
                                    return Promise.resolve();
                                },
                                rebuildCandidatesAndStart: () => {
                                    rebuildCalls += 1;
                                    return Promise.resolve();
                                },
                                setTuner: () => undefined,
                            };
                        case 'IReservationManageModel':
                            return {
                                cleanup: () => {
                                    reservationCleanupCalls += 1;
                                    if (hangStage === 'expired-reservation-cleanup') {
                                        return pendingHang.promise;
                                    }
                                    return Promise.resolve();
                                },
                                setTuners: () => undefined,
                            };
                        case 'IRuntimeStartupWorkflowPort':
                            return new StartupContinuationCoordinator();
                        case 'IStorageManageModel':
                            return { start: () => undefined };
                        case 'TunerServerAccess':
                            return { getTuners: async () => [] };
                        default:
                            throw new Error(`Unexpected runtime dependency: ${identifier}`);
                    }
                },
            };

            try {
                await evaluateCompiledRuntime(container, () => serviceChild);

                if (hangStage === 'recording-reconciliation') {
                    await vi.waitFor(() => expect(recordingCleanupCalls).toBe(1), { interval: 0 });
                    expect(rebuildCalls).toBe(0);
                    expect(reservationCleanupCalls).toBe(0);
                    expect(epgStartCalls).toBe(0);
                } else {
                    await vi.waitFor(() => expect(reservationCleanupCalls).toBe(1), { interval: 0 });
                    expect(recordingCleanupCalls).toBe(1);
                    expect(rebuildCalls).toBe(1);
                    expect(epgStartCalls).toBe(0);
                }

                expect(vi.getTimerCount()).toBe(1);

                await vi.advanceTimersByTimeAsync(599_999);
                expect(overdue).not.toHaveBeenCalled();

                await vi.advanceTimersByTimeAsync(1);
                expect(overdue).toHaveBeenCalledTimes(1);
                expect(overdue).toHaveBeenCalledWith(overdueMessage);
                expect(epgStartCalls).toBe(0);
                expect(vi.getTimerCount()).toBe(0);
                expect(fatal).not.toHaveBeenCalled();

                pendingHang.resolve();
                await vi.waitFor(() => expect(epgStartCalls).toBe(1));
                await vi.advanceTimersByTimeAsync(0);

                expect(recordingCleanupCalls).toBe(1);
                expect(rebuildCalls).toBe(1);
                expect(reservationCleanupCalls).toBe(1);
                expect(epgStartCalls).toBe(1);
                expect(overdue).toHaveBeenCalledTimes(1);
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                getuidSpy?.mockRestore();
                removeListenersAddedSince(restoreListeners);
                vi.clearAllTimers();
                vi.useRealTimers();
            }
        },
    );
});

describe('compiled runtime restart supervision combined with real process-messaging', () => {
    type ServiceRuntimeChild = EventEmitter & {
        readonly pid: number;
        readonly send: ReturnType<typeof vi.fn>;
        readonly stderr: null;
        readonly stdout: null;
    };

    it(
        '[AR-5.2][AR-5.3][AR-5.4][AR-8.2][AR-8.3][AR-8.6][AR-9.6] replaces the Service child registered as the real ' +
            'IPCServer current peer across repeated exit/error restarts while a stale old child’s late ' +
            'terminal and message never redirect notifications away from the current child',
        async () => {
            vi.useFakeTimers();
            const restoreListeners = captureRuntimeListeners();
            const rootIdentity = overrideRootIdentityForTest(() => undefined);
            const ipcLogErrors: string[] = [];
            const server = buildRealIpcServer(message => ipcLogErrors.push(message));
            const StartupContinuationCoordinator = loadStartupContinuationCoordinator();

            const serviceChildren: ServiceRuntimeChild[] = [];
            const createServiceChild = (): ServiceRuntimeChild => {
                const child = Object.assign(new EventEmitter(), {
                    pid: 9_400 + serviceChildren.length,
                    send: vi.fn((_message: unknown, callback?: (error: Error | null) => void) => {
                        callback?.(null);
                        return true;
                    }),
                    stderr: null,
                    stdout: null,
                }) as ServiceRuntimeChild;
                serviceChildren.push(child);
                return child;
            };

            const container = {
                get: (identifier: string): unknown => {
                    switch (identifier) {
                        case 'IConfiguration':
                            return { getConfig: () => ({}) };
                        case 'IConnectionCheckModel':
                            return { checkDB: async () => undefined, checkMirakurun: async () => undefined };
                        case 'IEPGUpdateExecutorManageModel':
                            return { execute: () => undefined };
                        case 'IEventSetter':
                            return { set: () => undefined };
                        case 'IIPCServer':
                            return server;
                        case 'ILoggerModel':
                            return {
                                getLogger: () => ({
                                    system: { error: () => undefined, fatal: () => undefined, info: () => undefined },
                                }),
                                initialize: () => undefined,
                            };
                        case 'IRecordingManageModel':
                            return {
                                cleanup: async () => undefined,
                                rebuildCandidatesAndStart: async () => undefined,
                                setTuner: () => undefined,
                            };
                        case 'IReservationManageModel':
                            return { cleanup: async () => undefined, setTuners: () => undefined };
                        case 'IRuntimeStartupWorkflowPort':
                            return new StartupContinuationCoordinator();
                        case 'IStorageManageModel':
                            return { start: () => undefined };
                        case 'TunerServerAccess':
                            return { getTuners: async () => [] };
                        default:
                            throw new Error(`Unexpected runtime dependency: ${identifier}`);
                    }
                },
            };

            const notifyAndCapture = (): ServiceRuntimeChild[] => {
                for (const child of serviceChildren) child.send.mockClear();
                server.notifyClient();
                return serviceChildren.filter(child => child.send.mock.calls.length > 0);
            };

            try {
                await evaluateCompiledRuntime(container, createServiceChild);
                await vi.waitFor(() => expect(serviceChildren).toHaveLength(1));
                await vi.advanceTimersByTimeAsync(0);
                expect(vi.getTimerCount()).toBe(0);

                const [generationOne] = serviceChildren;
                if (generationOne === undefined) throw new Error('Runtime did not spawn its initial Service child');
                expect(notifyAndCapture()).toEqual([generationOne]);

                generationOne.emit('exit', 1, null);
                await vi.advanceTimersByTimeAsync(0);
                expect(vi.getTimerCount()).toBe(0);
                expect(serviceChildren).toHaveLength(2);

                const [, generationTwo] = serviceChildren;
                if (generationTwo === undefined) throw new Error('Runtime did not spawn its first replacement child');
                expect(generationOne.listenerCount('message')).toBe(0);
                expect(notifyAndCapture()).toEqual([generationTwo]);

                expect(() =>
                    generationOne.emit('message', { func: 'getBroadcastStatus', id: 1, model: 'reservation' }),
                ).not.toThrow();
                expect(notifyAndCapture()).toEqual([generationTwo]);

                generationTwo.emit('error', new Error('synthetic service error'));
                await vi.advanceTimersByTimeAsync(0);
                expect(vi.getTimerCount()).toBe(0);
                expect(serviceChildren).toHaveLength(3);

                const [, , generationThree] = serviceChildren;
                if (generationThree === undefined) {
                    throw new Error('Runtime did not spawn its second replacement child');
                }
                expect(generationTwo.listenerCount('message')).toBe(0);
                expect(notifyAndCapture()).toEqual([generationThree]);

                expect(() => {
                    generationOne.emit('close', 1, null);
                    generationOne.emit('message', { func: 'getBroadcastStatus', id: 2, model: 'reservation' });
                    generationTwo.emit('close', 1, null);
                    generationTwo.emit('message', { func: 'getBroadcastStatus', id: 3, model: 'reservation' });
                }).not.toThrow();
                expect(notifyAndCapture()).toEqual([generationThree]);
                expect(ipcLogErrors).toEqual([]);
            } finally {
                rootIdentity.restore();
                removeListenersAddedSince(restoreListeners);
                for (const child of serviceChildren) child.removeAllListeners();
                vi.clearAllTimers();
                vi.useRealTimers();
            }
        },
    );

    it(
        '[AR-7.1][AR-7.2][AR-7.4][AR-8.4][AR-8.5][AR-8.6][AR-8.7][AR-9.6] restarts the EPG child across repeated ' +
            'terminal events through the real EPGUpdateEvent, keeping Web/API acceptance, cleanup, EPG start, and ' +
            'the first update as separate observation points while a stale old child never redelivers an update',
        async () => {
            vi.useFakeTimers();
            const restoreListeners = captureRuntimeListeners();
            const rootIdentity = overrideRootIdentityForTest(() => undefined);
            const childProcess = compiledModuleRequire('child_process') as typeof import('node:child_process');

            type EpgRuntimeChild = EventEmitter & {
                readonly kill: ReturnType<typeof vi.fn>;
                readonly pid: number;
                readonly stderr: PassThrough;
                readonly stdout: PassThrough;
            };
            const epgChildren: EpgRuntimeChild[] = [];
            const createEpgChild = (): EpgRuntimeChild => {
                const child = Object.assign(new EventEmitter(), {
                    kill: vi.fn(() => true),
                    pid: 9_500 + epgChildren.length,
                    stderr: new PassThrough(),
                    stdout: new PassThrough(),
                }) as EpgRuntimeChild;
                epgChildren.push(child);
                return child;
            };
            // compile 済み module は ESM として child_process を取り込むため、require で得た
            // 名前空間への差し替えは届かない。読み込み側の解決ごと差し替える。
            const spawnSpy = vi.fn(() => createEpgChild() as never);
            vi.doMock('node:child_process', () => ({ ...childProcess, spawn: spawnSpy }));
            vi.doMock('child_process', () => ({ ...childProcess, spawn: spawnSpy }));
            const processKillSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

            const ledger: string[] = [];
            const record = (operation: string): void => {
                ledger.push(operation);
            };
            const EpgUpdateEvent = loadEpgUpdateEvent();
            const epgUpdateEvent = new EpgUpdateEvent({
                getLogger: () => ({ system: { error: () => undefined } }),
            });
            vi.resetModules();
            const EpgSupervisor = (
                (await import(
                    pathToFileURL(
                        join(compiledSnapshotRoot(), 'model', 'epgUpdater', 'EPGUpdateExecutorManageModel.js'),
                    ).href
                )) as {
                    readonly default: new (
                        loggerModel: unknown,
                        epgUpdateEvent: unknown,
                    ) => { execute(): Promise<void> };
                }
            ).default;
            const epgSupervisor = new EpgSupervisor(
                {
                    getLogger: () => ({
                        system: { error: () => undefined, fatal: () => undefined, info: () => undefined },
                    }),
                },
                epgUpdateEvent,
            );
            const updatedCallback = vi.fn(() => record('epg-updated'));
            const serviceChild = Object.assign(new EventEmitter(), { pid: 9_600, stderr: null, stdout: null });
            const StartupContinuationCoordinator = loadStartupContinuationCoordinator();

            const container = {
                get: (identifier: string): unknown => {
                    switch (identifier) {
                        case 'IConfiguration':
                            return { getConfig: () => ({}) };
                        case 'IConnectionCheckModel':
                            return { checkDB: async () => undefined, checkMirakurun: async () => undefined };
                        case 'IEPGUpdateExecutorManageModel':
                            return epgSupervisor;
                        case 'IEventSetter':
                            return {
                                set: () => {
                                    record('event-binding');
                                    epgUpdateEvent.setUpdated(updatedCallback);
                                },
                            };
                        case 'IIPCServer':
                            return {
                                initialize: async () => record('ipc-initialize'),
                                register: () => record('ipc-register'),
                            };
                        case 'ILoggerModel':
                            return {
                                getLogger: () => ({
                                    system: { error: () => undefined, fatal: () => undefined, info: () => undefined },
                                }),
                                initialize: () => undefined,
                            };
                        case 'IRecordingManageModel':
                            return {
                                cleanup: async () => record('recording-reconciliation'),
                                rebuildCandidatesAndStart: async () => record('recording-candidates-and-start'),
                                setTuner: () => undefined,
                            };
                        case 'IReservationManageModel':
                            return { cleanup: async () => record('reservation-cleanup'), setTuners: () => undefined };
                        case 'IRuntimeStartupWorkflowPort':
                            return new StartupContinuationCoordinator();
                        case 'IStorageManageModel':
                            return { start: () => undefined };
                        case 'TunerServerAccess':
                            return { getTuners: async () => [] };
                        default:
                            throw new Error(`Unexpected runtime dependency: ${identifier}`);
                    }
                },
            };

            try {
                await evaluateCompiledRuntime(container, () => serviceChild);
                await vi.waitFor(() => expect(epgChildren).toHaveLength(1));
                await vi.advanceTimersByTimeAsync(0);
                expect(vi.getTimerCount()).toBe(0);

                const [generationOne] = epgChildren;
                if (generationOne === undefined) throw new Error('Runtime did not spawn its initial EPG child');
                expect(generationOne.stdout.listenerCount('data')).toBe(1);
                expect(generationOne.stderr.listenerCount('data')).toBe(1);

                expect(ledger.filter(operation => operation === 'ipc-register')).toHaveLength(1);
                expect(ledger.filter(operation => operation === 'recording-reconciliation')).toHaveLength(1);
                expect(ledger.filter(operation => operation === 'epg-updated')).toEqual([]);
                expect(ledger).not.toContain('ready');

                generationOne.emit('message', { msg: 'updated' });
                expect(updatedCallback).toHaveBeenCalledTimes(1);
                expect(ledger.filter(operation => operation === 'epg-updated')).toHaveLength(1);

                generationOne.stdout.write('epg-stdout');
                generationOne.stderr.write('epg-stderr');
                expect(generationOne.stdout.readableLength).toBe(0);
                expect(generationOne.stderr.readableLength).toBe(0);

                generationOne.emit('close', 1, null);
                await vi.advanceTimersByTimeAsync(0);
                expect(vi.getTimerCount()).toBe(0);
                expect(epgChildren).toHaveLength(2);
                expect(generationOne.stdout.listenerCount('data')).toBe(0);
                expect(generationOne.stderr.listenerCount('data')).toBe(0);
                expect(generationOne.listenerCount('message')).toBe(0);
                expect(generationOne.kill).not.toHaveBeenCalled();

                const [, generationTwo] = epgChildren;
                if (generationTwo === undefined) {
                    throw new Error('Runtime did not spawn its first replacement EPG child');
                }

                expect(() => generationOne.emit('message', { msg: 'updated' })).not.toThrow();
                expect(updatedCallback).toHaveBeenCalledTimes(1);
                expect(ledger.filter(operation => operation === 'epg-updated')).toHaveLength(1);

                generationTwo.emit('disconnect');
                await vi.advanceTimersByTimeAsync(0);
                expect(vi.getTimerCount()).toBe(0);
                expect(epgChildren).toHaveLength(3);
                expect(generationTwo.kill).toHaveBeenCalledExactlyOnceWith('SIGINT');

                const [, , generationThree] = epgChildren;
                if (generationThree === undefined) {
                    throw new Error('Runtime did not spawn its second replacement EPG child');
                }

                generationThree.emit('message', { msg: 'updated' });
                expect(updatedCallback).toHaveBeenCalledTimes(2);
                expect(ledger.filter(operation => operation === 'epg-updated')).toHaveLength(2);

                expect(spawnSpy).toHaveBeenCalledTimes(3);
                expect(processKillSpy).not.toHaveBeenCalled();
            } finally {
                spawnSpy.mockRestore();
                processKillSpy.mockRestore();
                rootIdentity.restore();
                removeListenersAddedSince(restoreListeners);
                for (const child of epgChildren) {
                    child.removeAllListeners();
                    child.stdout.removeAllListeners();
                    child.stderr.removeAllListeners();
                    child.stdout.destroy();
                    child.stderr.destroy();
                }
                vi.clearAllTimers();
                vi.useRealTimers();
            }
        },
    );
});

// AR-9.6 (`integration/runtime-boundaries.integration.test.ts#AR-9.6`, Requirement 9 AC6;
// tasks.md 9.6: "tuner HTTP、SQLite/MySQL、Service/EPG child、IPC、startup filesystem整理をowner公開
// port経由で接続する... 全境界とfailure cleanupが成功し、owner内部複製・production/config変更が各0件").
//
// This block does not read THIS FILE'S OWN SOURCE (`readFile(new URL(import.meta.url))`) to assert
// that tokens such as `buildRealIpcServer` and `600000ms` appear in it: a file grepping itself for a
// string it contains cannot fail, and it observes nothing about whether the boundaries run
// (converting all six `it(`/`it.each(` calls in the section above to `it.skip(` would leave such a
// block green). Nor does it declare a KNOWN GAP (no SQLite/MySQL, no tuner HTTP) as though declaring
// it discharged it.
//
// The tuner HTTP and SQLite/MySQL boundaries are genuinely connected, and both go through
// the OWNER'S PUBLIC PRODUCTION PORT out of the compiled snapshot rather than a Runtime-local
// re-implementation (tasks.md 9.6: "owner内部複製0"):
//
//   tuner HTTP   real `TunerServerAccessModel` (server-tuner-access' own compiled class) pointed at
//                a real local `node:http` server, driven through the real compiled
//                `ConnectionCheckModel.checkMirakurun()` -- Runtime's actual dependency-wait port.
//   SQLite       real `DBOperator` (server-persistence' own compiled class) driven through the real
//                compiled `ConnectionCheckModel.checkDB()`. Its sqlite path resolves relative to the
//                compiled snapshot root, so the database file lands inside the gitignored
//                `test/server/.artifacts/` snapshot and is disposed with it -- no tracked file moves.
//
//   MySQL        real `mysql`-protocol server in an ephemeral, loopback-only container, driven
//                through the same real `DBOperator` mysql code path. When no container runtime
//                exists the case is reported SKIPPED, never passed.
//   fs           real `VideoUtil` + `RecordingUtilModel` (server-recorded-content's own compiled
//                classes) performing the real startup tidy filesystem read against real files in a
//                real temporary directory.
//
// DECLARED LIMITATION for the fs boundary (recorded here rather than left implicit): AC6 names
// 「録画済み番組管理機能を介した起動時のfilesystem整理」. The full startup tidy entry point is
// `RecordingManageModel.cleanup()`, which is DB-record driven and would require the recorded/reserve
// repository fixtures owned by server-persistence and server-recorded-content. What is connected
// here is the filesystem half of that same tidy path -- the owner's real `VideoUtil` parent-directory
// resolution and the owner's real `RecordingUtilModel.updateVideoFileSize`, which performs the real
// `fs.stat` that `cleanup()` invokes per recovered video file -- against real files on disk. The
// DB-record-driven traversal of `cleanup()` itself is NOT exercised by this leaf.

interface LoggerPortDouble {
    getLogger(): unknown;
}

const silentLoggerPort = (): LoggerPortDouble => {
    const sink = {
        debug: () => undefined,
        error: () => undefined,
        fatal: () => undefined,
        info: () => undefined,
        warn: () => undefined,
    };
    return { getLogger: () => ({ access: sink, stream: sink, system: sink }) };
};

const sqliteConfigurationPort = () => ({ getConfig: () => ({ dbtype: 'sqlite' }) });

/**
 * `ConnectionCheckModel.checkDB()`/`checkMirakurun()` retry forever by design (Runtime waits on its
 * dependencies without an overall deadline -- see AR-3.6/AR-3.7). A test must therefore bound them
 * itself, otherwise a boundary that never connects is reported as an opaque suite timeout instead of
 * a failed boundary.
 */
function watchMysqlBoundaryContainer(
    runtime: string,
    containerName: string,
): { readonly lost: Promise<string>; stop(): void } {
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    const lost = new Promise<string>(resolve => {
        const tick = (): void => {
            if (stopped) {
                return;
            }
            void runCommand(runtime, ['inspect', '--format', '{{.State.Status}}', containerName], 5_000).then(state => {
                if (stopped) {
                    return;
                }
                if (state.timedOut) {
                    // The `inspect` call itself did not answer within 5s (a busy daemon, not
                    // evidence about the container). Treating this as "lost" is exactly the
                    // misclassification that discarded a live container; keep watching instead.
                    timer = setTimeout(tick, 1_000);
                    return;
                }
                const alive =
                    state.code === 0 && (state.stdout.startsWith('running') || state.stdout.startsWith('restarting'));
                if (!alive) {
                    resolve(state.stdout || state.stderr || 'missing');
                    return;
                }
                timer = setTimeout(tick, 1_000);
            });
        };
        timer = setTimeout(tick, 1_000);
    });
    return {
        lost,
        stop() {
            stopped = true;
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        },
    };
}

async function withinDeadline<T>(label: string, deadlineMs: number, work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_, failed) => {
                timer = setTimeout(
                    () => failed(new Error(`${label} did not settle within ${deadlineMs}ms`)),
                    deadlineMs,
                );
            }),
        ]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

interface TunerServerAccessLike {
    checkAvailability(): Promise<void>;
}

const loadTunerServerAccessModel = (): new (connectionTarget: string, userAgent: string) => TunerServerAccessLike =>
    (
        compiledModuleRequire(join(compiledSnapshotRoot(), 'model', 'tuner', 'TunerServerAccessModel.js')) as {
            readonly default: new (connectionTarget: string, userAgent: string) => TunerServerAccessLike;
        }
    ).default;

interface DbOperatorLike {
    checkConnection(): Promise<void>;
    closeConnection(): Promise<void>;
}

const loadDbOperator = (): new (logger: unknown, configuration: unknown) => DbOperatorLike =>
    (
        compiledModuleRequire(join(compiledSnapshotRoot(), 'model', 'db', 'DBOperator.js')) as {
            readonly default: new (logger: unknown, configuration: unknown) => DbOperatorLike;
        }
    ).default;

/**
 * Ephemeral local MySQL-protocol server for the AR-9.6 MySQL boundary.
 *
 * Constraints honoured deliberately: the container is bound to 127.0.0.1 only, its root password is
 * generated per run and never written to any file or env file, and it is force-removed in a
 * `finally`. No private-network host is contacted and no credential is persisted.
 *
 * MEASURED CONSTRAINT (why MariaDB rather than mysql:8.x): EPGStation pins the `mysql@2.18.1`
 * driver, which predates `caching_sha2_password`. Against `mysql:8.4` the owner's own DBOperator
 * fails with `ER_NOT_SUPPORTED_AUTH_MODE: Client does not support authentication protocol requested
 * by server`. MariaDB speaks the same wire protocol through the same pinned driver and still
 * defaults to `mysql_native_password`, so it exercises the real MySQL code path of `DBOperator`
 * (`type: 'mysql'`, the mysql migration set, `migrationsRun: true`) rather than a substitute path.
 */
const MYSQL_BOUNDARY_IMAGE = 'mariadb:10.11';
const MYSQL_BOUNDARY_DATABASE = 'epgstation_ar917';
const MYSQL_BOUNDARY_USER = 'test-boundary';

const runCommand = async (
    command: string,
    args: readonly string[],
    timeoutMs: number,
): Promise<{
    readonly code: number | null;
    readonly stderr: string;
    readonly stdout: string;
    /** This command itself was SIGKILLed for exceeding `timeoutMs`; `code`/`stdout` say nothing
     *  about the thing it was inspecting (e.g. a container) and must not be read as evidence about it. */
    readonly timedOut: boolean;
}> => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout?.setEncoding('utf8').on('data', chunk => {
        stdout += chunk as string;
    });
    child.stderr?.setEncoding('utf8').on('data', chunk => {
        stderr += chunk as string;
        if (stderr.length > 8_000) {
            stderr = stderr.slice(-4_000);
        }
    });
    // A missing binary emits `error` (ENOENT) and never emits `close`. Awaiting only `close` would
    // therefore turn "this machine has no container runtime" into an unhandled ENOENT failure --
    // measured exactly that way (`Error: spawn <binary> ENOENT`).
    const failedToSpawn = once(child, 'error').then(() => ({
        code: null as number | null,
        stderr: '',
        stdout: '',
    }));
    const finished = once(child, 'close').then(([code]) => ({
        code: code as number | null,
        stderr,
        stdout,
    }));
    const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
    }, timeoutMs);
    try {
        const settled = await Promise.race([finished, failedToSpawn]);
        return { code: settled.code, stderr: settled.stderr.trim(), stdout: settled.stdout.trim(), timedOut };
    } finally {
        clearTimeout(timer);
        child.removeAllListeners();
    }
};

/** Returns the usable container runtime binary, or `undefined` when none can run. */
async function mysqlContainerRuntime(): Promise<string | undefined> {
    for (const candidate of ['docker', 'podman']) {
        const probe = await runCommand(candidate, ['info'], 30_000);
        if (probe.code === 0) {
            const image = await runCommand(candidate, ['image', 'inspect', MYSQL_BOUNDARY_IMAGE], 30_000);
            if (image.code === 0) {
                return candidate;
            }
        }
    }
    return undefined;
}

interface EphemeralMysqlServer {
    readonly containerName: string;
    readonly rootPassword: string;
    readonly port: number;
    stop(): Promise<void>;
}

interface ContainerEventWatch {
    snapshot(): readonly string[];
    stop(): void;
}

/**
 * Records `docker`/`podman events` for one container name in the background, so a failure can show
 * who ended its life (the daemon's own `--rm` reap, an OOM kill, or an external `rm`/`kill`) and
 * when, via `Actor.Attributes`. Best-effort: a recorder that cannot start must not affect the
 * boundary it is watching, so every failure here is swallowed and simply yields no events.
 */
const watchContainerEvents = (runtime: string, containerName: string): ContainerEventWatch => {
    const lines: string[] = [];
    let child: ChildProcess | undefined;
    try {
        child = spawn(runtime, ['events', '--filter', `container=${containerName}`, '--format', '{{json .}}'], {
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        let buffer = '';
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
            buffer += chunk;
            const parts = buffer.split('\n');
            buffer = parts.pop() ?? '';
            for (const part of parts) {
                const trimmed = part.trim();
                if (trimmed.length > 0) {
                    lines.push(trimmed);
                    if (lines.length > 50) {
                        lines.shift();
                    }
                }
            }
        });
        child.on('error', () => undefined);
    } catch {
        child = undefined;
    }
    return {
        snapshot: () => [...lines],
        stop: () => {
            try {
                child?.kill();
            } catch {
                // Already gone; nothing to do.
            }
        },
    };
};

async function startEphemeralMysqlServer(runtime: string): Promise<EphemeralMysqlServer> {
    const { randomBytes } = await import('node:crypto');
    const password = randomBytes(24).toString('base64url');
    const name = `ar-9-17-mysql-${randomBytes(6).toString('hex')}`;
    const launchedNames = [name];

    const started = await runCommand(
        runtime,
        [
            'run',
            '-d',
            // No `--rm`: a container that dies before `stop()` runs must stay in place so the
            // diagnostics below (`docker inspect`/`docker logs`) can still see why, instead of the
            // daemon silently reaping it out from under a caller that only ever saw ECONNREFUSED.
            '--name',
            name,
            '--label',
            'epgstation.test=ar-9-17',
            '-e',
            `MARIADB_ROOT_PASSWORD=${password}`,
            '-e',
            `MARIADB_DATABASE=${MYSQL_BOUNDARY_DATABASE}`,
            '-p',
            '127.0.0.1:0:3306',
            MYSQL_BOUNDARY_IMAGE,
        ],
        120_000,
    );
    // `stop()` below verifies removal by state (`container inspect` exits non-zero once the
    // container is truly gone) and retries `rm -f` until it does, so a cleanup that does not take
    // effect still fails the test instead of leaking silently.
    const isRemoved = async (containerName: string): Promise<boolean> => {
        const inspected = await runCommand(runtime, ['container', 'inspect', containerName], 15_000);
        return inspected.code !== 0;
    };
    const stop = async (): Promise<void> => {
        for (const containerName of launchedNames) {
            const deadline = Date.now() + 60_000;
            let removed = await isRemoved(containerName);
            while (!removed && Date.now() < deadline) {
                await runCommand(runtime, ['rm', '-f', containerName], 20_000);
                removed = await isRemoved(containerName);
                if (!removed) {
                    await new Promise(tick => setTimeout(tick, 500));
                }
            }
            if (!removed) {
                throw new Error(
                    `AR-9.6: the ephemeral MySQL boundary container ${containerName} was still present after the cleanup ` +
                        'deadline (docker/podman rm -f did not take effect -- this must never leak silently)',
                );
            }
        }
    };
    if (started.code !== 0) {
        await stop();
        throw new Error(
            `AR-9.6: could not start the ephemeral MySQL boundary container (${MYSQL_BOUNDARY_IMAGE}): ${started.stderr}`,
        );
    }

    const events = watchContainerEvents(runtime, name);
    try {
        const published = await runCommand(runtime, ['port', name, '3306/tcp'], 30_000);
        const port = Number(published.stdout.split('\n')[0]?.split(':').pop());
        if (!Number.isInteger(port) || port <= 0) {
            throw new Error('AR-9.6: the ephemeral MySQL boundary container published no TCP port');
        }

        const readyBy = Date.now() + 120_000;
        let ready = false;
        let lastPingStderr = '';
        let containerNote = '';
        while (!ready && Date.now() < readyBy) {
            const ping = await runCommand(
                runtime,
                ['exec', name, 'mariadb-admin', 'ping', '-h', '127.0.0.1', '-uroot', `-p${password}`, '--silent'],
                20_000,
            );
            lastPingStderr = ping.stderr;
            ready = ping.code === 0;
            if (ready) {
                break;
            }
            const state = await runCommand(
                runtime,
                ['inspect', '--format', '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}', name],
                15_000,
            );
            if (state.timedOut) {
                // `inspect` itself did not answer in 15s -- a busy daemon, not evidence the
                // container died. Keep pinging within the same 120s window instead of treating an
                // unanswered probe as a death and starting a second container over it.
                await new Promise(tick => setTimeout(tick, 500));
                continue;
            }
            const alive =
                state.code === 0 && (state.stdout.startsWith('running') || state.stdout.startsWith('restarting'));
            if (!alive) {
                // The container is genuinely gone or stopped. No replacement: this is the failure
                // to report, with whatever the container left behind (logs, exit state, and the
                // `docker events` recorded since launch -- who removed/killed it and when).
                const logs = await runCommand(runtime, ['logs', '--tail', '40', name], 15_000);
                containerNote = `status=${state.stdout || state.stderr} ping=${lastPingStderr} logs=${logs.stdout || logs.stderr} events=${events.snapshot().join(' | ') || '(none)'}`;
                break;
            }
            await new Promise(tick => setTimeout(tick, 500));
        }
        if (!ready) {
            if (containerNote.length === 0) {
                const state = await runCommand(
                    runtime,
                    [
                        'inspect',
                        '--format',
                        '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}',
                        name,
                    ],
                    15_000,
                );
                const logs = await runCommand(runtime, ['logs', '--tail', '40', name], 15_000);
                containerNote = `status=${state.stdout || state.stderr} logs=${logs.stdout || logs.stderr} events=${events.snapshot().join(' | ') || '(none)'}`;
            }
            throw new Error(
                `AR-9.6: the ephemeral MySQL boundary container never became ready\n${containerNote}\nlast ping: ${lastPingStderr}`,
            );
        }

        const created = await runCommand(
            runtime,
            [
                'exec',
                name,
                'mariadb',
                '-h',
                '127.0.0.1',
                '-uroot',
                `-p${password}`,
                '-e',
                `CREATE USER '${MYSQL_BOUNDARY_USER}'@'%' IDENTIFIED BY '${password}'; GRANT ALL PRIVILEGES ON \`${MYSQL_BOUNDARY_DATABASE}\`.* TO '${MYSQL_BOUNDARY_USER}'@'%'; FLUSH PRIVILEGES;`,
            ],
            20_000,
        );
        if (created.code !== 0) {
            throw new Error('AR-9.6: could not create the synthetic MySQL boundary account');
        }

        events.stop();
        return { containerName: name, rootPassword: password, port, stop };
    } catch (error) {
        events.stop();
        await stop();
        throw error;
    }
}

describe('Runtime connects every required external boundary through its owner’s public port', () => {
    it('[AR-9.6] tuner HTTP boundary: the real compiled ConnectionCheckModel reaches a real HTTP tuner endpoint through the real compiled TunerServerAccessModel, retries a failure, and leaves no open socket', async () => {
        const { createServer } = await import('node:http');
        const requestPaths: string[] = [];
        let failuresRemaining = 2;

        const tunerServer = createServer((request, response) => {
            requestPaths.push(request.url ?? '');
            if (failuresRemaining > 0) {
                failuresRemaining -= 1;
                // Real HTTP failure on the real socket, not a rejected stub promise.
                response.writeHead(503, { 'content-type': 'application/json' });
                response.end('{"error":"tuner unavailable"}');
                return;
            }
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ version: { current: '3.9.0', latest: '3.9.0' } }));
        });
        try {
            tunerServer.listen(0, '127.0.0.1');
            await once(tunerServer, 'listening');
            const address = tunerServer.address();
            if (address === null || typeof address === 'string') {
                throw new Error('AR-9.6: tuner boundary server did not bind a TCP port');
            }

            const TunerServerAccessModel = loadTunerServerAccessModel();
            const tunerServerAccess = new TunerServerAccessModel(
                `http://127.0.0.1:${address.port}`,
                'EPGStation-AR-9.6',
            );

            // Runtime's own public dependency-wait port, from the compiled snapshot.
            const ConnectionCheckModel = loadConnectionCheckModel();
            const connectionCheck = new ConnectionCheckModel(silentLoggerPort(), tunerServerAccess, {
                checkConnection: async () => undefined,
            });

            await withinDeadline('checkMirakurun', 30_000, connectionCheck.checkMirakurun());

            // Two real 503 responses had to be absorbed before the real 200 was accepted: the
            // boundary was genuinely exercised on both the failure and the success path.
            expect(requestPaths.length).toBeGreaterThanOrEqual(3);
            expect(new Set(requestPaths)).toEqual(new Set(['/api/status']));
            expect(failuresRemaining).toBe(0);

            // Socket teardown is asynchronous, so poll to zero with a bounded deadline: a genuine
            // leaked connection never drains and still fails here.
            const countConnections = async (): Promise<number> =>
                new Promise<number>((settled, failed) => {
                    tunerServer.getConnections((error, count) => (error === null ? settled(count) : failed(error)));
                });
            const drainExpiry = Date.now() + 10_000;
            let openConnections = await countConnections();
            while (openConnections > 0 && Date.now() < drainExpiry) {
                await new Promise(tick => setTimeout(tick, 25));
                openConnections = await countConnections();
            }
            expect(openConnections).toBe(0);
        } finally {
            await new Promise<void>(closed => tunerServer.close(() => closed()));
        }
        expect(tunerServer.listening).toBe(false);
    }, 120_000);

    it('[AR-9.6] SQLite boundary: the real compiled ConnectionCheckModel opens a real SQLite database through the real compiled DBOperator and releases the connection on close', async () => {
        const DBOperator = loadDbOperator();
        const dbOperator = new DBOperator(silentLoggerPort(), sqliteConfigurationPort());

        const ConnectionCheckModel = loadConnectionCheckModel();
        const connectionCheck = new ConnectionCheckModel(
            silentLoggerPort(),
            { checkAvailability: async () => undefined },
            dbOperator,
        );

        try {
            // Real connection + real `select 1` against a real sqlite file, through the owner class.
            await withinDeadline('checkDB (first)', 60_000, connectionCheck.checkDB());
            // Idempotent re-check reuses the same owner-held connection rather than opening a second.
            await withinDeadline('checkDB (repeat)', 60_000, connectionCheck.checkDB());
        } finally {
            await dbOperator.closeConnection();
        }

        // THIS ASSERT RECORDS THE CURRENT BEHAVIOUR. IT DOES NOT DEFINE THE DESIRED CONTRACT.
        //
        // Position: this is a known product lifecycle defect; the post-close contract is unspecified;
        // remediation is deferred; it is not a critical-path blocker.
        // It must not be read as fixing post-close semantics as correct: whether a released DBOperator should be REOPENABLE (build a fresh DataSource) or TERMINAL
        // (reject with a typed error) is undefined in Requirements, Design and `IDBOperator` alike,
        // and that concurrent close, post-destroy-failure state, single-flight, SQLite extension
        // re-initialisation and ownership all remain unspecified. A drive-by `this.connection = null`
        // is explicitly forbidden. When the owner defines the contract, this assertion is EXPECTED to
        // go RED and must be rewritten to the chosen contract rather than preserved.
        //
        // OBSERVED, EVIDENCED CROSS-SPEC CHARACTERISTIC (server-persistence owns
        // `src/model/db/DBOperator.ts`; this leaf may not change `src/**`, so it records the real
        // behaviour instead of asserting a behaviour the owner does not provide):
        //   `closeConnection()` destroys the DataSource but does NOT reset `this.connection` to
        //   null, and `getConnection()` returns `this.connection` unconditionally when it is
        //   non-null. A released DBOperator therefore hands back a DESTROYED DataSource forever, so
        //   `checkConnection()` rejects permanently and `ConnectionCheckModel.checkDB()` -- which
        //   retries without an overall deadline -- never settles again. Measured: `checkDB (after
        //   release) did not settle within 60000ms`.
        // This is asserted (not narrated) so it must go RED the moment the owner makes release
        // re-connectable, at which point this leaf and the owner spec can be reconciled.
        await expect(dbOperator.checkConnection()).rejects.toThrow();
    }, 180_000);

    it('[AR-9.6] SQLite boundary failure cleanup: a rejected query surfaces the failure and the owner connection is still released, leaving no open DataSource', async () => {
        const DBOperator = loadDbOperator();
        const dbOperator = new DBOperator(silentLoggerPort(), sqliteConfigurationPort()) as DbOperatorLike & {
            getConnection(): Promise<{ manager: { query(sql: string): Promise<unknown> }; isInitialized: boolean }>;
        };

        const connection = await dbOperator.getConnection();
        expect(connection.isInitialized).toBe(true);

        await expect(connection.manager.query('SELECT * FROM a_table_that_does_not_exist')).rejects.toThrow();

        await dbOperator.closeConnection();
        expect(connection.isInitialized).toBe(false);
    }, 180_000);

    it('[AR-9.6] MySQL boundary: the real compiled ConnectionCheckModel opens a real MySQL-protocol server through the real compiled DBOperator, and releases it (ephemeral local container; skipped, never silently passed, when no container runtime exists)', async context => {
        const runtime = await mysqlContainerRuntime();
        if (runtime === undefined) {
            // Reported as SKIPPED, not PASSED: an absent container runtime must never be able to
            // masquerade as a connected boundary (that is the exact fail-open shape this lane
            // removed elsewhere). The always-running gap-tracking case below still holds.
            context.skip();
            return;
        }

        const opened: EphemeralMysqlServer[] = [await startEphemeralMysqlServer(runtime)];
        try {
            const DBOperator = loadDbOperator();
            const ConnectionCheckModel = loadConnectionCheckModel();
            const attempts: string[] = [];
            const openOperator = (mysqlServer: EphemeralMysqlServer) => {
                const testpass = mysqlServer.rootPassword;
                const dbOperator = new DBOperator(silentLoggerPort(), {
                    getConfig: () => ({
                        dbtype: 'mysql',
                        mysql: {
                            host: '127.0.0.1',
                            port: mysqlServer.port,
                            user: MYSQL_BOUNDARY_USER,
                            password: testpass,
                            database: MYSQL_BOUNDARY_DATABASE,
                        },
                    }),
                }) as DbOperatorLike & {
                    checkConnection(): Promise<void>;
                    getConnection(): Promise<{ isInitialized: boolean }>;
                };
                const checkConnection = dbOperator.checkConnection.bind(dbOperator);
                dbOperator.checkConnection = async () => {
                    const startedAt = Date.now();
                    try {
                        await checkConnection();
                        attempts.push(`ok ${Date.now() - startedAt}ms`);
                    } catch (error) {
                        const detail = error instanceof Error ? error.message : String(error);
                        attempts.push(`fail ${Date.now() - startedAt}ms ${detail}`);
                        throw error;
                    }
                };
                return dbOperator;
            };
            const active = opened[0];
            if (active === undefined) {
                throw new Error('AR-9.6: the ephemeral MySQL boundary container was not started');
            }
            const dbOperator = openOperator(active);

            // Real MySQL wire protocol, real TCP socket, real migrations -- through the owner class.
            // checkDB retries forever, and a half-open socket does not reject, so this case bounds
            // it itself with the same 120s budget. No replacement: a container that dies mid-check
            // is the failure to report -- with the attempts made, the container's own exit state and
            // logs, and the `docker events` recorded around the moment it was lost -- not something
            // to retry over by starting a second container.
            const watch = watchMysqlBoundaryContainer(runtime, active.containerName);
            const events = watchContainerEvents(runtime, active.containerName);
            try {
                const connectionCheck = new ConnectionCheckModel(
                    silentLoggerPort(),
                    { checkAvailability: async () => undefined },
                    dbOperator,
                );
                const outcome = await withinDeadline(
                    'checkDB (mysql)',
                    120_000,
                    Promise.race([
                        connectionCheck.checkDB().then(() => ({ kind: 'ok' as const })),
                        watch.lost.then(status => ({ kind: 'lost' as const, status })),
                    ]),
                );
                if (outcome.kind === 'lost') {
                    throw new Error(
                        `MySQL boundary container ${active.containerName} exited during checkDB (${outcome.status})`,
                    );
                }
            } catch (error) {
                const state = await runCommand(
                    runtime,
                    [
                        'inspect',
                        '--format',
                        '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}}',
                        active.containerName,
                    ],
                    15_000,
                );
                const logs = await runCommand(runtime, ['logs', '--tail', '40', active.containerName], 15_000);
                const detail = error instanceof Error ? error.message : String(error);
                throw new Error(
                    `${detail}\nattempts=${attempts.join(' | ') || '(none)'}\nstatus=${state.stdout || state.stderr}` +
                        `\nlogs=${logs.stdout || logs.stderr}\ndocker events: ${events.snapshot().join(' | ') || '(none)'}`,
                );
            } finally {
                watch.stop();
                events.stop();
            }
            const connection = await dbOperator.getConnection();
            expect(connection.isInitialized).toBe(true);

            await dbOperator.closeConnection();
            expect(connection.isInitialized).toBe(false);
        } finally {
            for (const mysqlServer of opened) {
                await mysqlServer.stop();
            }
        }
    }, 300_000);

    it('[AR-9.6] filesystem boundary: the real compiled VideoUtil and RecordingUtilModel perform the startup tidy file read against real files, and a missing file leaves the recorded size untouched', async () => {
        const VideoUtil = (
            compiledModuleRequire(join(compiledSnapshotRoot(), 'model', 'api', 'video', 'VideoUtil.js')) as {
                readonly default: new (
                    configuration: unknown,
                    videoFileDB: unknown,
                    logger?: unknown,
                ) => {
                    getFullFilePathFromId(id: number): Promise<string | null>;
                };
            }
        ).default;
        const RecordingUtilModel = (
            compiledModuleRequire(
                join(compiledSnapshotRoot(), 'model', 'operator', 'recording', 'RecordingUtilModel.js'),
            ) as {
                readonly default: new (...arguments_: unknown[]) => { updateVideoFileSize(id: number): Promise<void> };
            }
        ).default;

        const recordedDirectory = await mkdtemp(join(tmpdir(), 'ar-9-17-recorded-'));
        const recordedTmpDirectory = await mkdtemp(join(tmpdir(), 'ar-9-17-tmp-'));
        try {
            const configuration = {
                getConfig: () => ({
                    recorded: [{ name: 'recorded', path: recordedDirectory }],
                    recordedTmp: recordedTmpDirectory,
                }),
            };

            // A real interrupted-recording artefact of a known size, in the real tmp directory the
            // startup tidy path reads from.
            const payload = Buffer.alloc(4096, 7);
            const interrupted = join(recordedTmpDirectory, 'interrupted.m2ts');
            await writeFile(interrupted, payload);

            const videoFileRow = { filePath: 'interrupted.m2ts', id: 11, parentDirectoryName: 'tmp', size: 0 };
            const settledRow = { filePath: 'settled.m2ts', id: 12, parentDirectoryName: 'recorded', size: 0 };
            const strayRow = { filePath: 'stray.m2ts', id: 13, parentDirectoryName: 'no-such-parent', size: 0 };
            const rows = new Map([
                [videoFileRow.id, videoFileRow],
                [settledRow.id, settledRow],
                [strayRow.id, strayRow],
            ]);
            const recordedSizes: Array<readonly [number, number]> = [];
            const videoFileDB = {
                findId: async (id: number) => rows.get(id) ?? null,
                updateSize: async (id: number, size: number) => {
                    recordedSizes.push([id, size]);
                },
            };

            const videoUtil = new VideoUtil(configuration, videoFileDB, silentLoggerPort());
            // The owner's REAL parent-directory resolution across all three of its branches: the
            // `tmp` branch, the configured `recorded` branch, and the unresolvable branch. A
            // Runtime-local double returning a fixed path cannot satisfy all three, which is what
            // makes the owner class load-bearing here rather than decorative.
            expect(await videoUtil.getFullFilePathFromId(videoFileRow.id)).toBe(interrupted);
            expect(await videoUtil.getFullFilePathFromId(settledRow.id)).toBe(join(recordedDirectory, 'settled.m2ts'));
            expect(await videoUtil.getFullFilePathFromId(strayRow.id)).toBeNull();

            const unusedPort = new Proxy({}, { get: () => async () => undefined });
            const recordingUtil = new RecordingUtilModel(
                silentLoggerPort(),
                configuration,
                unusedPort,
                unusedPort,
                unusedPort,
                videoFileDB,
                videoUtil,
            );

            // Real fs.stat through the owner's public port.
            await recordingUtil.updateVideoFileSize(videoFileRow.id);
            expect(recordedSizes).toEqual([[videoFileRow.id, payload.length]]);

            // Failure path: the artefact disappears between discovery and stat. The owner absorbs the
            // error and must NOT record a size -- the boundary failure leaves no bogus write behind.
            await rm(interrupted, { force: true });
            await recordingUtil.updateVideoFileSize(videoFileRow.id);
            expect(recordedSizes).toEqual([[videoFileRow.id, payload.length]]);
        } finally {
            await rm(recordedDirectory, { force: true, recursive: true });
            await rm(recordedTmpDirectory, { force: true, recursive: true });
        }
    }, 120_000);
});
