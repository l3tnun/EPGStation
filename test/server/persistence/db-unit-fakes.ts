import { vi } from 'vitest';

import { loadCompiled } from './repository-harness';

export interface BuilderCall {
    readonly method: string;
    readonly args: unknown[];
}

type Terminal = (...args: unknown[]) => unknown;

/**
 * A fluent query-builder double. Every method records its call and returns the builder itself,
 * except the named terminals, which return the supplied value. `then` is hidden so that an
 * `await builder` (which the production code does in a few places) resolves to the builder.
 */
export const createFluentBuilder = (terminals: Record<string, Terminal> = {}) => {
    const calls: BuilderCall[] = [];
    const builder: any = new Proxy(
        {},
        {
            get: (_target, property) => {
                if (property === 'then') {
                    return undefined;
                }
                const method = String(property);
                return (...args: unknown[]) => {
                    calls.push({ method, args });
                    return method in terminals ? terminals[method](...args) : builder;
                };
            },
        },
    );
    return {
        builder,
        calls,
        argsOf: (method: string): unknown[][] => calls.filter(call => call.method === method).map(call => call.args),
        methods: (): string[] => calls.map(call => call.method),
    };
};

export const immediateRun = vi.fn(async <T>(job: () => Promise<T>): Promise<T> => job());

export const loadEntity = (name: string): new () => Record<string, unknown> =>
    loadCompiled<new () => Record<string, unknown>>(`db/entities/${name}.js`);

export interface RunnerFaults {
    readonly commit?: boolean;
    readonly insert?: boolean;
    readonly release?: boolean;
    readonly rollback?: boolean;
    readonly start?: boolean;
}

/**
 * A QueryRunner double with the real `isTransactionActive` semantics: true only between a
 * successful startTransaction() and the next commit or rollback. `events` records the order of
 * lifecycle calls and `deletedEntities` the entity of every `delete().from(entity).execute()`.
 */
export const createRunnerDouble = (faults: RunnerFaults = {}) => {
    const primary = new Error('synthetic-primary-failure');
    const rollbackFailure = new Error('synthetic-rollback-cleanup-failure');
    const releaseFailure = new Error('synthetic-release-cleanup-failure');
    let active = false;
    const deletedEntities: unknown[] = [];
    const events: string[] = [];
    const managerBuilder = () => {
        let entity: unknown;
        const fluent = createFluentBuilder({
            from: target => {
                entity = target;
                return fluent.builder;
            },
            execute: async () => {
                events.push('delete-all');
                deletedEntities.push(entity);
                return { affected: 0 };
            },
        });
        return fluent.builder;
    };
    const runner = {
        startTransaction: vi.fn(async () => {
            events.push('start');
            if (faults.start === true) throw primary;
            active = true;
        }),
        get isTransactionActive() {
            return active;
        },
        manager: {
            createQueryBuilder: vi.fn(managerBuilder),
            delete: vi.fn(async () => {
                events.push('delete');
            }),
            insert: vi.fn(async () => {
                events.push('insert');
                if (faults.insert === true) throw primary;
                return { identifiers: [{ id: 1 }] };
            }),
            update: vi.fn(async () => {
                events.push('update');
            }),
        },
        commitTransaction: vi.fn(async () => {
            events.push('commit');
            if (faults.commit === true) throw primary;
            active = false;
        }),
        rollbackTransaction: vi.fn(async () => {
            events.push('rollback');
            if (faults.rollback === true) throw rollbackFailure;
            active = false;
        }),
        release: vi.fn(async () => {
            events.push('release');
            if (faults.release === true) throw releaseFailure;
        }),
    };
    return { deletedEntities, events, primary, releaseFailure, rollbackFailure, runner };
};
