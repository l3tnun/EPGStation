import { describe, expect, it, vi } from 'vitest';
import { makeModel, makeReserve, ReserveEvent } from './_harness';

describe('rule reconciliation characterization', () => {
    it('[RM-3.1] projects rule metadata and program duplicate state into a row', () => {
        const { model } = makeModel();
        const row = makeReserve({ ruleId: null, ruleUpdateCnt: null, isOverlap: false });
        model.setProgramToRuleReserve(
            row,
            makeReserve({ id: 90, overlap: true }),
            { id: 12, updateCnt: 4, reserveOption: { allowEndLack: true, tags: ['rule'] } },
            500,
        );
        expect(row).toMatchObject({
            ruleId: 12,
            ruleUpdateCnt: 4,
            updateTime: 500,
            allowEndLack: true,
            tags: '["rule"]',
            isOverlap: true,
        });
    });

    it('preserves relay rows by excluding them from the rule lookup', async () => {
        const harness = makeModel();
        await harness.model.updateRule(12, true, false);
        expect(harness.reserveDB.findRuleId).toHaveBeenCalledWith(
            expect.objectContaining({ ruleId: 12, hasEventRelay: false }),
        );
        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ insert: [], update: [], delete: [] }),
        );
    });

    it('[RM-3.2] projects a time candidate with its rule and channel identity', () => {
        const { model } = makeModel();
        const row = makeReserve({ programId: null, isTimeSpecified: true, channelId: 10, channel: 'synthetic-time' });
        model.setProgramToRuleReserve(
            row,
            null,
            { id: 13, updateCnt: 5, reserveOption: { allowEndLack: false, tags: ['time-rule'] } },
            600,
        );

        expect(row).toMatchObject({
            ruleId: 13,
            ruleUpdateCnt: 5,
            programId: null,
            isTimeSpecified: true,
            channelId: 10,
            updateTime: 600,
        });
    });

    it('[RM-3.3] applies insert, update, and delete reconciliation as one rule diff', async () => {
        const ledger: string[] = [];
        const event = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
        const delivered = vi.fn(() => ledger.push('event'));
        event.setUpdated(delivered);
        const updatedReserve = makeReserve({
            id: 31,
            ruleId: 14,
            ruleUpdateCnt: 1,
            programId: 131,
            programUpdateTime: 1,
        });
        const deletedReserve = makeReserve({ id: 32, ruleId: 14, programId: 133, programUpdateTime: 1 });
        const updatedProgram = makeReserve({ id: 131, programId: 131, updateTime: 2, overlap: false });
        const insertedProgram = makeReserve({ id: 132, programId: 132, updateTime: 2, overlap: false });
        const harness = makeModel({
            ledger,
            reserveEvent: event,
            programDB: { findId: async () => null, findRule: async () => [updatedProgram, insertedProgram] },
            ruleDB: {
                findId: async () => ({
                    id: 14,
                    updateCnt: 2,
                    isTimeSpecification: false,
                    searchOption: {},
                    reserveOption: { enable: true, allowEndLack: false },
                }),
                getIds: async () => [],
            },
        });
        harness.model.setTuners([{ types: ['GR'] }]);
        harness.reserveDB.findRuleId.mockResolvedValue([updatedReserve, deletedReserve]);

        await harness.model.updateRule(14);
        expect(harness.reserveDB.updateMany).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                insert: [expect.objectContaining({ programId: 132, ruleId: 14 })],
                update: [expect.objectContaining({ id: 31, programId: 131, ruleId: 14 })],
                delete: [expect.objectContaining({ id: 32 })],
            }),
        );
        expect(ledger).toEqual(['lock', 'commit', 'unlock', 'event']);
        expect(delivered).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                insert: [expect.objectContaining({ programId: 132, ruleId: 14 })],
                update: [expect.objectContaining({ id: 31, programId: 131, ruleId: 14 })],
                delete: [expect.objectContaining({ id: 32 })],
            }),
        );
    });

    it('[R2-R8] updateRule rejects when the existing rule-reservation lookup itself fails', async () => {
        const harness = makeModel();
        const failure = new Error('synthetic findRuleId failure');
        harness.reserveDB.findRuleId.mockRejectedValue(failure);

        await expect(harness.model.updateRule(20)).rejects.toBe(failure);

        expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
        expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
    });

    it('copies skip/overlap state from a matching old candidate onto a regenerated time-specified rule reservation', async () => {
        vi.useFakeTimers();
        try {
            const baseTime = new Date('2026-09-24T00:00:00+09:00').getTime();
            vi.setSystemTime(baseTime);
            const ruleId = 21;
            const channel = { id: 10, channel: 'synthetic-time-rule-channel', channelType: 'GR' };
            const startAt = baseTime + 3_600_000;
            const endAt = baseTime + 7_200_000;
            const oldReserve = makeReserve({
                id: 900,
                ruleId,
                programId: null,
                isTimeSpecified: true,
                startAt,
                endAt,
                channel: channel.channel,
                ruleUpdateCnt: 3,
                isSkip: true,
                isIgnoreOverlap: true,
                isOverlap: true,
            });
            const harness = makeModel({
                channelDB: { findId: vi.fn(async () => channel) },
                ruleDB: {
                    findId: vi.fn(async () => ({
                        id: ruleId,
                        updateCnt: 5,
                        isTimeSpecification: true,
                        searchOption: {
                            keyword: 'synthetic-keyword',
                            channelIds: [10],
                            times: [{ week: 0x10, start: 3600, range: 3600 }],
                        },
                        reserveOption: { enable: true, allowEndLack: false },
                    })),
                    getIds: vi.fn(async () => []),
                },
            });
            harness.reserveDB.findRuleId.mockResolvedValue([oldReserve]);

            await harness.model.updateRule(ruleId);

            expect(harness.reserveDB.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    update: [
                        expect.objectContaining({
                            startAt,
                            endAt,
                            ruleUpdateCnt: 5,
                            isSkip: true,
                            isIgnoreOverlap: true,
                            isOverlap: true,
                        }),
                    ],
                }),
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the prior overlap state when isIgnoreOverlap is set, ignoring the fresh program overlap result', async () => {
        const oldReserve = makeReserve({
            id: 910,
            ruleId: 22,
            programId: 191,
            programUpdateTime: 1,
            isIgnoreOverlap: true,
            isOverlap: true,
        });
        const program = makeReserve({ id: 191, programId: 191, updateTime: 2, overlap: false });
        const harness = makeModel({
            programDB: { findId: async () => null, findRule: async () => [program] },
            ruleDB: {
                findId: async () => ({
                    id: 22,
                    updateCnt: 9,
                    isTimeSpecification: false,
                    searchOption: {},
                    reserveOption: { enable: true, allowEndLack: false },
                }),
                getIds: async () => [],
            },
        });
        harness.model.setTuners([{ types: ['GR'] }]);
        harness.reserveDB.findRuleId.mockResolvedValue([oldReserve]);

        await harness.model.updateRule(22);

        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                update: [expect.objectContaining({ id: 910, isIgnoreOverlap: true, isOverlap: true })],
            }),
        );
    });

    it('forces a diff for a stale-but-unchanged time-specified rule reservation on the first update pass', async () => {
        vi.useFakeTimers();
        try {
            const baseTime = new Date('2026-09-24T00:00:00+09:00').getTime();
            vi.setSystemTime(baseTime);
            const ruleId = 23;
            const channel = { id: 11, channel: 'synthetic-first-update-channel', channelType: 'GR' };
            const startAt = baseTime + 3_600_000;
            const endAt = baseTime + 7_200_000;
            const oldReserve = makeReserve({
                id: 920,
                ruleId,
                programId: null,
                isTimeSpecified: true,
                startAt,
                endAt,
                channel: channel.channel,
                ruleUpdateCnt: 7,
            });
            const harness = makeModel({
                channelDB: { findId: vi.fn(async () => channel) },
                ruleDB: {
                    findId: vi.fn(async () => ({
                        id: ruleId,
                        updateCnt: 7,
                        isTimeSpecification: true,
                        searchOption: {
                            keyword: 'synthetic-first-update',
                            channelIds: [11],
                            times: [{ week: 0x10, start: 3600, range: 3600 }],
                        },
                        reserveOption: { enable: true, allowEndLack: false },
                    })),
                    getIds: vi.fn(async () => []),
                },
            });
            harness.reserveDB.findRuleId.mockResolvedValue([oldReserve]);

            await harness.model.updateRule(ruleId, false, true);

            expect(harness.reserveDB.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    update: expect.arrayContaining([expect.objectContaining({ id: 920, startAt, endAt })]),
                }),
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it('[RM-3.4] removes future reservations when their rule is disabled', async () => {
        const oldReserve = makeReserve({ id: 41, ruleId: 15, programId: 141 });
        const harness = makeModel({
            ruleDB: {
                findId: async () => ({
                    id: 15,
                    updateCnt: 1,
                    isTimeSpecification: false,
                    searchOption: {},
                    reserveOption: { enable: false, allowEndLack: false },
                }),
                getIds: async () => [],
            },
        });
        harness.reserveDB.findRuleId.mockResolvedValue([oldReserve]);

        await harness.model.updateRule(15);
        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ delete: [expect.objectContaining({ id: 41 })] }),
        );
    });

    it('[RM-3.5] copies the supplied rule candidate fields without reinterpreting them', () => {
        const { model } = makeModel();
        const row = makeReserve({ ruleId: null, tags: null });
        const candidate = makeReserve({ id: 151, programId: 151, name: 'candidate-name', overlap: true });
        model.setProgramToRuleReserve(
            row,
            candidate,
            { id: 16, updateCnt: 7, reserveOption: { allowEndLack: true, tags: ['candidate-tag'] } },
            700,
        );

        expect(row).toMatchObject({
            ruleId: 16,
            programId: 151,
            name: 'candidate-name',
            isOverlap: true,
            tags: '["candidate-tag"]',
        });
    });
});

