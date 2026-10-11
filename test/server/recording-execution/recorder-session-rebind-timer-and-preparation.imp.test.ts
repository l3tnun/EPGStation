import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, logger, makeRecorder, makeRecordingSessionBinding, makeReserve } from './_harness';

const CANCEL_EVENT = 'RecordingCancelEvent';

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.useRealTimers();
});

const makeOwner = (reservationId: number, generation: bigint, sessionToken: bigint) => ({
    reservationId,
    generation,
    sessionToken,
    intent: 'None' as string,
});

describe('[RE-9.2] recorder schedule session rebind', () => {
    const setupRetryWaiting = () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        const reserve = makeReserve();
        const first = makeRecordingSessionBinding(reserve);
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(first.binding);
        harness.model.scheduleRetry(1, first.binding, 'Preparing');
        expect(first.state.phase).toBe('RetryWaiting');
        expect(harness.model.retryAttempt).toBe(1);
        return { harness, reserve, first };
    };

    it('keeps a pending retry when the same session is rebound in the same phase', () => {
        const { harness, reserve } = setupRetryWaiting();
        const timerId = harness.model.retryTimerId;
        const token = harness.model.retryLifecycleToken;
        const second = makeRecordingSessionBinding(reserve, { phase: 'RetryWaiting' });

        harness.model.bindScheduleSession(second.binding);

        expect(harness.model.scheduleBinding).toBe(second.binding);
        expect(harness.model.retryTimerId).toBe(timerId);
        expect(harness.model.retryAttempt).toBe(1);
        expect(harness.model.retryLifecycleToken).toBe(token);
        expect(vi.getTimerCount()).toBe(1);
    });

    it.each(['Finishing', 'Completed', 'Cancelled'])('drops a pending retry when the same session enters %s', phase => {
        const { harness, reserve } = setupRetryWaiting();
        const next = makeRecordingSessionBinding(reserve, { phase });

        harness.model.bindScheduleSession(next.binding);

        expect(harness.model.retryTimerId).toBeNull();
        expect(harness.model.retryAttempt).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('carries the retry wait to a new generation of the same session token', () => {
        const { harness, reserve } = setupRetryWaiting();
        const oldTimerId = harness.model.retryTimerId;
        const next = makeRecordingSessionBinding(reserve, { generation: 2n, phase: 'RetryWaiting' });

        harness.model.bindScheduleSession(next.binding);

        expect(harness.model.retryAttempt).toBe(1);
        expect(harness.model.retryTimerId).not.toBeNull();
        expect(harness.model.retryTimerId).not.toBe(oldTimerId);
        expect(vi.getTimerCount()).toBe(1);
    });

    it('does not mark the registration owner as replaced when the same session is rebound', () => {
        const harness = makeRecorder();
        const reserve = makeReserve();
        const first = makeRecordingSessionBinding(reserve, { phase: 'Registering' });
        harness.model.bindScheduleSession(first.binding);
        const owner = makeOwner(1, 1n, 1n);
        harness.model.registrationOwners.add(owner);

        harness.model.bindScheduleSession(makeRecordingSessionBinding(reserve, { phase: 'Finishing' }).binding);

        expect(owner.intent).toBe('None');
    });

    it('marks only the owner of the replaced session as replaced', () => {
        const harness = makeRecorder();
        const reserve = makeReserve();
        const first = makeRecordingSessionBinding(reserve, { phase: 'Registering' });
        harness.model.bindScheduleSession(first.binding);
        const own = makeOwner(1, 1n, 1n);
        const otherReservation = makeOwner(2, 1n, 1n);
        const otherGeneration = makeOwner(1, 2n, 1n);
        const otherToken = makeOwner(1, 1n, 2n);
        for (const owner of [own, otherReservation, otherGeneration, otherToken]) {
            harness.model.registrationOwners.add(owner);
        }

        harness.model.bindScheduleSession(makeRecordingSessionBinding(reserve, { generation: 3n }).binding);

        expect(own.intent).toBe('Replacement');
        expect(otherReservation.intent).toBe('None');
        expect(otherGeneration.intent).toBe('None');
        expect(otherToken.intent).toBe('None');
    });

    it.each([
        ['reservation id', makeReserve({ id: 2 }), {}],
        ['session token', makeReserve(), { sessionToken: 2n }],
    ])('treats a different %s as a different session', (_name, reservation, overrides) => {
        const harness = makeRecorder();
        const first = makeRecordingSessionBinding(makeReserve(), { phase: 'Registering' });
        harness.model.bindScheduleSession(first.binding);
        const owner = makeOwner(1, 1n, 1n);
        harness.model.registrationOwners.add(owner);

        harness.model.bindScheduleSession(makeRecordingSessionBinding(reservation, overrides).binding);

        expect(owner.intent).toBe('Replacement');
    });

    it('records a termination intent only for the owner of the current session', () => {
        const harness = makeRecorder();
        const first = makeRecordingSessionBinding(makeReserve(), { phase: 'Registering' });
        harness.model.bindScheduleSession(first.binding);
        const own = makeOwner(1, 1n, 1n);
        const other = makeOwner(2, 1n, 1n);
        harness.model.registrationOwners.add(own);
        harness.model.registrationOwners.add(other);

        harness.model.recordRegistrationTerminationIntent('Cancel');

        expect(own.intent).toBe('Cancel');
        expect(other.intent).toBe('None');
    });
});

describe('[RE-9.3] recorder setTimer', () => {
    const NOW = 1_000_000;

    const setup = () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        return makeRecorder();
    };

    it.each([{ isSkip: true }, { isOverlap: true }])('does not set a timer for %o', overrides => {
        const harness = setup();

        const reserve = makeReserve({ startAt: NOW + 100_000, endAt: NOW + 200_000, ...overrides });
        const result = harness.model.setTimer(reserve, false);

        expect(result).toBe(false);
        expect(harness.model.timerId).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels a waiting timer and logs only when not suppressed while a central schedule is bound', () => {
        const harness = setup();
        const reserve = makeReserve({ startAt: NOW + 100_000, endAt: NOW + 200_000 });
        harness.model.scheduleBinding = makeRecordingSessionBinding(reserve).binding;
        const stale = vi.fn();
        harness.model.timerId = setTimeout(stale, 1_000);

        expect(harness.model.setTimer(reserve, true)).toBe(true);

        expect(harness.model.timerId).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(10_000);
        expect(stale).not.toHaveBeenCalled();
        expect(logger.system.info).not.toHaveBeenCalled();

        expect(harness.model.setTimer(reserve, false)).toBe(true);
        expect(logger.system.info).toHaveBeenCalledWith('set central schedule: 1');
    });

    it('logs the clamped wait time of a timer whose start time has already passed', () => {
        const harness = setup();

        expect(harness.model.setTimer(makeReserve({ startAt: NOW - 1_000, endAt: NOW + 200_000 }), false)).toBe(true);

        expect(logger.system.info).toHaveBeenCalledWith('set timer: 1, 0');
        clearTimeout(harness.model.timerId);
    });

    it('logs the wait time of a timer only when not suppressed', () => {
        const harness = setup();
        const reserve = makeReserve({ startAt: NOW + 100_000, endAt: NOW + 200_000 });

        expect(harness.model.setTimer(reserve, true)).toBe(true);
        expect(logger.system.info).not.toHaveBeenCalled();
        expect(harness.model.setTimer(reserve, false)).toBe(true);

        expect(logger.system.info).toHaveBeenCalledTimes(1);
        const message = logger.system.info.mock.calls[0][0] as string;
        expect(message).toMatch(/^set timer: 1, \d+$/);
        expect(Number(message.slice('set timer: 1, '.length))).toBeGreaterThan(0);
        expect(vi.getTimerCount()).toBe(1);
        clearTimeout(harness.model.timerId);
    });
});

