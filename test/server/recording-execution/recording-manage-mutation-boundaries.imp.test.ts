import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, flushImmediate, logger, makeManager, makeReserve, RecordingScheduleController } from './_harness';

const activeManagers: any[] = [];

const trackManager = <T extends { model: any }>(harness: T): T => {
    activeManagers.push(harness.model);
    return harness;
};

const makeRecorder = (overrides: Record<string, any> = {}) => ({
    bindScheduleSession: vi.fn(),
    cancel: vi.fn(async () => undefined),
    finishAtTimeSpecifiedEnd: vi.fn(),
    resetTimer: vi.fn(() => true),
    setTimer: vi.fn(() => true),
    startPreparation: vi.fn(),
    update: vi.fn(async () => undefined),
    ...overrides,
});

afterEach(() => {
    for (const manager of activeManagers.splice(0)) manager.scheduleController.stop();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('recording manager mutation boundaries', () => {
    it('[Task 1.7 mutation] recovers the session queue after one provider rejection without replaying it', async () => {
        const failure = new Error('synthetic first provider failure');
        const replacement = makeRecorder();
        const provider = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(replacement);
        const harness = trackManager(makeManager({ provider }));
        const first = makeReserve({ id: 901, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });
        const second = makeReserve({ id: 902, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });

        await expect(harness.model.update({ insert: [first], isSuppressLog: false })).resolves.toBeUndefined();
        await flushImmediate();
        expect(harness.model.hasReserve(first.id)).toBe(false);
        expect(logger.system.error.mock.calls).toEqual([[`recording schedule dispatch error: ${first.id}`], [failure]]);

        await expect(harness.model.update({ insert: [second], isSuppressLog: true })).resolves.toBeUndefined();

        expect(provider).toHaveBeenCalledTimes(2);
        expect(replacement.setTimer).toHaveBeenCalledOnce();
        expect(replacement.setTimer).toHaveBeenCalledWith(expect.objectContaining({ id: second.id }), true);
        expect(harness.model.recordingIndex[second.id]).toBe(replacement);
        expect(logger.system.error.mock.calls).toEqual([[`recording schedule dispatch error: ${first.id}`], [failure]]);
    });

    it('[Task 1.7 mutation] keeps public update pending until the recorder update settles', async () => {
        const updateResult = deferred<void>();
        const recorder = makeRecorder({ update: vi.fn(() => updateResult.promise) });
        const harness = trackManager(makeManager({ recorder }));
        const reserve = makeReserve({ id: 903, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        recorder.update.mockClear();
        let settled = false;

        const updating = harness.model
            .update({
                update: [makeReserve({ ...reserve, endAt: reserve.endAt + 30_000 })],
                isSuppressLog: true,
            })
            .then(() => {
                settled = true;
            });
        await vi.waitFor(() => expect(recorder.update).toHaveBeenCalledOnce());
        await flushImmediate();

        expect(settled).toBe(false);
        updateResult.resolve();
        await updating;
        expect(settled).toBe(true);
    });

    it.each([
        {
            dispatch: 'preparation',
            errorMessage: 'recording preparation error: 904',
            invoke: async (harness: any, session: any) => {
                expect(
                    harness.model.scheduleController.tryTransitionSession(
                        904,
                        session.generation,
                        session.sessionToken,
                        'Waiting',
                        'Preparing',
                    ),
                ).toBe(true);
                const candidate = harness.model.candidateRegistry.get(904);
                await harness.model.scheduleController.dispatchPreparation(
                    candidate,
                    session.generation,
                    session.sessionToken,
                );
            },
            recorderMethod: 'startPreparation',
        },
        {
            dispatch: 'time-specified end',
            errorMessage: 'time specified recording end error: 904',
            invoke: async (harness: any, session: any) => {
                expect(
                    harness.model.scheduleController.tryTransitionSession(
                        904,
                        session.generation,
                        session.sessionToken,
                        'Waiting',
                        'Finishing',
                    ),
                ).toBe(true);
                await harness.model.scheduleController.dispatchTimeSpecifiedEnd({
                    reservationId: 904,
                    generation: session.generation,
                    sessionToken: session.sessionToken,
                    dueAt: Date.now(),
                });
            },
            recorderMethod: 'finishAtTimeSpecifiedEnd',
        },
    ] as const)(
        '[Task 1.5 mutation] contains a synchronous $dispatch throw and continues with another session',
        async scenario => {
            const failure = new Error(`synthetic ${scenario.dispatch} synchronous failure`);
            const first = makeRecorder({
                [scenario.recorderMethod]: vi.fn(() => {
                    throw failure;
                }),
            });
            const second = makeRecorder();
            const provider = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
            const harness = trackManager(makeManager({ provider }));
            const reserve = makeReserve({
                id: 904,
                isTimeSpecified: scenario.dispatch === 'time-specified end',
                programId: scenario.dispatch === 'time-specified end' ? null : 101,
                startAt: Date.now() + 60_000,
                endAt: Date.now() + 120_000,
            });
            await harness.model.update({ insert: [reserve], isSuppressLog: false });
            const session = harness.model.scheduleController.getSessionSnapshot(reserve.id);

            await expect(scenario.invoke(harness, session)).resolves.toBeUndefined();
            expect(logger.system.error.mock.calls).toEqual([[scenario.errorMessage], [failure]]);

            const following = makeReserve({
                id: 905,
                startAt: Date.now() + 60_000,
                endAt: Date.now() + 120_000,
            });
            await harness.model.update({ insert: [following], isSuppressLog: false });
            expect(second.setTimer).toHaveBeenCalledOnce();
            expect(harness.model.recordingIndex[following.id]).toBe(second);
        },
    );

    it('[Task 1.7 mutation] terminalizes a rejected timer once and never asks for another recorder', async () => {
        const recorder = makeRecorder({ setTimer: vi.fn(() => false) });
        const harness = trackManager(makeManager({ recorder }));
        const reserve = makeReserve({ id: 906, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });

        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        const terminal = harness.model.scheduleController.getSessionSnapshot(reserve.id);
        expect(terminal).toMatchObject({ phase: 'Completed', reservationId: reserve.id });
        expect(harness.model.hasReserve(reserve.id)).toBe(false);

        harness.model.scheduleController.wake();
        await flushImmediate();
        expect(harness.provider).toHaveBeenCalledOnce();
        expect(recorder.setTimer).toHaveBeenCalledOnce();
        expect(recorder.startPreparation).not.toHaveBeenCalled();
        expect(harness.model.scheduleController.getSessionSnapshot(reserve.id)).toBe(terminal);
    });

    it('[Task 1.7 mutation] rejects stale indexed ownership for both update and removal dispatch', async () => {
        const recorder = makeRecorder();
        const harness = trackManager(makeManager({ recorder }));
        const reserve = makeReserve({ id: 907, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        const installedRecorder = harness.model.recordingIndex[reserve.id];
        const session = harness.model.scheduleController.getSessionSnapshot(reserve.id);
        recorder.bindScheduleSession.mockClear();
        recorder.update.mockClear();

        harness.model.recordingSessionTokens.set(reserve.id, session.sessionToken + 1n);
        await harness.model.update({
            update: [makeReserve({ ...reserve, endAt: reserve.endAt + 30_000 })],
            isSuppressLog: false,
        });
        expect(recorder.bindScheduleSession).not.toHaveBeenCalled();
        expect(recorder.update).not.toHaveBeenCalled();

        harness.model.recordingSessionTokens.set(reserve.id, session.sessionToken);
        await harness.model.scheduleController.dispatchMutation({
            action: 'remove',
            reservationId: reserve.id,
            reservation: reserve,
            generation: session.generation,
            previousGeneration: session.generation,
            previousSessionToken: session.sessionToken + 1n,
            previousPhase: session.phase,
            isSuppressLog: false,
        });
        expect(harness.model.recordingIndex[reserve.id]).toBe(installedRecorder);
        expect(recorder.cancel).not.toHaveBeenCalled();
    });

    it('[Task 2.5 mutation] retains one failed planned-deletion latch and logs its terminal failure', async () => {
        const terminal = deferred<void>();
        const failure = new Error('synthetic deletion terminal failure');
        const recorder = makeRecorder({
            cancel: vi.fn(async () => undefined),
            whenDeletionTerminal: vi.fn(() => terminal.promise),
        });
        const harness = trackManager(makeManager({ recorder }));
        const reserve = makeReserve({ id: 908, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });

        const first = harness.model.cancel(reserve.id, true);
        const joined = harness.model.cancel(reserve.id, true);
        terminal.reject(failure);
        await Promise.all([first, joined, terminal.promise.catch(() => undefined)]);
        await flushImmediate();

        expect(recorder.cancel).toHaveBeenCalledOnce();
        expect(recorder.whenDeletionTerminal).toHaveBeenCalledOnce();
        expect(harness.model.hasReserve(reserve.id)).toBe(true);
        expect(harness.model.deletionStops.size).toBe(1);
        expect(logger.system.error.mock.calls).toEqual([
            [`recording deletion terminal error: ${reserve.id}`],
            [failure],
        ]);

        await harness.model.cancel(reserve.id, true);
        expect(recorder.cancel).toHaveBeenCalledOnce();
        expect(harness.model.deletionStops.size).toBe(1);
    });

    it('[Task 2.5 mutation] uses a recorder without a terminal hook as its own one-shot terminal request', async () => {
        const recorder = makeRecorder();
        delete recorder.whenDeletionTerminal;
        const harness = trackManager(makeManager({ recorder }));
        const reserve = makeReserve({ id: 909, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });

        await harness.model.cancel(reserve.id, true);
        await flushImmediate();

        expect(recorder.cancel).toHaveBeenCalledOnce();
        expect(recorder.cancel).toHaveBeenCalledWith(true);
        expect(harness.model.hasReserve(reserve.id)).toBe(false);
        expect(harness.model.deletionStops.size).toBe(0);
    });

    it('[Task 1.7 mutation] starts one fresh shared scheduler and resets every indexed recorder once', async () => {
        vi.useFakeTimers();
        const first = makeRecorder();
        const second = makeRecorder();
        const harness = trackManager(makeManager());
        harness.model.recordingIndex[910] = first;
        harness.model.recordingIndex[911] = second;
        const start = vi.spyOn(harness.model.scheduleController, 'start');
        const requestReset = vi.spyOn(harness.model.scheduleController, 'requestReset');

        harness.model.resetTimer();
        await vi.runAllTicks();

        expect(start).toHaveBeenCalledOnce();
        expect(requestReset).toHaveBeenCalledOnce();
        expect(harness.model.scheduleStarted).toBe(true);
        expect(harness.model.scheduleController.resetRequested).toBe(false);
        expect(first.resetTimer).toHaveBeenCalledOnce();
        expect(second.resetTimer).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(1);
    });

    it('[Task 1.7 mutation gap] drops a queued insert after its reservation is deleted behind another provider', async () => {
        const blockedProvider = deferred<any>();
        const blockerRecorder = makeRecorder();
        const unexpectedRecorder = makeRecorder();
        const provider = vi
            .fn()
            .mockImplementationOnce(() => blockedProvider.promise)
            .mockResolvedValue(unexpectedRecorder);
        const harness = trackManager(makeManager({ provider }));
        const now = Date.now();
        const blocker = makeReserve({ id: 920, startAt: now + 60_000, endAt: now + 120_000 });
        const target = makeReserve({ id: 921, startAt: now + 60_000, endAt: now + 120_000 });

        const blockingUpdate = harness.model.update({ insert: [blocker], isSuppressLog: false });
        await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
        const staleInsert = harness.model.update({ insert: [target], isSuppressLog: false });
        await vi.waitFor(() => expect(harness.model.candidateRegistry.get(target.id)).toBeDefined());
        const deletion = harness.model.update({ delete: [target], isSuppressLog: false });
        await vi.waitFor(() => expect(harness.model.candidateRegistry.get(target.id)).toBeUndefined());

        blockedProvider.resolve(blockerRecorder);
        await Promise.all([blockingUpdate, staleInsert, deletion]);

        expect(provider).toHaveBeenCalledOnce();
        expect(unexpectedRecorder.bindScheduleSession).not.toHaveBeenCalled();
        expect(unexpectedRecorder.setTimer).not.toHaveBeenCalled();
        expect(unexpectedRecorder.update).not.toHaveBeenCalled();
        expect(harness.model.hasReserve(target.id)).toBe(false);
        expect(logger.system.error).not.toHaveBeenCalled();
    });

    it('[Task 1.7 mutation gap] applies only the latest re-add after a queued insert becomes stale', async () => {
        const blockedProvider = deferred<any>();
        const blockerRecorder = makeRecorder();
        const latestRecorder = makeRecorder();
        const provider = vi
            .fn()
            .mockImplementationOnce(() => blockedProvider.promise)
            .mockResolvedValueOnce(latestRecorder);
        const harness = trackManager(makeManager({ provider }));
        const now = Date.now();
        const blocker = makeReserve({ id: 922, startAt: now + 60_000, endAt: now + 120_000 });
        const original = makeReserve({ id: 923, startAt: now + 60_000, endAt: now + 120_000 });
        const replacement = makeReserve({ ...original, startAt: now + 90_000, endAt: now + 150_000 });

        const blockingUpdate = harness.model.update({ insert: [blocker], isSuppressLog: false });
        await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
        const staleInsert = harness.model.update({ insert: [original], isSuppressLog: true });
        await vi.waitFor(() => expect(harness.model.candidateRegistry.get(original.id)).toBeDefined());
        const deletion = harness.model.update({ delete: [original], isSuppressLog: false });
        const latestInsert = harness.model.update({ insert: [replacement], isSuppressLog: false });
        await vi.waitFor(() =>
            expect(harness.model.candidateRegistry.get(original.id)?.reservation.startAt).toBe(replacement.startAt),
        );

        blockedProvider.resolve(blockerRecorder);
        await Promise.all([blockingUpdate, staleInsert, deletion, latestInsert]);

        expect(provider).toHaveBeenCalledTimes(2);
        expect(latestRecorder.bindScheduleSession).toHaveBeenCalledOnce();
        expect(latestRecorder.setTimer).toHaveBeenCalledOnce();
        expect(latestRecorder.setTimer).toHaveBeenCalledWith(
            expect.objectContaining({ id: replacement.id, startAt: replacement.startAt }),
            false,
        );
        expect(latestRecorder.update).not.toHaveBeenCalled();
        expect(harness.model.recordingIndex[replacement.id]).toBe(latestRecorder);
        expect(logger.system.error).not.toHaveBeenCalled();
    });

    it('[Task 1.7 mutation gap] ignores a provider result after public deletion removes its session', async () => {
        const pendingProvider = deferred<any>();
        const recorder = makeRecorder();
        const provider = vi.fn(() => pendingProvider.promise);
        const harness = trackManager(makeManager({ provider }));
        const now = Date.now();
        const reserve = makeReserve({ id: 924, startAt: now + 60_000, endAt: now + 120_000 });

        const insertion = harness.model.update({ insert: [reserve], isSuppressLog: false });
        await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
        const deletion = harness.model.update({ delete: [reserve], isSuppressLog: false });
        await vi.waitFor(() => expect(harness.model.candidateRegistry.get(reserve.id)).toBeUndefined());
        pendingProvider.resolve(recorder);
        await Promise.all([insertion, deletion]);

        expect(recorder.bindScheduleSession).not.toHaveBeenCalled();
        expect(recorder.setTimer).not.toHaveBeenCalled();
        expect(recorder.update).not.toHaveBeenCalled();
        expect(harness.model.hasReserve(reserve.id)).toBe(false);
        expect(logger.system.error).not.toHaveBeenCalled();
    });

    it('[Task 1.7 mutation gap] treats removal of an absent reservation as an effect-free success', async () => {
        const harness = trackManager(makeManager());
        const reserve = makeReserve({ id: 925 });

        await expect(harness.model.update({ delete: [reserve], isSuppressLog: false })).resolves.toBeUndefined();

        expect(harness.provider).not.toHaveBeenCalled();
        expect(harness.recorder.cancel).not.toHaveBeenCalled();
        expect(harness.recorder.update).not.toHaveBeenCalled();
        expect(harness.model.hasReserve(reserve.id)).toBe(false);
        expect(logger.system.error).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        '[Task 2.5 mutation gap] treats public cancel(%s) for an absent reservation as an effect-free success',
        async isPlanToDelete => {
            const harness = trackManager(makeManager());

            await expect(harness.model.cancel(926, isPlanToDelete)).resolves.toBeUndefined();

            expect(harness.recorder.cancel).not.toHaveBeenCalled();
            expect(harness.model.deletionStops.size).toBe(0);
            expect(logger.system.info).not.toHaveBeenCalled();
            expect(logger.system.error).not.toHaveBeenCalled();
        },
    );

    it.each([
        { field: 'isSkip', id: 927 },
        { field: 'isOverlap', id: 928 },
    ] as const)(
        '[Task 1.7 mutation gap] removes ownership and updates a $field reservation without cancelling',
        async scenario => {
            const recorder = makeRecorder();
            const harness = trackManager(makeManager({ recorder }));
            const reserve = makeReserve({ id: scenario.id });
            await harness.model.update({ insert: [reserve], isSuppressLog: false });
            recorder.update.mockClear();
            recorder.cancel.mockClear();

            await harness.model.update({
                update: [makeReserve({ ...reserve, [scenario.field]: true })],
                isSuppressLog: true,
            });

            expect(recorder.update).toHaveBeenCalledOnce();
            expect(recorder.update).toHaveBeenCalledWith(expect.objectContaining({ [scenario.field]: true }), true);
            expect(recorder.cancel).not.toHaveBeenCalled();
            expect(harness.model.hasReserve(reserve.id)).toBe(false);
            expect(harness.model.recordingSessionTokens.has(reserve.id)).toBe(false);
        },
    );

    it('[Task 1.7 mutation gap] makes captured binding freshness follow generation updates and deletion', async () => {
        const recorder = makeRecorder();
        const harness = trackManager(makeManager({ recorder }));
        const reserve = makeReserve({ id: 929 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        const originalBinding = recorder.bindScheduleSession.mock.calls.at(-1)?.[0];
        const originalSession = harness.model.scheduleController.getSessionSnapshot(reserve.id);

        await harness.model.update({
            update: [makeReserve({ ...reserve, endAt: reserve.endAt + 30_000 })],
            isSuppressLog: false,
        });
        const updatedBinding = recorder.bindScheduleSession.mock.calls.at(-1)?.[0];
        const updatedSession = harness.model.scheduleController.getSessionSnapshot(reserve.id);
        expect(updatedSession.sessionToken).toBe(originalSession.sessionToken);
        expect(updatedSession.generation).not.toBe(originalSession.generation);
        expect(originalBinding.isCurrent('Waiting')).toBe(false);
        expect(updatedBinding.isCurrent('Waiting')).toBe(true);

        await harness.model.update({ delete: [reserve], isSuppressLog: false });
        expect(() => updatedBinding.isCurrent('Waiting')).not.toThrow();
        expect(updatedBinding.isCurrent('Waiting')).toBe(false);
    });

    it('[Task 1.7 mutation gap] wakes only the first successful captured-binding requeue', async () => {
        const recorder = makeRecorder();
        const harness = trackManager(makeManager({ recorder }));
        const reserve = makeReserve({ id: 930 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        const binding = recorder.bindScheduleSession.mock.calls.at(-1)?.[0];
        const wake = vi.spyOn(harness.model.scheduleController, 'wake');
        wake.mockClear();
        expect(binding.tryTransition('Waiting', 'Cancelled')).toBe(true);

        expect(binding.requeueAfterReschedule()).toBe(true);
        expect(wake).toHaveBeenCalledOnce();
        expect(binding.requeueAfterReschedule()).toBe(false);
        expect(wake).toHaveBeenCalledOnce();
    });

    it('[Task 1.7 mutation gap] forwards exact time-specified milestone ownership through a captured binding', async () => {
        const recorder = makeRecorder();
        const harness = trackManager(makeManager({ recorder }));
        const reserve = makeReserve({ id: 931, isTimeSpecified: true, programId: null });
        const register = vi.spyOn(harness.model.scheduleController, 'registerTimeSpecifiedEnd');
        const remove = vi.spyOn(harness.model.scheduleController, 'removeTimeSpecifiedEnd');
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        const binding = recorder.bindScheduleSession.mock.calls.at(-1)?.[0];
        register.mockClear();
        remove.mockClear();
        const dueAt = reserve.endAt + 12_345;

        binding.registerTimeSpecifiedEnd(dueAt);
        binding.removeTimeSpecifiedEnd();

        expect(register).toHaveBeenCalledOnce();
        expect(register).toHaveBeenCalledWith({
            reservationId: reserve.id,
            generation: binding.generation,
            sessionToken: binding.sessionToken,
            dueAt,
        });
        expect(remove).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledWith(reserve.id, binding.generation, binding.sessionToken);
    });

    it('[Task 1.7 gap] leaves a session unbound when its reservation is no longer registered as a candidate', () => {
        const harness = trackManager(makeManager());
        const recorder = makeRecorder();
        const session = { generation: 1n, phase: 'Waiting', reservationId: 941, sessionToken: 1n };

        expect(() => harness.model.bindRecorder(recorder, session)).not.toThrow();

        expect(recorder.bindScheduleSession).not.toHaveBeenCalled();
    });

    it('[Task 1.7 gap] falls back to no extra margin when the time-specified end margin is unconfigured', async () => {
        const recorder = makeRecorder();
        const harness = trackManager(makeManager({ recorder }));
        const register = vi.spyOn(harness.model.scheduleController, 'registerTimeSpecifiedEnd');
        const now = Date.now();
        const reserve = makeReserve({
            id: 942,
            endAt: now + 120_000,
            isTimeSpecified: true,
            programId: null,
            startAt: now + 60_000,
        });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        register.mockClear();

        const updated = makeReserve({ ...reserve, endAt: reserve.endAt + 30_000 });
        await harness.model.update({ update: [updated], isSuppressLog: false });

        expect(register).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ dueAt: updated.endAt, reservationId: reserve.id }),
        );
    });

    it('[Task 1.7 gap] forwards a startup mutation with a non-boolean isSuppressLog directly without snapshotting', () => {
        const harness = trackManager(makeManager({ startupCompleted: false }));
        const directAccept = vi.spyOn(harness.model.scheduleController, 'acceptMutation');
        const malformed = { insert: [], isSuppressLog: undefined } as any;

        expect(() => harness.model.acceptMutation(malformed)).not.toThrow();

        expect(directAccept).toHaveBeenCalledExactlyOnceWith(malformed);
        expect(harness.model.pendingStartupMutations).toEqual([]);
    });

    it('[Task 1.7 gap] drops a startup mutation snapshot when a queued reservation row is malformed', () => {
        const harness = trackManager(makeManager({ startupCompleted: false }));
        const directAccept = vi.spyOn(harness.model.scheduleController, 'acceptMutation');
        const malformed = { insert: [{ id: 'not-a-number' }], isSuppressLog: false } as any;

        expect(() => harness.model.acceptMutation(malformed)).not.toThrow();

        expect(directAccept).toHaveBeenCalledExactlyOnceWith(malformed);
        expect(harness.model.pendingStartupMutations).toEqual([]);
    });

    it('[Task 1.7 gap] logs and continues past a lazily-triggered scheduler start rejection', async () => {
        const harness = trackManager(makeManager());
        harness.model.scheduleStarted = false;
        const failure = new Error('synthetic lazy scheduler start failure');
        vi.spyOn(harness.model.scheduleController, 'start').mockRejectedValueOnce(failure);

        expect(() => harness.model.acceptMutation({ insert: [], isSuppressLog: false })).not.toThrow();
        expect(harness.model.scheduleStarted).toBe(true);
        await flushImmediate();

        expect(logger.system.error.mock.calls).toEqual([['recording schedule start error'], [failure]]);
    });

    it('[Task 7.3 gap] logs a startup cleanup cancel failure without blocking rollback completion', async () => {
        const failure = new Error('synthetic scheduler start failure');
        const cancelFailure = new Error('synthetic startup cleanup cancel failure');
        const startGate = deferred<void>();
        const originalStart = RecordingScheduleController.prototype.start;
        const start = vi
            .spyOn(RecordingScheduleController.prototype, 'start')
            .mockImplementation(async function (this: any) {
                await originalStart.call(this);
                await startGate.promise;
            });
        try {
            const reserve = makeReserve({ id: 943, startAt: Date.now(), endAt: Date.now() + 60_000 });
            const recorder = makeRecorder({
                cancel: vi.fn(async () => {
                    throw cancelFailure;
                }),
            });
            const harness = trackManager(
                makeManager({
                    recorder,
                    reserveDB: { findId: vi.fn(), findLists: vi.fn(async () => [reserve]) },
                    startupCompleted: false,
                }),
            );

            const startup = harness.model.rebuildCandidatesAndStart();
            for (let index = 0; index < 12; index += 1) await Promise.resolve();
            expect(recorder.setTimer).toHaveBeenCalledOnce();

            startGate.reject(failure);
            await expect(startup).rejects.toBe(failure);

            expect(recorder.cancel).toHaveBeenCalledExactlyOnceWith(false);
            expect(logger.system.error.mock.calls).toEqual([
                ['recording startup cleanup error'],
                [cancelFailure],
            ]);
        } finally {
            start.mockRestore();
        }
    });
});
