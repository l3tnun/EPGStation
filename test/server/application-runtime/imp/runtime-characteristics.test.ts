import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { Container } from 'inversify';
import { describe, expect, it, vi } from 'vitest';
import {
    captureRuntimeListeners,
    compiledSnapshotRoot,
    createSyntheticChild,
    evaluateCompiledRuntime,
    removeListenersAddedSince,
} from '../_runtime-harness';

type StorageSnapshot =
    { readonly status: 'known'; readonly recordedIds: ReadonlySet<number> } | { readonly status: 'unknown' };
type ChildSnapshot =
    { readonly status: 'known'; readonly recordedIds: readonly number[] } | { readonly status: 'unknown' };
type Preparation = { readonly status: 'prepared'; readonly token: object } | { readonly status: 'not-deleted' };
type Gate = {
    tryAcquireDeletion(recordedId: number): { readonly token: object } | { readonly status: 'busy' | 'unknown' };
    releaseDeletion(token: object): void;
};
type RuntimeGenerationChild = EventEmitter & {
    readonly pid: number;
    readonly stderr: null;
    readonly stdout: null;
};
type EpgRuntimeChild = EventEmitter & {
    readonly kill: ReturnType<typeof vi.fn>;
    readonly pid: number;
    readonly stderr: PassThrough;
    readonly stdout: PassThrough;
};
type EpgSupervisorConstructor = new (
    loggerModel: {
        getLogger(): {
            system: { error(error: unknown): void; fatal(message: string): void; info(message: string): void };
        };
    },
    epgUpdateEvent: { emitUpdated(): void },
) => { execute(): Promise<void> };

interface SnapshotAdapterConstructor {
    new (
        recording: { getActiveRecordedIds(): StorageSnapshot } | null,
        serviceChild: { requestSnapshot(): Promise<ChildSnapshot> } | null,
    ): { getSnapshot(): Promise<StorageSnapshot> };
}

interface DeletionAdapterConstructor {
    new (
        recorded: {
            prepareStorageDeletion(recordedId: number, storageName: string): Promise<Preparation>;
            deletePreparedForStorage(token: object): Promise<'deleted' | 'not-deleted'>;
        },
        recordingGate: Gate,
        serviceGate: Gate,
    ): { deleteForStoragePressure(recordedId: number, storageName: string): Promise<'deleted' | 'not-deleted'> };
}

const packageRequire = createRequire(join(process.cwd(), 'package.json'));
const childProcess = packageRequire('node:child_process') as typeof import('node:child_process');

packageRequire('reflect-metadata');

const loadCompiledDefault = <T>(relativePath: string): T => {
    const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
    if (compiledSnapshot === undefined || !isAbsolute(compiledSnapshot)) {
        throw new Error('Server test runner did not provide an absolute compiled snapshot');
    }
    return (packageRequire(join(compiledSnapshot, relativePath)) as { default: T }).default;
};

