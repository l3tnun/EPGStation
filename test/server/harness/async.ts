import { vi } from 'vitest';

function unsupportedData(path: string, value: unknown): never {
    const kind = value === null ? 'null' : typeof value;
    throw new TypeError(`Synthetic test data contains unsupported ${kind} at ${path}`);
}

function snapshotData<T>(value: T, path = '$', ancestors = new Set<object>()): T {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value !== 'object') {
        return unsupportedData(path, value);
    }

    if (ancestors.has(value)) {
        throw new TypeError(`Synthetic test data contains a cycle at ${path}`);
    }

    const prototype = Object.getPrototypeOf(value) as unknown;
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        return unsupportedData(path, value);
    }

    ancestors.add(value);
    const snapshot: unknown = Array.isArray(value) ? [] : Object.create(prototype as object | null);

    for (const key of Reflect.ownKeys(value)) {
        if (Array.isArray(value) && key === 'length') {
            continue;
        }

        const childPath = typeof key === 'string' ? `${path}.${key}` : path;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (
            typeof key !== 'string' ||
            descriptor === undefined ||
            !descriptor.enumerable ||
            !Object.hasOwn(descriptor, 'value')
        ) {
            return unsupportedData(childPath, value);
        }

        Object.defineProperty(snapshot, key, {
            configurable: false,
            enumerable: true,
            value: snapshotData(descriptor.value as unknown, childPath, ancestors),
            writable: false,
        });
    }

    ancestors.delete(value);
    return Object.freeze(snapshot) as T;
}

export function createSyntheticEntity<T extends object>(defaults: T, overrides: Partial<T> = {}): Readonly<T> {
    const safeDefaults = snapshotData(defaults);
    const safeOverrides = snapshotData(overrides);
    return snapshotData({ ...safeDefaults, ...safeOverrides });
}

export interface FakeClock {
    now(): number;
    advanceBy(milliseconds: number): Promise<void>;
    restore(): void;
}

export function useFakeClock(initialTime: number): FakeClock {
    vi.useFakeTimers();
    vi.setSystemTime(initialTime);

    return {
        now: () => Date.now(),
        advanceBy: async milliseconds => {
            await vi.advanceTimersByTimeAsync(milliseconds);
        },
        restore: () => vi.useRealTimers(),
    };
}

export type DeferredState<T> =
    | { readonly status: 'pending' }
    | { readonly status: 'resolved'; readonly value: T }
    | { readonly status: 'rejected'; readonly reason: unknown };

export interface Deferred<T> {
    readonly promise: Promise<T>;
    state(): DeferredState<T>;
    resolve(value: T): boolean;
    reject(reason: unknown): boolean;
}

export function createDeferred<T>(): Deferred<T> {
    let state: DeferredState<T> = Object.freeze({ status: 'pending' });
    let resolvePromise!: (value: T) => void;
    let rejectPromise!: (reason: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });

    const settle = (nextState: DeferredState<T>, commit: () => void) => {
        if (state.status !== 'pending') {
            return false;
        }

        state = Object.freeze(nextState);
        commit();
        return true;
    };

    return {
        promise,
        state: () => state,
        resolve: value => settle({ status: 'resolved', value }, () => resolvePromise(value)),
        reject: reason => settle({ status: 'rejected', reason }, () => rejectPromise(reason)),
    };
}

export interface CallLedgerEntry<T> {
    readonly sequence: number;
    readonly time: number;
    readonly value: T;
}

export interface CallLedger<T> {
    record(value: T): CallLedgerEntry<T>;
    entries(): readonly CallLedgerEntry<T>[];
}

export function createCallLedger<T>(now: () => number = Date.now): CallLedger<T> {
    const entries: CallLedgerEntry<T>[] = [];

    return {
        record: value => {
            const snapshot = snapshotData(value);
            const entry = Object.freeze({
                sequence: entries.length,
                time: now(),
                value: snapshot,
            });
            entries.push(entry);
            return entry;
        },
        entries: () => Object.freeze([...entries]),
    };
}
