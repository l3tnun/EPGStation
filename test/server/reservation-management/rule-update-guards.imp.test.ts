import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeModel, makeReserve } from './_harness';

const BASE_TIME = new Date('2026-09-24T00:00:00+09:00').getTime();
const CHANNEL = { id: 10, channel: 'synthetic-time-rule-channel', channelType: 'GR' };

const timeRule = (overrides: Record<string, any> = {}, searchOption: Record<string, any> = {}) => ({
    id: 21,
    updateCnt: 1,
    isTimeSpecification: true,
    searchOption: {
        keyword: 'synthetic-keyword',
        channelIds: [10],
        times: [{ week: 0x10, start: 3600, range: 3600 }],
        ...searchOption,
    },
    reserveOption: { enable: true, allowEndLack: false },
    ...overrides,
});

const programRule = (overrides: Record<string, any> = {}) => ({
    id: 22,
    updateCnt: 1,
    isTimeSpecification: false,
    searchOption: {},
    reserveOption: { enable: true, allowEndLack: false },
    ...overrides,
});

const makeTimeRuleHarness = (rule: Record<string, any>, oldReserves: any[] = []) => {
    const harness = makeModel({
        channelDB: { findId: vi.fn(async () => CHANNEL) },
        ruleDB: { findId: vi.fn(async () => rule), getIds: vi.fn(async () => []) },
    });
    harness.model.setTuners([{ types: ['GR'] }]);
    harness.reserveDB.findRuleId.mockResolvedValue(oldReserves);
    return harness;
};

const oldTimeReserve = (ruleUpdateCnt: number) =>
    makeReserve({
        id: 900,
        ruleId: 21,
        programId: null,
        isTimeSpecified: true,
        startAt: BASE_TIME + 3_600_000,
        endAt: BASE_TIME + 7_200_000,
        channel: CHANNEL.channel,
        ruleUpdateCnt,
    });

describe('rule update guards', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('[RM-3.3] looks up the existing rule reservations and affected time ranges with the full search options', async () => {
        const old = makeReserve({ id: 5, ruleId: 22, programId: 7, startAt: 1_000, endAt: 2_000 });
        const harness = makeModel({
            ruleDB: { findId: vi.fn(async () => programRule()), getIds: vi.fn(async () => []) },
        });
        harness.reserveDB.findRuleId.mockResolvedValue([old]);

        await harness.model.updateRule(22);

        expect(harness.reserveDB.findRuleId).toHaveBeenCalledExactlyOnceWith({
            ruleId: 22,
            hasSkip: true,
            hasConflict: true,
            hasOverlap: true,
            hasEventRelay: false,
        });
        expect(harness.reserveDB.findTimeRanges).toHaveBeenCalledExactlyOnceWith({
            times: [{ startAt: 1_000, endAt: 2_000 }],
            hasSkip: true,
            hasConflict: true,
            hasOverlap: true,
            excludeRuleId: 22,
        });
    });

    it('[RM-3.3] emits the rule diff with log output not suppressed when called with the defaults', async () => {
        const harness = makeModel();

        await harness.model.updateRule(22);

        expect(harness.reserveEvent.emitUpdated.mock.calls[0][0].isSuppressLog).toBe(false);
    });

    it('[RM-3.3] propagates the failure of the affected reservation lookup', async () => {
        const failure = new Error('synthetic findTimeRanges failure');
        const harness = makeModel({
            ruleDB: { findId: vi.fn(async () => programRule()), getIds: vi.fn(async () => []) },
        });
        harness.reserveDB.findTimeRanges.mockRejectedValue(failure);

        await expect(harness.model.updateRule(22)).rejects.toBe(failure);
        expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
    });

    it('[RM-3.3] does not search programs for a disabled rule and removes its existing reservations', async () => {
        const old = makeReserve({ id: 5, ruleId: 22, programId: 7 });
        const programDB = { findId: vi.fn(async () => null), findRule: vi.fn(async () => []) };
        const harness = makeModel({
            programDB,
            ruleDB: {
                findId: vi.fn(async () => programRule({ reserveOption: { enable: false, allowEndLack: false } })),
                getIds: vi.fn(async () => []),
            },
        });
        harness.reserveDB.findRuleId.mockResolvedValue([old]);

        await harness.model.updateRule(22);

        expect(programDB.findRule).not.toHaveBeenCalled();
        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ insert: [], update: [], delete: [expect.objectContaining({ id: 5 })] }),
        );
    });

    it('[RM-3.3] creates no time reservations for a disabled time-specified rule', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE_TIME);
        const harness = makeTimeRuleHarness(timeRule({ reserveOption: { enable: false, allowEndLack: false } }));

        await harness.model.updateRule(21);

        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ insert: [], update: [], delete: [] }),
        );
    });

    it.each([
        ['channel ids', { channelIds: undefined }],
        ['times', { times: undefined }],
        ['keyword', { keyword: undefined }],
    ])('[RM-3.4] rejects a time-specified rule that has no %s', async (_name, searchOption) => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE_TIME);
        const harness = makeTimeRuleHarness(timeRule({}, searchOption));

        await expect(harness.model.updateRule(21)).rejects.toThrow('RuleSearchOptionError');
        expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
    });

    it.each([
        ['start', { week: 0x10, range: 3600 }],
        ['range', { week: 0x10, start: 3600 }],
    ])('[RM-3.4] rejects a time-specified rule whose time has no %s', async (_name, time) => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE_TIME);
        const harness = makeTimeRuleHarness(timeRule({}, { times: [time] }));

        await expect(harness.model.updateRule(21)).rejects.toThrow('RuleSearchTimesOptionError');
        expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
    });

    it('[RM-3.5] forces a time-specified rule reservation to be rebuilt on the first update', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE_TIME);
        const harness = makeTimeRuleHarness(timeRule(), [oldTimeReserve(1)]);

        await harness.model.updateRule(21, true, true);

        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ update: [expect.objectContaining({ id: 900, ruleUpdateCnt: 1 })] }),
        );
    });

    it('[RM-3.5] leaves an unchanged time-specified rule reservation alone when it is not the first update', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE_TIME);
        const harness = makeTimeRuleHarness(timeRule(), [oldTimeReserve(1)]);

        await harness.model.updateRule(21, true, false);

        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith(expect.objectContaining({ update: [] }));
    });

    it('[RM-3.5] treats the first-update flag as off by default', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE_TIME);
        const harness = makeTimeRuleHarness(timeRule(), [oldTimeReserve(1)]);

        await harness.model.updateRule(21);

        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith(expect.objectContaining({ update: [] }));
    });

    it('[RM-3.5] does not force a program rule reservation to be rebuilt on the first update', async () => {
        const old = makeReserve({
            id: 5,
            ruleId: 22,
            programId: 7,
            programUpdateTime: 1,
            ruleUpdateCnt: 1,
        });
        const program = makeReserve({ id: 7, programId: 7, updateTime: 1, overlap: false });
        const harness = makeModel({
            programDB: { findId: vi.fn(async () => null), findRule: vi.fn(async () => [program]) },
            ruleDB: { findId: vi.fn(async () => programRule()), getIds: vi.fn(async () => []) },
        });
        harness.model.setTuners([{ types: ['GR'] }]);
        harness.reserveDB.findRuleId.mockResolvedValue([old]);

        await harness.model.updateRule(22, true, true);

        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith(expect.objectContaining({ update: [] }));
    });

    it('[RM-3.5] accepts a first update for a rule that no longer exists', async () => {
        const old = makeReserve({ id: 5, ruleId: 22, programId: 7, ruleUpdateCnt: 1 });
        const harness = makeModel();
        harness.reserveDB.findRuleId.mockResolvedValue([old]);

        await harness.model.updateRule(22, true, true);

        expect(harness.reserveDB.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ delete: [expect.objectContaining({ id: 5 })] }),
        );
    });
});

