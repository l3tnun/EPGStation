import { describe, expect, it } from 'vitest';
import { makeModel, makeReserve } from './_harness';

const ids = (rows: any[]): number[] => rows.map(row => row.id);

describe('reservation cancel and skip/overlap release lookups', () => {
    it('[RM-5.1] looks up the reservations around a cancelled rule reservation including skipped and overlapped ones', async () => {
        const reserve = makeReserve({ id: 1, ruleId: 3, programId: 7, startAt: 1_000, endAt: 2_000, isConflict: true });
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(reserve);
        harness.model.setTuners([{ types: ['GR'] }]);

        await harness.model.cancel(1);

        expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledExactlyOnceWith({
            times: [{ startAt: 1_000, endAt: 2_000 }],
            hasSkip: false,
            hasConflict: true,
            hasOverlap: true,
            excludeReserveId: 1,
        });
    });

    it('[RM-5.1] stores a cancelled rule reservation as skipped and not conflicting', async () => {
        const reserve = makeReserve({ id: 1, ruleId: 3, programId: 7, isConflict: true });
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(reserve);
        harness.model.setTuners([{ types: ['GR'] }]);

        await harness.model.cancel(1);

        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ update: [expect.objectContaining({ id: 1, isSkip: true, isConflict: false })] }),
        );
    });

    it('[RM-5.2] releases a skip together with the skips of other rules on the same program and publishes the change', async () => {
        const target = makeReserve({ id: 1, ruleId: 3, programId: 7, isSkip: true, startAt: 1_000, endAt: 2_000 });
        const sameProgram = [
            target,
            makeReserve({ id: 2, ruleId: null, programId: 7, isSkip: true }),
            makeReserve({ id: 3, ruleId: 4, programId: 7, isSkip: true, isEventRelay: true }),
            makeReserve({ id: 4, ruleId: 5, programId: 7, isSkip: false }),
            makeReserve({ id: 5, ruleId: 6, programId: 7, isSkip: true }),
        ];
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(target);
        harness.reserveDB.findProgramId.mockResolvedValue(sameProgram);
        harness.model.setTuners([{ types: ['GR'] }, { types: ['GR'] }]);

        await harness.model.removeSkip(1);

        expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledExactlyOnceWith({
            times: [{ startAt: 1_000, endAt: 2_000 }],
            hasSkip: false,
            hasConflict: true,
            hasOverlap: false,
            excludeReserveId: 1,
        });
        const diff = harness.reserveDB.updateMany.mock.calls[0][0];
        // Only the released reservations enter the diff (the released ones then fold into one program entry).
        expect([...ids(diff.update), ...ids(diff.delete)].sort()).toEqual([1, 5]);
        expect(diff.update.every((row: any) => row.isSkip === false)).toBe(true);
        expect(harness.reserveEvent.emitUpdated).toHaveBeenCalledExactlyOnceWith(diff);
        expect(diff.isSuppressLog).toBe(false);
    });

    it.each([
        ['a manual reservation', { ruleId: null, isSkip: true }],
        ['an event relay reservation', { ruleId: 3, isEventRelay: true, isSkip: true }],
        ['a reservation that is not skipped', { ruleId: 3, isSkip: false }],
    ])('[RM-5.2] leaves %s alone when releasing a skip', async (_name, overrides) => {
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(makeReserve({ id: 1, programId: 7, ...overrides }));

        await harness.model.removeSkip(1);

        expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
    });

    it('[RM-5.3] releases an overlap, looking up the surrounding reservations, and publishes the change', async () => {
        const target = makeReserve({
            id: 1,
            ruleId: 3,
            programId: 7,
            isOverlap: true,
            startAt: 1_000,
            endAt: 2_000,
        });
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(target);
        harness.model.setTuners([{ types: ['GR'] }]);

        await harness.model.removeOverlap(1);

        expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledExactlyOnceWith({
            times: [{ startAt: 1_000, endAt: 2_000 }],
            hasSkip: false,
            hasConflict: true,
            hasOverlap: false,
            excludeReserveId: 1,
        });
        const diff = harness.reserveDB.updateMany.mock.calls[0][0];
        expect(diff.update).toEqual([expect.objectContaining({ id: 1, isIgnoreOverlap: true, isOverlap: false })]);
        expect(diff.isSuppressLog).toBe(false);
        expect(harness.reserveEvent.emitUpdated).toHaveBeenCalledExactlyOnceWith(diff);
    });

    it.each([
        ['a manual reservation', { ruleId: null, isOverlap: true }],
        ['an event relay reservation', { ruleId: 3, isEventRelay: true, isOverlap: true }],
        ['an overlap that was already released', { ruleId: 3, isIgnoreOverlap: true, isOverlap: false }],
    ])('[RM-5.3] leaves %s alone when releasing an overlap', async (_name, overrides) => {
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(makeReserve({ id: 1, programId: 7, ...overrides }));

        await harness.model.removeOverlap(1);

        expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
    });

    it.each([
        ['ignored and still overlapping', { isIgnoreOverlap: true, isOverlap: true }],
        ['not ignored and not overlapping', { isIgnoreOverlap: false, isOverlap: false }],
    ])('[RM-5.3] still releases an overlap that is %s', async (_name, overrides) => {
        const harness = makeModel();
        harness.reserveDB.findId.mockResolvedValue(makeReserve({ id: 1, ruleId: 3, programId: 7, ...overrides }));
        harness.model.setTuners([{ types: ['GR'] }]);

        await harness.model.removeOverlap(1);

        expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledOnce();
        expect(harness.reserveEvent.emitUpdated).toHaveBeenCalledOnce();
    });
});

