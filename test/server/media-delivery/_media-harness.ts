import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { vi, type Mock } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
export const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

export const compiled = <T>(...segments: string[]): T => require(join(compiledSnapshot, ...segments)) as T;

/**
 * The compiled dist is ES modules, so `vi.spyOn(require('node:child_process'), 'spawn')` (or the same for
 * `axios`) never reaches the compiled model's own binding:
 *
 * - `child_process` is a builtin whose ESM import for this suite resolves through the test runner's own
 *   module graph, not the CommonJS loader a `require(...)` mutation goes through.
 * - `axios` ships separate `require` (`dist/node/axios.cjs`) and `import` (`index.js`) entry points (a
 *   dual-package hazard), so `require('axios')` and the compiled model's `import axios from 'axios'` are
 *   two different module instances with independent state; mutating one's `.request` never reaches the
 *   other.
 *
 * `vi.doMock` + `vi.resetModules` + a dynamic `import()` of the compiled model is the mechanism that
 * actually lands a replacement in the model's binding (mirrors
 * `application-runtime/_runtime-harness.ts#evaluateCompiledRuntime` and
 * `event-and-hook-delivery/external-command-test-harness.ts#installSpawnStub`). Call the `prepare*`
 * functions once per test file (e.g. in `beforeAll`) and drive behavior afterwards through the returned
 * stub's `mockImplementation`/`mockReturnValue`/etc. -- no need to repeat the dynamic import per test.
 *
 * Defaults to the real `child_process.spawn` (`mockReset()` -- and `vi.resetAllMocks()`, which restores
 * a plain `vi.fn()`'s creation-time implementation, unlike `vi.restoreAllMocks()` -- brings this back)
 * so a test that wants an actual OS child needs no special-casing.
 */
const realChildProcessSpawn = (require('node:child_process') as typeof import('node:child_process')).spawn;
export const spawnStub = vi.fn((...args: unknown[]) => (realChildProcessSpawn as (...a: unknown[]) => unknown)(...args));

let encodeProcessManageModelCtor: (new (...args: any[]) => any) | undefined;

/** Reloads the compiled `EncodeProcessManageModel` so its internal `spawn(...)` calls resolve to `spawnStub`. */
export const prepareEncodeProcessManageModel = async (): Promise<new (...args: any[]) => any> => {
    if (encodeProcessManageModelCtor !== undefined) return encodeProcessManageModelCtor;
    const childProcessMock = { spawn: spawnStub };
    vi.doMock('child_process', () => childProcessMock);
    vi.doMock('node:child_process', () => childProcessMock);
    try {
        vi.resetModules();
        const imported = (await import(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeProcessManageModel.js'))) as {
            default: new (...args: any[]) => any;
        };
        encodeProcessManageModelCtor = imported.default;
        return encodeProcessManageModelCtor;
    } finally {
        vi.doUnmock('child_process');
        vi.doUnmock('node:child_process');
    }
};

const realFs = require('node:fs') as typeof import('node:fs');

/**
 * `TailStream.js` and `RecordedStreamModel.js` (via its base class) read/probe files through
 * `import * as fs from 'fs'`, the same static-binding hazard as `child_process`/`axios` above. Each stub
 * here defaults to the real implementation (so untouched fs calls keep working against the real
 * filesystem) and tests override the one(s) they need with `mockImplementation`/`mockImplementationOnce`.
 */
export const fsStubs = {
    close: vi.fn((...args: unknown[]) => (realFs.close as (...a: unknown[]) => unknown)(...args)),
    createReadStream: vi.fn((...args: unknown[]) =>
        (realFs.createReadStream as (...a: unknown[]) => unknown)(...args),
    ),
    fstat: vi.fn((...args: unknown[]) => (realFs.fstat as (...a: unknown[]) => unknown)(...args)),
    open: vi.fn((...args: unknown[]) => (realFs.open as (...a: unknown[]) => unknown)(...args)),
    read: vi.fn((...args: unknown[]) => (realFs.read as (...a: unknown[]) => unknown)(...args)),
    stat: vi.fn((...args: unknown[]) => (realFs.stat as (...a: unknown[]) => unknown)(...args)),
};

interface RecordedDeliveryFsModules {
    readonly container: any;
    readonly RecordedStreamModel: new (...args: any[]) => any;
    readonly TailStream: any;
}

let recordedDeliveryFsModules: RecordedDeliveryFsModules | undefined;

/**
 * Reloads `TailStream.js` and `RecordedStreamModel.js` so their internal `fs.open`/`fs.close`/`fs.fstat`/
 * `fs.stat`/`fs.createReadStream` calls resolve to `fsStubs`. `ModelContainer.js` is mocked to hand back
 * the exact `container` object this suite already holds via plain `require` (`compiled(...)`), so
 * `container.bind(...)`/`container.isBound(...)` calls made against that object are visible to
 * `TailStream.js`'s own `import container from '../model/ModelContainer.js'`.
 */
export const prepareRecordedDeliveryFsMocks = async (): Promise<RecordedDeliveryFsModules> => {
    if (recordedDeliveryFsModules !== undefined) return recordedDeliveryFsModules;
    const fsMock = { ...realFs, ...fsStubs };
    const container = compiled<any>('model', 'ModelContainer.js').default;
    const containerModulePath = join(compiledSnapshot, 'model', 'ModelContainer.js');
    vi.doMock('fs', () => fsMock);
    vi.doMock('node:fs', () => fsMock);
    vi.doMock(containerModulePath, () => ({ __esModule: true, default: container }));
    try {
        vi.resetModules();
        const tailStreamModule = await import(join(compiledSnapshot, 'lib', 'TailStream.js'));
        const recordedStreamModelModule = (await import(
            join(compiledSnapshot, 'model', 'service', 'stream', 'RecordedStreamModel.js')
        )) as { default: new (...args: any[]) => any };
        recordedDeliveryFsModules = {
            container,
            RecordedStreamModel: recordedStreamModelModule.default,
            TailStream: tailStreamModule,
        };
        return recordedDeliveryFsModules;
    } finally {
        vi.doUnmock('fs');
        vi.doUnmock('node:fs');
        vi.doUnmock(containerModulePath);
    }
};

export const axiosRequestStub = vi.fn(async () => ({ data: {} }));

let apiUtilCtor: (new (...args: any[]) => any) | undefined;

/** Reloads the compiled `ApiUtil` so its internal `axios.request(...)` calls resolve to `axiosRequestStub`. */
export const prepareApiUtil = async (): Promise<new (...args: any[]) => any> => {
    if (apiUtilCtor !== undefined) return apiUtilCtor;
    vi.doMock('axios', () => ({ default: { request: axiosRequestStub } }));
    try {
        vi.resetModules();
        const imported = (await import(join(compiledSnapshot, 'model', 'api', 'ApiUtil.js'))) as {
            default: new (...args: any[]) => any;
        };
        apiUtilCtor = imported.default;
        return apiUtilCtor;
    } finally {
        vi.doUnmock('axios');
    }
};

export const logger = () => ({
    encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn() },
    stream: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
    system: { error: vi.fn(), info: vi.fn() },
});

