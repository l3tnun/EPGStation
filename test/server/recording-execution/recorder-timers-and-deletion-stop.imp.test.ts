import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    deferred,
    flushImmediate,
    makeRecorder,
    makeRecordingSessionBinding,
    makeReserve,
    RecorderModel,
} from './_harness';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const NOW = 1_700_000_000_000;

describe('RecorderModel.update time changes (unittest/imp)', () => {
    it('[R2-RECORDER-UPDATE-END-AT] a time-specified reserve whose end time is unchanged does not change the end time', async () => {
        const { model, streamCreator } = makeRecorder();
        model.isRecording = true;
        model.reserve = makeReserve({ programId: null, startAt: NOW, endAt: NOW + 60_000 });

        await model.update(makeReserve({ programId: null, startAt: NOW + 1_000, endAt: NOW + 60_000 }), true);

        expect(streamCreator.changeEndAt).not.toHaveBeenCalled();
    });

    it('[R2-RECORDER-UPDATE-END-AT] a time-specified reserve whose end time changed passes the new reserve on', async () => {
        const { model, streamCreator } = makeRecorder();
        model.isRecording = true;
        model.reserve = makeReserve({ programId: null, startAt: NOW, endAt: NOW + 60_000 });
        const changed = makeReserve({ programId: null, startAt: NOW, endAt: NOW + 90_000 });

        await model.update(changed, true);

        expect(streamCreator.changeEndAt).toHaveBeenCalledTimes(1);
        expect(streamCreator.changeEndAt).toHaveBeenCalledWith(changed);
    });

    it('[R2-RECORDER-UPDATE-END-AT] waiting for the recording to start leaves no timer behind once it starts', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        const { model, streamCreator } = makeRecorder();
        model.isPrepRecording = true;
        model.reserve = makeReserve({ programId: null, startAt: NOW, endAt: NOW + 60_000 });
        const changed = makeReserve({ programId: null, startAt: NOW, endAt: NOW + 90_000 });

        const updating = model.update(changed, true);
        await vi.advanceTimersByTimeAsync(0);
        expect(streamCreator.changeEndAt).not.toHaveBeenCalled();
        model.eventEmitter.emit(RecorderModel.START_RECORDING_EVENT);
        await updating;

        expect(streamCreator.changeEndAt).toHaveBeenCalledWith(changed);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[R2-RECORDER-UPDATE-EVENT-RELAY] the event relay timer is reset only while recording with a changed end time', async () => {
        const { model } = makeRecorder();
        const setEventRelayTimer = vi.spyOn(model, 'setEventRelayTimer').mockImplementation(() => undefined);
        const base = { programId: 101, startAt: NOW, endAt: NOW + 60_000 };

        // 録画中でも終了時刻が同じなら張り直さない
        model.isRecording = true;
        model.reserve = makeReserve(base);
        await model.update(makeReserve({ ...base, startAt: NOW + 5_000 }), true);
        expect(setEventRelayTimer).not.toHaveBeenCalled();

        // 録画準備中は終了時刻が変わっても張り直さない
        model.isRecording = false;
        model.isPrepRecording = true;
        model.reserve = makeReserve(base);
        await model.update(makeReserve({ ...base, endAt: NOW + 70_000 }), true);
        expect(setEventRelayTimer).not.toHaveBeenCalled();

        // 録画中で終了時刻が変わったら張り直す
        model.isRecording = true;
        model.isPrepRecording = false;
        model.reserve = makeReserve(base);
        const changed = makeReserve({ ...base, endAt: NOW + 70_000 });
        await model.update(changed, true);
        expect(setEventRelayTimer).toHaveBeenCalledTimes(1);
        expect(setEventRelayTimer).toHaveBeenCalledWith(changed);
    });

    it('[R2-RECORDER-UPDATE-RECORDED] the recorded row is updated only while recording with a recorded id', async () => {
        const { model, recordedDB } = makeRecorder();
        const recorded = { id: 21 };
        const createRecorded = vi.fn(async () => recorded);
        model.createRecorded = createRecorded;
        const base = { startAt: NOW, endAt: NOW + 60_000 };
        model.reserve = makeReserve(base);

        // 録画中だが recordedId が無い
        model.isRecording = true;
        model.recordedId = null;
        await model.update(makeReserve(base), true);
        // recordedId はあるが録画中ではない
        model.isRecording = false;
        model.recordedId = 21;
        await model.update(makeReserve(base), true);

        expect(createRecorded).not.toHaveBeenCalled();
        expect(recordedDB.updateOnce).not.toHaveBeenCalled();

        model.isRecording = true;
        await model.update(makeReserve(base), true);

        expect(createRecorded).toHaveBeenCalledTimes(1);
        expect(recordedDB.updateOnce).toHaveBeenCalledWith(recorded);
    });
});

