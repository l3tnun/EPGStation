import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, flushImmediate, logger, makeManager, makeRecorded, makeReserve } from './_harness';

const activeManagers: any[] = [];

const trackManager = <T extends { model: any }>(harness: T): T => {
    activeManagers.push(harness.model);
    return harness;
};

const makeRetryRecorder = (overrides: Record<string, any> = {}) => ({
    bindScheduleSession: vi.fn(),
    cancel: vi.fn(async () => undefined),
    resetTimer: vi.fn(() => true),
    setTimer: vi.fn(() => true),
    startPreparation: vi.fn(),
    update: vi.fn(async () => undefined),
    ...overrides,
});

const captureFailure = (harness: any, recorder: any, reserve: any) => {
    const identity = recorder.bindScheduleSession.mock.calls.at(-1)?.[0];
    expect(identity).toBeDefined();
    return () => harness.callbacks.failed(reserve, null, identity);
};

const waitFor = async (predicate: () => boolean, diagnostic: string): Promise<void> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (predicate()) return;
        await flushImmediate();
    }
    throw new Error(diagnostic);
};

const setupDispatch = async (kind: 'preparation' | 'time-end', recorderOverrides: Record<string, any> = {}) => {
    const recorder = {
        bindScheduleSession: vi.fn(),
        finishAtTimeSpecifiedEnd: vi.fn(),
        startPreparation: vi.fn(),
        ...recorderOverrides,
    };
    const harness = trackManager(makeManager({ recorder }));
    const now = Date.now();
    const reserve = makeReserve({
        id: kind === 'preparation' ? 511 : 512,
        isTimeSpecified: kind === 'time-end',
        programId: kind === 'time-end' ? null : 101,
        startAt: now + 60_000,
        endAt: now + 120_000,
    });
    await harness.model.update({ insert: [reserve], isSuppressLog: false });
    const candidate = harness.model.candidateRegistry.get(reserve.id);
    const scheduleSession = harness.model.scheduleController.getSessionSnapshot(reserve.id);
    expect(candidate).toBeDefined();
    expect(scheduleSession).toMatchObject({ phase: 'Waiting' });
    return { candidate, harness, recorder, reserve, scheduleSession };
};