export const baseConfig = (overrides: Record<string, unknown> = {}): Record<string, any> => ({
    encodeProcessNum: 4,
    ffmpeg: 'synthetic-ffmpeg',
    ffprobe: 'synthetic-ffprobe',
    streamFilePath: 'synthetic-stream-root',
    streamingPriority: 1,
    stream: {
        live: {
            ts: {
                hls: [{ cmd: '%NODE% live-hls' }],
                m2ts: [{}, { cmd: '%NODE% live-m2ts' }],
                m2tsll: [{ cmd: '%NODE% live-m2tsll' }],
                mp4: [{ cmd: '%NODE% live-mp4' }],
                webm: [{ cmd: '%NODE% live-webm' }],
            },
        },
        recorded: {
            encoded: {
                hls: [{ cmd: '%NODE% encoded-hls' }],
                mp4: [{ cmd: '%NODE% encoded-mp4' }],
                webm: [{ cmd: '%NODE% encoded-webm' }],
            },
            ts: {
                hls: [{ cmd: '%NODE% ts-hls' }],
                mp4: [{ cmd: '%NODE% ts-mp4' }],
                webm: [{ cmd: '%NODE% ts-webm' }],
            },
        },
    },
    ...overrides,
});

export interface FakeStream {
    readonly adoptPlaybackSource: Mock;
    readonly finalizeStop: Mock;
    readonly getInfo: Mock;
    readonly getStream: Mock;
    readonly keep: Mock;
    readonly ownsDiskArtifacts: Mock;
    readonly setExitStream: Mock;
    readonly setOption: Mock;
    readonly start: Mock;
    readonly stop: Mock;
}

export const fakeStream = (info: Record<string, unknown> = {}): FakeStream => {
    const stream: FakeStream = {
        adoptPlaybackSource: vi.fn(),
        finalizeStop: vi.fn(),
        getInfo: vi.fn(() => info),
        getStream: vi.fn((): Readable => new PassThrough()),
        keep: vi.fn(),
        // Mirrors StreamBaseModel#ownsDiskArtifacts(): derived from the current getInfo().type on
        // every call, not snapshotted at construction time -- the same shape as the production
        // getStreamType().includes('HLS') check it stands in for.
        ownsDiskArtifacts: vi.fn(() => String((stream.getInfo() as { type?: unknown })?.type ?? '').includes('HLS')),
        setExitStream: vi.fn(),
        setOption: vi.fn(),
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
    };
    return stream;
};

let hlsStreamIdAllocatorCtor: (new (...args: any[]) => any) | undefined;

/**
 * Constructs the real compiled HlsStreamIdAllocator so tests that exercise the disk-artifact
 * ID-collision-avoidance path drive the same production algorithm StreamManageModel delegates to via
 * IStreamIdAllocator, instead of re-implementing its behavior as a second, divergent fake.
 */
export const fakeIdAllocator = (
    loggerFactory: { getLogger: () => unknown },
    configuration: { getConfig: () => unknown } | undefined,
    artifactIndex: unknown,
): any => {
    hlsStreamIdAllocatorCtor ??= compiled<{ default: new (...args: any[]) => any }>(
        'model',
        'service',
        'stream',
        'manager',
        'HlsStreamIdAllocator.js',
    ).default;
    return new hlsStreamIdAllocatorCtor(loggerFactory, configuration, artifactIndex);
};

export const fakeChild = (): any => {
    const child = new EventEmitter() as any;
    child.exitCode = null;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => true);
    return child;
};

export const executionManager = () => ({
    getExecution: vi.fn(async () => 1),
    unLockExecution: vi.fn(),
});

export interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T | PromiseLike<T>): void;
    reject(error: unknown): void;
}

export const deferred = <T>(): Deferred<T> => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, reject, resolve };
};
