import { fork, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    flushImmediate,
    IPCServer,
    logger,
    deferred,
    load,
    makeManager,
    makeRecorded,
    makeRecorder,
    makeReserve,
    RecordingEvent,
    RecordingManageModel,
} from './_harness';

afterEach(() => vi.useRealTimers());

const markCandidateStartupCompleted = (manager: any): void => {
    manager.candidateStartupState = 'Started';
};

const EventSetter = load<new (...args: any[]) => { set(): void }>('model', 'event', 'EventSetter.js');
const ReserveEvent = load<new (...args: any[]) => any>('model', 'event', 'ReserveEvent.js');
const resetTimerIpcChildFixture = join(
    process.cwd(),
    'test',
    'server',
    'fixtures',
    'recording-execution',
    'reset-timer-ipc-child.cjs',
);

const flushEventCarrier = async (): Promise<void> => {
    await Promise.resolve();
    await flushImmediate();
    await Promise.resolve();
    await flushImmediate();
};

const noopEvent = (): any => new Proxy({}, { get: () => vi.fn() });

const makeEventCarrierFixture = (options: Record<string, any> = {}) => {
    const reserveEvent = new ReserveEvent({ getLogger: () => logger });
    const recordingEvent = options.recordingEvent ?? new RecordingEvent({ getLogger: () => logger });
    const recordingManage = options.recordingManage ?? { acceptMutation: vi.fn(), resetTimer: vi.fn() };
    const reservationManage = {
        addEventRelay: vi.fn(async () => 1),
        cancel: vi.fn(async () => undefined),
        updateAll: vi.fn(async () => undefined),
        updateRule: vi.fn(async () => undefined),
        ...options.reservationManage,
    };
    const externalCommandManage = {
        addRecordingFailedCmd: vi.fn(async () => undefined),
        addRecordingFinishCmd: vi.fn(async () => undefined),
        addRecordingPrepRecFailedCmd: vi.fn(async () => undefined),
        addRecordingPrepStartCmd: vi.fn(async () => undefined),
        addRecordingStartCmd: vi.fn(async () => undefined),
        addUpdateReseves: vi.fn(async () => undefined),
        ...options.externalCommandManage,
    };
    const child = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
    child.send = options.send ?? vi.fn();
    const unused = {};
    const ipc = new IPCServer(reservationManage, unused, unused, recordingManage, unused, unused, {
        getLogger: () => logger,
    });
    ipc.register(child as any);
    new EventSetter(
        { getLogger: () => logger },
        noopEvent(),
        noopEvent(),
        noopEvent(),
        reserveEvent,
        recordingEvent,
        noopEvent(),
        noopEvent(),
        noopEvent(),
        reservationManage,
        recordingManage,
        { historyCleanup: vi.fn(), removeRuleId: vi.fn() },
        { setRelation: vi.fn() },
        { add: vi.fn() },
        externalCommandManage,
        ipc,
        { getConfig: () => ({ recorded: [{ name: 'synthetic-recorded-root' }] }) },
        { setup: vi.fn() },
    ).set();

    return { child, externalCommandManage, recordingEvent, recordingManage, reservationManage, reserveEvent };
};

type ResetTimerChild = {
    readonly child: ChildProcess;
    readonly dispose: () => Promise<void>;
    readonly observations: Array<Record<string, unknown>>;
    readonly sendStart: () => Promise<void>;
};

const startResetTimerChild = (): ResetTimerChild => {
    const child = fork(resetTimerIpcChildFixture, [], {
        env: { ...process.env },
        silent: true,
    });
    const observations: Array<Record<string, unknown>> = [];
    let pendingOutput = '';
    const onOutput = (chunk: string) => {
        pendingOutput += chunk;
        const lines = pendingOutput.split('\n');
        pendingOutput = lines.pop() ?? '';
        for (const line of lines) observations.push(JSON.parse(line) as Record<string, unknown>);
    };
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', onOutput);

    return {
        child,
        dispose: async () => {
            child.stdout?.off('data', onOutput);
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
            await vi.waitFor(() => expect(child.exitCode !== null || child.signalCode !== null).toBe(true));
            child.stdout?.destroy();
            child.stderr?.destroy();
        },
        observations,
        sendStart: () =>
            new Promise((resolve, reject) => {
                child.send({ type: 'recording-reset-timer-test-start' }, error => {
                    if (error === null) resolve();
                    else reject(error);
                });
            }),
    };
};