describe('runtime startup characteristics', () => {
    it('[AR-8.6][AR-8.7] replaces an EPG child immediately without timers, descendant signals, or stream destruction', async () => {
        const first = Object.assign(new EventEmitter(), {
            kill: vi.fn(() => true),
            pid: 8_601,
            stderr: new PassThrough(),
            stdout: new PassThrough(),
        }) as EpgRuntimeChild;
        const replacement = Object.assign(new EventEmitter(), {
            kill: vi.fn(() => true),
            pid: 8_602,
            stderr: new PassThrough(),
            stdout: new PassThrough(),
        }) as EpgRuntimeChild;
        const spawn = vi
            .spyOn(childProcess, 'spawn')
            .mockReturnValueOnce(first as never)
            .mockReturnValueOnce(replacement as never);
        const processKill = vi.spyOn(process, 'kill').mockReturnValue(true);
        const stdoutDestroy = vi.spyOn(first.stdout, 'destroy');
        const stderrDestroy = vi.spyOn(first.stderr, 'destroy');
        const log = { system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() } };
        const EpgSupervisor = loadCompiledDefault<EpgSupervisorConstructor>(
            'model/epgUpdater/EPGUpdateExecutorManageModel.js',
        );
        const supervisor = new EpgSupervisor({ getLogger: () => log }, { emitUpdated: vi.fn() });

        vi.useFakeTimers();
        try {
            await supervisor.execute();
            expect(first.stdout.listenerCount('data')).toBe(1);
            expect(first.stderr.listenerCount('data')).toBe(1);
            first.stdout.write('stdout');
            first.stderr.write('stderr');
            expect(first.stdout.readableLength).toBe(0);
            expect(first.stderr.readableLength).toBe(0);

            first.emit('close', 1, null);

            expect(spawn).toHaveBeenCalledTimes(2);
            expect(vi.getTimerCount()).toBe(0);
            expect(first.kill).not.toHaveBeenCalled();
            expect(processKill).not.toHaveBeenCalled();
            expect(stdoutDestroy).not.toHaveBeenCalled();
            expect(stderrDestroy).not.toHaveBeenCalled();
            expect(first.stdout.destroyed).toBe(false);
            expect(first.stderr.destroyed).toBe(false);
            expect(first.stdout.listenerCount('data')).toBe(0);
            expect(first.stderr.listenerCount('data')).toBe(0);
            expect(replacement.listenerCount('message')).toBe(1);
        } finally {
            vi.useRealTimers();
            processKill.mockRestore();
            stdoutDestroy.mockRestore();
            stderrDestroy.mockRestore();
            spawn.mockRestore();
            for (const child of [first, replacement]) {
                child.removeAllListeners();
                child.stdout.removeAllListeners();
                child.stderr.removeAllListeners();
                child.stdout.destroy();
                child.stderr.destroy();
            }
        }
    });

    it('[AR-5.2][AR-9.4] keeps two replacement generations current through remove-listener reentry without a restart cap', async () => {
        const children: RuntimeGenerationChild[] = [];
        const registeredPeers: RuntimeGenerationChild[] = [];
        const workflowInputs: unknown[] = [];
        const createChild = (): RuntimeGenerationChild => {
            const child = Object.assign(new EventEmitter(), {
                pid: 1_200 + children.length,
                stderr: null,
                stdout: null,
            }) as RuntimeGenerationChild;
            children.push(child);
            return child;
        };
        const services: Record<string, unknown> = {
            IConfiguration: { getConfig: () => ({}) },
            IConnectionCheckModel: {
                checkDB: async () => undefined,
                checkMirakurun: async () => undefined,
            },
            IEPGUpdateExecutorManageModel: { execute: vi.fn() },
            IEventSetter: { set: vi.fn() },
            IIPCServer: {
                initialize: async () => undefined,
                register: (peer: RuntimeGenerationChild) => registeredPeers.push(peer),
            },
            ILoggerModel: {
                getLogger: () => ({ system: { fatal() {}, info() {} } }),
                initialize() {},
            },
            IRecordingManageModel: {
                cleanup: async () => undefined,
                rebuildCandidatesAndStart: async () => undefined,
                setTuner: vi.fn(),
            },
            IReservationManageModel: { cleanup: async () => undefined, setTuners: vi.fn() },
            IStorageManageModel: { start: vi.fn() },
            IRuntimeStartupWorkflowPort: {
                runAfterServiceSupervisionAccepted: (input: unknown) => {
                    workflowInputs.push(input);
                    return Promise.resolve({ kind: 'Succeeded', stage: 'epg-supervisor-start' } as const);
                },
            },
            TunerServerAccess: { getTuners: async () => [] },
        };
        const container = { get: (identifier: string): unknown => services[identifier] };
        const spawnServiceChild = vi.fn(createChild);
        const expectExternalSupervision = (expectedChildCount: number): void => {
            expect(spawnServiceChild).toHaveBeenCalledTimes(expectedChildCount);
            expect(children).toHaveLength(expectedChildCount);
            expect(registeredPeers).toEqual(children);
            expect(workflowInputs).toHaveLength(1);
        };
        const settleGeneration = (child: RuntimeGenerationChild, expectedChildCount: number): void => {
            let removalReentered = false;
            const onListenerRemoved = (eventName: string | symbol): void => {
                if (removalReentered || eventName !== 'error') return;
                removalReentered = true;
                child.emit('error', new Error('remove-listener reentry'));
            };
            child.on('removeListener', onListenerRemoved);

            expect(() => child.emit('error', new Error('synthetic terminal'))).not.toThrow();
            expect(removalReentered).toBe(true);
            expectExternalSupervision(expectedChildCount);
            expect(() => {
                child.emit('error', new Error('late terminal'));
                child.emit('exit', 1, null);
                child.emit('close', 1, null);
            }).not.toThrow();
            expectExternalSupervision(expectedChildCount);
            expect(child.listenerCount('error')).toBe(0);
            expect(child.listenerCount('exit')).toBe(0);
            expect(child.listenerCount('close')).toBe(0);
            child.removeListener('removeListener', onListenerRemoved);
            expect(child.listenerCount('removeListener')).toBe(0);
        };

        const restoreListeners = captureRuntimeListeners();
        try {
            await evaluateCompiledRuntime(container, spawnServiceChild);
            await vi.waitFor(() => expect(spawnServiceChild).toHaveBeenCalledTimes(1));
            await Promise.resolve();
            await Promise.resolve();

            const initialChild = children[0];
            expect(initialChild).toBeDefined();
            if (initialChild === undefined) throw new Error('Runtime did not retain its initial Service child');
            expect(registeredPeers).toEqual([initialChild]);

            settleGeneration(initialChild, 2);

            const firstReplacement = children[1];
            expect(firstReplacement).toBeDefined();
            if (firstReplacement === undefined) throw new Error('Runtime did not create its first replacement child');
            settleGeneration(firstReplacement, 3);
        } finally {
            removeListenersAddedSince(restoreListeners);
        }
    });

    it('[AR-6.1] resolves the Runtime Workflow startup port from the production container composition', () => {
        const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
        if (compiledSnapshot === undefined || !isAbsolute(compiledSnapshot)) {
            throw new Error('Server test runner did not provide an absolute compiled snapshot');
        }
        const container = new Container({ skipBaseClassChecks: true });
        const containerSetter = packageRequire(join(compiledSnapshot, 'model/ModelContainerSetter.js')) as {
            readonly set: (target: Container) => void;
        };

        containerSetter.set(container);

        expect(container.isBound('IRuntimeStartupWorkflowPort')).toBe(true);
        expect(
            container.get<{ runAfterServiceSupervisionAccepted: unknown }>('IRuntimeStartupWorkflowPort')
                .runAfterServiceSupervisionAccepted,
        ).toEqual(expect.any(Function));
    });

    it('[AR-4.2] aggregates provider snapshots once and delegates a prepared deletion through both exclusive gates', async () => {
        const SnapshotAdapter = loadCompiledDefault<SnapshotAdapterConstructor>(
            'model/operator/storage/StorageRecordedUseSnapshotAdapter.js',
        );
        const DeletionAdapter = loadCompiledDefault<DeletionAdapterConstructor>(
            'model/operator/storage/StoragePressureDeletionAdapter.js',
        );
        const ledger: string[] = [];
        const recordingToken = Object.freeze({ gate: 'recording' });
        const serviceToken = Object.freeze({ gate: 'service' });
        const preparedToken = Object.freeze({ prepared: 41 });
        const snapshot = new SnapshotAdapter(
            {
                getActiveRecordedIds: () => {
                    ledger.push('recording:snapshot');
                    return { status: 'known', recordedIds: new Set([7, 11]) };
                },
            },
            {
                requestSnapshot: async () => {
                    ledger.push('service:snapshot');
                    return { status: 'known', recordedIds: [11, 13] };
                },
            },
        );
        const deletion = new DeletionAdapter(
            {
                deletePreparedForStorage: async token => {
                    expect(token).toBe(preparedToken);
                    ledger.push('final-delete');
                    return 'deleted';
                },
                prepareStorageDeletion: async (recordedId, storageName) => {
                    ledger.push(`prepare:${recordedId}:${storageName}`);
                    return { status: 'prepared', token: preparedToken };
                },
            },
            {
                releaseDeletion: token => {
                    expect(token).toBe(recordingToken);
                    ledger.push('recording:release');
                },
                tryAcquireDeletion: recordedId => {
                    ledger.push(`recording:acquire:${recordedId}`);
                    return { token: recordingToken };
                },
            },
            {
                releaseDeletion: token => {
                    expect(token).toBe(serviceToken);
                    ledger.push('service:release');
                },
                tryAcquireDeletion: recordedId => {
                    ledger.push(`service:acquire:${recordedId}`);
                    return { token: serviceToken };
                },
            },
        );

        await expect(snapshot.getSnapshot()).resolves.toEqual({ status: 'known', recordedIds: new Set([7, 11, 13]) });
        await expect(deletion.deleteForStoragePressure(41, 'archive')).resolves.toBe('deleted');
        expect(ledger).toEqual([
            'recording:snapshot',
            'service:snapshot',
            'prepare:41:archive',
            'recording:acquire:41',
            'service:acquire:41',
            'final-delete',
            'service:release',
            'recording:release',
        ]);
    });
});

