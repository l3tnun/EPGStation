import 'reflect-metadata';

import { PassThrough } from 'node:stream';
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

const recordingPhases = [
    'Recording',
    'PathSelectionOverdue',
    'AwaitingFirstData',
    'Registering',
    'RegistrationOverdue',
];

describe('RecorderModel.recFailed latest-phase gate (unittest/imp)', () => {
    it.each([...recordingPhases, 'Finishing', 'Completed'])(
        '[R2-RECORDER-FAILED] publishes the failure when the session is %s after the end processing',
        async phase => {
            const harness = makeRecorder();
            const reserve = makeReserve();
            const { binding, state } = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
            harness.model.reserve = reserve;
            harness.model.scheduleBinding = binding;
            harness.model.recEnd = vi.fn(async () => {
                state.phase = phase;
            });

            await harness.model.recFailed(new Error('synthetic failure'));

            expect(harness.recordingEvent.emitRecordingFailed).toHaveBeenCalledTimes(1);
            expect(harness.recordingEvent.emitRecordingFailed).toHaveBeenCalledWith(reserve, null, binding);
        },
    );

    it('[R2-RECORDER-FAILED] does not publish the failure when the session left the recording phases meanwhile', async () => {
        const harness = makeRecorder();
        const reserve = makeReserve();
        const { binding, state } = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        harness.model.reserve = reserve;
        harness.model.scheduleBinding = binding;
        harness.model.recEnd = vi.fn(async () => {
            state.phase = 'Cancelled';
        });

        await harness.model.recFailed(new Error('synthetic failure'));

        expect(harness.recordingEvent.emitRecordingFailed).not.toHaveBeenCalled();
    });
});

describe('RecorderModel.createRecorded (unittest/imp)', () => {
    it('[R2-RECORDER-CREATE-RECORDED] leaves the id unset before registration and copies it afterwards', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();

        const before = await harness.model.createRecorded();
        expect(before.id).toBeUndefined();

        harness.model.recordedId = 21;
        const after = await harness.model.createRecorded();
        expect(after.id).toBe(21);
        expect(after.name).toBe('synthetic-program');
    });

    it.each([
        ['name', { name: null, halfWidthName: 'synthetic' }],
        ['half width name', { name: 'synthetic', halfWidthName: null }],
        ['both names', { name: null, halfWidthName: null }],
    ])('[R2-RECORDER-CREATE-RECORDED] rejects a non time-specified reserve whose %s is null', async (_label, names) => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve({ isTimeSpecified: false, ...names });

        await expect(harness.model.createRecorded()).rejects.toThrow('CreateRecordedError');
    });
});

