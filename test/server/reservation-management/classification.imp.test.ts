import { describe, expect, it, vi } from 'vitest';
import { makeModel, makeReserve, ReserveApiModel, ReserveDB } from './_harness';

describe('all-reservation-kinds-and-eight-flag-combinations', () => {
    it('[RM-1.2] classifies all eight flag combinations with legacy precedence', async () => {
        const rows = Array.from({ length: 8 }, (_, bits) =>
            makeReserve({ id: bits, isConflict: !!(bits & 4), isSkip: !!(bits & 2), isOverlap: !!(bits & 1) }),
        );
        const api = new ReserveApiModel({}, { findLists: vi.fn(async () => rows) });
        const lists = await api.getLists({ startAt: 0, endAt: 3_000 });
        expect(lists.conflicts.map((row: any) => row.reserveId)).toEqual([4, 5, 6, 7]);
        expect(lists.skips.map((row: any) => row.reserveId)).toEqual([2, 3]);
        expect(lists.overlaps.map((row: any) => row.reserveId)).toEqual([1]);
        expect(lists.normal.map((row: any) => row.reserveId)).toEqual([0]);
    });

    it('[RM-1.2] counts conflict/skip/overlap/normal rows through getCnts with legacy precedence', async () => {
        const rows = Array.from({ length: 8 }, (_, bits) =>
            makeReserve({ id: bits, isConflict: !!(bits & 4), isSkip: !!(bits & 2), isOverlap: !!(bits & 1) }),
        );
        const findLists = vi.fn(async () => rows);
        const api = new ReserveApiModel({}, { findLists });

        await expect(api.getCnts()).resolves.toEqual({
            conflicts: 4,
            skips: 2,
            overlaps: 1,
            normal: 1,
        });
        expect(findLists).toHaveBeenCalledOnce();
    });

    it('[RM-1.3] omits relay and second encode directory from the public projection', async () => {
        const row = makeReserve({
            isEventRelay: true,
            encodeDirectory2: 'private-two',
            encodeDirectory3: 'public-three',
        });
        const api = new ReserveApiModel({}, { findId: vi.fn(async () => row) });
        const item = await api.get(1, false);
        expect(item).toMatchObject({ id: 1, encodeDirectory3: 'public-three' });
        expect(item).not.toHaveProperty('isEventRelay');
        expect(item).not.toHaveProperty('encodeDirectory2');
    });

    it('[RM-1.4] adapts the existing count query to the shared provider contract without filling missing IDs', async () => {
        const provider = new ReserveDB({}, {});
        const countRuleIds = vi.fn(async () => [
            { ruleId: 9, ruleIdCnt: 2 },
            { ruleId: 3, ruleIdCnt: 1 },
        ]);
        provider.countRuleIds = countRuleIds;
        const ruleIds = Object.freeze([3, 6, 9]);

        await expect(provider.countByRuleIds(ruleIds, 'skip')).resolves.toEqual([
            { ruleId: 9, count: 2 },
            { ruleId: 3, count: 1 },
        ]);
        expect(countRuleIds).toHaveBeenCalledWith([3, 6, 9], 'skip');
        expect(ruleIds).toEqual([3, 6, 9]);
    });

    it('[RM-5.6/RM-6.7/RM-8.2] returns a time manual conflict-only diff without accepting a rule counter change', () => {
        const { model } = makeModel();
        const oldReserve = makeReserve({
            id: 41,
            programId: null,
            ruleId: null,
            isTimeSpecified: true,
            isEventRelay: true,
        });
        const newReserve = Object.assign({}, oldReserve, { isConflict: true });

        const diff = model.createReservesDiff([oldReserve], [newReserve], false);

        expect(diff.update).toMatchObject([
            {
                id: 41,
                isConflict: true,
                isSkip: false,
                isOverlap: false,
                isTimeSpecified: true,
                isEventRelay: true,
            },
        ]);
        expect(diff.insert).toEqual([]);
        expect(diff.delete).toEqual([]);

        const counterOnlyDiff = model.createReservesDiff(
            [oldReserve],
            [Object.assign({}, oldReserve, { ruleUpdateCnt: 1 })],
            false,
        );
        expect(counterOnlyDiff.update).toEqual([]);
        expect(counterOnlyDiff.insert).toEqual([]);
        expect(counterOnlyDiff.delete).toEqual([]);
    });

    it('[RM-8.2/RM-8.4] recalculates only sweep candidates while preserving skipped and overlapped rows', async () => {
        const timeManual = makeReserve({ id: 61, programId: null, isTimeSpecified: true, isConflict: false });
        const skipped = makeReserve({ id: 62, programId: 62, isSkip: true, isConflict: true });
        const overlapped = makeReserve({ id: 63, programId: 63, isOverlap: true, isConflict: true });
        const harness = makeModel();
        harness.model.setTuners([]);

        await harness.model.createConflictSweepDiff(
            [timeManual, skipped, overlapped],
            [timeManual],
            [skipped, overlapped],
            false,
        );

        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith({
            delete: [],
            insert: [],
            isSuppressLog: false,
            update: [expect.objectContaining({ id: 61, isConflict: true, isTimeSpecified: true })],
        });
    });
});