describe('[RE-9.4] recorder prepRecord', () => {
    const cancelListener = (harness: ReturnType<typeof makeRecorder>) => {
        const listener = vi.fn();
        harness.model.eventEmitter.on(CANCEL_EVENT, listener);
        return listener;
    };

    it('starts a preparation as preparing, not recording and not planned for deletion', async () => {
        const pendingProgram = deferred<any>();
        const harness = makeRecorder({ programDB: { findId: vi.fn(() => pendingProgram.promise) } });
        harness.model.reserve = makeReserve();
        harness.model.isRecording = true;
        harness.model.isPlanToDelete = true;

        const preparation = harness.model.startPreparation();

        expect(harness.model.isPrepRecording).toBe(true);
        expect(harness.model.isRecording).toBe(false);
        expect(harness.model.isPlanToDelete).toBe(false);
        pendingProgram.resolve(null);
        await preparation;
    });

    it('emits the cancel event when the preparation is stopped while the program is looked up', async () => {
        const pendingProgram = deferred<any>();
        const harness = makeRecorder({ programDB: { findId: vi.fn(() => pendingProgram.promise) } });
        harness.model.reserve = makeReserve();
        const listener = cancelListener(harness);

        const preparation = harness.model.startPreparation();
        harness.model.isStopPrepRec = true;
        pendingProgram.resolve(makeReserve());
        await preparation;

        expect(listener).toHaveBeenCalledOnce();
        expect(harness.model.isStopPrepRec).toBe(false);
        expect(harness.streamCreator.create).not.toHaveBeenCalled();
    });

    it('emits the cancel event and releases the stream when the reservation disappeared during stream acquisition', async () => {
        const stream = new PassThrough();
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => null) },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
        });
        harness.model.reserve = makeReserve();
        const listener = cancelListener(harness);

        await harness.model.startPreparation();

        expect(listener).toHaveBeenCalledOnce();
        expect(stream.destroyed).toBe(true);
        expect(harness.model.stream).toBeNull();
    });

    it('does not start recording when the session left the preparing phase during stream acquisition', async () => {
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve);
        const stream = new PassThrough();
        const harness = makeRecorder({
            streamCreator: {
                create: vi.fn(async () => {
                    session.state.phase = 'Cancelled';
                    return stream;
                }),
                changeEndAt: vi.fn(),
            },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.doRecord = vi.fn(async () => undefined);

        await harness.model.startPreparation();

        expect(harness.model.doRecord).not.toHaveBeenCalled();
        expect(stream.destroyed).toBe(true);
        expect(session.binding.registerTimeSpecifiedEnd).not.toHaveBeenCalled();
    });

    it.each([
        ['a time specified reservation with a program', { isTimeSpecified: true, programId: 101 }, true],
        ['a reservation without a program', { isTimeSpecified: false, programId: null }, true],
        ['a reservation with a program that is not time specified', { isTimeSpecified: false, programId: 101 }, false],
    ])('registers the time specified end for %s: %s', (_name, overrides, expected) => {
        const reserve = makeReserve({ endAt: 5_000_000, ...overrides });
        const session = makeRecordingSessionBinding(reserve);
        const releaseTimeSpecifiedEnd = vi.fn();
        const harness = makeRecorder({
            config: { timeSpecifiedEndMargin: 3 },
            streamCreator: {
                create: vi.fn(async () => new PassThrough()),
                changeEndAt: vi.fn(),
                releaseTimeSpecifiedEnd,
            },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.doRecord = vi.fn(async () => undefined);

        return harness.model.startPreparation().then(() => {
            expect(harness.model.doRecord).toHaveBeenCalledOnce();
            if (expected) {
                expect(session.binding.registerTimeSpecifiedEnd).toHaveBeenCalledTimes(1);
                expect(session.binding.registerTimeSpecifiedEnd).toHaveBeenCalledWith(5_003_000);
                expect(releaseTimeSpecifiedEnd).toHaveBeenCalledTimes(1);
                expect(releaseTimeSpecifiedEnd).toHaveBeenCalledWith(reserve.id);
            } else {
                expect(session.binding.registerTimeSpecifiedEnd).not.toHaveBeenCalled();
                expect(releaseTimeSpecifiedEnd).not.toHaveBeenCalled();
            }
        });
    });

    it('releases the acquired stream when a failure arrives after the preparation was stopped', async () => {
        const stream = new PassThrough();
        const harness = makeRecorder({ streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() } });
        harness.reserveDB.findId.mockImplementation(async () => {
            harness.model.isStopPrepRec = true;
            throw new Error('synthetic failure after stop');
        });
        harness.model.reserve = makeReserve();
        const listener = cancelListener(harness);

        await harness.model.startPreparation();

        expect(listener).toHaveBeenCalledOnce();
        expect(stream.destroyed).toBe(true);
        expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
    });

    describe('after the retry attempts ran out', () => {
        const NOW = 2_000_000;

        const failingRecorder = (reserve: Record<string, any>) => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(NOW);
            const harness = makeRecorder({
                streamCreator: {
                    create: vi.fn(async () => {
                        throw new Error('synthetic open failure');
                    }),
                    changeEndAt: vi.fn(),
                },
            });
            harness.model.reserve = reserve;
            return harness;
        };

        it('reports the failure when the reservation ends exactly now', async () => {
            const reserve = makeReserve({ startAt: NOW - 60_000, endAt: NOW, isTimeSpecified: false });
            const harness = failingRecorder(reserve);
            const token = harness.model.retryLifecycleToken;

            await harness.model.runPreparation(3, null);

            expect(harness.recordingEvent.emitPrepRecordingFailed).toHaveBeenCalledTimes(1);
            expect(harness.recordingEvent.emitPrepRecordingFailed).toHaveBeenCalledWith(reserve);
            expect(harness.model.retryTimerId).toBeNull();
            expect(harness.model.isPrepRecording).toBe(false);
            expect(harness.model.retryLifecycleToken).toBe(token + 1n);
        });

        it('keeps retrying a reservation that ends later than now', async () => {
            const reserve = makeReserve({ startAt: NOW - 60_000, endAt: NOW + 1, isTimeSpecified: false });
            const harness = failingRecorder(reserve);

            await harness.model.runPreparation(3, null);

            expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
            expect(harness.model.retryTimerId).not.toBeNull();
            expect(harness.model.retryAttempt).toBe(4);
            harness.model.invalidateRetry();
        });
    });
});

describe('[RE-9.5] recorder preparation failure log state', () => {
    const NOW = 3_000_000;

    const setup = () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        return harness;
    };

    it.each([
        [0, true],
        [1, true],
        [2, true],
        [3, false],
    ])('keeps no aggregate after the individually logged attempt %i (willRetry=%s)', (retry, willRetry) => {
        const harness = setup();

        harness.model.logPrepFailure(retry, new Error('synthetic'), willRetry);

        expect(harness.model.prepFailureLog).toBeNull();
    });

    it('starts an aggregate after the last individually logged attempt when retrying continues', () => {
        const harness = setup();
        const err = new Error('synthetic');

        harness.model.logPrepFailure(3, err, true);

        expect(harness.model.prepFailureLog).toEqual({
            lastError: err,
            lastLoggedAt: NOW,
            pendingFailures: 0,
            totalFailures: 4,
        });
    });
});
