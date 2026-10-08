import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { captureRuntimeListeners, evaluateCompiledRuntime, removeListenersAddedSince } from '../_runtime-harness';

type WorkflowInput = {
    runRecordingCandidatesAndStart(): Promise<void>;
    runRecordingReconciliation(): Promise<void>;
};

const createEntryFixture = (rebuildCandidatesAndStart: () => Promise<void>) => {
    const system = { error: vi.fn(), fatal: vi.fn(), info: vi.fn() };
    const workflowInputs: WorkflowInput[] = [];
    const children: EventEmitter[] = [];
    const services: Record<string, unknown> = {
        IConfiguration: { getConfig: () => ({}) },
        IConnectionCheckModel: { checkDB: async () => undefined, checkMirakurun: async () => undefined },
        IEPGUpdateExecutorManageModel: { execute: vi.fn() },
        IEventSetter: { set: vi.fn() },
        IIPCServer: { initialize: async () => undefined, register: vi.fn() },
        ILoggerModel: { getLogger: () => ({ system }), initialize() {} },
        IRecordingManageModel: {
            cleanup: async () => undefined,
            rebuildCandidatesAndStart,
            setTuner: vi.fn(),
        },
        IReservationManageModel: { cleanup: async () => undefined, setTuners: vi.fn() },
        IStorageManageModel: { start: vi.fn() },
        IRuntimeStartupWorkflowPort: {
            runAfterServiceSupervisionAccepted: (input: WorkflowInput) => {
                workflowInputs.push(input);
                return Promise.resolve({ kind: 'Succeeded', stage: 'epg-supervisor-start' } as const);
            },
        },
        TunerServerAccess: { getTuners: async () => [] },
    };
    const spawnServiceChild = vi.fn(() => {
        const child = Object.assign(new EventEmitter(), { pid: 4_100 + children.length, stderr: null, stdout: null });
        children.push(child);
        return child;
    });
    return {
        container: { get: (identifier: string): unknown => services[identifier] },
        spawnServiceChild,
        system,
        workflowInputs,
    };
};

describe('runtime entrypoint handlers', () => {
    it('[AR-2.7] records an uncaught exception through the fatal log with its message and the error, without exiting', async () => {
        const fixture = createEntryFixture(async () => undefined);
        const before = captureRuntimeListeners();
        try {
            await evaluateCompiledRuntime(fixture.container, fixture.spawnServiceChild);
            await vi.waitFor(() => expect(fixture.spawnServiceChild).toHaveBeenCalledTimes(1));
            const added = process
                .listeners('uncaughtException')
                .filter(listener => !(before.get('uncaughtException') ?? []).includes(listener as never));
            expect(added).toHaveLength(1);
            const failure = new Error('synthetic uncaught failure');
            fixture.system.fatal.mockClear();

            (added[0] as (error: Error) => void)(failure);

            expect(fixture.system.fatal.mock.calls).toEqual([
                ['uncaughtException: synthetic uncaught failure'],
                [failure],
            ]);
        } finally {
            removeListenersAddedSince(before);
        }
    });

    it('[AR-6.8] logs the candidates-and-start stage as overdue after 600000 ms while still waiting for the stage to settle', async () => {
        let settleStage!: () => void;
        const fixture = createEntryFixture(
            () =>
                new Promise<void>(resolve => {
                    settleStage = resolve;
                }),
        );
        const before = captureRuntimeListeners();
        try {
            await evaluateCompiledRuntime(fixture.container, fixture.spawnServiceChild);
            await vi.waitFor(() => expect(fixture.workflowInputs).toHaveLength(1));
            vi.useFakeTimers();
            const stage = fixture.workflowInputs[0]!.runRecordingCandidatesAndStart();
            let settled = false;
            void stage.then(() => {
                settled = true;
            });

            await vi.advanceTimersByTimeAsync(599_999);
            expect(fixture.system.error).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(fixture.system.error).toHaveBeenCalledExactlyOnceWith(
                'startup stage overdue: recording-candidates-and-start',
            );
            expect(settled).toBe(false);

            settleStage();
            await expect(stage).resolves.toBeUndefined();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
            removeListenersAddedSince(before);
        }
    });
});
