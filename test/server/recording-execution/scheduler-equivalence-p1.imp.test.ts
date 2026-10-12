import { describe, expect, it, vi } from 'vitest';
import { makeReserve, makeScheduleHarness } from './_harness';

describe('recording schedule equivalent-branch cleanup', () => {
    it('[P1] preserves the public session fence and session-authoritative mutation history', async () => {
        const harness = makeScheduleHarness({ now: 1_000_000 });
        const inserted = makeReserve({
            id: 701,
            isTimeSpecified: true,
            programId: null,
            startAt: 2_000_000,
            endAt: 2_100_000,
        });
        await harness.controller.start();

        try {
            harness.controller.acceptMutation({ insert: [inserted], isSuppressLog: false });
            harness.fakeScheduler.flushMicrotasks();
            const initial = harness.controller.getSessionSnapshot(701);

            expect(harness.dispatchMutation.mock.calls.at(-1)?.[0]).toMatchObject({
                action: 'insert',
                generation: initial.generation,
                phase: 'Waiting',
                previousGeneration: undefined,
                previousPhase: undefined,
                previousSessionToken: undefined,
                reservationId: 701,
                sessionToken: initial.sessionToken,
            });
            expect(
                harness.controller.tryTransitionSession(
                    701,
                    initial.generation + 1n,
                    initial.sessionToken,
                    'Waiting',
                    'Recording',
                ),
            ).toBe(false);
            expect(
                harness.controller.tryTransitionSession(
                    701,
                    initial.generation,
                    initial.sessionToken + 1n,
                    'Waiting',
                    'Recording',
                ),
            ).toBe(false);
            expect(
                harness.controller.tryTransitionSession(
                    701,
                    initial.generation,
                    initial.sessionToken,
                    'Preparing',
                    'Recording',
                ),
            ).toBe(false);
            expect(
                harness.controller.tryTransitionSession(
                    701,
                    initial.generation,
                    initial.sessionToken,
                    'Waiting',
                    'Recording',
                ),
            ).toBe(true);

            const updated = makeReserve({ ...inserted, endAt: 2_200_000, name: 'updated-program' });
            harness.controller.acceptMutation({ update: [updated], isSuppressLog: true });
            harness.fakeScheduler.flushMicrotasks();
            const current = harness.controller.getSessionSnapshot(701);

            expect(current).toMatchObject({ phase: 'Recording', sessionToken: initial.sessionToken });
            expect(current.generation).not.toBe(initial.generation);
            expect(harness.dispatchMutation.mock.calls.at(-1)?.[0]).toMatchObject({
                action: 'update',
                generation: current.generation,
                phase: 'Recording',
                previousGeneration: initial.generation,
                previousPhase: 'Recording',
                previousSessionToken: initial.sessionToken,
                reservationId: 701,
                sessionToken: initial.sessionToken,
            });
            expect(
                harness.controller.tryTransitionSession(
                    701,
                    initial.generation,
                    initial.sessionToken,
                    'Recording',
                    'Finishing',
                ),
            ).toBe(false);

            harness.controller.registerTimeSpecifiedEnd({ ...current, dueAt: 1_020_000 });
            harness.now.value = 1_020_000;
            harness.controller.wake();
            const finishing = harness.controller.getSessionSnapshot(701);

            expect(harness.dispatchTimeSpecifiedEnd).toHaveBeenCalledOnce();
            expect(finishing).toMatchObject({
                generation: current.generation,
                phase: 'Finishing',
                sessionToken: initial.sessionToken,
            });

            harness.controller.acceptMutation({ delete: [updated], isSuppressLog: false });
            harness.fakeScheduler.flushMicrotasks();
            expect(harness.dispatchMutation.mock.calls.at(-1)?.[0]).toMatchObject({
                action: 'remove',
                previousGeneration: finishing.generation,
                previousPhase: 'Finishing',
                previousSessionToken: finishing.sessionToken,
                reservationId: 701,
            });
            expect(harness.controller.getSessionSnapshot(701)).toBeUndefined();
        } finally {
            harness.controller.stop();
        }
    });

    it('[P1] retains one authoritative preparation CAS failure boundary', async () => {
        const harness = makeScheduleHarness({
            reservations: [makeReserve({ id: 702, startAt: 1_015_000, endAt: 1_100_000 })],
        });
        const transition = harness.registry.tryTransitionPhase.bind(harness.registry);
        harness.registry.tryTransitionPhase = vi.fn(() => false);

        await harness.controller.start();
        try {
            expect(harness.dispatchPreparation).not.toHaveBeenCalled();
            expect(harness.registry.get(702)).toMatchObject({ phase: 'Waiting' });

            harness.registry.tryTransitionPhase = transition;
            harness.fakeScheduler.flushMicrotasks();

            expect(harness.dispatchPreparation).toHaveBeenCalledOnce();
            expect(harness.dispatchPreparation.mock.calls[0][0]).toMatchObject({
                phase: 'Preparing',
                reservationId: 702,
            });
        } finally {
            harness.controller.stop();
        }
    });

    it('[P1 review] continues the mutation batch after a new skipped reservation', async () => {
        const harness = makeScheduleHarness({ now: 1_000_000 });
        const skipped = makeReserve({ id: 704, isSkip: true });
        const accepted = makeReserve({ id: 705, startAt: 2_000_000, endAt: 2_100_000 });
        await harness.controller.start();

        try {
            harness.controller.acceptMutation({ insert: [skipped, accepted], isSuppressLog: false });
            harness.fakeScheduler.flushMicrotasks();

            expect(harness.registry.get(704)).toBeUndefined();
            expect(harness.dispatchMutation).toHaveBeenCalledOnce();
            expect(harness.dispatchMutation.mock.calls[0][0]).toMatchObject({
                action: 'insert',
                reservationId: 705,
            });
            expect(harness.reportDispatchError).not.toHaveBeenCalled();
        } finally {
            harness.controller.stop();
        }
    });

    it('[P1 review] treats an update for an absent eligible reservation as a fresh waiting insert', async () => {
        const harness = makeScheduleHarness({ now: 1_000_000 });
        const reservation = makeReserve({ id: 708, startAt: 2_000_000, endAt: 2_100_000 });
        await harness.controller.start();

        try {
            harness.controller.acceptMutation({ update: [reservation], isSuppressLog: true });
            harness.fakeScheduler.flushMicrotasks();

            const candidate = harness.registry.get(708);
            const session = harness.controller.getSessionSnapshot(708);
            expect(candidate).toMatchObject({ phase: 'Waiting', reservationId: 708 });
            expect(session).toMatchObject({
                generation: candidate.generation,
                phase: 'Waiting',
                reservationId: 708,
            });
            expect(typeof session.sessionToken).toBe('bigint');
            expect(harness.dispatchMutation).toHaveBeenCalledOnce();
            expect(harness.dispatchMutation.mock.calls[0][0]).toMatchObject({
                action: 'insert',
                generation: candidate.generation,
                isSuppressLog: true,
                phase: 'Waiting',
                previousGeneration: undefined,
                previousPhase: undefined,
                previousSessionToken: undefined,
                reservationId: 708,
                sessionToken: session.sessionToken,
            });
            expect(harness.reportDispatchError).not.toHaveBeenCalled();
        } finally {
            harness.controller.stop();
        }
    });

    it('[P1 review] dispatches an ownerless delete with undefined previous session fields', async () => {
        const harness = makeScheduleHarness({ now: 1_000_000 });
        const absent = makeReserve({ id: 706 });
        await harness.controller.start();

        try {
            harness.controller.acceptMutation({ delete: [absent], isSuppressLog: true });
            harness.fakeScheduler.flushMicrotasks();

            expect(harness.dispatchMutation).toHaveBeenCalledOnce();
            expect(harness.dispatchMutation.mock.calls[0][0]).toMatchObject({
                action: 'remove',
                previousGeneration: undefined,
                previousPhase: undefined,
                previousSessionToken: undefined,
                reservationId: 706,
            });
            expect(harness.reportDispatchError).not.toHaveBeenCalled();
        } finally {
            harness.controller.stop();
        }
    });

    it('[P1 review] rejects a stale-generation time-specified end after an update', async () => {
        const harness = makeScheduleHarness({ now: 1_000_000 });
        const inserted = makeReserve({
            id: 707,
            isTimeSpecified: true,
            programId: null,
            startAt: 2_000_000,
            endAt: 2_100_000,
        });
        await harness.controller.start();

        try {
            harness.controller.acceptMutation({ insert: [inserted], isSuppressLog: false });
            harness.fakeScheduler.flushMicrotasks();
            const previous = harness.controller.getSessionSnapshot(707);
            expect(
                harness.controller.tryTransitionSession(
                    707,
                    previous.generation,
                    previous.sessionToken,
                    'Waiting',
                    'Recording',
                ),
            ).toBe(true);

            harness.controller.acceptMutation({
                update: [makeReserve({ ...inserted, endAt: 2_200_000 })],
                isSuppressLog: false,
            });
            harness.fakeScheduler.flushMicrotasks();
            const current = harness.controller.getSessionSnapshot(707);
            expect(current.generation).not.toBe(previous.generation);
            expect(current.sessionToken).toBe(previous.sessionToken);
            expect(current.phase).toBe('Recording');

            harness.controller.registerTimeSpecifiedEnd({ ...previous, dueAt: harness.now.value });

            expect(harness.dispatchTimeSpecifiedEnd).not.toHaveBeenCalled();
            expect(harness.fakeScheduler.microtasks).toHaveLength(0);
            expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
            expect(harness.fakeScheduler.activeTimers()[0].delayMs).toBe(3_000);
        } finally {
            harness.controller.stop();
        }
    });

    it('[P1] keeps reentrant wake ownership at the public evaluation gate', async () => {
        const harness = makeScheduleHarness({
            reservations: [makeReserve({ id: 703, startAt: 2_000_000, endAt: 2_100_000 })],
        });
        const list = harness.registry.list.bind(harness.registry);
        let activeCalls = 0;
        let maximumActiveCalls = 0;
        let requested = false;
        harness.registry.list = vi.fn(() => {
            activeCalls += 1;
            maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
            if (!requested) {
                requested = true;
                harness.controller.wake();
            }
            const candidates = list();
            activeCalls -= 1;
            return candidates;
        });

        await harness.controller.start();
        try {
            expect(harness.registry.list.mock.calls.length).toBeGreaterThanOrEqual(2);
            expect(maximumActiveCalls).toBe(1);
            expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        } finally {
            harness.controller.stop();
        }
    });
});
