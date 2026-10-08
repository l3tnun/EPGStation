import { describe, expect, it, vi } from 'vitest';
import { makeModel, makeReserve, ReserveEvent } from './_harness';

describe('reservation state transition characterization', () => {
    it('[RM-5.2] deletes manual and relay reservations on cancel', async () => {
        for (const row of [makeReserve({ ruleId: null }), makeReserve({ ruleId: 8, isEventRelay: true })]) {
            const harness = makeModel();
            harness.reserveDB.findId.mockResolvedValue(row);
            await harness.model.cancel(row.id);
            expect(harness.reserveDB.updateMany.mock.calls[0][0].delete.map((item: any) => item.id)).toEqual([row.id]);
        }
    });

    it('[RM-5.3] removes skip through conflict recalculation', async () => {
        const skipHarness = makeModel();
        skipHarness.model.setTuners([{ types: ['GR'] }]);
        skipHarness.reserveDB.findId.mockResolvedValue(makeReserve({ ruleId: 8, isSkip: true }));
        await skipHarness.model.removeSkip(1);
        expect(skipHarness.reserveDB.updateMany.mock.calls[0][0].update).toMatchObject([{ id: 1, isSkip: false }]);

    });

    it('[RM-5.6] includes conflict-only state updates while retaining rule-owned time counters', () => {
        const { model } = makeModel();
        const timeManual = makeReserve({
            id: 3,
            programId: null,
            ruleId: null,
            isTimeSpecified: true,
            isEventRelay: true,
        });
        const oldReserves = [
            makeReserve({ id: 1, programId: 1, ruleId: null }),
            makeReserve({ id: 2, programId: null, ruleId: 2, isTimeSpecified: true }),
            timeManual,
        ];
        const newReserves = oldReserves.map(reserve => Object.assign({}, reserve, { isConflict: true }));

        const diff = model.createReservesDiff(oldReserves, newReserves, false);

        expect(diff.update).toMatchObject([
            { id: 1, isConflict: true },
            { id: 2, isConflict: true },
            { id: 3, isConflict: true, isTimeSpecified: true, isEventRelay: true },
        ]);
        expect(diff.insert).toEqual([]);
        expect(diff.delete).toEqual([]);

        const ruleTime = oldReserves[1];
        const ruleTimeDiff = model.createReservesDiff(
            [ruleTime],
            [Object.assign({}, ruleTime, { ruleUpdateCnt: 1 })],
            false,
        );
        expect(ruleTimeDiff.update).toMatchObject([{ id: 2, ruleId: 2, ruleUpdateCnt: 1 }]);
        expect(ruleTimeDiff.insert).toEqual([]);
        expect(ruleTimeDiff.delete).toEqual([]);
        expect(model.checkTimeRuleReserveDiff(ruleTime, Object.assign({}, ruleTime))).toBe(false);

        const ruleTimeWithCounter = Object.assign({}, ruleTime, { ruleUpdateCnt: 1 });
        const timeManualWithCounter = Object.assign({}, timeManual, { ruleUpdateCnt: 2 });
        expect(model.checkTimeRuleReserveDiff(ruleTimeWithCounter, timeManualWithCounter)).toBe(false);
        expect(model.checkTimeRuleReserveDiff(timeManualWithCounter, ruleTimeWithCounter)).toBe(false);

        for (const [field, value] of [
            ['isSkip', true],
            ['isOverlap', true],
        ]) {
            const changed = Object.assign({}, timeManual, { [field]: value });
            const timeManualDiff = model.createReservesDiff([timeManual], [changed], false);

            expect(timeManualDiff.update).toMatchObject([{ id: 3, [field]: value }]);
            expect(timeManualDiff.insert).toEqual([]);
            expect(timeManualDiff.delete).toEqual([]);
        }

        const timeManualCounterDiff = model.createReservesDiff(
            [timeManual],
            [Object.assign({}, timeManual, { ruleUpdateCnt: 1 })],
            false,
        );
        expect(timeManualCounterDiff.update).toEqual([]);
        expect(timeManualCounterDiff.insert).toEqual([]);
        expect(timeManualCounterDiff.delete).toEqual([]);

        const noChangeDiff = model.createReservesDiff([timeManual], [Object.assign({}, timeManual)], false);
        expect(noChangeDiff.update).toEqual([]);
        expect(noChangeDiff.insert).toEqual([]);
        expect(noChangeDiff.delete).toEqual([]);
    });

    it('[RM-5.1] changes a non-relay rule reservation to skip instead of deleting it', async () => {
        const row = makeReserve({ id: 21, ruleId: 8, isEventRelay: false });
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(row);

        await harness.model.cancel(21);
        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ update: [expect.objectContaining({ id: 21, isSkip: true })], delete: [] }),
        );
    });

    it('[RM-5.4] persists and delivers a recorded-history duplicate supplied with a rule candidate as overlap', async () => {
        const ledger: string[] = [];
        const event = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
        const delivered = vi.fn(() => ledger.push('event'));
        event.setUpdated(delivered);
        const row = makeReserve({
            id: 22,
            ruleId: 8,
            ruleUpdateCnt: 0,
            programId: 122,
            programUpdateTime: 1,
            isOverlap: false,
        });
        const candidate = makeReserve({ id: 122, programId: 122, updateTime: 2, overlap: true });
        const harness = makeModel({
            ledger,
            reserveEvent: event,
            programDB: { findId: async () => null, findRule: async () => [candidate] },
            ruleDB: {
                findId: async () => ({
                    id: 8,
                    updateCnt: 1,
                    isTimeSpecification: false,
                    searchOption: {},
                    reserveOption: { enable: true, allowEndLack: false },
                }),
                getIds: async () => [],
            },
        });
        harness.model.setTuners([{ types: ['GR'] }]);
        harness.reserveDB.findRuleId.mockResolvedValue([row]);

        await harness.model.updateRule(8);

        expect(harness.reserveDB.updateMany).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ update: [expect.objectContaining({ id: 22, isOverlap: true })] }),
        );
        expect(ledger).toEqual(['lock', 'commit', 'unlock', 'event']);
        expect(delivered).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ update: [expect.objectContaining({ id: 22, isOverlap: true })] }),
        );
    });

    it('[RM-5.5] removes overlap and recalculates the reservation as a recording candidate', async () => {
        const harness = makeModel();
        harness.model.setTuners([{ types: ['GR'] }]);
        harness.reserveDB.findId.mockResolvedValue(makeReserve({ ruleId: 8, isOverlap: true }));

        await harness.model.removeOverlap(1);
        expect(harness.reserveDB.updateMany.mock.calls[0][0].update).toMatchObject([
            { id: 1, isOverlap: false, isIgnoreOverlap: true },
        ]);
    });
});
