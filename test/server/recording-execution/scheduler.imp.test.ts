import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    deferred,
    flushImmediate,
    makeFakeRecordingScheduler,
    makeRecorder,
    makeReserve,
    makeScheduleHarness,
    makeStreamCreator,
    RecordingCandidateRegistry,
    RecordingScheduleController,
} from './_harness';

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('legacy per-reservation scheduler', () => {
    it('[Task 1.1] arms preparation at startAt minus fifteen seconds and rejects terminal reservations', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const future = makeRecorder();
        future.model.doRecord = vi.fn(async () => undefined);
        expect(future.model.setTimer(makeReserve({ startAt: 1_020_000, endAt: 1_030_000 }), false)).toBe(true);
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(4_999);
        expect(future.recordingEvent.emitStartPrepRecording).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(future.recordingEvent.emitStartPrepRecording).toHaveBeenCalledOnce();

        const ended = makeRecorder();
        expect(ended.model.setTimer(makeReserve({ startAt: 900_000, endAt: 1_000_000 }), false)).toBe(false);
    });

    it.each([
        ['one millisecond before end', 1_000_001, true],
        ['at end', 1_000_000, false],
        ['one millisecond after end', 999_999, false],
    ])('[Task 1.1] applies the actual setTimer terminal boundary %s', (_case, endAt, scheduled) => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const harness = makeRecorder();
        expect(harness.model.setTimer(makeReserve({ startAt: 1_020_000, endAt }), false)).toBe(scheduled);
        expect(vi.getTimerCount()).toBe(scheduled ? 1 : 0);
        vi.clearAllTimers();
    });

    it('[Task 1.1] keeps reservation timers independent across clock changes and recomputes only on reset', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const first = makeRecorder();
        const second = makeRecorder();
        first.model.doRecord = vi.fn(async () => undefined);
        first.model.setTimer(makeReserve({ id: 11, startAt: 1_020_000, endAt: 1_040_000 }), false);
        second.model.setTimer(makeReserve({ id: 12, startAt: 1_025_000, endAt: 1_045_000 }), false);
        expect(first.model.timerId).not.toBe(second.model.timerId);
        vi.setSystemTime(1_001_000);
        expect(vi.getTimerCount()).toBe(2);
        expect(first.model.resetTimer()).toBe(true);
        expect(vi.getTimerCount()).toBe(2);
        vi.advanceTimersByTime(4_000);
        expect(first.recordingEvent.emitStartPrepRecording).toHaveBeenCalledOnce();
        expect(second.recordingEvent.emitStartPrepRecording).not.toHaveBeenCalled();
    });
});