type IdentityValue = number | string | null | undefined;
type ProcessIdentityMethod = 'getuid' | 'setgid' | 'setuid';
type ConnectionChecker = {
    checkDB(): Promise<void>;
    checkMirakurun(): Promise<void>;
};
type ConnectionCheckConstructor = new (
    loggerModel: { getLogger(): { system: { info(message: string): void } } },
    tunerServerAccess: { checkAvailability(): Promise<void> },
    dbOperator: { checkConnection(): Promise<void> },
) => ConnectionChecker;
type StartupStageObserver = <T>(operation: () => Promise<T>, recordOverdue: () => void) => Promise<T>;

const inertLogger = (ledger: string[]) => ({
    getLogger: () => ({
        system: {
            error: (message: unknown) => ledger.push(`error:${String(message)}`),
            fatal: (message: unknown) =>
                ledger.push(`fatal:${message instanceof Error ? message.message : String(message)}`),
            info: () => undefined,
        },
    }),
    initialize: (configurationPath?: string) => ledger.push(configurationPath === undefined ? 'log-1' : 'log-2'),
});

/** Replaces the process identity methods for one run and returns the function that restores the originals. */
const overrideProcessIdentity = (uid: number, ledger: string[]): (() => void) => {
    const methods: readonly ProcessIdentityMethod[] = ['getuid', 'setgid', 'setuid'];
    const originals = methods.map(method => [method, Object.getOwnPropertyDescriptor(process, method)] as const);
    Object.defineProperty(process, 'getuid', { configurable: true, value: () => uid, writable: true });
    for (const method of ['setgid', 'setuid'] as const) {
        Object.defineProperty(process, method, {
            configurable: true,
            value: (value: unknown) => ledger.push(`${method}:${String(value)}`),
            writable: true,
        });
    }
    return () => {
        for (const [method, descriptor] of originals) {
            if (descriptor === undefined) {
                Reflect.deleteProperty(process, method);
            } else {
                Object.defineProperty(process, method, descriptor);
            }
        }
    };
};

