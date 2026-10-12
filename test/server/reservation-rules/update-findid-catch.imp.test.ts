import 'reflect-metadata';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadProduction, makeRule } from '../fixtures/reservation-rules/runtime';

const RuleManageModel = loadProduction<
    new (...args: unknown[]) => {
        update(rule: { id: number } & Record<string, unknown>): Promise<void>;
    }
>('model', 'operator', 'rule', 'RuleManageModel.js');

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/**
 * Real RuleManageModel.update ruleDB.findId rejection catch (L98–101).
 * findId rejects → system.error(err) once + rethrow. The rejection settles the task
 * promise that `enqueue`/`waitForAdvance` is watching, which clears the queue's
 * QUEUE_ADVANCE_TIMEOUT_MS (10s) safety-valve timer via `advance()` (mutationQueue
 * serialization, not the removed lockExecution).
 * RuleIsNotFound (null) and updateOnce catch are out of scope.
 */
const makeSubject = (findId: () => Promise<unknown>) => {
    const systemError = vi.fn();
    const systemInfo = vi.fn();
    const repository = {
        findId: vi.fn(findId),
        updateOnce: vi.fn(async () => undefined),
    };
    const event = {
        emitUpdated: vi.fn(),
    };
    const manager = new RuleManageModel(
        { getLogger: () => ({ system: { error: systemError, info: systemInfo } }) },
        { checkRuleOption: () => true },
        repository,
        event,
    );
    return { event, manager, repository, systemError, systemInfo };
};

describe('RuleManageModel.update findId catch (unittest/imp)', () => {
    it('[R2-RULEMANAGE-UPDATE-FINDID-CATCH] findId rejection unlocks timer, logs once, rethrows without updateOnce', async () => {
        vi.useFakeTimers();
        const boom = new Error('SyntheticFindIdFailure');
        const { event, manager, repository, systemError } = makeSubject(async () => {
            throw boom;
        });

        await expect(manager.update(makeRule({ id: 7101 }))).rejects.toBe(boom);

        // I1: enqueue's waitForAdvance arms a 10s QUEUE_ADVANCE_TIMEOUT_MS safety-valve
        // timer while the task runs; the task settling (here, rejecting) must clear it.
        expect(vi.getTimerCount()).toBe(0);

        expect(repository.findId).toHaveBeenCalledExactlyOnceWith(7101);
        expect(systemError).toHaveBeenCalledExactlyOnceWith(boom);
        expect(repository.updateOnce).not.toHaveBeenCalled();
        expect(event.emitUpdated).not.toHaveBeenCalled();
    });
});
