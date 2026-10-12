import 'reflect-metadata';

import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { vi, type Mock } from 'vitest';

import type * as apid from '../../../api';
import type IRecordedStorageDeletionPort from '../../../src/model/operator/storage/IRecordedStorageDeletionPort';
import type { RecordedStorageDeletionOutcome } from '../../../src/model/operator/storage/IRecordedStorageDeletionPort';
import type IStorageDeletionCandidatePort from '../../../src/model/operator/storage/IStorageDeletionCandidatePort';
import type { StorageRecordedUseSnapshot } from '../../../src/model/operator/storage/IStorageRecordedUseSnapshotPort';

export interface StorageEntry {
    readonly action?: 'remove' | 'none';
    readonly limitCmd?: string;
    readonly limitThreshold?: number;
    readonly name: string;
    readonly path: string;
}

export interface StorageLogger {
    readonly system: {
        readonly error: Mock;
        readonly info: Mock;
    };
}

export interface RecordedCandidate {
    readonly id: number;
}

export type SpawnFunction = (bin: string, args: readonly string[], options: unknown) => ChildProcess;

export interface StorageManagerRuntime {
    activeCommands: Map<
        symbol,
        { deadline: NodeJS.Timeout | undefined; spawned: boolean; stopGrace: NodeJS.Timeout | undefined }
    >;
    check(list: StorageEntry[]): Promise<void>;
    getFreeSize(path: string): Promise<number>;
    isRunning: boolean;
    launchCommand(bin: string, args: string[], command: string): { observationDone: Promise<string> };
    start(): void;
    stop(): void;
    timerId: NodeJS.Timeout | null;
}

interface StorageManagerConstructor {
    new (
        loggerModel: { getLogger(): StorageLogger },
        configuration: { getConfig(): Record<string, unknown> },
        candidatePort: IStorageDeletionCandidatePort,
        deletionPort: IRecordedStorageDeletionPort,
        recordedUseSnapshotPort: { getSnapshot(): Promise<StorageRecordedUseSnapshot> },
    ): StorageManagerRuntime;
}

export interface StorageManagerHarness {
    readonly candidateRequests: Mock;
    readonly deleteRecorded: Mock<(recordedId: number) => Promise<void>>;
    readonly deletionPort: RecordedStorageDeletionPortDouble;
    readonly findOld: Mock<() => Promise<RecordedCandidate | null>>;
    readonly getSnapshot: Mock<() => Promise<StorageRecordedUseSnapshot>>;
    readonly logger: StorageLogger;
    readonly manager: StorageManagerRuntime;
}

export interface RecordedStorageDeletionRequest {
    readonly recordedId: apid.RecordedId;
    readonly storageName: string;
}

export type RecordedStorageDeletionSettlement =
    | (RecordedStorageDeletionRequest & { readonly outcome: RecordedStorageDeletionOutcome })
    | (RecordedStorageDeletionRequest & { readonly error: unknown });

/** Runtime 4.2 binding preparation only; this double is not a consumer implementation. */
export class RecordedStorageDeletionPortDouble implements IRecordedStorageDeletionPort {
    public readonly requests: RecordedStorageDeletionRequest[] = [];
    public readonly settlements: RecordedStorageDeletionSettlement[] = [];

    constructor(private readonly handler: IRecordedStorageDeletionPort['deleteForStoragePressure']) {}

    public async deleteForStoragePressure(
        recordedId: apid.RecordedId,
        storageName: string,
    ): Promise<RecordedStorageDeletionOutcome> {
        this.requests.push({ recordedId, storageName });
        try {
            const outcome = await this.handler(recordedId, storageName);
            this.settlements.push({ recordedId, storageName, outcome });
            return outcome;
        } catch (error) {
            this.settlements.push({ recordedId, storageName, error });
            throw error;
        }
    }
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}

const storageManagerPath = join(compiledSnapshot, 'model', 'operator', 'storage', 'StorageManageModel.js');

/**
 * The compiled `StorageManageModel.js` is ES modules (`import { spawn } from 'child_process'`), a static
 * binding that patching `Module._load` (a CommonJS-loader hook) never reaches -- this suite's ESM import
 * resolves through the test runner's own module graph, not the CommonJS loader `Module._load` patches.
 *
 * `vi.doMock` + `vi.resetModules` + a dynamic `import()` is the mechanism that actually lands a
 * replacement `spawn` in the model's binding (mirrors
 * `event-and-hook-delivery/external-command-test-harness.ts#installSpawnStub`). Done once, at module
 * load (top-level `await`, which blocks every importing test file's own top-level code until this
 * resolves), so `createStorageManager` keeps its synchronous signature for its many callers across this
 * directory -- each call just points `spawnDispatch` at that call's `spawn` (or the real
 * `child_process.spawn` by default) before constructing the manager.
 */
const realSpawn = (require('node:child_process') as typeof import('node:child_process')).spawn;
export const spawnDispatch = vi.fn((...args: Parameters<SpawnFunction>) => realSpawn(...(args as any)));

