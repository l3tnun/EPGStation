import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger, makeRecorder, makeRecordingSessionBinding, makeReserve } from './_harness';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('[RE-9.2] recorder reschedule of a preparing recording', () => {
    const prepare = (binding: Record<string, unknown> | null) => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve({ startAt: 20_000 });
        harness.model.isPrepRecording = true;
        harness.model.scheduleBinding = binding;
        harness.model._cancel = vi.fn(async () => undefined);
        harness.model.setTimer = vi.fn(() => true);
        return harness;
    };

    it('re-arms the start timer when the bound session accepts the requeue after a later start', async () => {
        const requeueAfterReschedule = vi.fn(() => true);
        const reservation = makeReserve({ startAt: 20_000 });
        const { binding } = makeRecordingSessionBinding(reservation);
        const harness = prepare({ ...binding, requeueAfterReschedule });
        const later = makeReserve({ startAt: 21_000 });

        await harness.model.update(later, true);

        expect(harness.model._cancel).toHaveBeenCalledTimes(1);
        expect(requeueAfterReschedule).toHaveBeenCalledTimes(1);
        expect(harness.model.setTimer).toHaveBeenCalledWith(later, true);
    });

    it.each([
        ['declines the requeue', { requeueAfterReschedule: vi.fn(() => false) }],
        ['has no requeue operation', {}],
    ])('does not re-arm the start timer when the bound session %s', async (_name, extra) => {
        const reservation = makeReserve({ startAt: 20_000 });
        const { binding } = makeRecordingSessionBinding(reservation);
        const harness = prepare({ ...binding, ...extra });

        await harness.model.update(makeReserve({ startAt: 21_000 }), false);

        expect(harness.model._cancel).toHaveBeenCalledTimes(1);
        expect(harness.model.setTimer).not.toHaveBeenCalled();
    });

    it('does not re-arm the start timer when the session was replaced while the cancel was running', async () => {
        const reservation = makeReserve({ startAt: 20_000 });
        const { binding } = makeRecordingSessionBinding(reservation, { sessionToken: 1n });
        const requeueAfterReschedule = vi.fn(() => true);
        const harness = prepare({ ...binding, requeueAfterReschedule });
        harness.model._cancel = vi.fn(async () => {
            harness.model.scheduleBinding = { ...binding, requeueAfterReschedule, sessionToken: 2n };
        });

        await harness.model.update(makeReserve({ startAt: 21_000 }), false);

        expect(requeueAfterReschedule).not.toHaveBeenCalled();
        expect(harness.model.setTimer).not.toHaveBeenCalled();
    });
});

describe('[RE-9.2] recorder failure publication follows the current session', () => {
    const failureHarness = (phase: string) => {
        const harness = makeRecorder();
        const reservation = makeReserve({ id: 61 });
        const session = makeRecordingSessionBinding(reservation, { phase });
        harness.model.reserve = reservation;
        harness.model.scheduleBinding = session.binding;
        harness.model.recordedId = null;
        return { ...harness, ...session };
    };

    it('publishes the failure with the latest session while the session is still recording', async () => {
        const harness = failureHarness('Recording');

        await harness.model.recFailed(new Error('synthetic-failure'), harness.binding);

        expect(harness.recordingEvent.emitRecordingFailed).toHaveBeenCalledTimes(1);
        expect(harness.recordingEvent.emitRecordingFailed).toHaveBeenCalledWith(
            harness.binding.reservation,
            null,
            harness.binding,
        );
    });

    it('publishes nothing when the failing session is not in a phase that may publish a failure on entry', async () => {
        // 'Finishing' は入口の検査の対象外だが、後段の検査では許される。入口の検査だけが拒否の理由になる。
        const harness = failureHarness('Finishing');

        await harness.model.recFailed(new Error('synthetic-failure'), harness.binding);

        expect(harness.recordingEvent.emitRecordingFailed).not.toHaveBeenCalled();
    });

    it('publishes nothing when the session leaves its recording phases while the failure is being finalized', async () => {
        const harness = failureHarness('Recording');
        harness.model.recEnd = vi.fn(async () => {
            harness.state.phase = 'Cancelled';
        });

        await harness.model.recFailed(new Error('synthetic-failure'), harness.binding);

        expect(harness.model.recEnd).toHaveBeenCalledTimes(1);
        expect(harness.recordingEvent.emitRecordingFailed).not.toHaveBeenCalled();
    });

    it('publishes nothing when a newer session replaced the failing one while the failure is being finalized', async () => {
        const harness = failureHarness('Recording');
        harness.model.recEnd = vi.fn(async () => {
            harness.model.scheduleBinding = null;
        });

        await harness.model.recFailed(new Error('synthetic-failure'), harness.binding);

        expect(harness.recordingEvent.emitRecordingFailed).not.toHaveBeenCalled();
    });
});

describe('[RE-9.2] recorder stream ownership and time-specified naming', () => {
    it('leaves the stream of a newer attempt untouched when this attempt never acquired a stream', () => {
        const harness = makeRecorder();
        const newerStream = new PassThrough();
        harness.model.stream = newerStream;

        harness.model.destroyAcquiredStream(null);

        expect(newerStream.destroyed).toBe(false);
        expect(harness.model.stream).toBe(newerStream);
        newerStream.destroy();
    });

    it('records an empty name and warns when no program matches the time-specified channel and start', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve({
            channelId: 10,
            id: 78,
            isTimeSpecified: true,
            programId: null,
            startAt: 1_000,
        });
        logger.system.warn.mockClear();

        const recorded = await harness.model.createRecorded();

        expect(harness.programDB.findChannelIdAndTime).toHaveBeenCalledWith(10, 1_000);
        expect(recorded.name).toBe('');
        expect(recorded.halfWidthName).toBe('');
        expect(logger.system.warn).toHaveBeenCalledWith('get program info warn channelId: 10, startAt: 1000');
    });
});