describe('single recording schedule evaluation', () => {
    it('[Task 1.9] lets a bound time-specified session use the central milestone without a legacy timer', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const stream = new (await import('node:stream')).PassThrough();
        const reserve = makeReserve({
            id: 471,
            isTimeSpecified: true,
            programId: null,
            startAt: 1_020_000,
            endAt: 1_060_000,
        });
        const harness = makeRecorder({
            config: { timeSpecifiedEndMargin: 2 },
            reserveDB: { findId: vi.fn(async () => reserve) },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
        });
        const binding = {
            generation: 1n,
            phase: 'Preparing',
            registerTimeSpecifiedEnd: vi.fn(),
            removeTimeSpecifiedEnd: vi.fn(),
            reservation: reserve,
            reservationId: 471,
            sessionToken: 1n,
            tryTransition: vi.fn(() => true),
        };
        harness.model.bindScheduleSession(binding);
        harness.model.doRecord = vi.fn(async () => undefined);

        expect(harness.model.setTimer(reserve, false)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        await harness.model.startPreparation();

        expect(harness.streamCreator.create).toHaveBeenCalledWith(reserve, expect.any(AbortSignal), {
            isTimeSpecifiedEndExternallyScheduled: true,
        });
        expect(harness.reserveDB.findId).toHaveBeenCalledOnce();
        expect(binding.tryTransition).toHaveBeenCalledWith('Preparing', 'Recording');
        expect(binding.registerTimeSpecifiedEnd).toHaveBeenCalledWith(1_062_000);
        expect(binding.registerTimeSpecifiedEnd.mock.invocationCallOrder[0]).toBeGreaterThan(
            harness.reserveDB.findId.mock.invocationCallOrder[0],
        );
        expect(harness.model.doRecord).toHaveBeenCalledOnce();
        stream.destroy();
    });

    it('[Task 1.9] replaces a bound active end centrally and preserves the program relay session timer', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const timeSpecified = makeRecorder({ config: { timeSpecifiedEndMargin: 3 } });
        const binding = {
            generation: 2n,
            phase: 'Recording',
            registerTimeSpecifiedEnd: vi.fn(),
            removeTimeSpecifiedEnd: vi.fn(),
            reservationId: 472,
            sessionToken: 2n,
            tryTransition: vi.fn(() => true),
        };
        timeSpecified.model.bindScheduleSession(binding);
        timeSpecified.model.reserve = makeReserve({
            id: 472,
            isTimeSpecified: true,
            programId: null,
            startAt: 900_000,
            endAt: 1_040_000,
        });
        timeSpecified.model.isRecording = true;
        await timeSpecified.model.update(
            makeReserve({
                id: 472,
                isTimeSpecified: true,
                programId: null,
                startAt: 900_000,
                endAt: 1_050_000,
            }),
            false,
        );
        expect(binding.registerTimeSpecifiedEnd).toHaveBeenCalledWith(1_053_000);
        expect(timeSpecified.streamCreator.changeEndAt).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);

        const program = makeRecorder();
        const programReserve = makeReserve({ id: 473, programId: 473, endAt: 1_040_000 });
        program.model.reserve = programReserve;
        program.model.isRecording = true;
        program.model.setEventRelayTimer(programReserve);
        expect(vi.getTimerCount()).toBe(1);
        expect(program.model.resetTimer()).toBe(true);
        expect(vi.getTimerCount()).toBe(1);
    });

    it('[Task 1.9] never registers the old end while a preparing update waits for the internal start event', async () => {
        const stream = new (await import('node:stream')).PassThrough();
        const oldReserve = makeReserve({
            id: 475,
            isTimeSpecified: true,
            programId: null,
            startAt: 900_000,
            endAt: 1_010_000,
        });
        const latestReserve = makeReserve({ ...oldReserve, endAt: 1_020_000 });
        const harness = makeRecorder({
            config: { timeSpecifiedEndMargin: 0 },
            reserveDB: { findId: vi.fn(async () => latestReserve) },
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
        });
        const binding = {
            generation: 4n,
            phase: 'Preparing',
            registerTimeSpecifiedEnd: vi.fn(),
            removeTimeSpecifiedEnd: vi.fn(),
            reservation: latestReserve,
            reservationId: 475,
            sessionToken: 4n,
            tryTransition: vi.fn(() => true),
        };
        harness.model.reserve = oldReserve;
        harness.model.isPrepRecording = true;
        harness.model.bindScheduleSession(binding);
        harness.model.doRecord = vi.fn(async () => {
            harness.model.eventEmitter.emit('StartRecordingEvent');
        });

        const update = harness.model.update(latestReserve, false);
        await Promise.resolve();
        await harness.model.startPreparation();
        await update;

        expect(binding.registerTimeSpecifiedEnd).toHaveBeenCalled();
        expect(binding.registerTimeSpecifiedEnd.mock.calls.every(([dueAt]: any[]) => dueAt === 1_020_000)).toBe(true);
        expect(binding.registerTimeSpecifiedEnd).not.toHaveBeenCalledWith(1_010_000);
        stream.destroy();
    });

    it('[R2-R5] preparing time-specified end-update timeout settles once without end change and without leftover START_RECORDING listener or timer', async () => {
        vi.useFakeTimers();
        const harness = makeRecorder();
        const original = makeReserve({
            programId: null,
            isTimeSpecified: true,
            startAt: 25_000,
            endAt: 40_000,
        });
        const changed = makeReserve({
            programId: null,
            isTimeSpecified: true,
            startAt: 25_000,
            endAt: 50_000,
        });
        harness.model.reserve = original;
        harness.model.isPrepRecording = true;
        harness.model.isRecording = false;

        const updatePromise = harness.model.update(changed, false);
        // Do not attach a rejection handler before the timeout arm is observed: the wait path
        // registers both PREP_TIME timeout and a one-shot START_RECORDING_EVENT listener.
        await vi.advanceTimersByTimeAsync(0);
        expect(harness.model.eventEmitter.listenerCount('StartRecordingEvent')).toBe(1);

        const settled = updatePromise.then(
            () => ({ status: 'fulfilled' as const }),
            (error: unknown) => ({ status: 'rejected' as const, error }),
        );
        await vi.advanceTimersByTimeAsync(15_000);
        const outcome = await settled;

        expect(outcome.status).toBe('rejected');
        expect(outcome).toMatchObject({
            status: 'rejected',
            error: expect.objectContaining({ message: 'ChangeEndAtTimeoutError' }),
        });
        expect(harness.streamCreator.changeEndAt).not.toHaveBeenCalled();
        expect(harness.streamCreator.create).not.toHaveBeenCalled();
        // Contract: timeout must clear both the wait timer and the one-shot recording-start listener.
        expect(harness.model.eventEmitter.listenerCount('StartRecordingEvent')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 1.9] turns a central time end into one non-awaiting stream stop and milestone cleanup', async () => {
        const stream = new (await import('node:stream')).PassThrough();
        const harness = makeRecorder();
        const binding = {
            generation: 3n,
            phase: 'Finishing',
            registerTimeSpecifiedEnd: vi.fn(),
            removeTimeSpecifiedEnd: vi.fn(),
            reservationId: 474,
            sessionToken: 3n,
            tryTransition: vi.fn(() => true),
        };
        harness.model.bindScheduleSession(binding);
        harness.model.reserve = makeReserve({ id: 474, isTimeSpecified: true, programId: null });
        harness.model.stream = stream;
        harness.model.isRecording = true;

        await expect(harness.model.finishAtTimeSpecifiedEnd()).resolves.toBeUndefined();

        expect(stream.destroyed).toBe(true);
        expect(binding.removeTimeSpecifiedEnd).toHaveBeenCalledOnce();
        expect(binding.tryTransition).toHaveBeenCalledOnce();
        expect(binding.tryTransition).toHaveBeenCalledWith('Finishing', 'Completed');
    });

    it.each([
        ['same session update', 7n, true],
        ['delete and re-add replacement', 8n, false],
    ])(
        '[Task 1.9 review] completes finalization against the latest binding after %s',
        async (_case, nextSessionToken, shouldCompleteLatest) => {
            const finalization = deferred<void>();
            const reserve = makeReserve({ id: 476, isTimeSpecified: true, programId: null });
            const harness = makeRecorder();
            harness.recordedDB.removeRecording.mockImplementation(() => finalization.promise);
            const oldBinding = {
                generation: 1n,
                phase: 'Finishing',
                registerTimeSpecifiedEnd: vi.fn(),
                removeTimeSpecifiedEnd: vi.fn(),
                reservation: reserve,
                reservationId: 476,
                sessionToken: 7n,
                tryTransition: vi.fn(() => true),
            };
            const latestBinding = {
                ...oldBinding,
                generation: 2n,
                removeTimeSpecifiedEnd: vi.fn(),
                sessionToken: nextSessionToken,
                tryTransition: vi.fn(() => true),
            };
            harness.model.reserve = reserve;
            harness.model.recordedId = 21;
            harness.model.isRecording = true;
            harness.model.bindScheduleSession(oldBinding);

            const ending = harness.model.recEnd(true);
            await vi.waitFor(() => expect(harness.recordedDB.removeRecording).toHaveBeenCalledOnce());
            harness.model.bindScheduleSession(latestBinding);
            finalization.resolve();
            await ending;

            expect(oldBinding.tryTransition).not.toHaveBeenCalled();
            expect(latestBinding.tryTransition).toHaveBeenCalledTimes(shouldCompleteLatest ? 1 : 0);
            if (shouldCompleteLatest) {
                expect(latestBinding.tryTransition).toHaveBeenCalledWith('Finishing', 'Completed');
            }
        },
    );

    it('[Task 1.9 review] settles first-data waiting at the central end without a retry or legacy end timer', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const root = await mkdtemp(join(tmpdir(), 'epgstation-central-first-data-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const creator = makeStreamCreator({
            tunerServerAccess: {
                openServiceStream: vi.fn(async () => ({ stream, close: vi.fn() })),
            },
        });
        const reserve = makeReserve({
            id: 477,
            isTimeSpecified: true,
            programId: null,
            startAt: 900_000,
            endAt: 1_060_000,
        });
        const harness = makeRecorder({
            reserveDB: { findId: vi.fn(async () => reserve) },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'synthetic.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
            },
            streamCreator: creator.model,
        });
        let phase = 'Preparing';
        const makeBinding = (bindingPhase: string) => ({
            generation: 9n,
            phase: bindingPhase,
            registerTimeSpecifiedEnd: vi.fn(),
            removeTimeSpecifiedEnd: vi.fn(),
            reservation: reserve,
            reservationId: 477,
            sessionToken: 9n,
            tryTransition: vi.fn((expected: string, next: string) => {
                if (phase !== expected) return false;
                phase = next;
                return true;
            }),
        });
        const preparing = makeBinding('Preparing');
        harness.model.bindScheduleSession(preparing);
        harness.model.setTimer(reserve, false);

        try {
            const preparation = harness.model.startPreparation();
            for (let index = 0; index < 10 && harness.model.recFile === null; index += 1) await Promise.resolve();
            expect(creator.tunerServerAccess.openServiceStream).toHaveBeenCalledOnce();
            expect(creator.model.timerIndex).toEqual({});
            expect(phase).toBe('AwaitingFirstData');

            phase = 'Finishing';
            harness.model.bindScheduleSession(makeBinding('Finishing'));
            await harness.model.finishAtTimeSpecifiedEnd();
            expect(vi.getTimerCount()).toBe(0);
            await vi.advanceTimersByTimeAsync(10_000);
            await preparation;

            expect(creator.tunerServerAccess.openServiceStream).toHaveBeenCalledOnce();
            expect(harness.recordingEvent.emitStartPrepRecording).toHaveBeenCalledOnce();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            expect(harness.recordingEvent.emitPrepRecordingFailed).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 1.7] folds mutation, reset, and timer collision into the current evaluation without old dispatch', async () => {
        const harness = makeScheduleHarness({
            reservations: [makeReserve({ id: 481, startAt: 1_030_000, endAt: 1_090_000 })],
        });
        await harness.controller.start();
        const timer = harness.fakeScheduler.activeTimers()[0];
        const list = harness.registry.list.bind(harness.registry);
        let collide = true;
        harness.registry.list = vi.fn(() => {
            if (collide) {
                collide = false;
                harness.controller.acceptMutation({
                    update: [makeReserve({ id: 481, startAt: 1_015_000, endAt: 1_100_000 })],
                    isSuppressLog: false,
                });
                harness.controller.requestReset();
            }
            return list();
        });

        harness.now.value = 1_015_000;
        harness.fakeScheduler.fire(timer);

        expect(harness.dispatchPreparation).toHaveBeenCalledOnce();
        const [candidate, generation, sessionToken] = harness.dispatchPreparation.mock.calls[0];
        expect(candidate).toMatchObject({ reservationId: 481, startAt: 1_015_000, phase: 'Preparing' });
        expect(generation).toBe(harness.registry.get(481).generation);
        expect(typeof sessionToken).toBe('bigint');
        expect(harness.dispatchReset).toHaveBeenCalledOnce();
        expect(harness.fakeScheduler.microtasks).toHaveLength(0);
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        harness.controller.stop();
    });

    it('[Task 1.7] requires exact generation, session token, and phase before one session transition', async () => {
        const harness = makeScheduleHarness();
        await harness.controller.start();
        const first = makeReserve({ id: 491, startAt: 2_000_000, endAt: 2_100_000 });
        harness.controller.acceptMutation({ insert: [first], isSuppressLog: false });
        harness.fakeScheduler.flushMicrotasks();
        const stale = harness.controller.getSessionSnapshot(491);

        harness.controller.acceptMutation({ delete: [first], isSuppressLog: false });
        harness.controller.acceptMutation({
            insert: [makeReserve({ id: 491, startAt: 2_010_000, endAt: 2_110_000 })],
            isSuppressLog: false,
        });
        harness.fakeScheduler.flushMicrotasks();
        const current = harness.controller.getSessionSnapshot(491);

        expect(current.generation).not.toBe(stale.generation);
        expect(current.sessionToken).not.toBe(stale.sessionToken);
        expect(typeof current.sessionToken).toBe('bigint');
        expect(
            harness.controller.tryTransitionSession(
                491,
                stale.generation,
                current.sessionToken,
                'Waiting',
                'Preparing',
            ),
        ).toBe(false);
        expect(
            harness.controller.tryTransitionSession(
                491,
                current.generation,
                stale.sessionToken,
                'Waiting',
                'Preparing',
            ),
        ).toBe(false);
        expect(
            harness.controller.tryTransitionSession(
                491,
                current.generation,
                current.sessionToken,
                'Recording',
                'Preparing',
            ),
        ).toBe(false);
        expect(harness.registry.get(491).phase).toBe('Waiting');
        expect(
            harness.controller.tryTransitionSession(
                491,
                current.generation,
                current.sessionToken,
                'Waiting',
                'Preparing',
            ),
        ).toBe(true);
        expect(
            harness.controller.tryTransitionSession(
                491,
                current.generation,
                current.sessionToken,
                'Waiting',
                'Preparing',
            ),
        ).toBe(false);
        harness.controller.wake();
        expect(harness.dispatchPreparation).not.toHaveBeenCalled();
        harness.controller.stop();
    });

    it('[Task 1.9] removes a time-specified ending milestone only for its exact current session', async () => {
        const reservationId = 493;
        const first = makeReserve({
            id: reservationId,
            isTimeSpecified: true,
            programId: null,
            startAt: 900_000,
            endAt: 1_100_000,
        });
        const harness = makeScheduleHarness({ reservations: [first] });
        const firstCandidate = harness.registry.get(reservationId);
        expect(
            harness.registry.tryTransitionPhase(reservationId, firstCandidate.generation, 'Waiting', 'Recording'),
        ).toBe(true);
        await harness.controller.start();
        const previousSession = harness.controller.getSessionSnapshot(reservationId);

        harness.controller.acceptMutation({
            update: [makeReserve({ ...first, endAt: 1_120_000 })],
            isSuppressLog: false,
        });
        harness.fakeScheduler.flushMicrotasks();
        const currentSession = harness.controller.getSessionSnapshot(reservationId);
        expect(currentSession.generation).not.toBe(previousSession.generation);
        expect(currentSession.sessionToken).toBe(previousSession.sessionToken);
        harness.controller.registerTimeSpecifiedEnd({
            reservationId,
            generation: currentSession.generation,
            sessionToken: currentSession.sessionToken,
            dueAt: 1_120_000,
        });
        const registered = harness.controller.timeSpecifiedEnds.get(reservationId);

        harness.controller.removeTimeSpecifiedEnd(
            reservationId,
            previousSession.generation,
            currentSession.sessionToken,
        );
        expect(harness.controller.timeSpecifiedEnds.get(reservationId)).toBe(registered);

        const wrongSessionToken = (currentSession.sessionToken + 1n) as typeof currentSession.sessionToken;
        harness.controller.removeTimeSpecifiedEnd(reservationId, currentSession.generation, wrongSessionToken);
        expect(harness.controller.timeSpecifiedEnds.get(reservationId)).toBe(registered);

        harness.controller.removeTimeSpecifiedEnd(
            reservationId,
            currentSession.generation,
            currentSession.sessionToken,
        );
        expect(harness.controller.timeSpecifiedEnds.has(reservationId)).toBe(false);
        harness.controller.stop();
    });

    it('[Task 1.7] isolates an asynchronous mutation dispatch rejection without replaying it', async () => {
        const failure = new Error('synthetic mutation dispatch failure');
        const harness = makeScheduleHarness({ dispatchMutation: vi.fn(() => Promise.reject(failure)) });
        await harness.controller.start();

        expect(() =>
            harness.controller.acceptMutation({
                insert: [makeReserve({ id: 492, startAt: 2_000_000 })],
                isSuppressLog: false,
            }),
        ).not.toThrow();
        harness.fakeScheduler.flushMicrotasks();
        await flushImmediate();

        expect(harness.reportDispatchError).toHaveBeenCalledWith(
            failure,
            expect.objectContaining({ action: 'insert', reservationId: 492 }),
        );
        expect(harness.dispatchMutation).toHaveBeenCalledOnce();
        harness.controller.wake();
        expect(harness.dispatchMutation).toHaveBeenCalledOnce();
        harness.controller.stop();
    });

    it('[Task 1.5] dispatches all same-time preparations before arming and never awaits their lifetime', async () => {
        const firstLifetime = deferred<void>();
        const dispatchPreparation = vi
            .fn()
            .mockImplementationOnce(() => firstLifetime.promise)
            .mockImplementationOnce(() => undefined);
        const harness = makeScheduleHarness({
            dispatchPreparation,
            now: 1_000_000,
            reservations: [
                makeReserve({ id: 501, startAt: 1_015_000 }),
                makeReserve({ id: 502, startAt: 1_015_000 }),
                makeReserve({ id: 503, startAt: 1_030_000 }),
            ],
        });

        await harness.controller.start();

        expect(dispatchPreparation.mock.calls.map(([candidate]: any[]) => candidate.reservationId)).toEqual([501, 502]);
        expect(Math.max(...dispatchPreparation.mock.invocationCallOrder)).toBeLessThan(
            harness.fakeScheduler.scheduler.setTimeout.mock.invocationCallOrder[0],
        );
        expect(harness.registry.get(501).phase).toBe('Preparing');
        expect(harness.registry.get(502).phase).toBe('Preparing');
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        expect(harness.fakeScheduler.activeTimers()[0].delayMs).toBe(3_000);
        firstLifetime.resolve();
        await firstLifetime.promise;
        harness.controller.stop();
    });

    it('[Task 1.5] uses a microtask instead of a repeated zero-millisecond timer after a CAS race', async () => {
        const harness = makeScheduleHarness({ reservations: [makeReserve({ id: 511, startAt: 1_015_000 })] });
        const transition = harness.registry.tryTransitionPhase.bind(harness.registry);
        harness.registry.tryTransitionPhase = vi.fn(() => false);

        await harness.controller.start();
        expect(harness.dispatchPreparation).not.toHaveBeenCalled();
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(0);
        expect(harness.fakeScheduler.microtasks).toHaveLength(1);
        let idleSettled = false;
        const idle = harness.controller.whenIdle().then(() => {
            idleSettled = true;
        });
        await Promise.resolve();
        expect(idleSettled).toBe(false);

        harness.registry.tryTransitionPhase = transition;
        harness.fakeScheduler.flushMicrotasks();
        await idle;
        expect(idleSettled).toBe(true);
        expect(harness.dispatchPreparation).toHaveBeenCalledOnce();
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        expect(harness.fakeScheduler.timers.some((timer: any) => timer.delayMs === 0)).toBe(false);
        harness.controller.stop();
    });

    it('[Task 1.5 mutation] recovers queued work after queueMicrotask throws synchronously', async () => {
        const harness = makeScheduleHarness();
        await harness.controller.start();
        const failure = new Error('synthetic queueMicrotask failure');
        harness.fakeScheduler.scheduler.queueMicrotask.mockImplementationOnce(() => {
            throw failure;
        });
        const first = makeReserve({ id: 512, startAt: 2_000_000, endAt: 2_100_000 });
        const second = makeReserve({ id: 513, startAt: 2_010_000, endAt: 2_110_000 });

        expect(() => harness.controller.acceptMutation({ insert: [first], isSuppressLog: false })).not.toThrow();
        expect(harness.controller.microtaskScheduled).toBe(false);
        expect(harness.fakeScheduler.microtasks).toHaveLength(0);
        expect(harness.reportDispatchError).toHaveBeenCalledWith(failure, {
            action: 'invalid',
            reservationId: -1,
        });

        harness.controller.acceptMutation({ insert: [second], isSuppressLog: true });
        expect(harness.fakeScheduler.microtasks).toHaveLength(1);
        const idle = harness.controller.whenIdle();
        harness.fakeScheduler.flushMicrotasks();
        await idle;

        expect(harness.registry.get(first.id)).toMatchObject({ phase: 'Waiting' });
        expect(harness.registry.get(second.id)).toMatchObject({ phase: 'Waiting' });
        expect(harness.dispatchMutation.mock.calls.map(([mutation]: any[]) => mutation.reservationId)).toEqual([
            first.id,
            second.id,
        ]);
        expect(harness.controller.microtaskScheduled).toBe(false);
        harness.controller.stop();
    });

    it('[Task 1.5] folds a reentrant wake into one non-concurrent evaluation loop', async () => {
        const harness = makeScheduleHarness({ reservations: [makeReserve({ id: 521, startAt: 2_000_000 })] });
        const list = harness.registry.list.bind(harness.registry);
        let activeEvaluations = 0;
        let maximumActiveEvaluations = 0;
        let requested = false;
        harness.registry.list = vi.fn(() => {
            activeEvaluations += 1;
            maximumActiveEvaluations = Math.max(maximumActiveEvaluations, activeEvaluations);
            if (!requested) {
                requested = true;
                harness.controller.wake();
            }
            const candidates = list();
            activeEvaluations -= 1;
            return candidates;
        });

        await harness.controller.start();

        expect(harness.registry.list.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(maximumActiveEvaluations).toBe(1);
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        harness.controller.stop();
    });

    it('[Task 8.3] collects work that becomes due during a delayed scan without a rerun', async () => {
        const startAt = 1_000_000;
        const delayedPreparation = makeReserve({ id: 561, startAt: startAt + 19_000, endAt: startAt + 120_000 });
        const delayedEnd = makeReserve({
            id: 562,
            isTimeSpecified: true,
            programId: null,
            startAt: startAt - 60_000,
            endAt: startAt + 120_000,
        });
        const harness = makeScheduleHarness({
            now: startAt,
            reservations: [delayedPreparation, delayedEnd],
        });
        const waiting = harness.controller.getSessionSnapshot(delayedEnd.id);
        expect(
            harness.controller.tryTransitionSession(
                delayedEnd.id,
                waiting.generation,
                waiting.sessionToken,
                'Waiting',
                'Recording',
            ),
        ).toBe(true);
        const recording = harness.controller.getSessionSnapshot(delayedEnd.id);
        harness.controller.registerTimeSpecifiedEnd({ ...recording, dueAt: startAt + 4_000 });

        const list = harness.registry.list.bind(harness.registry);
        let delayedScan = false;
        harness.registry.list = vi.fn(() => {
            if (!delayedScan) {
                delayedScan = true;
                // The scan takes longer than the 3-second bound without injecting a new evaluation.
                harness.now.value += 4_000;
            }
            return list();
        });
        const acceptMutation = vi.spyOn(harness.controller, 'acceptMutation');
        const wake = vi.spyOn(harness.controller, 'wake');

        await harness.controller.start();

        expect(harness.dispatchPreparation.mock.calls.map(([candidate]: any[]) => candidate.reservationId)).toEqual([
            561,
        ]);
        expect(
            harness.dispatchTimeSpecifiedEnd.mock.calls.map(([milestone]: any[]) => milestone.reservationId),
        ).toEqual([562]);
        expect(acceptMutation).not.toHaveBeenCalled();
        expect(wake).toHaveBeenCalledOnce();
        expect(harness.registry.list).toHaveBeenCalledTimes(2);
        expect(harness.fakeScheduler.microtasks).toHaveLength(0);
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        expect(harness.fakeScheduler.maximumActiveTimerCount()).toBe(1);
        harness.controller.stop();
    });

    it('[Task 1.5 mutation] dispatches a candidate introduced only for a reentrant rerun', async () => {
        const harness = makeScheduleHarness({
            reservations: [makeReserve({ id: 522, startAt: 2_000_000, endAt: 2_100_000 })],
        });
        const list = harness.registry.list.bind(harness.registry);
        let firstPass = true;
        harness.registry.list = vi.fn(() => {
            if (!firstPass) return list();
            firstPass = false;
            const firstSnapshot = list();
            harness.registry.upsert(makeReserve({ id: 523, startAt: 1_015_000, endAt: 1_100_000 }));
            harness.controller.wake();
            return firstSnapshot;
        });

        await harness.controller.start();

        expect(harness.dispatchPreparation).toHaveBeenCalledOnce();
        expect(harness.dispatchPreparation.mock.calls[0][0]).toMatchObject({ reservationId: 523 });
        expect(harness.registry.get(523)).toMatchObject({ phase: 'Preparing' });
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        harness.controller.stop();
    });

    it('[Task 1.5 mutation] resolves a fresh idle observation without requiring a wake', async () => {
        const harness = makeScheduleHarness();
        let settled = false;

        void harness.controller.whenIdle().then(() => {
            settled = true;
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(settled).toBe(true);
        expect(harness.controller.idleWaiters).toEqual([]);
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(0);
        expect(harness.fakeScheduler.microtasks).toHaveLength(0);
    });

    it('[Task 1.5 mutation] applies work accepted synchronously by mutation dispatch before due work', async () => {
        const ledger: string[] = [];
        const first = makeReserve({ id: 524, startAt: 2_000_000, endAt: 2_100_000 });
        const second = makeReserve({ id: 525, startAt: 1_015_000, endAt: 1_100_000 });
        let harness: ReturnType<typeof makeScheduleHarness>;
        const dispatchMutation = vi.fn((mutation: any) => {
            ledger.push(`mutation:${mutation.reservationId}`);
            if (mutation.reservationId === first.id) {
                harness.controller.acceptMutation({ insert: [second], isSuppressLog: true });
            }
        });
        const dispatchPreparation = vi.fn((candidate: any) => {
            ledger.push(`preparation:${candidate.reservationId}`);
        });
        harness = makeScheduleHarness({ dispatchMutation, dispatchPreparation });
        harness.controller.acceptMutation({ insert: [first], isSuppressLog: false });

        await harness.controller.start();

        expect(ledger).toEqual(['mutation:524', 'mutation:525', 'preparation:525']);
        expect(harness.registry.get(524)).toMatchObject({ phase: 'Waiting' });
        expect(harness.registry.get(525)).toMatchObject({ phase: 'Preparing' });
        expect(harness.controller.queuedMutations).toEqual([]);
        expect(harness.fakeScheduler.microtasks).toHaveLength(0);
        harness.controller.stop();
    });

    it('[Task 1.7 mutation] processes reset-only work before releasing idle waiters', async () => {
        const harness = makeScheduleHarness();
        await harness.controller.start();

        harness.controller.requestReset();
        expect(harness.controller.queuedMutations).toEqual([]);
        expect(harness.fakeScheduler.microtasks).toHaveLength(1);
        let idleSettled = false;
        const idle = harness.controller.whenIdle().then(() => {
            idleSettled = true;
        });
        await Promise.resolve();
        expect(idleSettled).toBe(false);

        harness.fakeScheduler.flushMicrotasks();
        await idle;

        expect(harness.dispatchReset).toHaveBeenCalledOnce();
        expect(idleSettled).toBe(true);
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        expect(harness.fakeScheduler.microtasks).toHaveLength(0);
        harness.controller.stop();
    });

    it('[Task 1.5 mutation] does not rearm a wake when stopped from inside evaluation', async () => {
        const harness = makeScheduleHarness({
            reservations: [makeReserve({ id: 526, startAt: 2_000_000, endAt: 2_100_000 })],
        });
        const list = harness.registry.list.bind(harness.registry);
        let stopped = false;
        harness.registry.list = vi.fn(() => {
            if (!stopped) {
                stopped = true;
                harness.controller.stop();
            }
            return list();
        });

        await harness.controller.start();

        expect(stopped).toBe(true);
        expect(harness.dispatchPreparation).not.toHaveBeenCalled();
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(0);
        expect(harness.fakeScheduler.microtasks).toHaveLength(0);
        expect(harness.controller.armedWake).toBeUndefined();
    });

    it('[Task 1.5 mutation] reports one evaluation failure and retains a bounded later wake', async () => {
        const failure = new Error('synthetic scheduler evaluation failure');
        const harness = makeScheduleHarness();
        const list = harness.registry.list.bind(harness.registry);
        harness.registry.list = vi.fn().mockImplementationOnce(() => {
            throw failure;
        });
        harness.registry.list.mockImplementation(() => list());

        await harness.controller.start();
        let idleSettled = false;
        void harness.controller.whenIdle().then(() => {
            idleSettled = true;
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(harness.reportDispatchError).toHaveBeenCalledOnce();
        expect(harness.reportDispatchError).toHaveBeenCalledWith(failure, {
            action: 'invalid',
            reservationId: -1,
        });
        expect(idleSettled).toBe(true);
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        expect(harness.fakeScheduler.activeTimers()[0].delayMs).toBe(3_000);

        harness.fakeScheduler.fire();
        expect(harness.reportDispatchError).toHaveBeenCalledOnce();
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        harness.controller.stop();
    });

    it('[Task 1.7 mutation] rejects missing sessions and stale milestone owners without changing wake ownership', async () => {
        const reservationId = 527;
        const reservation = makeReserve({
            id: reservationId,
            isTimeSpecified: true,
            programId: null,
            startAt: 2_000_000,
            endAt: 2_100_000,
        });
        const harness = makeScheduleHarness({ reservations: [reservation] });
        const candidate = harness.registry.get(reservationId);
        expect(harness.registry.tryTransitionPhase(reservationId, candidate.generation, 'Waiting', 'Recording')).toBe(
            true,
        );
        await harness.controller.start();
        const activeWake = harness.fakeScheduler.activeTimers()[0];
        const setTimeoutCalls = harness.fakeScheduler.scheduler.setTimeout.mock.calls.length;
        const session = harness.controller.getSessionSnapshot(reservationId);

        expect(harness.controller.tryTransitionSession(9_527, 1n, 1n, 'Waiting', 'Preparing')).toBe(false);
        expect(() =>
            harness.controller.registerTimeSpecifiedEnd({
                reservationId: 9_527,
                generation: 1n,
                sessionToken: 1n,
                dueAt: 1_000_000,
            }),
        ).not.toThrow();
        harness.controller.registerTimeSpecifiedEnd({
            reservationId,
            generation: session.generation,
            sessionToken: session.sessionToken + 1n,
            dueAt: 1_000_000,
        });

        expect(harness.controller.timeSpecifiedEnds.size).toBe(0);
        expect(harness.dispatchTimeSpecifiedEnd).not.toHaveBeenCalled();
        expect(harness.fakeScheduler.activeTimers()).toEqual([activeWake]);
        expect(harness.fakeScheduler.scheduler.setTimeout).toHaveBeenCalledTimes(setTimeoutCalls);
        harness.controller.stop();
    });

    it.each(['Completed', 'Cancelled'] as const)(
        '[Task 1.7 mutation] retains an active milestone and removes it immediately on %s',
        async terminalPhase => {
            const reservationId = terminalPhase === 'Completed' ? 528 : 529;
            const harness = makeScheduleHarness({
                reservations: [
                    makeReserve({
                        id: reservationId,
                        isTimeSpecified: true,
                        programId: null,
                        startAt: 2_000_000,
                        endAt: 2_100_000,
                    }),
                ],
            });
            const waiting = harness.controller.getSessionSnapshot(reservationId);
            expect(
                harness.controller.tryTransitionSession(
                    reservationId,
                    waiting.generation,
                    waiting.sessionToken,
                    'Waiting',
                    'Recording',
                ),
            ).toBe(true);
            const recording = harness.controller.getSessionSnapshot(reservationId);
            harness.controller.registerTimeSpecifiedEnd({ ...recording, dueAt: 2_100_000 });
            const registered = harness.controller.timeSpecifiedEnds.get(reservationId);

            expect(
                harness.controller.tryTransitionSession(
                    reservationId,
                    recording.generation,
                    recording.sessionToken,
                    'Recording',
                    'AwaitingFirstData',
                ),
            ).toBe(true);
            expect(harness.controller.timeSpecifiedEnds.get(reservationId)).toBe(registered);

            expect(
                harness.controller.tryTransitionSession(
                    reservationId,
                    recording.generation,
                    recording.sessionToken,
                    'AwaitingFirstData',
                    terminalPhase,
                ),
            ).toBe(true);
            expect(harness.controller.timeSpecifiedEnds.has(reservationId)).toBe(false);
        },
    );

    it.each(['Recording', 'PathSelectionOverdue', 'AwaitingFirstData', 'Registering', 'RegistrationOverdue'] as const)(
        '[Task 1.9 mutation] accepts an exact current milestone while the session is %s',
        phase => {
            const reservationId = 5_300;
            const harness = makeScheduleHarness({
                reservations: [
                    makeReserve({
                        id: reservationId,
                        isTimeSpecified: true,
                        programId: null,
                        startAt: 2_000_000,
                        endAt: 2_100_000,
                    }),
                ],
            });
            const waiting = harness.controller.getSessionSnapshot(reservationId);
            expect(
                harness.controller.tryTransitionSession(
                    reservationId,
                    waiting.generation,
                    waiting.sessionToken,
                    'Waiting',
                    phase,
                ),
            ).toBe(true);
            const current = harness.controller.getSessionSnapshot(reservationId);

            harness.controller.registerTimeSpecifiedEnd({
                reservationId,
                generation: current.generation,
                sessionToken: current.sessionToken,
                dueAt: 2_100_000,
            });

            expect(harness.controller.timeSpecifiedEnds.get(reservationId)).toEqual({
                reservationId,
                generation: current.generation,
                sessionToken: current.sessionToken,
                dueAt: 2_100_000,
            });
        },
    );

    it('[period-wake-clock-token][Task 1.5] ignores a cancelled shared-wake callback by its opaque controller token', async () => {
        const harness = makeScheduleHarness({ reservations: [makeReserve({ id: 531, startAt: 2_000_000 })] });
        const list = vi.spyOn(harness.registry, 'list');
        await harness.controller.start();
        const staleTimer = harness.fakeScheduler.activeTimers()[0];

        harness.controller.wake();
        const evaluationsBeforeStaleCallback = list.mock.calls.length;
        harness.fakeScheduler.fire(staleTimer, true);

        expect(list).toHaveBeenCalledTimes(evaluationsBeforeStaleCallback);
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        expect(typeof harness.controller.controllerTokenCounter).toBe('bigint');
        harness.controller.stop();
    });

    it('[Task 1.5] discards pending mutations and releases idle waiters when stopped before a microtask wake', async () => {
        const reservation = makeReserve({ id: 532, startAt: 2_000_000, endAt: 2_100_000 });
        const harness = makeScheduleHarness();
        await harness.controller.start();
        harness.controller.acceptMutation({ insert: [reservation], isSuppressLog: false });
        const staleWake = harness.fakeScheduler.microtasks.shift();
        expect(staleWake).toBeTypeOf('function');
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(0);

        let idleResolved = false;
        const idle = harness.controller.whenIdle().then(() => {
            idleResolved = true;
        });
        await Promise.resolve();
        expect(idleResolved).toBe(false);

        harness.controller.stop();
        await idle;
        expect(idleResolved).toBe(true);
        expect(harness.registry.get(reservation.id)).toBeUndefined();
        expect(harness.dispatchMutation).not.toHaveBeenCalled();

        await harness.controller.start();
        const activeWake = harness.fakeScheduler.activeTimers()[0];
        staleWake!();
        expect(harness.registry.get(reservation.id)).toBeUndefined();
        expect(harness.dispatchMutation).not.toHaveBeenCalled();
        expect(harness.fakeScheduler.activeTimers()).toEqual([activeWake]);
        harness.controller.stop();
    });

    it('[Task 1.5] scans a current time-specified ending milestone with the same shared wake', async () => {
        const harness = makeScheduleHarness({
            now: 1_000_000,
            reservations: [makeReserve({ id: 541, isTimeSpecified: true, startAt: 900_000, endAt: 1_000_000 })],
        });
        const candidate = harness.registry.get(541);
        expect(harness.registry.tryTransitionPhase(541, candidate.generation, 'Waiting', 'Recording')).toBe(true);
        harness.controller.registerTimeSpecifiedEnd({
            reservationId: 541,
            generation: candidate.generation,
            dueAt: 1_000_000,
        });

        await harness.controller.start();

        expect(harness.dispatchTimeSpecifiedEnd).toHaveBeenCalledOnce();
        expect(harness.dispatchTimeSpecifiedEnd.mock.calls[0][0]).toMatchObject({
            reservationId: 541,
            dueAt: 1_000_000,
        });
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        harness.controller.wake();
        expect(harness.dispatchTimeSpecifiedEnd).toHaveBeenCalledOnce();
        harness.controller.stop();
    });

    it.each([
        ['program recording', false, 'Recording'],
        ['waiting time-specified recording', true, 'Waiting'],
        ['completed time-specified recording', true, 'Completed'],
    ])('[Task 1.5] rejects a non-active ending milestone for %s', async (_case, isTimeSpecified, phase) => {
        const harness = makeScheduleHarness({
            now: 1_000_000,
            reservations: [makeReserve({ id: 545, isTimeSpecified, startAt: 2_000_000, endAt: 2_100_000 })],
        });
        const candidate = harness.registry.get(545);
        if (phase !== 'Waiting') {
            expect(harness.registry.tryTransitionPhase(545, candidate.generation, 'Waiting', phase)).toBe(true);
        }
        harness.controller.registerTimeSpecifiedEnd({
            reservationId: 545,
            generation: candidate.generation,
            dueAt: 1_000_000,
        });
        expect(harness.controller.timeSpecifiedEnds.size).toBe(0);

        await harness.controller.start();

        expect(harness.dispatchTimeSpecifiedEnd).not.toHaveBeenCalled();
        expect(harness.controller.timeSpecifiedEnds.size).toBe(0);
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        harness.controller.stop();
    });

    it('[Task 1.5] drops a time-specified ending milestone after same-id generation replacement', async () => {
        const harness = makeScheduleHarness({
            now: 1_000_000,
            reservations: [makeReserve({ id: 546, isTimeSpecified: true, startAt: 900_000, endAt: 1_010_000 })],
        });
        const old = harness.registry.get(546);
        expect(harness.registry.tryTransitionPhase(546, old.generation, 'Waiting', 'Recording')).toBe(true);
        harness.controller.registerTimeSpecifiedEnd({
            reservationId: 546,
            generation: old.generation,
            dueAt: 1_000_000,
        });
        const current = harness.registry.upsert(
            makeReserve({ id: 546, isTimeSpecified: true, startAt: 2_000_000, endAt: 2_010_000 }),
        );

        await harness.controller.start();

        expect(current.generation).not.toBe(old.generation);
        expect(harness.dispatchTimeSpecifiedEnd).not.toHaveBeenCalled();
        expect(harness.controller.timeSpecifiedEnds.size).toBe(0);
        harness.controller.stop();
    });

    it('[Task 1.5] rechecks active phase before dispatching a registered time-specified ending', async () => {
        const harness = makeScheduleHarness({
            now: 1_000_000,
            reservations: [makeReserve({ id: 547, isTimeSpecified: true, startAt: 900_000, endAt: 1_010_000 })],
        });
        const candidate = harness.registry.get(547);
        expect(harness.registry.tryTransitionPhase(547, candidate.generation, 'Waiting', 'Recording')).toBe(true);
        harness.controller.registerTimeSpecifiedEnd({
            reservationId: 547,
            generation: candidate.generation,
            dueAt: 1_000_000,
        });
        expect(harness.registry.tryTransitionPhase(547, candidate.generation, 'Recording', 'Completed')).toBe(true);

        await harness.controller.start();

        expect(harness.dispatchTimeSpecifiedEnd).not.toHaveBeenCalled();
        expect(harness.controller.timeSpecifiedEnds.size).toBe(0);
        harness.controller.stop();
    });

    it('[Task 1.5 mutation] retains a due time-specified ending when its session claim is lost', async () => {
        const reservationId = 548;
        const harness = makeScheduleHarness({
            now: 1_000_000,
            reservations: [
                makeReserve({
                    id: reservationId,
                    isTimeSpecified: true,
                    programId: null,
                    startAt: 900_000,
                    endAt: 1_010_000,
                }),
            ],
        });
        const waiting = harness.controller.getSessionSnapshot(reservationId);
        expect(
            harness.controller.tryTransitionSession(
                reservationId,
                waiting.generation,
                waiting.sessionToken,
                'Waiting',
                'Recording',
            ),
        ).toBe(true);
        const recording = harness.controller.getSessionSnapshot(reservationId);
        harness.controller.registerTimeSpecifiedEnd({ ...recording, dueAt: 1_000_000 });
        vi.spyOn(harness.controller, 'tryTransitionSession').mockReturnValue(false);

        await harness.controller.start();

        expect(harness.dispatchTimeSpecifiedEnd).not.toHaveBeenCalled();
        expect(harness.controller.timeSpecifiedEnds.get(reservationId)).toEqual({
            reservationId,
            generation: recording.generation,
            sessionToken: recording.sessionToken,
            dueAt: 1_000_000,
            phase: 'Recording',
        });
        expect(harness.registry.get(reservationId)).toMatchObject({ phase: 'Recording' });
        expect(harness.fakeScheduler.microtasks).toHaveLength(1);
        harness.controller.stop();
    });

    it('[Task 1.5 mutation] applies reentrant mutation before a later due time-specified ending', async () => {
        const first = makeReserve({
            id: 549,
            isTimeSpecified: true,
            programId: null,
            startAt: 900_000,
            endAt: 1_010_000,
        });
        const second = makeReserve({
            id: 550,
            isTimeSpecified: true,
            programId: null,
            startAt: 900_000,
            endAt: 1_010_000,
        });
        let harness: ReturnType<typeof makeScheduleHarness>;
        const dispatchTimeSpecifiedEnd = vi.fn((milestone: any) => {
            if (milestone.reservationId === first.id) {
                harness.controller.acceptMutation({ delete: [second], isSuppressLog: true });
            }
        });
        harness = makeScheduleHarness({
            now: 1_000_000,
            reservations: [first, second],
            dispatchTimeSpecifiedEnd,
        });
        for (const reservation of [first, second]) {
            const waiting = harness.controller.getSessionSnapshot(reservation.id);
            expect(
                harness.controller.tryTransitionSession(
                    reservation.id,
                    waiting.generation,
                    waiting.sessionToken,
                    'Waiting',
                    'Recording',
                ),
            ).toBe(true);
            const recording = harness.controller.getSessionSnapshot(reservation.id);
            harness.controller.registerTimeSpecifiedEnd({ ...recording, dueAt: 1_000_000 });
        }

        await harness.controller.start();

        expect(dispatchTimeSpecifiedEnd.mock.calls.map(([milestone]: any[]) => milestone.reservationId)).toEqual([
            first.id,
        ]);
        expect(harness.registry.get(second.id)).toBeUndefined();
        expect(harness.controller.timeSpecifiedEnds.has(second.id)).toBe(false);
        expect(harness.dispatchMutation).toHaveBeenCalledWith(expect.objectContaining({ reservationId: second.id }));
        harness.controller.stop();
    });

    it('[Task 1.5 mutation] removes an obsolete ending after the same session enters retry waiting', async () => {
        const reservationId = 552;
        const harness = makeScheduleHarness({
            now: 1_000_000,
            reservations: [
                makeReserve({
                    id: reservationId,
                    isTimeSpecified: true,
                    programId: null,
                    startAt: 900_000,
                    endAt: 1_010_000,
                }),
            ],
        });
        const waiting = harness.controller.getSessionSnapshot(reservationId);
        expect(
            harness.controller.tryTransitionSession(
                reservationId,
                waiting.generation,
                waiting.sessionToken,
                'Waiting',
                'Recording',
            ),
        ).toBe(true);
        const recording = harness.controller.getSessionSnapshot(reservationId);
        harness.controller.registerTimeSpecifiedEnd({ ...recording, dueAt: 1_000_000 });
        expect(
            harness.controller.tryTransitionSession(
                reservationId,
                recording.generation,
                recording.sessionToken,
                'Recording',
                'RetryWaiting',
            ),
        ).toBe(true);

        await harness.controller.start();

        expect(harness.registry.get(reservationId)).toMatchObject({ phase: 'RetryWaiting' });
        expect(harness.dispatchTimeSpecifiedEnd).not.toHaveBeenCalled();
        expect(harness.controller.timeSpecifiedEnds.has(reservationId)).toBe(false);
        harness.controller.stop();
    });

    it('[Task 1.5 mutation] reports a synchronous preparation throw and continues later due work', async () => {
        const failure = new Error('synthetic synchronous preparation failure');
        const dispatchPreparation = vi.fn((candidate: any) => {
            if (candidate.reservationId === 553) throw failure;
        });
        const harness = makeScheduleHarness({
            now: 1_000_000,
            reservations: [
                makeReserve({ id: 553, startAt: 1_015_000, endAt: 1_100_000 }),
                makeReserve({ id: 554, startAt: 1_015_000, endAt: 1_100_000 }),
            ],
            dispatchPreparation,
        });

        await expect(harness.controller.start()).resolves.toBeUndefined();

        expect(dispatchPreparation.mock.calls.map(([candidate]: any[]) => candidate.reservationId)).toEqual([553, 554]);
        expect(harness.reportDispatchError).toHaveBeenCalledOnce();
        expect(harness.reportDispatchError).toHaveBeenCalledWith(
            failure,
            expect.objectContaining({ reservationId: 553, phase: 'Preparing' }),
        );
        expect(harness.registry.get(554)).toMatchObject({ phase: 'Preparing' });
        harness.controller.stop();
    });

    it('[Task 1.5] reports launch rejection locally and releases every scheduler resource on stop', async () => {
        const failure = new Error('synthetic preparation failure');
        const harness = makeScheduleHarness({
            dispatchPreparation: vi.fn(async () => Promise.reject(failure)),
            reservations: [makeReserve({ id: 551, startAt: 1_015_000 })],
        });
        await harness.controller.start();
        await flushImmediate();

        expect(harness.reportDispatchError).toHaveBeenCalledWith(
            failure,
            expect.objectContaining({ reservationId: 551 }),
        );
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        harness.controller.registerTimeSpecifiedEnd({
            reservationId: 551,
            generation: harness.registry.get(551).generation,
            dueAt: 2_000_000,
        });
        const staleTimer = harness.fakeScheduler.activeTimers()[0];
        harness.controller.stop();
        harness.fakeScheduler.fire(staleTimer, true);
        harness.fakeScheduler.flushMicrotasks();

        expect(harness.fakeScheduler.activeTimers()).toHaveLength(0);
        expect(harness.controller.timeSpecifiedEnds.size).toBe(0);
        expect(harness.dispatchPreparation).toHaveBeenCalledOnce();
    });
});

describe('recording schedule controller construction and observer boundaries', () => {
    it('[Task 1.7 gap] defaults dispatchMutation and dispatchReset to no-ops when the caller omits them', async () => {
        const registry = new RecordingCandidateRegistry();
        const fakeScheduler = makeFakeRecordingScheduler();
        const dispatchPreparation = vi.fn();
        const dispatchTimeSpecifiedEnd = vi.fn();
        const reportDispatchError = vi.fn();
        const controller = new RecordingScheduleController({
            candidateRegistry: registry,
            clock: { now: () => 1_000_000 },
            dispatchPreparation,
            dispatchTimeSpecifiedEnd,
            reportDispatchError,
            scheduler: fakeScheduler.scheduler,
        });

        try {
            await controller.start();
            expect(() =>
                controller.acceptMutation({
                    insert: [makeReserve({ id: 561, startAt: 2_000_000 })],
                    isSuppressLog: false,
                }),
            ).not.toThrow();
            fakeScheduler.flushMicrotasks();
            await flushImmediate();
            expect(reportDispatchError).not.toHaveBeenCalled();

            controller.requestReset();
            fakeScheduler.flushMicrotasks();
            await flushImmediate();
            expect(reportDispatchError).not.toHaveBeenCalled();
        } finally {
            controller.stop();
        }
    });

    it('[Task 1.7 gap] treats a second start() call as a no-op', async () => {
        const harness = makeScheduleHarness();
        await harness.controller.start();
        const setTimeoutCalls = harness.fakeScheduler.scheduler.setTimeout.mock.calls.length;

        await expect(harness.controller.start()).resolves.toBeUndefined();

        expect(harness.fakeScheduler.scheduler.setTimeout).toHaveBeenCalledTimes(setTimeoutCalls);
        harness.controller.stop();
    });

    it('[Task 1.7 gap] swallows a reportDispatchError observer failure without leaking it', async () => {
        const failure = new Error('synthetic mutation dispatch failure');
        const observerFailure = new Error('synthetic reportDispatchError observer failure');
        const reportDispatchError = vi.fn(() => {
            throw observerFailure;
        });
        const harness = makeScheduleHarness({
            dispatchMutation: vi.fn(() => Promise.reject(failure)),
            reportDispatchError,
        });
        await harness.controller.start();

        expect(() =>
            harness.controller.acceptMutation({
                insert: [makeReserve({ id: 562, startAt: 2_000_000 })],
                isSuppressLog: false,
            }),
        ).not.toThrow();
        harness.fakeScheduler.flushMicrotasks();
        await flushImmediate();

        expect(reportDispatchError).toHaveBeenCalledWith(
            failure,
            expect.objectContaining({ action: 'insert', reservationId: 562 }),
        );
        harness.controller.stop();
    });

    it('[Task 1.7 gap] skips a time-specified milestone whose candidate no longer exists', async () => {
        const reservationId = 563;
        const reservation = makeReserve({
            id: reservationId,
            isTimeSpecified: true,
            programId: null,
            startAt: 2_000_000,
            endAt: 2_100_000,
        });
        const harness = makeScheduleHarness({ reservations: [reservation] });
        const waiting = harness.controller.getSessionSnapshot(reservationId);
        expect(
            harness.controller.tryTransitionSession(
                reservationId,
                waiting.generation,
                waiting.sessionToken,
                'Waiting',
                'Recording',
            ),
        ).toBe(true);
        const session = harness.controller.getSessionSnapshot(reservationId);
        harness.controller.registerTimeSpecifiedEnd({
            reservationId,
            generation: session.generation,
            sessionToken: session.sessionToken,
            dueAt: 2_100_000,
        });
        expect(harness.controller.timeSpecifiedEnds.has(reservationId)).toBe(true);
        harness.registry.remove(reservationId);

        // Real start() -> evaluate() -> dispatchDueTimeSpecifiedEnds() path instead of writing the
        // private `started` flag and invoking the private method directly: the reservation was
        // already removed from the registry above (the same registry instance the controller
        // itself was constructed with), so this evaluate() pass genuinely finds the milestone's
        // candidate gone, exactly the state this guard protects against.
        await expect(harness.controller.start()).resolves.toBeUndefined();

        expect(harness.dispatchTimeSpecifiedEnd).not.toHaveBeenCalled();
        harness.controller.stop();
    });

    it('[Task 1.7 gap] drops a stale time-specified milestone from schedulerOwnedDeadlines when its candidate is gone', () => {
        const reservationId = 564;
        const reservation = makeReserve({
            id: reservationId,
            isTimeSpecified: true,
            programId: null,
            startAt: 2_000_000,
            endAt: 2_100_000,
        });
        const harness = makeScheduleHarness({ reservations: [reservation] });
        const waiting = harness.controller.getSessionSnapshot(reservationId);
        expect(
            harness.controller.tryTransitionSession(
                reservationId,
                waiting.generation,
                waiting.sessionToken,
                'Waiting',
                'Recording',
            ),
        ).toBe(true);
        const session = harness.controller.getSessionSnapshot(reservationId);
        harness.controller.registerTimeSpecifiedEnd({
            reservationId,
            generation: session.generation,
            sessionToken: session.sessionToken,
            dueAt: 2_100_000,
        });
        expect(harness.controller.timeSpecifiedEnds.has(reservationId)).toBe(true);
        harness.registry.remove(reservationId);

        const deadlines = (harness.controller as any).schedulerOwnedDeadlines() as number[];

        expect(deadlines).not.toContain(2_100_000);
        expect(harness.controller.timeSpecifiedEnds.has(reservationId)).toBe(false);
    });
});