/**
 * Runs the compiled entrypoint with a fake container whose first dependency wait never settles, so the run stops
 * right after identity preparation and returns what that preparation did.
 */
const observeIdentityPreparation = async (
    uid: number,
    config: { gid?: IdentityValue; uid?: IdentityValue },
): Promise<string[]> => {
    const ledger: string[] = [];
    const listenersBefore = captureRuntimeListeners();
    const restoreIdentity = overrideProcessIdentity(uid, ledger);
    const logger = inertLogger(ledger);
    const container = {
        get: (identifier: string): unknown => {
            const dependencies: Record<string, unknown> = {
                IConfiguration: { getConfig: () => config },
                IConnectionCheckModel: {
                    checkDB: () => new Promise<void>(() => undefined),
                    checkMirakurun: () => new Promise<void>(() => undefined),
                },
                ILoggerModel: logger,
            };
            if (!(identifier in dependencies)) {
                throw new Error(`Unexpected dependency: ${identifier}`);
            }
            return dependencies[identifier];
        },
    };

    try {
        await evaluateCompiledRuntime(container, () => {
            throw new Error('service child must not start');
        });
        return ledger;
    } finally {
        restoreIdentity();
        removeListenersAddedSince(listenersBefore);
    }
};

interface OperatorScenario {
    readonly ledger: string[];
    readonly rejections: unknown[];
}

