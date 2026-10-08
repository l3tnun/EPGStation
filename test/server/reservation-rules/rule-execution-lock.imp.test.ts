import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadProduction, loggerModel, makeRule } from '../fixtures/reservation-rules/runtime';

/**
 * `mutationQueue` は複数の独立した Promise chain 越しに次の mutation を進めるため、1本の
 * `await` では queue の前進が反映しきらないことがある。テストからは Promise resolution の
 * hop 数を数えず、確定するまで microtask を汲み尽くす。
 */
const flushMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
    }
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
});

type RuleManageModelCtor = new (
    ...args: unknown[]
) => {
    add(rule: unknown): Promise<number>;
    update(rule: unknown): Promise<void>;
    enable(ruleId: number): Promise<void>;
    disable(ruleId: number): Promise<void>;
    delete(ruleId: number): Promise<void>;
};

const loadRuleManageModel = () =>
    loadProduction<RuleManageModelCtor>('model', 'operator', 'rule', 'RuleManageModel.js');

describe('rule mutation execution queue', () => {
    it('waits for an overlapping update until add finishes, and both succeed', async () => {
        const RuleManageModel = loadRuleManageModel();
        const releases: Array<(id: number) => void> = [];
        const repository = {
            findId: vi.fn(async () => makeRule()),
            insertOnce: vi.fn(
                () =>
                    new Promise<number>(resolve => {
                        releases.push(resolve);
                    }),
            ),
            updateOnce: vi.fn(async () => undefined),
        };
        const event = { emitAdded: vi.fn(), emitUpdated: vi.fn() };
        const manager = new RuleManageModel(loggerModel, { checkRuleOption: () => true }, repository, event);

        // 1本目の add がまだ insertOnce を await している最中に、2本目の update を呼ぶ。
        const add = manager.add(makeRule());
        await flushMicrotasks();
        expect(repository.insertOnce).toHaveBeenCalledTimes(1);

        const edit = manager.update(makeRule());
        await flushMicrotasks();

        // add が確定するまで update は queue で待ち、findId にすら到達しない。
        expect(repository.findId).not.toHaveBeenCalled();
        expect(repository.updateOnce).not.toHaveBeenCalled();
        expect(event.emitUpdated).not.toHaveBeenCalled();

        releases[0](41);
        await expect(add).resolves.toBe(41);
        expect(event.emitAdded.mock.calls).toEqual([[41]]);

        // add の完了を受けて update が実行され、拒否されずに成功する。
        await expect(edit).resolves.toBeUndefined();
        expect(repository.findId).toHaveBeenCalledTimes(1);
        expect(repository.updateOnce).toHaveBeenCalledTimes(1);
        expect(event.emitUpdated.mock.calls).toEqual([[17]]);
    });

    it('runs the second add after the first rejects, and the second still succeeds', async () => {
        const RuleManageModel = loadRuleManageModel();
        let rejectFindId!: (reason: unknown) => void;
        const repository = {
            findId: vi.fn(
                () =>
                    new Promise((_resolve, reject) => {
                        rejectFindId = reject;
                    }),
            ),
            insertOnce: vi.fn(async () => 99),
            updateOnce: vi.fn(async () => undefined),
        };
        const event = { emitAdded: vi.fn(), emitUpdated: vi.fn() };
        const manager = new RuleManageModel(loggerModel, { checkRuleOption: () => true }, repository, event);

        // 1本目の update は findId の await 中。
        const first = manager.update(makeRule());
        await flushMicrotasks();
        expect(repository.findId).toHaveBeenCalledTimes(1);

        // 2本目の add をその途中で呼ぶ。まだ insertOnce へは進まない。
        const second = manager.add(makeRule());
        await flushMicrotasks();
        expect(repository.insertOnce).not.toHaveBeenCalled();

        rejectFindId(new Error('boom'));
        await expect(first).rejects.toThrow('boom');
        expect(event.emitUpdated).not.toHaveBeenCalled();

        // 1本目の失敗後、2本目は queue に残ったまま実行されて成功する。
        await expect(second).resolves.toBe(99);
        expect(repository.insertOnce).toHaveBeenCalledTimes(1);
        expect(event.emitAdded.mock.calls).toEqual([[99]]);
    });

    it('runs three overlapping adds strictly in call order, one at a time', async () => {
        const RuleManageModel = loadRuleManageModel();
        const releases: Array<(id: number) => void> = [];
        const repository = {
            insertOnce: vi.fn(
                () =>
                    new Promise<number>(resolve => {
                        releases.push(resolve);
                    }),
            ),
        };
        const event = { emitAdded: vi.fn() };
        const manager = new RuleManageModel(loggerModel, { checkRuleOption: () => true }, repository, event);

        const first = manager.add(makeRule({ id: 1 }));
        const second = manager.add(makeRule({ id: 2 }));
        const third = manager.add(makeRule({ id: 3 }));

        await flushMicrotasks();
        expect(repository.insertOnce).toHaveBeenCalledTimes(1);

        releases[0](11);
        await expect(first).resolves.toBe(11);
        await flushMicrotasks();
        expect(repository.insertOnce).toHaveBeenCalledTimes(2);

        releases[1](12);
        await expect(second).resolves.toBe(12);
        await flushMicrotasks();
        expect(repository.insertOnce).toHaveBeenCalledTimes(3);

        releases[2](13);
        await expect(third).resolves.toBe(13);

        expect(event.emitAdded.mock.calls).toEqual([[11], [12], [13]]);
    });

    it('serializes enable, delete, and disable across the shared queue', async () => {
        const RuleManageModel = loadRuleManageModel();
        const order: string[] = [];
        let releaseEnable!: () => void;
        let releaseDelete!: () => void;
        let releaseDisable!: () => void;
        const repository = {
            enableOnce: vi.fn(
                () =>
                    new Promise<void>(resolve => {
                        releaseEnable = () => {
                            order.push('enable');
                            resolve();
                        };
                    }),
            ),
            deleteOnce: vi.fn(
                () =>
                    new Promise<void>(resolve => {
                        releaseDelete = () => {
                            order.push('delete');
                            resolve();
                        };
                    }),
            ),
            disableOnce: vi.fn(
                () =>
                    new Promise<void>(resolve => {
                        releaseDisable = () => {
                            order.push('disable');
                            resolve();
                        };
                    }),
            ),
        };
        const event = { emitEnabled: vi.fn(), emitDeleted: vi.fn(), emitDisabled: vi.fn() };
        const manager = new RuleManageModel(loggerModel, { checkRuleOption: () => true }, repository, event);

        const enable = manager.enable(1);
        const del = manager.delete(2);
        const disable = manager.disable(3);

        await flushMicrotasks();
        expect(repository.enableOnce).toHaveBeenCalledTimes(1);
        expect(repository.deleteOnce).not.toHaveBeenCalled();
        expect(repository.disableOnce).not.toHaveBeenCalled();

        releaseEnable();
        await expect(enable).resolves.toBeUndefined();
        await flushMicrotasks();
        expect(repository.deleteOnce).toHaveBeenCalledTimes(1);
        expect(repository.disableOnce).not.toHaveBeenCalled();

        releaseDelete();
        await expect(del).resolves.toBeUndefined();
        await flushMicrotasks();
        expect(repository.disableOnce).toHaveBeenCalledTimes(1);

        releaseDisable();
        await expect(disable).resolves.toBeUndefined();

        expect(order).toEqual(['enable', 'delete', 'disable']);
    });

    it('lets a queued add start once the safety-valve timeout elapses, without disturbing the stuck add ahead of it', async () => {
        vi.useFakeTimers();
        const RuleManageModel = loadRuleManageModel();
        const releases: Array<(id: number) => void> = [];
        const repository = {
            insertOnce: vi.fn(
                () =>
                    new Promise<number>(resolve => {
                        releases.push(resolve);
                    }),
            ),
        };
        const event = { emitAdded: vi.fn() };
        const manager = new RuleManageModel(loggerModel, { checkRuleOption: () => true }, repository, event);

        const first = manager.add(makeRule({ id: 1 }));
        const second = manager.add(makeRule({ id: 2 }));

        await flushMicrotasks();
        expect(repository.insertOnce).toHaveBeenCalledTimes(1);

        // 1本目が確定しないまま安全弁の時間が経過しても、2本目が実行を開始する。
        await vi.advanceTimersByTimeAsync(10_000);
        await flushMicrotasks();
        expect(repository.insertOnce).toHaveBeenCalledTimes(2);
        expect(event.emitAdded).not.toHaveBeenCalled();

        // 1本目自体は打ち切られておらず、後から確定すればその呼び出し元へ結果が返る。
        releases[0](41);
        await expect(first).resolves.toBe(41);

        releases[1](42);
        await expect(second).resolves.toBe(42);

        expect(event.emitAdded.mock.calls).toEqual([[41], [42]]);
    });
});
