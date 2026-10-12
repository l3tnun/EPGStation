import { describe, expect, it, vi } from 'vitest';
import { makeModel, makeReserve } from './_harness';

describe('program-time-identity-and-diff-cancel', () => {
    it('[RM-3.1] keys program and time candidates by their legacy identities', () => {
        const { model } = makeModel();
        expect(model.createReserveKey(makeReserve({ programId: 55, ruleId: 7 }))).toBe('55-7');
        expect(
            model.createReserveKey(makeReserve({ programId: null, ruleId: 7, startAt: 10, endAt: 20, channel: 'GR1' })),
        ).toBe('10-20-GR1-7');
    });

    it('[RM-3.1/RM-3.2] emits insert, update, and delete while retaining candidate-owned duplicate state', () => {
        const { model } = makeModel();
        const unchanged = makeReserve({ id: 1, programId: 1, ruleId: 7, isSkip: true });
        const changedOld = makeReserve({ id: 2, programId: 2, ruleId: 7, isOverlap: false });
        const removed = makeReserve({ id: 3, programId: 3, ruleId: 7 });
        const changedNew = makeReserve({ programId: 2, ruleId: 7, isOverlap: true });
        const inserted = makeReserve({ programId: 4, ruleId: 7 });
        const diff = model.createReservesDiff(
            [unchanged, changedOld, removed],
            [unchanged, changedNew, inserted],
            false,
        );
        expect(diff.insert.map((row: any) => row.programId)).toEqual([4]);
        expect(diff.update).toMatchObject([{ id: 2, programId: 2, isOverlap: true }]);
        expect(diff.delete.map((row: any) => row.id)).toEqual([3]);
    });

    it('rejects createManualReserveWithProgramId when invoked without a program id', async () => {
        const { model } = makeModel();
        await expect(model.createManualReserveWithProgramId({ allowEndLack: false })).rejects.toThrow(
            'FailedToCreateManualReserve',
        );
    });

    it('rejects createManualReserveWithSpecifiedTime when invoked with a program id set', async () => {
        const { model } = makeModel();
        await expect(model.createManualReserveWithSpecifiedTime({ programId: 9, allowEndLack: false })).rejects.toThrow(
            'TimeSpecifiedOptionIsUndefined',
        );
    });

    it('removes an old time-specified candidate that has no matching new candidate', () => {
        const { model } = makeModel();
        const survivingTime = makeReserve({
            id: 61,
            programId: null,
            ruleId: 5,
            startAt: 10,
            endAt: 20,
            channel: 'GR-A',
        });
        const removedTime = makeReserve({
            id: 62,
            programId: null,
            ruleId: 5,
            startAt: 30,
            endAt: 40,
            channel: 'GR-B',
        });
        const diff = model.createReservesDiff([survivingTime, removedTime], [survivingTime], false);
        expect(diff.delete.map((row: any) => row.id)).toEqual([62]);
        expect(diff.update).toEqual([]);
        expect(diff.insert).toEqual([]);
    });

    it('[RM-4.5/RM-6.7] rejects a public relay when planner input includes an existing conflict without a row or event', async () => {
        const existingConflict = makeReserve({ id: 11, programId: 11, ruleId: 2, isConflict: true });
        const successor = makeReserve({ id: 102, programId: 102, ruleId: 3, channel: 'synthetic-other-channel' });
        const harness = makeModel({
            programDB: { findId: vi.fn(async () => successor), findRule: vi.fn() },
        });
        harness.reserveDB.findTimeRanges.mockImplementation(async ({ hasConflict }: { hasConflict: boolean }) =>
            hasConflict ? [existingConflict] : [],
        );
        harness.model.setTuners([{ types: ['GR'] }]);

        await expect(harness.model.addEventRelay(102, makeReserve({ ruleId: 3 }))).rejects.toThrow(
            'ReservationManageModelAddReserveConflict',
        );

        expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledWith({
            times: [{ startAt: successor.startAt, endAt: successor.endAt }],
            hasSkip: false,
            hasConflict: true,
            hasOverlap: false,
        });
        expect(harness.reserveDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
    });
});