describe('rule reservations that share a program (per-program exclusion)', () => {
    const PROGRAM_ID = 801;

    // 保存された予約を保持する最小の ReserveDB。実装の条件（時間帯・skip・ルール除外）を再現する
    const makeSharedProgramScenario = () => {
        const rows: any[] = [];
        let nextId = 1000;
        const rules = new Map<number, any>();
        for (const id of [1, 2]) {
            rules.set(id, {
                id,
                updateCnt: 1,
                isTimeSpecification: false,
                searchOption: {},
                reserveOption: { enable: true, allowEndLack: false },
            });
        }
        const program = makeReserve({ id: PROGRAM_ID, programId: PROGRAM_ID, updateTime: 5, overlap: false });
        const harness = makeModel({
            programDB: {
                findId: vi.fn(async () => null),
                findRule: vi.fn(async () => [{ ...program }]),
            },
            ruleDB: {
                findId: vi.fn(async (id: number) => rules.get(id) ?? null),
                getIds: vi.fn(async () => [...rules.keys()]),
            },
        });
        harness.model.setTuners([{ types: ['GR'] }]);
        const copy = (list: any[]) => list.map(row => ({ ...row }));
        harness.reserveDB.findId.mockImplementation(async (id: number) => {
            const row = rows.find(r => r.id === id);
            return row === undefined ? null : { ...row };
        });
        harness.reserveDB.findLists.mockImplementation(async () => copy(rows));
        harness.reserveDB.findProgramId.mockImplementation(async (programId: number) =>
            copy(rows.filter(r => r.programId === programId)),
        );
        harness.reserveDB.findRuleId.mockImplementation(async (option: any) =>
            copy(
                rows.filter(
                    r =>
                        r.ruleId === option.ruleId &&
                        (option.hasSkip !== false || !r.isSkip) &&
                        (option.hasEventRelay !== false || !r.isEventRelay),
                ),
            ),
        );
        harness.reserveDB.findTimeRanges.mockImplementation(async (option: any) =>
            copy(
                rows.filter(
                    r =>
                        option.times.some((t: any) => r.endAt >= t.startAt && r.startAt < t.endAt) &&
                        (option.hasSkip !== false || !r.isSkip) &&
                        (option.hasConflict !== false || !r.isConflict) &&
                        (option.hasOverlap !== false || !r.isOverlap) &&
                        (option.excludeRuleId === undefined || r.ruleId !== option.excludeRuleId) &&
                        (option.excludeReserveId === undefined || r.id !== option.excludeReserveId),
                ),
            ),
        );
        harness.reserveDB.updateMany.mockImplementation(async (diff: any) => {
            for (const row of diff.delete ?? [])
                rows.splice(
                    rows.findIndex(r => r.id === row.id),
                    1,
                );
            for (const row of diff.update ?? []) rows[rows.findIndex(r => r.id === row.id)] = { ...row };
            for (const row of diff.insert ?? []) rows.push({ ...row, id: nextId++ });
        });

        const live = () => rows.filter(r => r.programId === PROGRAM_ID && !r.isSkip && !r.isOverlap);
        const find = (ruleId: number) => rows.find(r => r.programId === PROGRAM_ID && r.ruleId === ruleId);

        return { harness, rows, rules, live, find, program };
    };

    // 両方のルールに一致する番組で、ルール 1 の予約だけが作られ、ルール 1 の予約を除外した状態まで進める
    const skipRule1Reservation = async (scenario: ReturnType<typeof makeSharedProgramScenario>) => {
        await scenario.harness.model.updateRule(1, true);
        await scenario.harness.model.updateRule(2, true);
        expect(scenario.rows.map(r => r.ruleId)).toEqual([1]);
        await scenario.harness.model.cancel(scenario.find(1).id);
        expect(scenario.find(1)).toMatchObject({ isSkip: true });
    };

    it('[RM-T07][RM-5.1][#538] updateRule does not create a live reservation of another rule for a program whose reservation is skipped', async () => {
        const scenario = makeSharedProgramScenario();
        await skipRule1Reservation(scenario);

        await scenario.harness.model.updateRule(2, true);

        expect(scenario.live()).toEqual([]);
        expect(scenario.find(2)).toBeUndefined();
    });

    it('[RM-T07][RM-5.1][#538] updateAll does not create a live reservation of another rule for a program whose reservation is skipped', async () => {
        const scenario = makeSharedProgramScenario();
        await skipRule1Reservation(scenario);

        await scenario.harness.model.updateAll();

        expect(scenario.live()).toEqual([]);
        expect(scenario.find(2)).toBeUndefined();
    });

    it('[RM-T07][RM-5.1][#538] updateRule removes a live reservation left beside a skipped reservation of another rule', async () => {
        const scenario = makeSharedProgramScenario();
        // 以前の版で作られた状態: ルール 1 は除外済み、ルール 2 は除外されていない予約が残っている
        scenario.rows.push(
            makeReserve({
                id: 1,
                ruleId: 1,
                ruleUpdateCnt: 1,
                programId: PROGRAM_ID,
                programUpdateTime: 1,
                isSkip: true,
            }),
            makeReserve({ id: 2, ruleId: 2, ruleUpdateCnt: 1, programId: PROGRAM_ID, programUpdateTime: 1 }),
        );

        await scenario.harness.model.updateRule(2, true);

        expect(scenario.live()).toEqual([]);
        expect(scenario.find(1)).toMatchObject({ isSkip: true });
    });

    it('[RM-T07][RM-5.1][#538] removing the skip restores exactly one live reservation, and later updates keep it single', async () => {
        const scenario = makeSharedProgramScenario();
        await skipRule1Reservation(scenario);
        await scenario.harness.model.updateRule(2, true);
        await scenario.harness.model.updateAll();

        await scenario.harness.model.removeSkip(scenario.find(1).id);
        expect(scenario.live().map(r => r.ruleId)).toEqual([1]);

        await scenario.harness.model.updateRule(2, true);
        await scenario.harness.model.updateAll();
        expect(scenario.live().map(r => r.ruleId)).toEqual([1]);
    });

    it('[RM-T07][RM-5.1][#538] keeps the skipped reservations of both rules when two rules already have a skipped reservation for the program', async () => {
        const scenario = makeSharedProgramScenario();
        // 番組単位の除外になる前の版で、利用者が両方のルールの予約を除外した状態
        scenario.rows.push(
            makeReserve({
                id: 1,
                ruleId: 1,
                ruleUpdateCnt: 1,
                programId: PROGRAM_ID,
                programUpdateTime: 1,
                isSkip: true,
            }),
            makeReserve({
                id: 2,
                ruleId: 2,
                ruleUpdateCnt: 1,
                programId: PROGRAM_ID,
                programUpdateTime: 1,
                isSkip: true,
            }),
        );

        await scenario.harness.model.updateRule(1, true);
        await scenario.harness.model.updateRule(2, true);
        await scenario.harness.model.updateAll();

        expect(scenario.live()).toEqual([]);
        expect(scenario.rows.map(r => [r.ruleId, r.isSkip])).toEqual([
            [1, true],
            [2, true],
        ]);
    });

    it('[RM-T07][RM-5.3][#538] removeSkip releases the skipped reservations of every rule for the program, leaving one live reservation', async () => {
        const scenario = makeSharedProgramScenario();
        // 番組単位の除外になる前の版で、利用者が両方のルールの予約を除外した状態
        scenario.rows.push(
            makeReserve({
                id: 1,
                ruleId: 1,
                ruleUpdateCnt: 1,
                programId: PROGRAM_ID,
                programUpdateTime: 5,
                isSkip: true,
            }),
            makeReserve({
                id: 2,
                ruleId: 2,
                ruleUpdateCnt: 1,
                programId: PROGRAM_ID,
                programUpdateTime: 5,
                isSkip: true,
            }),
        );

        await scenario.harness.model.removeSkip(1);
        await scenario.harness.model.updateRule(1, true);
        await scenario.harness.model.updateRule(2, true);
        await scenario.harness.model.updateAll();

        expect(scenario.live().map(r => r.ruleId)).toEqual([1]);
        expect(scenario.rows).toHaveLength(1);
    });

    it('[RM-T07][RM-5.3][#538] removeSkip does not release the skipped reservation of a different program', async () => {
        const scenario = makeSharedProgramScenario();
        scenario.rows.push(
            makeReserve({
                id: 1,
                ruleId: 1,
                ruleUpdateCnt: 1,
                programId: PROGRAM_ID,
                programUpdateTime: 5,
                isSkip: true,
            }),
            makeReserve({ id: 2, ruleId: 2, ruleUpdateCnt: 1, programId: 802, programUpdateTime: 5, isSkip: true }),
        );

        await scenario.harness.model.removeSkip(1);

        expect(scenario.rows.find(r => r.id === 1)).toMatchObject({ isSkip: false });
        expect(scenario.rows.find(r => r.id === 2)).toMatchObject({ isSkip: true });
    });

    it('[RM-T07][RM-5.1][#538] updateRule removes an overlap reservation of another rule for a skipped program', async () => {
        const scenario = makeSharedProgramScenario();
        scenario.rows.push(
            makeReserve({
                id: 1,
                ruleId: 1,
                ruleUpdateCnt: 1,
                programId: PROGRAM_ID,
                programUpdateTime: 5,
                isSkip: true,
            }),
            makeReserve({
                id: 2,
                ruleId: 2,
                ruleUpdateCnt: 1,
                programId: PROGRAM_ID,
                programUpdateTime: 5,
                isOverlap: true,
            }),
        );

        scenario.program.overlap = true;

        await scenario.harness.model.updateRule(2, true);

        expect(scenario.find(2)).toBeUndefined();
        expect(scenario.find(1)).toMatchObject({ isSkip: true });
    });

    it('[RM-T07][RM-5.1][#538] updateRule does not create an overlap reservation of another rule for a skipped program', async () => {
        const scenario = makeSharedProgramScenario();
        await skipRule1Reservation(scenario);
        scenario.program.overlap = true;

        await scenario.harness.model.updateRule(2, true);
        await scenario.harness.model.updateAll();

        expect(scenario.find(2)).toBeUndefined();
        expect(scenario.live()).toEqual([]);
    });

    it('[RM-T07][RM-5.1][#538] keeps the overlap reservations of both rules for a program that has no skipped reservation', async () => {
        const scenario = makeSharedProgramScenario();
        scenario.program.overlap = true;
        scenario.rows.push(
            makeReserve({
                id: 1,
                ruleId: 1,
                ruleUpdateCnt: 1,
                programId: PROGRAM_ID,
                programUpdateTime: 5,
                isOverlap: true,
            }),
            makeReserve({
                id: 2,
                ruleId: 2,
                ruleUpdateCnt: 1,
                programId: PROGRAM_ID,
                programUpdateTime: 5,
                isOverlap: true,
            }),
        );

        await scenario.harness.model.updateRule(1, true);
        await scenario.harness.model.updateRule(2, true);
        await scenario.harness.model.updateAll();

        expect(scenario.rows.map(r => [r.ruleId, r.isOverlap, r.isSkip])).toEqual([
            [1, true, false],
            [2, true, false],
        ]);
    });

    it('[RM-T07][RM-5.1][#538] cancel removes the overlap reservation of another rule for the program in the same diff', async () => {
        const scenario = makeSharedProgramScenario();
        scenario.rows.push(
            makeReserve({ id: 1, ruleId: 1, ruleUpdateCnt: 1, programId: PROGRAM_ID, programUpdateTime: 5 }),
            makeReserve({
                id: 2,
                ruleId: 2,
                ruleUpdateCnt: 1,
                programId: PROGRAM_ID,
                programUpdateTime: 5,
                isOverlap: true,
            }),
        );

        await scenario.harness.model.cancel(1);

        expect(scenario.find(1)).toMatchObject({ isSkip: true });
        expect(scenario.find(2)).toBeUndefined();
        expect(scenario.live()).toEqual([]);
    });

    it('[RM-T07][RM-5.1][#538] a manual reservation of the program is kept, and no other rule reserves it, while a rule reservation is skipped', async () => {
        const scenario = makeSharedProgramScenario();
        await skipRule1Reservation(scenario);
        scenario.rows.push(makeReserve({ id: 5, ruleId: null, programId: PROGRAM_ID, isTimeSpecified: false }));

        await scenario.harness.model.updateRule(2, true);
        await scenario.harness.model.updateAll();

        expect(scenario.find(2)).toBeUndefined();
        expect(scenario.live().map(r => r.id)).toEqual([5]);
        expect(scenario.find(1)).toMatchObject({ isSkip: true });
    });

    it.each(['deleted', 'disabled'] as const)(
        '[RM-T07][RM-5.1][#538] a skip disappears with its rule when that rule is %s, and the other rule reserves the program again',
        async change => {
            const scenario = makeSharedProgramScenario();
            await skipRule1Reservation(scenario);
            await scenario.harness.model.updateRule(2, true);
            expect(scenario.live()).toEqual([]);

            if (change === 'deleted') {
                scenario.rules.delete(1);
            } else {
                scenario.rules.get(1).reserveOption.enable = false;
            }
            await scenario.harness.model.updateRule(1, true);
            expect(scenario.find(1)).toBeUndefined();

            await scenario.harness.model.updateRule(2, true);
            expect(scenario.live().map(r => r.ruleId)).toEqual([2]);
        },
    );
});
