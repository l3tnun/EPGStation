import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getClassMetadata } from '@inversifyjs/core';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { evaluateCompiledRuntime, loadDefault } from './_runtime-harness';

type RuntimeServiceChild = EventEmitter & {
    readonly kill: () => boolean;
    readonly pid: number;
    readonly stderr: null;
    readonly stdout: null;
};

interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly reject: (cause: unknown) => void;
    readonly resolve: (value: T) => void;
}

type StartupStageObserver = <T>(operation: () => Promise<T>, recordOverdue: () => void) => Promise<T>;

interface RuntimeStartupWorkflowInput {
    readonly runRecordingReconciliation: () => Promise<void>;
    readonly runRecordingCandidatesAndStart: () => Promise<void>;
    readonly runExpiredReservationCleanup: () => Promise<void>;
    readonly startEpgSupervisor: () => Promise<void>;
}

type TerminalOutcome<T> =
    | { readonly kind: 'rejected'; readonly cause: unknown }
    | { readonly kind: 'resolved'; readonly value: T };

const loadStartupStageObserver = (): StartupStageObserver => loadDefault<StartupStageObserver>('StartupStageObserver.js');

const createDeferred = <T>(): Deferred<T> => {
    let reject!: (cause: unknown) => void;
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        reject = rejectPromise;
        resolve = resolvePromise;
    });
    return { promise, reject, resolve };
};

const captureTerminalOutcome = <T>(promise: Promise<T>): TerminalOutcome<T>[] => {
    const outcomes: TerminalOutcome<T>[] = [];
    void promise.then(
        value => outcomes.push({ kind: 'resolved', value }),
        cause => outcomes.push({ cause, kind: 'rejected' }),
    );
    return outcomes;
};

const removeAddedProcessListeners = (
    event: 'uncaughtException' | 'unhandledRejection',
    originalListeners: readonly ((...arguments_: any[]) => void)[],
): void => {
    for (const listener of process.listeners(event)) {
        if (!originalListeners.includes(listener)) {
            process.removeListener(event, listener);
        }
    }
};

interface EpgUpdateEventLike {
    emitUpdated(): void;
}

type EpgChild = EventEmitter & {
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
    epgUpdateEvent: EpgUpdateEventLike,
) => { execute(): Promise<void> };

const createServiceChild = (pid: number): RuntimeServiceChild =>
    Object.assign(new EventEmitter(), {
        kill: vi.fn(() => true),
        pid,
        stderr: null,
        stdout: null,
    }) as RuntimeServiceChild;

const createEpgChild = (pid: number): EpgChild =>
    Object.assign(new EventEmitter(), {
        kill: vi.fn(() => true),
        pid,
        stderr: new PassThrough(),
        stdout: new PassThrough(),
    }) as EpgChild;

/**
 * Loads the compiled EPG child supervisor fresh with `child_process` replaced by `spawnImplementation`, so the
 * supervisor's own spawn call never starts a real EPG child.
 */
const loadEpgSupervisor = async (
    spawnImplementation: (...arguments_: unknown[]) => unknown,
): Promise<EpgSupervisorConstructor> => {
    const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
    if (compiledSnapshot === undefined || !isAbsolute(compiledSnapshot)) {
        throw new Error('Server test runner did not provide an absolute compiled snapshot');
    }
    vi.doMock('node:child_process', () => ({ spawn: spawnImplementation }));
    vi.doMock('child_process', () => ({ spawn: spawnImplementation }));
    try {
        vi.resetModules();
        const imported = (await import(
            pathToFileURL(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdateExecutorManageModel.js')).href
        )) as { default: EpgSupervisorConstructor };
        return imported.default;
    } finally {
        vi.doUnmock('node:child_process');
        vi.doUnmock('child_process');
    }
};

/** Runtime dependencies for a startup that succeeds everywhere; each test overrides the ports it observes. */
const createRuntimeServices = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    IConfiguration: { getConfig: () => ({}) },
    IConnectionCheckModel: { checkDB: async () => undefined, checkMirakurun: async () => undefined },
    IEPGUpdateExecutorManageModel: { execute: vi.fn() },
    IEventSetter: { set: vi.fn() },
    IIPCServer: { initialize: async () => undefined, register: vi.fn() },
    ILoggerModel: {
        getLogger: () => ({ system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() } }),
        initialize: vi.fn(),
    },
    IRecordingManageModel: {
        cleanup: async () => undefined,
        rebuildCandidatesAndStart: async () => undefined,
        setTuner: vi.fn(),
    },
    IReservationManageModel: { cleanup: async () => undefined, setTuners: vi.fn() },
    IStorageManageModel: { start: vi.fn() },
    TunerServerAccess: { getTuners: async () => [] },
    ...overrides,
});

interface CompiledRuntimeObservation {
    /** The identifiers the compiled Runtime resolved from its container, in no particular order. */
    readonly requestedIdentifiers: () => string[];
    readonly spawnServiceChild: ReturnType<typeof vi.fn>;
    /** The Workflow input the Runtime bound, when the services did not supply their own Workflow port. */
    readonly workflowInput: () => RuntimeStartupWorkflowInput;
}

/**
 * Evaluates the compiled Runtime in-process under fake timers against `services` and runs `observe` before restoring
 * the process-level state the Runtime touched. When `services` has no Workflow port, a capturing port stands in that
 * records the input the Runtime binds and never runs a stage by itself.
 */
