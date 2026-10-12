import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, makeManager, makeRecorder, makeRecordingSessionBinding, makeReserve } from './_harness';

afterEach(() => vi.useRealTimers());

describe('recording reservation changes', () => {
    it('[RE-2.9][Task 2.5] retains the manager index for one joined planned-deletion stop and detaches at terminal', async () => {
        const bounded = deferred<void>();
        const terminal = deferred<void>();
        const harness = makeManager({
            recorder: {
                cancel: vi.fn(() => bounded.promise),
                whenDeletionTerminal: vi.fn(() => terminal.promise),
            },
        });
        const reserve = makeReserve({ id: 6, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });

        const first = harness.model.cancel(6, true);
        const second = harness.model.cancel(6, true);
        const normalWhileStopping = harness.model.cancel(6, false);
        await harness.model.update({ delete: [reserve], isSuppressLog: false });
        expect(harness.model.hasReserve(6)).toBe(true);
        expect(harness.recorder.cancel).toHaveBeenCalledOnce();
        expect(harness.recorder.cancel).toHaveBeenCalledWith(true);
        expect(harness.recorder.whenDeletionTerminal).toHaveBeenCalledOnce();

        bounded.resolve();
        terminal.resolve();
        await Promise.all([first, second, normalWhileStopping]);
        await Promise.resolve();
        expect(harness.model.hasReserve(6)).toBe(false);
        harness.model.scheduleController.stop();
    });

    it('[Task 2.5] keeps normal cancellation on the detach-first path without a deletion terminal latch', async () => {
        const cancellation = deferred<void>();
        const harness = makeManager({ recorder: { cancel: vi.fn(() => cancellation.promise) } });
        const reserve = makeReserve({ id: 5, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });

        const pending = harness.model.cancel(5, false);
        expect(harness.model.hasReserve(5)).toBe(false);
        expect(harness.recorder.cancel).toHaveBeenCalledWith(false);
        expect(harness.model.deletionStops?.size ?? 0).toBe(0);
        cancellation.resolve();
        await pending;
        harness.model.scheduleController.stop();
    });

    it('[Task 2.5] retains the manager index after timeout until the same deletion stop becomes terminal', async () => {
        const bounded = deferred<void>();
        const terminal = deferred<void>();
        const harness = makeManager({
            recorder: {
                cancel: vi.fn(() => bounded.promise),
                whenDeletionTerminal: vi.fn(() => terminal.promise),
            },
        });
        const reserve = makeReserve({ id: 7, startAt: Date.now() + 60_000, endAt: Date.now() + 120_000 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });

        const cancellation = harness.model.cancel(7, true);
        bounded.reject(new Error('DeletionStopTimeoutError'));
        await expect(cancellation).rejects.toThrow('DeletionStopTimeoutError');
        await expect(harness.model.cancel(7, true)).rejects.toThrow('DeletionStopTimeoutError');
        expect(harness.model.hasReserve(7)).toBe(true);
        expect(harness.model.deletionStops?.size ?? 0).toBe(1);
        expect(harness.recorder.cancel).toHaveBeenCalledOnce();

        terminal.resolve();
        await terminal.promise;
        await Promise.resolve();
        expect(harness.model.hasReserve(7)).toBe(false);
        expect(harness.model.deletionStops?.size ?? 0).toBe(0);
        harness.model.scheduleController.stop();
    });

    it('[Task 2.3 review] fences the old retry while rearming the latest generation', async () => {
        vi.useFakeTimers();
        const timeout = vi.spyOn(globalThis, 'setTimeout');
        const reserve = makeReserve();
        const harness = makeRecorder({
            streamCreator: {
                create: vi.fn(async () => Promise.reject(new Error('synthetic updated retry'))),
                changeEndAt: vi.fn(),
            },
        });
        const oldSession = makeRecordingSessionBinding(reserve, { generation: 1n, sessionToken: 3n });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(oldSession.binding);
        await harness.model.startPreparation();
        const retryCallback = timeout.mock.calls.find(([, delay]) => delay === 5_000)?.[0] as () => void;
        const clear = vi.spyOn(globalThis, 'clearTimeout');
        const latestReserve = makeReserve({ ...reserve, name: 'synthetic-latest' });
        const latestSession = makeRecordingSessionBinding(latestReserve, {
            generation: 2n,
            phase: 'RetryWaiting',
            sessionToken: 3n,
        });

        oldSession.state.current = false;
        harness.model.bindScheduleSession(latestSession.binding);
        await harness.model.update(latestReserve, false);
        expect(clear).toHaveBeenCalledOnce();
        expect(harness.model.retryTimerId).not.toBeNull();
        retryCallback();
        await Promise.resolve();
        await harness.model.prepRecord(1, oldSession.binding);

        expect(harness.programDB.findId).toHaveBeenCalledOnce();
        expect(harness.streamCreator.create).toHaveBeenCalledOnce();
        expect(harness.recordingEvent.emitStartPrepRecording).toHaveBeenCalledOnce();
        expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(1);
    });

    it.each([
        ['waiting program', false, false, 101, true, false, false, false],
        ['waiting time', false, false, null, true, false, false, false],
        ['preparing program', true, false, 101, true, true, false, false],
        ['preparing time', true, false, null, false, false, true, false],
        ['recording program', false, true, 101, false, false, false, true],
        ['recording time', false, true, null, false, false, true, false],
    ])(
        '[Task 2.1] follows the exact update branch for %s',
        async (_case, preparing, recording, programId, setsTimer, cancels, changesEnd, relays) => {
            const harness = makeRecorder();
            harness.model.reserve = makeReserve({ programId, startAt: 20_000, endAt: 40_000 });
            harness.model.isPrepRecording = preparing;
            harness.model.isRecording = recording;
            harness.model.setTimer = vi.fn(() => true);
            harness.model._cancel = vi.fn(async () => undefined);
            harness.model.setEventRelayTimer = vi.fn();
            harness.model.eventEmitter.once = vi.fn((_event: string, callback: () => void) => callback());
            await harness.model.update(makeReserve({ programId, startAt: 21_000, endAt: 50_000 }), false);
            expect(harness.model.setTimer).toHaveBeenCalledTimes(setsTimer ? 1 : 0);
            expect(harness.model._cancel).toHaveBeenCalledTimes(cancels ? 1 : 0);
            expect(harness.streamCreator.changeEndAt).toHaveBeenCalledTimes(changesEnd ? 1 : 0);
            expect(harness.model.setEventRelayTimer).toHaveBeenCalledTimes(relays ? 1 : 0);
        },
    );

    it('[Task 2.1] updates active recorders and cancels them when skip or overlap becomes active', async () => {
        const harness = makeManager();
        await harness.model.update({ insert: [makeReserve({ id: 7 })], isSuppressLog: false });
        await harness.model.update({ update: [makeReserve({ id: 7, isSkip: true })], isSuppressLog: false });
        expect(harness.recorder.update).toHaveBeenCalledWith(expect.objectContaining({ id: 7, isSkip: true }), false);
        expect(harness.model.hasReserve(7)).toBe(false);
    });

    it('[Task 2.1] delegates deletion cancellation with the compatibility delete intent', async () => {
        const harness = makeManager();
        const reserve = makeReserve({ id: 8 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        await harness.model.update({ delete: [reserve], isSuppressLog: false });
        expect(harness.recorder.cancel).toHaveBeenCalledWith(false);
    });

    it('[RE-2.1][Task 2.1] resets a waiting reservation to its changed start and end times', async () => {
        const harness = makeRecorder();
        const original = makeReserve({ startAt: 20_000, endAt: 40_000 });
        const changed = makeReserve({ startAt: 30_000, endAt: 50_000 });
        harness.model.reserve = original;
        harness.model.setTimer = vi.fn(() => true);
        await harness.model.update(changed, false);
        expect(harness.model.setTimer).toHaveBeenCalledWith(changed, false);
        expect(harness.model.reserve).toBe(changed);
    });

    it('[RE-2.2][RE-2.3][Task 2.1] restarts a preparing program only when its start moves later', async () => {
        const later = makeRecorder();
        later.model.reserve = makeReserve({ startAt: 20_000 });
        later.model.isPrepRecording = true;
        later.model._cancel = vi.fn(async () => undefined);
        later.model.setTimer = vi.fn(() => true);
        await later.model.update(makeReserve({ startAt: 21_000 }), false);
        expect(later.model._cancel).toHaveBeenCalledOnce();
        expect(later.model.setTimer).toHaveBeenCalledOnce();

        const earlier = makeRecorder();
        earlier.model.reserve = makeReserve({ startAt: 20_000 });
        earlier.model.isPrepRecording = true;
        earlier.model._cancel = vi.fn(async () => undefined);
        earlier.model.setTimer = vi.fn(() => true);
        await earlier.model.update(makeReserve({ startAt: 19_000 }), false);
        expect(earlier.model._cancel).not.toHaveBeenCalled();
        expect(earlier.model.setTimer).not.toHaveBeenCalled();
    });

    it.each([
        ['preparing', true, false],
        ['recording', false, true],
    ])(
        '[RE-2.5][RE-2.6][Task 2.1] changes a time-specified %s end without recreating its stream',
        async (_phase, preparing, recording) => {
            const harness = makeRecorder();
            harness.model.reserve = makeReserve({ programId: null, isTimeSpecified: true, endAt: 40_000 });
            harness.model.isPrepRecording = preparing;
            harness.model.isRecording = recording;
            if (preparing) {
                harness.model.eventEmitter.once = vi.fn((_event: string, callback: () => void) => callback());
            }
            await harness.model.update(
                makeReserve({ programId: null, isTimeSpecified: true, startAt: 25_000, endAt: 50_000 }),
                false,
            );
            expect(harness.streamCreator.changeEndAt).toHaveBeenCalledOnce();
            expect(harness.streamCreator.create).not.toHaveBeenCalled();
        },
    );

    it('[RE-2.7][Task 2.1] aborts preparation cancellation and destroys an active recording stream', async () => {
        const preparing = makeRecorder();
        preparing.model.reserve = makeReserve();
        preparing.model.isPrepRecording = true;
        const abort = vi.fn();
        preparing.model.abortController = { abort };
        preparing.model.eventEmitter.once = vi.fn((_event: string, callback: () => void) => callback());
        await preparing.model.cancel(false);
        expect(abort).toHaveBeenCalledOnce();
        expect(preparing.recordingEvent.emitCancelPrepRecording).toHaveBeenCalledOnce();

        const recording = makeRecorder();
        const stream = new PassThrough();
        recording.model.reserve = makeReserve();
        recording.model.isRecording = true;
        recording.model.stream = stream;
        await recording.model.cancel(false);
        expect(stream.destroyed).toBe(true);
        expect(recording.model.isNeedDeleteReservation).toBe(false);
    });

    it('[RE-2.8][Task 3.3] cancels during the retry wait without opening another stream', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve();
        const harness = makeRecorder({
            streamCreator: {
                create: vi.fn(async () => Promise.reject(new Error('synthetic retry-wait failure'))),
                changeEndAt: vi.fn(),
            },
        });
        const session = makeRecordingSessionBinding(reserve, { phase: 'Preparing' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        await harness.model.startPreparation();
        expect(harness.streamCreator.create).toHaveBeenCalledOnce();
        const cancellation = harness.model.cancel(false);
        await vi.advanceTimersByTimeAsync(5_000);
        await cancellation;
        expect(harness.streamCreator.create).toHaveBeenCalledOnce();
        expect(harness.recordingEvent.emitCancelPrepRecording).toHaveBeenCalledOnce();
        expect(session.state.phase).toBe('Cancelled');
        expect(harness.model.isPrepRecording).toBe(false);
        expect(harness.model.isRecording).toBe(false);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(harness.streamCreator.create).toHaveBeenCalledOnce();
    });

    it('[Task 2.1/4.5 known characteristic] dispatches recorded updates without awaiting their settlement', async () => {
        const pending = new Promise<void>(() => undefined);
        const harness = makeRecorder({ recordedDB: { updateOnce: vi.fn(() => pending) } });
        harness.model.reserve = makeReserve();
        harness.model.recordedId = 21;
        harness.model.isRecording = true;
        const update = harness.model.update(makeReserve({ name: 'synthetic-updated' }), false);
        await expect(update).resolves.toBeUndefined();
        expect(harness.recordedDB.updateOnce).toHaveBeenCalledOnce();
        expect(harness.streamCreator.create).not.toHaveBeenCalled();
    });

    it.each([
        ['later', 21_000],
        ['earlier', 19_000],
    ])(
        '[RE-2.4][Task 2.1] updates the recorded row without reopening the stream when a recording program start moves %s',
        async (_direction, startAt) => {
            const stream = new PassThrough();
            const updateOnce = vi.fn(async (_recorded: any) => undefined);
            const harness = makeRecorder({ recordedDB: { updateOnce } });
            harness.model.reserve = makeReserve({ startAt: 20_000, endAt: 40_000 });
            harness.model.recordedId = 21;
            harness.model.isRecording = true;
            harness.model.stream = stream;
            harness.model.setTimer = vi.fn(() => true);
            const cancel = vi.spyOn(harness.model, '_cancel');
            try {
                await harness.model.update(makeReserve({ startAt, endAt: 40_000 }), false);
                expect(updateOnce).toHaveBeenCalledOnce();
                expect(updateOnce.mock.calls[0][0]).toMatchObject({ id: 21, startAt });
                expect(harness.model.stream).toBe(stream);
                expect(stream.destroyed).toBe(false);
                expect(harness.streamCreator.create).not.toHaveBeenCalled();
                expect(harness.model.setTimer).not.toHaveBeenCalled();
                expect(cancel).not.toHaveBeenCalled();
            } finally {
                harness.model.isCanceledCallingFinished = true;
                harness.model.destroyStream();
            }
        },
    );
});
