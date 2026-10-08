import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadProduction, loggerModel, makeRule } from '../fixtures/reservation-rules/runtime';

interface RuleManager {
    add(rule: unknown): Promise<number>;
}

interface RuleOptionChecker {
    checkRuleOption(rule: unknown): boolean;
}

const RuleManageModel = loadProduction<new (...args: unknown[]) => RuleManager>(
    'model',
    'operator',
    'rule',
    'RuleManageModel.js',
);

const makeRuleManager = (optionChecker: RuleOptionChecker) => {
    const repository = { insertOnce: vi.fn(async () => 901) };
    const event = { emitAdded: vi.fn() };
    const manager = new RuleManageModel(loggerModel, optionChecker, repository, event);

    return { event, manager, repository };
};

const drainMicrotasks = async (): Promise<void> => {
    for (let index = 0; index < 8; index++) await Promise.resolve();
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('rule mutation queue and timer', () => {
    it('[IMP-MUTATION-TIMER-LIFECYCLE] observes valid, rejected, and expired Rule mutation timer effects', async () => {
        vi.useFakeTimers();
        const accepted = makeRuleManager({ checkRuleOption: () => true });

        await expect(accepted.manager.add(makeRule())).resolves.toBe(901);
        expect(accepted.repository.insertOnce).toHaveBeenCalledOnce();
        expect(accepted.event.emitAdded).toHaveBeenCalledWith(901);
        expect(vi.getTimerCount()).toBe(0);

        const rejected = makeRuleManager({ checkRuleOption: () => false });
        await expect(rejected.manager.add(makeRule())).rejects.toThrow('AddRuleError');
        expect(rejected.repository.insertOnce).not.toHaveBeenCalled();
        expect(rejected.event.emitAdded).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);

        let releaseInsert: ((id: number) => void) | undefined;
        const pendingRepository = {
            insertOnce: vi.fn(
                () =>
                    new Promise<number>(resolve => {
                        releaseInsert = resolve;
                    }),
            ),
        };
        const pendingEvent = { emitAdded: vi.fn() };
        const pendingManager = new RuleManageModel(
            loggerModel,
            { checkRuleOption: () => true },
            pendingRepository,
            pendingEvent,
        );
        const pending = pendingManager.add(makeRule());
        await drainMicrotasks();
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(10_000);
        expect(vi.getTimerCount()).toBe(0);
        expect(pendingEvent.emitAdded).not.toHaveBeenCalled();
        releaseInsert?.(902);
        await expect(pending).resolves.toBe(902);
        expect(pendingEvent.emitAdded).toHaveBeenCalledWith(902);
        expect(vi.getTimerCount()).toBe(0);
    });
});
