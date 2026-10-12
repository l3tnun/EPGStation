import 'reflect-metadata';

import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DataSource, DataSourceOptions } from 'typeorm';
import { vi } from 'vitest';

import { registerIsolatedRuntimeIdentitiesFromEnv } from '../../../scripts/server-test/compiled-snapshot-coverage.mjs';

export interface TestLogger {
    readonly system: {
        readonly error: (message: string) => void;
        readonly info: (message: string) => void;
    };
}

export interface DBOperatorRuntime {
    checkConnection(): Promise<void>;
    closeConnection(): Promise<void>;
    getConnection(): Promise<DataSource>;
}

interface DBOperatorConstructor {
    new (
        logger: { getLogger(): TestLogger },
        configuration: { getConfig(): Record<string, unknown> },
    ): DBOperatorRuntime;
}

interface IsolatedRuntimeDependencies {
    readonly copy?: (source: string, destination: string, options: { readonly recursive: true }) => Promise<void>;
    readonly loadOperator?: (snapshot: string) => DBOperatorConstructor;
    readonly remove?: typeof rm;
}

interface MutableTypeOrm {
    DataSource: new (options: DataSourceOptions) => DataSource;
}

const require = createRequire(join(process.cwd(), 'package.json'));

export const compiledSnapshot = (() => {
    const value = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
    if (value === undefined) {
        throw new Error('The compiled server snapshot is required');
    }
    return value;
})();

export const compiledRoot = dirname(compiledSnapshot);
export const sqliteDatabasePath = join(compiledRoot, 'data', 'database.db');

const DBOperator = (
    require(join(compiledSnapshot, 'model', 'db', 'DBOperator.js')) as { default: DBOperatorConstructor }
).default;

/**
 * `installDataSourceFactory` が置いた差し替え。
 *
 * compile 済みの実装は `import { DataSource } from 'typeorm'` で束縛を固定するため、名前空間へ
 * 後から手を入れても届かない。実装が読み込む typeorm の解決ごと差し替え、その状態で `DBOperator`
 * を読み直したものをここに置く。置かれていなければ本物が使われる。
 */
let installedOperator: DBOperatorConstructor | undefined;

export function createOperator(
    config: Record<string, unknown>,
    logger: TestLogger,
    Operator: DBOperatorConstructor = installedOperator ?? DBOperator,
): DBOperatorRuntime {
    return new Operator({ getLogger: () => logger }, { getConfig: () => config });
}

export async function cleanupInOrder(actions: ReadonlyArray<() => Promise<void>>): Promise<void> {
    const failures: unknown[] = [];
    for (const action of actions) {
        try {
            await action();
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length > 0) {
        throw new AggregateError(failures, 'Persistence test cleanup failed');
    }
}

export interface StartWatchdog<Value> {
    readonly wait: Promise<Value>;
    cancel(): void;
}

/**
 * Bounds only test setup. Call this before enabling a fake clock so a missing
 * product callback fails the test and its finally block can restore patches.
 */
export function createStartWatchdog<Value>(
    started: Promise<Value>,
    label: string,
    timeoutMilliseconds: number = 1_000,
): StartWatchdog<Value> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
            () => reject(new Error(`${label} did not start within ${timeoutMilliseconds}ms`)),
            timeoutMilliseconds,
        );
    });
    const wait = Promise.race([started, timedOut]);

    // The caller owns cancellation in finally; this suppresses an unobserved
    // timeout if setup itself fails before awaiting the watchdog.
    void wait.catch(() => undefined);

    return {
        wait,
        cancel: () => {
            if (timeout !== undefined) {
                clearTimeout(timeout);
                timeout = undefined;
            }
        },
    };
}

/**
 * Releases the test double that signals setup progress. If its start watchdog
 * failed first, product work is intentionally allowed to remain pending, so
 * only observe its eventual rejection instead of making test teardown wait.
 */
