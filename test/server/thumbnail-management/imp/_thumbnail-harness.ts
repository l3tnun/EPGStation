import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

export const processStubs = { spawn: vi.fn() };
const mutableChildProcess = require('child_process') as { spawn: typeof processStubs.spawn };
const originalSpawn = mutableChildProcess.spawn;
mutableChildProcess.spawn = processStubs.spawn;

export const ThumbnailManageModel = (
    require(join(compiledSnapshot, 'model', 'operator', 'thumbnail', 'ThumbnailManageModel.js')) as any
).default;
export const ThumbnailApiModel = (
    require(join(compiledSnapshot, 'model', 'api', 'thumbnail', 'ThumbnailApiModel.js')) as any
).default;
export const PromiseQueue = (require(join(compiledSnapshot, 'model', 'PromiseQueue.js')) as any).default;
export const ThumbnailEvent = (require(join(compiledSnapshot, 'model', 'event', 'ThumbnailEvent.js')) as any).default;
export const FileUtil = (require(join(compiledSnapshot, 'util', 'FileUtil.js')) as any).default;
export const ProcessUtil = (require(join(compiledSnapshot, 'util', 'ProcessUtil.js')) as any).default;

export interface SyntheticChild extends EventEmitter {
    exitCode: number | null;
    kill: ReturnType<typeof vi.fn>;
    pid: number | undefined;
    stderr: PassThrough | null;
    stdin: PassThrough;
    stdout: PassThrough | null;
}

const children: SyntheticChild[] = [];

export const makeChild = (options: Partial<Pick<SyntheticChild, 'pid' | 'stderr' | 'stdout'>> = {}): SyntheticChild => {
    const child = Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        kill: vi.fn(),
        pid: 'pid' in options ? options.pid : 1,
        stderr: typeof options.stderr === 'undefined' ? new PassThrough() : options.stderr,
        stdin: new PassThrough(),
        stdout: typeof options.stdout === 'undefined' ? new PassThrough() : options.stdout,
    });
    children.push(child);
    return child;
};

export const settleChild = (child: SyntheticChild, code: number): void => {
    child.exitCode = code;
    child.emit('exit', code);
    child.emit('close', code);
};

export const logger = () => ({
    system: {
        debug: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
});

export interface ModelFixture {
    config: Record<string, unknown>;
    log: ReturnType<typeof logger>;
    model: any;
    recordedDB: { findAll: ReturnType<typeof vi.fn> };
    thumbnailDB: {
        deleteOnce: ReturnType<typeof vi.fn>;
        findAll: ReturnType<typeof vi.fn>;
        findId: ReturnType<typeof vi.fn>;
        insertOnce: ReturnType<typeof vi.fn>;
    };
    thumbnailEvent: { emitAdded: ReturnType<typeof vi.fn>; emitDeleted: ReturnType<typeof vi.fn> };
    videoFileDB: { findId: ReturnType<typeof vi.fn> };
    videoUtil: { getFullFilePathFromId: ReturnType<typeof vi.fn> };
}

export const makeModel = (overrides: Record<string, unknown> = {}): ModelFixture => {
    const log = logger();
    const config = {
        ffmpeg: process.execPath,
        thumbnail: 'synthetic-thumbnail-root',
        thumbnailCmd:
            '%FFMPEG% --input %INPUT% --output %OUTPUT% --position %THUMBNAIL_POSITION% --size %THUMBNAIL_SIZE%',
        thumbnailPosition: 17,
        thumbnailSize: '320x180',
        ...(overrides.config as object | undefined),
    };
    const recordedDB = { findAll: vi.fn().mockResolvedValue([[], 0]) };
    const videoFileDB = { findId: vi.fn().mockResolvedValue({ id: 11, recordedId: 101 }) };
    const thumbnailDB = {
        deleteOnce: vi.fn().mockResolvedValue(undefined),
        findAll: vi.fn().mockResolvedValue([]),
        findId: vi.fn().mockResolvedValue(null),
        insertOnce: vi.fn().mockResolvedValue(1),
    };
    const thumbnailEvent = { emitAdded: vi.fn(), emitDeleted: vi.fn() };
    const videoUtil = { getFullFilePathFromId: vi.fn().mockResolvedValue('synthetic-input.ts') };
    const queue = overrides.queue ?? new PromiseQueue();
    const model = new ThumbnailManageModel(
        { getLogger: () => log },
        { getConfig: () => config },
        queue,
        recordedDB,
        videoFileDB,
        thumbnailDB,
        thumbnailEvent,
        videoUtil,
    );
    return { config, log, model, recordedDB, thumbnailDB, thumbnailEvent, videoFileDB, videoUtil };
};

export const prepareCreate = (): void => {
    vi.spyOn(FileUtil, 'access').mockResolvedValue(undefined);
    vi.spyOn(FileUtil, 'stat').mockRejectedValue(Object.assign(new Error('synthetic-missing'), { code: 'ENOENT' }));
    vi.spyOn(FileUtil, 'mkdir').mockResolvedValue(undefined);
    vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);
    vi.spyOn(FileUtil, 'copyFile').mockResolvedValue(undefined);
    vi.spyOn(fs.promises, 'open').mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined) } as fs.promises.FileHandle);
    vi.spyOn(fs.promises, 'mkdtemp').mockResolvedValue('synthetic-thumbnail-root/.thumbnail-request');
    vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({} as fs.Stats);
};

export const permitSyntheticCleanupRoot = (): void => {
    vi.spyOn(FileUtil, 'captureManagedRootIdentity').mockReturnValue({
        entryDevice: 1,
        entryInode: 1,
        entryIsSymbolicLink: false,
        targetDevice: 1,
        targetInode: 1,
    });
    vi.spyOn(FileUtil, 'isManagedEntrySafeForRemoval').mockReturnValue(true);
};

export const cleanupHarness = (): void => {
    for (const child of children.splice(0)) {
        child.removeAllListeners();
        child.stdin.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
    }
    processStubs.spawn.mockReset();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
};

export const restoreSpawn = (): void => {
    mutableChildProcess.spawn = originalSpawn;
};

/**
 * Makes the model under test invoke the real `child_process.spawn` for actual child-process
 * characterization (TM-2.14). Reassigning `mutableChildProcess.spawn` alone (`restoreSpawn`) is not
 * enough here: `ThumbnailManageModel.js` is compiled as an ES module and its
 * `import { spawn } from 'child_process'` binding is resolved once when the module is first loaded
 * by this harness (before any test runs) and keeps referencing `processStubs.spawn` from then on --
 * a CommonJS build would read the property live on every call, so mutating
 * `mutableChildProcess.spawn` at test time would reach it, but ESM import bindings do not
 * re-resolve like that. `processStubs.spawn` itself, however, is the one binding the model actually
 * still calls, so delegating its implementation to the pristine `originalSpawn` makes the model
 * spawn a real child process without needing the (now ineffective) module-property swap.
 */
export const useRealSpawn = (): void => {
    processStubs.spawn.mockImplementation(originalSpawn);
};
