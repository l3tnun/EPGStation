import 'reflect-metadata';

import { createRequire } from 'node:module';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushNextTick, IPCServer, makeChild, makeClient } from '../process-messaging/_harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RecordedApiModel = (
    require(join(snapshot, 'model/api/recorded/RecordedApiModel.js')) as {
        default: { prototype: Record<string, unknown> };
    }
).default;

/**
 * `RecordedManageModel.js` delegates its directory walk to `FileUtil.js`, which reads/probes the
 * filesystem through `import * as fs from 'fs'` -- the same static-binding hazard as `child_process`
 * elsewhere in this migration: a plain `require('node:fs')` mutation (`vi.spyOn`) never reaches it,
 * because this suite's ESM import resolves through the test runner's own module graph, not the
 * CommonJS loader a `require(...)` mutation goes through.
 *
 * `vi.doMock` + `vi.resetModules` + a dynamic `import()` is the mechanism that actually lands
 * replacements in that binding (mirrors
 * `event-and-hook-delivery/external-command-test-harness.ts#installSpawnStub`). Both
 * `RecordedManageModel.js` and `FileUtil.js` are reloaded together, in the same `resetModules` pass, so
 * `RecordedManageModel.js`'s own `import FileUtil from '../../../util/FileUtil.js'` resolves to the
 * exact `FileUtil` object this file spies on directly (`vi.spyOn(FileUtil, 'getFileList')` etc. below,
 * for tests that do not need the raw `fs` calls themselves interceptable).
 */
const realFs = require('node:fs') as typeof import('node:fs');
const readdirDispatch = vi.fn((...args: Parameters<typeof realFs.readdir>) => (realFs.readdir as any)(...args));
const lstatSyncDispatch = vi.fn((...args: Parameters<typeof realFs.lstatSync>) => realFs.lstatSync(...args));
const statSyncDispatch = vi.fn((...args: Parameters<typeof realFs.statSync>) => realFs.statSync(...args));
const nodeFs = { lstatSync: lstatSyncDispatch, readdir: readdirDispatch, statSync: statSyncDispatch };

const { FileUtil, RecordedManageModel } = await (async () => {
    const fsMock = { ...realFs, ...nodeFs };
    vi.doMock('fs', () => fsMock);
    vi.doMock('node:fs', () => fsMock);
    try {
        vi.resetModules();
        const recordedManageModelModule = (await import(
            join(snapshot, 'model/operator/recorded/RecordedManageModel.js')
        )) as { default: new (...args: any[]) => any };
        const fileUtilModule = (await import(join(snapshot, 'util/FileUtil.js'))) as {
            default: {
                getFileList(filePath: string): Promise<{ directories: string[]; files: string[] }>;
                isEmptyDirectory(filePath: string): Promise<boolean>;
                rmdir(filePath: string): Promise<void>;
                unlink(filePath: string): Promise<void>;
            };
        };
        return { FileUtil: fileUtilModule.default, RecordedManageModel: recordedManageModelModule.default };
    } finally {
        vi.doUnmock('fs');
        vi.doUnmock('node:fs');
    }
})();

/**
 * Captured once, before any test's `vi.spyOn(FileUtil, 'getFileList')` can run, so every test's own
 * "call the real one, then tamper with the filesystem" mock (below) recurses into the true original
 * instead of risking a re-entrant call into whichever mock happens to be installed at the time -- e.g. if
 * a `vi.spyOn` for the same method from a different test were still settling asynchronously.
 */
const pristineGetFileList = FileUtil.getFileList;

interface VideoRow {
    readonly filePath: string;
    readonly id: number;
    readonly parentDirectoryName: string;
    readonly recordedId: number;
}

interface DropLogRow {
    readonly filePath: string;
    readonly id: number;
}

interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly reject: (reason?: unknown) => void;
    readonly resolve: (value: T | PromiseLike<T>) => void;
}

const deferred = <T>(): Deferred<T> => {
    let reject!: Deferred<T>['reject'];
    let resolve!: Deferred<T>['resolve'];
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        reject = rejectPromise;
        resolve = resolvePromise;
    });
    return { promise, reject, resolve };
};

const temporaryRoots: string[] = [];

const temporaryRoot = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-recorded-cleanup-'));
    temporaryRoots.push(root);
    return root;
};

const observeSettlement = async (operation: Promise<unknown>): Promise<'fulfilled' | 'rejected' | 'pending'> =>
    Promise.race([
        operation.then(
            () => 'fulfilled' as const,
            () => 'rejected' as const,
        ),
        new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 250)),
    ]);

const failDirectoryListing = (failedDirectory: string, failure: Error): void => {
    const actualReaddir = realFs.readdir.bind(realFs);
    nodeFs.readdir.mockImplementation(((directoryPath: import('node:fs').PathLike, callback: any) => {
        if (String(directoryPath) === failedDirectory) {
            callback(failure, []);
            return;
        }
        actualReaddir(directoryPath, callback);
    }) as typeof realFs.readdir);
};

