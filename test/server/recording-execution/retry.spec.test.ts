import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger, makeManager, makeReserve } from './_harness';

const activeManagers: any[] = [];

const trackManager = <T extends { model: any }>(harness: T): T => {
    activeManagers.push(harness.model);
    return harness;
};

const makeRetryRecorder = (overrides: Record<string, any> = {}) => ({
    bindScheduleSession: vi.fn(),
    cancel: vi.fn(async () => undefined),
    resetTimer: vi.fn(() => true),
    setTimer: vi.fn(() => true),
    startPreparation: vi.fn(),
    update: vi.fn(async () => undefined),
    ...overrides,
});

const captureFailure = (harness: any, recorder: any, reserve: any) => {
    const identity = recorder.bindScheduleSession.mock.calls.at(-1)?.[0];
    expect(identity).toBeDefined();
    return () => harness.callbacks.failed(reserve, null, identity);
};

afterEach(() => {
    for (const manager of activeManagers.splice(0)) manager.scheduleController.stop();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('recording retry policy', () => {
    it.each([0, 1, 2, 3, 4, 7])(
        '[RE-6.1][RE-6.3][RE-6.4][Task 6.3] applies the exact retry boundary after %i prior results',
        async count => {
            const now = Date.now();
            const reserve = makeReserve({ id: 51, startAt: now + 60_000, endAt: now + 120_000 });
            const initial = makeRetryRecorder();
            const replacement = makeRetryRecorder();
            const provider = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(replacement);
            const retry = trackManager(makeManager({ provider }));
            await retry.model.update({ insert: [reserve], isSuppressLog: false });
            const fail = captureFailure(retry, initial, reserve);
            const failedSession = retry.model.scheduleController.getSessionSnapshot(reserve.id);
            retry.recordedDB.findReserveId.mockResolvedValue(Array.from({ length: count }, () => ({})));
            provider.mockClear();

            await fail();

            expect(retry.recordedDB.findReserveId).toHaveBeenCalledOnce();
            expect(retry.recordedDB.findReserveId).toHaveBeenCalledWith(51);
            expect(provider).toHaveBeenCalledTimes(count < 3 ? 1 : 0);
            expect(replacement.setTimer).toHaveBeenCalledTimes(count < 3 ? 1 : 0);
            expect(retry.recordingEvent.emitRecordingRetryOver).toHaveBeenCalledTimes(count >= 3 ? 1 : 0);
            if (count < 3) {
                const current = retry.model.scheduleController.getSessionSnapshot(reserve.id);
                expect(current).toMatchObject({ phase: 'Waiting' });
                expect(current.generation).not.toBe(failedSession.generation);
                expect(current.sessionToken).not.toBe(failedSession.sessionToken);
            }
        },
    );

    it('[Task 6.3] propagates query failure before creating a replacement', async () => {
        const reserve = makeReserve({ id: 52 });
        const queryFailure = new Error('synthetic retry query failure');
        const rejected = trackManager(
            makeManager({
                recordedDB: { findReserveId: vi.fn(async () => Promise.reject(queryFailure)) },
            }),
        );
        await rejected.model.update({ insert: [reserve], isSuppressLog: false });
        const fail = captureFailure(rejected, rejected.recorder, reserve);
        rejected.provider.mockClear();

        await expect(fail()).rejects.toBe(queryFailure);

        expect(rejected.provider).not.toHaveBeenCalled();
    });

    it('[Task 6.3] never installs a new session whose central timer rejects', async () => {
        const now = Date.now();
        const reserve = makeReserve({ id: 52, startAt: now + 60_000, endAt: now + 120_000 });
        const initial = makeRetryRecorder();
        const rejectedReplacement = makeRetryRecorder({ setTimer: vi.fn(() => false) });
        const provider = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(rejectedReplacement);
        const notScheduled = trackManager(makeManager({ provider }));
        await notScheduled.model.update({ insert: [reserve], isSuppressLog: false });
        const fail = captureFailure(notScheduled, initial, reserve);
        notScheduled.recordedDB.findReserveId.mockResolvedValue([]);
        provider.mockClear();

        await fail();

        expect(provider).toHaveBeenCalledOnce();
        expect(rejectedReplacement.setTimer).toHaveBeenCalledOnce();
        expect(notScheduled.model.hasReserve(52)).toBe(false);
        expect(notScheduled.recordingEvent.emitRecordingRetryOver).not.toHaveBeenCalled();
    });

    it('[Task 6.3] ignores a stale failure event when no current session exists', async () => {
        const reserve = makeReserve({ id: 53 });
        const recorder = makeRetryRecorder();
        const stale = trackManager(makeManager({ recorder }));
        stale.recordedDB.findReserveId.mockResolvedValue([]);

        await stale.callbacks.failed(reserve, null, undefined);

        expect(stale.recordedDB.findReserveId).not.toHaveBeenCalled();
        expect(stale.provider).not.toHaveBeenCalled();
        expect(recorder.setTimer).not.toHaveBeenCalled();
        expect(recorder.startPreparation).not.toHaveBeenCalled();
    });

    it.each([
        { endOffset: -1, retries: false },
        { endOffset: 0, retries: false },
        { endOffset: 1, retries: true },
    ])('[RE-6.2][Task 6.3] retries only while endAt-now is $endOffset ms', async scenario => {
        const now = 2_000_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(now);
        const reserve = makeReserve({ id: 54, startAt: now - 30_000, endAt: now + scenario.endOffset });
        const initial = makeRetryRecorder();
        const replacement = makeRetryRecorder();
        const provider = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(replacement);
        const retry = trackManager(makeManager({ provider }));
        await retry.model.update({ insert: [reserve], isSuppressLog: false });
        const fail = captureFailure(retry, initial, reserve);
        retry.recordedDB.findReserveId.mockResolvedValue([]);
        provider.mockClear();

        await fail();

        expect(provider).toHaveBeenCalledTimes(scenario.retries ? 1 : 0);
        expect(replacement.setTimer).toHaveBeenCalledTimes(scenario.retries ? 1 : 0);
        expect(replacement.startPreparation).toHaveBeenCalledTimes(scenario.retries ? 1 : 0);
        if (scenario.retries) {
            expect(logger.system.info).toHaveBeenCalledWith(`readd recording: ${reserve.id}`);
            expect(logger.system.error).not.toHaveBeenCalledWith(`readd recording error: ${reserve.id}`);
        } else {
            expect(logger.system.error).toHaveBeenCalledWith(`readd recording error: ${reserve.id}`);
            expect(logger.system.info).not.toHaveBeenCalledWith(`readd recording: ${reserve.id}`);
        }
    });

    it('[Task 6.3] replaces the failed session once through Waiting and removes it on finalization', async () => {
        const now = Date.now();
        const first = makeRetryRecorder();
        const replacement = makeRetryRecorder();
        const provider = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(replacement);
        const harness = trackManager(makeManager({ provider }));
        const reserve = makeReserve({ id: 55, startAt: now + 10_000, endAt: now + 60_000 });
        await harness.model.update({ insert: [reserve], isSuppressLog: false });
        const fail = captureFailure(harness, first, reserve);
        const failedSession = harness.model.scheduleController.getSessionSnapshot(reserve.id);
        harness.recordedDB.findReserveId.mockResolvedValue([]);
        const transition = vi.spyOn(harness.model.scheduleController, 'tryTransitionSession');
        transition.mockClear();

        await fail();

        const retrySession = harness.model.scheduleController.getSessionSnapshot(reserve.id);
        expect(retrySession.generation).not.toBe(failedSession.generation);
        expect(retrySession.sessionToken).not.toBe(failedSession.sessionToken);
        expect(transition).toHaveBeenCalledWith(
            reserve.id,
            retrySession.generation,
            retrySession.sessionToken,
            'Waiting',
            'Preparing',
        );
        expect(provider).toHaveBeenCalledTimes(2);
        expect(harness.model.recordingIndex[reserve.id]).toBe(replacement);
        expect(replacement.startPreparation).toHaveBeenCalledOnce();
        harness.callbacks.finish(reserve, { id: 9001 });
        expect(harness.model.hasReserve(reserve.id)).toBe(false);
    });
});