export async function cleanupTestOperationsAfterStartWatchdog<Value>(
    startObserved: boolean,
    release: () => void,
    operations: ReadonlyArray<Promise<Value> | undefined>,
): Promise<void> {
    release();
    const startedOperations = operations.filter((operation): operation is Promise<Value> => operation !== undefined);
    if (!startObserved) {
        for (const operation of startedOperations) {
            void operation.catch(() => undefined);
        }
        return;
    }
    await Promise.allSettled(startedOperations);
}

export interface IsolatedCompiledRuntime {
    readonly compiledSnapshot: string;
    readonly root: string;
    readonly sqliteDatabasePath: string;
    cleanup(): Promise<void>;
    createOperator(config: Record<string, unknown>, logger: TestLogger): DBOperatorRuntime;
}

export async function createIsolatedCompiledRuntime(
    dependencies: IsolatedRuntimeDependencies = {},
): Promise<IsolatedCompiledRuntime> {
    const artifactRoot = join(process.cwd(), 'test', 'server', '.artifacts', 'persistence');
    await mkdir(artifactRoot, { recursive: true });
    const root = await mkdtemp(join(artifactRoot, 'compiled-runtime-'));
    const isolatedSnapshot = join(root, 'dist');
    const copy = dependencies.copy ?? cp;
    const remove = dependencies.remove ?? rm;
    const loadOperator =
        dependencies.loadOperator ??
        ((snapshot: string) =>
            (require(join(snapshot, 'model', 'db', 'DBOperator.js')) as { default: DBOperatorConstructor }).default);
    try {
        await copy(compiledSnapshot, isolatedSnapshot, { recursive: true });
        // Lifecycle-safe coverage association: while both official and isolated JS/map bytes are
        // still readable, record authenticated identities. Converter later associates raw V8 URLs
        // after cleanup deletes this tree. No-ops outside coverage runs (registry env unset).
        registerIsolatedRuntimeIdentitiesFromEnv({
            isolatedSnapshotRoot: isolatedSnapshot,
            officialSnapshotRoot: compiledSnapshot,
        });
        const Operator = loadOperator(isolatedSnapshot);

        return {
            compiledSnapshot: isolatedSnapshot,
            root,
            sqliteDatabasePath: join(root, 'data', 'database.db'),
            cleanup: () => remove(root, { force: true, recursive: true }),
            createOperator: (config, logger) => createOperator(config, logger, Operator),
        };
    } catch (primaryError) {
        try {
            await remove(root, { force: true, recursive: true });
        } catch (cleanupError) {
            throw new AggregateError(
                [primaryError, cleanupError],
                'Failed to prepare and clean an isolated compiled runtime',
            );
        }
        throw primaryError;
    }
}

/**
 * `DBOperator` が作る DataSource を差し替える。
 *
 * compile 済みの実装は `import { DataSource } from 'typeorm'` で束縛を固定するため、名前空間へ
 * 後から手を入れても届かない。実装そのものを読み直す代わりに、`createOperator` が読み込み側の
 * 解決ごと差し替えた `DBOperator` を使う。戻り値を呼ぶと差し替えを解く。
 */
export async function installDataSourceFactory(
    factory: (options: DataSourceOptions) => DataSource,
): Promise<() => void> {
    class InterceptedDataSource {
        public constructor(options: DataSourceOptions) {
            return factory(options);
        }
    }

    const typeorm = (await import('typeorm')) as unknown as MutableTypeOrm;
    vi.doMock('typeorm', () => ({ ...typeorm, DataSource: InterceptedDataSource }));
    vi.resetModules();
    installedOperator = (
        (await import(pathToFileURL(join(compiledSnapshot, 'model', 'db', 'DBOperator.js')).href)) as {
            default: DBOperatorConstructor;
        }
    ).default;

    return () => {
        installedOperator = undefined;
        vi.doUnmock('typeorm');
        vi.resetModules();
    };
}