const withCompiledRuntime = async (
    services: Record<string, unknown>,
    serviceChild: RuntimeServiceChild,
    observe: (observation: CompiledRuntimeObservation) => Promise<void>,
): Promise<void> => {
    let capturedInput: RuntimeStartupWorkflowInput | undefined;
    const requested = new Set<string>();
    const effectiveServices: Record<string, unknown> = {
        IRuntimeStartupWorkflowPort: {
            runAfterServiceSupervisionAccepted: async (input: RuntimeStartupWorkflowInput) => {
                capturedInput = input;
                return { kind: 'Succeeded', stage: 'epg-supervisor-start' } as const;
            },
        },
        ...services,
    };
    const container = {
        get: (identifier: string): unknown => {
            if (!Object.hasOwn(effectiveServices, identifier)) {
                throw new Error(`Unexpected runtime dependency: ${identifier}`);
            }
            requested.add(identifier);
            return effectiveServices[identifier];
        },
    };
    const spawnServiceChild = vi.fn(() => serviceChild);
    const originalUncaughtExceptionListeners = process.listeners('uncaughtException');
    const originalUnhandledRejectionListeners = process.listeners('unhandledRejection');
    const getuid = typeof process.getuid === 'function' ? vi.spyOn(process, 'getuid').mockReturnValue(1000) : undefined;

    vi.useFakeTimers();
    try {
        await evaluateCompiledRuntime(container, spawnServiceChild);
        await vi.advanceTimersByTimeAsync(0);
        await observe({
            requestedIdentifiers: () => [...requested],
            spawnServiceChild,
            workflowInput: () => {
                if (capturedInput === undefined) throw new Error('Workflow startup input was not bound');
                return capturedInput;
            },
        });
    } finally {
        getuid?.mockRestore();
        removeAddedProcessListeners('uncaughtException', originalUncaughtExceptionListeners);
        removeAddedProcessListeners('unhandledRejection', originalUnhandledRejectionListeners);
        vi.useRealTimers();
    }
};

const startupResolvedIdentifiers = [
    'IConfiguration',
    'IConnectionCheckModel',
    'IEventSetter',
    'IIPCServer',
    'ILoggerModel',
    'IRecordingManageModel',
    'IReservationManageModel',
    'IRuntimeStartupWorkflowPort',
    'IStorageManageModel',
    'TunerServerAccess',
] as const;