describe('RecorderModel finalizeRecording (unittest/imp)', () => {
    it('[RE-5.3] clears the recording flag of the model itself', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.recordedId = 21;
        harness.model.isRecording = true;

        await harness.model.recEnd();

        expect(harness.model.isRecording).toBe(false);
    });

    it('[RE-5.3] invalidates a pending retry as soon as finalization starts', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        const retryTimer = setTimeout(() => undefined, 60_000);
        retryTimer.unref();
        harness.model.retryTimerId = retryTimer;
        harness.model.retryAttempt = 3;
        const tokenBefore = harness.model.retryLifecycleToken;

        try {
            await harness.model.recEnd();
        } finally {
            clearTimeout(retryTimer);
        }

        expect(harness.model.retryTimerId).toBeNull();
        expect(harness.model.retryAttempt).toBeNull();
        expect(harness.model.retryLifecycleToken).toBeGreaterThan(tokenBefore);
    });

    it.each(recordingPhases)('[RE-5.3] moves a %s session through Finishing to Completed', async phase => {
        const harness = makeRecorder();
        const reserve = makeReserve();
        const { binding, state } = makeRecordingSessionBinding(reserve, { phase });
        harness.model.reserve = reserve;
        harness.model.scheduleBinding = binding;

        await harness.model.recEnd();

        expect(state.phase).toBe('Completed');
        expect(binding.removeTimeSpecifiedEnd).toHaveBeenCalled();
    });

    it('[RE-5.3] clears the event relay check timer when finalization starts', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        const relayTimer = setTimeout(() => undefined, 60_000);
        relayTimer.unref();
        harness.model.eventRelayTimerId = relayTimer;
        const clear = vi.spyOn(globalThis, 'clearTimeout');

        await harness.model.recEnd();

        expect(clear).toHaveBeenCalledWith(relayTimer);
        clearTimeout(relayTimer);
    });

    it('[RE-5.3] unpipes and destroys the stream and stops the drop checker for a normal end', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        const stream = new PassThrough();
        const unpipe = vi.spyOn(stream, 'unpipe');
        harness.model.stream = stream;
        harness.model.isDropCheckerActive = true;

        await harness.model.recEnd();

        expect(unpipe).toHaveBeenCalled();
        expect(stream.destroyed).toBe(true);
        expect(harness.dropChecker.stop).toHaveBeenCalledTimes(1);
    });

    it('[RE-5.1] leaves the drop checker stop to the planned-delete path instead of tracking it as a continuation', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        const stopped = deferred<void>();
        harness.dropChecker.stop.mockImplementation(() => stopped.promise);
        harness.model.isPlanToDelete = true;
        harness.model.isDropCheckerActive = true;

        const ending = harness.model.recEnd();
        await flushImmediate();

        expect(harness.dropChecker.stop).toHaveBeenCalledTimes(1);
        expect(harness.model.finalizationContinuations.size).toBe(0);
        stopped.resolve();
        await ending;
    });

    it.each([
        ['no tmp directory is configured', {}, 31],
        ['the video file is not registered', { recordedTmp: '/synthetic-tmp' }, null],
    ])('[RE-5.6] does not move a file when %s', async (_label, config, videoFileId) => {
        const harness = makeRecorder({ config });
        harness.model.reserve = makeReserve();
        harness.model.recordedId = 21;
        harness.model.videoFileId = videoFileId;
        harness.model.videoFileFulPath = '/synthetic-tmp/synthetic.ts';

        await harness.model.recEnd();

        expect(harness.recordingUtil.movingFromTmp).not.toHaveBeenCalled();
    });

    it.each([
        ['the video file path is unknown', 31, null],
        ['the video file is not registered', null, '/synthetic-root/synthetic.ts'],
    ])('[RE-5.4] does not update the file size when %s', async (_label, videoFileId, videoFileFulPath) => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.recordedId = 21;
        harness.model.videoFileId = videoFileId;
        harness.model.videoFileFulPath = videoFileFulPath;

        await harness.model.recEnd();

        expect(harness.recordingUtil.updateVideoFileSize).not.toHaveBeenCalled();
    });

    it('[RE-5.4] tracks the pending size update as a finalization continuation until it settles', async () => {
        const size = deferred<void>();
        const harness = makeRecorder({
            recordingUtil: {
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(() => size.promise),
            },
        });
        harness.model.reserve = makeReserve();
        harness.model.recordedId = 21;
        harness.model.videoFileId = 31;
        harness.model.videoFileFulPath = '/synthetic-root/synthetic.ts';

        await harness.model.recEnd();
        expect(harness.model.finalizationContinuations.size).toBe(1);

        size.resolve();
        await flushImmediate();
        expect(harness.model.finalizationContinuations.size).toBe(0);
    });

    it('[RE-9.5] releases the active recorded use once the normal end settles', async () => {
        const recordedUseProvider = { releaseSessionUse: vi.fn(), tryRegisterSessionUse: vi.fn() };
        const harness = makeRecorder({ recordedUseProvider });
        harness.model.reserve = makeReserve();
        const recordedUse = Object.freeze({ recordedId: 21, status: 'active' as const });
        harness.model.activeRecordedUse = recordedUse;

        await harness.model.recEnd();
        await harness.model.whenNormalRecordingTerminal();

        expect(recordedUseProvider.releaseSessionUse).toHaveBeenCalledTimes(1);
        expect(recordedUseProvider.releaseSessionUse).toHaveBeenCalledWith(harness.model, recordedUse);
        expect(harness.model.activeRecordedUse).toBeNull();
    });

    it('[RE-9.5] releases nothing when no recorded use is active', async () => {
        const recordedUseProvider = { releaseSessionUse: vi.fn(), tryRegisterSessionUse: vi.fn() };
        const harness = makeRecorder({ recordedUseProvider });
        harness.model.reserve = makeReserve();

        await harness.model.recEnd();
        await harness.model.whenNormalRecordingTerminal();

        expect(recordedUseProvider.releaseSessionUse).not.toHaveBeenCalled();
    });
});

