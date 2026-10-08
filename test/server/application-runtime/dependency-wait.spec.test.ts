import { EventEmitter } from 'node:events';
import Session from 'node:inspector';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { createCallLedger, createDeferred, useFakeClock } from '../harness/async';
import { evaluateCompiledRuntime } from './_runtime-harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined || !isAbsolute(compiledSnapshot)) {
    throw new Error('Server test runner did not provide an absolute compiled snapshot');
}

const ConnectionCheckModel = (
    require(join(compiledSnapshot, 'model', 'ConnectionCheckModel.js')) as {
        default: new (...arguments_: unknown[]) => {
            checkDB(): Promise<void>;
            checkMirakurun(): Promise<void>;
        };
    }
).default;

const StartupContinuationCoordinator = (
    require(join(compiledSnapshot, 'model', 'workflow', 'StartupContinuationCoordinator.js')) as {
        default: new () => {
            runAfterServiceSupervisionAccepted(input: unknown): Promise<unknown>;
        };
    }
).default;

type RuntimeListenerEvent = 'uncaughtException' | 'unhandledRejection';

const runtimeListenerEvents: readonly RuntimeListenerEvent[] = ['uncaughtException', 'unhandledRejection'];

const removeRuntimeListenersAddedByTest = (before: ReadonlyMap<RuntimeListenerEvent, readonly Function[]>): void => {
    for (const event of runtimeListenerEvents) {
        const existing = before.get(event) ?? [];
        for (const listener of process.listeners(event)) {
            if (!existing.includes(listener)) {
                process.removeListener(event, listener);
            }
        }
    }
};

const overrideGetuidForTest = (): (() => void) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'getuid');
    Object.defineProperty(process, 'getuid', {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        value: () => 1_000,
        writable: true,
    });

    return () => {
        if (descriptor === undefined) {
            Reflect.deleteProperty(process, 'getuid');
            return;
        }
        Object.defineProperty(process, 'getuid', descriptor);
    };
};

const evaluateCompiledEntrypoint = async (
    container: { get(identifier: string): unknown },
    record: (value: string) => void,
): Promise<void> => {
    const serviceChild = Object.assign(new EventEmitter(), {
        pid: 721,
        stderr: null,
        stdout: null,
    });

    await evaluateCompiledRuntime(
        container,
        () => {
            record('service-spawn');
            return serviceChild;
        },
        () => record('container-set'),
    );
};

interface DependencyFailureScenario {
    readonly databaseFailures: number;
    readonly pendingProvider?: 'database' | 'tuner';
    readonly tunerFailures: number;
}

interface RuntimeScenario {
    readonly clock: ReturnType<typeof useFakeClock>;
    dispose(): void;
    entriesFor(value: string): number[];
    rejectPending(): boolean;
    start(): Promise<void>;
}