afterEach(() => {
    for (const manager of activeManagers.splice(0)) manager.scheduleController.stop();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('recording manager scheduler adapters', () => {
    it('[P1][lines 69-79] creates one unrefed timeout and exposes an exact cancel handle', () => {
        const unref = vi.fn();
        const timeout = { unref } as unknown as ReturnType<typeof setTimeout>;
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timeout);
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);
        const harness = trackManager(makeManager());
        const callback = vi.fn();

        const handle = harness.model.scheduleController.scheduler.setTimeout(callback, 321);
        handle.cancel();

        expect(setTimeoutSpy).toHaveBeenCalledWith(callback, 321);
        expect(unref).toHaveBeenCalledOnce();
        expect(clearTimeoutSpy).toHaveBeenCalledWith(timeout);
    });

    it('[P1][lines 73-76] accepts timeout handles that do not expose unref', () => {
        const timeout = {} as ReturnType<typeof setTimeout>;
        vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timeout);
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);
        const harness = trackManager(makeManager());

        const handle = harness.model.scheduleController.scheduler.setTimeout(vi.fn(), 322);
        handle.cancel();

        expect(clearTimeoutSpy).toHaveBeenCalledWith(timeout);
    });

    it.each([
        'missing current session',
        'generation mismatch',
        'session token mismatch',
        'phase mismatch',
        'missing recorder',
        'indexed token mismatch',
    ] as const)('[P1][lines 81-102] rejects one stale preparation fence: %s', async staleAxis => {
        const { harness, recorder, reserve, scheduleSession: session } = await setupDispatch('preparation');
        let generation = session.generation;
        let sessionToken = session.sessionToken;
        if (staleAxis !== 'phase mismatch') {
            expect(
                harness.model.scheduleController.tryTransitionSession(
                    reserve.id,
                    session.generation,
                    session.sessionToken,
                    'Waiting',
                    'Preparing',
                ),
            ).toBe(true);
        }
        const candidate = harness.model.candidateRegistry.get(reserve.id);

        if (staleAxis === 'missing current session') harness.model.candidateRegistry.remove(reserve.id);
        if (staleAxis === 'generation mismatch') generation += 1n;
        if (staleAxis === 'session token mismatch') {
            sessionToken += 1n;
            harness.model.recordingSessionTokens.set(reserve.id, sessionToken);
        }
        if (staleAxis === 'missing recorder') delete harness.model.recordingIndex[reserve.id];
        if (staleAxis === 'indexed token mismatch') {
            harness.model.recordingSessionTokens.set(reserve.id, sessionToken + 1n);
        }

        await expect(
            harness.model.scheduleController.dispatchPreparation(candidate, generation, sessionToken),
        ).resolves.toBeUndefined();
        expect(recorder.startPreparation).not.toHaveBeenCalled();
    });

    it('[P1][lines 81-102] binds and starts one current Preparing session', async () => {
        const { harness, recorder, reserve, scheduleSession: session } = await setupDispatch('preparation');
        expect(
            harness.model.scheduleController.tryTransitionSession(
                reserve.id,
                session.generation,
                session.sessionToken,
                'Waiting',
                'Preparing',
            ),
        ).toBe(true);
        const candidate = harness.model.candidateRegistry.get(reserve.id);

        await harness.model.scheduleController.dispatchPreparation(candidate, session.generation, session.sessionToken);

        expect(recorder.bindScheduleSession.mock.calls.at(-1)?.[0]).toMatchObject({
            generation: session.generation,
            phase: 'Preparing',
            sessionToken: session.sessionToken,
        });
        expect(recorder.startPreparation).toHaveBeenCalledOnce();
    });

    it('[P1][lines 98-102] accepts an absent optional preparation method without a diagnostic', async () => {
        const {
            harness,
            reserve,
            scheduleSession: session,
        } = await setupDispatch('preparation', {
            startPreparation: undefined,
        });
        expect(
            harness.model.scheduleController.tryTransitionSession(
                reserve.id,
                session.generation,
                session.sessionToken,
                'Waiting',
                'Preparing',
            ),
        ).toBe(true);
        const candidate = harness.model.candidateRegistry.get(reserve.id);

        await harness.model.scheduleController.dispatchPreparation(candidate, session.generation, session.sessionToken);
        await flushImmediate();

        expect(logger.system.error).not.toHaveBeenCalled();
    });

    it('[P1][lines 98-102] records the exact asynchronous preparation diagnostic', async () => {
        const failure = new Error('synthetic preparation dispatch failure');
        const {
            harness,
            reserve,
            scheduleSession: session,
        } = await setupDispatch('preparation', {
            startPreparation: vi.fn(async () => Promise.reject(failure)),
        });
        expect(
            harness.model.scheduleController.tryTransitionSession(
                reserve.id,
                session.generation,
                session.sessionToken,
                'Waiting',
                'Preparing',
            ),
        ).toBe(true);
        const candidate = harness.model.candidateRegistry.get(reserve.id);

        await harness.model.scheduleController.dispatchPreparation(candidate, session.generation, session.sessionToken);
        await flushImmediate();

        expect(logger.system.error.mock.calls).toEqual([[`recording preparation error: ${reserve.id}`], [failure]]);
    });

    it.each([
        'missing current session',
        'missing recorder',
        'indexed token mismatch',
        'generation mismatch',
        'current session token mismatch',
        'phase mismatch',
    ] as const)('[P1][lines 105-122] rejects one stale time-end fence: %s', async staleAxis => {
        const { harness, recorder, reserve, scheduleSession: session } = await setupDispatch('time-end');
        if (staleAxis !== 'phase mismatch') {
            expect(
                harness.model.scheduleController.tryTransitionSession(
                    reserve.id,
                    session.generation,
                    session.sessionToken,
                    'Waiting',
                    'Finishing',
                ),
            ).toBe(true);
        }
        let milestoneGeneration = session.generation;
        let milestoneToken = session.sessionToken;
        if (staleAxis === 'missing current session') harness.model.candidateRegistry.remove(reserve.id);
        if (staleAxis === 'missing recorder') delete harness.model.recordingIndex[reserve.id];
        if (staleAxis === 'indexed token mismatch') {
            harness.model.recordingSessionTokens.set(reserve.id, session.sessionToken + 1n);
        }
        if (staleAxis === 'generation mismatch') milestoneGeneration += 1n;
        if (staleAxis === 'current session token mismatch') {
            milestoneToken += 1n;
            harness.model.recordingSessionTokens.set(reserve.id, milestoneToken);
        }
        const milestone = {
            reservationId: reserve.id,
            generation: milestoneGeneration,
            sessionToken: milestoneToken,
            dueAt: reserve.endAt,
        };

        await expect(harness.model.scheduleController.dispatchTimeSpecifiedEnd(milestone)).resolves.toBeUndefined();
        expect(recorder.finishAtTimeSpecifiedEnd).not.toHaveBeenCalled();
    });

    it('[P1][lines 105-122] binds and finishes one current Finishing session', async () => {
        const { harness, recorder, reserve, scheduleSession: session } = await setupDispatch('time-end');
        expect(
            harness.model.scheduleController.tryTransitionSession(
                reserve.id,
                session.generation,
                session.sessionToken,
                'Waiting',
                'Finishing',
            ),
        ).toBe(true);
        const milestone = {
            reservationId: reserve.id,
            generation: session.generation,
            sessionToken: session.sessionToken,
            dueAt: reserve.endAt,
        };

        await harness.model.scheduleController.dispatchTimeSpecifiedEnd(milestone);

        expect(recorder.bindScheduleSession.mock.calls.at(-1)?.[0]).toMatchObject({
            generation: session.generation,
            phase: 'Finishing',
            sessionToken: session.sessionToken,
        });
        expect(recorder.finishAtTimeSpecifiedEnd).toHaveBeenCalledOnce();
    });

    it('[P1][lines 118-122] accepts an absent optional time-end method without a diagnostic', async () => {
        const {
            harness,
            reserve,
            scheduleSession: session,
        } = await setupDispatch('time-end', {
            finishAtTimeSpecifiedEnd: undefined,
        });
        expect(
            harness.model.scheduleController.tryTransitionSession(
                reserve.id,
                session.generation,
                session.sessionToken,
                'Waiting',
                'Finishing',
            ),
        ).toBe(true);
        const milestone = {
            reservationId: reserve.id,
            generation: session.generation,
            sessionToken: session.sessionToken,
            dueAt: reserve.endAt,
        };

        await harness.model.scheduleController.dispatchTimeSpecifiedEnd(milestone);
        await flushImmediate();

        expect(logger.system.error).not.toHaveBeenCalled();
    });

    it('[P1][lines 118-122] records the exact asynchronous time-end diagnostic', async () => {
        const failure = new Error('synthetic time-end dispatch failure');
        const {
            harness,
            reserve,
            scheduleSession: session,
        } = await setupDispatch('time-end', {
            finishAtTimeSpecifiedEnd: vi.fn(async () => Promise.reject(failure)),
        });
        expect(
            harness.model.scheduleController.tryTransitionSession(
                reserve.id,
                session.generation,
                session.sessionToken,
                'Waiting',
                'Finishing',
            ),
        ).toBe(true);
        const milestone = {
            reservationId: reserve.id,
            generation: session.generation,
            sessionToken: session.sessionToken,
            dueAt: reserve.endAt,
        };

        await harness.model.scheduleController.dispatchTimeSpecifiedEnd(milestone);
        await flushImmediate();

        expect(logger.system.error.mock.calls).toEqual([
            [`time specified recording end error: ${reserve.id}`],
            [failure],
        ]);
    });

    it('[P1][lines 124-127] records the exact scheduler dispatch diagnostic pair', () => {
        const harness = trackManager(makeManager());
        const failure = new Error('synthetic schedule dispatch failure');

        harness.model.scheduleController.reportDispatchError(failure, { reservationId: 513 });

        expect(logger.system.error.mock.calls).toEqual([['recording schedule dispatch error: 513'], [failure]]);
    });
});

