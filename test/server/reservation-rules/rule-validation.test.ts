import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface RuleOption {
    encodeOption?: Record<string, unknown>;
    isTimeSpecification: boolean;
    reserveOption: Record<string, unknown>;
    saveOption?: Record<string, unknown>;
    searchOption: Record<string, unknown>;
}

interface RuleOptionChecker {
    checkRuleOption(rule: RuleOption): boolean;
}

interface RuleOptionCheckerConstructor {
    new (configuration: unknown): RuleOptionChecker;
}

interface RuleManager {
    add(rule: RuleOption): Promise<number>;
    update(rule: RuleOption & { id: number }): Promise<void>;
}

interface RuleManagerConstructor {
    new (logger: unknown, checker: unknown, repository: unknown, event: unknown): RuleManager;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const ReserveOptionChecker = (
    require(join(compiledSnapshot, 'model', 'operator', 'ReserveOptionChecker.js')) as {
        default: RuleOptionCheckerConstructor;
    }
).default;
const RuleManageModel = (
    require(join(compiledSnapshot, 'model', 'operator', 'rule', 'RuleManageModel.js')) as {
        default: RuleManagerConstructor;
    }
).default;

const configuredModes = ['archive', 'mobile', 'review'] as const;
const configuration = {
    getConfig: () => ({
        encode: configuredModes.map(name => ({ name, cmd: `synthetic-${name}` })),
    }),
};

const baseProgramRule = (): RuleOption => ({
    isTimeSpecification: false,
    searchOption: {},
    reserveOption: {
        enable: true,
        allowEndLack: false,
        avoidDuplicate: false,
    },
});

const baseTimeRule = (): RuleOption => ({
    isTimeSpecification: true,
    searchOption: {
        keyword: '',
        channelIds: [],
        times: [],
    },
    reserveOption: {
        enable: true,
        allowEndLack: false,
        avoidDuplicate: false,
    },
});

const withSearch = (base: RuleOption, searchOption: Record<string, unknown>): RuleOption => ({
    ...base,
    searchOption,
});

const checker = new ReserveOptionChecker(configuration);

const makeManagerHarness = (optionChecker: RuleOptionChecker = checker) => {
    const ledger: string[] = [];
    const repository = {
        findId: vi.fn(async () => baseProgramRule()),
        insertOnce: vi.fn(async () => {
            ledger.push('repository:insert');
            return 901;
        }),
        updateOnce: vi.fn(async () => {
            ledger.push('repository:update');
        }),
    };
    const event = {
        emitAdded: vi.fn(() => ledger.push('event:added:901')),
        emitDeleted: vi.fn(),
        emitDisabled: vi.fn(),
        emitEnabled: vi.fn(),
        emitUpdated: vi.fn((ruleId: number) => ledger.push(`event:updated:${ruleId}`)),
    };
    const manager = new RuleManageModel(
        { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn() } }) },
        optionChecker,
        repository,
        event,
    );

    return { event, ledger, manager, repository };
};

