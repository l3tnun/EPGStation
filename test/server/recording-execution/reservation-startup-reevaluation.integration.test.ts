import { describe, expect, it, vi } from 'vitest';

import { makeModel, makeReserve, ReserveEvent } from '../reservation-management/_harness';
import { makeManager } from './_harness';

const flushEvent = async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
};

describe('recording startup reservation handoff', () => {
    it('[RM-T6.4][RM-8.2/RM-8.7] receives rebuilt reservations through the public recording candidate port', async () => {
        const event = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
        const recording = makeManager();
        event.setUpdated(diff => recording.model.update(diff));

        const now = Date.now();
        const normal = makeReserve({ id: 101, programId: 1_001, startAt: now + 100_000, endAt: now + 160_000 });
        const timeManual = makeReserve({
            id: 102,
            channel: 'time-manual-channel',
            endAt: now + 150_000,
            isTimeSpecified: true,
            programId: null,
            startAt: now + 120_000,
        });
        const skippedOverlap = makeReserve({
            id: 103,
            isOverlap: true,
            isSkip: true,
            programId: 1_003,
            startAt: now + 170_000,
            endAt: now + 190_000,
        });
        const saved = [normal, timeManual, skippedOverlap];
        const harness = makeModel({ reserveEvent: event });
        harness.model.setTuners([{ types: ['GR'] }]);
        harness.reserveDB.findLists.mockImplementation(async () => saved.map(reserve => ({ ...reserve })));
        harness.reserveDB.updateMany.mockImplementation(async diff => {
            for (const reserve of diff.update) {
                const index = saved.findIndex(savedReserve => savedReserve.id === reserve.id);
                saved[index] = reserve;
            }
        });
        event.emitUpdated({
            insert: [makeReserve({ ...skippedOverlap, isOverlap: false, isSkip: false })],
            isSuppressLog: true,
        });
        await flushEvent();
        expect(recording.model.hasReserve(103)).toBe(true);

        await harness.model.updateAll(true);
        await flushEvent();

        expect(recording.model.hasReserve(101)).toBe(true);
        expect(recording.model.hasReserve(102)).toBe(true);
        expect(recording.model.hasReserve(103)).toBe(false);
    });
});