describe('RecorderModel.awaitFinalizationForDeletion (unittest/imp)', () => {
    it('[RE-5.1] does not start finalization when it is not requested', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.recEnd = vi.fn(async () => undefined);

        await harness.model.awaitFinalizationForDeletion(false);

        expect(harness.model.recEnd).not.toHaveBeenCalled();
    });

    it('[RE-5.1] starts finalization as already finishing when it is missing and requested', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.recEnd = vi.fn(async () => undefined);

        await harness.model.awaitFinalizationForDeletion(true);

        expect(harness.model.recEnd).toHaveBeenCalledTimes(1);
        expect(harness.model.recEnd).toHaveBeenCalledWith(true);
    });

    it('[RE-5.1] waits for the running finalization instead of starting another', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.recEnd = vi.fn(async () => undefined);
        const running = deferred<void>();
        harness.model.finalizationLifetime = running.promise;
        let settled = false;

        const waiting = harness.model.awaitFinalizationForDeletion(true).then(() => {
            settled = true;
        });
        await flushImmediate();
        expect(settled).toBe(false);
        expect(harness.model.recEnd).not.toHaveBeenCalled();

        running.resolve();
        await waiting;
        expect(settled).toBe(true);
    });

    it('[RE-5.1] returns after a failed finalization settles', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        const running = deferred<void>();
        harness.model.finalizationLifetime = running.promise;

        const waiting = harness.model.awaitFinalizationForDeletion(false);
        running.reject(new Error('synthetic finalization failure'));

        await expect(waiting).resolves.toBeUndefined();
    });
});

describe('RecorderModel._cancel (unittest/imp)', () => {
    it('[R2-RECORDER-CANCEL] reports the cancellation of a pending retry timer', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        const retryTimer = setTimeout(() => undefined, 60_000);
        retryTimer.unref();
        harness.model.retryTimerId = retryTimer;
        const cancelled = vi.fn();
        harness.model.eventEmitter.once(RecorderModel.CANCEL_EVENT, cancelled);

        try {
            await harness.model._cancel();
        } finally {
            clearTimeout(retryTimer);
        }

        expect(cancelled).toHaveBeenCalledTimes(1);
    });

    it('[R2-RECORDER-CANCEL] reports the cancellation of a session waiting for a retry', async () => {
        const harness = makeRecorder();
        const reserve = makeReserve();
        const { binding, state } = makeRecordingSessionBinding(reserve, { phase: 'RetryWaiting' });
        harness.model.reserve = reserve;
        harness.model.scheduleBinding = binding;
        const cancelled = vi.fn();
        harness.model.eventEmitter.once(RecorderModel.CANCEL_EVENT, cancelled);

        await harness.model._cancel();

        expect(cancelled).toHaveBeenCalledTimes(1);
        expect(state.phase).toBe('Cancelled');
    });

    it('[R2-RECORDER-CANCEL] clears the start timer of a recording that has not started', async () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.timerId = setTimeout(() => undefined, 1_000);
        expect(vi.getTimerCount()).toBe(1);

        await harness.model._cancel();

        expect(vi.getTimerCount()).toBe(0);
    });

    it('[R2-RECORDER-CANCEL] clears no timer when there is no start timer', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        const clear = vi.spyOn(globalThis, 'clearTimeout');

        await harness.model._cancel();

        expect(clear).not.toHaveBeenCalled();
    });

    it('[R2-RECORDER-CANCEL] gives a preparation 60 seconds to confirm its cancellation', async () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.isPrepRecording = true;
        let failure: Error | null = null;

        void harness.model._cancel().catch((error: Error) => {
            failure = error;
        });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(failure).toBeNull();
        expect(harness.model.isStopPrepRec).toBe(true);

        await vi.advanceTimersByTimeAsync(59_000);
        expect(failure).toEqual(new Error('PrepRecCancelTimeoutError'));
    });

    it('[R2-RECORDER-CANCEL] leaves a stream that already ended alone while stopping a recording', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.isRecording = true;
        const stream = { destroyed: true, destroy: vi.fn(), push: vi.fn() };
        harness.model.stream = stream;

        await harness.model._cancel();

        expect(stream.destroy).not.toHaveBeenCalled();
        expect(stream.push).not.toHaveBeenCalled();
    });

    it('[R2-RECORDER-CANCEL] destroys and ends a live stream while stopping a recording', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.isRecording = true;
        const stream = { destroyed: false, destroy: vi.fn(), push: vi.fn() };
        harness.model.stream = stream;

        await harness.model._cancel();

        expect(stream.destroy).toHaveBeenCalledTimes(1);
        expect(stream.push).toHaveBeenCalledWith(null);
    });
});