describe('600-second startup stage observer', () => {
    it.each(['resolve', 'reject'] as const)(
        '[AR-6.8] preserves an original %s at 599999ms without recording overdue',
        async outcome => {
            vi.useFakeTimers();
            try {
                const observeStartupStage = loadStartupStageObserver();
                const provider = createDeferred<object>();
                const expectedValue = Object.freeze({ state: 'succeeded' });
                const expectedFailure = new Error('synthetic provider failure');
                const operation = vi.fn(() => provider.promise);
                const recordOverdue = vi.fn();
                const observed = observeStartupStage(operation, recordOverdue);
                const terminalOutcomes = captureTerminalOutcome(observed);

                await vi.advanceTimersByTimeAsync(599_999);
                expect(recordOverdue).not.toHaveBeenCalled();
                expect(vi.getTimerCount()).toBe(1);

                if (outcome === 'resolve') {
                    provider.resolve(expectedValue);
                    await expect(observed).resolves.toBe(expectedValue);
                } else {
                    provider.reject(expectedFailure);
                    await expect(observed).rejects.toBe(expectedFailure);
                }
                await vi.advanceTimersByTimeAsync(2);

                expect(operation).toHaveBeenCalledTimes(1);
                expect(recordOverdue).not.toHaveBeenCalled();
                expect(terminalOutcomes).toHaveLength(1);
                if (outcome === 'resolve') {
                    expect(terminalOutcomes[0]).toEqual({ kind: 'resolved', value: expectedValue });
                } else {
                    expect(terminalOutcomes[0]).toEqual({ cause: expectedFailure, kind: 'rejected' });
                }
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        },
    );

    // 600_000 (600s) is STARTUP_STAGE_OVERDUE_MS (src/StartupStageObserver.ts:1), a v3-only soft
    // observation deadline with no v2 counterpart -- approved in
    // .kiro/specs/server-application-runtime/design.md:185.
    it.each(['resolve', 'reject'] as const)(
        '[AR-6.8] records overdue once at 600000ms and preserves the late original %s at 600001ms',
        async outcome => {
            vi.useFakeTimers();
            try {
                const observeStartupStage = loadStartupStageObserver();
                const provider = createDeferred<object>();
                const expectedValue = Object.freeze({ state: 'succeeded' });
                const expectedFailure = new Error('synthetic provider failure');
                const operation = vi.fn(() => provider.promise);
                const recordOverdue = vi.fn();
                const observed = observeStartupStage(operation, recordOverdue);
                const terminalOutcomes = captureTerminalOutcome(observed);

                await vi.advanceTimersByTimeAsync(599_999);
                expect(recordOverdue).not.toHaveBeenCalled();
                expect(terminalOutcomes).toEqual([]);
                expect(vi.getTimerCount()).toBe(1);

                await vi.advanceTimersByTimeAsync(1);
                expect(recordOverdue).toHaveBeenCalledTimes(1);
                expect(terminalOutcomes).toEqual([]);
                expect(vi.getTimerCount()).toBe(0);

                await vi.advanceTimersByTimeAsync(1);
                expect(recordOverdue).toHaveBeenCalledTimes(1);
                if (outcome === 'resolve') {
                    provider.resolve(expectedValue);
                    await expect(observed).resolves.toBe(expectedValue);
                } else {
                    provider.reject(expectedFailure);
                    await expect(observed).rejects.toBe(expectedFailure);
                }
                await Promise.resolve();

                expect(operation).toHaveBeenCalledTimes(1);
                expect(recordOverdue).toHaveBeenCalledTimes(1);
                expect(terminalOutcomes).toHaveLength(1);
                if (outcome === 'resolve') {
                    expect(terminalOutcomes[0]).toEqual({ kind: 'resolved', value: expectedValue });
                } else {
                    expect(terminalOutcomes[0]).toEqual({ cause: expectedFailure, kind: 'rejected' });
                }
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        },
    );

    it.each(['resolve', 'reject'] as const)(
        '[AR-6.8] preserves one original %s when provider settlement races the deadline in the same tick',
        async outcome => {
            vi.useFakeTimers();
            try {
                const observeStartupStage = loadStartupStageObserver();
                const expectedValue = Object.freeze({ state: 'succeeded' });
                const expectedFailure = new Error('synthetic provider failure');
                const recordOverdue = vi.fn();
                const operation = vi.fn(
                    () =>
                        new Promise<object>((resolve, reject) => {
                            setTimeout(() => {
                                if (outcome === 'resolve') {
                                    resolve(expectedValue);
                                } else {
                                    reject(expectedFailure);
                                }
                            }, 600_000);
                        }),
                );
                const observed = observeStartupStage(operation, recordOverdue);
                const terminalOutcomes = captureTerminalOutcome(observed);

                await vi.advanceTimersByTimeAsync(600_000);
                if (outcome === 'resolve') {
                    await expect(observed).resolves.toBe(expectedValue);
                } else {
                    await expect(observed).rejects.toBe(expectedFailure);
                }
                await vi.advanceTimersByTimeAsync(1);

                expect(operation).toHaveBeenCalledTimes(1);
                expect(recordOverdue).toHaveBeenCalledTimes(1);
                expect(terminalOutcomes).toHaveLength(1);
                if (outcome === 'resolve') {
                    expect(terminalOutcomes[0]).toEqual({ kind: 'resolved', value: expectedValue });
                } else {
                    expect(terminalOutcomes[0]).toEqual({ cause: expectedFailure, kind: 'rejected' });
                }
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        },
    );
});

describe('runtime startup Workflow handoff', () => {
    it.each(['Failed', 'rejected'] as const)(
        '[AR-6.3] handles a Workflow %s outcome without Runtime-local retry or shutdown handling',
        async outcome => {
            const workflowFailure = new Error(`Workflow ${outcome}`);
            const killService = vi.fn(() => true);
            const recordError = vi.fn();
            const recordFatal = vi.fn();
            const serviceChild = Object.assign(new EventEmitter(), {
                kill: killService,
                pid: 720,
                stderr: null,
                stdout: null,
            }) as RuntimeServiceChild;
            const runAfterServiceSupervisionAccepted = vi.fn(() =>
                outcome === 'Failed'
                    ? Promise.resolve({
                          cause: workflowFailure,
                          kind: 'Failed' as const,
                          stage: 'recording-reconciliation' as const,
                      })
                    : Promise.reject(workflowFailure),
            );
            const services: Record<string, unknown> = {
                IConfiguration: { getConfig: () => ({}) },
                IConnectionCheckModel: {
                    checkDB: async () => undefined,
                    checkMirakurun: async () => undefined,
                },
                IEPGUpdateExecutorManageModel: { execute: vi.fn() },
                IEventSetter: { set: vi.fn() },
                IIPCServer: { initialize: async () => undefined, register: vi.fn() },
                ILoggerModel: {
                    getLogger: () => ({ system: { error: recordError, fatal: recordFatal, info: vi.fn() } }),
                    initialize: vi.fn(),
                },
                IRecordingManageModel: {
                    cleanup: async () => undefined,
                    rebuildCandidatesAndStart: async () => undefined,
                    setTuner: vi.fn(),
                },
                IReservationManageModel: { cleanup: async () => undefined, setTuners: vi.fn() },
                IRuntimeStartupWorkflowPort: { runAfterServiceSupervisionAccepted },
                IStorageManageModel: { start: vi.fn() },
                TunerServerAccess: { getTuners: async () => [] },
            };
            const originalUncaughtExceptionListeners = process.listeners('uncaughtException');
            const originalUnhandledRejectionListeners = process.listeners('unhandledRejection');
            const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
            const getuid =
                typeof process.getuid === 'function' ? vi.spyOn(process, 'getuid').mockReturnValue(1000) : undefined;

            const container = {
                get: (identifier: string): unknown => {
                    if (!Object.hasOwn(services, identifier)) {
                        throw new Error(`Unexpected runtime dependency: ${identifier}`);
                    }
                    return services[identifier];
                },
            };
            const spawnServiceChild = vi.fn(() => serviceChild);

            vi.useFakeTimers();
            try {
                await evaluateCompiledRuntime(container, spawnServiceChild);
                await vi.advanceTimersByTimeAsync(0);

                expect(runAfterServiceSupervisionAccepted).toHaveBeenCalledOnce();
                expect(recordError).not.toHaveBeenCalled();
                if (outcome === 'Failed') {
                    // Requirements 2.7, 6.7: a typed `Failed` outcome fulfils (it never rejects), so
                    // Runtime must record stage and cause exactly once through the existing fatal path.
                    expect(recordFatal).toHaveBeenCalledOnce();
                    const [message] = recordFatal.mock.calls[0] as [string];
                    expect(message).toContain('recording-reconciliation');
                    expect(message).toContain(workflowFailure.message);
                } else {
                    // Requirement 2.7: a Port rejection this Runtime catch absorbs never becomes a process-level
                    // uncaught/unhandled failure, so it stays outside 2.7's recording trigger and must not be
                    // conflated with a typed `Failed` record.
                    expect(recordFatal).not.toHaveBeenCalled();
                }
                expect(killService).not.toHaveBeenCalled();
                expect(exit).not.toHaveBeenCalled();
                expect(spawnServiceChild).toHaveBeenCalledTimes(1);
            } finally {
                exit.mockRestore();
                getuid?.mockRestore();
                removeAddedProcessListeners('uncaughtException', originalUncaughtExceptionListeners);
                removeAddedProcessListeners('unhandledRejection', originalUnhandledRejectionListeners);
                vi.useRealTimers();
            }
        },
    );

    it('[AR-6.3] records a Workflow Failed outcome with a non-Error cause using its String() representation', async () => {
        const nonErrorCause = 'synthetic non-Error startup failure';
        const killService = vi.fn(() => true);
        const recordError = vi.fn();
        const recordFatal = vi.fn();
        const serviceChild = Object.assign(new EventEmitter(), {
            kill: killService,
            pid: 721,
            stderr: null,
            stdout: null,
        }) as RuntimeServiceChild;
        const runAfterServiceSupervisionAccepted = vi.fn(() =>
            Promise.resolve({
                cause: nonErrorCause,
                kind: 'Failed' as const,
                stage: 'expired-reservation-cleanup' as const,
            }),
        );
        const services: Record<string, unknown> = {
            IConfiguration: { getConfig: () => ({}) },
            IConnectionCheckModel: {
                checkDB: async () => undefined,
                checkMirakurun: async () => undefined,
            },
            IEPGUpdateExecutorManageModel: { execute: vi.fn() },
            IEventSetter: { set: vi.fn() },
            IIPCServer: { initialize: async () => undefined, register: vi.fn() },
            ILoggerModel: {
                getLogger: () => ({ system: { error: recordError, fatal: recordFatal, info: vi.fn() } }),
                initialize: vi.fn(),
            },
            IRecordingManageModel: {
                cleanup: async () => undefined,
                rebuildCandidatesAndStart: async () => undefined,
                setTuner: vi.fn(),
            },
            IReservationManageModel: { cleanup: async () => undefined, setTuners: vi.fn() },
            IRuntimeStartupWorkflowPort: { runAfterServiceSupervisionAccepted },
            IStorageManageModel: { start: vi.fn() },
            TunerServerAccess: { getTuners: async () => [] },
        };
        const originalUncaughtExceptionListeners = process.listeners('uncaughtException');
        const originalUnhandledRejectionListeners = process.listeners('unhandledRejection');
        const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
        const getuid =
            typeof process.getuid === 'function' ? vi.spyOn(process, 'getuid').mockReturnValue(1000) : undefined;

        const container = {
            get: (identifier: string): unknown => {
                if (!Object.hasOwn(services, identifier)) {
                    throw new Error(`Unexpected runtime dependency: ${identifier}`);
                }
                return services[identifier];
            },
        };
        const spawnServiceChild = vi.fn(() => serviceChild);

        vi.useFakeTimers();
        try {
            await evaluateCompiledRuntime(container, spawnServiceChild);
            await vi.advanceTimersByTimeAsync(0);

            expect(runAfterServiceSupervisionAccepted).toHaveBeenCalledOnce();
            expect(recordError).not.toHaveBeenCalled();
            // Minor-2: StartupContinuationCoordinator returns whatever value a stage `catch (cause)` observed
            // verbatim, so a non-Error `cause` (e.g. a stage that threw a plain string) is a real, reachable
            // case, not just a theoretical one. Runtime must fall back to `String(cause)` instead of assuming
            // an Error shape.
            expect(recordFatal).toHaveBeenCalledOnce();
            const [message] = recordFatal.mock.calls[0] as [string];
            expect(message).toContain('expired-reservation-cleanup');
            expect(message).toContain(String(nonErrorCause));
            expect(killService).not.toHaveBeenCalled();
            expect(exit).not.toHaveBeenCalled();
            expect(spawnServiceChild).toHaveBeenCalledTimes(1);
        } finally {
            exit.mockRestore();
            getuid?.mockRestore();
            removeAddedProcessListeners('uncaughtException', originalUncaughtExceptionListeners);
            removeAddedProcessListeners('unhandledRejection', originalUnhandledRejectionListeners);
            vi.useRealTimers();
        }
    });

    it('[AR-6.1][AR-6.4][AR-6.6][AR-7.1] hands observed provider ports and one EPG callback to Workflow after Service supervision', async () => {
        const ledger: string[] = [];
        const cleanup = vi.fn(async () => ledger.push('recording.cleanup'));
        const rebuildCandidatesAndStart = vi.fn(async () => ledger.push('recording.rebuild'));
        const recordingManager = new Proxy(
            {
                cleanup,
                rebuildCandidatesAndStart,
                setTuner: vi.fn(),
            },
            {
                get(target, property, receiver) {
                    if (Reflect.has(target, property)) {
                        return Reflect.get(target, property, receiver);
                    }
                    if (typeof property === 'string') {
                        return (..._arguments: unknown[]) => ledger.push(`startup-only.${property}`);
                    }
                    return undefined;
                },
            },
        );
        const epgExecute = vi.fn(() => ledger.push('epg.execute'));
        const killService = vi.fn(() => true);
        const recordOverdue = vi.fn();
        const recordFatal = vi.fn();
        const reservationCleanup = vi.fn(async () => ledger.push('reservation.cleanup'));
        let workflowInput: RuntimeStartupWorkflowInput | undefined;
        const runAfterServiceSupervisionAccepted = vi.fn(async (input: RuntimeStartupWorkflowInput) => {
            workflowInput = input;
            ledger.push('workflow.startup');
            return { kind: 'Succeeded', stage: 'epg-supervisor-start' } as const;
        });
        const serviceChild = Object.assign(new EventEmitter(), {
            kill: killService,
            pid: 721,
            stderr: null,
            stdout: null,
        }) as RuntimeServiceChild;
        const services: Record<string, unknown> = {
            IConfiguration: { getConfig: () => ({}) },
            IConnectionCheckModel: {
                checkDB: async () => undefined,
                checkMirakurun: async () => undefined,
            },
            IEPGUpdateExecutorManageModel: { execute: epgExecute },
            IEventSetter: { set: vi.fn() },
            IIPCServer: {
                initialize: async () => undefined,
                register: vi.fn(() => ledger.push('ipc-register')),
            },
            ILoggerModel: {
                getLogger: () => ({ system: { error: recordOverdue, fatal: recordFatal, info: vi.fn() } }),
                initialize: vi.fn(),
            },
            IRecordingManageModel: recordingManager,
            IReservationManageModel: {
                cleanup: reservationCleanup,
                setTuners: vi.fn(),
            },
            IStorageManageModel: { start: vi.fn() },
            IRuntimeStartupWorkflowPort: { runAfterServiceSupervisionAccepted },
            TunerServerAccess: { getTuners: async () => [] },
        };
        const originalUncaughtExceptionListeners = process.listeners('uncaughtException');
        const originalUnhandledRejectionListeners = process.listeners('unhandledRejection');
        const getuid =
            typeof process.getuid === 'function' ? vi.spyOn(process, 'getuid').mockReturnValue(1000) : undefined;

        const container = {
            get: (identifier: string): unknown => {
                if (!Object.hasOwn(services, identifier)) {
                    throw new Error(`Unexpected runtime dependency: ${identifier}`);
                }
                return services[identifier];
            },
        };
        const spawnServiceChild = vi.fn(() => serviceChild);

        vi.useFakeTimers();
        try {
            await evaluateCompiledRuntime(container, spawnServiceChild);
            await vi.advanceTimersByTimeAsync(0);

            expect(runAfterServiceSupervisionAccepted).toHaveBeenCalledOnce();
            expect(workflowInput).toBeDefined();
            expect(ledger).toEqual(['ipc-register', 'workflow.startup']);
            expect(ledger.filter(operation => operation.startsWith('startup-only.'))).toEqual([]);
            expect(cleanup).not.toHaveBeenCalled();
            expect(rebuildCandidatesAndStart).not.toHaveBeenCalled();
            expect(reservationCleanup).not.toHaveBeenCalled();
            expect(epgExecute).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);

            if (workflowInput === undefined) throw new Error('Workflow startup input was not bound');
            await workflowInput.runRecordingReconciliation();
            await workflowInput.runRecordingCandidatesAndStart();
            await workflowInput.runExpiredReservationCleanup();
            await workflowInput.startEpgSupervisor();
            await workflowInput.startEpgSupervisor();

            expect(cleanup).toHaveBeenCalledTimes(1);
            expect(rebuildCandidatesAndStart).toHaveBeenCalledTimes(1);
            expect(reservationCleanup).toHaveBeenCalledTimes(1);
            // startEpgSupervisor is module-local one-shot: a second request must not re-run the EPG updater.
            expect(epgExecute).toHaveBeenCalledTimes(1);
            expect(recordOverdue).not.toHaveBeenCalled();
            expect(killService).not.toHaveBeenCalled();
            expect(recordFatal).not.toHaveBeenCalled();
            expect(spawnServiceChild).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            getuid?.mockRestore();
            removeAddedProcessListeners('uncaughtException', originalUncaughtExceptionListeners);
            removeAddedProcessListeners('unhandledRejection', originalUnhandledRejectionListeners);
            vi.useRealTimers();
        }
    });

    it.each([
        { expected: { rebuild: 0, reservation: 0 }, failing: 'recording-reconciliation' as const },
        { expected: { rebuild: 1, reservation: 0 }, failing: 'recording-candidates-and-start' as const },
        { expected: { rebuild: 1, reservation: 1 }, failing: 'expired-reservation-cleanup' as const },
    ])(
        '[AR-6.7] stops after a $failing failure without a later stage, a retry, or a Runtime shutdown',
        async ({ expected, failing }) => {
            const StartupContinuationCoordinator = loadDefault<new () => unknown>(
                'model/workflow/StartupContinuationCoordinator.js',
            );
            const failure = new Error(`synthetic ${failing} failure`);
            const failIf = (stage: string) => async (): Promise<void> => {
                if (stage === failing) throw failure;
            };
            const cleanup = vi.fn(failIf('recording-reconciliation'));
            const rebuildCandidatesAndStart = vi.fn(failIf('recording-candidates-and-start'));
            const reservationCleanup = vi.fn(failIf('expired-reservation-cleanup'));
            const epgExecute = vi.fn();
            const recordError = vi.fn();
            const recordFatal = vi.fn();
            const serviceChild = createServiceChild(723);
            const services = createRuntimeServices({
                IEPGUpdateExecutorManageModel: { execute: epgExecute },
                ILoggerModel: {
                    getLogger: () => ({ system: { error: recordError, fatal: recordFatal, info: vi.fn() } }),
                    initialize: vi.fn(),
                },
                IRecordingManageModel: { cleanup, rebuildCandidatesAndStart, setTuner: vi.fn() },
                IReservationManageModel: { cleanup: reservationCleanup, setTuners: vi.fn() },
                IRuntimeStartupWorkflowPort: new StartupContinuationCoordinator(),
            });
            const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

            try {
                await withCompiledRuntime(services, serviceChild, async ({ spawnServiceChild }) => {
                    // 最初の失敗の後に十分な時間が経っても、同じ段階の再実行も後続段階の開始も起きない。
                    await vi.advanceTimersByTimeAsync(1_200_000);

                    expect(cleanup).toHaveBeenCalledTimes(1);
                    expect(rebuildCandidatesAndStart).toHaveBeenCalledTimes(expected.rebuild);
                    expect(reservationCleanup).toHaveBeenCalledTimes(expected.reservation);
                    expect(epgExecute).not.toHaveBeenCalled();
                    expect(recordFatal).toHaveBeenCalledOnce();
                    const [message] = recordFatal.mock.calls[0] as [string];
                    expect(message).toContain(failing);
                    expect(message).toContain(failure.message);
                    expect(recordError).not.toHaveBeenCalled();
                    expect(serviceChild.kill).not.toHaveBeenCalled();
                    expect(exit).not.toHaveBeenCalled();
                    expect(spawnServiceChild).toHaveBeenCalledTimes(1);
                    expect(vi.getTimerCount()).toBe(0);
                });
            } finally {
                exit.mockRestore();
            }
        },
    );

    it('[AR-6.5] delegates each startup stage to its owner provider without adding a startup-only notification', async () => {
        const ledger: string[] = [];
        // Any method the Runtime calls on an owner port beyond the stage entry itself is recorded as unexpected.
        const ownerPort = (name: string, methods: Readonly<Record<string, () => Promise<void> | void>>) =>
            new Proxy(methods, {
                get(target, property, receiver) {
                    if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
                    if (typeof property === 'string' && property !== 'then') {
                        return () => ledger.push(`unexpected:${name}.${property}`);
                    }
                    return undefined;
                },
            });
        const recordFatal = vi.fn();
        const services = createRuntimeServices({
            IEventSetter: { set: vi.fn(() => ledger.push('event-binding')) },
            ILoggerModel: {
                getLogger: () => ({ system: { error: vi.fn(), fatal: recordFatal, info: vi.fn() } }),
                initialize: vi.fn(),
            },
            IRecordingManageModel: ownerPort('recording', {
                cleanup: async () => void ledger.push('recording.cleanup'),
                rebuildCandidatesAndStart: async () => void ledger.push('recording.rebuild'),
                setTuner: () => undefined,
            }),
            IReservationManageModel: ownerPort('reservation', {
                cleanup: async () => void ledger.push('reservation.cleanup'),
                setTuners: () => undefined,
            }),
        });

        await withCompiledRuntime(
            services,
            createServiceChild(724),
            async ({ requestedIdentifiers, workflowInput }) => {
                const input = workflowInput();
                await input.runRecordingReconciliation();
                await input.runRecordingCandidatesAndStart();
                await input.runExpiredReservationCleanup();

                expect(ledger).toEqual([
                    'event-binding',
                    'recording.cleanup',
                    'recording.rebuild',
                    'reservation.cleanup',
                ]);
                expect(recordFatal).not.toHaveBeenCalled();
                // 通知は各 owner が既存の event で行うので、Runtime が通知用の provider を解決することはない。
                expect(requestedIdentifiers().sort()).toEqual([...startupResolvedIdentifiers].sort());
            },
        );
    });

    it('[AR-7.2] notifies the reservation update provider once for each completed EPG update message', async () => {
        const reservationUpdateAll = vi.fn(async () => undefined);
        const inertPort = new Proxy(
            {},
            { get: (_target, property) => (property === 'then' ? undefined : () => undefined) },
        );
        const logger = { getLogger: () => ({ system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() } }) };
        const EpgUpdateEvent = loadDefault<new (loggerModel: typeof logger) => EpgUpdateEventLike>(
            'model/event/EPGUpdateEvent.js',
        );
        const EventSetter =
            loadDefault<new (...dependencies: unknown[]) => { set(): void }>('model/event/EventSetter.js');
        const epgUpdateEvent = new EpgUpdateEvent(logger);
        const emitUpdated = vi.spyOn(epgUpdateEvent, 'emitUpdated');
        new EventSetter(
            logger,
            epgUpdateEvent,
            inertPort,
            inertPort,
            inertPort,
            inertPort,
            inertPort,
            inertPort,
            inertPort,
            { updateAll: reservationUpdateAll },
            inertPort,
            { historyCleanup: async () => undefined },
            inertPort,
            inertPort,
            inertPort,
            inertPort,
            { getConfig: () => ({}) },
            { setup: vi.fn() },
        ).set();

        const first = createEpgChild(7_301);
        const second = createEpgChild(7_302);
        const spawn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
        const EpgSupervisor = await loadEpgSupervisor(spawn);
        const supervisor = new EpgSupervisor(logger, epgUpdateEvent);

        try {
            await supervisor.execute();
            expect(reservationUpdateAll).not.toHaveBeenCalled();

            first.emit('message', { msg: 'updated' });
            await vi.waitFor(() => expect(reservationUpdateAll).toHaveBeenCalledTimes(1));
            expect(emitUpdated).toHaveBeenCalledTimes(1);

            // updated 以外の message は更新完了ではないので、予約更新処理へ通知されない。
            first.emit('message', { msg: 'ignored' });
            expect(emitUpdated).toHaveBeenCalledTimes(1);

            first.emit('message', { msg: 'updated' });
            await vi.waitFor(() => expect(reservationUpdateAll).toHaveBeenCalledTimes(2));
            expect(emitUpdated).toHaveBeenCalledTimes(2);
        } finally {
            for (const child of [first, second]) {
                child.removeAllListeners();
                child.stdout.destroy();
                child.stderr.destroy();
            }
        }
    });

    it('[AR-7.4] publishes no common readiness state for Web and API acceptance, startup cleanup, EPG start, or the first EPG update', async () => {
        const ledger: string[] = [];
        const processSend = typeof process.send === 'function' ? vi.spyOn(process, 'send') : undefined;
        const serviceChild = createServiceChild(725);
        const services = createRuntimeServices({
            IEPGUpdateExecutorManageModel: { execute: vi.fn(() => ledger.push('epg.execute')) },
            IIPCServer: {
                initialize: async () => undefined,
                register: vi.fn(() => ledger.push('web-api.accepted')),
            },
            IRecordingManageModel: {
                cleanup: async () => void ledger.push('recording.cleanup'),
                rebuildCandidatesAndStart: async () => void ledger.push('recording.rebuild'),
                setTuner: vi.fn(),
            },
            IReservationManageModel: {
                cleanup: async () => void ledger.push('reservation.cleanup'),
                setTuners: vi.fn(),
            },
        });

        try {
            await withCompiledRuntime(services, serviceChild, async ({ requestedIdentifiers, workflowInput }) => {
                const input = workflowInput();

                // 四つの事実は別々の時点で、それぞれの所有 provider の呼出しとしてだけ現れる。
                expect(ledger).toEqual(['web-api.accepted']);
                await input.runRecordingReconciliation();
                await input.runRecordingCandidatesAndStart();
                await input.runExpiredReservationCleanup();
                expect(ledger).toEqual([
                    'web-api.accepted',
                    'recording.cleanup',
                    'recording.rebuild',
                    'reservation.cleanup',
                ]);
                await input.startEpgSupervisor();
                expect(ledger).toEqual([
                    'web-api.accepted',
                    'recording.cleanup',
                    'recording.rebuild',
                    'reservation.cleanup',
                    'epg.execute',
                ]);

                // 準備完了を表す message の送信・待受けと、状態を持つ別 provider の解決はどこにも無い。
                expect(processSend?.mock.calls ?? []).toEqual([]);
                expect(serviceChild.listenerCount('message')).toBe(0);
                expect(requestedIdentifiers().sort()).toEqual(
                    [...startupResolvedIdentifiers, 'IEPGUpdateExecutorManageModel'].sort(),
                );
            });
        } finally {
            processSend?.mockRestore();
        }
    });

    it.each([
        {
            invoke: (input: RuntimeStartupWorkflowInput) => input.runRecordingReconciliation(),
            stage: 'recording-reconciliation' as const,
        },
        {
            invoke: (input: RuntimeStartupWorkflowInput) => input.runExpiredReservationCleanup(),
            stage: 'expired-reservation-cleanup' as const,
        },
    ])(
        '[AR-6.2][AR-6.8] records startup stage overdue for pending $stage through Runtime composition ports',
        async ({ invoke, stage }) => {
            const pending = createDeferred<void>();
            const cleanup =
                stage === 'recording-reconciliation'
                    ? vi.fn(() => pending.promise)
                    : vi.fn(async () => undefined);
            const reservationCleanup =
                stage === 'expired-reservation-cleanup'
                    ? vi.fn(() => pending.promise)
                    : vi.fn(async () => undefined);
            const rebuildCandidatesAndStart = vi.fn(async () => undefined);
            const epgExecute = vi.fn();
            const recordOverdue = vi.fn();
            const recordFatal = vi.fn();
            let workflowInput: RuntimeStartupWorkflowInput | undefined;
            const runAfterServiceSupervisionAccepted = vi.fn(async (input: RuntimeStartupWorkflowInput) => {
                workflowInput = input;
                return { kind: 'Succeeded', stage: 'epg-supervisor-start' } as const;
            });
            const serviceChild = Object.assign(new EventEmitter(), {
                kill: vi.fn(() => true),
                pid: 722,
                stderr: null,
                stdout: null,
            }) as RuntimeServiceChild;
            const services: Record<string, unknown> = {
                IConfiguration: { getConfig: () => ({}) },
                IConnectionCheckModel: {
                    checkDB: async () => undefined,
                    checkMirakurun: async () => undefined,
                },
                IEPGUpdateExecutorManageModel: { execute: epgExecute },
                IEventSetter: { set: vi.fn() },
                IIPCServer: { initialize: async () => undefined, register: vi.fn() },
                ILoggerModel: {
                    getLogger: () => ({ system: { error: recordOverdue, fatal: recordFatal, info: vi.fn() } }),
                    initialize: vi.fn(),
                },
                IRecordingManageModel: {
                    cleanup,
                    rebuildCandidatesAndStart,
                    setTuner: vi.fn(),
                },
                IReservationManageModel: {
                    cleanup: reservationCleanup,
                    setTuners: vi.fn(),
                },
                IRuntimeStartupWorkflowPort: { runAfterServiceSupervisionAccepted },
                IStorageManageModel: { start: vi.fn() },
                TunerServerAccess: { getTuners: async () => [] },
            };
            const originalUncaughtExceptionListeners = process.listeners('uncaughtException');
            const originalUnhandledRejectionListeners = process.listeners('unhandledRejection');
            const getuid =
                typeof process.getuid === 'function' ? vi.spyOn(process, 'getuid').mockReturnValue(1000) : undefined;
            const container = {
                get: (identifier: string): unknown => {
                    if (!Object.hasOwn(services, identifier)) {
                        throw new Error(`Unexpected runtime dependency: ${identifier}`);
                    }
                    return services[identifier];
                },
            };

            vi.useFakeTimers();
            try {
                await evaluateCompiledRuntime(container, vi.fn(() => serviceChild));
                await vi.advanceTimersByTimeAsync(0);

                expect(runAfterServiceSupervisionAccepted).toHaveBeenCalledOnce();
                if (workflowInput === undefined) throw new Error('Workflow startup input was not bound');

                const observed = invoke(workflowInput);
                const terminalOutcomes = captureTerminalOutcome(observed);

                await vi.advanceTimersByTimeAsync(599_999);
                expect(recordOverdue).not.toHaveBeenCalled();
                expect(vi.getTimerCount()).toBe(1);
                expect(terminalOutcomes).toEqual([]);
                expect(epgExecute).not.toHaveBeenCalled();
                expect(recordFatal).not.toHaveBeenCalled();

                await vi.advanceTimersByTimeAsync(1);
                expect(recordOverdue).toHaveBeenCalledTimes(1);
                expect(recordOverdue).toHaveBeenCalledWith(`startup stage overdue: ${stage}`);
                expect(vi.getTimerCount()).toBe(0);
                expect(terminalOutcomes).toEqual([]);
                expect(recordFatal).not.toHaveBeenCalled();

                pending.resolve();
                await expect(observed).resolves.toBeUndefined();
                await Promise.resolve();

                expect(recordOverdue).toHaveBeenCalledTimes(1);
                expect(terminalOutcomes).toEqual([{ kind: 'resolved', value: undefined }]);
                if (stage === 'recording-reconciliation') {
                    expect(cleanup).toHaveBeenCalledTimes(1);
                    expect(reservationCleanup).not.toHaveBeenCalled();
                } else {
                    expect(reservationCleanup).toHaveBeenCalledTimes(1);
                    expect(cleanup).not.toHaveBeenCalled();
                }
                expect(rebuildCandidatesAndStart).not.toHaveBeenCalled();
                expect(epgExecute).not.toHaveBeenCalled();
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                getuid?.mockRestore();
                removeAddedProcessListeners('uncaughtException', originalUncaughtExceptionListeners);
                removeAddedProcessListeners('unhandledRejection', originalUnhandledRejectionListeners);
                vi.useRealTimers();
            }
        },
    );
});

/**
 * container が依存を供給できるか、という seam の検査。
 *
 * 自前の constructor を持たない `@injectable()` な derived class は、InversifyJS 8 では base class の
 * 引数 metadata を受け継がない。受け継がないまま解決されると引数 0 で構築され、注入されるはずの
 * 依存が undefined のまま動き出す（実際に stream の再生要求で
 * `Cannot read properties of undefined (reading 'getConfig')` として現れた）。
 *
 * 依存を手で並べて `new` する test は class の振る舞いを見るが、この seam は見ない。対象を `src` の
 * 構文から洗い出し、compile 済み class の metadata が base と同じ引数の数を持つことを確認する。
 * 一覧を名指しで持たないので、同じ形の class が増えても守られる。
 */
describe('container が構築する derived class は base の注入情報を受け継ぐ', () => {
    const sourceRoot = resolve(process.cwd(), 'src');

    const walkSources = (directory: string): string[] =>
        readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
            const entryPath = join(directory, entry.name);
            if (entry.isDirectory()) return walkSources(entryPath);
            return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
        });

    const decoratorNames = (node: ts.ClassDeclaration): string[] =>
        (ts.getDecorators(node) ?? []).map(decorator => {
            const call = decorator.expression;
            const target = ts.isCallExpression(call) ? call.expression : call;
            return ts.isIdentifier(target) ? target.text : '';
        });

    /** `@injectable()` を持ち、他 class を継承し、自前の constructor を持たない class。 */
    const derivedInjectablesWithoutOwnConstructor = (): {
        readonly compiled: string;
        readonly name: string;
        readonly source: string;
        readonly decorators: readonly string[];
    }[] => {
        const found: { compiled: string; name: string; source: string; decorators: readonly string[] }[] = [];
        for (const sourcePath of walkSources(sourceRoot)) {
            const sourceFile = ts.createSourceFile(
                sourcePath,
                readFileSync(sourcePath, 'utf8'),
                ts.ScriptTarget.Latest,
                true,
            );
            for (const statement of sourceFile.statements) {
                if (!ts.isClassDeclaration(statement) || statement.name === undefined) continue;
                const decorators = decoratorNames(statement);
                if (!decorators.includes('injectable')) continue;
                const extendsClause = (statement.heritageClauses ?? []).some(
                    clause => clause.token === ts.SyntaxKind.ExtendsKeyword,
                );
                if (!extendsClause) continue;
                const hasOwnConstructor = statement.members.some(member => ts.isConstructorDeclaration(member));
                if (hasOwnConstructor) continue;
                found.push({
                    compiled: `${relative(sourceRoot, sourcePath).replace(/\.ts$/u, '')}.js`,
                    decorators,
                    name: statement.name.text,
                    source: relative(process.cwd(), sourcePath),
                });
            }
        }
        return found;
    };

    it('compile 済み class の引数の数が base と一致する', () => {
        const targets = derivedInjectablesWithoutOwnConstructor();
        const mismatches = targets.flatMap(target => {
            const derived = loadDefault<abstract new (...args: never[]) => unknown>(target.compiled);
            const base = Object.getPrototypeOf(derived) as abstract new (...args: never[]) => unknown;
            const derivedArguments = getClassMetadata(derived).constructorArguments.length;
            const baseArguments = getClassMetadata(base).constructorArguments.length;
            return derivedArguments === baseArguments
                ? []
                : [`${target.name}: derived=${derivedArguments} base=${baseArguments}`];
        });
        expect(mismatches).toEqual([]);
    });
});