const failFirstDirectoryListing = (failedDirectory: string, failure: Error): (() => number) => {
    const actualReaddir = realFs.readdir.bind(realFs);
    let matchingCallCount = 0;
    nodeFs.readdir.mockImplementation(((directoryPath: import('node:fs').PathLike, callback: any) => {
        if (String(directoryPath) === failedDirectory) {
            matchingCallCount += 1;
            if (matchingCallCount === 1) {
                callback(failure, []);
                return;
            }
        }
        actualReaddir(directoryPath, callback);
    }) as typeof realFs.readdir);
    return () => matchingCallCount;
};

const failSynchronousTypeCheck = (failedEntry: string, failure: Error): void => {
    const actualLstatSync = realFs.lstatSync.bind(realFs);
    nodeFs.lstatSync.mockImplementation((entryPath: import('node:fs').PathLike) => {
        if (String(entryPath) === failedEntry) throw failure;
        return actualLstatSync(entryPath);
    });

    const actualStatSync = realFs.statSync.bind(realFs);
    nodeFs.statSync.mockImplementation((entryPath: import('node:fs').PathLike) => {
        if (String(entryPath) === failedEntry) throw failure;
        return actualStatSync(entryPath);
    });
};

const injectRootEscapeEntry = (managedRoot: string, escapedName: string): void => {
    const actualReaddir = realFs.readdir.bind(realFs);
    nodeFs.readdir.mockImplementation(((directoryPath: import('node:fs').PathLike, callback: any) => {
        actualReaddir(directoryPath, (error, entries) => {
            callback(
                error,
                error === null && String(directoryPath) === managedRoot ? [...entries, escapedName] : entries,
            );
        });
    }) as typeof nodeFs.readdir);
};

const cleanupSubject = (root: string, initialRows: readonly VideoRow[]) => {
    const rows = new Map(initialRows.map(row => [row.id, row]));
    const value: any = Object.create(RecordedManageModel.prototype);
    value.config = { dropLog: join(root, 'drop-log'), recorded: [{ name: 'main', path: root }] };
    value.log = { system: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
    value.videoFileDB = {
        deleteOnce: vi.fn(async (videoFileId: number) => {
            rows.delete(videoFileId);
        }),
        findAll: vi.fn(async () => [...rows.values()]),
        findId: vi.fn(async (videoFileId: number) => rows.get(videoFileId) ?? null),
    };
    value.recordedDB = {
        deleteOnce: vi.fn(async () => undefined),
        findId: vi.fn(async (recordedId: number) => ({
            id: recordedId,
            isProtected: false,
            isRecording: false,
            videoFiles: [...rows.values(), { id: 99_999 }],
        })),
    };
    value.recordedEvent = { emitDeleteVideoFile: vi.fn() };
    value.videoUtil = {
        getFullFilePathFromVideoFile: vi.fn((row: VideoRow) => join(root, row.filePath)),
        getParentDirPath: vi.fn(() => root),
    };
    return { rows, target: value };
};

const dropLogCleanupSubject = (root: string, initialRows: readonly DropLogRow[]) => {
    const rows = new Map(initialRows.map(row => [row.id, row]));
    const relatedIds = new Set(initialRows.map(row => row.id));
    const value: any = Object.create(RecordedManageModel.prototype);
    value.config = { dropLog: root, recorded: [] };
    value.log = { system: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
    value.dropLogFileDB = {
        deleteOnce: vi.fn(async (dropLogFileId: number) => rows.delete(dropLogFileId)),
        findAll: vi.fn(async () => [...rows.values()]),
    };
    value.recordedDB = {
        removeDropLogFileId: vi.fn(async (dropLogFileId: number) => relatedIds.delete(dropLogFileId)),
    };
    value.recordedEvent = { emitDropLogFileChanged: vi.fn() };
    return { relatedIds, rows, target: value };
};

afterEach(async () => {
    vi.useRealTimers();
    // `readdirDispatch`/`lstatSyncDispatch`/`statSyncDispatch` are plain `vi.fn()`s, not `vi.spyOn`
    // spies -- `restoreAllMocks` only restores spies, so `resetAllMocks` is used to bring back their
    // creation-time (real `fs`) implementation and avoid leaking a test's override into later tests.
    vi.resetAllMocks();
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { force: true, recursive: true })));
});

