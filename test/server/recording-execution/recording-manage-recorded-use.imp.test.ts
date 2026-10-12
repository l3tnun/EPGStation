import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, flushImmediate, logger, makeManager, makeReserve } from './_harness';

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

/** recorded-use の event（開始準備・録画開始）も受け取れる manager を作る。 */
const setup = (overrides: Record<string, any> = {}) => {
    const eventCallbacks: Record<string, (...args: any[]) => any> = {};
    const harness = trackManager(
        makeManager({
            ...overrides,
            recordingEvent: {
                setStartPrepRecording: vi.fn((callback: any) => (eventCallbacks.startPrep = callback)),
                setStartRecording: vi.fn((callback: any) => (eventCallbacks.startRec = callback)),
                ...overrides.recordingEvent,
            },
        }),
    );
    return { ...harness, eventCallbacks, usage: harness.model.recordedUseProvider };
};

const ids = (snapshot: any): number[] => [...snapshot.recordedIds].sort((left, right) => left - right);

afterEach(() => {
    for (const manager of activeManagers.splice(0)) manager.scheduleController.stop();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('recording manager recorded-use bookkeeping', () => {
    it('[RE-9.2] a preparation event drops an indeterminate registration of the same recorder', () => {
        const recorder = makeRecorder();
        const { model, eventCallbacks, usage } = setup({ recorder });
        model.recordingIndex[10] = recorder;
        eventCallbacks.startRec(makeReserve({ id: 10 }), { id: -1 });
        expect(usage.getActiveRecordedIds()).toEqual({ status: 'unknown' });

        eventCallbacks.startPrep(makeReserve({ id: 10 }));

        expect(usage.getActiveRecordedIds().status).toBe('known');
        expect(ids(usage.getActiveRecordedIds())).toEqual([]);
    });

    it('[RE-9.2] a preparation event keeps an already active registration', () => {
        const recorder = makeRecorder();
        const { model, eventCallbacks, usage } = setup({ recorder });
        model.recordingIndex[10] = recorder;
        eventCallbacks.startRec(makeReserve({ id: 10 }), { id: 5 });

        eventCallbacks.startPrep(makeReserve({ id: 10 }));

        expect(ids(usage.getActiveRecordedIds())).toEqual([5]);
    });

    it('[RE-9.2] a preparation event for a reservation without a recorder registers nothing', () => {
        const { eventCallbacks, usage } = setup();

        eventCallbacks.startPrep(makeReserve({ id: 99 }));

        expect(ids(usage.getActiveRecordedIds())).toEqual([]);
        expect(usage.getActiveRecordedIds().status).toBe('known');
    });

    it.each([
        ['a negative id', -1],
        ['a fractional id', 1.5],
        ['a numeric string', '7'],
        ['NaN', Number.NaN],
        ['an unsafe integer', 2 ** 60],
        ['undefined', undefined],
    ])('[RE-9.2] treats %s as an unknown recorded use', (_name, recordedId) => {
        const recorder = makeRecorder();
        const { model, eventCallbacks, usage } = setup({ recorder });
        model.recordingIndex[10] = recorder;

        eventCallbacks.startRec(makeReserve({ id: 10 }), { id: recordedId });

        expect(usage.getActiveRecordedIds()).toEqual({ status: 'unknown' });
    });

    it.each([0, 7])('[RE-9.2] registers recorded id %i as an active use', recordedId => {
        const recorder = makeRecorder();
        const { model, eventCallbacks, usage } = setup({ recorder });
        model.recordingIndex[10] = recorder;

        eventCallbacks.startRec(makeReserve({ id: 10 }), { id: recordedId });

        expect(ids(usage.getActiveRecordedIds())).toEqual([recordedId]);
    });

    it('[RE-9.2] replaces the indeterminate registration of a recorder when its recorded id becomes known', () => {
        const recorder = makeRecorder();
        const { model, eventCallbacks, usage } = setup({ recorder });
        model.recordingIndex[12] = recorder;
        eventCallbacks.startRec(makeReserve({ id: 12 }), { id: -1 });

        eventCallbacks.startRec(makeReserve({ id: 12 }), { id: 4 });

        expect(ids(usage.getActiveRecordedIds())).toEqual([4]);
    });

    it('[RE-9.2] releases the placeholder registered before the recorder existed once the recorded id is known', () => {
        const recorder = makeRecorder();
        const { model, eventCallbacks, usage } = setup({ recorder });
        eventCallbacks.startRec(makeReserve({ id: 11 }), { id: 3 });
        expect(usage.getActiveRecordedIds()).toEqual({ status: 'unknown' });
        model.recordingIndex[11] = recorder;

        eventCallbacks.startRec(makeReserve({ id: 11 }), { id: 3 });

        expect(ids(usage.getActiveRecordedIds())).toEqual([3]);
        expect(model.unknownRecordedUseSessions.size).toBe(0);
    });

    it('[RE-9.2] reuses one placeholder for repeated events and releases it when the recording finishes', () => {
        const { model, eventCallbacks, callbacks, usage } = setup();
        eventCallbacks.startRec(makeReserve({ id: 13 }), { id: 3 });
        eventCallbacks.startRec(makeReserve({ id: 13 }), { id: 3 });
        expect(model.unknownRecordedUseSessions.size).toBe(1);

        callbacks.finish(makeReserve({ id: 13 }), { id: 3 });

        expect(usage.getActiveRecordedIds().status).toBe('known');
        expect(ids(usage.getActiveRecordedIds())).toEqual([]);
    });

    it('[RE-9.2] keeps the use until the normal recording terminal settles, then releases it', async () => {
        const terminal = deferred<void>();
        const recorder = makeRecorder({ whenNormalRecordingTerminal: vi.fn(() => terminal.promise) });
        const { model, eventCallbacks, callbacks, usage } = setup({ recorder });
        model.recordingIndex[14] = recorder;
        eventCallbacks.startRec(makeReserve({ id: 14 }), { id: 8 });
        expect(model.normalRecordedUseTerminals.size).toBe(1);

        callbacks.finish(makeReserve({ id: 14 }), { id: 8 });

        expect(model.hasReserve(14)).toBe(false);
        expect(ids(usage.getActiveRecordedIds())).toEqual([8]);
        terminal.resolve();
        await flushImmediate();
        expect(ids(usage.getActiveRecordedIds())).toEqual([]);
        expect(model.normalRecordedUseTerminals.size).toBe(0);
        expect(model.activeRecordedUseSessions.size).toBe(0);
    });

    it('[RE-9.2] releases the use at the finish event when the recorder has no normal terminal to wait for', () => {
        const recorder = makeRecorder();
        const { model, eventCallbacks, callbacks, usage } = setup({ recorder });
        model.recordingIndex[14] = recorder;
        eventCallbacks.startRec(makeReserve({ id: 14 }), { id: 8 });

        callbacks.finish(makeReserve({ id: 14 }), { id: 8 });

        expect(ids(usage.getActiveRecordedIds())).toEqual([]);
    });

    it('[RE-9.2] a cancelled preparation releases only the uses of its own reservation', () => {
        const terminal = deferred<void>();
        const first = makeRecorder({ whenNormalRecordingTerminal: vi.fn(() => terminal.promise) });
        const second = makeRecorder();
        const { model, eventCallbacks, callbacks, usage } = setup();
        model.recordingIndex[20] = first;
        model.recordingIndex[21] = second;
        eventCallbacks.startRec(makeReserve({ id: 20 }), { id: 1 });
        eventCallbacks.startRec(makeReserve({ id: 21 }), { id: 2 });
        eventCallbacks.startRec(makeReserve({ id: 22 }), { id: 3 });
        expect(model.normalRecordedUseTerminals.size).toBe(1);

        callbacks.cancelPrep(makeReserve({ id: 20 }));

        expect(model.normalRecordedUseTerminals.size).toBe(0);
        expect(model.hasReserve(20)).toBe(false);
        expect(usage.getActiveRecordedIds()).toEqual({ status: 'unknown' });
        callbacks.cancelPrep(makeReserve({ id: 22 }));
        expect(ids(usage.getActiveRecordedIds())).toEqual([2]);
    });

    it('[RE-9.2] a failed preparation releases the use of its reservation', () => {
        const recorder = makeRecorder();
        const { model, eventCallbacks, callbacks, usage } = setup({ recorder });
        model.recordingIndex[23] = recorder;
        eventCallbacks.startRec(makeReserve({ id: 23 }), { id: 6 });

        callbacks.prepFailed(makeReserve({ id: 23 }));

        expect(ids(usage.getActiveRecordedIds())).toEqual([]);
    });
});

describe('recording manager failure identity checks', () => {
    const insertAndCapture = async (reserveId: number) => {
        const now = Date.now();
        const recorder = makeRecorder();
        const replacement = makeRecorder();
        const provider = vi.fn().mockResolvedValueOnce(recorder).mockResolvedValue(replacement);
        const harness = trackManager(makeManager({ provider }));
        const reserve = makeReserve({ id: reserveId, startAt: now + 60_000, endAt: now + 120_000 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        const identity = recorder.bindScheduleSession.mock.calls.at(-1)?.[0];
        expect(identity).toBeDefined();
        harness.recordedDB.findReserveId.mockResolvedValue([]);
        return { harness, reserve, identity, replacement };
    };

    it('[RE-6.3] a current failure is processed', async () => {
        const { harness, reserve, identity } = await insertAndCapture(301);

        await harness.callbacks.failed(reserve, null, identity);

        expect(harness.recordedDB.findReserveId).toHaveBeenCalledExactlyOnceWith(301);
    });

    it('[RE-6.3] a retried recording is registered with log output enabled', async () => {
        const { harness, reserve, identity, replacement } = await insertAndCapture(302);

        await harness.callbacks.failed(reserve, null, identity);

        expect(replacement.setTimer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 302 }), false);
    });

    it.each([
        ['an older generation', (identity: any) => ({ ...identity, generation: identity.generation + 1n })],
        ['another session token', (identity: any) => ({ ...identity, sessionToken: identity.sessionToken + 1n })],
        ['another reservation object', (identity: any) => ({ ...identity, reservation: { ...identity.reservation } })],
    ])('[RE-6.3] ignores a failure carrying %s', async (_name, alter) => {
        const { harness, reserve, identity } = await insertAndCapture(303);

        await harness.callbacks.failed(reserve, null, alter(identity));

        expect(harness.recordedDB.findReserveId).not.toHaveBeenCalled();
    });

    it('[RE-6.3] ignores a failure whose candidate generation has moved on', async () => {
        const { harness, reserve, identity } = await insertAndCapture(304);
        const candidate = harness.model.candidateRegistry.get(304);
        vi.spyOn(harness.model.candidateRegistry, 'get').mockReturnValue({
            ...candidate,
            generation: candidate.generation + 1n,
        });

        await harness.callbacks.failed(reserve, null, identity);

        expect(harness.recordedDB.findReserveId).not.toHaveBeenCalled();
    });

    it('[RE-6.3] ignores a failure whose candidate has been removed without throwing', async () => {
        const { harness, reserve, identity } = await insertAndCapture(305);
        vi.spyOn(harness.model.candidateRegistry, 'get').mockReturnValue(undefined);

        await expect(harness.callbacks.failed(reserve, null, identity)).resolves.toBeUndefined();

        expect(harness.recordedDB.findReserveId).not.toHaveBeenCalled();
    });

    it('[RE-6.3] ignores a failure reported for another reservation', async () => {
        const { harness, identity } = await insertAndCapture(306);

        await harness.callbacks.failed(makeReserve({ id: 999 }), null, identity);

        expect(harness.recordedDB.findReserveId).not.toHaveBeenCalled();
    });

    it.each(['NotStarted', 'Failed'])('[RE-6.3] ignores a failure while the startup state is %s', async state => {
        const { harness, reserve, identity } = await insertAndCapture(307);
        harness.model.candidateStartupState = state;

        await harness.callbacks.failed(reserve, null, identity);

        expect(harness.recordedDB.findReserveId).not.toHaveBeenCalled();
    });

    it('[RE-6.3] queues failures that arrive during startup and processes them with their identity afterwards', async () => {
        const { harness } = await insertAndCapture(308);
        const process = vi.spyOn(harness.model, 'processRecordingFailure').mockResolvedValue(undefined);
        const reserve = makeReserve({ id: 308 });
        const identity = { reservationId: 308 };
        harness.model.candidateStartupState = 'Starting';

        await harness.callbacks.failed(reserve, null, identity);
        expect(process).not.toHaveBeenCalled();
        await harness.model.flushPendingStartupRecordingFailures();

        expect(process).toHaveBeenCalledExactlyOnceWith(reserve, identity);
        process.mockClear();
        await harness.model.flushPendingStartupRecordingFailures();
        expect(process).not.toHaveBeenCalled();
    });

    it('[RE-6.3] logs a failure that cannot be processed after startup and continues with the next one', async () => {
        const { harness } = await insertAndCapture(309);
        const failure = new Error('synthetic queued failure');
        const process = vi
            .spyOn(harness.model, 'processRecordingFailure')
            .mockRejectedValueOnce(failure)
            .mockResolvedValue(undefined);
        harness.model.candidateStartupState = 'Starting';
        await harness.callbacks.failed(makeReserve({ id: 1 }), null, undefined);
        await harness.callbacks.failed(makeReserve({ id: 2 }), null, undefined);

        await harness.model.flushPendingStartupRecordingFailures();

        expect(process).toHaveBeenCalledTimes(2);
        expect(logger.system.error).toHaveBeenCalledWith(failure);
    });
});

describe('recording manager startup', () => {
    const futureReserve = (id: number, overrides: Record<string, any> = {}) =>
        makeReserve({ id, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000, ...overrides });

    it('[RE-9.1] reads only recordings in progress together with their video files', async () => {
        const findAll = vi.fn(async () => [[], 0]);
        const { model, recordedDB } = setup({
            recordedDB: { findAll, findReserveId: vi.fn(async () => []), findId: vi.fn(), removeRecording: vi.fn() },
        });

        await model.cleanup();

        expect(recordedDB.findAll).toHaveBeenCalledExactlyOnceWith(
            { isHalfWidth: false, isRecording: true },
            { isNeedVideoFiles: true, isNeedThumbnails: false, isNeedsDropLog: false, isNeedTags: false },
        );
    });

    it.each([
        ['a temporary file with a temporary directory configured', 'tmp', true, true],
        ['a temporary file without a temporary directory', 'tmp', false, false],
        ['a regular file with a temporary directory configured', 'synthetic-root', true, false],
    ])('[RE-9.1] startup tidy of %s', async (_name, directoryName, hasTmp, moves) => {
        const recordedDB = {
            findAll: vi.fn(async () => [[{ id: 1, reserveId: 5, videoFiles: [{ id: 7, parentDirectoryName: directoryName }] }], 1]),
            removeRecording: vi.fn(async () => undefined),
            findId: vi.fn(async () => null),
            findReserveId: vi.fn(async () => []),
        };
        const reserveDB = { findId: vi.fn(async () => makeReserve({ id: 5 })) };
        const { model, recordingUtil } = setup({ recordedDB, reserveDB });
        model.config = hasTmp ? { recordedTmp: '/synthetic-tmp' } : {};

        await model.cleanup();

        expect(recordingUtil.movingFromTmp).toHaveBeenCalledTimes(moves ? 1 : 0);
        expect(recordingUtil.updateVideoFileSize).toHaveBeenCalledExactlyOnceWith(7);
    });

    it('[RE-9.1] starts with the not-skipped, not-overlapped, unfinished and not removed reservations only', async () => {
        const normal = futureReserve(401);
        const removed = futureReserve(405);
        const reserveDB = {
            findId: vi.fn(),
            findLists: vi.fn(async () => [
                normal,
                futureReserve(402, { isSkip: true }),
                futureReserve(403, { isOverlap: true }),
                futureReserve(404, { startAt: Date.now() - 120_000, endAt: Date.now() - 60_000 }),
                removed,
            ]),
        };
        const { model } = setup({ startupCompleted: false, reserveDB });
        vi.spyOn(model.scheduleController, 'start').mockResolvedValue(undefined);
        model.startupRemovedReservationIds.add(removed.id);

        await model.rebuildCandidatesAndStart();

        expect(model.candidateRegistry.list().map((candidate: any) => candidate.reservationId)).toEqual([normal.id]);
        expect(model.candidateStartupState).toBe('Started');
        expect(logger.system.error).not.toHaveBeenCalled();
    });

    it('[RE-9.1] applies reservation changes that arrive while the schedule controller starts', async () => {
        const start = deferred<void>();
        const reserveDB = { findId: vi.fn(), findLists: vi.fn(async () => []) };
        const { model } = setup({ startupCompleted: false, reserveDB });
        vi.spyOn(model.scheduleController, 'start').mockReturnValue(start.promise);
        const late = futureReserve(410);

        const starting = model.rebuildCandidatesAndStart();
        await flushImmediate();
        const accept = vi.spyOn(model.scheduleController, 'acceptMutation');
        model.acceptMutation({ insert: [late], isSuppressLog: false });
        expect(accept).not.toHaveBeenCalled();
        start.resolve();
        await starting;

        expect(accept).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ insert: [late] }));
    });

    it('[RE-9.1] cleans the half-built startup state when the schedule controller fails to start', async () => {
        const failure = new Error('synthetic start failure');
        const recorder = makeRecorder();
        const withRecorder = futureReserve(31);
        const withoutRecorder = futureReserve(32);
        const reserveDB = { findId: vi.fn(), findLists: vi.fn(async () => [withRecorder, withoutRecorder]) };
        const { model } = setup({ startupCompleted: false, reserveDB, recorder });
        vi.spyOn(model.scheduleController, 'start').mockRejectedValue(failure);
        model.recordingIndex[31] = recorder;
        model.recordingSessionTokens.set(31, 1n);
        model.recordingFailureClaims.add(31);

        await expect(model.rebuildCandidatesAndStart()).rejects.toBe(failure);

        expect(model.candidateStartupState).toBe('Failed');
        expect(model.candidateRegistry.get(31)).toBeUndefined();
        expect(model.candidateRegistry.get(32)).toBeUndefined();
        expect(model.recordingIndex).toEqual({});
        expect(model.recordingSessionTokens.size).toBe(0);
        expect(model.recordingFailureClaims.size).toBe(0);
        expect(recorder.cancel).toHaveBeenCalledExactlyOnceWith(false);
    });

    it('[RE-9.1] leaves running recordings alone when the startup tidy fails before the controller starts', async () => {
        const failure = new Error('synthetic tidy failure');
        const recorder = makeRecorder();
        const recordedDB = {
            findAll: vi.fn(async () => Promise.reject(failure)),
            findReserveId: vi.fn(),
            findId: vi.fn(),
            removeRecording: vi.fn(),
        };
        const { model } = setup({ startupCompleted: false, recordedDB, recorder });
        model.recordingIndex[41] = recorder;

        await expect(model.cleanup()).rejects.toBe(failure);

        expect(model.candidateStartupState).toBe('Failed');
        expect(recorder.cancel).not.toHaveBeenCalled();
        expect(model.recordingIndex[41]).toBe(recorder);
    });

    it('[RE-9.1] hands reservation changes straight to the controller when they cannot be snapshotted', () => {
        const { model } = setup({ startupCompleted: false });
        model.candidateStartupState = 'Starting';
        const accept = vi.spyOn(model.scheduleController, 'acceptMutation');

        const invalidRow = { insert: [{ id: 'not-a-number' }], isSuppressLog: false };
        model.acceptMutation(invalidRow);
        expect(accept).toHaveBeenCalledExactlyOnceWith(invalidRow);
        accept.mockClear();

        const unspecifiedLogging = { insert: [futureReserve(420)] };
        model.acceptMutation(unspecifiedLogging);
        expect(accept).toHaveBeenCalledExactlyOnceWith(unspecifiedLogging);
        accept.mockClear();

        model.acceptMutation({ insert: [futureReserve(421)], isSuppressLog: false });
        expect(accept).not.toHaveBeenCalled();
        expect(model.pendingStartupMutations).toHaveLength(1);
    });

    it('[RE-9.1] starts the schedule controller once however many changes arrive', () => {
        const { model } = setup();
        const start = vi.spyOn(model.scheduleController, 'start').mockResolvedValue(undefined);

        model.acceptMutation({ insert: [], isSuppressLog: false });
        model.acceptMutation({ insert: [], isSuppressLog: false });

        expect(start).toHaveBeenCalledOnce();
    });

    it('[RE-9.1] resets recorder timers only after startup has finished', () => {
        const recorder = makeRecorder();
        const { model } = setup({ startupCompleted: false, recorder });
        model.recordingIndex[51] = recorder;

        model.resetTimer();
        expect(recorder.resetTimer).not.toHaveBeenCalled();

        model.candidateStartupState = 'Started';
        vi.spyOn(model.scheduleController, 'start').mockResolvedValue(undefined);
        model.resetTimer();
        expect(recorder.resetTimer).toHaveBeenCalledOnce();
    });
});

