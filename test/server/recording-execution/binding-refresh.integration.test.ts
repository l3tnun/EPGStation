import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    deferred,
    flushImmediate,
    logger,
    makeRecorded,
    makeRecorder,
    makeReserve,
    RecordingEvent,
    RecordingManageModel,
} from './_harness';

const activeManagers: any[] = [];

const replacementRecorder = () => ({
    bindScheduleSession: vi.fn(),
    cancel: vi.fn(async () => undefined),
    resetTimer: vi.fn(() => true),
    setTimer: vi.fn(() => true),
    startPreparation: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
});

const createManager = ({
    event,
    provider,
    recordedDB = {},
}: {
    event: any;
    provider: ReturnType<typeof vi.fn>;
    recordedDB?: Record<string, any>;
}) => {
    const manager = new RecordingManageModel(
        { getLogger: () => logger },
        { getConfig: () => ({ recordedTmp: '/synthetic-tmp', timeSpecifiedEndMargin: 0 }) },
        provider,
        event,
        { setTuner: vi.fn() },
        {
            findAll: vi.fn(async () => [[], 0]),
            findId: vi.fn(async () => null),
            findReserveId: vi.fn(async () => []),
            ...recordedDB,
        },
        { findId: vi.fn(async () => null) },
        { movingFromTmp: vi.fn(), updateVideoFileSize: vi.fn().mockResolvedValue(undefined) },
    );
    // `RecordingManageModel.update()` returns immediately unless the candidate startup has
    // completed (`RecordingManageModel.ts:593`), so a manager that never reached `Started` accepts
    // the mutation but never runs the schedule -- no recorder is provided and nothing is created.
    // ipc-event.integration.test.ts:20-22 marks the same state for the same reason; this file was
    // missing that step, which is why all seven cases here failed at the first `create` assertion
    // and then cascaded into `undefined.generation`.
    (manager as any).candidateStartupState = 'Started';
    activeManagers.push(manager);
    return manager;
};

const settleMicrotasks = async (turns = 30): Promise<void> => {
    for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
};

const waitFor = async (predicate: () => boolean, diagnostic: string): Promise<void> => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        if (predicate()) return;
        await flushImmediate();
    }
    throw new Error(diagnostic);
};

