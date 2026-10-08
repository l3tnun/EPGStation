import { describe, expect, it, vi } from 'vitest';
import { deferred, makeManager, makeRecorder, makeReserve, Recorded } from './_harness';

/**
 * 起動時整理で録画を終えた予約と、起動前に開始時刻を過ぎた別の予約を保存済み予約に置き、
 * 実物の recorder で候補再構築を通す。予約の取消は録画完了 event の consumer が待たずに始めるので、
 * 候補再構築が読む保存済み予約一覧にはまだ整理済みの予約が残っている状態を作る。
 */
const runStartupWithInterruptedReservation = async (interruptedOverrides: Record<string, unknown>) => {
    const now = Date.now();
    const interrupted = makeReserve({
        id: 61,
        startAt: now - 60_000,
        endAt: now + 180_000,
        ...interruptedOverrides,
    });
    // 起動前に開始時刻を過ぎたが、起動時整理の対象ではない（録画中の行が無い）時刻指定予約。
    const startedBeforeRestart = makeReserve({
        id: 62,
        programId: null,
        isTimeSpecified: true,
        startAt: now - 60_000,
        endAt: now + 120_000,
    });
    const interruptedRow = Object.assign(new Recorded(), { id: 71, reserveId: 61, videoFiles: [] });
    const finalRow = Object.assign(new Recorded(), { id: 71, reserveId: 61 });
    const prepEvents = {
        emitStartPrepRecording: vi.fn(),
        emitPrepRecordingFailed: vi.fn(),
        emitCancelPrepRecording: vi.fn(),
        emitStartRecording: vi.fn(),
        emitRecordingFailed: vi.fn(),
        emitFinishRecording: vi.fn(),
        emitEventRelay: vi.fn(),
    };
    // tuner への要求は取消されるまで返らない。取消されたら実物と同じく reject する。
    const create = vi.fn(
        (_reserve: unknown, signal: AbortSignal) =>
            new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(new Error('synthetic tuner request cancelled')), {
                    once: true,
                });
            }),
    );
    const provider = vi.fn(
        async () => makeRecorder({ recordingEvent: prepEvents, streamCreator: { create, changeEndAt: vi.fn() } }).model,
    );
    const harness = makeManager({
        provider,
        recordedDB: {
            findAll: vi.fn(async () => [[interruptedRow], 1]),
            removeRecording: vi.fn(async () => undefined),
            findId: vi.fn(async () => finalRow),
            findReserveId: vi.fn(async () => []),
        },
        reserveDB: {
            findId: vi.fn(async (id: number) => (id === 61 ? interrupted : null)),
            findLists: vi.fn(async () => [interrupted, startedBeforeRestart]),
        },
        startupCompleted: false,
    });
    const settle = async () => {
        for (let index = 0; index < 5; index += 1) {
            await vi.advanceTimersByTimeAsync(0);
            for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
        }
    };

    await harness.model.cleanup();
    expect(harness.recordingEvent.emitFinishRecording).toHaveBeenCalledWith(interrupted, finalRow, true);
    await harness.model.rebuildCandidatesAndStart();
    await settle();
    return { harness, interrupted, prepEvents, settle };
};

const preparedIds = (events: { emitStartPrepRecording: ReturnType<typeof vi.fn> }) =>
    events.emitStartPrepRecording.mock.calls.map(([reserve]) => (reserve as { id: number }).id).sort();
const cancelledPreparationIds = (events: { emitCancelPrepRecording: ReturnType<typeof vi.fn> }) =>
    events.emitCancelPrepRecording.mock.calls.map(([reserve]) => (reserve as { id: number }).id).sort();

