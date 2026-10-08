import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeManager } from '../recording-execution/_harness';
import { makeModel, makeReserve, ReserveEvent } from './_harness';

const flushEvent = async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
};

const deferred = <T>() => {
    let resolve: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve: resolve! };
};

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('reservation restart re-evaluation handoff', () => {
    it('[RM-T6.4][RM-8.2/RM-8.6/RM-8.7] rebuilds normal and conflict candidate snapshots from saved rows only', async () => {
        const event = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
        const recording = makeManager();
        const delivered: unknown[] = [];
        event.setUpdated(async diff => {
            delivered.push(diff);
            await recording.model.update(diff);
        });

        const now = Date.now();
        const isolated = makeReserve({ id: 61, programId: 601, startAt: now + 100_000, endAt: now + 160_000 });
        const timeManual = makeReserve({
            id: 62,
            channel: 'time-manual-channel',
            endAt: now + 150_000,
            isTimeSpecified: true,
            programId: null,
            startAt: now + 120_000,
        });
        const overlap = makeReserve({
            id: 63,
            isOverlap: true,
            isSkip: true,
            programId: 603,
            startAt: now + 170_000,
            endAt: now + 190_000,
        });
        const harness = makeModel({ reserveEvent: event });
        const saved = [isolated, timeManual, overlap];
        harness.model.setTuners([{ types: ['GR'] }]);
        harness.reserveDB.findLists.mockImplementation(async () => saved.map(reserve => ({ ...reserve })));
        harness.reserveDB.updateMany.mockImplementation(async diff => {
            for (const reserve of diff.update) {
                const index = saved.findIndex(savedReserve => savedReserve.id === reserve.id);
                saved[index] = reserve;
            }
        });
        event.emitUpdated({
            insert: [makeReserve({ ...overlap, isOverlap: false, isSkip: false })],
            isSuppressLog: true,
        });
        await flushEvent();
        expect(recording.model.hasReserve(63)).toBe(true);
        delivered.splice(0);

        await harness.model.updateAll(true);
        await flushEvent();

        expect(harness.reserveDB.getManualIds).toHaveBeenCalledWith({ hasTimeReserve: false });
        expect(harness.reserveDB.getRuleEventRelayIds).toHaveBeenCalledOnce();
        expect(harness.ruleDB.getIds).toHaveBeenCalledOnce();
        expect(delivered).toEqual([
            expect.objectContaining({
                update: expect.arrayContaining([
                    expect.objectContaining({ id: 61, isConflict: true, isEventRelay: false }),
                    expect.objectContaining({ id: 62, isConflict: false, isEventRelay: false, isTimeSpecified: true }),
                    expect.objectContaining({ id: 63, isOverlap: true, isSkip: true }),
                ]),
            }),
        ]);
        expect(harness.reserveDB.findLists).toHaveBeenCalledTimes(2);
        expect(recording.model.hasReserve(61)).toBe(true);
        expect(recording.model.hasReserve(62)).toBe(true);
        expect(recording.model.hasReserve(63)).toBe(false);
    });

    it('[RM-T6.4][RM-8.1/RM-8.11] retains a missing-program row without restoring it as a candidate and continues after a per-item failure', async () => {
        const event = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
        const recording = makeManager();
        event.setUpdated(diff => recording.model.update(diff));
        const now = Date.now();
        const missing = makeReserve({ id: 71, programId: 701, startAt: now + 100_000, endAt: now + 160_000 });
        const failure = new Error('synthetic restart item failure');
        const harness = makeModel({ reserveEvent: event });
        harness.reserveDB.getManualIds.mockResolvedValue([71, 72]);
        harness.reserveDB.findId.mockResolvedValueOnce(missing).mockRejectedValueOnce(failure);
        harness.programDB.findId.mockResolvedValue(null);
        harness.reserveDB.findLists.mockResolvedValue([]);

        await harness.model.updateAll(true);
        await flushEvent();

        expect(harness.reserveDB.findId.mock.calls).toEqual([[71], [72]]);
        expect(harness.programDB.findId).toHaveBeenCalledWith(701);
        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith({
            delete: [],
            insert: [],
            isSuppressLog: false,
            update: [],
        });
        expect(recording.model.hasReserve(71)).toBe(false);
        expect(harness.log.system.error).toHaveBeenCalledWith(failure);
    });

    it('[RM-T6.4] creates a new event handoff without replaying an unfinished request, relay candidate, or undelivered old event', async () => {
        const oldEvent = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
        const oldDelivery = deferred<void>();
        const oldCandidatePort = { update: vi.fn(async () => oldDelivery.promise) };
        oldEvent.setUpdated(oldCandidatePort.update);
        const oldHarness = makeModel({ reserveEvent: oldEvent });
        const unfinishedRequest = deferred<number[]>();
        oldHarness.reserveDB.getManualIds.mockReturnValue(unfinishedRequest.promise);
        const oldUpdate = oldHarness.model.updateAll(true);
        const staleRelayCandidate = makeReserve({ id: 81, isEventRelay: true, programId: 801 });
        oldEvent.emitUpdated({ insert: [staleRelayCandidate], isSuppressLog: true });
        await flushEvent();

        const newEvent = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
        const newCandidatePort = { update: vi.fn(async () => undefined) };
        newEvent.setUpdated(newCandidatePort.update);
        const newHarness = makeModel({ reserveEvent: newEvent });
        await newHarness.model.updateAll(true);
        await flushEvent();

        expect(oldHarness.reserveDB.getManualIds).toHaveBeenCalledOnce();
        expect(oldCandidatePort.update).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ insert: [staleRelayCandidate], isSuppressLog: true }),
        );
        expect(newCandidatePort.update).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ insert: [], update: [] }),
        );
        expect(newCandidatePort.update).not.toHaveBeenCalledWith(
            expect.objectContaining({ insert: [staleRelayCandidate] }),
        );

        unfinishedRequest.resolve([]);
        oldDelivery.resolve();
        await oldUpdate;
    });
});