describe('recorded cleanup execution contract', () => {
    it('[RC-9.9] starts both cleanup kinds without waiting for the other kind', async () => {
        const videoCleanup = deferred<void>();
        const dropLogCleanup = deferred<void>();
        const calls: string[] = [];
        const target: any = Object.create(RecordedApiModel.prototype);
        target.ipc = {
            recorded: {
                dropLogFileCleanup: vi.fn(() => {
                    calls.push('drop-log');
                    return dropLogCleanup.promise;
                }),
                videoFileCleanup: vi.fn(() => {
                    calls.push('video');
                    return videoCleanup.promise;
                }),
            },
        };

        const operation = target.fileCleanup();

        try {
            await Promise.resolve();
            expect(calls).toEqual(['video', 'drop-log']);
        } finally {
            videoCleanup.resolve();
            dropLogCleanup.resolve();
            await operation;
        }
    });

    it('starts the other kind even when one cleanup throws synchronously', async () => {
        const failure = new Error('synthetic video cleanup failure');
        const dropLogCleanup = deferred<void>();
        const calls: string[] = [];
        const target: any = Object.create(RecordedApiModel.prototype);
        target.ipc = {
            recorded: {
                dropLogFileCleanup: vi.fn(() => {
                    calls.push('drop-log');
                    return dropLogCleanup.promise;
                }),
                videoFileCleanup: vi.fn(() => {
                    calls.push('video');
                    throw failure;
                }),
            },
        };

        const operation = target.fileCleanup();

        await expect(operation).rejects.toBe(failure);
        expect(calls).toEqual(['video', 'drop-log']);
        dropLogCleanup.resolve();
        await expect(dropLogCleanup.promise).resolves.toBeUndefined();
    });

    it('[RC-9.10] rejects only same-kind reentry and releases each kind on its own body settlement', async () => {
        const root = await temporaryRoot();
        const videoRows = deferred<VideoRow[]>();
        const dropLogRows = deferred<never[]>();
        const dropLogFailure = new Error('synthetic late drop-log failure');
        await mkdir(join(root, 'drop-log'));
        const { target } = cleanupSubject(root, []);
        target.config.recorded = [];
        target.videoFileDB.findAll.mockImplementationOnce(() => videoRows.promise).mockResolvedValue([]);
        target.dropLogFileDB = {
            deleteOnce: vi.fn(async () => undefined),
            findAll: vi
                .fn()
                .mockImplementationOnce(() => dropLogRows.promise)
                .mockResolvedValue([]),
        };
        target.recordedDB.changeProtect = vi.fn(async () => undefined);
        target.recordedDB.removeDropLogFileId = vi.fn(async () => undefined);
        target.recordedEvent.emitChangeProtect = vi.fn();

        const firstVideoCleanup = target.videoFileCleanup();
        const firstDropLogCleanup = target.dropLogFileCleanup();
        const duplicateVideoCleanup = target.videoFileCleanup();
        const duplicateDropLogCleanup = target.dropLogFileCleanup();

        try {
            await expect(duplicateVideoCleanup).rejects.toThrow('VideoFileCleanupIsRunning');
            await expect(duplicateDropLogCleanup).rejects.toThrow('DropLogFileCleanupIsRunning');
            expect(target.videoFileDB.findAll).toHaveBeenCalledOnce();
            expect(target.dropLogFileDB.findAll).toHaveBeenCalledOnce();
            await expect(target.changeProtect(42, true)).resolves.toBeUndefined();

            const restartedRoot = await temporaryRoot();
            const { target: restartedTarget } = cleanupSubject(restartedRoot, []);
            await expect(restartedTarget.videoFileCleanup()).resolves.toBeUndefined();
            expect(restartedTarget.videoFileCleanupState).toBe('idle');

            videoRows.resolve([]);
            await expect(firstVideoCleanup).resolves.toBeUndefined();
            await expect(target.videoFileCleanup()).resolves.toBeUndefined();
            await expect(target.dropLogFileCleanup()).rejects.toThrow('DropLogFileCleanupIsRunning');

            dropLogRows.reject(dropLogFailure);
            await expect(firstDropLogCleanup).rejects.toBe(dropLogFailure);
            await expect(target.dropLogFileCleanup()).resolves.toBeUndefined();
        } finally {
            videoRows.resolve([]);
            dropLogRows.resolve([]);
            await Promise.allSettled([
                firstVideoCleanup,
                firstDropLogCleanup,
                duplicateVideoCleanup,
                duplicateDropLogCleanup,
            ]);
        }
    });
});