/**
 * `diskusage-ng` is CJS-only, but the same static-binding hazard applies: the compiled model's
 * `import diskusage from 'diskusage-ng'` resolves through this suite's own module graph once
 * `StorageManageModel.js` is reloaded via dynamic `import()` below, so mutating `require.cache` for
 * `diskusage-ng` (a plain-`require` trick) would land on a copy the reloaded model never sees.
 */
export type DiskusageFunction = (
    dirPath: string,
    callback: (error: Error | null, usage?: { available: number }) => void,
) => void;
const realDiskusage = require('diskusage-ng') as DiskusageFunction;
export const diskusageDispatch = vi.fn<DiskusageFunction>((...args) => realDiskusage(...args));

const StorageManager: StorageManagerConstructor = await (async () => {
    const childProcessMock = { spawn: (...args: Parameters<SpawnFunction>) => spawnDispatch(...args) };
    const diskusageMock = { default: (...args: Parameters<DiskusageFunction>) => diskusageDispatch(...args) };
    vi.doMock('child_process', () => childProcessMock);
    vi.doMock('node:child_process', () => childProcessMock);
    vi.doMock('diskusage-ng', () => diskusageMock);
    try {
        vi.resetModules();
        const imported = (await import(storageManagerPath)) as { default: StorageManagerConstructor };
        return imported.default;
    } finally {
        vi.doUnmock('child_process');
        vi.doUnmock('node:child_process');
        vi.doUnmock('diskusage-ng');
    }
})();

const loadStorageManager = (spawn?: SpawnFunction): StorageManagerConstructor => {
    spawnDispatch.mockImplementation(
        spawn !== undefined ? spawn : (...args: Parameters<SpawnFunction>) => realSpawn(...(args as any)),
    );
    return StorageManager;
};

export const createStorageLogger = (): StorageLogger => ({
    system: {
        error: vi.fn(),
        info: vi.fn(),
    },
});

export const createStorageManager = (options?: {
    readonly candidatePort?: IStorageDeletionCandidatePort;
    readonly deleteRecorded?: (recordedId: number) => Promise<void>;
    readonly deleteForStoragePressure?: IRecordedStorageDeletionPort['deleteForStoragePressure'];
    readonly entries?: StorageEntry[];
    readonly findOld?: () => Promise<RecordedCandidate | null>;
    readonly getSnapshot?: () => Promise<StorageRecordedUseSnapshot>;
    readonly intervalSeconds?: number;
    readonly spawn?: SpawnFunction;
    readonly storageLimitCommandTimeoutMs?: unknown;
}): StorageManagerHarness => {
    const logger = createStorageLogger();
    const deleteRecorded = vi.fn(options?.deleteRecorded ?? (async () => undefined));
    const findOld = vi.fn(options?.findOld ?? (async () => null));
    const candidateRequests = vi.fn();
    const candidatePort = options?.candidatePort ?? {
        findOldestUnused: async (request: Parameters<IStorageDeletionCandidatePort['findOldestUnused']>[0]) => {
            candidateRequests(request);
            return (await findOld())?.id ?? null;
        },
    };
    const deleteForStoragePressure = vi.fn(
        options?.deleteForStoragePressure ??
            (async recordedId => {
                await deleteRecorded(recordedId);
                return 'deleted' as const;
            }),
    );
    const deletionPort = new RecordedStorageDeletionPortDouble(deleteForStoragePressure);
    Object.assign(deletionPort, { findOld });
    const getSnapshot = vi.fn(
        options?.getSnapshot ?? (async () => ({ recordedIds: new Set(), status: 'known' as const })),
    );
    const StorageManager = loadStorageManager(options?.spawn);
    const manager = new StorageManager(
        { getLogger: () => logger },
        {
            getConfig: () => ({
                recorded: options?.entries ?? [],
                storageLimitCheckIntervalTime: options?.intervalSeconds ?? 1,
                storageLimitCommandTimeoutMs: options?.storageLimitCommandTimeoutMs,
            }),
        },
        candidatePort,
        deletionPort,
        { getSnapshot },
    );
    return {
        candidateRequests,
        deleteRecorded,
        deletionPort,
        findOld,
        getSnapshot,
        logger,
        manager,
    };
};

export const syntheticSpawnResult = (autoTerminal: boolean = true): ChildProcess => {
    const child = Object.assign(new EventEmitter(), {
        connected: false,
        exitCode: null,
        kill: vi.fn(() => true),
        killed: false,
        pid: 4242,
        signalCode: null,
        spawnargs: [],
        spawnfile: 'synthetic-child',
        stderr: null,
        stdin: null,
        stdio: [null, null, null, null, null],
        stdout: null,
    }) as unknown as ChildProcess;
    if (autoTerminal) {
        queueMicrotask(() => {
            child.emit('spawn');
            child.emit('close', 0, null);
        });
    }
    return child;
};

export interface Deferred<T> {
    readonly promise: Promise<T>;
    reject(reason?: unknown): void;
    resolve(value: T | PromiseLike<T>): void;
}

export const deferred = <T>(): Deferred<T> => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
};

export const settleMicrotasks = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};
