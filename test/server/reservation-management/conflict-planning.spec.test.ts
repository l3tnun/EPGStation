import { describe, expect, it } from 'vitest';
import { makeModel, makeReserve } from './_harness';

describe('conflict planning characterization', () => {
    it('[RM-6.1] treats adjacent intervals on distinct channels as half-open', () => {
        const { model } = makeModel();
        model.setTuners([{ types: ['GR'] }]);
        const rows = model.createReserves([
            makeReserve({ id: 1, programId: 101, startAt: 0, endAt: 10, channelId: 1, channel: 'first' }),
            makeReserve({ id: 2, programId: 102, startAt: 10, endAt: 20, channelId: 2, channel: 'second' }),
            makeReserve({ id: 3, programId: 103, startAt: 20, endAt: 30, channelId: 3, channel: 'third' }),
        ]);
        expect(rows.map((row: any) => row.isConflict)).toEqual([false, false, false]);
    });

    it('[RM-6.3] gives a manual reservation priority over a rule reservation', () => {
        const { model } = makeModel();
        const rows = [
            makeReserve({ id: 1, ruleId: 9 }),
            makeReserve({ id: 2, ruleId: null, isTimeSpecified: false, updateTime: 20 }),
            makeReserve({ id: 3, ruleId: null, isTimeSpecified: true, updateTime: 30 }),
            makeReserve({ id: 4, ruleId: null, isTimeSpecified: false, updateTime: 10 }),
            makeReserve({ id: 5, ruleId: 2 }),
        ];
        expect(rows.sort((a, b) => model.sortReserve(a, b)).map(row => row.id)).toEqual([3, 4, 2, 5, 1]);
    });

    it('excludes a duplicate program candidate sharing the same program identity', () => {
        const { model } = makeModel();
        const rows = model.createReserves([
            makeReserve({ id: 1, programId: 60, ruleId: null }),
            makeReserve({ id: 2, programId: 60, ruleId: null }),
        ]);
        expect(rows.map((row: any) => row.id)).toEqual([1]);
    });

    it('does not flag a zero-duration candidate against an active span at the exact same instant', () => {
        // A zero-duration candidate (startAt === endAt) produces a start and an end list
        // entry tied at the same instant. The list-sort tie-break orders the end entry
        // before the start entry (ReservationManageModel.ts:1604-1606), so this candidate's
        // own end is evaluated before its own start is ever added to the active set. That
        // ordering also evicts whatever reservation the plane-sweep currently holds active
        // (ReservationManageModel.ts:1624-1627 looks the removed index up by identity and
        // splices whatever it finds), so a genuinely overlapping active reservation is
        // dropped from consideration for this instant. Contrast with the non-tied case
        // below, where the same pair of reservations is correctly flagged as conflicting.
        const { model } = makeModel();
        model.setTuners([{ types: ['GR'] }]);
        const spanning = makeReserve({
            id: 1,
            programId: 201,
            ruleId: null,
            updateTime: 1,
            startAt: 0,
            endAt: 100,
            channel: 'chan-a',
        });
        const instant = makeReserve({
            id: 2,
            programId: 202,
            ruleId: null,
            updateTime: 2,
            startAt: 50,
            endAt: 50,
            channel: 'chan-b',
        });

        const rows = model.createReserves([spanning, instant]);

        expect(rows.map((row: any) => ({ id: row.id, isConflict: row.isConflict }))).toEqual([
            { id: 1, isConflict: false },
            { id: 2, isConflict: false },
        ]);
    });

    it('flags the same pair as conflicting once the candidate has a distinct (non-tied) endpoint', () => {
        const { model } = makeModel();
        model.setTuners([{ types: ['GR'] }]);
        const spanning = makeReserve({
            id: 1,
            programId: 201,
            ruleId: null,
            updateTime: 1,
            startAt: 0,
            endAt: 100,
            channel: 'chan-a',
        });
        const overlapping = makeReserve({
            id: 2,
            programId: 202,
            ruleId: null,
            updateTime: 2,
            startAt: 50,
            endAt: 51,
            channel: 'chan-b',
        });

        const rows = model.createReserves([spanning, overlapping]);

        expect(rows.map((row: any) => ({ id: row.id, isConflict: row.isConflict }))).toEqual([
            { id: 1, isConflict: false },
            { id: 2, isConflict: true },
        ]);
    });

    // .kiro/specs/server-tuner-access/design.mdの正規化規則: TunerInfo.typesは既知5種（GR/BS/CS/SKY/
    // BS4K）以外の任意のserver定義文字列も含み得る。setTuners()に渡るこのtunerは、GRのreserve.channelType
    // とindexOfで一致しないため（Tuner.ts）、既知種別（BS4K）・未知種別（WOWOW-4K）のいずれであっても
    // GR用の空きtunerとしては数えられない。1台のGR tunerに対する既存の conflict 判定（このfile冒頭の
    // 'flags the same pair as conflicting...'test）に、GR以外の種別しか持たないtunerを追加してもconflict
    // 判定が変わらないことを確認する。
    it('does not relieve a GR conflict with an extra tuner whose types are only non-GR broadcast types (known BS4K or genuinely unknown)', () => {
        const { model } = makeModel();
        model.setTuners([{ types: ['GR'] }, { types: ['BS4K'] }, { types: ['WOWOW-4K'] }]);
        const spanning = makeReserve({
            id: 1,
            programId: 201,
            ruleId: null,
            updateTime: 1,
            startAt: 0,
            endAt: 100,
            channel: 'chan-a',
        });
        const overlapping = makeReserve({
            id: 2,
            programId: 202,
            ruleId: null,
            updateTime: 2,
            startAt: 50,
            endAt: 51,
            channel: 'chan-b',
        });

        const rows = model.createReserves([spanning, overlapping]);

        expect(rows.map((row: any) => ({ id: row.id, isConflict: row.isConflict }))).toEqual([
            { id: 1, isConflict: false },
            { id: 2, isConflict: true },
        ]);
    });

    // BS4KはGR/BS/CS/SKYと対等な既知種別。BS4K予約はGR tunerだけでは救われず、BS4K tunerがあって
    // 初めてconflictが解消されることを確認する（Tuner.add()のindexOf一致がchannelType文字列単位である
    // ことの直接の帰結）。
    it('a BS4K reservation conflict is relieved only by a BS4K tuner, not by a GR-only tuner', () => {
        const spanning = makeReserve({
            id: 1,
            programId: 201,
            ruleId: null,
            updateTime: 1,
            startAt: 0,
            endAt: 100,
            channel: 'chan-a',
            channelType: 'BS4K',
        });
        const overlapping = makeReserve({
            id: 2,
            programId: 202,
            ruleId: null,
            updateTime: 2,
            startAt: 50,
            endAt: 51,
            channel: 'chan-b',
            channelType: 'BS4K',
        });

        const grOnly = makeModel();
        grOnly.model.setTuners([{ types: ['GR'] }]);
        const grOnlyRows = grOnly.model.createReserves([spanning, overlapping]);
        expect(grOnlyRows.map((row: any) => ({ id: row.id, isConflict: row.isConflict }))).toEqual([
            { id: 1, isConflict: true },
            { id: 2, isConflict: true },
        ]);

        // A single BS4K tuner has the same one-at-a-time capacity as the existing single-GR-tuner
        // case above ('flags the same pair as conflicting...'): the first (spanning) reservation
        // claims the tuner, and the second (overlapping) reservation still conflicts because the
        // two overlap in time on distinct channels and only one BS4K tuner exists.
        const withBs4k = makeModel();
        withBs4k.model.setTuners([{ types: ['GR'] }, { types: ['BS4K'] }]);
        const withBs4kRows = withBs4k.model.createReserves([spanning, overlapping]);
        expect(withBs4kRows.map((row: any) => ({ id: row.id, isConflict: row.isConflict }))).toEqual([
            { id: 1, isConflict: false },
            { id: 2, isConflict: true },
        ]);
    });

    it('[RM-6.8] marks candidates conflicting with zero tuner capability without assigning a tuner id', () => {
        const { model } = makeModel();
        const [row] = model.createReserves([makeReserve()]);
        expect(row.isConflict).toBe(true);
        expect(row).not.toHaveProperty('tunerId');
    });

    it('[RM-6.2] allows simultaneous reservations on the same channel to share one tuner', () => {
        const { model } = makeModel();
        model.setTuners([{ types: ['GR'] }]);
        const rows = model.createReserves([
            makeReserve({ id: 11, programId: 111, channelId: 11, channel: 'shared', startAt: 0, endAt: 10 }),
            makeReserve({ id: 12, programId: 112, channelId: 11, channel: 'shared', startAt: 0, endAt: 10 }),
        ]);

        expect(rows.map((row: any) => row.isConflict)).toEqual([false, false]);
    });

    it('[RM-6.4] gives a time manual priority over a program manual', () => {
        const { model } = makeModel();
        const programManual = makeReserve({ id: 21, ruleId: null, isTimeSpecified: false, updateTime: 1 });
        const timeManual = makeReserve({ id: 22, ruleId: null, isTimeSpecified: true, updateTime: 2 });

        expect(
            [programManual, timeManual].sort((left, right) => model.sortReserve(left, right)).map(row => row.id),
        ).toEqual([22, 21]);
    });

    it('[RM-6.5] gives the older same-kind manual priority by update time', () => {
        const { model } = makeModel();
        const newer = makeReserve({ id: 31, ruleId: null, updateTime: 20 });
        const older = makeReserve({ id: 32, ruleId: null, updateTime: 10 });

        expect([newer, older].sort((left, right) => model.sortReserve(left, right)).map(row => row.id)).toEqual([
            32, 31,
        ]);
    });

    it('[RM-6.6] gives the smaller rule identifier priority among rule reservations', () => {
        const { model } = makeModel();
        const laterRule = makeReserve({ id: 41, ruleId: 9 });
        const earlierRule = makeReserve({ id: 42, ruleId: 2 });

        expect(
            [laterRule, earlierRule].sort((left, right) => model.sortReserve(left, right)).map(row => row.id),
        ).toEqual([42, 41]);
    });

    it('[RM-6.7] recalculates affected reservations when a skip state is removed', async () => {
        const harness = makeModel();
        harness.model.setTuners([{ types: ['GR'] }]);
        harness.reserveDB.findId.mockResolvedValue(makeReserve({ id: 51, ruleId: 8, isSkip: true }));

        await harness.model.removeSkip(51);
        expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledWith(
            expect.objectContaining({ excludeReserveId: 51, hasSkip: false, hasConflict: true, hasOverlap: false }),
        );
    });
});
