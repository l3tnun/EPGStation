import { createRequire } from 'node:module';
import { join } from 'node:path';
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    captureRuntimeListeners,
    compiledSnapshotRoot,
    createSyntheticChild,
    evaluateCompiledRuntime,
    removeListenersAddedSince,
    type SyntheticChild,
} from './_runtime-harness';

/**
 * `server-workflow-coordination` owns the Workflow's process-local event binding entry point: `EventSetter.set()`
 * (the "Workflow Event Binding" row of its design's Logical responsibility mapping). Runtime's only responsibility
 * (per the encode completion section of the `server-application-runtime` design) is to start that Workflow entry
 * point exactly once and never invoke it again on re-entry. Whether `EventSetter.set()` itself reaches the Event-owned
 * `OperatorEncodeEventBinding` registration, and whether that registration is delivered exactly once by the PM
 * dispatcher, are Process Messaging / Event-Hook / Workflow owner concerns and are intentionally not observed here.
 */

const compiledModuleRequire = createRequire(join(process.cwd(), 'package.json'));

interface RuntimeStartupWorkflowPortLike {
    runAfterServiceSupervisionAccepted(input: unknown): Promise<{ readonly kind: string }>;
}

const loadStartupContinuationCoordinator = (): new () => RuntimeStartupWorkflowPortLike =>
    (
        compiledModuleRequire(
            join(compiledSnapshotRoot(), 'model', 'workflow', 'StartupContinuationCoordinator.js'),
        ) as { readonly default: new () => RuntimeStartupWorkflowPortLike }
    ).default;

/** Mirrors runtime-boundaries.integration.test.ts's isolated-descriptor pattern instead of vi.spyOn. */
const overrideGetuidForTest = (): (() => void) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'getuid');
    if (typeof process.getuid === 'function') {
        Object.defineProperty(process, 'getuid', { configurable: true, value: () => 1_000 });
    }
    return () => {
        if (descriptor === undefined) {
            Reflect.deleteProperty(process, 'getuid');
        } else {
            Object.defineProperty(process, 'getuid', descriptor);
        }
    };
};

afterEach(() => {
    vi.useRealTimers();
});

describe('Workflow event binding Runtime composition', () => {
    it(
        '[AR-4.5] workflow-event-binding-invoked-once calls the Workflow event binding entry point exactly once at ' +
            'startup and keeps its call count at one across a Service child restart re-entry',
        async () => {
            vi.useFakeTimers();
            const restoreListeners = captureRuntimeListeners();
            const restoreGetuid = overrideGetuidForTest();
            const StartupContinuationCoordinator = loadStartupContinuationCoordinator();

            let eventBindingCalls = 0;
            const serviceChildren: SyntheticChild[] = [];
            const spawnServiceChild = (): SyntheticChild => {
                const child = createSyntheticChild(9_700 + serviceChildren.length);
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
                            return {
                                set: () => {
                                    eventBindingCalls += 1;
                                },
                            };
                        case 'IIPCServer':
                            return { initialize: async () => undefined, register: () => undefined };
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

            try {
                await evaluateCompiledRuntime(container, spawnServiceChild);
                await vi.waitFor(() => expect(serviceChildren).toHaveLength(1), { interval: 0 });
                await vi.advanceTimersByTimeAsync(0);

                expect(eventBindingCalls).toBe(1);

                const [generationOne] = serviceChildren;
                if (generationOne === undefined) throw new Error('Runtime did not spawn its initial Service child');

                // Re-entry: the Service child terminates and Runtime's own supervision re-enters spawn/registration,
                // without re-running the Workflow event binding entry point (which only runs once, at top-level
                // startup, independent of Service child generation).
                generationOne.emit('exit', 1, null);
                await vi.waitFor(() => expect(serviceChildren).toHaveLength(2), { interval: 0 });
                await vi.advanceTimersByTimeAsync(0);

                expect(serviceChildren).toHaveLength(2);
                expect(eventBindingCalls).toBe(1);

                // A second restart re-enters supervision again; the call count must still not move.
                const [, generationTwo] = serviceChildren;
                if (generationTwo === undefined) throw new Error('Runtime did not spawn its first replacement child');
                generationTwo.emit('error', new Error('synthetic service error'));
                await vi.waitFor(() => expect(serviceChildren).toHaveLength(3), { interval: 0 });
                await vi.advanceTimersByTimeAsync(0);

                expect(serviceChildren).toHaveLength(3);
                expect(eventBindingCalls).toBe(1);

                // Restart supervision detaches its own terminal listener from each retired generation before that
                // listener would otherwise fire: generationTwo terminated via 'error' (not 'exit'), so its 'exit'
                // listener was never auto-removed by Node's own `once()` semantics — reaching zero here depends on
                // Runtime's own `detachListeners()` cleanup, not merely on the emitted event already firing it.
                expect(generationTwo.listenerCount('exit')).toBe(0);
                const [, , generationThree] = serviceChildren;
                expect(generationThree?.listenerCount('exit')).toBe(1);
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                restoreGetuid();
                removeListenersAddedSince(restoreListeners);
                for (const child of serviceChildren) child.removeAllListeners();
                vi.clearAllTimers();
                vi.useRealTimers();
            }

            // Cleanup must leave zero residual global listeners: this compiled Runtime evaluation attached its own
            // uncaughtException/unhandledRejection handlers at module scope, and the finally block above must have
            // removed exactly those (and only those). (Per-child eventNames() is not asserted here: the finally
            // block's own `removeAllListeners()` would make that check vacuously true regardless of what Runtime
            // itself did.)
            expect(process.listeners('uncaughtException')).toEqual(restoreListeners.get('uncaughtException') ?? []);
            expect(process.listeners('unhandledRejection')).toEqual(restoreListeners.get('unhandledRejection') ?? []);
        },
    );
});