/** Runs the compiled entrypoint to the service start with a synthetic tuner port and returns its call ledger. */
const observeOperatorStart = async (
    getTuners: () => Promise<readonly object[]>,
    tuners: readonly object[],
    until: string,
): Promise<OperatorScenario> => {
    const ledger: string[] = [];
    const rejections: unknown[] = [];
    const listenersBefore = captureRuntimeListeners();
    const rejectionListeners = process.listeners('unhandledRejection');
    process.removeAllListeners('unhandledRejection');
    process.on('unhandledRejection', reason => {
        rejections.push(reason);
    });
    const restoreIdentity = overrideProcessIdentity(1_000, ledger);
    const logger = inertLogger(ledger);
    const dependencies: Record<string, unknown> = {
        IConfiguration: { getConfig: () => ({}) },
        IConnectionCheckModel: { checkDB: async () => undefined, checkMirakurun: async () => undefined },
        IEPGUpdateExecutorManageModel: { execute: () => ledger.push('epg-start') },
        IEventSetter: { set: () => ledger.push('event-set') },
        IIPCServer: {
            initialize: async () => undefined,
            register: () => ledger.push('ipc-register'),
        },
        ILoggerModel: logger,
        IRecordingManageModel: {
            setTuner: (value: readonly object[]) =>
                ledger.push(value === tuners ? 'recording-tuners' : 'recording-other'),
        },
        IReservationManageModel: {
            setTuners: (value: readonly object[]) =>
                ledger.push(value === tuners ? 'reservation-tuners' : 'reservation-other'),
        },
        IRuntimeStartupWorkflowPort: { runAfterServiceSupervisionAccepted: () => new Promise<never>(() => undefined) },
        IStorageManageModel: { start: () => ledger.push('storage-start') },
        TunerServerAccess: {
            getTuners: async () => {
                ledger.push('tuner-read');
                return getTuners();
            },
        },
    };
    const container = {
        get: (identifier: string): unknown => {
            if (!(identifier in dependencies)) {
                throw new Error(`Unexpected dependency: ${identifier}`);
            }
            return dependencies[identifier];
        },
    };

    try {
        await evaluateCompiledRuntime(container, () => {
            ledger.push('service-spawn');
            return createSyntheticChild(7_001);
        });
        await vi.waitFor(() => expect(ledger).toContain(until));
        return { ledger, rejections };
    } finally {
        restoreIdentity();
        removeListenersAddedSince(listenersBefore);
        process.removeAllListeners('unhandledRejection');
        for (const listener of rejectionListeners) {
            process.on('unhandledRejection', listener);
        }
    }
};

describe('runtime process identity preparation', () => {
    it.each([
        {
            config: { gid: 41, uid: 42 },
            expected: [],
            label: 'a non-root process ignores a configured numeric group and user',
            uid: 1_000,
        },
        {
            config: { gid: 'recording-group', uid: 'recording-user' },
            expected: [],
            label: 'a non-root process ignores a configured string group and user',
            uid: 1,
        },
        {
            config: {},
            expected: ['setgid:video'],
            label: 'a root process with no group or user falls back to the video group and keeps its user',
            uid: 0,
        },
        {
            config: { gid: null, uid: null },
            expected: ['setgid:video'],
            label: 'a root process with null group and user falls back to the video group and keeps its user',
            uid: 0,
        },
        {
            config: { gid: 'recording-group' },
            expected: ['setgid:recording-group'],
            label: 'a root process with only a string group changes only the group',
            uid: 0,
        },
        {
            config: { gid: 0 },
            expected: ['setgid:0'],
            label: 'a root process passes a numeric zero group through instead of the default',
            uid: 0,
        },
        {
            config: { uid: 'recording-user' },
            expected: ['setgid:video', 'setuid:recording-user'],
            label: 'a root process with only a string user changes the user after the default group',
            uid: 0,
        },
        {
            config: { gid: 41, uid: 42 },
            expected: ['setgid:41', 'setuid:42'],
            label: 'a root process with numeric group and user changes the group before the user',
            uid: 0,
        },
    ] satisfies Array<{
        readonly config: { gid?: IdentityValue; uid?: IdentityValue };
        readonly expected: readonly string[];
        readonly label: string;
        readonly uid: number;
    }>)('[AR-9.4] $label', async ({ config, expected, uid }) => {
        const ledger = await observeIdentityPreparation(uid, config);

        expect(ledger).toEqual(['log-1', ...expected, 'log-2']);
    });
});

