import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { loadProduction } from '../../fixtures/reservation-rules/runtime';

interface RuleQueryApi {
    add(rule: Record<string, unknown>): Promise<number>;
    delete(ruleId: number): Promise<void>;
    disable(ruleId: number): Promise<void>;
    enable(ruleId: number): Promise<void>;
    gets(option: Record<string, unknown>): Promise<{ rules: Array<{ id: number; reservesCnt?: number }>; total: number }>;
    update(rule: Record<string, unknown>): Promise<void>;
}

interface RuleQueryApiConstructor {
    new (ipc: unknown, ruleDB: unknown, reserveDBOrCountPort: unknown, reservationCountPort?: unknown): RuleQueryApi;
}

const RuleApiModel = loadProduction<RuleQueryApiConstructor>('model', 'api', 'rule', 'RuleApiModel.js');

describe('RuleApiModel IPC delegation', () => {
    it('[RR-IMP-API-IPC-DELEGATION] add, update, enable, disable, and delete each delegate to the injected IPC client exactly once with the given arguments and propagate the result', async () => {
        const rejection = new Error('synthetic-disable-rejection');
        const ipc = {
            rule: {
                add: vi.fn().mockResolvedValue(9),
                delete: vi.fn().mockResolvedValue(undefined),
                disable: vi.fn().mockRejectedValue(rejection),
                enable: vi.fn().mockResolvedValue(undefined),
                update: vi.fn().mockResolvedValue(undefined),
            },
        };
        const api = new RuleApiModel(ipc, { findAll: vi.fn() }, { countByRuleIds: vi.fn() });
        const addRule = { keyword: 'synthetic-add-rule' };
        const updateRule = { id: 5, keyword: 'synthetic-update-rule' };

        await expect(api.add(addRule)).resolves.toBe(9);
        await expect(api.update(updateRule)).resolves.toBeUndefined();
        await expect(api.enable(5)).resolves.toBeUndefined();
        await expect(api.disable(5)).rejects.toBe(rejection);
        await expect(api.delete(5)).resolves.toBeUndefined();

        expect(ipc.rule.add).toHaveBeenCalledExactlyOnceWith(addRule);
        expect(ipc.rule.update).toHaveBeenCalledExactlyOnceWith(updateRule);
        expect(ipc.rule.enable).toHaveBeenCalledExactlyOnceWith(5);
        expect(ipc.rule.disable).toHaveBeenCalledExactlyOnceWith(5);
        expect(ipc.rule.delete).toHaveBeenCalledExactlyOnceWith(5);
    });

    it('[RR-1.2][RR-IMP-API-IPC-DELEGATION] add propagates the IPC rejection unchanged so a failed insert reaches the caller', async () => {
        const rejection = new Error('synthetic-add-rejection');
        const ipc = { rule: { add: vi.fn().mockRejectedValue(rejection) } };
        const api = new RuleApiModel(ipc, { findAll: vi.fn() }, { countByRuleIds: vi.fn() });

        await expect(api.add({ keyword: 'synthetic-add-rule' })).rejects.toBe(rejection);
    });

    it('[RR-IMP-CTOR-UNMANAGED-PORT] uses the explicit unmanaged reservation count port over the injected IReserveDB adapter candidate', async () => {
        const findAll = vi.fn(async () => [[{ id: 3 }], 1] as const);
        const adapterCandidate = { countRuleIds: vi.fn() };
        const explicitPort = { countByRuleIds: vi.fn(async () => [{ ruleId: 3, count: 7 }]) };
        const api = new RuleApiModel({}, { findAll }, adapterCandidate, explicitPort);

        await expect(api.gets({ type: 'normal' })).resolves.toEqual({
            rules: [{ id: 3, reservesCnt: 7 }],
            total: 1,
        });

        expect(explicitPort.countByRuleIds).toHaveBeenCalledExactlyOnceWith([3], 'normal');
        expect(adapterCandidate.countRuleIds).not.toHaveBeenCalled();
    });
});
