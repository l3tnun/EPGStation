import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    computeNextRecordingScheduleDelay,
    deferred,
    makeManager,
    makeReserve,
    makeScheduleHarness,
    RecordingCandidateRegistry,
} from './_harness';

afterEach(() => vi.useRealTimers());

describe('legacy recording candidates', () => {
    it('[Task 1.1] schedules normal and conflict inserts while excluding skip and overlap', async () => {
        const harness = makeManager();
        const rows = [
            makeReserve({ id: 1 }),
            makeReserve({ id: 2, isConflict: true }),
            makeReserve({ id: 3, isSkip: true }),
            makeReserve({ id: 4, isOverlap: true }),
        ];
        await harness.model.update({ insert: rows, isSuppressLog: false });
        expect(harness.provider).toHaveBeenCalledTimes(2);
        expect(harness.recorder.setTimer.mock.calls.map(([row]: any[]) => row.id)).toEqual([1, 2]);
        expect(harness.model.hasReserve(1)).toBe(true);
        expect(harness.model.hasReserve(3)).toBe(false);
    });

    it('[Task 1.1] obtains one recorder instance and timer per accepted reservation', async () => {
        const recorders = [
            { setTimer: vi.fn(() => true), update: vi.fn(), cancel: vi.fn(), resetTimer: vi.fn() },
            { setTimer: vi.fn(() => true), update: vi.fn(), cancel: vi.fn(), resetTimer: vi.fn() },
        ];
        const provider = vi.fn(async () => recorders.shift()!);
        const harness = makeManager({ provider });
        await harness.model.update({
            insert: [makeReserve({ id: 11 }), makeReserve({ id: 12 })],
            isSuppressLog: false,
        });
        expect(provider).toHaveBeenCalledTimes(2);
        expect(harness.model.recordingIndex[11]).not.toBe(harness.model.recordingIndex[12]);
        expect(harness.model.recordingIndex[11].setTimer).toHaveBeenCalledOnce();
        expect(harness.model.recordingIndex[12].setTimer).toHaveBeenCalledOnce();
    });

    it('[Task 1.1] keeps a legacy timer monotonic across a wall-clock jump until reset', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const harness = makeManager();
        const recorder = harness.recorder;
        recorder.setTimer = vi.fn(() => true);
        harness.model.recordingIndex[31] = recorder;
        vi.setSystemTime(9_000_000);
        expect(recorder.setTimer).not.toHaveBeenCalled();
        harness.model.resetTimer();
        expect(recorder.resetTimer).toHaveBeenCalledOnce();
    });

    it('[Task 1.1] replaces a deleted reservation id with a fresh recorder and ignores the old instance', async () => {
        const first = { setTimer: vi.fn(() => true), update: vi.fn(), cancel: vi.fn(), resetTimer: vi.fn() };
        const second = { setTimer: vi.fn(() => true), update: vi.fn(), cancel: vi.fn(), resetTimer: vi.fn() };
        const provider = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
        const harness = makeManager({ provider });
        const oldReservation = makeReserve({ id: 41 });
        await harness.model.update({ insert: [oldReservation], isSuppressLog: false });
        await harness.model.update({ delete: [oldReservation], isSuppressLog: false });
        await harness.model.update({
            insert: [makeReserve({ id: 41, startAt: oldReservation.startAt + 10_000 })],
            isSuppressLog: false,
        });
        expect(first.cancel).toHaveBeenCalledWith(false);
        expect(harness.model.recordingIndex[41]).toBe(second);
        expect(second.setTimer).toHaveBeenCalledOnce();
    });
});