describe('runtime dependency wait counts', () => {
    it.each([
        { failures: 0, provider: 'tuner' },
        { failures: 1, provider: 'tuner' },
        { failures: 3, provider: 'tuner' },
        { failures: 0, provider: 'database' },
        { failures: 1, provider: 'database' },
        { failures: 3, provider: 'database' },
    ] as const)(
        '[AR-9.4] retries the $provider probe once per second for exactly $failures failures and then stops',
        async ({ failures, provider }) => {
            vi.useFakeTimers();
            try {
                const probe = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
                for (let failure = 0; failure < failures; failure += 1) {
                    probe.mockRejectedValueOnce(new Error('synthetic dependency unavailable'));
                }
                const untouched = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
                const ConnectionCheckModel = loadCompiledDefault<ConnectionCheckConstructor>(
                    'model/ConnectionCheckModel.js',
                );
                const checker = new ConnectionCheckModel(
                    { getLogger: () => ({ system: { info: () => undefined } }) },
                    { checkAvailability: provider === 'tuner' ? probe : untouched },
                    { checkConnection: provider === 'database' ? probe : untouched },
                );
                let settled = false;
                const waiting = (provider === 'tuner' ? checker.checkMirakurun() : checker.checkDB()).then(() => {
                    settled = true;
                });

                await vi.advanceTimersByTimeAsync(0);
                expect(probe).toHaveBeenCalledTimes(1);
                for (let failure = 1; failure <= failures; failure += 1) {
                    expect(settled).toBe(false);
                    await vi.advanceTimersByTimeAsync(999);
                    expect(probe).toHaveBeenCalledTimes(failure);
                    await vi.advanceTimersByTimeAsync(1);
                    expect(probe).toHaveBeenCalledTimes(failure + 1);
                }
                await waiting;

                expect(settled).toBe(true);
                expect(probe).toHaveBeenCalledTimes(failures + 1);
                expect(untouched).not.toHaveBeenCalled();
                expect(vi.getTimerCount()).toBe(0);
                await vi.advanceTimersByTimeAsync(10_000);
                expect(probe).toHaveBeenCalledTimes(failures + 1);
            } finally {
                vi.useRealTimers();
            }
        },
    );
});

describe('runtime tuner information read', () => {
    it('[AR-9.4] hands the one tuner snapshot to both operator owners, then starts storage and the service', async () => {
        const tuners = Object.freeze([{ name: 'synthetic-tuner' }]);
        const { ledger, rejections } = await observeOperatorStart(async () => tuners, tuners, 'service-spawn');

        expect(ledger.filter(entry => !entry.startsWith('log-'))).toEqual([
            'event-set',
            'tuner-read',
            'reservation-tuners',
            'recording-tuners',
            'storage-start',
            'service-spawn',
            'ipc-register',
        ]);
        expect(rejections).toEqual([]);
    });

    it('[AR-9.4] records a failed tuner read as one fatal rejection and starts no operator owner, storage, or service', async () => {
        const failure = new Error('synthetic tuner read failure');
        const tuners: readonly object[] = [];
        const { ledger, rejections } = await observeOperatorStart(
            async () => {
                throw failure;
            },
            tuners,
            'fatal:synthetic tuner read failure',
        );

        expect(ledger.filter(entry => !entry.startsWith('log-'))).toEqual([
            'event-set',
            'tuner-read',
            'fatal:unhandledRejection',
            'fatal:synthetic tuner read failure',
        ]);
        expect(rejections).toEqual([failure]);
    });
});