describe('reservation diff and startup lookups', () => {
    it('[RM-8.2] reports a program reservation whose program information changed as an update', () => {
        const { model } = makeModel();
        const oldReserve = makeReserve({ id: 1, ruleId: 3, programId: 5, programUpdateTime: 1, ruleUpdateCnt: 1 });
        const newReserve = Object.assign({}, oldReserve, { programUpdateTime: 2 });

        const diff = model.createReservesDiff([oldReserve], [newReserve], false);

        expect(diff.update).toEqual([expect.objectContaining({ id: 1, programUpdateTime: 2 })]);
        expect(diff.insert).toEqual([]);
        expect(diff.delete).toEqual([]);
    });

    it('[RM-8.2] reports a program reservation whose rule update counter changed as an update', () => {
        const { model } = makeModel();
        const oldReserve = makeReserve({ id: 1, ruleId: 3, programId: 5, programUpdateTime: 1, ruleUpdateCnt: 1 });
        const newReserve = Object.assign({}, oldReserve, { ruleUpdateCnt: 2 });

        const diff = model.createReservesDiff([oldReserve], [newReserve], false);

        expect(diff.update).toEqual([expect.objectContaining({ id: 1, ruleUpdateCnt: 2 })]);
    });

    it('[RM-8.2] reports no update for a program reservation that did not change', () => {
        const { model } = makeModel();
        const oldReserve = makeReserve({ id: 1, ruleId: 3, programId: 5, programUpdateTime: 1, ruleUpdateCnt: 1 });

        const diff = model.createReservesDiff([oldReserve], [Object.assign({}, oldReserve)], false);

        expect(diff.update).toEqual([]);
    });

    it('[RM-8.1] asks only for manual reservations that are not time reservations when updating everything', async () => {
        const harness = makeModel();

        await harness.model.updateAll();

        expect(harness.reserveDB.getManualIds).toHaveBeenCalledExactlyOnceWith({ hasTimeReserve: false });
    });
});

describe('manual reservation option check', () => {
    it('[RM-2.1] does not ask the encode option checker when the reservation has no encode option', async () => {
        const program = makeReserve({ id: 5, programId: 5 });
        const harness = makeModel({
            optionChecker: { checkEncodeOption: vi.fn(() => false) },
            programDB: { findId: vi.fn(async () => program), findRule: vi.fn() },
        });
        harness.model.setTuners([{ types: ['GR'] }]);

        await expect(harness.model.add({ allowEndLack: false, programId: 5 })).resolves.toBe(41);
        expect(harness.optionChecker.checkEncodeOption).not.toHaveBeenCalled();
    });
});