describe('recording candidate registry', () => {
    it('[RE-1.1][Task 1.3] keeps the latest normal or conflict snapshot for each reservation id', () => {
        const registry = new RecordingCandidateRegistry();
        const normal = makeReserve({ id: 101, startAt: 1_000_000, endAt: 1_060_000 });
        const conflict = makeReserve({ id: 102, isConflict: true, isTimeSpecified: true });

        const first = registry.upsert(normal);
        const second = registry.upsert(conflict);
        normal.startAt = 9_000_000;
        const latest = registry.upsert(makeReserve({ id: 101, startAt: 1_030_000, endAt: 1_090_000 }));

        expect(first).toMatchObject({
            reservationId: 101,
            startAt: 1_000_000,
            endAt: 1_060_000,
            prepareAt: 985_000,
            kind: 'Program',
            state: 'Normal',
            phase: 'Waiting',
        });
        expect(first.reservation.startAt).toBe(1_000_000);
        expect(second).toMatchObject({ reservationId: 102, kind: 'TimeSpecified', state: 'Conflict' });
        expect(registry.list().map((candidate: any) => candidate.reservationId)).toEqual([101, 102]);
        expect(registry.get(101)).toBe(latest);
        expect(latest.generation).toBeGreaterThan(first.generation);
    });

    it('[RE-1.2][Task 1.3] excludes skip and overlap states while advancing their tombstone generations', () => {
        const registry = new RecordingCandidateRegistry();
        const accepted = registry.upsert(makeReserve({ id: 111 }));
        const skipped = registry.upsert(makeReserve({ id: 111, isSkip: true }));
        const skippedGeneration = registry.latestGeneration(111);
        const overlapped = registry.upsert(makeReserve({ id: 112, isOverlap: true }));

        expect(skipped).toBeNull();
        expect(overlapped).toBeNull();
        expect(registry.get(111)).toBeUndefined();
        expect(skippedGeneration).toBeGreaterThan(accepted.generation);
        expect(registry.latestGeneration(112)).toBeTypeOf('bigint');
        expect(registry.list()).toEqual([]);
    });

    it('[Task 1.3] advances an opaque generation for add, update, delete, re-add, and rebuild', () => {
        const registry = new RecordingCandidateRegistry();
        const added = registry.upsert(makeReserve({ id: 121, startAt: 1_020_000 }));
        const updated = registry.upsert(makeReserve({ id: 121, startAt: 1_030_000 }));
        const deletedGeneration = registry.remove(121);
        const readded = registry.upsert(makeReserve({ id: 121, startAt: 1_040_000 }));
        registry.rebuild([
            makeReserve({ id: 121, startAt: 1_050_000 }),
            makeReserve({ id: 122, isConflict: true }),
            makeReserve({ id: 123, isSkip: true }),
        ]);
        const rebuilt = registry.get(121);

        const observedGenerations = [
            added.generation,
            updated.generation,
            deletedGeneration,
            readded.generation,
            rebuilt.generation,
        ];
        expect(new Set(observedGenerations).size).toBe(observedGenerations.length);
        expect(typeof rebuilt.generation).toBe('bigint');
        expect(added.generation < updated.generation).toBe(true);
        expect(updated.generation < deletedGeneration).toBe(true);
        expect(deletedGeneration < readded.generation).toBe(true);
        expect(readded.generation < rebuilt.generation).toBe(true);
        expect(registry.list().map((candidate: any) => candidate.reservationId)).toEqual([121, 122]);
    });

    it('[Task 1.7 mutation gap] invalidates removed rebuild ids and handles absent/current CAS boundaries', () => {
        const registry = new RecordingCandidateRegistry();
        const removedByRebuild = registry.upsert(makeReserve({ id: 124 }));
        const removable = registry.upsert(makeReserve({ id: 125 }));
        const phaseGuarded = registry.upsert(makeReserve({ id: 126 }));

        registry.rebuild([makeReserve({ id: 126, startAt: 1_030_000 })]);

        expect(registry.latestGeneration(124)).toBeGreaterThan(removedByRebuild.generation);
        expect(() => registry.isCurrent(999, removedByRebuild.generation)).not.toThrow();
        expect(registry.isCurrent(999, removedByRebuild.generation)).toBe(false);
        expect(registry.removeIfCurrent(125, removable.generation)).toBe(false);

        const current = registry.get(126);
        expect(registry.tryTransitionPhase(999, current.generation, 'Waiting', 'Preparing')).toBe(false);
        expect(registry.tryTransitionPhase(126, current.generation, 'Recording', 'Preparing')).toBe(false);
        expect(registry.get(126).phase).toBe('Waiting');

        const exact = registry.upsert(makeReserve({ id: 127 }));
        expect(registry.removeIfCurrent(127, exact.generation)).toBe(true);
        expect(registry.get(127)).toBeUndefined();
    });

    it('[RE-1.7][Task 1.3] fences deferred preparation, ending, and cancelled callbacks after delete and re-add', async () => {
        const registry = new RecordingCandidateRegistry();
        const old = registry.upsert(makeReserve({ id: 131 }));
        const completion = deferred<void>();
        const failure = deferred<void>();
        const effects: string[] = [];

        const latePreparation = completion.promise.then(() => {
            if (registry.tryTransitionPhase(131, old.generation, 'Waiting', 'Preparing')) effects.push('prepare');
        });
        const lateEnding = failure.promise.catch(() => {
            if (registry.tryTransitionPhase(131, old.generation, 'Preparing', 'Completed')) effects.push('end');
        });
        const lateCancelledCallback = completion.promise.then(() => {
            if (registry.removeIfCurrent(131, old.generation)) effects.push('cancel');
        });

        registry.remove(131);
        const current = registry.upsert(makeReserve({ id: 131, startAt: old.startAt + 30_000 }));
        completion.resolve();
        failure.reject(new Error('synthetic stale ending failure'));
        await Promise.all([latePreparation, lateEnding, lateCancelledCallback]);

        expect(effects).toEqual([]);
        expect(registry.get(131)).toBe(current);
        expect(registry.get(131)).toMatchObject({ generation: current.generation, phase: 'Waiting' });
        expect(registry.tryTransitionPhase(131, current.generation, 'Waiting', 'Preparing')).toBe(true);
        expect(registry.get(131).phase).toBe('Preparing');
    });

    it('[RE-1.7][Task 1.3] keeps generations bigint-only beyond the safe integer range without serialization', () => {
        const registry = new RecordingCandidateRegistry();
        registry.generationCounter = BigInt(Number.MAX_SAFE_INTEGER);

        const beyondSafeInteger = registry.upsert(makeReserve({ id: 141 }));
        const following = registry.upsert(makeReserve({ id: 142 }));

        expect(beyondSafeInteger.generation).toBe(BigInt(Number.MAX_SAFE_INTEGER) + 1n);
        expect(following.generation).toBe(beyondSafeInteger.generation + 1n);
        expect(typeof following.generation).toBe('bigint');
        expect(beyondSafeInteger.toJSON).toBeUndefined();
        expect(() => JSON.stringify(beyondSafeInteger)).toThrow(TypeError);
    });

    it('[RE-1.7][Task 1.7 mutation] keeps controller and session tokens monotonic beyond safe integers', async () => {
        const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);
        const harness = makeScheduleHarness({
            reservations: [makeReserve({ id: 143 }), makeReserve({ id: 144 })],
        });
        harness.controller.controllerTokenCounter = maximumSafeInteger;
        harness.controller.sessionTokenCounter = maximumSafeInteger;

        const firstSession = harness.controller.getSessionSnapshot(143);
        const repeatedFirstSession = harness.controller.getSessionSnapshot(143);
        const secondSession = harness.controller.getSessionSnapshot(144);
        await harness.controller.start();
        const firstControllerToken = harness.controller.currentControllerToken;
        harness.controller.wake();
        const followingControllerToken = harness.controller.currentControllerToken;

        expect(firstSession.sessionToken).toBe(maximumSafeInteger + 1n);
        expect(repeatedFirstSession.sessionToken).toBe(firstSession.sessionToken);
        expect(secondSession.sessionToken).toBe(maximumSafeInteger + 2n);
        expect(typeof secondSession.sessionToken).toBe('bigint');
        expect(firstControllerToken).toBe(maximumSafeInteger + 2n);
        expect(followingControllerToken).toBe(maximumSafeInteger + 4n);
        expect(typeof followingControllerToken).toBe('bigint');
        expect(() => JSON.stringify(firstSession)).toThrow(TypeError);
        harness.controller.stop();
    });
});