describe('runtime startup stage 600-second boundary', () => {
    it.each([
        { elapsed: 599_999, overdue: 0 },
        { elapsed: 600_000, overdue: 1 },
        { elapsed: 600_001, overdue: 1 },
    ])(
        '[AR-9.4] records overdue $overdue time(s) at $elapsed ms and still returns the late result once',
        async ({ elapsed, overdue }) => {
            vi.useFakeTimers();
            try {
                const observeStartupStage = loadCompiledDefault<StartupStageObserver>('StartupStageObserver.js');
                let finish!: (value: string) => void;
                const operation = vi.fn(
                    () =>
                        new Promise<string>(resolve => {
                            finish = resolve;
                        }),
                );
                const recordOverdue = vi.fn();
                const observed = observeStartupStage(operation, recordOverdue);

                await vi.advanceTimersByTimeAsync(elapsed);
                expect(recordOverdue).toHaveBeenCalledTimes(overdue);
                finish('synthetic-result');

                await expect(observed).resolves.toBe('synthetic-result');
                await vi.advanceTimersByTimeAsync(600_000);
                expect(operation).toHaveBeenCalledTimes(1);
                expect(recordOverdue).toHaveBeenCalledTimes(overdue);
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        },
    );

    it('[AR-9.4] clears the overdue timer when the operation fails before 600 seconds and rethrows the same failure', async () => {
        vi.useFakeTimers();
        try {
            const observeStartupStage = loadCompiledDefault<StartupStageObserver>('StartupStageObserver.js');
            const failure = new Error('synthetic stage failure');
            const recordOverdue = vi.fn();
            const observed = observeStartupStage(async () => {
                throw failure;
            }, recordOverdue);

            await expect(observed).rejects.toBe(failure);
            await vi.advanceTimersByTimeAsync(600_001);
            expect(recordOverdue).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('runtime child first terminal event', () => {
    it.each([
        { first: 'error', followers: ['exit', 'error', 'close'], restarts: true },
        { first: 'exit', followers: ['error', 'exit', 'close'], restarts: true },
        { first: 'close', followers: ['exit', 'close'], restarts: false },
    ] as const)(
        '[AR-9.4] a Service child whose first terminal event is $first restarts: $restarts, and later events add nothing',
        async ({ first, followers, restarts }) => {
            const children: RuntimeGenerationChild[] = [];
            const registeredPeers: RuntimeGenerationChild[] = [];
            const fatals: string[] = [];
            const services: Record<string, unknown> = {
                IConfiguration: { getConfig: () => ({}) },
                IConnectionCheckModel: { checkDB: async () => undefined, checkMirakurun: async () => undefined },
                IEPGUpdateExecutorManageModel: { execute: vi.fn() },
                IEventSetter: { set: vi.fn() },
                IIPCServer: {
                    initialize: async () => undefined,
                    register: (peer: RuntimeGenerationChild) => registeredPeers.push(peer),
                },
                ILoggerModel: {
                    getLogger: () => ({
                        system: { fatal: (message: unknown) => fatals.push(String(message)), info() {} },
                    }),
                    initialize() {},
                },
                IRecordingManageModel: {
                    cleanup: async () => undefined,
                    rebuildCandidatesAndStart: async () => undefined,
                    setTuner: vi.fn(),
                },
                IReservationManageModel: { cleanup: async () => undefined, setTuners: vi.fn() },
                IRuntimeStartupWorkflowPort: {
                    runAfterServiceSupervisionAccepted: () =>
                        Promise.resolve({ kind: 'Succeeded', stage: 'epg-supervisor-start' } as const),
                },
                IStorageManageModel: { start: vi.fn() },
                TunerServerAccess: { getTuners: async () => [] },
            };
            const spawnServiceChild = vi.fn(() => {
                const child = Object.assign(new EventEmitter(), {
                    pid: 2_200 + children.length,
                    stderr: null,
                    stdout: null,
                }) as RuntimeGenerationChild;
                children.push(child);
                return child;
            });
            const listenersBefore = captureRuntimeListeners();

            try {
                await evaluateCompiledRuntime({ get: (identifier: string) => services[identifier] }, spawnServiceChild);
                await vi.waitFor(() => expect(spawnServiceChild).toHaveBeenCalledTimes(1));
                await vi.waitFor(() => expect(registeredPeers).toHaveLength(1));
                const initial = children[0];
                if (initial === undefined) throw new Error('Runtime did not start its Service child');

                const emitTerminal = (event: string): void => {
                    if (event === 'error') {
                        initial.emit('error', new Error('synthetic service terminal'));
                    } else {
                        initial.emit(event, 1, null);
                    }
                };
                emitTerminal(first);

                const expectedSpawns = restarts ? 2 : 1;
                const expectedFatals = restarts ? ['service process is down', 'restart service'] : [];
                expect(spawnServiceChild).toHaveBeenCalledTimes(expectedSpawns);
                expect(registeredPeers).toEqual(children);
                expect(fatals).toEqual(expectedFatals);
                if (!restarts) {
                    expect(initial.listenerCount('error')).toBe(0);
                    expect(initial.listenerCount('exit')).toBe(0);
                    expect(initial.listenerCount('close')).toBe(0);
                }

                for (const event of followers) {
                    expect(() => emitTerminal(event)).not.toThrow();
                }

                expect(spawnServiceChild).toHaveBeenCalledTimes(expectedSpawns);
                expect(registeredPeers).toEqual(children);
                expect(fatals).toEqual(expectedFatals);
                expect(initial.listenerCount('error')).toBe(0);
                expect(initial.listenerCount('exit')).toBe(0);
                expect(initial.listenerCount('close')).toBe(0);
            } finally {
                removeListenersAddedSince(listenersBefore);
            }
        },
    );

    it.each([
        { first: 'exit', followers: ['error', 'disconnect', 'close'], fatal: 'epg updater is abort', interrupt: false },
        {
            first: 'disconnect',
            followers: ['error', 'exit', 'close'],
            fatal: 'epg updater is disconnected',
            interrupt: true,
        },
        { first: 'close', followers: ['exit', 'disconnect'], fatal: 'epg update is closed', interrupt: false },
        { first: 'error', followers: ['exit', 'disconnect', 'close'], fatal: 'epg updater is error', interrupt: false },
    ] as const)(
        '[AR-9.4] an EPG child whose first terminal event is $first spawns one replacement and interrupts: $interrupt',
        async ({ first, followers, fatal, interrupt }) => {
            const createChild = (pid: number): EpgRuntimeChild =>
                Object.assign(new EventEmitter(), {
                    kill: vi.fn(() => true),
                    pid,
                    stderr: new PassThrough(),
                    stdout: new PassThrough(),
                }) as EpgRuntimeChild;
            const initial = createChild(9_101);
            const replacement = createChild(9_102);
            const spawn = vi
                .fn()
                .mockReturnValueOnce(initial as never)
                .mockReturnValue(replacement as never);
            const fatals: string[] = [];
            const log = {
                system: { error: vi.fn(), fatal: (message: string) => fatals.push(message), info: vi.fn() },
            };
            const emitTerminal = (event: string): void => {
                if (event === 'error') {
                    initial.emit('error', new Error('synthetic epg terminal'));
                } else {
                    initial.emit(event, 1, null);
                }
            };

            vi.doMock('node:child_process', () => ({ spawn }));
            vi.doMock('child_process', () => ({ spawn }));
            try {
                vi.resetModules();
                const { default: EpgSupervisor } = (await import(
                    join(compiledSnapshotRoot(), 'model', 'epgUpdater', 'EPGUpdateExecutorManageModel.js')
                )) as { default: EpgSupervisorConstructor };
                const supervisor = new EpgSupervisor({ getLogger: () => log }, { emitUpdated: vi.fn() });
                await supervisor.execute();
                emitTerminal(first);

                expect(spawn).toHaveBeenCalledTimes(2);
                expect(fatals).toEqual([fatal]);
                expect(initial.kill.mock.calls).toEqual(interrupt ? [['SIGINT']] : []);
                expect(initial.stdout.listenerCount('data')).toBe(0);
                expect(initial.stderr.listenerCount('data')).toBe(0);
                expect(replacement.listenerCount('message')).toBe(1);

                for (const event of followers) {
                    expect(() => emitTerminal(event)).not.toThrow();
                }

                expect(spawn).toHaveBeenCalledTimes(2);
                expect(fatals).toEqual([fatal]);
                expect(initial.kill.mock.calls).toEqual(interrupt ? [['SIGINT']] : []);
                expect(replacement.kill).not.toHaveBeenCalled();
                expect(replacement.listenerCount('exit')).toBe(1);
            } finally {
                vi.doUnmock('node:child_process');
                vi.doUnmock('child_process');
                vi.resetModules();
                for (const child of [initial, replacement]) {
                    child.removeAllListeners();
                    child.stdout.removeAllListeners();
                    child.stderr.removeAllListeners();
                    child.stdout.destroy();
                    child.stderr.destroy();
                }
            }
        },
    );
});