describe('recorded video-file cleanup characterization', () => {
    it('[RC-9.1] reconciles registered video-file rows with their actual files', async () => {
        const root = await temporaryRoot();
        const shared = join(root, 'shared.ts');
        const orphan = join(root, 'orphan.ts');
        const emptyDirectory = join(root, 'empty-directory');
        const hiddenFile = join(root, '.hidden.ts');
        const hiddenDirectory = join(root, '.hidden-directory');
        await mkdir(emptyDirectory);
        await mkdir(hiddenDirectory);
        await Promise.all([
            writeFile(shared, 'shared-bytes'),
            writeFile(orphan, 'orphan-bytes'),
            writeFile(hiddenFile, 'hidden-bytes'),
            writeFile(join(hiddenDirectory, 'hidden-child.ts'), 'hidden-child-bytes'),
        ]);
        const sharedRow: VideoRow = { filePath: 'shared.ts', id: 101, parentDirectoryName: 'main', recordedId: 201 };
        const databaseOnlyRow: VideoRow = {
            filePath: 'database-only.ts',
            id: 102,
            parentDirectoryName: 'main',
            recordedId: 202,
        };
        const { rows, target } = cleanupSubject(root, [sharedRow, databaseOnlyRow]);

        await target.videoFileCleanup();

        expect([...rows.keys()]).toEqual([sharedRow.id]);
        await expect(readFile(shared, 'utf8')).resolves.toBe('shared-bytes');
        await expect(stat(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(stat(emptyDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(hiddenFile, 'utf8')).resolves.toBe('hidden-bytes');
        await expect(readFile(join(hiddenDirectory, 'hidden-child.ts'), 'utf8')).resolves.toBe('hidden-child-bytes');
        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledOnce();
        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledWith(databaseOnlyRow.id);
    });

    it('[RC-9.8] continues the constructed target set after independent DB and file deletion failures', async () => {
        const root = await temporaryRoot();
        const retainedAfterFailure = join(root, 'first-orphan.ts');
        const deletedAfterFailure = join(root, 'second-orphan.ts');
        await writeFile(retainedAfterFailure, 'first-bytes');
        await writeFile(deletedAfterFailure, 'second-bytes');
        const firstDatabaseOnly: VideoRow = {
            filePath: 'first-missing.ts',
            id: 111,
            parentDirectoryName: 'main',
            recordedId: 211,
        };
        const secondDatabaseOnly: VideoRow = {
            filePath: 'second-missing.ts',
            id: 112,
            parentDirectoryName: 'main',
            recordedId: 212,
        };
        const { rows, target } = cleanupSubject(root, [firstDatabaseOnly, secondDatabaseOnly]);
        target.videoFileDB.deleteOnce.mockImplementation(async (videoFileId: number) => {
            if (videoFileId === firstDatabaseOnly.id) throw new Error('synthetic DB deletion failure');
            rows.delete(videoFileId);
        });
        const actualUnlink = FileUtil.unlink.bind(FileUtil);
        vi.spyOn(FileUtil, 'unlink').mockImplementation(async filePath => {
            if (filePath === retainedAfterFailure) throw new Error('synthetic file deletion failure');
            await actualUnlink(filePath);
        });

        await target.videoFileCleanup();

        expect([...rows.keys()]).toEqual([firstDatabaseOnly.id]);
        expect(target.videoFileDB.deleteOnce.mock.calls).toEqual([[firstDatabaseOnly.id], [secondDatabaseOnly.id]]);
        await expect(readFile(retainedAfterFailure, 'utf8')).resolves.toBe('first-bytes');
        await expect(stat(deletedAfterFailure)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('[RC-9.16] fails the video-file cleanup when its managed root cannot be listed', async () => {
        const parent = await temporaryRoot();
        const missingRoot = join(parent, 'missing-recorded-root');
        const { target } = cleanupSubject(missingRoot, []);

        await expect(target.videoFileCleanup()).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('[RC-9.2] removes the exact video-file row when its registered file has disappeared', async () => {
        const root = await temporaryRoot();
        const missingRow: VideoRow = {
            filePath: 'synthetic-missing.ts',
            id: 121,
            parentDirectoryName: 'main',
            recordedId: 221,
        };
        const { rows, target } = cleanupSubject(root, [missingRow]);

        await target.videoFileCleanup();

        expect([...rows.keys()]).toEqual([]);
        expect(target.videoFileDB.deleteOnce).toHaveBeenCalledWith(missingRow.id);
    });

    it('[Task gap] skips the file-existence check when a video file has no resolvable path', async () => {
        const root = await temporaryRoot();
        const unresolvedRow: VideoRow = {
            filePath: 'synthetic-unresolved.ts',
            id: 131,
            parentDirectoryName: 'main',
            recordedId: 231,
        };
        const { rows, target } = cleanupSubject(root, [unresolvedRow]);
        target.videoUtil.getFullFilePathFromVideoFile.mockReturnValue(null);

        await target.videoFileCleanup();

        expect([...rows.keys()]).toEqual([unresolvedRow.id]);
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
    });

    it('[RC-9.4] removes an empty managed directory that contains no registered video file', async () => {
        const root = await temporaryRoot();
        const emptyDirectory = join(root, 'synthetic-empty-directory');
        await mkdir(emptyDirectory);
        const { target } = cleanupSubject(root, []);

        await target.videoFileCleanup();

        await expect(lstat(emptyDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('[RC-9.15] preserves dot files and dot directories without enumerating them as cleanup targets', async () => {
        const root = await temporaryRoot();
        const hiddenFile = join(root, '.synthetic-hidden.ts');
        const hiddenDirectory = join(root, '.synthetic-hidden-directory');
        const hiddenChild = join(hiddenDirectory, 'synthetic-child.ts');
        await mkdir(hiddenDirectory);
        await Promise.all([writeFile(hiddenFile, 'hidden-file'), writeFile(hiddenChild, 'hidden-child')]);
        const { target } = cleanupSubject(root, []);

        await target.videoFileCleanup();

        await expect(readFile(hiddenFile, 'utf8')).resolves.toBe('hidden-file');
        await expect(readFile(hiddenChild, 'utf8')).resolves.toBe('hidden-child');
    });
});

describe('recorded drop-log cleanup specification', () => {
    it('[RC-9.5] reconciles registered drop-log rows with their actual files', async () => {
        const root = await temporaryRoot();
        const shared = join(root, 'synthetic-shared.log');
        await writeFile(shared, 'shared-log');
        const sharedRow: DropLogRow = { filePath: 'synthetic-shared.log', id: 131 };
        const missingRow: DropLogRow = { filePath: 'synthetic-missing.log', id: 132 };
        const { rows, target } = dropLogCleanupSubject(root, [sharedRow, missingRow]);

        await target.dropLogFileCleanup();

        expect([...rows.keys()]).toEqual([sharedRow.id]);
        await expect(readFile(shared, 'utf8')).resolves.toBe('shared-log');
    });

    it('[RC-9.6] removes the exact recorded relation and row for a missing registered drop log', async () => {
        const root = await temporaryRoot();
        const missingRow: DropLogRow = { filePath: 'synthetic-missing.log', id: 141 };
        const { relatedIds, rows, target } = dropLogCleanupSubject(root, [missingRow]);

        await target.dropLogFileCleanup();

        expect([...relatedIds]).toEqual([]);
        expect([...rows.keys()]).toEqual([]);
        expect(target.recordedDB.removeDropLogFileId).toHaveBeenCalledWith(missingRow.id);
        expect(target.dropLogFileDB.deleteOnce).toHaveBeenCalledWith(missingRow.id);
    });

    it('[RC-9.7] removes an unregistered drop-log file from its managed root', async () => {
        const root = await temporaryRoot();
        const orphan = join(root, 'synthetic-orphan.log');
        await writeFile(orphan, 'orphan-log');
        const { target } = dropLogCleanupSubject(root, []);

        await target.dropLogFileCleanup();

        await expect(lstat(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
    });
});

describe('recorded cleanup caller deadline specification', () => {
    it('[RC-9.11] keeps the actual same-kind domain cleanup running through caller timeout while the other kind settles, then reaccepts after late success and failure', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        const root = await temporaryRoot();
        const firstVideoRows = deferred<unknown[]>();
        const lateVideoFailure = deferred<unknown[]>();
        const dropLogRows = deferred<unknown[]>();
        const failure = new Error('synthetic late video cleanup failure');
        const videoFileDB = {
            deleteOnce: vi.fn(async () => undefined),
            findAll: vi
                .fn()
                .mockImplementationOnce(() => firstVideoRows.promise)
                .mockImplementationOnce(() => lateVideoFailure.promise)
                .mockResolvedValue([]),
        };
        const dropLogFileDB = {
            deleteOnce: vi.fn(async () => undefined),
            findAll: vi
                .fn()
                .mockImplementationOnce(() => dropLogRows.promise)
                .mockResolvedValue([]),
        };
        const logger = { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }) };
        const domain = new RecordedManageModel(
            logger,
            { getConfig: () => ({ dropLog: root, recorded: [], thumbnail: root }) },
            { removeDropLogFileId: vi.fn(async () => undefined) },
            videoFileDB,
            { deleteOnce: vi.fn(async () => undefined) },
            dropLogFileDB,
            {},
            { cancel: vi.fn(), hasReserve: vi.fn() },
            { emitDeleteVideoFile: vi.fn(), emitDropLogFileChanged: vi.fn() },
            {},
            {},
        );
        const server = new IPCServer({}, domain, {}, {}, {}, {}, logger, {});
        const child = makeChild();
        child.send.mockImplementation((message: unknown) => {
            void harness.receive(message);
        });
        server.register(child as any);
        const flushMicrotasks = async (): Promise<void> => {
            for (let index = 0; index < 8; index += 1) await Promise.resolve();
        };
        const forwardLastClientRequest = async (): Promise<void> => {
            await flushNextTick();
            const sent = harness.send.mock.calls[harness.send.mock.calls.length - 1];
            child.emit('message', sent[0]);
            await flushMicrotasks();
        };
        try {
            const firstVideoRequest = harness.client.recorded.videoFileCleanup();
            const firstVideoOutcome = firstVideoRequest.then(
                () => ({ status: 'fulfilled' as const }),
                (error: Error) => ({ error, status: 'rejected' as const }),
            );
            await forwardLastClientRequest();
            expect(videoFileDB.findAll).toHaveBeenCalledOnce();

            await vi.advanceTimersByTimeAsync(600_000);
            await expect(firstVideoOutcome).resolves.toMatchObject({
                error: { message: 'IPCTimeout' },
                status: 'rejected',
            });

            const sameKindRequest = harness.client.recorded.videoFileCleanup();
            await forwardLastClientRequest();
            await expect(sameKindRequest).rejects.toThrow('VideoFileCleanupIsRunning');
            expect(videoFileDB.findAll).toHaveBeenCalledOnce();

            const otherKindRequest = harness.client.recorded.dropLogFileCleanup();
            await forwardLastClientRequest();
            expect(dropLogFileDB.findAll).toHaveBeenCalledOnce();
            dropLogRows.resolve([]);
            await flushMicrotasks();
            await expect(otherKindRequest).resolves.toBeUndefined();

            firstVideoRows.resolve([]);
            await flushMicrotasks();
            const afterLateSuccess = harness.client.recorded.videoFileCleanup();
            const afterLateSuccessOutcome = afterLateSuccess.then(
                () => ({ status: 'fulfilled' as const }),
                (error: Error) => ({ error, status: 'rejected' as const }),
            );
            await forwardLastClientRequest();
            expect(videoFileDB.findAll).toHaveBeenCalledTimes(2);

            await vi.advanceTimersByTimeAsync(600_000);
            await expect(afterLateSuccessOutcome).resolves.toMatchObject({
                error: { message: 'IPCTimeout' },
                status: 'rejected',
            });
            lateVideoFailure.reject(failure);
            await flushMicrotasks();

            const afterLateFailure = harness.client.recorded.videoFileCleanup();
            await forwardLastClientRequest();
            await expect(afterLateFailure).resolves.toBeUndefined();
            expect(videoFileDB.findAll).toHaveBeenCalledTimes(3);
        } finally {
            firstVideoRows.resolve([]);
            lateVideoFailure.reject(failure);
            dropLogRows.resolve([]);
            await flushMicrotasks();
            harness.cleanup();
            vi.useRealTimers();
        }
    });
});

describe('recorded video-file cleanup safety', () => {
    it('[RC-9.3] removes safe unregistered video files from each independent root', async () => {
        const parent = await temporaryRoot();
        const firstRoot = join(parent, 'first-root');
        const secondRoot = join(parent, 'second-root');
        const firstOrphan = join(firstRoot, 'first-orphan.ts');
        const secondOrphan = join(secondRoot, 'second-orphan.ts');
        const firstEmptyDirectory = join(firstRoot, 'first-empty-directory');
        const secondEmptyDirectory = join(secondRoot, 'second-empty-directory');
        await Promise.all([
            mkdir(firstEmptyDirectory, { recursive: true }),
            mkdir(secondEmptyDirectory, { recursive: true }),
        ]);
        await Promise.all([writeFile(firstOrphan, 'first-bytes'), writeFile(secondOrphan, 'second-bytes')]);
        const { target } = cleanupSubject(firstRoot, []);
        target.config.recorded = [
            { name: 'first', path: firstRoot },
            { name: 'second', path: secondRoot },
        ];

        await target.videoFileCleanup();

        for (const removedPath of [firstOrphan, secondOrphan, firstEmptyDirectory, secondEmptyDirectory]) {
            await expect(lstat(removedPath)).rejects.toMatchObject({ code: 'ENOENT' });
        }
    });

    it('preserves a stable configured root symlink while removing its unregistered child', async () => {
        const parent = await temporaryRoot();
        const physicalRoot = join(parent, 'physical-root');
        const root = join(parent, 'managed-root-link');
        const orphan = join(physicalRoot, 'orphan.ts');
        await mkdir(physicalRoot);
        await writeFile(orphan, 'orphan-bytes');
        await symlink(physicalRoot, root, 'dir');
        const { target } = cleanupSubject(root, []);

        await target.videoFileCleanup();

        expect((await lstat(root)).isSymbolicLink()).toBe(true);
        await expect(stat(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('[RC-9.13] does not follow a managed root replaced by an external symlink after enumeration', async () => {
        const parent = await temporaryRoot();
        const root = join(parent, 'managed');
        const displacedRoot = join(parent, '.displaced-root');
        const externalDirectory = join(parent, 'external-directory');
        const listedFile = join(root, 'orphan.ts');
        const displacedFile = join(displacedRoot, 'orphan.ts');
        const externalFile = join(externalDirectory, 'orphan.ts');
        await Promise.all([mkdir(root), mkdir(externalDirectory)]);
        await Promise.all([writeFile(listedFile, 'managed-bytes'), writeFile(externalFile, 'external-bytes')]);
        const actualGetFileList = pristineGetFileList;
        vi.spyOn(FileUtil, 'getFileList').mockImplementation(async managedRoot => {
            const list = await actualGetFileList(managedRoot);
            await rename(root, displacedRoot);
            await symlink(externalDirectory, root, 'dir');
            return list;
        });
        const { target } = cleanupSubject(root, []);

        await target.videoFileCleanup();

        await expect(readFile(externalFile, 'utf8')).resolves.toBe('external-bytes');
        await expect(readFile(displacedFile, 'utf8')).resolves.toBe('managed-bytes');
    });

    it('does not reauthorize a swapped nested root through overlapping configured roots', async () => {
        const parent = await temporaryRoot();
        const outerRoot = join(parent, 'managed');
        const nestedRoot = join(outerRoot, 'nested');
        const displacedRoot = join(outerRoot, '.displaced-nested');
        const externalDirectory = join(parent, 'external-directory');
        const listedFile = join(nestedRoot, 'orphan.ts');
        const displacedFile = join(displacedRoot, 'orphan.ts');
        const externalFile = join(externalDirectory, 'orphan.ts');
        await Promise.all([mkdir(nestedRoot, { recursive: true }), mkdir(externalDirectory)]);
        await Promise.all([writeFile(listedFile, 'managed-bytes'), writeFile(externalFile, 'external-bytes')]);
        const actualGetFileList = pristineGetFileList;
        vi.spyOn(FileUtil, 'getFileList').mockImplementation(async managedRoot => {
            const list = await actualGetFileList(managedRoot);
            if (managedRoot === nestedRoot) {
                await rename(nestedRoot, displacedRoot);
                await symlink(externalDirectory, nestedRoot, 'dir');
            }
            return list;
        });
        const { target } = cleanupSubject(outerRoot, []);
        target.config.recorded = [
            { name: 'outer', path: outerRoot },
            { name: 'nested', path: nestedRoot },
        ];

        await target.videoFileCleanup();

        await expect(readFile(externalFile, 'utf8')).resolves.toBe('external-bytes');
        await expect(readFile(displacedFile, 'utf8')).resolves.toBe('managed-bytes');
    });

    it('does not follow a parent directory replaced by an external symlink after enumeration', async () => {
        const parent = await temporaryRoot();
        const root = join(parent, 'managed');
        const listedParent = join(root, 'listed-parent');
        const displacedParent = join(root, '.displaced-parent');
        const externalDirectory = join(parent, 'external-directory');
        const listedFile = join(listedParent, 'orphan.ts');
        const displacedFile = join(displacedParent, 'orphan.ts');
        const externalFile = join(externalDirectory, 'orphan.ts');
        await Promise.all([mkdir(listedParent, { recursive: true }), mkdir(externalDirectory)]);
        await Promise.all([writeFile(listedFile, 'managed-bytes'), writeFile(externalFile, 'external-bytes')]);
        const actualGetFileList = pristineGetFileList;
        vi.spyOn(FileUtil, 'getFileList').mockImplementation(async managedRoot => {
            const list = await actualGetFileList(managedRoot);
            await rename(listedParent, displacedParent);
            await symlink(externalDirectory, listedParent, 'dir');
            return list;
        });
        const { target } = cleanupSubject(root, []);

        await target.videoFileCleanup();

        await expect(readFile(externalFile, 'utf8')).resolves.toBe('external-bytes');
        await expect(readFile(displacedFile, 'utf8')).resolves.toBe('managed-bytes');
    });

    it('does not inspect or remove a listed directory replaced by an external symlink', async () => {
        const parent = await temporaryRoot();
        const root = join(parent, 'managed');
        const listedDirectory = join(root, 'listed-directory');
        const displacedDirectory = join(root, '.displaced-directory');
        const externalDirectory = join(parent, 'external-directory');
        const externalMarker = join(externalDirectory, 'marker.ts');
        await Promise.all([mkdir(listedDirectory, { recursive: true }), mkdir(externalDirectory)]);
        await writeFile(externalMarker, 'external-bytes');
        const actualGetFileList = pristineGetFileList;
        vi.spyOn(FileUtil, 'getFileList').mockImplementation(async managedRoot => {
            const list = await actualGetFileList(managedRoot);
            await rename(listedDirectory, displacedDirectory);
            await symlink(externalDirectory, listedDirectory, 'dir');
            return list;
        });
        const emptyDirectoryProbe = vi.spyOn(FileUtil, 'isEmptyDirectory');
        const directoryRemoval = vi.spyOn(FileUtil, 'rmdir');
        const { target } = cleanupSubject(root, []);

        await target.videoFileCleanup();

        expect(emptyDirectoryProbe).not.toHaveBeenCalled();
        expect(directoryRemoval).not.toHaveBeenCalled();
        expect((await lstat(listedDirectory)).isSymbolicLink()).toBe(true);
        expect((await stat(displacedDirectory)).isDirectory()).toBe(true);
        await expect(readFile(externalMarker, 'utf8')).resolves.toBe('external-bytes');
    });

    it('[RC-9.12] unlinks file and directory links without changing either external target', async () => {
        const parent = await temporaryRoot();
        const root = join(parent, 'managed');
        const externalFile = join(parent, 'external-file.ts');
        const externalDirectory = join(parent, 'external-directory');
        const externalChild = join(externalDirectory, 'marker.ts');
        const fileLink = join(root, 'file-link.ts');
        const directoryLink = join(root, 'directory-link');
        await Promise.all([mkdir(root), mkdir(externalDirectory)]);
        await Promise.all([
            writeFile(externalFile, 'external-file-bytes'),
            writeFile(externalChild, 'external-child-bytes'),
        ]);
        await Promise.all([symlink(externalFile, fileLink, 'file'), symlink(externalDirectory, directoryLink, 'dir')]);
        const { target } = cleanupSubject(root, []);

        await target.videoFileCleanup();

        await expect(lstat(fileLink)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(lstat(directoryLink)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(externalFile, 'utf8')).resolves.toBe('external-file-bytes');
        await expect(readFile(externalChild, 'utf8')).resolves.toBe('external-child-bytes');
    });

    it('unlinks a broken link and settles its owning cleanup request', async () => {
        const root = await temporaryRoot();
        const brokenLink = join(root, 'broken-link.ts');
        await symlink(join(root, 'missing-target.ts'), brokenLink, 'file');
        const { target } = cleanupSubject(root, []);

        const settlement = await observeSettlement(target.videoFileCleanup());

        expect(settlement).toBe('fulfilled');
        await expect(lstat(brokenLink)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('[RC-9.14] ignores a normalized root escape without touching the external path', async () => {
        const parent = await temporaryRoot();
        const root = join(parent, 'managed');
        const escapedMarker = join(parent, 'escaped-marker.ts');
        const hiddenFile = join(root, '.hidden.ts');
        const hiddenDirectory = join(root, '.hidden-directory');
        const hiddenChild = join(hiddenDirectory, 'marker.ts');
        await mkdir(hiddenDirectory, { recursive: true });
        await Promise.all([
            writeFile(escapedMarker, 'escaped-marker-bytes'),
            writeFile(hiddenFile, 'hidden-file-bytes'),
            writeFile(hiddenChild, 'hidden-child-bytes'),
        ]);
        injectRootEscapeEntry(root, 'safe/../../escaped-marker.ts');
        const { target } = cleanupSubject(root, []);

        await target.videoFileCleanup();

        await expect(readFile(escapedMarker, 'utf8')).resolves.toBe('escaped-marker-bytes');
        await expect(readFile(hiddenFile, 'utf8')).resolves.toBe('hidden-file-bytes');
        await expect(readFile(hiddenChild, 'utf8')).resolves.toBe('hidden-child-bytes');
    });

    it('[RC-9.17] records a subdirectory listing failure and continues deleting an independent target', async () => {
        const root = await temporaryRoot();
        const failedDirectory = join(root, 'failed-directory');
        const retainedChild = join(failedDirectory, 'retained.ts');
        const independentOrphan = join(root, 'independent-orphan.ts');
        const failure = new Error('synthetic subdirectory listing failure');
        await mkdir(failedDirectory);
        await Promise.all([writeFile(retainedChild, 'retained-bytes'), writeFile(independentOrphan, 'orphan-bytes')]);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        failDirectoryListing(failedDirectory, failure);
        const { target } = cleanupSubject(root, []);

        await expect(target.videoFileCleanup()).resolves.toBeUndefined();

        expect(consoleError).toHaveBeenCalledWith(
            `failed to enumerate managed subdirectory: ${failedDirectory}`,
            failure,
        );
        await expect(readFile(retainedChild, 'utf8')).resolves.toBe('retained-bytes');
        await expect(stat(independentOrphan)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('fully skips an empty subdirectory whose first listing fails', async () => {
        const root = await temporaryRoot();
        const failedDirectory = join(root, 'failed-empty-directory');
        const independentOrphan = join(root, 'independent-orphan.ts');
        const failure = new Error('synthetic first subdirectory listing failure');
        await mkdir(failedDirectory);
        await writeFile(independentOrphan, 'orphan-bytes');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const failedDirectoryListingCount = failFirstDirectoryListing(failedDirectory, failure);
        const { target } = cleanupSubject(root, []);

        await expect(target.videoFileCleanup()).resolves.toBeUndefined();

        expect(consoleError).toHaveBeenCalledWith(
            `failed to enumerate managed subdirectory: ${failedDirectory}`,
            failure,
        );
        expect(failedDirectoryListingCount()).toBe(1);
        expect((await stat(failedDirectory)).isDirectory()).toBe(true);
        await expect(stat(independentOrphan)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('records a synchronous type-check failure, continues other targets, and settles', async () => {
        const root = await temporaryRoot();
        const failedEntry = join(root, 'failed-entry.ts');
        const independentOrphan = join(root, 'independent-orphan.ts');
        const failure = new Error('synthetic synchronous type-check failure');
        await Promise.all([writeFile(failedEntry, 'failed-entry-bytes'), writeFile(independentOrphan, 'orphan-bytes')]);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        failSynchronousTypeCheck(failedEntry, failure);
        const { target } = cleanupSubject(root, []);

        const settlement = await observeSettlement(target.videoFileCleanup());

        expect(settlement).toBe('fulfilled');
        expect(consoleError).toHaveBeenCalledWith(`failed to inspect managed entry: ${failedEntry}`, failure);
        await expect(readFile(failedEntry, 'utf8')).resolves.toBe('failed-entry-bytes');
        await expect(stat(independentOrphan)).rejects.toMatchObject({ code: 'ENOENT' });
    });
});

describe('recorded api model facade delegation', () => {
    it('delegates stopEncode to the encode manage model and forwards its result', async () => {
        const target: any = Object.create(RecordedApiModel.prototype);
        target.encodeManage = { cancelEncodeByRecordedId: vi.fn(async () => undefined) };

        await expect(target.stopEncode(701)).resolves.toBeUndefined();

        expect(target.encodeManage.cancelEncodeByRecordedId).toHaveBeenCalledWith(701);
    });

    it('propagates a stopEncode rejection from the encode manage model', async () => {
        const target: any = Object.create(RecordedApiModel.prototype);
        const failure = new Error('synthetic cancel-encode failure');
        target.encodeManage = {
            cancelEncodeByRecordedId: vi.fn(async () => {
                throw failure;
            }),
        };

        await expect(target.stopEncode(702)).rejects.toBe(failure);
    });

    it('delegates changeProtect to the ipc client with the requested protect value', async () => {
        const target: any = Object.create(RecordedApiModel.prototype);
        target.ipc = { recorded: { changeProtect: vi.fn(async () => undefined) } };

        await expect(target.changeProtect(703, true)).resolves.toBeUndefined();

        expect(target.ipc.recorded.changeProtect).toHaveBeenCalledWith(703, true);
    });

    it('delegates addUploadedVideoFile to the ipc client', async () => {
        const target: any = Object.create(RecordedApiModel.prototype);
        const option = { recordedId: 704, filePath: 'uploaded.mp4' };
        target.ipc = { recorded: { addUploadedVideoFile: vi.fn(async () => undefined) } };

        await expect(target.addUploadedVideoFile(option)).resolves.toBeUndefined();

        expect(target.ipc.recorded.addUploadedVideoFile).toHaveBeenCalledWith(option);
    });

    it('delegates createNewRecorded to the ipc client and returns its assigned id', async () => {
        const target: any = Object.create(RecordedApiModel.prototype);
        const option = { channelId: 1, startAt: 0, endAt: 1 };
        target.ipc = { recorded: { createNewRecorded: vi.fn(async () => 705) } };

        await expect(target.createNewRecorded(option)).resolves.toBe(705);

        expect(target.ipc.recorded.createNewRecorded).toHaveBeenCalledWith(option);
    });
});