const createRuntimeScenario = ({
    databaseFailures,
    pendingProvider,
    tunerFailures,
}: DependencyFailureScenario): RuntimeScenario => {
    const clock = useFakeClock(0);
    const ledger = createCallLedger<string>(() => clock.now());
    const listenersBefore = new Map<RuntimeListenerEvent, readonly Function[]>(
        runtimeListenerEvents.map(event => [event, process.listeners(event)]),
    );
    const restoreGetuid = overrideGetuidForTest();
    const record = (value: string): void => {
        ledger.record(value);
    };
    let tunerAttempts = 0;
    let databaseAttempts = 0;
    let tunerFailuresRemaining = tunerFailures;
    let databaseFailuresRemaining = databaseFailures;
    const pendingProbe = createDeferred<void>();
    const checkAvailability = vi.fn(() => {
        tunerAttempts += 1;
        record('tuner-attempt');
        if (pendingProvider === 'tuner' && tunerAttempts === 1) {
            return pendingProbe.promise;
        }
        if (tunerFailuresRemaining > 0) {
            tunerFailuresRemaining -= 1;
            return Promise.reject(new Error('synthetic tuner unavailable'));
        }
        return Promise.resolve();
    });
    const checkConnection = vi.fn(() => {
        databaseAttempts += 1;
        record('database-attempt');
        if (pendingProvider === 'database' && databaseAttempts === 1) {
            return pendingProbe.promise;
        }
        if (databaseFailuresRemaining > 0) {
            databaseFailuresRemaining -= 1;
            return Promise.reject(new Error('synthetic database unavailable'));
        }
        return Promise.resolve();
    });
    const tunerServerAccess = {
        checkAvailability,
        getTuners: async () => {
            record('operator-tuner-read');
            return [];
        },
    };
    const logger = {
        getLogger: () => ({
            system: {
                fatal: () => record('fatal-log'),
                info: () => undefined,
            },
        }),
        initialize: (configurationPath?: string) =>
            record(configurationPath === undefined ? 'operational-log' : 'operator-log'),
    };
    const checker = new ConnectionCheckModel(logger, tunerServerAccess, { checkConnection });
    const dependencies: Record<string, unknown> = {
        IConfiguration: { getConfig: () => (record('configuration-snapshot'), {}) },
        IConnectionCheckModel: checker,
        IEPGUpdateExecutorManageModel: { execute: () => record('epg-start') },
        IEventSetter: { set: () => record('operator-start') },
        IIPCServer: {
            initialize: async () => record('ipc-initialize'),
            register: () => record('ipc-register'),
        },
        ILoggerModel: logger,
        IRecordingManageModel: {
            cleanup: async () => record('recording-cleanup'),
            rebuildCandidatesAndStart: async () => record('recording-rebuild'),
            setTuner: () => record('recording-set-tuner'),
        },
        IReservationManageModel: {
            cleanup: async () => record('reservation-cleanup'),
            setTuners: () => record('reservation-set-tuners'),
        },
        IRuntimeStartupWorkflowPort: new StartupContinuationCoordinator(),
        IStorageManageModel: { start: () => record('storage-start') },
        TunerServerAccess: tunerServerAccess,
    };
    const container = {
        get: (identifier: string): unknown => {
            const dependency = dependencies[identifier];
            if (dependency === undefined) {
                throw new Error(`Unexpected runtime dependency: ${identifier}`);
            }
            return dependency;
        },
    };

    return {
        clock,
        dispose: () => {
            removeRuntimeListenersAddedByTest(listenersBefore);
            restoreGetuid();
            vi.clearAllTimers();
            clock.restore();
        },
        entriesFor: (value: string) =>
            ledger
                .entries()
                .filter(entry => entry.value === value)
                .map(entry => entry.time),
        rejectPending: () => {
            if (pendingProvider === undefined) {
                throw new Error('This runtime scenario has no pending provider probe');
            }
            return pendingProbe.reject(new Error(`synthetic ${pendingProvider} probe failure`));
        },
        start: async () => {
            await evaluateCompiledEntrypoint(container, record);
            await clock.advanceBy(0);
        },
    };
};

const attemptTimes = (failures: number, startsAt = 0): number[] =>
    Array.from({ length: failures + 1 }, (_, attempt) => startsAt + attempt * 1_000);

