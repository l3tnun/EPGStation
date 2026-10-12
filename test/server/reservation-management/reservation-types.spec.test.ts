import { describe, expect, it, vi } from 'vitest';
import { load, makeModel, makeReserve, ReserveApiModel, ReserveEvent } from './_harness';

type RecordingCandidateRegistry = {
    get(reservationId: number): { state: 'Conflict' | 'Normal' } | undefined;
    remove(reservationId: number): unknown;
    upsert(reservation: ReturnType<typeof makeReserve>): unknown;
};

const RecordingCandidateRegistry = load<new () => RecordingCandidateRegistry>(
    'model',
    'operator',
    'recording',
    'RecordingCandidateRegistry.js',
);

const makeCandidateEvent = () => {
    const registry = new RecordingCandidateRegistry();
    const event = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
    event.setUpdated(
        (diff: {
            delete?: ReturnType<typeof makeReserve>[];
            insert?: ReturnType<typeof makeReserve>[];
            update?: ReturnType<typeof makeReserve>[];
        }) => {
            for (const reserve of [...(diff.insert ?? []), ...(diff.update ?? [])]) registry.upsert(reserve);
            for (const reserve of diff.delete ?? []) registry.remove(reserve.id);
        },
    );
    return { event, registry };
};

describe('reservation type characterization through production entrypoints', () => {
    it('[RM-1.1] creates a program manual through add()', async () => {
        const program = makeReserve({ id: 201, programId: 201 });
        const harness = makeModel({ programDB: { findId: vi.fn(async () => program), findRule: vi.fn() } });
        harness.model.setTuners([{ types: ['GR'] }]);
        await harness.model.add({ programId: 201, allowEndLack: false });
        expect(harness.reserveEvent.emitUpdated.mock.calls[0][0].insert[0]).toMatchObject({
            ruleId: null,
            programId: 201,
            isTimeSpecified: false,
            isEventRelay: false,
        });
    });

    it('[RM-1.2] creates a time manual with both legacy flags through add()', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const harness = makeModel({
            channelDB: { findId: vi.fn(async () => ({ id: 10, channel: 'synthetic-channel', channelType: 'GR' })) },
        });
        harness.model.setTuners([{ types: ['GR'] }]);
        await harness.model.add({
            allowEndLack: false,
            timeSpecifiedOption: { channelId: 10, startAt: 1_001_000, endAt: 1_002_000, name: 'synthetic-time' },
        });
        expect(harness.reserveEvent.emitUpdated.mock.calls[0][0].insert[0]).toMatchObject({
            ruleId: null,
            programId: null,
            isTimeSpecified: true,
            isEventRelay: true,
        });
        vi.useRealTimers();
    });

    it('[RM-1.3] creates a relay through addEventRelay()', async () => {
        const program = makeReserve({ id: 202, programId: 202 });
        const harness = makeModel({ programDB: { findId: vi.fn(async () => program), findRule: vi.fn() } });
        harness.model.setTuners([{ types: ['GR'] }]);
        await harness.model.addEventRelay(202, makeReserve());
        expect(harness.reserveEvent.emitUpdated.mock.calls[0][0].insert[0]).toMatchObject({
            programId: 202,
            isEventRelay: true,
        });
    });

    it('creates an automatic program candidate through updateRule()', async () => {
        const program = makeReserve({ id: 203, programId: 203, overlap: false });
        const rule = {
            id: 9,
            updateCnt: 2,
            isTimeSpecification: false,
            searchOption: {},
            reserveOption: { enable: true, allowEndLack: false },
        };
        const harness = makeModel({
            programDB: { findId: vi.fn(), findRule: vi.fn(async () => [program]) },
            ruleDB: { findId: vi.fn(async () => rule), getIds: vi.fn(async () => []) },
        });
        harness.model.setTuners([{ types: ['GR'] }]);
        await harness.model.updateRule(9);
        expect(harness.reserveDB.updateMany.mock.calls[0][0].insert[0]).toMatchObject({
            ruleId: 9,
            programId: 203,
            isTimeSpecified: false,
            isEventRelay: false,
        });
    });

    it('creates an automatic time candidate through updateRule()', async () => {
        vi.useFakeTimers();
        vi.setSystemTime('2026-07-22T03:00:00.000Z');
        const rule = {
            id: 10,
            updateCnt: 3,
            isTimeSpecification: true,
            searchOption: {
                keyword: 'synthetic-auto-time',
                channelIds: [10],
                times: [{ week: 0x7f, start: 50_400, range: 600 }],
            },
            reserveOption: { enable: true, allowEndLack: false },
        };
        const harness = makeModel({
            channelDB: { findId: vi.fn(async () => ({ id: 10, channel: 'synthetic-auto', channelType: 'GR' })) },
            ruleDB: { findId: vi.fn(async () => rule), getIds: vi.fn(async () => []) },
        });
        harness.model.setTuners([{ types: ['GR'] }]);
        try {
            await harness.model.updateRule(10);
            expect(harness.reserveDB.updateMany.mock.calls[0][0].insert[0]).toMatchObject({
                ruleId: 10,
                programId: null,
                channelId: 10,
                channel: 'synthetic-auto',
                isTimeSpecified: true,
                isEventRelay: false,
                name: 'synthetic-auto-time',
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('[RM-1.4] exposes all persisted state-flag combinations through the existing state projection', async () => {
        const rows = [
            makeReserve({ id: 1 }),
            makeReserve({ id: 2, isConflict: true }),
            makeReserve({ id: 3, isSkip: true }),
            makeReserve({ id: 4, isOverlap: true }),
            makeReserve({ id: 5, isConflict: true, isSkip: true }),
            makeReserve({ id: 6, isConflict: true, isOverlap: true }),
            makeReserve({ id: 7, isSkip: true, isOverlap: true }),
            makeReserve({ id: 8, isConflict: true, isSkip: true, isOverlap: true }),
            makeReserve({ id: 9, ruleId: 55 }),
        ];
        const api = new ReserveApiModel({}, { findLists: vi.fn(async () => rows) });

        const lists = await api.getLists({});
        expect(
            Object.fromEntries(
                Object.entries(lists).map(([state, items]) => [state, items.map(item => item.reserveId)]),
            ),
        ).toEqual({
            conflicts: [2, 5, 6, 8],
            normal: [1, 9],
            overlaps: [4],
            skips: [3, 7],
        });
        expect(lists.normal.find(item => item.reserveId === 9)).toMatchObject({ ruleId: 55 });
    });

    it('[RM-1.5] delivers normal and conflict reservations as recording candidates through the event boundary', () => {
        const { event, registry } = makeCandidateEvent();
        const normal = makeReserve({ id: 201, isConflict: false });
        const conflict = makeReserve({ id: 202, isConflict: true });

        event.emitUpdated({ insert: [normal, conflict], isSuppressLog: false });

        expect(registry.get(201)).toMatchObject({ reservationId: 201, state: 'Normal' });
        expect(registry.get(202)).toMatchObject({ reservationId: 202, state: 'Conflict' });
    });

    it('[RM-1.6] removes excluded and overlap reservations at the recording-candidate event boundary', () => {
        const { event, registry } = makeCandidateEvent();
        const skipped = makeReserve({ id: 203, isSkip: true });
        const overlap = makeReserve({ id: 204, isOverlap: true });

        event.emitUpdated({ insert: [skipped, overlap], isSuppressLog: false });

        expect(registry.get(203)).toBeUndefined();
        expect(registry.get(204)).toBeUndefined();
    });
});
