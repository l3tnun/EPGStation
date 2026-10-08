import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeReservationHarness } from '../fixtures/reservation-rules/runtime';

interface RuleOption {
    id?: number;
    isTimeSpecification: boolean;
    reserveOption: Record<string, unknown>;
    searchOption: Record<string, unknown>;
}

interface RuleManager {
    add(rule: RuleOption): Promise<number>;
    delete(ruleId: number): Promise<void>;
    disable(ruleId: number): Promise<void>;
    enable(ruleId: number): Promise<void>;
    update(rule: RuleOption & { id: number }): Promise<void>;
}

interface RuleManagerConstructor {
    new (logger: unknown, checker: unknown, repository: unknown, event: unknown): RuleManager;
}

interface RuleEvent {
    setAdded(callback: (ruleId: number) => void): void;
    setDeleted(callback: (ruleId: number) => void): void;
    setDisabled(callback: (ruleId: number) => void): void;
    setEnabled(callback: (ruleId: number) => void): void;
    setUpdated(callback: (ruleId: number) => void): void;
}

interface RuleEventConstructor {
    new (logger: unknown): RuleEvent;
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const RuleManageModel = (
    require(join(compiledSnapshot, 'model', 'operator', 'rule', 'RuleManageModel.js')) as {
        default: RuleManagerConstructor;
    }
).default;
const RuleEvent = (
    require(join(compiledSnapshot, 'model', 'event', 'RuleEvent.js')) as { default: RuleEventConstructor }
).default;

const logger = { system: { error: vi.fn(), info: vi.fn() } };
const loggerModel = { getLogger: () => logger };
const validRule = (id?: number): RuleOption => ({
    ...(id === undefined ? {} : { id }),
    isTimeSpecification: false,
    searchOption: {},
    reserveOption: { enable: true, allowEndLack: false, avoidDuplicate: false },
});

const deferred = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const makeRepository = () => ({
    deleteOnce: vi.fn<(ruleId: number) => Promise<void>>().mockResolvedValue(undefined),
    disableOnce: vi.fn<(ruleId: number) => Promise<void>>().mockResolvedValue(undefined),
    enableOnce: vi.fn<(ruleId: number) => Promise<void>>().mockResolvedValue(undefined),
    findId: vi.fn<(ruleId: number) => Promise<RuleOption | null>>().mockResolvedValue(validRule(1)),
    insertOnce: vi.fn<(rule: RuleOption) => Promise<number>>().mockResolvedValue(1),
    updateOnce: vi.fn<(rule: RuleOption) => Promise<void>>().mockResolvedValue(undefined),
});

const makeHarness = (repository = makeRepository()) => {
    const event = new RuleEvent(loggerModel);
    const ledger: string[] = [];
    event.setAdded(ruleId => ledger.push(`added:${ruleId}`));
    event.setUpdated(ruleId => ledger.push(`updated:${ruleId}`));
    event.setEnabled(ruleId => ledger.push(`enabled:${ruleId}`));
    event.setDisabled(ruleId => ledger.push(`disabled:${ruleId}`));
    event.setDeleted(ruleId => ledger.push(`deleted:${ruleId}`));
    const manager = new RuleManageModel(loggerModel, { checkRuleOption: () => true }, repository, event);
    return { ledger, manager, repository };
};

const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('rule change notification specification characterization', () => {
    it.each([
        ['add', 'insertOnce', 'added', 81],
        ['update', 'updateOnce', 'updated', 82],
        ['enable', 'enableOnce', 'enabled', 83],
        ['disable', 'disableOnce', 'disabled', 84],
        ['delete', 'deleteOnce', 'deleted', 85],
    ] as const)(
        'emits %s exactly once only after the corresponding repository settlement',
        async (operation, repositoryMethod, eventName, ruleId) => {
            const repository = makeRepository();
            const pending = deferred<number | void>();
            repository[repositoryMethod].mockReturnValue(pending.promise as Promise<never>);
            repository.findId.mockResolvedValue(validRule(ruleId));
            const { ledger, manager } = makeHarness(repository);

            const result =
                operation === 'add'
                    ? manager.add(validRule())
                    : operation === 'update'
                      ? manager.update(validRule(ruleId) as RuleOption & { id: number })
                      : manager[operation](ruleId);
            await settle();

            expect(repository[repositoryMethod]).toHaveBeenCalledOnce();
            expect(ledger).toEqual([]);

            pending.resolve(operation === 'add' ? ruleId : undefined);
            await expect(result).resolves.toBe(operation === 'add' ? ruleId : undefined);
            expect(ledger).toEqual([`${eventName}:${ruleId}`]);
        },
    );

    it.each([
        ['update', 'updateOnce', 91],
        ['enable', 'enableOnce', 92],
        ['disable', 'disableOnce', 93],
        ['delete', 'deleteOnce', 94],
    ] as const)(
        'does not emit %s when its repository mutation rejects',
        async (operation, repositoryMethod, ruleId) => {
            const repository = makeRepository();
            repository.findId.mockResolvedValue(validRule(ruleId));
            repository[repositoryMethod].mockRejectedValue(new Error(`synthetic-${operation}-failure`));
            const { ledger, manager } = makeHarness(repository);

            const result =
                operation === 'update'
                    ? manager.update(validRule(ruleId) as RuleOption & { id: number })
                    : manager[operation](ruleId);
            await expect(result).rejects.toThrow(`synthetic-${operation}-failure`);

            expect(ledger).toEqual([]);
        },
    );

    it('[RR-1.2][RR-7.1] rejects add with the insert error and records no success, event, or ID when the insert rejects', async () => {
        const repository = makeRepository();
        const insertError = new Error('synthetic-add-failure');
        repository.insertOnce.mockRejectedValueOnce(insertError).mockResolvedValueOnce(96);
        const { ledger, manager } = makeHarness(repository);

        await expect(manager.add(validRule())).rejects.toBe(insertError);

        expect(ledger).toEqual([]);
        expect(logger.system.error).toHaveBeenCalledWith('insert rule error');
        expect(logger.system.error).toHaveBeenCalledWith(insertError);
        expect(logger.system.info).not.toHaveBeenCalledWith(expect.stringContaining('rule added successfully'));

        await expect(manager.add(validRule())).resolves.toBe(96);
        expect(ledger).toEqual(['added:96']);
    });

    it('[RR-7.1] emits operation events even when enable and disable repeat the stored state', async () => {
        const repository = makeRepository();
        const { ledger, manager } = makeHarness(repository);

        await manager.enable(101);
        await manager.enable(101);
        await manager.disable(102);
        await manager.disable(102);

        expect(repository.enableOnce.mock.calls).toEqual([[101], [101]]);
        expect(repository.disableOnce.mock.calls).toEqual([[102], [102]]);
        expect(ledger).toEqual(['enabled:101', 'enabled:101', 'disabled:102', 'disabled:102']);
    });

    it('[RR-7.2] notifies the exact deleted Rule IDs after each successful deletion', async () => {
        const repository = makeRepository();
        const ledger: string[] = [];
        repository.deleteOnce.mockImplementation(async ruleId => {
            ledger.push(`delete:${ruleId}`);
            if (ruleId === 112 || ruleId === 114) throw new Error(`synthetic-delete-${ruleId}`);
        });
        const event = new RuleEvent(loggerModel);
        event.setDeleted(ruleId => ledger.push(`deleted:${ruleId}`));
        const manager = new RuleManageModel(loggerModel, { checkRuleOption: () => true }, repository, event);

        await expect(manager.delete(111)).resolves.toBeUndefined();
        await expect(manager.delete(112)).rejects.toThrow('synthetic-delete-112');
        await expect(manager.delete(113)).resolves.toBeUndefined();
        await expect(manager.delete(114)).rejects.toThrow('synthetic-delete-114');
        await expect(manager.delete(115)).resolves.toBeUndefined();

        expect(repository.deleteOnce).toHaveBeenCalledTimes(5);
        expect(ledger).toEqual([
            'delete:111',
            'deleted:111',
            'delete:112',
            'delete:113',
            'deleted:113',
            'delete:114',
            'delete:115',
            'deleted:115',
        ]);
    });

    it('[RR-7.3] treats a deleted Rule as an empty candidate set on its next recalculation', async () => {
        const harness = makeReservationHarness({
            ruleDB: { findId: vi.fn(async () => null), getIds: vi.fn(async () => []) },
        });

        await harness.model.updateRule(301);

        expect(harness.ruleDB.findId).toHaveBeenCalledWith(301, true);
        expect(harness.reserveDB.updateMany).toHaveBeenCalledOnce();
    });

    it('[RR-7.4] provides a deleted Rule ID to related cleanup listeners exactly once', async () => {
        const repository = makeRepository();
        const { ledger, manager } = makeHarness(repository);

        await manager.delete(401);

        expect(ledger).toEqual(['deleted:401']);
    });

    it('[RR-7.5] reads persisted Rule IDs when the first full recalculation starts', async () => {
        const harness = makeReservationHarness({
            ruleDB: { findId: vi.fn(), getIds: vi.fn(async () => []) },
        });

        await harness.model.updateAll(true);

        expect(harness.ruleDB.getIds).toHaveBeenCalledOnce();
    });
});