describe('RecorderModel.readArrivedStreamData (unittest/imp)', () => {
    const makeDrainStream = (overrides: Record<string, any> = {}) => {
        const reads = { count: 0 };
        const socket = {
            get bytesRead(): number {
                reads.count += 1;
                return 1;
            },
        };
        return { reads, stream: { destroyed: false, readableEnded: false, readableLength: 0, socket, ...overrides } };
    };

    it('[R2-RECORDER-DRAIN] watches the received byte count for one more turn before it decides nothing arrives', async () => {
        const harness = makeRecorder();
        const { reads, stream } = makeDrainStream();

        await harness.model.readArrivedStreamData(stream);

        // 1 周目で受信量を初めて記録し、2 周目で増えていないことを確かめて戻る
        expect(reads.count).toBe(3);
    });

    it.each([
        ['destroyed', { destroyed: true }],
        ['ended', { readableEnded: true }],
    ])('[R2-RECORDER-DRAIN] does not wait on a stream that is already %s', async (_label, overrides) => {
        const harness = makeRecorder();
        const { reads, stream } = makeDrainStream(overrides);

        await harness.model.readArrivedStreamData(stream);

        expect(reads.count).toBe(0);
    });
});

describe('RecorderModel.cancel phase handling (unittest/imp)', () => {
    it('[R2-RECORDER-CANCEL] keeps the reservation deletion request of an idle recorder', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve({ ruleId: null });

        await harness.model.cancel(false);

        expect(harness.model.isNeedDeleteReservation).toBe(true);
    });

    it('[R2-RECORDER-CANCEL] clears the start timer of an idle recorder', async () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.timerId = setTimeout(() => undefined, 1_000);

        await harness.model.cancel(false);

        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['Waiting', 'Preparing', 'Recording', 'AwaitingFirstData', 'Registering', 'RegistrationOverdue'])(
        '[R2-RECORDER-CANCEL] cancels the schedule session in the %s phase',
        async phase => {
            const harness = makeRecorder();
            const reserve = makeReserve();
            const { binding, state } = makeRecordingSessionBinding(reserve, { phase });
            harness.model.reserve = reserve;
            harness.model.scheduleBinding = binding;

            await harness.model.cancel(false);

            expect(state.phase).toBe('Cancelled');
            expect(binding.removeTimeSpecifiedEnd).toHaveBeenCalled();
        },
    );
});

describe('RecorderModel.finishAtTimeSpecifiedEnd (unittest/imp)', () => {
    it('[R2-RECORDER-TIME-END] records the cancel intent, marks the end as called and stops the stream', async () => {
        const harness = makeRecorder();
        const reserve = makeReserve();
        const { binding } = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        harness.model.reserve = reserve;
        harness.model.scheduleBinding = binding;
        const owner = { reservationId: reserve.id, generation: 1n, sessionToken: 1n, intent: 'None' };
        harness.model.registrationOwners.add(owner);
        harness.model.recEnd = vi.fn(async () => undefined);
        const stream = new PassThrough();
        harness.model.stream = stream;

        await harness.model.finishAtTimeSpecifiedEnd();

        expect(owner.intent).toBe('Cancel');
        expect(harness.model.isCanceledCallingFinished).toBe(true);
        expect(stream.destroyed).toBe(true);
        expect(harness.model.stream).toBeNull();
        expect(harness.model.recEnd).toHaveBeenCalledWith(true);
    });
});

describe('RecorderModel.update dispatch (unittest/imp)', () => {
    it('[R2-RECORDER-UPDATE] cancels without deleting the recording when the reserve is skipped', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.cancel = vi.fn(async () => undefined);

        await harness.model.update(makeReserve({ isSkip: true }), true);

        expect(harness.model.cancel).toHaveBeenCalledTimes(1);
        expect(harness.model.cancel).toHaveBeenCalledWith(false);
    });

    it('[R2-RECORDER-UPDATE] leaves the timer alone when neither start nor end time changed', async () => {
        const harness = makeRecorder();
        const base = { startAt: 1_700_000_000_000, endAt: 1_700_000_060_000 };
        harness.model.reserve = makeReserve(base);
        harness.model.setTimer = vi.fn(() => true);

        await harness.model.update(makeReserve({ ...base }), true);

        expect(harness.model.setTimer).not.toHaveBeenCalled();
    });

    it('[R2-RECORDER-UPDATE] sets the timer again when the start time changed', async () => {
        const harness = makeRecorder();
        const base = { startAt: 1_700_000_000_000, endAt: 1_700_000_060_000 };
        harness.model.reserve = makeReserve(base);
        harness.model.setTimer = vi.fn(() => true);
        const changed = makeReserve({ ...base, startAt: base.startAt + 1_000 });

        await harness.model.update(changed, true);

        expect(harness.model.setTimer).toHaveBeenCalledWith(changed, true);
    });
});