describe('recording schedule contract', () => {
    it('[RE-2.6/2.7][Task 1.9] replaces an active time-specified end and finishes once at the latest wall clock', async () => {
        const harness = makeScheduleHarness({ now: 1_000_000 });
        await harness.controller.start();
        harness.controller.acceptMutation({
            insert: [
                makeReserve({
                    id: 181,
                    isTimeSpecified: true,
                    programId: null,
                    startAt: 2_000_000,
                    endAt: 1_010_000,
                }),
            ],
            isSuppressLog: false,
        });
        harness.fakeScheduler.flushMicrotasks();
        const first = harness.controller.getSessionSnapshot(181);
        expect(
            harness.controller.tryTransitionSession(181, first.generation, first.sessionToken, 'Waiting', 'Recording'),
        ).toBe(true);
        harness.controller.registerTimeSpecifiedEnd({
            reservationId: 181,
            generation: first.generation,
            sessionToken: first.sessionToken,
            dueAt: 1_010_000,
        });

        harness.controller.acceptMutation({
            update: [
                makeReserve({
                    id: 181,
                    isTimeSpecified: true,
                    programId: null,
                    startAt: 2_000_000,
                    endAt: 1_020_000,
                }),
            ],
            isSuppressLog: false,
        });
        harness.fakeScheduler.flushMicrotasks();
        const current = harness.controller.getSessionSnapshot(181);
        expect(current.generation).not.toBe(first.generation);
        expect(current.sessionToken).toBe(first.sessionToken);
        expect(current.phase).toBe('Recording');
        expect(harness.controller.timeSpecifiedEnds.size).toBe(0);
        harness.controller.registerTimeSpecifiedEnd({
            reservationId: 181,
            generation: current.generation,
            sessionToken: current.sessionToken,
            dueAt: 1_025_000,
        });

        harness.now.value = 1_010_000;
        harness.controller.wake();
        expect(harness.dispatchTimeSpecifiedEnd).not.toHaveBeenCalled();

        harness.now.value = 1_030_000;
        harness.controller.wake();
        expect(harness.dispatchTimeSpecifiedEnd).toHaveBeenCalledOnce();
        expect(harness.dispatchTimeSpecifiedEnd).toHaveBeenCalledWith(
            expect.objectContaining({
                reservationId: 181,
                generation: current.generation,
                sessionToken: current.sessionToken,
                dueAt: 1_025_000,
            }),
        );
        expect(harness.registry.get(181).phase).toBe('Finishing');
        harness.controller.wake();
        expect(harness.dispatchTimeSpecifiedEnd).toHaveBeenCalledOnce();
        harness.controller.stop();
    });

    it('[RE-2.6/2.7][Task 1.9] ends first-data waiting but removes cancelled/completed and program milestones', async () => {
        const harness = makeScheduleHarness({ now: 1_000_000 });
        await harness.controller.start();
        harness.controller.acceptMutation({
            insert: [
                makeReserve({ id: 182, isTimeSpecified: true, programId: null, startAt: 2_000_000 }),
                makeReserve({ id: 183, isTimeSpecified: true, programId: null, startAt: 2_000_000 }),
                makeReserve({ id: 184, isTimeSpecified: true, programId: null, startAt: 2_000_000 }),
                makeReserve({ id: 185, isTimeSpecified: false, programId: 185, startAt: 2_000_000 }),
            ],
            isSuppressLog: false,
        });
        harness.fakeScheduler.flushMicrotasks();

        const firstData = harness.controller.getSessionSnapshot(182);
        expect(
            harness.controller.tryTransitionSession(
                182,
                firstData.generation,
                firstData.sessionToken,
                'Waiting',
                'AwaitingFirstData',
            ),
        ).toBe(true);
        harness.controller.registerTimeSpecifiedEnd({ ...firstData, dueAt: 1_000_000 });

        for (const [reservationId, terminalPhase] of [
            [183, 'Cancelled'],
            [184, 'Completed'],
        ] as const) {
            const session = harness.controller.getSessionSnapshot(reservationId);
            expect(
                harness.controller.tryTransitionSession(
                    reservationId,
                    session.generation,
                    session.sessionToken,
                    'Waiting',
                    'Recording',
                ),
            ).toBe(true);
            const active = harness.controller.getSessionSnapshot(reservationId);
            harness.controller.registerTimeSpecifiedEnd({ ...active, dueAt: 1_001_000 });
            expect(
                harness.controller.tryTransitionSession(
                    reservationId,
                    active.generation,
                    active.sessionToken,
                    'Recording',
                    terminalPhase,
                ),
            ).toBe(true);
        }

        const program = harness.controller.getSessionSnapshot(185);
        expect(
            harness.controller.tryTransitionSession(
                185,
                program.generation,
                program.sessionToken,
                'Waiting',
                'Recording',
            ),
        ).toBe(true);
        harness.controller.registerTimeSpecifiedEnd({ ...program, dueAt: 1_000_000 });
        harness.controller.wake();

        expect(harness.dispatchTimeSpecifiedEnd).toHaveBeenCalledOnce();
        expect(harness.dispatchTimeSpecifiedEnd.mock.calls[0][0].reservationId).toBe(182);
        expect(harness.registry.get(182).phase).toBe('Finishing');
        expect(harness.registry.get(183).phase).toBe('Cancelled');
        expect(harness.registry.get(184).phase).toBe('Completed');
        expect(harness.registry.get(185).phase).toBe('Recording');
        expect(harness.controller.timeSpecifiedEnds.size).toBe(0);
        harness.controller.stop();
    });

    it('[RE-1.5/1.7][Task 1.7] synchronously accepts and coalesces a mutation burst before applying latest state', async () => {
        const harness = makeScheduleHarness();
        await harness.controller.start();
        const initialTimer = harness.fakeScheduler.activeTimers()[0];
        const inserted = makeReserve({ id: 191, startAt: 1_030_000, endAt: 1_090_000 });
        const updated = makeReserve({ id: 191, startAt: 1_040_000, endAt: 1_100_000 });

        expect(() => {
            harness.controller.acceptMutation({ insert: [inserted], isSuppressLog: false });
            harness.controller.acceptMutation({ update: [updated], isSuppressLog: true });
            harness.controller.requestReset();
        }).not.toThrow();

        expect(harness.registry.get(191)).toBeUndefined();
        expect(harness.fakeScheduler.microtasks).toHaveLength(1);
        expect(initialTimer.cancelled).toBe(true);

        harness.fakeScheduler.flushMicrotasks();

        expect(harness.registry.get(191)).toMatchObject({
            reservation: expect.objectContaining({ startAt: 1_040_000 }),
            startAt: 1_040_000,
            phase: 'Waiting',
        });
        expect(harness.dispatchMutation.mock.calls.map(([mutation]: any[]) => mutation.action)).toEqual([
            'insert',
            'update',
        ]);
        expect(harness.dispatchReset).toHaveBeenCalledOnce();
        expect(harness.fakeScheduler.scheduler.queueMicrotask).toHaveBeenCalledOnce();
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        harness.controller.stop();
    });

    it('[RE-1.5/1.7][Task 1.7] applies the accepted reservation snapshot instead of later caller mutations', async () => {
        const harness = makeScheduleHarness();
        await harness.controller.start();
        const reservation = makeReserve({ id: 192, startAt: 1_030_000, endAt: 1_090_000 });
        const rows = [reservation];
        const mutation = { insert: rows, isSuppressLog: false };

        harness.controller.acceptMutation(mutation);
        reservation.id = 9_192;
        reservation.startAt = 9_000_000;
        reservation.endAt = 9_100_000;
        rows.splice(0);
        mutation.isSuppressLog = true;
        harness.fakeScheduler.flushMicrotasks();

        expect(harness.registry.get(192)).toMatchObject({
            endAt: 1_090_000,
            reservation: expect.objectContaining({ id: 192, startAt: 1_030_000, endAt: 1_090_000 }),
            startAt: 1_030_000,
        });
        expect(harness.registry.get(9_192)).toBeUndefined();
        expect(harness.dispatchMutation).toHaveBeenCalledOnce();
        expect(harness.dispatchMutation.mock.calls[0][0]).toMatchObject({
            action: 'insert',
            isSuppressLog: false,
            reservation: expect.objectContaining({ id: 192, startAt: 1_030_000, endAt: 1_090_000 }),
            reservationId: 192,
        });
        harness.controller.stop();
    });

    it('[RE-1.5][Task 1.7] never throws at the mutation boundary and records malformed work locally', async () => {
        const harness = makeScheduleHarness();
        await harness.controller.start();
        const activeWake = harness.fakeScheduler.activeTimers()[0];

        expect(() => harness.controller.acceptMutation(null)).not.toThrow();
        expect(() => harness.controller.acceptMutation({ insert: 'not-an-array', isSuppressLog: false })).not.toThrow();
        expect(() => harness.controller.acceptMutation({ insert: [null], isSuppressLog: false })).not.toThrow();
        expect(() => harness.controller.acceptMutation({ insert: [7], isSuppressLog: false })).not.toThrow();
        expect(() =>
            harness.controller.acceptMutation({ insert: [{ id: 'not-a-number' }], isSuppressLog: false }),
        ).not.toThrow();
        expect(() => harness.controller.acceptMutation({ insert: [makeReserve({ id: 193 })] })).not.toThrow();
        expect(() =>
            harness.controller.acceptMutation({ insert: [makeReserve({ id: 194 })], isSuppressLog: 'false' }),
        ).not.toThrow();
        expect(() =>
            harness.controller.acceptMutation(
                Object.assign(() => undefined, {
                    insert: [makeReserve({ id: 195 })],
                    isSuppressLog: false,
                }),
            ),
        ).not.toThrow();
        expect(() =>
            harness.controller.acceptMutation({
                insert: [Object.assign(() => undefined, { id: 196 })],
                isSuppressLog: false,
            }),
        ).not.toThrow();

        expect(harness.registry.list()).toEqual([]);
        expect(harness.fakeScheduler.microtasks).toHaveLength(0);
        expect(harness.fakeScheduler.activeTimers()).toEqual([activeWake]);
        expect(harness.reportDispatchError.mock.calls.map(([error]: [Error]) => error.message)).toEqual([
            'InvalidRecordingMutation',
            'InvalidRecordingMutationRows',
            'InvalidRecordingMutationReservation',
            'InvalidRecordingMutationReservation',
            'InvalidRecordingMutationReservation',
            'InvalidRecordingMutation',
            'InvalidRecordingMutation',
            'InvalidRecordingMutation',
            'InvalidRecordingMutationReservation',
        ]);
        expect(harness.reportDispatchError.mock.calls.map(([, context]: any[]) => context)).toEqual([
            { action: 'invalid', reservationId: -1 },
            { action: 'invalid', reservationId: -1 },
            { action: 'invalid', reservationId: -1 },
            { action: 'invalid', reservationId: -1 },
            { action: 'invalid', reservationId: -1 },
            { action: 'invalid', reservationId: -1 },
            { action: 'invalid', reservationId: -1 },
            { action: 'invalid', reservationId: -1 },
            { action: 'invalid', reservationId: -1 },
        ]);
        harness.controller.stop();
    });

    // The 3_000ms bound here and in the [RE-1.3]/[RE-1.4] cases below is
    // RecordingScheduleController.SCAN_INTERVAL_MS
    // (src/model/operator/recording/RecordingScheduleController.ts:9), a v3-only periodic
    // re-evaluation interval with no v2 counterpart -- approved in
    // .kiro/specs/server-recording-execution/design.md:757,1539-1540 (RE-1.3/RE-1.4).
    it.each([
        [2_999, 2_999],
        [3_000, 3_000],
        [3_001, 3_000],
    ])('[RE-1.3][Task 1.5] bounds a deadline %ims away to a %ims wake', (deadlineDistance, expectedDelay) => {
        const now = 1_000_000;
        expect(computeNextRecordingScheduleDelay(now, [now + deadlineDistance])).toBe(expectedDelay);
    });

    it('[RE-1.3][Task 1.5] separates the fifteen-second lead from the three-second scan boundary', async () => {
        const harness = makeScheduleHarness({
            reservations: [makeReserve({ id: 201, startAt: 1_018_000, endAt: 1_060_000 })],
        });

        await harness.controller.start();
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        expect(harness.fakeScheduler.activeTimers()[0].delayMs).toBe(3_000);

        harness.now.value = 1_002_999;
        expect(harness.dispatchPreparation).not.toHaveBeenCalled();
        harness.now.value = 1_003_000;
        harness.fakeScheduler.fire();

        expect(harness.dispatchPreparation).toHaveBeenCalledOnce();
        expect(harness.dispatchPreparation.mock.calls[0][0]).toMatchObject({
            reservationId: 201,
            prepareAt: 1_003_000,
            phase: 'Preparing',
        });
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        harness.controller.stop();
    });

    it('[RE-1.4][Task 1.5] keeps one shared wake and shortens it only for the nearest deadline', async () => {
        const reservations = Array.from({ length: 2_000 }, (_, index) =>
            makeReserve({ id: 300 + index, startAt: 2_000_000 + index, endAt: 2_100_000 + index }),
        );
        const harness = makeScheduleHarness({ reservations });

        await harness.controller.start();
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        expect(harness.fakeScheduler.activeTimers()[0].delayMs).toBe(3_000);

        harness.registry.upsert(makeReserve({ id: 299, startAt: harness.now.value + 16_200 }));
        harness.controller.wake();

        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        expect(harness.fakeScheduler.activeTimers()[0].delayMs).toBe(1_200);
        expect(harness.fakeScheduler.timers.every((timer: any) => timer.delayMs <= 3_000)).toBe(true);
        harness.controller.stop();
    });

    it('[Task 8.3] clears superseded far-future candidates without retaining scheduler callbacks', async () => {
        const reservations = Array.from({ length: 2_000 }, (_, index) =>
            makeReserve({
                id: 5_000 + index,
                startAt: 3_000_000 + index,
                endAt: 3_100_000 + index,
            }),
        );
        const harness = makeScheduleHarness({ reservations });

        await harness.controller.start();
        const initialWake = harness.fakeScheduler.activeTimers()[0];
        const replacement = reservations.slice(0, 1_000).map(reservation =>
            makeReserve({
                ...reservation,
                startAt: reservation.startAt + 60_000,
                endAt: reservation.endAt + 60_000,
            }),
        );
        harness.controller.acceptMutation({
            update: replacement,
            delete: reservations.slice(1_000),
            isSuppressLog: false,
        });

        expect(initialWake.cancelled).toBe(true);
        expect(harness.fakeScheduler.microtasks).toHaveLength(1);
        harness.fakeScheduler.flushMicrotasks();

        expect(harness.registry.list()).toHaveLength(1_000);
        expect(harness.registry.list().every((candidate: any) => candidate.startAt >= 3_060_000)).toBe(true);
        expect(harness.dispatchPreparation).not.toHaveBeenCalled();
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        expect(harness.fakeScheduler.maximumActiveTimerCount()).toBe(1);
        expect(harness.fakeScheduler.microtasks).toHaveLength(0);
        harness.controller.stop();
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(0);
        expect(harness.fakeScheduler.timers.every((timer: any) => timer.cancelled || timer.fired)).toBe(true);
    });

    it('[RE-1.4][Task 1.5] shortens the shared wake to a nearer active time-specified ending', async () => {
        const reservationId = 2_301;
        const harness = makeScheduleHarness({
            reservations: [
                makeReserve({
                    id: reservationId,
                    isTimeSpecified: true,
                    programId: null,
                    startAt: 900_000,
                    endAt: 1_100_000,
                }),
            ],
        });
        const candidate = harness.registry.get(reservationId);
        expect(harness.registry.tryTransitionPhase(reservationId, candidate.generation, 'Waiting', 'Recording')).toBe(
            true,
        );
        const session = harness.controller.getSessionSnapshot(reservationId);
        harness.controller.registerTimeSpecifiedEnd({
            reservationId,
            generation: candidate.generation,
            sessionToken: session.sessionToken,
            dueAt: harness.now.value + 1_200,
        });

        await harness.controller.start();
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        expect(harness.fakeScheduler.activeTimers()[0].delayMs).toBe(1_200);

        harness.now.value += 1_200;
        harness.fakeScheduler.fire();
        expect(harness.dispatchTimeSpecifiedEnd).toHaveBeenCalledOnce();
        expect(harness.dispatchTimeSpecifiedEnd.mock.calls[0][0]).toMatchObject({
            dueAt: 1_001_200,
            reservationId,
        });
        harness.controller.wake();
        expect(harness.dispatchTimeSpecifiedEnd).toHaveBeenCalledOnce();
        harness.controller.stop();
    });

    it('[RE-1.6][Task 1.5] catches up from the latest wall clock after a forward jump or delayed tick', async () => {
        const harness = makeScheduleHarness({
            reservations: [makeReserve({ id: 401, startAt: 1_021_000, endAt: 1_060_000 })],
        });
        await harness.controller.start();
        const scheduledTick = harness.fakeScheduler.activeTimers()[0];

        harness.now.value = 1_040_000;
        harness.fakeScheduler.fire(scheduledTick);

        expect(harness.dispatchPreparation).toHaveBeenCalledOnce();
        expect(harness.registry.get(401).phase).toBe('Preparing');
        harness.controller.stop();
    });

    it.each([
        ['one millisecond before end', 1_000_001, true, 'Preparing'],
        ['at end', 1_000_000, false, 'Completed'],
        ['one millisecond after end', 999_999, false, 'Completed'],
        ['long after end', 900_000, false, 'Completed'],
    ])(
        '[RE-1.6][RE-3.1][Task 1.5] applies the current wall clock at the terminal boundary %s',
        async (_case, endAt, shouldDispatch, expectedPhase) => {
            const harness = makeScheduleHarness({
                now: 1_000_000,
                reservations: [makeReserve({ id: 406, startAt: 990_000, endAt })],
            });

            await harness.controller.start();

            expect(harness.dispatchPreparation).toHaveBeenCalledTimes(shouldDispatch ? 1 : 0);
            expect(harness.registry.get(406).phase).toBe(expectedPhase);
            expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
            expect(harness.fakeScheduler.microtasks).toHaveLength(0);
            harness.controller.stop();
        },
    );

    it('[RE-1.6][Task 1.5] waits from a backward clock and rereads a replaced reservation on callback', async () => {
        const harness = makeScheduleHarness({
            reservations: [makeReserve({ id: 411, startAt: 1_021_000, endAt: 1_060_000 })],
        });
        const oldGeneration = harness.registry.get(411).generation;
        await harness.controller.start();
        const scheduledTick = harness.fakeScheduler.activeTimers()[0];
        const current = harness.registry.upsert(makeReserve({ id: 411, startAt: 1_030_000, endAt: 1_070_000 }));

        harness.now.value = 990_000;
        harness.fakeScheduler.fire(scheduledTick);
        expect(harness.dispatchPreparation).not.toHaveBeenCalled();
        expect(harness.fakeScheduler.activeTimers()[0].delayMs).toBe(3_000);

        harness.now.value = current.prepareAt;
        harness.fakeScheduler.fire();
        expect(harness.dispatchPreparation).toHaveBeenCalledOnce();
        expect(harness.dispatchPreparation.mock.calls[0][1]).toBe(current.generation);
        expect(current.generation).not.toBe(oldGeneration);
        harness.controller.stop();
    });
});
