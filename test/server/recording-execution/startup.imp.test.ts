import { describe, expect, it, vi } from 'vitest';
import { deferred, makeManager, makeReserve, Recorded, RecordingScheduleController } from './_harness';

describe('startup cleanup failure isolation', () => {
    it('[Task 7.3] snapshots an update while candidate startup is waiting without starting a scheduler early', async () => {
        vi.useFakeTimers();
        try {
            const listed = deferred<any[]>();
            const reserve = makeReserve({ id: 111, startAt: Date.now(), endAt: Date.now() + 60_000 });
            const recorder = { setTimer: vi.fn(() => true), startPreparation: vi.fn() };
            const harness = makeManager({
                recorder,
                reserveDB: { findId: vi.fn(), findLists: vi.fn(() => listed.promise) },
                startupCompleted: false,
            });

            const startup = harness.model.rebuildCandidatesAndStart();
            await harness.model.update({ insert: [reserve], isSuppressLog: true });
            reserve.isSkip = true;

            expect(harness.provider).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);

            listed.resolve([]);
            await startup;
            for (let index = 0; index < 12; index += 1) await Promise.resolve();

            expect(harness.model.hasReserve(111)).toBe(true);
            expect(recorder.setTimer).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ id: 111, isSkip: false }),
                true,
            );
            expect(recorder.startPreparation).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });

    it('[stage-barrier][Task 7.3] drops a cleanup event update when cleanup fails before candidate startup', async () => {
        vi.useFakeTimers();
        try {
            const failure = new Error('synthetic final cleanup read failure');
            const reserve = makeReserve({ id: 121, startAt: Date.now(), endAt: Date.now() + 60_000 });
            const first = Object.assign(new Recorded(), { id: 131, reserveId: reserve.id });
            const second = Object.assign(new Recorded(), { id: 132, reserveId: reserve.id });
            const findLists = vi.fn(async () => []);
            const harness = makeManager({
                recordedDB: {
                    findAll: vi.fn(async () => [[first, second], 2]),
                    removeRecording: vi.fn(async () => undefined),
                    findId: vi.fn().mockResolvedValueOnce(first).mockRejectedValueOnce(failure),
                    findReserveId: vi.fn(),
                },
                reserveDB: { findId: vi.fn(async () => reserve), findLists },
                startupCompleted: false,
            });
            harness.recordingEvent.emitFinishRecording.mockImplementation(() => {
                void harness.model.update({ insert: [reserve], isSuppressLog: true });
            });

            await expect(harness.model.cleanup()).rejects.toBe(failure);
            for (let index = 0; index < 12; index += 1) await Promise.resolve();

            const joined = harness.model.rebuildCandidatesAndStart();
            await expect(joined).rejects.toBe(failure);
            await harness.model.update({
                insert: [makeReserve({ id: 122, startAt: Date.now(), endAt: Date.now() + 60_000 })],
                isSuppressLog: true,
            });
            harness.model.resetTimer();

            expect(findLists).not.toHaveBeenCalled();
            expect(harness.provider).not.toHaveBeenCalled();
            expect(harness.model.hasReserve(reserve.id)).toBe(false);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('[Task 7.3] rolls back startup-owned recording state when scheduler start rejects', async () => {
        vi.useFakeTimers();
        const failure = new Error('synthetic scheduler start failure');
        const startGate = deferred<void>();
        const originalStart = RecordingScheduleController.prototype.start;
        const start = vi.spyOn(RecordingScheduleController.prototype, 'start').mockImplementation(async function (this: any) {
            await originalStart.call(this);
            await startGate.promise;
        });
        try {
            const reserve = makeReserve({ id: 141, startAt: Date.now(), endAt: Date.now() + 60_000 });
            const recorder = {
                cancel: vi.fn(async () => undefined),
                setTimer: vi.fn(() => true),
                startPreparation: vi.fn(),
            };
            const harness = makeManager({
                recorder,
                reserveDB: { findId: vi.fn(), findLists: vi.fn(async () => [reserve]) },
                startupCompleted: false,
            });

            const startup = harness.model.rebuildCandidatesAndStart();
            for (let index = 0; index < 12; index += 1) await Promise.resolve();
            expect(recorder.setTimer).toHaveBeenCalledOnce();

            startGate.reject(failure);
            await expect(startup).rejects.toBe(failure);

            expect(harness.model.hasReserve(reserve.id)).toBe(false);
            expect(recorder.cancel).toHaveBeenCalledOnce();
            expect(recorder.cancel).toHaveBeenCalledWith(false);
            expect(vi.getTimerCount()).toBe(0);
            const joined = harness.model.rebuildCandidatesAndStart();
            expect(joined).toBe(startup);
            await expect(joined).rejects.toBe(failure);
        } finally {
            start.mockRestore();
            vi.useRealTimers();
        }
    });

    it('[Task 7.1] continues after an interrupted row cannot clear its recording flag', async () => {
        const rows = [
            Object.assign(new Recorded(), { id: 1, reserveId: 1 }),
            Object.assign(new Recorded(), { id: 2, reserveId: null }),
        ];
        const harness = makeManager({
            recordedDB: {
                findAll: vi.fn(async () => [rows, 2]),
                removeRecording: vi
                    .fn()
                    .mockRejectedValueOnce(new Error('synthetic clear failure'))
                    .mockResolvedValueOnce(undefined),
                findId: vi.fn(),
                findReserveId: vi.fn(),
            },
        });
        await harness.model.cleanup();
        expect(harness.recordedDB.removeRecording.mock.calls.map(([id]: number[]) => id)).toEqual([1, 2]);
    });
});

describe('recording mutation acceptance facade', () => {
    it('exposes pre-start and starting snapshots through reservation presence', async () => {
        const listed = deferred<any[]>();
        const beforeStartup = makeReserve({ id: 161, startAt: Date.now(), endAt: Date.now() + 60_000 });
        const whileStarting = makeReserve({ id: 162, startAt: Date.now(), endAt: Date.now() + 60_000 });
        const harness = makeManager({
            reserveDB: { findId: vi.fn(), findLists: vi.fn(() => listed.promise) },
            startupCompleted: false,
        });
        const controller = harness.model.scheduleController;

        expect(harness.model.acceptMutation({ insert: [beforeStartup], isSuppressLog: false })).toBeUndefined();
        const startup = harness.model.rebuildCandidatesAndStart();
        expect(harness.model.acceptMutation({ insert: [whileStarting], isSuppressLog: true })).toBeUndefined();
        beforeStartup.isSkip = true;
        whileStarting.isSkip = true;

        listed.resolve([]);
        await startup;
        for (let index = 0; index < 12; index += 1) await Promise.resolve();

        expect(harness.model.hasReserve(beforeStartup.id)).toBe(true);
        expect(harness.model.hasReserve(whileStarting.id)).toBe(true);
        controller.stop();
    });

    it('forwards an unsnapshottable mutation only to the controller and ignores every mutation after startup failure', async () => {
        const directHarness = makeManager({ startupCompleted: false });
        const directAccept = vi.spyOn(directHarness.model.scheduleController, 'acceptMutation');
        const malformed = { insert: 'not-an-array', isSuppressLog: false } as any;

        expect(() => directHarness.model.acceptMutation(malformed)).not.toThrow();
        expect(directAccept).toHaveBeenCalledExactlyOnceWith(malformed);
        directHarness.model.scheduleController.stop();

        const failure = new Error('synthetic candidate startup failure');
        const failedHarness = makeManager({
            reserveDB: { findId: vi.fn(), findLists: vi.fn(async () => Promise.reject(failure)) },
            startupCompleted: false,
        });
        await expect(failedHarness.model.rebuildCandidatesAndStart()).rejects.toBe(failure);
        const failedAccept = vi.spyOn(failedHarness.model.scheduleController, 'acceptMutation');

        expect(
            failedHarness.model.acceptMutation({ insert: [makeReserve({ id: 163 })], isSuppressLog: false }),
        ).toBeUndefined();
        expect(failedAccept).not.toHaveBeenCalled();
        expect(failedHarness.model.pendingStartupMutations).toEqual([]);
    });

    it('keeps update immediately settled without controller waits before candidate startup', async () => {
        const harness = makeManager({ startupCompleted: false });
        const idle = deferred<void>();
        const whenIdle = vi.spyOn(harness.model.scheduleController, 'whenIdle').mockReturnValue(idle.promise);

        await harness.model.update({ insert: [makeReserve({ id: 167 })], isSuppressLog: false });

        expect(whenIdle).not.toHaveBeenCalled();
        expect(harness.model.pendingStartupMutations).toHaveLength(1);
    });

    it('hands started mutations to the controller once and retains update idle and session-tail waiting', async () => {
        const directHarness = makeManager();
        directHarness.model.scheduleStarted = false;
        const directController = directHarness.model.scheduleController;
        const start = vi.spyOn(directController, 'start');
        const directAccept = vi.spyOn(directController, 'acceptMutation');
        const directMutation = { insert: [makeReserve({ id: 164 })], isSuppressLog: false };

        expect(directHarness.model.acceptMutation(directMutation)).toBeUndefined();
        expect(start).toHaveBeenCalledOnce();
        expect(directAccept).toHaveBeenCalledExactlyOnceWith(directMutation);
        expect(directHarness.provider).not.toHaveBeenCalled();
        directController.stop();

        const updateHarness = makeManager();
        const updateController = updateHarness.model.scheduleController;
        const idle = deferred<void>();
        const sessionTail = deferred<void>();
        const updateAccept = vi.spyOn(updateController, 'acceptMutation');
        const whenIdle = vi.spyOn(updateController, 'whenIdle').mockReturnValue(idle.promise);
        updateHarness.model.sessionMutationTail = sessionTail.promise;
        const updateMutation = { insert: [makeReserve({ id: 165 })], isSuppressLog: true };
        let settled = false;

        const update = updateHarness.model.update(updateMutation).then(() => {
            settled = true;
        });
        expect(updateAccept).toHaveBeenCalledExactlyOnceWith(updateMutation);
        expect(whenIdle).toHaveBeenCalledOnce();
        await Promise.resolve();
        expect(settled).toBe(false);

        idle.resolve();
        await Promise.resolve();
        expect(settled).toBe(false);

        sessionTail.resolve();
        await update;
        expect(settled).toBe(true);
        updateController.stop();
    });
});