describe('startup recording cleanup', () => {
    it('[RE-7.6][Task 7.3] sends saved candidates through the recording session startup path once', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const listed = deferred<any[]>();
        const findLists = vi.fn(() => listed.promise);
        const recorder = { setTimer: vi.fn(() => true), startPreparation: vi.fn() };
        const harness = makeManager({
            recorder,
            reserveDB: { findId: vi.fn(), findLists },
            startupCompleted: false,
        });
        const scheduleStart = vi.spyOn((harness.model as any).scheduleController, 'start');
        const now = Date.now();
        const first = harness.model.rebuildCandidatesAndStart();
        const second = harness.model.rebuildCandidatesAndStart();

        expect(second).toBe(first);
        expect(findLists).toHaveBeenCalledOnce();
        expect(scheduleStart).not.toHaveBeenCalled();

        listed.resolve([
            makeReserve({ id: 91, startAt: now, endAt: now + 60_000 }),
            makeReserve({ id: 92, isConflict: true, startAt: now + 60_000, endAt: now + 120_000 }),
            makeReserve({ id: 93, isSkip: true, endAt: now + 60_000 }),
            makeReserve({ id: 94, isOverlap: true, endAt: now + 60_000 }),
            makeReserve({ id: 95, endAt: now }),
        ]);

        try {
            await expect(first).resolves.toBeUndefined();
            for (let index = 0; index < 12; index += 1) await Promise.resolve();
            expect(
                (harness.model as any).candidateRegistry.list().map((candidate: any) => candidate.reservationId),
            ).toEqual([91, 92]);
            expect(scheduleStart).toHaveBeenCalledOnce();
            expect((harness.model as any).scheduleStarted).toBe(true);
            expect(harness.provider).toHaveBeenCalledTimes(2);
            expect(recorder.setTimer.mock.calls).toEqual([
                [expect.objectContaining({ id: 91, isConflict: false }), true],
                [expect.objectContaining({ id: 92, isConflict: true }), true],
            ]);
            expect(recorder.startPreparation).toHaveBeenCalledOnce();
            expect(harness.model.rebuildCandidatesAndStart()).toBe(first);
        } finally {
            (harness.model as any).scheduleController.stop();
            vi.useRealTimers();
        }
    });

    it('[RE-7.10][RE-7.11][Task 7.3] preserves saved reservation list failure without rebuilding, scheduling, or retrying', async () => {
        const failure = new Error('synthetic saved reservation list failure');
        const findLists = vi.fn(async () => Promise.reject(failure));
        const harness = makeManager({
            reserveDB: { findId: vi.fn(), findLists },
            startupCompleted: false,
        });
        const scheduleStart = vi.spyOn((harness.model as any).scheduleController, 'start');
        const first = harness.model.rebuildCandidatesAndStart();
        const second = harness.model.rebuildCandidatesAndStart();

        expect(second).toBe(first);
        await expect(first).rejects.toBe(failure);
        expect(findLists).toHaveBeenCalledOnce();
        expect((harness.model as any).candidateRegistry.list()).toEqual([]);
        expect(scheduleStart).not.toHaveBeenCalled();

        const later = harness.model.rebuildCandidatesAndStart();
        expect(later).toBe(first);
        await expect(later).rejects.toBe(failure);
        expect(findLists).toHaveBeenCalledOnce();
    });

    it('[RE-7.1][Task 7.1] completes an empty startup scan without touching row ports or publishing completion', async () => {
        const harness = makeManager({
            recordedDB: {
                findAll: vi.fn(async () => [[], 0]),
                removeRecording: vi.fn(),
                findId: vi.fn(),
                findReserveId: vi.fn(),
            },
        });
        await expect(harness.model.cleanup()).resolves.toBeUndefined();
        expect(harness.recordedDB.findAll).toHaveBeenCalledOnce();
        expect(harness.recordedDB.removeRecording).not.toHaveBeenCalled();
        expect(harness.reserveDB.findId).not.toHaveBeenCalled();
        expect(harness.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();
    });

    it('[RE-7.5] does not restore a pre-shutdown receiver while reconciling an empty startup scan', async () => {
        const harness = makeManager({
            recordedDB: {
                findAll: vi.fn(async () => [[], 0]),
                removeRecording: vi.fn(),
                findId: vi.fn(),
                findReserveId: vi.fn(),
            },
        });

        await expect(harness.model.cleanup()).resolves.toBeUndefined();

        expect(harness.recorder.setTimer).not.toHaveBeenCalled();
        expect(harness.provider).not.toHaveBeenCalled();
    });

    it('[RE-7.8][Task 7.1] preserves startup scan rejection before touching any row port', async () => {
        const failure = new Error('synthetic startup scan failure');
        const harness = makeManager({
            recordedDB: {
                findAll: vi.fn(async () => Promise.reject(failure)),
                removeRecording: vi.fn(),
                findId: vi.fn(),
                findReserveId: vi.fn(),
            },
        });
        await expect(harness.model.cleanup()).rejects.toBe(failure);
        expect(harness.recordedDB.removeRecording).not.toHaveBeenCalled();
        expect(harness.reserveDB.findId).not.toHaveBeenCalled();
        expect(harness.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();
    });

    it('[RE-7.2][RE-7.3][RE-7.4][Task 7.1] clears interrupted rows, repairs each file, and emits cleanup completion', async () => {
        const reserve = makeReserve({ id: 61 });
        const recorded = Object.assign(new Recorded(), {
            id: 71,
            reserveId: 61,
            videoFiles: [
                { id: 81, parentDirectoryName: 'tmp' },
                { id: 82, parentDirectoryName: 'synthetic-root' },
            ],
        });
        const finalRecorded = Object.assign(new Recorded(), { id: 71, reserveId: 61 });
        const harness = makeManager({
            recordedDB: {
                findAll: vi.fn(async () => [[recorded], 1]),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(async () => finalRecorded),
                findReserveId: vi.fn(),
            },
            reserveDB: { findId: vi.fn(async () => reserve) },
        });
        await harness.model.cleanup();
        expect(harness.recordedDB.removeRecording).toHaveBeenCalledWith(71);
        expect(harness.recordingUtil.movingFromTmp).toHaveBeenCalledWith(reserve, 81);
        expect(harness.recordingUtil.updateVideoFileSize.mock.calls.map(([id]: number[]) => id)).toEqual([81, 82]);
        expect(harness.recordingEvent.emitFinishRecording).toHaveBeenCalledWith(reserve, finalRecorded, true);
    });

    it.each([
        ['null reserve id', null, undefined],
        ['missing reserve', 62, null],
        ['rejected reserve query', 63, new Error('synthetic reserve query failure')],
    ])(
        '[Task 7.1] stops row cleanup after %s without touching files or reconnecting',
        async (_case, reserveId, result) => {
            const recorded = Object.assign(new Recorded(), {
                id: 72,
                reserveId,
                videoFiles: [{ id: 83, parentDirectoryName: 'tmp' }],
            });
            const findReserve =
                result instanceof Error ? vi.fn(async () => Promise.reject(result)) : vi.fn(async () => result);
            const harness = makeManager({
                recordedDB: {
                    findAll: vi.fn(async () => [[recorded], 1]),
                    removeRecording: vi.fn(async () => undefined),
                    findId: vi.fn(),
                    findReserveId: vi.fn(),
                },
                reserveDB: { findId: findReserve },
            });
            await harness.model.cleanup();
            expect(harness.recordedDB.removeRecording).toHaveBeenCalledWith(72);
            expect(findReserve).toHaveBeenCalledTimes(reserveId === null ? 0 : 1);
            expect(harness.recordingUtil.movingFromTmp).not.toHaveBeenCalled();
            expect(harness.recordingUtil.updateVideoFileSize).not.toHaveBeenCalled();
            expect(harness.recordedDB.findId).not.toHaveBeenCalled();
            expect(harness.recordedDB.findAll).toHaveBeenCalledOnce();
        },
    );

    it('[RE-7.7][Task 7.1] contains move and size faults, preserves exact order, and emits only after final requery', async () => {
        const ledger: string[] = [];
        const reserve = makeReserve({ id: 64 });
        const recorded = Object.assign(new Recorded(), {
            id: 74,
            reserveId: 64,
            videoFiles: [
                { id: 84, parentDirectoryName: 'tmp' },
                { id: 85, parentDirectoryName: 'synthetic-root' },
            ],
        });
        const finalRecorded = Object.assign(new Recorded(), { id: 74, reserveId: 64 });
        const harness = makeManager({
            recordedDB: {
                findAll: vi.fn(async () => [[recorded], 1]),
                removeRecording: vi.fn(async () => ledger.push('clear')),
                findId: vi.fn(async () => (ledger.push('requery'), finalRecorded)),
                findReserveId: vi.fn(),
            },
            reserveDB: { findId: vi.fn(async () => (ledger.push('reserve'), reserve)) },
            recordingUtil: {
                movingFromTmp: vi.fn(async () => {
                    ledger.push('move');
                    throw new Error('synthetic startup move failure');
                }),
                updateVideoFileSize: vi.fn(async (id: number) => {
                    ledger.push(`size:${id}`);
                    if (id === 84) throw new Error('synthetic startup size failure');
                }),
            },
        });
        harness.recordingEvent.emitFinishRecording.mockImplementation(() => ledger.push('finish'));
        await harness.model.cleanup();
        expect(ledger).toEqual(['clear', 'reserve', 'move', 'size:84', 'size:85', 'requery', 'finish']);
    });

    it.each([
        ['missing final row', null, false],
        ['final query rejection', new Error('synthetic final query failure'), false],
    ])('[Task 7.1] publishes no completion for %s', async (_case, result, emits) => {
        const reserve = makeReserve({ id: 65 });
        const recorded = Object.assign(new Recorded(), { id: 75, reserveId: 65 });
        const findId = result instanceof Error ? vi.fn(async () => Promise.reject(result)) : vi.fn(async () => result);
        const harness = makeManager({
            recordedDB: {
                findAll: vi.fn(async () => [[recorded], 1]),
                removeRecording: vi.fn(async () => undefined),
                findId,
                findReserveId: vi.fn(),
            },
            reserveDB: { findId: vi.fn(async () => reserve) },
        });
        if (result instanceof Error) await expect(harness.model.cleanup()).rejects.toBe(result);
        else await harness.model.cleanup();
        expect(harness.recordingEvent.emitFinishRecording).toHaveBeenCalledTimes(emits ? 1 : 0);
    });

    it('[RE-7.9][Task 7.3] leaves candidate rebuilding to its own startup stage after every cleanup item has settled', async () => {
        const rows = [
            Object.assign(new Recorded(), { id: 1, reserveId: null, videoFiles: [] }),
            Object.assign(new Recorded(), { id: 2, reserveId: null, videoFiles: [] }),
        ];
        const findLists = vi.fn(async () => []);
        const harness = makeManager({
            recordedDB: {
                findAll: vi.fn(async () => [rows, 2]),
                removeRecording: vi.fn(async (id: number) =>
                    id === 1 ? Promise.reject(new Error('synthetic item failure')) : undefined,
                ),
                findId: vi.fn(),
                findReserveId: vi.fn(),
            },
            reserveDB: { findId: vi.fn(), findLists },
            startupCompleted: false,
        });
        const scheduleStart = vi.spyOn((harness.model as any).scheduleController, 'start');
        try {
            // A failing item is handled locally, so the cleanup stage itself still succeeds.
            await expect(harness.model.cleanup()).resolves.toBeUndefined();
            expect(harness.recordedDB.removeRecording.mock.calls.map(([id]: number[]) => id)).toEqual([1, 2]);
            expect(findLists).not.toHaveBeenCalled();
            expect(scheduleStart).not.toHaveBeenCalled();

            await harness.model.rebuildCandidatesAndStart();
            expect(findLists).toHaveBeenCalledOnce();
            expect(scheduleStart).toHaveBeenCalledOnce();
        } finally {
            (harness.model as any).scheduleController.stop();
        }
    });

    it.each([
        ['time-specified manual', { programId: null, isTimeSpecified: true, ruleId: null, isEventRelay: false }],
        ['program-specified manual', { programId: 101, isTimeSpecified: false, ruleId: null, isEventRelay: false }],
        ['rule event relay', { programId: 101, isTimeSpecified: false, ruleId: 5, isEventRelay: true }],
    ])(
        '[RE-7.12] does not prepare a %s reservation that startup cleanup finished and is cancelling',
        async (_case, interruptedOverrides) => {
            vi.useFakeTimers();
            vi.setSystemTime(1_000_000);
            const { harness, interrupted, prepEvents, settle } =
                await runStartupWithInterruptedReservation(interruptedOverrides);
            try {
                // 起動時整理の対象でない、開始時刻を過ぎた予約は同じ起動で録画準備を始める。
                expect(preparedIds(prepEvents)).toEqual([62]);

                // 録画完了 event の consumer が始めた予約の取消が、候補再構築の後に届く。
                harness.model.acceptMutation({ delete: [interrupted], isSuppressLog: false });
                await settle();

                expect(preparedIds(prepEvents)).toEqual([62]);
                expect(cancelledPreparationIds(prepEvents)).toEqual([]);
            } finally {
                (harness.model as any).scheduleController.stop();
                vi.useRealTimers();
            }
        },
    );

    it('[RE-7.12] keeps preparing a rule reservation whose interrupted recording startup cleanup finished', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const { harness, prepEvents } = await runStartupWithInterruptedReservation({
            programId: 101,
            isTimeSpecified: false,
            ruleId: 5,
            isEventRelay: false,
        });
        try {
            // ルール予約は取り消されず再計算されるだけなので、従来どおり候補へ入り録画準備を始める。
            expect(preparedIds(prepEvents)).toEqual([61, 62]);
            expect(cancelledPreparationIds(prepEvents)).toEqual([]);
        } finally {
            (harness.model as any).scheduleController.stop();
            vi.useRealTimers();
        }
    });
});