describe('runtime dependency wait', () => {
    it.each([
        { databaseFailures: 0, label: 'both providers succeed on their first attempt', tunerFailures: 0 },
        { databaseFailures: 0, label: 'the tuner succeeds after one failure', tunerFailures: 1 },
        { databaseFailures: 0, label: 'the tuner succeeds after multiple failures', tunerFailures: 2 },
        { databaseFailures: 1, label: 'the database succeeds after one failure', tunerFailures: 0 },
        { databaseFailures: 2, label: 'the database succeeds after multiple failures', tunerFailures: 0 },
    ] satisfies Array<DependencyFailureScenario & { readonly label: string }>)(
        '[AR-3.1][AR-3.2][AR-3.3][AR-3.4][AR-3.5] $label',
        async ({ databaseFailures, tunerFailures }) => {
            const scenario = createRuntimeScenario({ databaseFailures, tunerFailures });

            try {
                await scenario.start();

                expect(scenario.entriesFor('tuner-attempt')).toEqual([0]);
                expect(scenario.entriesFor('operator-log')).toEqual([0]);
                for (let failure = 0; failure < tunerFailures; failure += 1) {
                    expect(scenario.entriesFor('database-attempt')).toEqual([]);
                    expect(scenario.entriesFor('operator-start')).toEqual([]);
                    expect(vi.getTimerCount()).toBe(1);

                    await scenario.clock.advanceBy(999);

                    expect(scenario.entriesFor('tuner-attempt')).toHaveLength(failure + 1);
                    expect(scenario.entriesFor('operator-start')).toEqual([]);

                    await scenario.clock.advanceBy(1);
                }

                const databaseStartedAt = tunerFailures * 1_000;
                expect(scenario.entriesFor('tuner-attempt')).toEqual(attemptTimes(tunerFailures));
                expect(scenario.entriesFor('database-attempt')).toEqual([databaseStartedAt]);
                for (let failure = 0; failure < databaseFailures; failure += 1) {
                    expect(scenario.entriesFor('operator-start')).toEqual([]);
                    expect(vi.getTimerCount()).toBe(1);

                    await scenario.clock.advanceBy(999);

                    expect(scenario.entriesFor('database-attempt')).toHaveLength(failure + 1);
                    expect(scenario.entriesFor('operator-start')).toEqual([]);

                    await scenario.clock.advanceBy(1);
                }

                const databaseSuccessAt = databaseStartedAt + databaseFailures * 1_000;
                expect(scenario.entriesFor('database-attempt')).toEqual(
                    attemptTimes(databaseFailures, databaseStartedAt),
                );
                expect(scenario.entriesFor('operator-start')).toHaveLength(1);
                expect(scenario.entriesFor('operator-start')[0]).toBeGreaterThanOrEqual(databaseSuccessAt);
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                scenario.dispose();
            }
        },
    );

    it('[AR-3.2][AR-3.4][AR-3.5] runs retries at their 1,000ms boundaries when the event loop advances late', async () => {
        const scenario = createRuntimeScenario({ databaseFailures: 2, tunerFailures: 2 });

        try {
            await scenario.start();

            expect(scenario.entriesFor('tuner-attempt')).toEqual([0]);
            expect(scenario.entriesFor('database-attempt')).toEqual([]);
            expect(scenario.entriesFor('operator-start')).toEqual([]);
            expect(vi.getTimerCount()).toBe(1);

            await scenario.clock.advanceBy(999);

            expect(scenario.entriesFor('tuner-attempt')).toEqual([0]);
            expect(scenario.entriesFor('database-attempt')).toEqual([]);
            expect(scenario.entriesFor('operator-start')).toEqual([]);
            expect(vi.getTimerCount()).toBe(1);

            await scenario.clock.advanceBy(1);

            expect(scenario.entriesFor('tuner-attempt')).toEqual([0, 1_000]);
            expect(scenario.entriesFor('database-attempt')).toEqual([]);
            expect(scenario.entriesFor('operator-start')).toEqual([]);
            expect(vi.getTimerCount()).toBe(1);

            await scenario.clock.advanceBy(1_000);
            await scenario.clock.advanceBy(0);

            expect(scenario.entriesFor('tuner-attempt')).toEqual([0, 1_000, 2_000]);
            expect(scenario.entriesFor('database-attempt')).toEqual([2_000]);
            expect(scenario.entriesFor('operator-start')).toEqual([]);
            expect(vi.getTimerCount()).toBe(1);

            await scenario.clock.advanceBy(999);

            expect(scenario.entriesFor('database-attempt')).toEqual([2_000]);
            expect(scenario.entriesFor('operator-start')).toEqual([]);
            expect(vi.getTimerCount()).toBe(1);

            await scenario.clock.advanceBy(1);

            expect(scenario.entriesFor('database-attempt')).toEqual([2_000, 3_000]);
            expect(scenario.entriesFor('operator-start')).toEqual([]);
            expect(vi.getTimerCount()).toBe(1);

            await scenario.clock.advanceBy(1_001);
            await scenario.clock.advanceBy(0);

            expect(scenario.clock.now()).toBe(4_001);
            expect(scenario.entriesFor('database-attempt')).toEqual([2_000, 3_000, 4_000]);
            expect(scenario.entriesFor('operator-start')).toHaveLength(1);
            expect(scenario.entriesFor('operator-start')[0]).toBeGreaterThanOrEqual(4_000);
            expect(scenario.entriesFor('operator-start')[0]).toBeGreaterThanOrEqual(
                scenario.entriesFor('database-attempt')[2],
            );
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            scenario.dispose();
        }
    });

    it.each([
        { databaseFailures: 0, pendingProvider: 'tuner', tunerFailures: 4 },
        { databaseFailures: 4, pendingProvider: 'database', tunerFailures: 0 },
    ] satisfies Array<Required<DependencyFailureScenario>>)(
        '[AR-3.6][AR-3.7] keeps one pending $pendingProvider probe unbounded, then retries after settlement without a cap or overall deadline',
        async ({ databaseFailures, pendingProvider, tunerFailures }) => {
            const scenario = createRuntimeScenario({ databaseFailures, pendingProvider, tunerFailures });
            const longPendingInterval = 7 * 24 * 60 * 60 * 1_000;
            const retryFailures = pendingProvider === 'tuner' ? tunerFailures : databaseFailures;
            const pendingOperation = pendingProvider === 'tuner' ? 'tuner-attempt' : 'database-attempt';
            const blockedOperation = pendingProvider === 'tuner' ? 'database-attempt' : 'operator-start';

            try {
                await scenario.start();

                expect(scenario.entriesFor(pendingOperation)).toEqual([0]);
                expect(scenario.entriesFor(blockedOperation)).toEqual([]);
                expect(scenario.entriesFor('operator-start')).toEqual([]);
                expect(scenario.entriesFor('fatal-log')).toEqual([]);
                expect(vi.getTimerCount()).toBe(0);

                await scenario.clock.advanceBy(longPendingInterval);

                expect(scenario.entriesFor(pendingOperation)).toEqual([0]);
                expect(scenario.entriesFor(blockedOperation)).toEqual([]);
                expect(scenario.entriesFor('operator-start')).toEqual([]);
                expect(scenario.entriesFor('fatal-log')).toEqual([]);
                expect(vi.getTimerCount()).toBe(0);
                expect(scenario.rejectPending()).toBe(true);
                await scenario.clock.advanceBy(0);
                expect(vi.getTimerCount()).toBe(1);

                for (let retry = 0; retry <= retryFailures; retry += 1) {
                    await scenario.clock.advanceBy(999);

                    expect(scenario.entriesFor(pendingOperation)).toHaveLength(retry + 1);
                    expect(scenario.entriesFor('operator-start')).toEqual([]);

                    await scenario.clock.advanceBy(1);
                }

                const retryTimes = Array.from(
                    { length: retryFailures + 1 },
                    (_, retry) => longPendingInterval + (retry + 1) * 1_000,
                );
                const providerRecoveredAt = retryTimes.at(-1)!;

                expect(scenario.entriesFor(pendingOperation)).toEqual([0, ...retryTimes]);
                if (pendingProvider === 'tuner') {
                    expect(scenario.entriesFor('database-attempt')).toEqual([providerRecoveredAt]);
                } else {
                    expect(scenario.entriesFor('tuner-attempt')).toEqual([0]);
                }
                expect(scenario.entriesFor('operator-start')).toHaveLength(1);
                expect(scenario.entriesFor('operator-start')[0]).toBeGreaterThanOrEqual(providerRecoveredAt);
                expect(scenario.entriesFor('fatal-log')).toEqual([]);
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                scenario.dispose();
            }
        },
    );

    it('attributes the compiled entrypoint script to its on-disk path when the runtime starts: dynamic-eval migration gap', async () => {
        const scenario = createRuntimeScenario({ databaseFailures: 0, tunerFailures: 0 });
        const session = new Session.Session();
        session.connect();
        const post = <T>(method: string, parameters?: Record<string, unknown>): Promise<T> =>
            new Promise((resolve, reject) => {
                session.post(method, parameters, (error, result) => {
                    if (error) {
                        reject(error instanceof Error ? error : new Error(String(error)));
                        return;
                    }
                    resolve(result as T);
                });
            });

        try {
            await post('Profiler.enable');
            await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });

            await scenario.start();

            const { result } = await post<{
                result: ReadonlyArray<{ url: string }>;
            }>('Profiler.takePreciseCoverage');

            const entrypointUrl = pathToFileURL(join(compiledSnapshot, 'index.js')).href;
            expect(result.some(script => script.url === entrypointUrl)).toBe(true);
        } finally {
            await post('Profiler.stopPreciseCoverage').catch(() => undefined);
            await post('Profiler.disable').catch(() => undefined);
            session.disconnect();
            scenario.dispose();
        }
    });
});