describe('recording lifecycle carrier integration', () => {
    it.each([
        ['metadata-only update', 'metadata', false],
        ['start-only update', 'start', false],
        ['rejected recorder update', 'metadata', true],
    ])('[Task 1.9 review] keeps the active time-specified end on %s', async (_case, changeKind, shouldReject) => {
        const failure = new Error('synthetic active update failure');
        const harness = makeManager({
            recorder: {
                update: shouldReject ? vi.fn(async () => Promise.reject(failure)) : vi.fn(async () => undefined),
            },
        });
        harness.model.config.timeSpecifiedEndMargin = 2;
        const reserve = makeReserve({
            id: 80,
            isTimeSpecified: true,
            programId: null,
            startAt: Date.now() + 60_000,
            endAt: Date.now() + 120_000,
        });

        try {
            await harness.model.update({ insert: [reserve], isSuppressLog: false });
            const initial = harness.model.scheduleController.getSessionSnapshot(80);
            expect(
                harness.model.scheduleController.tryTransitionSession(
                    80,
                    initial.generation,
                    initial.sessionToken,
                    'Waiting',
                    'Recording',
                ),
            ).toBe(true);
            harness.model.scheduleController.registerTimeSpecifiedEnd({
                reservationId: 80,
                generation: initial.generation,
                sessionToken: initial.sessionToken,
                dueAt: reserve.endAt + 2_000,
            });

            const latest = makeReserve({
                ...reserve,
                ...(changeKind === 'start' ? { startAt: reserve.startAt + 1_000 } : { name: 'synthetic-renamed' }),
            });
            await harness.model.update({ update: [latest], isSuppressLog: false });

            const current = harness.model.scheduleController.getSessionSnapshot(80);
            expect(current).toMatchObject({ phase: 'Recording', sessionToken: initial.sessionToken });
            expect(current.generation).not.toBe(initial.generation);
            expect(harness.model.scheduleController.timeSpecifiedEnds.get(80)).toEqual({
                reservationId: 80,
                generation: current.generation,
                sessionToken: current.sessionToken,
                dueAt: latest.endAt + 2_000,
            });
        } finally {
            harness.model.scheduleController.stop();
        }
    });

    it('[Task 1.9] carries only the latest active time-specified end through manager and session tokens', async () => {
        const event = new RecordingEvent({ getLogger: () => logger });
        let binding: any;
        let reserve: any;
        const finishAtTimeSpecifiedEnd = vi.fn(async () => undefined);
        const recorder = {
            bindScheduleSession: vi.fn((next: any) => {
                binding = next;
            }),
            cancel: vi.fn(async () => undefined),
            finishAtTimeSpecifiedEnd,
            resetTimer: vi.fn(() => true),
            setTimer: vi.fn((next: any) => {
                reserve = next;
                return true;
            }),
            startPreparation: vi.fn(() => {
                expect(binding.tryTransition('Preparing', 'Recording')).toBe(true);
                binding.registerTimeSpecifiedEnd(reserve.endAt + 2_000);
            }),
            update: vi.fn(async (next: any) => {
                reserve = next;
                binding.registerTimeSpecifiedEnd(reserve.endAt + 2_000);
            }),
        };
        const manager = new RecordingManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ recordedTmp: '/synthetic-tmp', timeSpecifiedEndMargin: 2 }) },
            vi.fn(async () => recorder),
            event,
            { setTuner: vi.fn() },
            { findAll: vi.fn(), findReserveId: vi.fn(async () => []), findId: vi.fn() },
            { findId: vi.fn() },
            { movingFromTmp: vi.fn(), updateVideoFileSize: vi.fn().mockResolvedValue(undefined) },
        );
        markCandidateStartupCompleted(manager);
        const now = { value: 1_000_000 };
        manager.scheduleController.clock.now = () => now.value;
        const inserted = makeReserve({
            id: 82,
            isTimeSpecified: true,
            programId: null,
            startAt: 1_015_000,
            endAt: 1_020_000,
        });
        await manager.update({ insert: [inserted], isSuppressLog: false });
        const firstGeneration = binding.generation;
        const sessionToken = binding.sessionToken;

        await manager.update({
            update: [makeReserve({ ...inserted, endAt: 1_030_000 })],
            isSuppressLog: false,
        });
        expect(binding.generation).not.toBe(firstGeneration);
        expect(binding.sessionToken).toBe(sessionToken);

        now.value = 1_022_000;
        manager.scheduleController.wake();
        expect(finishAtTimeSpecifiedEnd).not.toHaveBeenCalled();

        now.value = 1_040_000;
        manager.scheduleController.wake();
        await flushImmediate();
        expect(finishAtTimeSpecifiedEnd).toHaveBeenCalledOnce();
        expect(recorder.bindScheduleSession.mock.calls.at(-1)?.[0]).toMatchObject({ phase: 'Finishing' });
        expect(manager.candidateRegistry.get(82).phase).toBe('Finishing');
        manager.scheduleController.wake();
        expect(finishAtTimeSpecifiedEnd).toHaveBeenCalledOnce();
        manager.scheduleController.stop();
    });

    it('[Task 1.7] coalesces real manager mutation bursts and IPC reset into one current session dispatch', async () => {
        const event = new RecordingEvent({ getLogger: () => logger });
        const recorder = {
            bindScheduleSession: vi.fn(),
            cancel: vi.fn(async () => undefined),
            resetTimer: vi.fn(() => true),
            setTimer: vi.fn(() => true),
            startPreparation: vi.fn(() => undefined),
            update: vi.fn(async () => undefined),
        };
        const provider = vi.fn(async () => recorder);
        const manager = new RecordingManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ recordedTmp: '/synthetic-tmp', timeSpecifiedEndMargin: 0 }) },
            provider,
            event,
            { setTuner: vi.fn() },
            { findAll: vi.fn(), findReserveId: vi.fn(async () => []), findId: vi.fn() },
            { findId: vi.fn() },
            { movingFromTmp: vi.fn(), updateVideoFileSize: vi.fn().mockResolvedValue(undefined) },
        );
        markCandidateStartupCompleted(manager);
        const now = Date.now();
        const inserted = makeReserve({ id: 81, startAt: now + 15_000, endAt: now + 60_000 });
        const updated = makeReserve({ id: 81, startAt: now + 14_999, endAt: now + 70_000 });

        const insert = manager.update({ insert: [inserted], isSuppressLog: false });
        const update = manager.update({ update: [updated], isSuppressLog: true });
        await Promise.all([insert, update]);
        await flushImmediate();

        expect(provider).toHaveBeenCalledOnce();
        expect(recorder.setTimer).toHaveBeenCalledOnce();
        expect(recorder.update).toHaveBeenCalledWith(expect.objectContaining({ endAt: updated.endAt }), true);
        expect(recorder.startPreparation).toHaveBeenCalledOnce();
        const latestBinding = recorder.bindScheduleSession.mock.calls.at(-1)?.[0];
        expect(latestBinding).toMatchObject({ reservationId: 81, phase: 'Preparing' });
        expect(typeof latestBinding.generation).toBe('bigint');
        expect(typeof latestBinding.sessionToken).toBe('bigint');

        const unused = {};
        const ipc = new IPCServer(unused, unused, unused, manager, unused, unused, unused);
        const child = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
        child.send = vi.fn();
        ipc.register(child as any);
        child.emit('message', { id: 700, model: 'recording', func: 'resetTimer', args: {} });
        await flushImmediate();

        expect(recorder.resetTimer).toHaveBeenCalledOnce();
        expect(child.send).toHaveBeenCalledWith({ id: 700, result: undefined });
        manager.scheduleController.stop();
    });

    it('[Task 2.3 review] replaces the real recorder retry when the manager advances the reservation generation', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const timeout = vi.spyOn(globalThis, 'setTimeout');
        const event = new RecordingEvent({ getLogger: () => logger });
        const recorderHarness = makeRecorder({
            streamCreator: {
                create: vi.fn(async () => Promise.reject(new Error('synthetic manager retry failure'))),
                changeEndAt: vi.fn(),
            },
        });
        const manager = new RecordingManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ recordedTmp: '/synthetic-tmp', timeSpecifiedEndMargin: 0 }) },
            vi.fn(async () => recorderHarness.model),
            event,
            { setTuner: vi.fn() },
            { findAll: vi.fn(), findReserveId: vi.fn(async () => []), findId: vi.fn() },
            { findId: vi.fn() },
            { movingFromTmp: vi.fn(), updateVideoFileSize: vi.fn().mockResolvedValue(undefined) },
        );
        markCandidateStartupCompleted(manager);
        // 番組指定の再試行は終了時刻まで続くので、終了時刻を 3 回目と 4 回目の失敗の間に置いて 4 回で準備失敗にする。
        const reserve = makeReserve({ id: 83, startAt: 1_015_000, endAt: 1_014_000 });

        try {
            await manager.update({ insert: [reserve], isSuppressLog: false });
            for (let index = 0; index < 10 && recorderHarness.model.retryTimerId == null; index += 1) {
                await Promise.resolve();
            }
            const waiting = manager.scheduleController.getSessionSnapshot(83);
            expect(waiting).toMatchObject({ phase: 'RetryWaiting' });
            const waitingTimer = recorderHarness.model.retryTimerId;
            expect(waitingTimer).not.toBeNull();
            expect(recorderHarness.model.retryAttempt).toBe(1);
            const retryCallback = timeout.mock.calls.find(([, delay]) => delay === 5_000)?.[0] as () => void;

            await manager.update({
                update: [makeReserve({ ...reserve, name: 'synthetic-generation-update' })],
                isSuppressLog: false,
            });
            const current = manager.scheduleController.getSessionSnapshot(83);
            expect(current.generation).not.toBe(waiting.generation);
            expect(current.sessionToken).toBe(waiting.sessionToken);
            expect(current.phase).toBe('RetryWaiting');
            const replacementTimer = recorderHarness.model.retryTimerId;
            expect(replacementTimer).not.toBeNull();
            expect(replacementTimer).not.toBe(waitingTimer);
            expect(recorderHarness.model.retryAttempt).toBe(1);
            retryCallback();
            await Promise.resolve();

            expect(recorderHarness.streamCreator.create).toHaveBeenCalledOnce();
            expect(recorderHarness.recordingEvent.emitStartPrepRecording).toHaveBeenCalledOnce();
            expect(recorderHarness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
            expect(recorderHarness.model.retryTimerId).toBe(replacementTimer);
            expect(manager.scheduleController.getSessionSnapshot(83)).toEqual(current);

            for (let expectedAttempts = 2; expectedAttempts <= 4; expectedAttempts += 1) {
                await vi.advanceTimersByTimeAsync(5_000);
                expect(recorderHarness.streamCreator.create).toHaveBeenCalledTimes(expectedAttempts);
            }
            expect(manager.scheduleController.getSessionSnapshot(83)).toMatchObject({
                generation: current.generation,
                phase: 'Completed',
                sessionToken: current.sessionToken,
            });
            expect(recorderHarness.model.retryTimerId).toBeNull();
            expect(recorderHarness.recordingEvent.emitPrepRecordingFailed).toHaveBeenCalledOnce();
        } finally {
            manager.scheduleController.stop();
        }
    });

    it('[Task 2.5] does not let a preparation event detach a session that is stopping for recorded deletion', async () => {
        const bounded = deferred<void>();
        const terminal = deferred<void>();
        const event = new RecordingEvent({ getLogger: () => logger });
        const recorder = {
            bindScheduleSession: vi.fn(),
            cancel: vi.fn(() => bounded.promise),
            resetTimer: vi.fn(() => true),
            setTimer: vi.fn(() => true),
            update: vi.fn(async () => undefined),
            whenDeletionTerminal: vi.fn(() => terminal.promise),
        };
        const manager = new RecordingManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ recordedTmp: '/synthetic-tmp' }) },
            vi.fn(async () => recorder),
            event,
            { setTuner: vi.fn() },
            { findAll: vi.fn(), findReserveId: vi.fn(async () => []), findId: vi.fn() },
            { findId: vi.fn() },
            { movingFromTmp: vi.fn(), updateVideoFileSize: vi.fn().mockResolvedValue(undefined) },
        );
        markCandidateStartupCompleted(manager);
        const reserve = makeReserve({ id: 84, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });
        await manager.update({ insert: [reserve], isSuppressLog: false });

        const cancellation = manager.cancel(84, true);
        event.emitCancelPrepRecording(reserve);
        await flushImmediate();
        expect(manager.hasReserve(84)).toBe(true);

        bounded.resolve();
        terminal.resolve();
        await cancellation;
        await flushImmediate();
        expect(manager.hasReserve(84)).toBe(false);
        manager.scheduleController.stop();
    });

    it('[Task 2.1/6.3] crosses real RecordingEvent and IPC carriers without invoking captured callbacks', async () => {
        const event = new RecordingEvent({ getLogger: () => logger });
        const first = {
            bindScheduleSession: vi.fn(),
            setTimer: vi.fn(() => true),
            update: vi.fn(),
            cancel: vi.fn(),
            resetTimer: vi.fn(),
        };
        const replacement = {
            bindScheduleSession: vi.fn(),
            setTimer: vi.fn(() => true),
            update: vi.fn(),
            cancel: vi.fn(),
            resetTimer: vi.fn(),
        };
        const provider = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(replacement);
        const recordedDB = { findAll: vi.fn(), findReserveId: vi.fn(async () => []), findId: vi.fn() };
        const manager = new RecordingManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ recordedTmp: '/synthetic-tmp' }) },
            provider,
            event,
            { setTuner: vi.fn() },
            recordedDB,
            { findId: vi.fn() },
            { movingFromTmp: vi.fn(), updateVideoFileSize: vi.fn().mockResolvedValue(undefined) },
        );
        markCandidateStartupCompleted(manager);
        const reserve = makeReserve({ id: 91 });
        await manager.update({ insert: [reserve], isSuppressLog: false });
        const failedIdentity = first.bindScheduleSession.mock.calls.at(-1)?.[0];
        expect(failedIdentity).toBeDefined();
        event.emitRecordingFailed(reserve, null, failedIdentity);
        await flushImmediate();
        expect(provider).toHaveBeenCalledTimes(2);
        expect(manager.recordingIndex[91]).toBe(replacement);

        const unused = {};
        const ipc = new IPCServer(unused, unused, unused, manager, unused, unused, unused);
        const child = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
        child.send = vi.fn();
        ipc.register(child as any);
        child.emit('message', { id: 701, model: 'recording', func: 'resetTimer', args: {} });
        await flushImmediate();
        expect(replacement.resetTimer).toHaveBeenCalledOnce();
        expect(child.send).toHaveBeenCalledWith({ id: 701, result: undefined });
    });

    it('[reset-diff-lifecycle][Task 9.6] carries insert, update, delete, and lifecycle relay notifications through EventSetter and IPCServer', async () => {
        const carrier = makeEventCarrierFixture();
        const inserted = makeReserve({ id: 960, tags: null });
        const updated = makeReserve({ ...inserted, name: 'synthetic-updated', tags: null });
        const deleted = makeReserve({ ...updated, isSkip: true, tags: null });
        const recorded = makeRecorded({ id: 961, videoFiles: [] });

        carrier.reserveEvent.emitUpdated({ insert: [inserted], isSuppressLog: false });
        carrier.reserveEvent.emitUpdated({ isSuppressLog: true, update: [updated] });
        carrier.reserveEvent.emitUpdated({ delete: [deleted], isSuppressLog: false });
        carrier.recordingEvent.emitStartPrepRecording(updated);
        carrier.recordingEvent.emitStartRecording(updated, recorded);
        carrier.recordingEvent.emitRecordingFailed(updated, recorded);
        carrier.recordingEvent.emitFinishRecording(updated, recorded, false);
        carrier.recordingEvent.emitEventRelay([{ parentReserve: updated, programId: 962 }]);
        await flushEventCarrier();

        expect(carrier.recordingManage.acceptMutation).toHaveBeenNthCalledWith(1, {
            insert: [inserted],
            isSuppressLog: false,
        });
        expect(carrier.recordingManage.acceptMutation).toHaveBeenNthCalledWith(2, {
            isSuppressLog: true,
            update: [updated],
        });
        expect(carrier.recordingManage.acceptMutation).toHaveBeenNthCalledWith(3, {
            delete: [deleted],
            isSuppressLog: false,
        });
        expect(carrier.externalCommandManage.addRecordingPrepStartCmd).toHaveBeenCalledWith(updated);
        expect(carrier.externalCommandManage.addRecordingStartCmd).toHaveBeenCalledWith(recorded);
        expect(carrier.externalCommandManage.addRecordingFailedCmd).toHaveBeenCalledWith(recorded);
        expect(carrier.externalCommandManage.addRecordingFinishCmd).toHaveBeenCalledWith(recorded);
        expect(carrier.reservationManage.addEventRelay).toHaveBeenCalledOnce();
        expect(carrier.reservationManage.addEventRelay).toHaveBeenCalledWith(962, updated);
        expect(carrier.child.send.mock.calls.map(([message]) => message)).toEqual(
            Array.from({ length: 7 }, () => ({ type: 'notifyClient' })),
        );
    });

    it('[Task 9.6] isolates listener, handler, and detached mutation failures without unhandled rejection or lost notification', async () => {
        const listenerFailure = new Error('synthetic recording listener failure');
        const handlerFailure = new Error('synthetic recording handler failure');
        const detachedFailure = new Error('synthetic detached mutation failure');
        const notificationFailure = new Error('synthetic IPC notification failure');
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        logger.system.error.mockClear();
        process.on('unhandledRejection', onUnhandled);
        try {
            const recordingEvent = new RecordingEvent({ getLogger: () => logger });
            recordingEvent.setStartPrepRecording(() => {
                throw listenerFailure;
            });
            const successfulNotifications: unknown[] = [];
            const send = vi
                .fn((message: unknown) => {
                    successfulNotifications.push(message);
                })
                .mockImplementationOnce(() => {
                    throw notificationFailure;
                });
            const carrier = makeEventCarrierFixture({
                externalCommandManage: {
                    addRecordingPrepStartCmd: vi.fn(() => Promise.reject(handlerFailure)),
                },
                recordingManage: {
                    acceptMutation: vi.fn(() => Promise.reject(detachedFailure)),
                    resetTimer: vi.fn(),
                },
                recordingEvent,
                send,
            });

            recordingEvent.emitStartPrepRecording(makeReserve({ id: 963, tags: null }));
            recordingEvent.emitStartPrepRecording(makeReserve({ id: 964, tags: null }));
            carrier.reserveEvent.emitUpdated({ insert: [makeReserve({ id: 965, tags: null })], isSuppressLog: false });
            await flushEventCarrier();

            expect(carrier.recordingManage.acceptMutation).toHaveBeenCalledOnce();
            expect(send).toHaveBeenCalledTimes(3);
            expect(successfulNotifications).toEqual([{ type: 'notifyClient' }, { type: 'notifyClient' }]);
            expect(send.mock.calls.at(-1)).toEqual([{ type: 'notifyClient' }, expect.any(Function)]);
            expect(logger.system.error).toHaveBeenCalledWith(listenerFailure);
            expect(logger.system.error).toHaveBeenCalledWith(handlerFailure);
            expect(logger.system.error).toHaveBeenCalledWith(detachedFailure);
            expect(logger.system.error).toHaveBeenCalledWith(
                'IPC notification discarded: synthetic IPC notification failure',
            );
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });

    it('[Task 9.6] ignores late failure and coalesces duplicate current failure into one replacement generation', async () => {
        const event = new RecordingEvent({ getLogger: () => logger });
        const first = {
            bindScheduleSession: vi.fn(),
            cancel: vi.fn(),
            resetTimer: vi.fn(),
            setTimer: vi.fn(() => true),
            update: vi.fn(async () => undefined),
        };
        const replacement = {
            bindScheduleSession: vi.fn(),
            cancel: vi.fn(),
            resetTimer: vi.fn(),
            setTimer: vi.fn(() => true),
            update: vi.fn(async () => undefined),
        };
        const provider = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(replacement);
        const recordedDB = { findAll: vi.fn(), findReserveId: vi.fn(async () => []), findId: vi.fn() };
        const manager = new RecordingManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ recordedTmp: '/synthetic-tmp' }) },
            provider,
            event,
            { setTuner: vi.fn() },
            recordedDB,
            { findId: vi.fn() },
            { movingFromTmp: vi.fn(), updateVideoFileSize: vi.fn().mockResolvedValue(undefined) },
        );
        markCandidateStartupCompleted(manager);
        const inserted = makeReserve({ id: 966 });
        const updated = makeReserve({ ...inserted, name: 'synthetic-latest-generation' });
        try {
            await manager.update({ insert: [inserted], isSuppressLog: false });
            const staleFailure = first.bindScheduleSession.mock.calls.at(-1)?.[0];
            expect(staleFailure).toBeDefined();

            await manager.update({ isSuppressLog: false, update: [updated] });
            const currentFailure = first.bindScheduleSession.mock.calls.at(-1)?.[0];
            expect(currentFailure).toMatchObject({ reservation: updated, reservationId: updated.id });
            expect(currentFailure.generation).not.toBe(staleFailure.generation);

            event.emitRecordingFailed(inserted, null, staleFailure);
            event.emitRecordingFailed(updated, null, currentFailure);
            event.emitRecordingFailed(updated, null, currentFailure);
            await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2));

            expect(recordedDB.findReserveId).toHaveBeenCalledOnce();
            expect(manager.recordingIndex[updated.id]).toBe(replacement);
            expect(replacement.setTimer).toHaveBeenCalledOnce();
            const replacementSession = manager.scheduleController.getSessionSnapshot(updated.id);
            expect(replacementSession.generation).not.toBe(currentFailure.generation);
            expect(replacementSession.sessionToken).not.toBe(currentFailure.sessionToken);
        } finally {
            manager.scheduleController.stop();
        }
    });

    it('[Task 9.6][Node IPC] correlates resetTimer success and handler failure with no child listener residue', async () => {
        const resetTimerFailure = new Error('synthetic resetTimer handler failure');
        const manager = {
            resetTimer: vi
                .fn()
                .mockImplementationOnce(() => {
                    throw resetTimerFailure;
                })
                .mockImplementationOnce(() => undefined),
        };
        const unused = {};
        const ipc = new IPCServer(unused, unused, unused, manager, unused, unused, unused);
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        const session = startResetTimerChild();
        const beforeRegistration = {
            close: session.child.listenerCount('close'),
            disconnect: session.child.listenerCount('disconnect'),
            error: session.child.listenerCount('error'),
            exit: session.child.listenerCount('exit'),
            message: session.child.listenerCount('message'),
        };
        process.on('unhandledRejection', onUnhandled);
        try {
            ipc.register(session.child);
            await vi.waitFor(() => expect(session.observations).toContainEqual({ type: 'ready' }));
            await session.sendStart();
            await vi.waitFor(() => {
                expect(session.observations).toContainEqual({
                    error: resetTimerFailure.message,
                    label: 'first',
                    outcome: 'rejected',
                    type: 'settled',
                });
            });
            await vi.waitFor(() => {
                expect(session.observations).toContainEqual({
                    label: 'second',
                    outcome: 'resolved',
                    type: 'settled',
                });
            });
            await vi.waitFor(() => {
                expect(session.observations).toContainEqual({
                    pendingRequestCount: 0,
                    type: 'terminal',
                });
            });
            await vi.waitFor(() => expect(session.child.exitCode).toBe(0));

            expect(manager.resetTimer).toHaveBeenCalledTimes(2);
            expect({
                close: session.child.listenerCount('close'),
                disconnect: session.child.listenerCount('disconnect'),
                error: session.child.listenerCount('error'),
                exit: session.child.listenerCount('exit'),
                message: session.child.listenerCount('message'),
            }).toEqual(beforeRegistration);
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', onUnhandled);
            await session.dispose();
        }
    });
});