describe('RecorderModel.setEventRelayTimer (unittest/imp)', () => {
    it('[R2-RECORDER-EVENT-RELAY-TIMER] waits until the check time before the end', () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        const { model } = makeRecorder();
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

        model.setEventRelayTimer(makeReserve({ endAt: NOW + 60_000 }));

        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(setTimeoutSpy.mock.calls[0][1]).toBe(40_000);
        expect(model.eventRelayTimerId).not.toBeNull();
    });

    it('[R2-RECORDER-EVENT-RELAY-TIMER] waits zero when the check time has already passed', () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        const { model } = makeRecorder();
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

        model.setEventRelayTimer(makeReserve({ endAt: NOW + 5_000 }));

        expect(setTimeoutSpy.mock.calls[0][1]).toBe(0);
    });

    it('[R2-RECORDER-EVENT-RELAY-TIMER] sets no timer for a skipped or overlapped reserve', () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        const { model } = makeRecorder();

        model.setEventRelayTimer(makeReserve({ endAt: NOW + 60_000, isSkip: true }));
        expect(model.eventRelayTimerId).toBeNull();
        model.setEventRelayTimer(makeReserve({ endAt: NOW + 60_000, isOverlap: true }));
        expect(model.eventRelayTimerId).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('RecorderModel.checkEventRelay (unittest/imp)', () => {
    it('[R2-RECORDER-EVENT-RELAY-CHECK] resolves the network id of each related item', async () => {
        const findEventRelayProgram = vi.fn(async (_n: number, _s: number, eventId: number) => ({ id: 500 + eventId }));
        const harness = makeRecorder({
            programDB: { findId: vi.fn(), findEventRelayProgram },
            tunerServerAccess: {
                getProgram: vi.fn(async () => ({
                    id: 101,
                    eventId: 1,
                    networkId: 7,
                    serviceId: 1,
                    relatedItems: [
                        { type: 'relay', serviceId: 11, eventId: 1 },
                        { type: 'relay', networkId: 9, serviceId: 12, eventId: 2 },
                        { type: 'relay', networkId: null, serviceId: 13, eventId: 3 },
                    ],
                })),
            },
        });
        const reserve = makeReserve({ programId: 101 });
        harness.model.reserve = reserve;

        await harness.model.checkEventRelay();

        expect(findEventRelayProgram.mock.calls).toEqual([
            [7, 11, 1],
            [9, 12, 2],
            [7, 13, 3],
        ]);
        const emitted = harness.recordingEvent.emitEventRelay.mock.calls[0][0];
        expect(emitted.map((item: any) => item.programId)).toEqual([501, 502, 503]);
        for (const item of emitted) {
            expect(item.parentReserve).toEqual(reserve);
            expect(item.parentReserve).not.toBe(reserve);
        }
    });
});

describe('RecorderModel schedule binding helpers (unittest/imp)', () => {
    it('[R2-RECORDER-BINDING-LOOKUP] currentScheduleBinding honours the expected session token', () => {
        const { model } = makeRecorder();
        expect(model.currentScheduleBinding()).toBeNull();

        const { binding } = makeRecordingSessionBinding(makeReserve(), { sessionToken: 5n });
        model.scheduleBinding = binding;

        expect(model.currentScheduleBinding()).toBe(binding);
        expect(model.currentScheduleBinding(5n)).toBe(binding);
        expect(model.currentScheduleBinding(6n)).toBeNull();
    });

    it('[R2-RECORDER-BINDING-CURRENT] a session for another reservation is not current', () => {
        const { model } = makeRecorder();
        const { binding } = makeRecordingSessionBinding(makeReserve({ id: 1 }));
        model.scheduleBinding = binding;

        expect(model.isCurrentScheduleBinding(binding, 'Preparing')).toBe(true);
        expect(model.isCurrentScheduleBinding({ ...binding, reservationId: 2 }, 'Preparing')).toBe(false);
    });

    it('[R2-RECORDER-BINDING-CURRENT] without isCurrent both generation and phase must match', () => {
        const { model } = makeRecorder();
        const plain = { generation: 1n, phase: 'Preparing', reservationId: 1, sessionToken: 1n };
        model.scheduleBinding = plain;

        expect(model.isCurrentScheduleBinding({ ...plain }, 'Preparing')).toBe(true);
        expect(model.isCurrentScheduleBinding({ ...plain, generation: 2n }, 'Preparing')).toBe(false);
        expect(model.isCurrentScheduleBinding({ ...plain }, 'Recording')).toBe(false);
    });

    it('[R2-RECORDER-PATH-OVERDUE] cancels the session and drops the time specified end once the selection ends', async () => {
        const { model } = makeRecorder();
        const { binding, state } = makeRecordingSessionBinding(makeReserve(), { phase: 'Recording' });
        model.scheduleBinding = binding;
        const terminal = deferred();
        const cancelled = vi.fn();
        model.eventEmitter.on(RecorderModel.CANCEL_EVENT, cancelled);

        model.handlePathSelectionOverdue({ terminal: terminal.promise }, binding, null);
        expect(state.phase).toBe('PathSelectionOverdue');
        expect(binding.removeTimeSpecifiedEnd).not.toHaveBeenCalled();

        terminal.resolve();
        await flushImmediate();

        expect(binding.removeTimeSpecifiedEnd).toHaveBeenCalledTimes(1);
        expect(state.phase).toBe('Cancelled');
        expect(cancelled).toHaveBeenCalledTimes(1);
    });

    it('[R2-RECORDER-TRANSITION] transitionSchedulePhase reports false without a binding', () => {
        const { model } = makeRecorder();
        expect(model.transitionSchedulePhase(null, ['Waiting'], 'Preparing')).toBe(false);
    });

    it('[R2-RECORDER-TRANSITION] only reaching Completed or Cancelled invalidates the retry', () => {
        const { model } = makeRecorder();
        const binding = { tryTransition: vi.fn(() => true) };

        expect(model.transitionSchedulePhase(binding, ['Preparing'], 'Recording')).toBe(true);
        expect(model.retryLifecycleToken).toBe(0n);
        expect(model.transitionSchedulePhase(binding, ['Preparing'], 'Finishing')).toBe(true);
        expect(model.retryLifecycleToken).toBe(0n);
        expect(model.transitionSchedulePhase(binding, ['Finishing'], 'Completed')).toBe(true);
        expect(model.retryLifecycleToken).toBe(1n);
        expect(model.transitionSchedulePhase(binding, ['Finishing'], 'Cancelled')).toBe(true);
        expect(model.retryLifecycleToken).toBe(2n);
    });
});

describe('RecorderModel retry timer (unittest/imp)', () => {
    const arm = (harness: ReturnType<typeof makeRecorder>) => {
        const runPreparation = vi.fn();
        harness.model.runPreparation = runPreparation;
        harness.model.scheduleRetry(3, null, null);
        return runPreparation;
    };

    it('[R2-RECORDER-RETRY-TIMER] re-arming keeps one timer and advances the lifecycle token', () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        arm(harness);
        expect(harness.model.retryLifecycleToken).toBe(1n);
        expect(vi.getTimerCount()).toBe(1);

        harness.model.scheduleRetry(4, null, null);

        expect(harness.model.retryLifecycleToken).toBe(2n);
        expect(harness.model.retryAttempt).toBe(4);
        expect(vi.getTimerCount()).toBe(1);
    });

    it('[R2-RECORDER-RETRY-TIMER] a fresh timer starts the preparation after five seconds', () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        const runPreparation = arm(harness);

        vi.advanceTimersByTime(5_000);

        expect(runPreparation).toHaveBeenCalledTimes(1);
        expect(runPreparation).toHaveBeenCalledWith(3, null);
        expect(harness.model.retryTimerId).toBeNull();
        expect(harness.model.retryAttempt).toBeNull();
    });

    it.each([
        ['the timer id was replaced', (model: any) => (model.retryTimerId = {})],
        ['the lifecycle token advanced', (model: any) => (model.retryLifecycleToken += 1n)],
        ['the attempt changed', (model: any) => (model.retryAttempt = 99)],
    ])('[R2-RECORDER-RETRY-TIMER] a stale timer does nothing when %s', (_name, stale) => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        const runPreparation = arm(harness);
        stale(harness.model);

        vi.advanceTimersByTime(5_000);

        expect(runPreparation).not.toHaveBeenCalled();
    });

    it('[R2-RECORDER-RETRY-TIMER] a session that left RetryWaiting is not resumed', () => {
        vi.useFakeTimers();
        const { model } = makeRecorder();
        model.runPreparation = vi.fn();
        const { binding, state } = makeRecordingSessionBinding(makeReserve(), { phase: 'RetryWaiting' });
        model.scheduleBinding = binding;
        model.scheduleRetry(1, binding, 'RetryWaiting');
        state.phase = 'Waiting';

        vi.advanceTimersByTime(5_000);

        expect(model.runPreparation).not.toHaveBeenCalled();
        expect(state.phase).toBe('Waiting');
    });

    it('[R2-RECORDER-RETRY-TIMER] a session still in RetryWaiting moves to Preparing and starts the preparation', () => {
        vi.useFakeTimers();
        const { model } = makeRecorder();
        model.runPreparation = vi.fn();
        const { binding, state } = makeRecordingSessionBinding(makeReserve(), { phase: 'RetryWaiting' });
        model.scheduleBinding = binding;
        model.scheduleRetry(1, binding, 'RetryWaiting');

        vi.advanceTimersByTime(5_000);

        expect(state.phase).toBe('Preparing');
        expect(model.runPreparation).toHaveBeenCalledWith(1, binding);
    });

    it('[R2-RECORDER-RETRY-TIMER] works with a timer object that cannot be unref-ed', () => {
        const { model } = makeRecorder();
        const bare = {};
        vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce((() => bare) as any);

        expect(() => model.scheduleRetry(1, null, null)).not.toThrow();
        expect(model.retryTimerId).toBe(bare);
    });

    it('[R2-RECORDER-RETRY-TIMER] invalidateRetry advances the token, clears the attempt and the timer', () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        arm(harness);

        harness.model.invalidateRetry();

        expect(harness.model.retryLifecycleToken).toBe(2n);
        expect(harness.model.retryAttempt).toBeNull();
        expect(harness.model.retryTimerId).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('RecorderModel.runPreparation (unittest/imp)', () => {
    it('[R2-RECORDER-PREPARATION-LIFETIME] clears its own lifetime only, never a newer one', async () => {
        const { model } = makeRecorder();
        const first = deferred();
        const second = deferred();
        model.prepRecord = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

        void model.runPreparation(0, null);
        void model.runPreparation(0, null);
        expect(model.preparationLifetime).toBe(second.promise);

        first.resolve();
        await flushImmediate();
        expect(model.preparationLifetime).toBe(second.promise);

        second.resolve();
        await flushImmediate();
        expect(model.preparationLifetime).toBeNull();
    });
});

describe('RecorderModel.stopForDeletion (unittest/imp)', () => {
    const attach = (model: any, phase: string) => {
        const made = makeRecordingSessionBinding(model.reserve, { phase });
        model.scheduleBinding = made.binding;
        return made;
    };
    const setup = () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.awaitFinalizationForDeletion = vi.fn(async () => undefined);
        return harness;
    };

    it('[R2-RECORDER-STOP-DELETION] records the deletion intent and stops reserving', async () => {
        const { model } = setup();
        attach(model, 'Waiting');
        const owner = { reservationId: 1, generation: 1n, sessionToken: 1n, intent: 'None' };
        model.registrationOwners.add(owner);

        const bounded = model.stopForDeletion();

        expect(model.isNeedDeleteReservation).toBe(false);
        expect(model.isPlanToDelete).toBe(true);
        expect(owner.intent).toBe('Deletion');
        await bounded;
    });

    it('[R2-RECORDER-STOP-DELETION] resets the preparation and recording flags when the cleanup finishes', async () => {
        const { model } = setup();
        model.isStopPrepRec = true;
        model.isPrepRecording = true;
        model.isRecording = true;

        await model.stopForDeletion();

        expect(model.isStopPrepRec).toBe(false);
        expect(model.isPrepRecording).toBe(false);
        expect(model.isRecording).toBe(false);
    });

    it('[R2-RECORDER-STOP-DELETION] works without a bound session', async () => {
        const { model } = setup();
        await expect(model.stopForDeletion()).resolves.toBeUndefined();
    });

    it('[R2-RECORDER-STOP-DELETION] moves a stoppable phase to StoppingForDeletion and leaves others alone', async () => {
        const stoppable = setup();
        const recording = attach(stoppable.model, 'Recording');
        const pending = stoppable.model.stopForDeletion();
        expect(recording.binding.tryTransition).toHaveBeenCalledWith('Recording', 'StoppingForDeletion');
        await pending;

        const finished = setup();
        const completed = attach(finished.model, 'Completed');
        const done = finished.model.stopForDeletion();
        expect(completed.binding.tryTransition).not.toHaveBeenCalled();
        expect(completed.state.phase).toBe('Completed');
        await done;
    });

    it('[R2-RECORDER-STOP-DELETION] clears the retry timer and the start timer', async () => {
        vi.useFakeTimers();
        const { model } = setup();
        model.runPreparation = vi.fn();
        const started = vi.fn();
        model.scheduleRetry(1, null, null);
        model.timerId = setTimeout(started, 1_000);

        const pending = model.stopForDeletion();
        expect(model.retryTimerId).toBeNull();
        expect(model.timerId).toBeNull();
        await pending;
        await vi.advanceTimersByTimeAsync(10_000);

        expect(started).not.toHaveBeenCalled();
        expect(model.runPreparation).not.toHaveBeenCalled();
    });

    it('[R2-RECORDER-STOP-DELETION] a Preparing session without a preparation waits for the cancel event', async () => {
        const { model } = setup();
        attach(model, 'Preparing');
        const controller = new AbortController();
        model.abortController = controller;
        let settled = false;

        const bounded = model.stopForDeletion();
        void bounded.then(() => (settled = true));
        expect(model.isStopPrepRec).toBe(true);
        expect(controller.signal.aborted).toBe(true);
        await flushImmediate();
        expect(settled).toBe(false);

        model.eventEmitter.emit(RecorderModel.CANCEL_EVENT);
        await bounded;
        expect(settled).toBe(true);
    });

    it('[R2-RECORDER-STOP-DELETION] a Preparing session without an abort controller is stopped without error', async () => {
        const { model } = setup();
        attach(model, 'Preparing');

        const bounded = model.stopForDeletion();
        expect(model.isStopPrepRec).toBe(true);
        model.eventEmitter.emit(RecorderModel.CANCEL_EVENT);
        await bounded;
    });

    it('[R2-RECORDER-STOP-DELETION] outside Preparing the preparation is neither flagged nor aborted', async () => {
        const { model } = setup();
        const controller = new AbortController();
        model.abortController = controller;

        const bounded = model.stopForDeletion();
        expect(model.isStopPrepRec).toBe(false);
        expect(controller.signal.aborted).toBe(false);
        await bounded;
    });

    it('[R2-RECORDER-STOP-DELETION] RetryWaiting stops the preparing flag at once, other phases do not', async () => {
        const retrying = setup();
        attach(retrying.model, 'RetryWaiting');
        retrying.model.isPrepRecording = true;
        const first = retrying.model.stopForDeletion();
        expect(retrying.model.isPrepRecording).toBe(false);
        await first;

        const waiting = setup();
        attach(waiting.model, 'Waiting');
        waiting.model.isPrepRecording = true;
        const second = waiting.model.stopForDeletion();
        expect(waiting.model.isPrepRecording).toBe(true);
        await second;
    });

    it('[R2-RECORDER-STOP-DELETION] cancels the wait for the first data', async () => {
        const { model } = setup();
        const cancel = vi.fn();
        model.firstDataWait = { cancel };

        await model.stopForDeletion();

        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('[R2-RECORDER-STOP-DELETION] with nothing to finalize it does not wait for finalization', async () => {
        const { model } = setup();

        await model.stopForDeletion();

        expect(model.awaitFinalizationForDeletion).not.toHaveBeenCalled();
        expect(model.isCanceledCallingFinished).toBe(false);
    });

    it.each([
        ['stream', (model: any) => (model.stream = {}), true],
        ['recFile', (model: any) => (model.recFile = {}), true],
        ['dropLogFileId', (model: any) => (model.dropLogFileId = 5), true],
        ['recordedId', (model: any) => (model.recordedId = 21), true],
        ['isRecording', (model: any) => (model.isRecording = true), true],
        ['finalizationLifetime', (model: any) => (model.finalizationLifetime = Promise.resolve()), false],
        ['finalizationContinuations', (model: any) => model.finalizationContinuations.add(Promise.resolve()), false],
    ])('[R2-RECORDER-STOP-DELETION] waits for finalization when only %s is left', async (_name, leave, unstarted) => {
        const { model } = setup();
        leave(model);

        await model.stopForDeletion();

        expect(model.awaitFinalizationForDeletion).toHaveBeenCalledTimes(1);
        expect(model.awaitFinalizationForDeletion).toHaveBeenCalledWith(unstarted);
        expect(model.isCanceledCallingFinished).toBe(true);
    });
});

describe('RecorderModel.boundDeletionStop (unittest/imp)', () => {
    it('[R2-RECORDER-BOUND-DELETION] a rejected terminal rejects and leaves no timeout behind', async () => {
        vi.useFakeTimers();
        const { model } = makeRecorder();
        const failure = new Error('terminal failed');

        await expect(model.boundDeletionStop(Promise.reject(failure))).rejects.toBe(failure);

        expect(vi.getTimerCount()).toBe(0);
    });

    it('[R2-RECORDER-BOUND-DELETION] works with a timer object that cannot be unref-ed', async () => {
        const { model } = makeRecorder();
        vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce((() => ({})) as any);

        await expect(model.boundDeletionStop(Promise.resolve())).resolves.toBeUndefined();
    });
});

describe('RecorderModel stream and drop checker waits (unittest/imp)', () => {
    const makeStream = () => Object.assign(new EventEmitter(), { closed: false, readableEnded: false });
    const listenerCounts = (stream: EventEmitter) => ['close', 'end', 'error'].map(name => stream.listenerCount(name));

    it('[R2-RECORDER-STREAM-TERMINAL] resolves at once without a stream or for an ended stream', async () => {
        const { model } = makeRecorder();
        await expect(model.waitForStreamTerminal(null)).resolves.toBeUndefined();
        await expect(model.waitForStreamTerminal({ closed: true, readableEnded: false })).resolves.toBeUndefined();
        await expect(model.waitForStreamTerminal({ closed: false, readableEnded: true })).resolves.toBeUndefined();
    });

    it.each(['close', 'end', 'error'])(
        '[R2-RECORDER-STREAM-TERMINAL] a live stream settles on %s and drops its listeners',
        async eventName => {
            const { model } = makeRecorder();
            const stream = makeStream();
            let settled = false;

            const waiting = model.waitForStreamTerminal(stream).then(() => (settled = true));
            await flushImmediate();
            expect(settled).toBe(false);
            expect(listenerCounts(stream)).toEqual([1, 1, 1]);

            stream.emit(eventName);
            await waiting;

            expect(settled).toBe(true);
            expect(listenerCounts(stream)).toEqual([0, 0, 0]);
        },
    );

    it('[R2-RECORDER-DROP-CHECKER-STOP] stopping twice shares one stop and clears the active flag', () => {
        const { model, dropChecker } = makeRecorder();
        model.isDropCheckerActive = true;

        const first = model.stopDropChecker();
        const second = model.stopDropChecker();

        expect(second).toBe(first);
        expect(dropChecker.stop).toHaveBeenCalledTimes(1);
        expect(model.isDropCheckerActive).toBe(false);
    });

    it('[R2-RECORDER-DROP-CHECKER-STOP] an inactive drop checker without a log file is not stopped', () => {
        const { model, dropChecker } = makeRecorder();

        expect(model.stopDropChecker()).toBeNull();
        expect(dropChecker.stop).not.toHaveBeenCalled();
    });
});

describe('RecorderModel.resetTimer (unittest/imp)', () => {
    it('[R2-RECORDER-RESET-TIMER] while recording it re-arms the event relay timer only when one exists', () => {
        const { model } = makeRecorder();
        model.reserve = makeReserve();
        model.isRecording = true;
        const setEventRelayTimer = vi.spyOn(model, 'setEventRelayTimer').mockImplementation(() => undefined);
        const setTimer = vi.spyOn(model, 'setTimer').mockImplementation(() => true);

        expect(model.resetTimer()).toBe(true);
        expect(setEventRelayTimer).not.toHaveBeenCalled();

        model.eventRelayTimerId = {};
        expect(model.resetTimer()).toBe(true);
        expect(setEventRelayTimer).toHaveBeenCalledTimes(1);
        expect(setEventRelayTimer).toHaveBeenCalledWith(model.reserve);
        expect(setTimer).not.toHaveBeenCalled();
    });

    it('[R2-RECORDER-RESET-TIMER] when not recording it sets the start timer with logging on', () => {
        const { model } = makeRecorder();
        model.reserve = makeReserve();
        const setTimer = vi.spyOn(model, 'setTimer').mockImplementation(() => false);

        expect(model.resetTimer()).toBe(false);
        expect(setTimer).toHaveBeenCalledWith(model.reserve, false);
    });
});

describe('RecorderModel namespace constants (unittest/imp)', () => {
    it('[R2-RECORDER-CONSTANTS] exposes the event names and the event relay check time', () => {
        expect(RecorderModel.CANCEL_EVENT).toBe('RecordingCancelEvent');
        expect(RecorderModel.START_RECORDING_EVENT).toBe('StartRecordingEvent');
        expect(RecorderModel.EVENT_RELAY_CHECK_TIME).toBe(20_000);
    });
});