afterEach(() => {
    for (const manager of activeManagers.splice(0)) manager.scheduleController.stop();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('recording binding refresh composition', () => {
    it('rebinds a deferred preparation failure to the latest generation of the same session', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const acquisition = deferred<PassThrough>();
        const event = new RecordingEvent({ getLogger: () => logger });
        const recorder = makeRecorder({
            recordingEvent: event,
            streamCreator: { create: vi.fn(() => acquisition.promise), changeEndAt: vi.fn() },
        });
        const provider = vi.fn(async () => recorder.model);
        const manager = createManager({ event, provider });
        const reserve = makeReserve({ id: 601, startAt: 1_015_000, endAt: 1_060_000 });

        await manager.update({ insert: [reserve], isSuppressLog: false });
        await settleMicrotasks();
        expect(recorder.streamCreator.create).toHaveBeenCalledOnce();
        const preparing = manager.scheduleController.getSessionSnapshot(reserve.id);
        expect(preparing).toMatchObject({ phase: 'Preparing' });

        const latestReserve = makeReserve({ ...reserve, name: 'latest-generation' });
        await manager.update({ update: [latestReserve], isSuppressLog: false });
        const latestPreparing = manager.scheduleController.getSessionSnapshot(reserve.id);
        expect(latestPreparing.generation).not.toBe(preparing.generation);
        expect(latestPreparing.sessionToken).toBe(preparing.sessionToken);
        expect(latestPreparing.phase).toBe('Preparing');

        acquisition.reject(new Error('synthetic deferred preparation failure'));
        await settleMicrotasks();

        expect(manager.scheduleController.getSessionSnapshot(reserve.id)).toMatchObject({
            generation: latestPreparing.generation,
            phase: 'RetryWaiting',
            sessionToken: latestPreparing.sessionToken,
        });
        expect(recorder.model.retryAttempt).toBe(1);
        expect(recorder.model.retryTimerId).not.toBeNull();

        await manager.cancel(reserve.id, false);
    });

    it('publishes the latest same-session identity from a real old-capture stream terminal and retries it', async () => {
        const event = new RecordingEvent({ getLogger: () => logger });
        const emitFailure = vi.spyOn(event, 'emitRecordingFailed');
        const recorder = makeRecorder({ recordingEvent: event });
        const replacement = replacementRecorder();
        const provider = vi.fn().mockResolvedValueOnce(recorder.model).mockResolvedValueOnce(replacement);
        const manager = createManager({ event, provider });
        const reserve = makeReserve({ id: 602, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });

        await manager.update({ insert: [reserve], isSuppressLog: false });
        const waiting = manager.scheduleController.getSessionSnapshot(reserve.id);
        expect(
            manager.scheduleController.tryTransitionSession(
                reserve.id,
                waiting.generation,
                waiting.sessionToken,
                'Waiting',
                'Recording',
            ),
        ).toBe(true);
        const recording = manager.scheduleController.getSessionSnapshot(reserve.id);
        manager.bindRecorder(recorder.model, recording);
        recorder.model.reserve = reserve;
        recorder.model.isRecording = true;
        recorder.model.recEnd = vi.fn(async () => undefined);
        const stream = new PassThrough();
        recorder.model.stream = stream;
        const oldBinding = recorder.model.scheduleBinding;
        await recorder.model.setEndProcess(stream, oldBinding);

        const latestReserve = makeReserve({ ...reserve, name: 'latest-recording-generation' });
        await manager.update({ update: [latestReserve], isSuppressLog: false });
        const latest = manager.scheduleController.getSessionSnapshot(reserve.id);
        const latestBinding = recorder.model.scheduleBinding;
        expect(latest.generation).not.toBe(recording.generation);
        expect(latest.sessionToken).toBe(recording.sessionToken);
        expect(latest.phase).toBe('Recording');

        const failure = new Error('synthetic old-capture stream failure');
        stream.destroy(failure);
        await waitFor(() => emitFailure.mock.calls.length === 1, 'recording failure was not published');
        await waitFor(() => provider.mock.calls.length === 2, 'latest recording failure was not retried');

        expect(emitFailure).toHaveBeenCalledWith(latestBinding.reservation, null, latestBinding);
        expect(latestBinding).toMatchObject({
            generation: latest.generation,
            sessionToken: latest.sessionToken,
        });
        expect(manager.recordingIndex[reserve.id]).toBe(replacement);
    });

    it.each([
        ['recEnd', 'Completed'],
        ['recorded lookup', 'Finishing'],
    ] as const)(
        'refreshes the emitted same-session identity after a generation update during deferred %s',
        async (deferredStage, expectedPhase) => {
            const recEndGate = deferred<void>();
            const recordedLookupGate = deferred<any>();
            const event = new RecordingEvent({ getLogger: () => logger });
            const emitFailure = vi.spyOn(event, 'emitRecordingFailed');
            const recorder = makeRecorder({ recordingEvent: event });
            const replacement = replacementRecorder();
            const provider = vi.fn().mockResolvedValueOnce(recorder.model).mockResolvedValueOnce(replacement);
            const manager = createManager({ event, provider });
            const reserve = makeReserve({ id: 605, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });
            const recorded = makeRecorded({ id: 21, reserveId: reserve.id });
            let phaseAtPublication: string | undefined;
            event.setRecordingFailed(() => {
                phaseAtPublication = manager.scheduleController.getSessionSnapshot(reserve.id)?.phase;
            });

            await manager.update({ insert: [reserve], isSuppressLog: false });
            const waiting = manager.scheduleController.getSessionSnapshot(reserve.id);
            expect(
                manager.scheduleController.tryTransitionSession(
                    reserve.id,
                    waiting.generation,
                    waiting.sessionToken,
                    'Waiting',
                    'Recording',
                ),
            ).toBe(true);
            const recording = manager.scheduleController.getSessionSnapshot(reserve.id);
            manager.bindRecorder(recorder.model, recording);
            recorder.model.reserve = reserve;
            recorder.model.isRecording = true;
            recorder.model.recordedId = deferredStage === 'recorded lookup' ? recorded.id : null;
            recorder.model.recEnd = vi.fn(async () => {
                if (deferredStage === 'recEnd') await recEndGate.promise;
                const currentBinding = recorder.model.scheduleBinding;
                expect(currentBinding.tryTransition('Recording', 'Finishing')).toBe(true);
                if (deferredStage === 'recEnd') {
                    expect(currentBinding.tryTransition('Finishing', 'Completed')).toBe(true);
                }
            });
            if (deferredStage === 'recorded lookup') {
                recorder.recordedDB.findId.mockImplementationOnce(() => recordedLookupGate.promise);
            }
            const stream = new PassThrough();
            recorder.model.stream = stream;
            await recorder.model.setEndProcess(stream, recorder.model.scheduleBinding);

            stream.destroy(new Error(`synthetic failure during ${deferredStage}`));
            if (deferredStage === 'recEnd') {
                await waitFor(() => recorder.model.recEnd.mock.calls.length === 1, 'recEnd was not entered');
            } else {
                await waitFor(
                    () => recorder.recordedDB.findId.mock.calls.length === 1,
                    'recorded lookup was not entered',
                );
            }

            const latestReserve = makeReserve({ ...reserve, name: `latest-during-${deferredStage}` });
            await manager.update({ update: [latestReserve], isSuppressLog: false });
            const latest = manager.scheduleController.getSessionSnapshot(reserve.id);
            const latestBinding = recorder.model.scheduleBinding;
            expect(latest).toMatchObject({
                phase: deferredStage === 'recEnd' ? 'Recording' : 'Finishing',
                sessionToken: recording.sessionToken,
            });
            expect(latest.generation).not.toBe(recording.generation);

            if (deferredStage === 'recEnd') {
                recEndGate.resolve(undefined);
            } else {
                recordedLookupGate.resolve(recorded);
            }
            await waitFor(() => emitFailure.mock.calls.length === 1, 'recording failure was not published');
            await waitFor(() => provider.mock.calls.length === 2, 'latest recording failure was not retried');

            expect(phaseAtPublication).toBe(expectedPhase);
            expect(emitFailure).toHaveBeenCalledOnce();
            expect(emitFailure).toHaveBeenCalledWith(
                latestBinding.reservation,
                deferredStage === 'recorded lookup' ? recorded : null,
                latestBinding,
            );
            expect(latestBinding).toMatchObject({
                generation: latest.generation,
                sessionToken: latest.sessionToken,
            });
            expect(provider).toHaveBeenCalledTimes(2);
            expect(manager.recordingIndex[reserve.id]).toBe(replacement);
        },
    );

    it('suppresses a failure whose session is replaced while the final recorded lookup is pending', async () => {
        const recordedLookupGate = deferred<any>();
        const event = new RecordingEvent({ getLogger: () => logger });
        const emitFailure = vi.spyOn(event, 'emitRecordingFailed');
        const recorder = makeRecorder({ recordingEvent: event });
        const replacement = replacementRecorder();
        const provider = vi.fn().mockResolvedValueOnce(recorder.model).mockResolvedValueOnce(replacement);
        const manager = createManager({ event, provider });
        const reserve = makeReserve({ id: 606, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });
        const recorded = makeRecorded({ id: 22, reserveId: reserve.id });

        await manager.update({ insert: [reserve], isSuppressLog: false });
        const waiting = manager.scheduleController.getSessionSnapshot(reserve.id);
        expect(
            manager.scheduleController.tryTransitionSession(
                reserve.id,
                waiting.generation,
                waiting.sessionToken,
                'Waiting',
                'Recording',
            ),
        ).toBe(true);
        const recording = manager.scheduleController.getSessionSnapshot(reserve.id);
        manager.bindRecorder(recorder.model, recording);
        recorder.model.reserve = reserve;
        recorder.model.isRecording = true;
        recorder.model.recordedId = recorded.id;
        recorder.model.recEnd = vi.fn(async () => {
            expect(recorder.model.scheduleBinding.tryTransition('Recording', 'Finishing')).toBe(true);
        });
        recorder.recordedDB.findId.mockImplementationOnce(() => recordedLookupGate.promise);
        const stream = new PassThrough();
        recorder.model.stream = stream;
        await recorder.model.setEndProcess(stream, recorder.model.scheduleBinding);

        stream.destroy(new Error('synthetic failure before new-token replacement'));
        await waitFor(() => recorder.recordedDB.findId.mock.calls.length === 1, 'recorded lookup was not entered');

        await manager.update({ delete: [reserve], isSuppressLog: false });
        const replacementReserve = makeReserve({ ...reserve, name: 'replacement-during-recorded-lookup' });
        await manager.update({ insert: [replacementReserve], isSuppressLog: false });
        const replacementSession = manager.scheduleController.getSessionSnapshot(reserve.id);
        expect(replacementSession.sessionToken).not.toBe(recording.sessionToken);
        expect(provider).toHaveBeenCalledTimes(2);
        expect(manager.recordingIndex[reserve.id]).toBe(replacement);

        recordedLookupGate.resolve(recorded);
        await flushImmediate();
        await flushImmediate();

        expect(emitFailure).not.toHaveBeenCalled();
        expect(provider).toHaveBeenCalledTimes(2);
        expect(manager.recordingIndex[reserve.id]).toBe(replacement);
    });

    it('does not publish an old terminal after deletion and a new-token replacement', async () => {
        const event = new RecordingEvent({ getLogger: () => logger });
        const emitFailure = vi.spyOn(event, 'emitRecordingFailed');
        const recorder = makeRecorder({ recordingEvent: event });
        const replacement = replacementRecorder();
        const provider = vi.fn().mockResolvedValueOnce(recorder.model).mockResolvedValueOnce(replacement);
        const manager = createManager({ event, provider });
        const reserve = makeReserve({ id: 603, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });

        await manager.update({ insert: [reserve], isSuppressLog: false });
        const waiting = manager.scheduleController.getSessionSnapshot(reserve.id);
        expect(
            manager.scheduleController.tryTransitionSession(
                reserve.id,
                waiting.generation,
                waiting.sessionToken,
                'Waiting',
                'Recording',
            ),
        ).toBe(true);
        const recording = manager.scheduleController.getSessionSnapshot(reserve.id);
        manager.bindRecorder(recorder.model, recording);
        recorder.model.reserve = reserve;
        recorder.model.recEnd = vi.fn(async () => undefined);
        const stream = new PassThrough();
        recorder.model.stream = stream;
        await recorder.model.setEndProcess(stream, recorder.model.scheduleBinding);

        await manager.update({ delete: [reserve], isSuppressLog: false });
        const replacementReserve = makeReserve({ ...reserve, name: 'new-token-replacement' });
        await manager.update({ insert: [replacementReserve], isSuppressLog: false });
        const replacementSession = manager.scheduleController.getSessionSnapshot(reserve.id);
        expect(replacementSession.sessionToken).not.toBe(recording.sessionToken);
        expect(manager.recordingIndex[reserve.id]).toBe(replacement);

        stream.destroy(new Error('synthetic stale terminal after replacement'));
        await flushImmediate();
        await flushImmediate();

        expect(emitFailure).not.toHaveBeenCalled();
        expect(provider).toHaveBeenCalledTimes(2);
        expect(manager.recordingIndex[reserve.id]).toBe(replacement);
    });

    it('requeues a later-start update after aborting the old preparation and prepares exactly once at the new time', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const attempts: Array<{
            gate: ReturnType<typeof deferred<PassThrough>>;
            signal: AbortSignal;
        }> = [];
        let activeAbortListeners = 0;
        const create = vi.fn((_reserve: unknown, signal: AbortSignal) => {
            const gate = deferred<PassThrough>();
            let listening = true;
            const release = () => {
                if (!listening) return;
                listening = false;
                activeAbortListeners -= 1;
                signal.removeEventListener('abort', abort);
            };
            const abort = () => gate.reject(new Error('synthetic reschedule abort'));
            activeAbortListeners += 1;
            signal.addEventListener('abort', abort, { once: true });
            attempts.push({ gate, signal });
            return gate.promise.then(
                value => {
                    release();
                    return value;
                },
                error => {
                    release();
                    throw error;
                },
            );
        });
        const event = new RecordingEvent({ getLogger: () => logger });
        const cancelPrep = vi.spyOn(event, 'emitCancelPrepRecording');
        const recorder = makeRecorder({
            recordingEvent: event,
            streamCreator: { changeEndAt: vi.fn(), create },
        });
        const manager = createManager({ event, provider: vi.fn(async () => recorder.model) });
        const reserve = makeReserve({ id: 604, startAt: 1_015_000, endAt: 1_060_000 });

        try {
            await manager.update({ insert: [reserve], isSuppressLog: false });
            await settleMicrotasks();
            expect(create).toHaveBeenCalledOnce();
            const oldSession = manager.scheduleController.getSessionSnapshot(reserve.id);
            expect(oldSession.phase).toBe('Preparing');

            const later = makeReserve({ ...reserve, startAt: 1_030_000, endAt: 1_075_000 });
            await manager.update({ update: [later], isSuppressLog: false });
            const waiting = manager.scheduleController.getSessionSnapshot(reserve.id);
            expect(attempts[0].signal.aborted).toBe(true);
            expect(activeAbortListeners).toBe(0);
            expect(waiting).toMatchObject({ phase: 'Waiting', sessionToken: oldSession.sessionToken });
            expect(waiting.generation).not.toBe(oldSession.generation);
            expect(manager.hasReserve(reserve.id)).toBe(true);
            expect(cancelPrep).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(14_999);
            expect(create).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(1);
            await settleMicrotasks();
            expect(create).toHaveBeenCalledTimes(2);
            expect(manager.scheduleController.getSessionSnapshot(reserve.id)).toMatchObject({
                generation: waiting.generation,
                phase: 'Preparing',
                sessionToken: waiting.sessionToken,
            });

            attempts[0].gate.resolve(new PassThrough());
            await settleMicrotasks();
            expect(create).toHaveBeenCalledTimes(2);
        } finally {
            await manager.cancel(reserve.id, false);
            manager.scheduleController.stop();
        }

        expect(activeAbortListeners).toBe(0);
        expect(recorder.model.eventEmitter.listenerCount('RecordingCancelEvent')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });
});