const expectValidationThroughAddAndUpdate = async (
    rule: RuleOption,
    accepted: boolean,
    optionChecker: RuleOptionChecker = checker,
): Promise<void> => {
    const { event, ledger, manager, repository } = makeManagerHarness(optionChecker);
    const updateRule = { ...rule, id: 902 };

    if (accepted) {
        await expect(manager.add(rule)).resolves.toBe(901);
        await expect(manager.update(updateRule)).resolves.toBeUndefined();
        expect(repository.insertOnce).toHaveBeenCalledOnce();
        expect(repository.updateOnce).toHaveBeenCalledOnce();
        expect(ledger).toEqual(['repository:insert', 'event:added:901', 'repository:update', 'event:updated:902']);
        return;
    }

    await expect(manager.add(rule)).rejects.toThrow('AddRuleError');
    await expect(manager.update(updateRule)).rejects.toThrow('UpdateRuleError');
    expect(repository.insertOnce).not.toHaveBeenCalled();
    expect(repository.updateOnce).not.toHaveBeenCalled();
    expect(Object.values(event).every(spy => spy.mock.calls.length === 0)).toBe(true);
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('rule option validation characterization', () => {
    it.each([
        ['no keyword and no keyword flags', {}, true],
        ['include keyword with name target', { keyword: 'synthetic', name: true }, true],
        ['include keyword with description target', { keyword: 'synthetic', description: true }, true],
        ['include keyword with extended target', { keyword: 'synthetic', extended: true }, true],
        [
            'include keyword with case and regexp',
            { keyword: 'synthetic', name: true, keyCS: true, keyRegExp: true },
            true,
        ],
        ['include keyword with all targets false', { keyword: 'synthetic' }, false],
        ['include keyword with case flag but no target', { keyword: 'synthetic', keyCS: true }, false],
        ['include flags without keyword', { name: true }, false],
        ['exclude keyword with name target', { ignoreKeyword: 'synthetic', ignoreName: true }, true],
        ['exclude keyword with description target', { ignoreKeyword: 'synthetic', ignoreDescription: true }, true],
        ['exclude keyword with extended target', { ignoreKeyword: 'synthetic', ignoreExtended: true }, true],
        [
            'exclude keyword with case and regexp',
            { ignoreKeyword: 'synthetic', ignoreName: true, ignoreKeyCS: true, ignoreKeyRegExp: true },
            true,
        ],
        ['exclude keyword with regexp but no target', { ignoreKeyword: 'synthetic', ignoreKeyRegExp: true }, false],
        ['exclude flags without keyword', { ignoreExtended: true }, false],
    ])('[IMP-VAL-RULE-BOUNDARIES] captures program keyword fields: %s', async (_name, search, accepted) => {
        await expectValidationThroughAddAndUpdate(withSearch(baseProgramRule(), search), accepted);
    });

    it.each([
        ['explicit channel IDs only', { channelIds: [101] }, true],
        ['empty channel IDs only', { channelIds: [] }, true],
        ['broadcast waves only', { GR: true, BS: true, CS: true, SKY: true }, true],
        ['broadcast waves only including BS4K', { GR: false, BS: false, CS: false, SKY: false, BS4K: true }, true],
        ['channel IDs with GR', { channelIds: [101], GR: true }, false],
        ['empty channel IDs with SKY', { channelIds: [], SKY: true }, false],
        ['channel IDs with BS4K', { channelIds: [101], BS4K: true }, false],
    ])('[IMP-VAL-RULE-BOUNDARIES] captures channel and wave exclusivity: %s', async (_name, search, accepted) => {
        await expectValidationThroughAddAndUpdate(withSearch(baseProgramRule(), search), accepted);
    });

    it.each([
        ['genre minimum', [{ genre: 0, subGenre: 0 }], true],
        ['genre maximum', [{ genre: 15, subGenre: 15 }], true],
        ['optional subgenre', [{ genre: 7 }], true],
        ['genre below minimum', [{ genre: -1 }], false],
        ['genre above maximum', [{ genre: 16 }], false],
        ['subgenre below minimum', [{ genre: 1, subGenre: -1 }], false],
        ['subgenre above maximum', [{ genre: 1, subGenre: 16 }], false],
    ])('[IMP-VAL-RULE-BOUNDARIES] captures genre boundaries: %s', async (_name, genres, accepted) => {
        await expectValidationThroughAddAndUpdate(withSearch(baseProgramRule(), { genres }), accepted);
    });

    it.each([
        ['hour minimum and range minimum', [{ week: 1, start: 0, range: 1 }], true],
        ['hour maximum and range maximum', [{ week: 0x40, start: 23, range: 23 }], true],
        ['weekday zero', [{ week: 0, start: 0, range: 1 }], false],
        ['hour below minimum', [{ week: 1, start: -1, range: 1 }], false],
        ['hour above maximum', [{ week: 1, start: 24, range: 1 }], false],
        ['range below minimum', [{ week: 1, start: 0, range: 0 }], false],
        ['range above maximum', [{ week: 1, start: 0, range: 24 }], false],
        ['start without range is currently accepted', [{ week: 1, start: 24 }], true],
        ['range without start is currently accepted', [{ week: 1, range: 24 }], true],
    ])('[IMP-VAL-RULE-BOUNDARIES] captures program weekday/hour boundaries: %s', async (_name, times, accepted) => {
        await expectValidationThroughAddAndUpdate(withSearch(baseProgramRule(), { times }), accepted);
    });

    it.each([
        ['duration zero', { durationMin: 0, durationMax: 0 }, true],
        ['duration ordered', { durationMin: 1, durationMax: 2 }, true],
        ['negative minimum', { durationMin: -1 }, false],
        ['negative maximum', { durationMax: -1 }, false],
        ['minimum above maximum', { durationMin: 2, durationMax: 1 }, false],
        ['free true is passed through', { isFree: true }, true],
        [
            'free false and search period are passed through',
            { isFree: false, searchPeriods: [{ startAt: 2, endAt: 1 }] },
            true,
        ],
    ])('[IMP-VAL-RULE-BOUNDARIES] captures duration and pass-through filters: %s', async (_name, search, accepted) => {
        await expectValidationThroughAddAndUpdate(withSearch(baseProgramRule(), search), accepted);
    });

    it.each([
        ['empty channel and time arrays', { keyword: '', channelIds: [], times: [] }, true],
        [
            'weekday zero with start zero and positive range',
            { keyword: 'synthetic', channelIds: [], times: [{ week: 0, start: 0, range: 1 }] },
            true,
        ],
        [
            'large start and range',
            { keyword: 'synthetic', channelIds: [101], times: [{ week: 1, start: 172_800, range: 90_000 }] },
            true,
        ],
        ['missing keyword', { channelIds: [], times: [] }, false],
        ['missing channels', { keyword: 'synthetic', times: [] }, false],
        ['missing times', { keyword: 'synthetic', channelIds: [] }, false],
        ['negative start', { keyword: 'synthetic', channelIds: [], times: [{ week: 1, start: -1, range: 1 }] }, false],
        ['zero range', { keyword: 'synthetic', channelIds: [], times: [{ week: 1, start: 0, range: 0 }] }, false],
        ['negative range', { keyword: 'synthetic', channelIds: [], times: [{ week: 1, start: 0, range: -1 }] }, false],
        ['missing start', { keyword: 'synthetic', channelIds: [], times: [{ week: 1, range: 1 }] }, false],
        ['missing range', { keyword: 'synthetic', channelIds: [], times: [{ week: 1, start: 0 }] }, false],
    ])(
        '[IMP-VAL-RULE-BOUNDARIES] captures time-rule required and numeric fields: %s',
        async (_name, search, accepted) => {
            await expectValidationThroughAddAndUpdate(withSearch(baseTimeRule(), search), accepted);
        },
    );

    it.each([
        ['disabled without period', { avoidDuplicate: false }, true],
        ['enabled without period', { avoidDuplicate: true }, true],
        ['enabled with zero period', { avoidDuplicate: true, periodToAvoidDuplicate: 0 }, true],
        ['enabled with positive period', { avoidDuplicate: true, periodToAvoidDuplicate: 1 }, true],
        [
            'enabled with negative period is currently accepted',
            { avoidDuplicate: true, periodToAvoidDuplicate: -1 },
            true,
        ],
        ['disabled with period', { avoidDuplicate: false, periodToAvoidDuplicate: 1 }, false],
    ])('[IMP-VAL-RULE-BOUNDARIES] captures duplicate-avoidance combinations: %s', async (_name, reserve, accepted) => {
        const rule = baseProgramRule();
        rule.reserveOption = { ...rule.reserveOption, ...reserve };
        await expectValidationThroughAddAndUpdate(rule, accepted);
    });

    it.each([
        ['no encode option', undefined, true],
        ['empty encode slots', { isDeleteOriginalAfterEncode: false }, true],
        [
            'one configured mode and directory',
            { mode1: 'archive', directory1: 'synthetic/archive', isDeleteOriginalAfterEncode: false },
            true,
        ],
        [
            'configured mode two and directory',
            { mode2: 'mobile', directory2: 'synthetic/mobile', isDeleteOriginalAfterEncode: false },
            true,
        ],
        [
            'configured mode three and directory',
            { mode3: 'review', directory3: 'synthetic/review', isDeleteOriginalAfterEncode: false },
            true,
        ],
        [
            'all three configured modes',
            { mode1: 'archive', mode2: 'mobile', mode3: 'review', isDeleteOriginalAfterEncode: true },
            true,
        ],
        ['unknown mode', { mode1: 'unknown', isDeleteOriginalAfterEncode: false }, false],
        ['unknown mode two', { mode2: 'unknown', isDeleteOriginalAfterEncode: false }, false],
        ['unknown mode three', { mode3: 'unknown', isDeleteOriginalAfterEncode: false }, false],
        [
            'directory one without mode one',
            { directory1: 'synthetic/archive', isDeleteOriginalAfterEncode: false },
            false,
        ],
        [
            'directory two without mode two',
            { mode1: 'archive', directory2: 'synthetic/mobile', isDeleteOriginalAfterEncode: false },
            false,
        ],
        [
            'directory three without mode three',
            { mode3: undefined, directory3: 'synthetic/review', isDeleteOriginalAfterEncode: false },
            false,
        ],
    ])(
        '[IMP-VAL-RULE-BOUNDARIES] captures encode mode and directory combinations: %s',
        async (_name, encodeOption, accepted) => {
            await expectValidationThroughAddAndUpdate({ ...baseProgramRule(), encodeOption }, accepted);
        },
    );

    it('[IMP-VAL-RULE-BOUNDARIES] rejects an encode request when the configuration has no encode snapshot', async () => {
        const noEncodeChecker = new ReserveOptionChecker({ getConfig: () => ({}) });
        await expectValidationThroughAddAndUpdate(
            {
                ...baseProgramRule(),
                encodeOption: { mode1: 'archive', isDeleteOriginalAfterEncode: false },
            },
            false,
            noEncodeChecker,
        );
    });

    it('[CHAR-ENCODE-PARENT-WITHOUT-MODE] isolates the implementation defect that accepts a parent directory without mode1', async () => {
        // Design requires each encode output to have a configured mode. Production currently checks directory1 but not
        // encodeParentDirectoryName1, so this is characterization evidence for the subsequent production TDD batch.
        await expectValidationThroughAddAndUpdate(
            {
                ...baseProgramRule(),
                encodeOption: {
                    encodeParentDirectoryName1: 'synthetic-parent',
                    isDeleteOriginalAfterEncode: false,
                },
            },
            true,
        );
    });

    it.each([
        ['null rule', null],
        ['null search option', { ...baseProgramRule(), searchOption: null }],
        ['non-array time list', withSearch(baseTimeRule(), { keyword: '', channelIds: [], times: 1 })],
        ['null reserve option', { ...baseProgramRule(), reserveOption: null }],
    ])(
        '[CHAR-VALIDATION-THROW] classifies malformed %s as TypeError with repository and event effects at zero',
        async (_name, malformedRule) => {
            vi.useFakeTimers();
            const { event, manager, repository } = makeManagerHarness();

            await expect(manager.add(malformedRule as unknown as RuleOption)).rejects.toBeInstanceOf(TypeError);
            await expect(
                manager.update({ ...(malformedRule as unknown as RuleOption), id: 903 }),
            ).rejects.toBeInstanceOf(TypeError);

            expect(repository.insertOnce).not.toHaveBeenCalled();
            expect(repository.updateOnce).not.toHaveBeenCalled();
            expect(Object.values(event).every(spy => spy.mock.calls.length === 0)).toBe(true);
            vi.clearAllTimers();
        },
    );

    it.each([
        ['program range outside checker bounds', withSearch(baseProgramRule(), { genres: [{ genre: 16 }] })],
        ['time range outside checker bounds', withSearch(baseTimeRule(), { times: [{ week: 1, start: 0, range: 0 }] })],
    ])(
        'classifies %s as AddRuleError/UpdateRuleError before repository or event effects',
        async (_name, invalidRule) => {
            await expectValidationThroughAddAndUpdate(invalidRule, false);
        },
    );
});