describe('recording manager session reflection', () => {
    const inserted = async (reserveId: number, overrides: Record<string, any> = {}) => {
        const now = Date.now();
        const recorder = makeRecorder();
        const provider = vi.fn(async () => recorder);
        const harness = trackManager(makeManager({ provider, recorder }));
        const reserve = makeReserve({ id: reserveId, startAt: now + 60_000, endAt: now + 120_000, ...overrides });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        const session = harness.model.scheduleController.getSessionSnapshot(reserveId);
        recorder.update.mockClear();
        recorder.setTimer.mockClear();
        provider.mockClear();
        return { harness, model: harness.model, recorder, reserve, sessionBinding: session };
    };
    const mutationOf = (reserve: any, session: any, overrides: Record<string, any> = {}) => ({
        action: 'update',
        reservationId: reserve.id,
        reservation: reserve,
        generation: session.generation,
        sessionToken: session.sessionToken,
        isSuppressLog: false,
        ...overrides,
    });

    it('[RE-1.7] keeps applying changes when a deletion in progress belongs to another recorder', async () => {
        const { model, recorder, reserve } = await inserted(501);
        model.deletionStops.set(501, {
            recorder: makeRecorder(),
            request: Promise.resolve(),
            terminal: Promise.resolve(),
        });

        await model.update({ update: [{ ...reserve, endAt: reserve.endAt + 30_000 }], isSuppressLog: false });

        expect(recorder.update).toHaveBeenCalledOnce();
    });

    it('[RE-1.7] ignores a change addressed to a replaced session', async () => {
        const { harness, model, recorder, reserve, sessionBinding: session } = await inserted(502);
        const stale = mutationOf(reserve, session, { sessionToken: session.sessionToken + 1n });

        await model.applyScheduleMutation(stale);
        delete model.recordingIndex[502];
        await model.applyScheduleMutation(stale);

        expect(recorder.update).not.toHaveBeenCalled();
        expect(harness.provider).not.toHaveBeenCalled();
    });

    it('[RE-1.7] ignores a change when the candidate no longer exists', async () => {
        const { harness, model, recorder, reserve, sessionBinding: session } = await inserted(503);
        model.candidateRegistry.remove(503);

        await model.applyScheduleMutation(mutationOf(reserve, session));
        delete model.recordingIndex[503];
        await model.applyScheduleMutation(mutationOf(reserve, session));

        expect(recorder.update).not.toHaveBeenCalled();
        expect(harness.provider).not.toHaveBeenCalled();
    });

    it('[RE-1.7] ignores a change when the session no longer exists', async () => {
        const { harness, model, recorder, reserve, sessionBinding: session } = await inserted(504);
        vi.spyOn(model.scheduleController, 'getSessionSnapshot').mockReturnValue(undefined);

        await model.applyScheduleMutation(mutationOf(reserve, session));
        delete model.recordingIndex[504];
        await model.applyScheduleMutation(mutationOf(reserve, session));

        expect(recorder.update).not.toHaveBeenCalled();
        expect(harness.provider).not.toHaveBeenCalled();
    });

    it('[RE-1.7] ignores a change when the recorder in the index belongs to another session', async () => {
        const { model, recorder, reserve, sessionBinding: session } = await inserted(505);
        model.recordingSessionTokens.set(505, session.sessionToken + 1n);

        await model.applyScheduleMutation(mutationOf(reserve, session));
        expect(recorder.update).not.toHaveBeenCalled();

        model.recordingSessionTokens.delete(505);
        await model.applyScheduleMutation(mutationOf(reserve, session));
        expect(recorder.update).toHaveBeenCalledOnce();
    });

    it('[RE-1.7] abandons the new recorder when the session changed while the provider was resolving', async () => {
        const { harness, model, recorder, reserve, sessionBinding: session } = await inserted(506);
        delete model.recordingIndex[506];
        model.recordingSessionTokens.delete(506);
        const real = model.scheduleController.getSessionSnapshot.bind(model.scheduleController);
        let calls = 0;
        vi.spyOn(model.scheduleController, 'getSessionSnapshot').mockImplementation((id: number) => {
            calls += 1;
            const snapshot = real(id);
            return calls >= 2 ? { ...snapshot, sessionToken: snapshot.sessionToken + 1n } : snapshot;
        });

        await model.applyScheduleMutation(mutationOf(reserve, session));

        expect(harness.provider).toHaveBeenCalledOnce();
        expect(recorder.setTimer).not.toHaveBeenCalled();
        expect(model.recordingIndex[506]).toBeUndefined();
    });

    it('[RE-2.6] registers the end of a time-specified reservation with the configured margin', async () => {
        const { model, recorder, reserve, sessionBinding: session } = await inserted(507, {
            programId: null,
            isTimeSpecified: true,
        });
        model.config = { timeSpecifiedEndMargin: 5, recordedTmp: '/synthetic-tmp' };
        const register = vi.spyOn(model.scheduleController, 'registerTimeSpecifiedEnd');

        await model.applyScheduleMutation(mutationOf(reserve, session));

        expect(register).toHaveBeenCalledExactlyOnceWith({
            reservationId: 507,
            generation: session.generation,
            sessionToken: session.sessionToken,
            dueAt: reserve.endAt + 5_000,
        });
        expect(recorder.update).toHaveBeenCalledOnce();
    });

    it('[RE-2.6] does not register an end time for a program reservation', async () => {
        const { model, reserve, sessionBinding: session } = await inserted(508);
        const register = vi.spyOn(model.scheduleController, 'registerTimeSpecifiedEnd');

        await model.applyScheduleMutation(mutationOf(reserve, session));

        expect(register).not.toHaveBeenCalled();
    });

    it('[RE-1.7] keeps a recorder of a newer session when an older removal arrives', async () => {
        const { model, recorder, reserve, sessionBinding: session } = await inserted(509);
        const removal = (overrides: Record<string, any>) => ({
            ...mutationOf(reserve, session, { action: 'remove' }),
            ...overrides,
        });
        model.recordingSessionTokens.set(509, 10n);

        await model.applyScheduleRemoval(removal({ previousSessionToken: 11n }));
        expect(recorder.cancel).not.toHaveBeenCalled();
        expect(model.recordingIndex[509]).toBe(recorder);

        await model.applyScheduleRemoval(removal({ previousSessionToken: undefined }));
        expect(recorder.cancel).toHaveBeenCalledExactlyOnceWith(false);
    });

    it('[RE-1.7] removes the recorder of the same session and of an unrecorded token', async () => {
        const { model, recorder, reserve, sessionBinding: session } = await inserted(510);
        model.recordingSessionTokens.delete(510);

        await model.applyScheduleRemoval({ ...mutationOf(reserve, session, { action: 'remove' }), previousSessionToken: 11n });

        expect(recorder.cancel).toHaveBeenCalledExactlyOnceWith(false);
        expect(model.recordingIndex[510]).toBeUndefined();
    });

    it('[RE-1.7] the session binding handed to a recorder only answers for its own session token', async () => {
        const { model, recorder, sessionBinding: session } = await inserted(511);
        const binding = recorder.bindScheduleSession.mock.calls.at(-1)?.[0];
        expect(binding.isCurrent(session.phase)).toBe(true);
        vi.spyOn(model.scheduleController, 'getSessionSnapshot').mockReturnValue({
            ...session,
            sessionToken: session.sessionToken + 1n,
        });

        expect(binding.isCurrent(session.phase)).toBe(false);
    });

    it('[RE-1.7] the session binding requeues a cancelled session as waiting', async () => {
        const { model, recorder, sessionBinding: session } = await inserted(512);
        const binding = recorder.bindScheduleSession.mock.calls.at(-1)?.[0];
        const transition = vi.spyOn(model.scheduleController, 'tryTransitionSession').mockReturnValue(true);
        const wake = vi.spyOn(model.scheduleController, 'wake');

        expect(binding.requeueAfterReschedule()).toBe(true);

        expect(transition).toHaveBeenCalledExactlyOnceWith(
            512,
            session.generation,
            session.sessionToken,
            'Cancelled',
            'Waiting',
        );
        expect(wake).toHaveBeenCalledOnce();
    });
});