describe('recording manager lifecycle callbacks', () => {
    it.each(['cancelPrep', 'prepFailed'] as const)(
        '[P1][lines 136-143] detaches the indexed recorder on %s',
        async callbackName => {
            const harness = trackManager(makeManager());
            const reserve = makeReserve({ id: callbackName === 'cancelPrep' ? 514 : 515 });
            harness.model.recordingIndex[reserve.id] = harness.recorder;

            await harness.callbacks[callbackName](reserve);

            expect(harness.model.hasReserve(reserve.id)).toBe(false);
            expect(logger.system.debug.mock.calls).toEqual([[`delete recording index: ${reserve.id}`]]);
        },
    );

    it.each(['cancelPrep', 'prepFailed', 'finish'] as const)(
        '[P1][lines 136-143/177-179/202-207] releases only the terminal %s recording session token',
        async callbackName => {
            const harness = trackManager(makeManager());
            const reserve = makeReserve({
                id: callbackName === 'cancelPrep' ? 614 : callbackName === 'prepFailed' ? 615 : 616,
            });
            const unrelatedReserveId = reserve.id + 100;
            harness.model.recordingIndex[reserve.id] = harness.recorder;
            harness.model.recordingIndex[unrelatedReserveId] = harness.recorder;
            harness.model.recordingSessionTokens.set(reserve.id, 1n);
            harness.model.recordingSessionTokens.set(unrelatedReserveId, 2n);

            // setFinishRecording's callback is `(reserve, recorded) => ...` (unlike cancelPrep/
            // prepFailed, which take only `reserve`); RecordingManageModel.ts:197 reads
            // `recorded.id` unconditionally, so the 'finish' case needs a synthetic Recorded row.
            await harness.callbacks[callbackName](
                reserve,
                callbackName === 'finish' ? makeRecorded({ id: reserve.id + 1_000 }) : undefined,
            );

            expect(harness.model.recordingIndex[reserve.id]).toBeUndefined();
            expect(harness.model.recordingSessionTokens.has(reserve.id)).toBe(false);
            expect(harness.model.recordingIndex[unrelatedReserveId]).toBe(harness.recorder);
            expect(harness.model.recordingSessionTokens.get(unrelatedReserveId)).toBe(2n);
        },
    );

    it('[P1][lines 145-147] ignores recording failure while the same recorder owns a deletion stop', async () => {
        const harness = trackManager(makeManager());
        const reserve = makeReserve({ id: 516 });
        harness.model.recordingIndex[reserve.id] = harness.recorder;
        harness.model.deletionStops.set(reserve.id, {
            recorder: harness.recorder,
            request: Promise.resolve(),
            terminal: Promise.resolve(),
        });

        await harness.callbacks.failed(reserve);

        expect(harness.model.recordingIndex[reserve.id]).toBe(harness.recorder);
        expect(harness.recordedDB.findReserveId).not.toHaveBeenCalled();
        expect(harness.provider).not.toHaveBeenCalled();
    });

    it('[P1 mutation gap][lines 145-147] ignores a current failure while public planned deletion owns the recorder', async () => {
        const terminal = deferred<void>();
        const recorder = makeRetryRecorder({
            whenDeletionTerminal: vi.fn(() => terminal.promise),
        });
        const provider = vi.fn().mockResolvedValue(recorder);
        const harness = trackManager(makeManager({ provider }));
        const now = Date.now();
        const reserve = makeReserve({ id: 617, startAt: now + 60_000, endAt: now + 120_000 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        const fail = captureFailure(harness, recorder, reserve);
        provider.mockClear();

        await harness.model.cancel(reserve.id, true);
        await fail();

        expect(harness.model.recordingIndex[reserve.id]).toBe(recorder);
        expect(harness.model.recordingSessionTokens.has(reserve.id)).toBe(true);
        expect(harness.recordedDB.findReserveId).not.toHaveBeenCalled();
        expect(provider).not.toHaveBeenCalled();
        expect(harness.recordingEvent.emitRecordingRetryOver).not.toHaveBeenCalled();

        terminal.resolve();
        await flushImmediate();
        expect(harness.model.recordingIndex[reserve.id]).toBeUndefined();
        expect(harness.model.recordingSessionTokens.has(reserve.id)).toBe(false);
    });
});

describe('recording manager failed-recording retry', () => {
    it.each([
        { count: 0, retries: true },
        { count: 2, retries: true },
        { count: 3, retries: false },
    ])('[P1][RE-6.1/6.3/6.4] counts $count prior results once at the exact retry boundary', async scenario => {
        const initialRecorder = makeRetryRecorder();
        const retryRecorder = makeRetryRecorder();
        const provider = vi.fn().mockResolvedValueOnce(initialRecorder).mockResolvedValueOnce(retryRecorder);
        const harness = trackManager(makeManager({ provider }));
        const now = Date.now();
        const reserve = makeReserve({ id: 517 + scenario.count, startAt: now + 60_000, endAt: now + 120_000 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        const fail = captureFailure(harness, initialRecorder, reserve);
        harness.recordedDB.findReserveId.mockResolvedValue(Array.from({ length: scenario.count }, () => ({})));
        provider.mockClear();

        await fail();

        expect(harness.recordedDB.findReserveId).toHaveBeenCalledOnce();
        expect(harness.recordedDB.findReserveId).toHaveBeenCalledWith(reserve.id);
        expect(provider).toHaveBeenCalledTimes(scenario.retries ? 1 : 0);
        expect(retryRecorder.setTimer).toHaveBeenCalledTimes(scenario.retries ? 1 : 0);
        expect(harness.recordingEvent.emitRecordingRetryOver).toHaveBeenCalledTimes(scenario.retries ? 0 : 1);
        if (!scenario.retries) {
            expect(logger.system.error).toHaveBeenCalledWith(`recording retry over: ${reserve.id}`);
            expect(harness.recordingEvent.emitRecordingRetryOver).toHaveBeenCalledWith(reserve);
        }
    });

    it.each([
        { count: 0, retries: true },
        { count: 3, retries: false },
    ])('[P1 review][RE-6.1/6.4] claims one failure identity when count is $count', async scenario => {
        const now = Date.now();
        const initialRecorder = makeRetryRecorder();
        const retryRecorder = makeRetryRecorder();
        const provider = vi.fn().mockResolvedValueOnce(initialRecorder).mockResolvedValueOnce(retryRecorder);
        const countQuery = deferred<any[]>();
        const harness = trackManager(
            makeManager({
                provider,
                recordedDB: { findReserveId: vi.fn(() => countQuery.promise) },
            }),
        );
        const reserve = makeReserve({ id: 521, startAt: now + 10_000, endAt: now + 60_000 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        const fail = captureFailure(harness, initialRecorder, reserve);
        provider.mockClear();
        initialRecorder.startPreparation.mockClear();

        const first = fail();
        await waitFor(
            () => harness.recordedDB.findReserveId.mock.calls.length === 1,
            'first count query did not start',
        );
        const duplicate = fail();
        await flushImmediate();
        const queryCallsBeforeResolve = harness.recordedDB.findReserveId.mock.calls.length;

        countQuery.resolve(Array.from({ length: scenario.count }, () => ({})));
        await Promise.all([first, duplicate]);

        expect(queryCallsBeforeResolve).toBe(1);
        expect(harness.recordedDB.findReserveId).toHaveBeenCalledOnce();
        expect(provider).toHaveBeenCalledTimes(scenario.retries ? 1 : 0);
        expect(retryRecorder.setTimer).toHaveBeenCalledTimes(scenario.retries ? 1 : 0);
        expect(retryRecorder.startPreparation).toHaveBeenCalledTimes(scenario.retries ? 1 : 0);
        expect(harness.recordingEvent.emitRecordingRetryOver).toHaveBeenCalledTimes(scenario.retries ? 0 : 1);
    });

    it.each([
        { endOffset: -1, retries: false },
        { endOffset: 0, retries: false },
        { endOffset: 1, retries: true },
    ])('[P1][RE-6.2] retries only while endAt-now is $endOffset ms', async scenario => {
        const now = 2_000_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(now);
        const initialRecorder = makeRetryRecorder();
        const retryRecorder = makeRetryRecorder();
        const provider = vi.fn().mockResolvedValueOnce(initialRecorder).mockResolvedValueOnce(retryRecorder);
        const harness = trackManager(makeManager({ provider }));
        const reserve = makeReserve({
            id: 521 + scenario.endOffset,
            startAt: now - 30_000,
            endAt: now + scenario.endOffset,
        });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        const fail = captureFailure(harness, initialRecorder, reserve);
        harness.recordedDB.findReserveId.mockResolvedValue([]);
        provider.mockClear();
        retryRecorder.startPreparation.mockClear();

        await fail();

        expect(provider).toHaveBeenCalledTimes(scenario.retries ? 1 : 0);
        expect(retryRecorder.setTimer).toHaveBeenCalledTimes(scenario.retries ? 1 : 0);
        expect(retryRecorder.startPreparation).toHaveBeenCalledTimes(scenario.retries ? 1 : 0);
        expect(harness.recordingEvent.emitRecordingRetryOver).not.toHaveBeenCalled();
        if (scenario.retries) {
            expect(logger.system.info).toHaveBeenCalledWith(`readd recording: ${reserve.id}`);
            expect(logger.system.error).not.toHaveBeenCalledWith(`readd recording error: ${reserve.id}`);
        } else {
            expect(logger.system.error).toHaveBeenCalledWith(`readd recording error: ${reserve.id}`);
            expect(logger.system.info).not.toHaveBeenCalledWith(`readd recording: ${reserve.id}`);
        }
    });

    it('[P1][RE-6.2] creates a distinct Waiting session and dispatches its immediate preparation once', async () => {
        const now = Date.now();
        const initialRecorder = makeRetryRecorder();
        const retryRecorder = makeRetryRecorder();
        const provider = vi.fn().mockResolvedValueOnce(initialRecorder).mockResolvedValueOnce(retryRecorder);
        const harness = trackManager(makeManager({ provider }));
        const reserve = makeReserve({ id: 522, startAt: now + 10_000, endAt: now + 60_000 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        const fail = captureFailure(harness, initialRecorder, reserve);
        const failedSession = harness.model.scheduleController.getSessionSnapshot(reserve.id);
        harness.recordedDB.findReserveId.mockResolvedValue([]);
        const transition = vi.spyOn(harness.model.scheduleController, 'tryTransitionSession');
        transition.mockClear();

        await fail();

        const retrySession = harness.model.scheduleController.getSessionSnapshot(reserve.id);
        expect(retrySession.generation).not.toBe(failedSession.generation);
        expect(retrySession.sessionToken).not.toBe(failedSession.sessionToken);
        expect(transition).toHaveBeenCalledWith(
            reserve.id,
            retrySession.generation,
            retrySession.sessionToken,
            'Waiting',
            'Preparing',
        );
        expect(retryRecorder.bindScheduleSession).toHaveBeenCalledWith(
            expect.objectContaining({
                generation: retrySession.generation,
                phase: 'Preparing',
                sessionToken: retrySession.sessionToken,
            }),
        );
        expect(retryRecorder.startPreparation).toHaveBeenCalledOnce();
    });

    it('[P1][RE-6.1/6.2] treats a failure event without a current session as stale', async () => {
        const recorder = makeRetryRecorder();
        const harness = trackManager(makeManager({ recorder }));
        const reserve = makeReserve({ id: 523, startAt: Date.now() + 10_000, endAt: Date.now() + 60_000 });
        harness.recordedDB.findReserveId.mockResolvedValue([]);

        await harness.callbacks.failed(reserve, null, undefined);

        expect(harness.recordedDB.findReserveId).not.toHaveBeenCalled();
        expect(harness.provider).not.toHaveBeenCalled();
        expect(recorder.setTimer).not.toHaveBeenCalled();
        expect(recorder.startPreparation).not.toHaveBeenCalled();
        expect(harness.model.candidateRegistry.get(reserve.id)).toBeUndefined();
        expect(harness.model.hasReserve(reserve.id)).toBe(false);
    });

    it.each([
        { count: 0, mutationKind: 'update' },
        { count: 0, mutationKind: 'readd' },
        { count: 3, mutationKind: 'update' },
        { count: 3, mutationKind: 'readd' },
    ] as const)(
        '[P1 review][RE-6.1/6.4 late duplicate] rejects a $mutationKind-old callback after pending count $count settles',
        async ({ count, mutationKind }) => {
            const now = Date.now();
            const initialRecorder = makeRetryRecorder();
            const latestRecorder = makeRetryRecorder();
            const retryRecorder = makeRetryRecorder();
            const provider = vi
                .fn()
                .mockResolvedValueOnce(initialRecorder)
                .mockResolvedValueOnce(latestRecorder)
                .mockResolvedValueOnce(retryRecorder);
            const countQuery = deferred<any[]>();
            const harness = trackManager(
                makeManager({
                    provider,
                    recordedDB: { findReserveId: vi.fn(() => countQuery.promise) },
                }),
            );
            const reserve = makeReserve({ id: 526, startAt: now + 60_000, endAt: now + 120_000 });
            const latestReserve = makeReserve({
                ...reserve,
                name: `late-duplicate-${mutationKind}`,
                halfWidthName: `late-duplicate-${mutationKind}`,
            });
            await harness.model.update({ insert: [reserve], isSuppressLog: false });
            const oldFailure = captureFailure(harness, initialRecorder, reserve);

            const pendingOldFailure = oldFailure();
            await waitFor(() => harness.recordedDB.findReserveId.mock.calls.length === 1, 'old count query missing');
            if (mutationKind === 'readd') {
                await harness.model.update({ delete: [reserve], isSuppressLog: false });
                await harness.model.update({ insert: [latestReserve], isSuppressLog: false });
            } else {
                await harness.model.update({ update: [latestReserve], isSuppressLog: false });
            }
            const currentFailure = captureFailure(harness, latestRecorder, latestReserve);
            const retryMutation = vi.spyOn(harness.model.scheduleController, 'acceptMutation');
            retryMutation.mockClear();
            provider.mockClear();
            initialRecorder.cancel.mockClear();
            latestRecorder.cancel.mockClear();

            countQuery.resolve(Array.from({ length: count }, () => ({})));
            await pendingOldFailure;
            await oldFailure();

            expect(harness.recordedDB.findReserveId).toHaveBeenCalledOnce();
            expect(harness.model.recordingIndex[reserve.id]).toBe(latestRecorder);
            expect(provider).not.toHaveBeenCalled();
            expect(retryMutation).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitRecordingRetryOver).not.toHaveBeenCalled();
            expect(initialRecorder.cancel).not.toHaveBeenCalled();
            expect(latestRecorder.cancel).not.toHaveBeenCalled();

            await Promise.all([currentFailure(), currentFailure()]);

            expect(harness.recordedDB.findReserveId).toHaveBeenCalledTimes(2);
            expect(provider).toHaveBeenCalledTimes(count < 3 ? 1 : 0);
            expect(retryRecorder.setTimer).toHaveBeenCalledTimes(count < 3 ? 1 : 0);
            expect(retryMutation).toHaveBeenCalledTimes(count < 3 ? 1 : 0);
            expect(harness.recordingEvent.emitRecordingRetryOver).toHaveBeenCalledTimes(count >= 3 ? 1 : 0);
            expect(latestRecorder.cancel).not.toHaveBeenCalled();
        },
    );

    it.each([
        { count: 0, mutationKind: 'update' },
        { count: 0, mutationKind: 'readd' },
        { count: 3, mutationKind: 'update' },
        { count: 3, mutationKind: 'readd' },
    ] as const)(
        '[P1 review][RE-6.1/6.4 late first] rejects a $mutationKind-old callback before count $count starts',
        async ({ count, mutationKind }) => {
            const now = Date.now();
            const initialRecorder = makeRetryRecorder();
            const latestRecorder = makeRetryRecorder();
            const retryRecorder = makeRetryRecorder();
            const provider = vi
                .fn()
                .mockResolvedValueOnce(initialRecorder)
                .mockResolvedValueOnce(latestRecorder)
                .mockResolvedValueOnce(retryRecorder);
            const harness = trackManager(makeManager({ provider }));
            const reserve = makeReserve({ id: 527, startAt: now + 60_000, endAt: now + 120_000 });
            const latestReserve = makeReserve({
                ...reserve,
                name: `late-first-${mutationKind}`,
                halfWidthName: `late-first-${mutationKind}`,
            });
            await harness.model.update({ insert: [reserve], isSuppressLog: false });
            const oldFailure = captureFailure(harness, initialRecorder, reserve);

            let currentRecorder = initialRecorder;
            if (mutationKind === 'readd') {
                await harness.model.update({ delete: [reserve], isSuppressLog: false });
                await harness.model.update({ insert: [latestReserve], isSuppressLog: false });
                currentRecorder = latestRecorder;
            } else {
                await harness.model.update({ update: [latestReserve], isSuppressLog: false });
            }
            const currentFailure = captureFailure(harness, currentRecorder, latestReserve);
            const retryMutation = vi.spyOn(harness.model.scheduleController, 'acceptMutation');
            retryMutation.mockClear();
            harness.recordedDB.findReserveId.mockResolvedValue(Array.from({ length: count }, () => ({})));
            provider.mockClear();
            initialRecorder.cancel.mockClear();
            currentRecorder.cancel.mockClear();

            await oldFailure();

            expect(harness.recordedDB.findReserveId).not.toHaveBeenCalled();
            expect(harness.model.recordingIndex[reserve.id]).toBe(currentRecorder);
            expect(provider).not.toHaveBeenCalled();
            expect(retryMutation).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitRecordingRetryOver).not.toHaveBeenCalled();
            expect(currentRecorder.cancel).not.toHaveBeenCalled();

            await Promise.all([currentFailure(), currentFailure()]);

            const expectedRetryRecorder = mutationKind === 'update' ? latestRecorder : retryRecorder;
            expect(harness.recordedDB.findReserveId).toHaveBeenCalledOnce();
            expect(provider).toHaveBeenCalledTimes(count < 3 ? 1 : 0);
            expect(expectedRetryRecorder.setTimer).toHaveBeenCalledTimes(count < 3 ? 1 : 0);
            expect(retryMutation).toHaveBeenCalledTimes(count < 3 ? 1 : 0);
            expect(harness.recordingEvent.emitRecordingRetryOver).toHaveBeenCalledTimes(count >= 3 ? 1 : 0);
            expect(currentRecorder.cancel).not.toHaveBeenCalled();
        },
    );

    it.each(['delete', 'update', 'readd'] as const)(
        '[P1][RE-6.1 race] does not retry after the count query observes a concurrent %s',
        async mutationKind => {
            const now = Date.now();
            const initialRecorder = makeRetryRecorder();
            const latestRecorder = makeRetryRecorder();
            const staleRetryRecorder = makeRetryRecorder();
            const provider = vi
                .fn()
                .mockResolvedValueOnce(initialRecorder)
                .mockResolvedValueOnce(latestRecorder)
                .mockResolvedValueOnce(staleRetryRecorder);
            const countQuery = deferred<any[]>();
            const harness = trackManager(
                makeManager({
                    provider,
                    recordedDB: { findReserveId: vi.fn(() => countQuery.promise) },
                }),
            );
            const reserve = makeReserve({ id: 524, startAt: now + 60_000, endAt: now + 120_000 });
            const latestReserve = makeReserve({
                ...reserve,
                name: `query-latest-${mutationKind}`,
                halfWidthName: `query-latest-${mutationKind}`,
            });
            await harness.model.update({ insert: [reserve], isSuppressLog: false });
            const fail = captureFailure(harness, initialRecorder, reserve);

            const failed = fail();
            await waitFor(() => harness.recordedDB.findReserveId.mock.calls.length === 1, 'count query did not start');
            if (mutationKind === 'delete' || mutationKind === 'readd') {
                await harness.model.update({ delete: [reserve], isSuppressLog: false });
            }
            if (mutationKind === 'update') {
                await harness.model.update({ update: [latestReserve], isSuppressLog: false });
            }
            if (mutationKind === 'readd') {
                await harness.model.update({ insert: [latestReserve], isSuppressLog: false });
            }
            provider.mockClear();

            countQuery.resolve([]);
            await failed;

            expect(provider).not.toHaveBeenCalled();
            expect(staleRetryRecorder.setTimer).not.toHaveBeenCalled();
            expect(staleRetryRecorder.startPreparation).not.toHaveBeenCalled();
            if (mutationKind === 'delete') {
                expect(harness.model.hasReserve(reserve.id)).toBe(false);
            } else {
                expect(harness.model.recordingIndex[reserve.id]).toBe(latestRecorder);
            }
        },
    );

    it.each(['delete', 'update', 'readd'] as const)(
        '[P1 review][RE-6.4 race] suppresses retry-over after the count query observes a concurrent %s',
        async mutationKind => {
            const now = Date.now();
            const initialRecorder = makeRetryRecorder();
            const latestRecorder = makeRetryRecorder();
            const provider = vi.fn().mockResolvedValueOnce(initialRecorder).mockResolvedValueOnce(latestRecorder);
            const countQuery = deferred<any[]>();
            const harness = trackManager(
                makeManager({
                    provider,
                    recordedDB: { findReserveId: vi.fn(() => countQuery.promise) },
                }),
            );
            const reserve = makeReserve({ id: 525, startAt: now + 60_000, endAt: now + 120_000 });
            const latestReserve = makeReserve({
                ...reserve,
                name: `retry-over-latest-${mutationKind}`,
                halfWidthName: `retry-over-latest-${mutationKind}`,
            });
            await harness.model.update({ insert: [reserve], isSuppressLog: false });
            const fail = captureFailure(harness, initialRecorder, reserve);

            const failed = fail();
            await waitFor(() => harness.recordedDB.findReserveId.mock.calls.length === 1, 'count query did not start');
            if (mutationKind === 'delete' || mutationKind === 'readd') {
                await harness.model.update({ delete: [reserve], isSuppressLog: false });
            }
            if (mutationKind === 'update') {
                await harness.model.update({ update: [latestReserve], isSuppressLog: false });
            }
            if (mutationKind === 'readd') {
                await harness.model.update({ insert: [latestReserve], isSuppressLog: false });
            }
            provider.mockClear();

            countQuery.resolve(Array.from({ length: 3 }, () => ({})));
            await failed;

            expect(harness.recordedDB.findReserveId).toHaveBeenCalledOnce();
            expect(provider).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitRecordingRetryOver).not.toHaveBeenCalled();
            expect(logger.system.error).not.toHaveBeenCalledWith(`recording retry over: ${reserve.id}`);
            if (mutationKind === 'delete') {
                expect(harness.model.hasReserve(reserve.id)).toBe(false);
            } else {
                expect(harness.model.recordingIndex[reserve.id]).toBe(latestRecorder);
            }
        },
    );

    it.each(['delete', 'update', 'readd'] as const)(
        '[P1][RE-6.2 race] never installs or starts the late retry provider after a concurrent %s',
        async mutationKind => {
            const now = Date.now();
            const initialRecorder = makeRetryRecorder();
            const lateRetryRecorder = makeRetryRecorder();
            const latestRecorder = makeRetryRecorder();
            const retryProvider = deferred<any>();
            const latestProvider = deferred<any>();
            const provider = vi
                .fn()
                .mockResolvedValueOnce(initialRecorder)
                .mockImplementationOnce(() => retryProvider.promise)
                .mockImplementationOnce(() => latestProvider.promise);
            const harness = trackManager(makeManager({ provider }));
            const reserve = makeReserve({ id: 524, startAt: now + 10_000, endAt: now + 60_000 });
            const latestReserve = makeReserve({
                ...reserve,
                name: `latest-${mutationKind}`,
                halfWidthName: `latest-${mutationKind}`,
            });
            await harness.model.update({ insert: [reserve], isSuppressLog: false });
            const failCurrent = captureFailure(harness, initialRecorder, reserve);
            harness.recordedDB.findReserveId.mockResolvedValue([]);
            initialRecorder.startPreparation.mockClear();

            let failedSettled = false;
            const failed = failCurrent().then(() => {
                failedSettled = true;
            });
            await waitFor(() => provider.mock.calls.length === 2, 'retry provider did not start exactly once');

            const mutations: Array<Promise<void>> = [];
            if (mutationKind === 'delete' || mutationKind === 'readd') {
                mutations.push(harness.model.update({ delete: [reserve], isSuppressLog: false }));
            }
            if (mutationKind === 'update') {
                mutations.push(harness.model.update({ update: [latestReserve], isSuppressLog: false }));
            }
            if (mutationKind === 'readd') {
                mutations.push(harness.model.update({ insert: [latestReserve], isSuppressLog: false }));
            }
            await waitFor(() => {
                const current = harness.model.candidateRegistry.get(reserve.id);
                if (mutationKind === 'delete') return current === undefined;
                return current?.reservation.name === latestReserve.name;
            }, `${mutationKind} did not advance the current candidate while retry provider was pending`);

            retryProvider.resolve(lateRetryRecorder);
            await waitFor(
                () => failedSettled || provider.mock.calls.length === 3,
                `${mutationKind} did not settle the stale retry or begin the latest provider`,
            );
            await flushImmediate();
            const lateWasInstalled = harness.model.recordingIndex[reserve.id] === lateRetryRecorder;
            const lateSetTimerCalls = lateRetryRecorder.setTimer.mock.calls.length;
            const lateStartCalls = lateRetryRecorder.startPreparation.mock.calls.length;

            latestProvider.resolve(latestRecorder);
            await Promise.all([failed, ...mutations]);

            expect(lateWasInstalled).toBe(false);
            expect(lateSetTimerCalls).toBe(0);
            expect(lateStartCalls).toBe(0);
            expect(lateRetryRecorder.bindScheduleSession).not.toHaveBeenCalled();
            if (mutationKind === 'delete') {
                expect(harness.model.hasReserve(reserve.id)).toBe(false);
            } else {
                expect(harness.model.recordingIndex[reserve.id]).toBe(latestRecorder);
            }
        },
    );
});
