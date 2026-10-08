import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeManager, makeRecorder, makeReserve, makeScheduleHarness } from './_harness';

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('recording schedule load and cleanup', () => {
    it('[Task 1.5 load] retains one bounded wake for a large far-future registry', async () => {
        const reservations = Array.from({ length: 20_000 }, (_, index) =>
            makeReserve({ id: index + 1, startAt: 10_000_000 + index, endAt: 10_100_000 + index }),
        );
        const harness = makeScheduleHarness({ reservations });

        await harness.controller.start();

        expect(harness.registry.list()).toHaveLength(20_000);
        expect(harness.dispatchPreparation).not.toHaveBeenCalled();
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(1);
        expect(harness.fakeScheduler.activeTimers()[0].delayMs).toBe(3_000);
        harness.controller.stop();
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(0);
    });

    it('[Task 8.3] binds many far-future recorder sessions without per-reservation long timers', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const recorderHarnesses = Array.from({ length: 512 }, () => makeRecorder());
        const provider = vi.fn(async () => recorderHarnesses[provider.mock.calls.length - 1].model);
        const manager = makeManager({ provider });
        const reservations = Array.from({ length: 512 }, (_, index) =>
            makeReserve({
                id: 20_001 + index,
                startAt: 1_000_000 + 2 * 24 * 60 * 60 * 1_000 + index,
                endAt: 1_000_000 + 2 * 24 * 60 * 60 * 1_000 + 60 * 60 * 1_000 + index,
            }),
        );

        await manager.model.update({ insert: reservations, isSuppressLog: false });

        expect(provider).toHaveBeenCalledTimes(reservations.length);
        expect(manager.model.candidateRegistry.list()).toHaveLength(reservations.length);
        expect(vi.getTimerCount()).toBe(1);
        expect(recorderHarnesses.every(recorder => recorder.model.timerId === null)).toBe(true);
        manager.model.scheduleController.stop();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 1.5 load] sustains a fake-clock day with no concurrent or leaked wake', async () => {
        const startAt = 1_000_000;
        let harness: ReturnType<typeof makeScheduleHarness>;
        const dispatchPreparation = vi.fn((candidate: any, generation: bigint) => {
            expect(harness.registry.removeIfCurrent(candidate.reservationId, generation)).toBe(true);
            harness.now.value += 10_000;
            harness.controller.wake();
        });
        const dispatchTimeSpecifiedEnd = vi.fn((milestone: any) => {
            expect(harness.registry.removeIfCurrent(milestone.reservationId, milestone.generation)).toBe(true);
        });
        harness = makeScheduleHarness({
            dispatchPreparation,
            dispatchTimeSpecifiedEnd,
            now: startAt,
            reservations: [
                makeReserve({ id: 21_001, startAt: startAt + 18_000, endAt: startAt + 60_000 }),
                makeReserve({
                    id: 21_002,
                    isTimeSpecified: true,
                    startAt: startAt - 60_000,
                    endAt: startAt + 60_000,
                }),
            ],
        });
        const timeSpecified = harness.registry.get(21_002);
        expect(harness.registry.tryTransitionPhase(21_002, timeSpecified.generation, 'Waiting', 'Recording')).toBe(
            true,
        );
        harness.controller.registerTimeSpecifiedEnd({
            reservationId: 21_002,
            generation: timeSpecified.generation,
            dueAt: startAt + 6_000,
        });
        const list = harness.registry.list.bind(harness.registry);
        let activeEvaluations = 0;
        let maximumActiveEvaluations = 0;
        harness.registry.list = () => {
            activeEvaluations += 1;
            maximumActiveEvaluations = Math.max(maximumActiveEvaluations, activeEvaluations);
            const candidates = list();
            activeEvaluations -= 1;
            return candidates;
        };
        await harness.controller.start();

        const scansPerDay = (24 * 60 * 60 * 1_000) / 3_000;
        for (let scan = 0; scan < scansPerDay; scan += 1) {
            harness.now.value += 3_000;
            harness.fakeScheduler.fire(harness.fakeScheduler.timers.at(-1));
        }

        expect(dispatchPreparation).toHaveBeenCalledOnce();
        expect(dispatchTimeSpecifiedEnd).toHaveBeenCalledOnce();
        expect(harness.registry.list()).toEqual([]);
        expect(harness.controller.timeSpecifiedEnds.size).toBe(0);
        expect(activeEvaluations).toBe(0);
        expect(maximumActiveEvaluations).toBe(1);
        expect(harness.fakeScheduler.activeTimerCount()).toBe(1);
        expect(harness.fakeScheduler.maximumActiveTimerCount()).toBe(1);
        expect(harness.fakeScheduler.timers.every((timer: any) => timer.delayMs === 3_000)).toBe(true);
        expect(harness.fakeScheduler.microtasks).toHaveLength(0);
        harness.controller.stop();
        expect(harness.fakeScheduler.activeTimers()).toHaveLength(0);
        expect(harness.fakeScheduler.timers.every((timer: any) => timer.cancelled || timer.fired)).toBe(true);
    });

    it('[Task 8.3] drives scheduler, retry, and active stream lifecycles from one fake clock for a day', async () => {
        vi.useFakeTimers();
        const startAt = 1_000_000;
        vi.setSystemTime(startAt);
        const root = await mkdtemp(join(tmpdir(), 'epgstation-scheduler-load-active-stream-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const activeReserve = makeReserve({ id: 21_101, startAt: startAt + 30_000, endAt: startAt + 172_800_000 });
        const active = makeRecorder({
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
            streamCreator: { create: vi.fn(async () => stream), changeEndAt: vi.fn() },
        });
        active.model.setEndProcess = vi.fn();
        active.model.setEventRelayTimer = vi.fn();

        // 終了時刻を 4 回目の失敗の直前に置き、番組指定の再試行をその失敗で準備失敗にして終わらせる。
        const retryReserve = makeReserve({ id: 21_102, startAt: startAt + 30_000, endAt: startAt + 29_000 });
        const retry = makeRecorder({
            streamCreator: {
                create: vi.fn(async () => Promise.reject(new Error('synthetic scheduler-load retry'))),
                changeEndAt: vi.fn(),
            },
        });
        const endingReserve = makeReserve({
            id: 21_103,
            isTimeSpecified: true,
            programId: null,
            startAt: startAt - 60_000,
            endAt: startAt + 172_800_000,
        });
        const recorderByReservationId = new Map([
            [activeReserve.id, active],
            [retryReserve.id, retry],
        ]);

        let scheduler: ReturnType<typeof makeScheduleHarness>;
        const dispatchPreparation = vi.fn((candidate: any, generation: bigint, sessionToken: bigint) => {
            const recorder = recorderByReservationId.get(candidate.reservationId);
            if (recorder === undefined) return;
            const binding = {
                reservationId: candidate.reservationId,
                reservation: candidate.reservation,
                generation,
                sessionToken,
                phase: scheduler.controller.getSessionSnapshot(candidate.reservationId).phase,
                isCurrent: (phase: string) => {
                    const current = scheduler.controller.getSessionSnapshot(candidate.reservationId);
                    return (
                        current?.generation === generation &&
                        current.sessionToken === sessionToken &&
                        current.phase === phase
                    );
                },
                tryTransition: (expected: string, next: string) =>
                    scheduler.controller.tryTransitionSession(
                        candidate.reservationId,
                        generation,
                        sessionToken,
                        expected,
                        next,
                    ),
                registerTimeSpecifiedEnd: (dueAt: number) =>
                    scheduler.controller.registerTimeSpecifiedEnd({
                        reservationId: candidate.reservationId,
                        generation,
                        sessionToken,
                        dueAt,
                    }),
                removeTimeSpecifiedEnd: () =>
                    scheduler.controller.removeTimeSpecifiedEnd(candidate.reservationId, generation, sessionToken),
            };
            recorder.model.bindScheduleSession(binding);
            expect(recorder.model.setTimer(candidate.reservation, false)).toBe(true);
            return recorder.model.startPreparation();
        });
        const dispatchTimeSpecifiedEnd = vi.fn((milestone: any) => {
            expect(
                scheduler.controller.tryTransitionSession(
                    milestone.reservationId,
                    milestone.generation,
                    milestone.sessionToken,
                    'Finishing',
                    'Completed',
                ),
            ).toBe(true);
            scheduler.controller.acceptMutation({ delete: [endingReserve], isSuppressLog: false });
        });
        scheduler = makeScheduleHarness({
            clock: { now: () => Date.now() },
            dispatchPreparation,
            dispatchTimeSpecifiedEnd,
            now: startAt,
            reservations: [activeReserve, retryReserve, endingReserve],
        });
        const endingWaiting = scheduler.controller.getSessionSnapshot(endingReserve.id);
        expect(
            scheduler.controller.tryTransitionSession(
                endingReserve.id,
                endingWaiting.generation,
                endingWaiting.sessionToken,
                'Waiting',
                'Recording',
            ),
        ).toBe(true);
        const endingRecording = scheduler.controller.getSessionSnapshot(endingReserve.id);
        scheduler.controller.registerTimeSpecifiedEnd({ ...endingRecording, dueAt: startAt + 21_000 });
        const unhandled: unknown[] = [];
        const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandledRejection);
        const tick = async () => {
            await vi.advanceTimersByTimeAsync(3_000);
            scheduler.fakeScheduler.fire(scheduler.fakeScheduler.activeTimers()[0]);
            scheduler.fakeScheduler.flushMicrotasks();
            await Promise.resolve();
        };

        try {
            await scheduler.controller.start();
            for (let scan = 0; scan < 5; scan += 1) await tick();

            await vi.waitFor(() => expect(active.model.recFile).not.toBeNull());
            stream.write('synthetic first packet');
            await vi.waitFor(() =>
                expect(scheduler.controller.getSessionSnapshot(activeReserve.id).phase).toBe('Recording'),
            );
            await vi.waitFor(() => expect(retry.model.retryTimerId).not.toBeNull());
            expect(vi.getTimerCount()).toBe(1);

            for (let scan = 0; scan < 5; scan += 1) await tick();
            await vi.waitFor(() => expect(retry.model.retryTimerId).toBeNull());
            expect(retry.streamCreator.create).toHaveBeenCalledTimes(4);
            expect(scheduler.controller.getSessionSnapshot(retryReserve.id).phase).toBe('Completed');
            scheduler.controller.acceptMutation({ delete: [retryReserve], isSuppressLog: false });
            scheduler.fakeScheduler.flushMicrotasks();

            const fakeDayStart = Date.now();
            const scansPerDay = (24 * 60 * 60 * 1_000) / 3_000;
            for (let scan = 0; scan < scansPerDay; scan += 1) {
                vi.setSystemTime(Date.now() + 3_000);
                scheduler.fakeScheduler.fire(scheduler.fakeScheduler.timers.at(-1));
            }

            expect(dispatchPreparation.mock.calls.map(([candidate]: any[]) => candidate.reservationId)).toEqual([
                activeReserve.id,
                retryReserve.id,
            ]);
            expect(dispatchTimeSpecifiedEnd).toHaveBeenCalledOnce();
            expect(dispatchTimeSpecifiedEnd).toHaveBeenCalledWith(
                expect.objectContaining({ reservationId: endingReserve.id }),
            );
            expect(scheduler.registry.list().map((candidate: any) => candidate.reservationId)).toEqual([
                activeReserve.id,
            ]);
            expect(scheduler.controller.timeSpecifiedEnds.size).toBe(0);
            expect(retry.model.retryTimerId).toBeNull();
            expect(vi.getTimerCount()).toBe(0);
            expect(Date.now()).toBe(fakeDayStart + 24 * 60 * 60 * 1_000);
            await Promise.resolve();
            expect(scheduler.controller.getSessionSnapshot(activeReserve.id).phase).toBe('Recording');
            expect(active.model.stream).toBe(stream);
            expect(stream.destroyed).toBe(false);
            expect(unhandled).toEqual([]);

            scheduler.controller.stop();
            expect(scheduler.fakeScheduler.activeTimers()).toHaveLength(0);
            expect(scheduler.fakeScheduler.timers.every((timer: any) => timer.cancelled || timer.fired)).toBe(true);
        } finally {
            process.off('unhandledRejection', onUnhandledRejection);
            active.model.isCanceledCallingFinished = true;
            active.model.destroyStream();
            stream.destroy();
            await rm(root, { recursive: true, force: true });
        }
    });
});