describe('cleanup', () => {
    it('[RM-8.4] widens the lookup to the ranges of the reservations it just found next to the expired ones', async () => {
        const expired = makeReserve({ id: 1, programId: 11, startAt: 100, endAt: 200 });
        const neighbour = makeReserve({ id: 2, programId: 12, startAt: 150, endAt: 300 });
        const harness = makeModel();
        harness.reserveDB.findOldTime.mockResolvedValue([expired]);
        harness.reserveDB.findTimeRanges.mockImplementation(async (option: any) =>
            option.times[0].startAt === 100 ? [neighbour] : [],
        );
        harness.model.setTuners([{ types: ['GR'] }]);

        await harness.model.cleanup();

        expect(harness.reserveDB.findTimeRanges.mock.calls.map((call: any[]) => call[0].times)).toEqual([
            [{ startAt: 100, endAt: 200 }],
            [{ startAt: 150, endAt: 300 }],
        ]);
    });
});

describe('plane sweep ordering', () => {
    const channelRow = (id: number, ruleId: number, startAt: number, endAt: number, channel: string) =>
        makeReserve({ id, ruleId, programId: id, startAt, endAt, channel, channelId: id });

    it('[RM-6.1] ends an interval before starting one at the same instant even when the later one has priority', () => {
        const { model } = makeModel();
        model.setTuners([{ types: ['GR'] }]);

        const rows = model.createReserves([
            channelRow(1, 1, 10, 20, 'chan-a'),
            channelRow(2, 2, 0, 10, 'chan-b'),
        ]);

        expect(rows.map((row: any) => [row.id, row.isConflict])).toEqual([
            [2, false],
            [1, false],
        ]);
    });

    it('[RM-6.1] removes exactly the interval that ended from the active set', () => {
        const { model } = makeModel();
        model.setTuners([{ types: ['GR'] }]);

        const rows = model.createReserves([
            channelRow(1, 1, 0, 30, 'chan-a'),
            channelRow(2, 2, 10, 20, 'chan-b'),
            channelRow(3, 3, 20, 30, 'chan-a'),
        ]);

        expect(Object.fromEntries(rows.map((row: any) => [row.id, row.isConflict]))).toEqual({
            1: false,
            2: true,
            3: false,
        });
    });

    it('[RM-6.1] drops the interval that ended even when it is not the lowest priority one still active', () => {
        const { model } = makeModel();
        model.setTuners([{ types: ['GR'] }]);

        const rows = model.createReserves([
            channelRow(1, 1, 0, 20, 'chan-b'),
            channelRow(2, 2, 10, 40, 'chan-a'),
            channelRow(3, 3, 25, 35, 'chan-a'),
        ]);

        expect(Object.fromEntries(rows.map((row: any) => [row.id, row.isConflict]))).toEqual({
            1: false,
            2: true,
            3: false,
        });
    });

    it('[RM-6.1] keeps back-to-back intervals conflict free across a long chain whose priority runs against time', () => {
        const { model } = makeModel();
        model.setTuners([{ types: ['GR'] }]);
        const count = 40;
        // Interval i runs [10 i, 10 i + 10] on its own channel; later intervals have higher priority.
        const input = Array.from({ length: count }, (_, i) =>
            channelRow(i + 1, count - i, i * 10, i * 10 + 10, `chan-${i}`),
        );

        const rows = model.createReserves(input);

        expect(rows.filter((row: any) => row.isConflict)).toEqual([]);
        expect(ids(rows)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    });

    it('[RM-6.1] returns the planned reservations in start order, ties in priority order', () => {
        const { model } = makeModel();
        model.setTuners([{ types: ['GR'] }, { types: ['GR'] }, { types: ['GR'] }]);

        const rows = model.createReserves([
            channelRow(3, 5, 30, 40, 'chan-c'),
            channelRow(2, 2, 0, 10, 'chan-b'),
            channelRow(1, 1, 0, 10, 'chan-a'),
        ]);

        expect(ids(rows)).toEqual([1, 2, 3]);
    });

    it('[RM-6.3] puts a manual reservation before a rule reservation whatever their update times are', () => {
        const { model } = makeModel();
        const manual = makeReserve({ id: 1, ruleId: null, updateTime: 500 });
        const rule = makeReserve({ id: 2, ruleId: 3, updateTime: 100 });

        expect(model.sortReserve(manual, rule)).toBeLessThan(0);
        expect(model.sortReserve(rule, manual)).toBeGreaterThan(0);
    });
});

describe('program duplicate handling in the plane sweep', () => {
    it('[RM-6.2] folds manual reservations of the same program even when their stored conflict states differ', () => {
        const { model } = makeModel();

        const rows = model.createReserves([
            makeReserve({ id: 1, programId: 60, ruleId: null, isConflict: false }),
            makeReserve({ id: 2, programId: 60, ruleId: null, isConflict: true }),
        ]);

        expect(ids(rows)).toEqual([1]);
    });

    it('[RM-6.2] hides other rules reservations of a program skipped by one rule, but only for rule skips', () => {
        const { model } = makeModel();

        const rows = model.createReserves([
            makeReserve({ id: 1, ruleId: 1, programId: 50, isSkip: true }),
            makeReserve({ id: 2, ruleId: 2, programId: 50 }),
            makeReserve({ id: 3, ruleId: null, programId: 60, isSkip: true }),
            makeReserve({ id: 4, ruleId: 3, programId: 60 }),
            makeReserve({ id: 5, ruleId: 4, programId: 70, isEventRelay: true, isSkip: true }),
            makeReserve({ id: 6, ruleId: 5, programId: 70 }),
            makeReserve({ id: 7, ruleId: 6, programId: 80 }),
        ]);

        expect(ids(rows).sort()).toEqual([1, 3, 4, 5, 6, 7]);
    });
});
