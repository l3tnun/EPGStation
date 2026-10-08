import 'reflect-metadata';

import { createRequire } from 'node:module';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushNextTick, makeClient } from '../process-messaging/_harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RecordedDB = (
    require(join(snapshot, 'model/db/RecordedDB.js')) as {
        default: new (...args: any[]) => { removeDropLogFileId(dropLogFileId: number): Promise<boolean> };
    }
).default;
const DropLogFileDB = (
    require(join(snapshot, 'model/db/DropLogFileDB.js')) as {
        default: new (...args: any[]) => { deleteOnce(dropLogFileId: number): Promise<boolean> };
    }
).default;

interface ManagedRootIdentity {
    readonly entryDevice: number;
    readonly entryInode: number;
    readonly entryIsSymbolicLink: boolean;
    readonly targetDevice: number;
    readonly targetInode: number;
}

interface FileUtilRuntime {
    captureManagedRootIdentity(filePath: string): ManagedRootIdentity;
    getFileList(filePath: string): Promise<{ directories: string[]; files: string[] }>;
    isManagedEntrySafeForRemoval(
        managedRoot: string,
        entryPath: string,
        expectedRoot: ManagedRootIdentity,
        expectedDirectory?: boolean,
    ): boolean;
    unlink(filePath: string): Promise<void>;
}

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
 * exact `FileUtil` object this file spies on directly.
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
        )) as { default: { prototype: Record<string, unknown> } };
        const fileUtilModule = (await import(join(snapshot, 'util/FileUtil.js'))) as { default: FileUtilRuntime };
        return { FileUtil: fileUtilModule.default, RecordedManageModel: recordedManageModelModule.default };
    } finally {
        vi.doUnmock('fs');
        vi.doUnmock('node:fs');
    }
})();

/**
 * Captured once, before any test's `vi.spyOn(FileUtil, ...)` can run, so a test's own "call the real
 * one, then tamper with the filesystem" mock recurses into the true original instead of risking a
 * re-entrant call into whichever mock happens to be installed at the time.
 */
const pristineGetFileList = FileUtil.getFileList;

interface DropLogRow {
    readonly filePath: string;
    readonly id: number;
}

const temporaryRoots: string[] = [];

const temporaryRoot = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-drop-log-cleanup-'));
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

const injectDirectoryEntries = (managedRoot: string, injectedEntries: readonly string[]): void => {
    const actualReaddir = realFs.readdir.bind(realFs);
    nodeFs.readdir.mockImplementation(((directoryPath: import('node:fs').PathLike, callback: any) => {
        actualReaddir(directoryPath, (error, entries) => {
            callback(
                error,
                error === null && String(directoryPath) === managedRoot ? [...entries, ...injectedEntries] : entries,
            );
        });
    }) as typeof realFs.readdir);
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

const cleanupSubject = (root: string, initialRows: readonly DropLogRow[]) => {
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
    vi.clearAllTimers();
    vi.useRealTimers();
    // `readdirDispatch`/`lstatSyncDispatch`/`statSyncDispatch` are plain `vi.fn()`s, not `vi.spyOn`
    // spies -- `restoreAllMocks` only restores spies, so `resetAllMocks` is used to bring back their
    // creation-time (real `fs`) implementation and avoid leaking a test's override into later tests.
    vi.resetAllMocks();
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { force: true, recursive: true })));
});

describe('recorded cleanup caller deadline [RC-6.3]', () => {
    it.each(['videoFileCleanup', 'dropLogFileCleanup'] as const)(
        '[RC-9.11] applies the exact 599,999/600,000ms boundary and ignores a late %s reply',
        async cleanupMethod => {
            vi.useFakeTimers();
            const harness = makeClient();
            try {
                let settlements = 0;
                const request = harness.client.recorded[cleanupMethod]();
                const outcome = request.then(
                    (value: unknown) => {
                        settlements += 1;
                        return { value };
                    },
                    (error: Error) => {
                        settlements += 1;
                        return { error };
                    },
                );
                await flushNextTick();
                const requestId = harness.send.mock.calls[0][0].id;

                await vi.advanceTimersByTimeAsync(599_999);
                expect(settlements).toBe(0);

                await vi.advanceTimersByTimeAsync(1);
                await expect(outcome).resolves.toMatchObject({ error: { message: 'IPCTimeout' } });
                expect(settlements).toBe(1);

                await harness.receive({ id: requestId, result: undefined });
                await flushNextTick();
                expect(settlements).toBe(1);
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                harness.cleanup();
            }
        },
    );
});

describe('recorded cleanup affected-row contract [RC-6.3]', () => {
    it.each([
        ['affected=0', 0, false],
        ['affected=1', 1, true],
        ['affected omitted', undefined, false],
    ] as const)('maps %s (affected=%s) to changed=%s for both cleanup mutations', async (_case, affected, expected) => {
        const queryBuilder: any = {
            delete: vi.fn(),
            execute: vi.fn(async () => ({ affected })),
            from: vi.fn(),
            set: vi.fn(),
            update: vi.fn(),
            where: vi.fn(),
        };
        for (const method of ['delete', 'from', 'set', 'update', 'where'] as const) {
            queryBuilder[method].mockReturnValue(queryBuilder);
        }
        const operator = { getConnection: vi.fn(async () => ({ createQueryBuilder: () => queryBuilder })) };
        const retry = { run: <T>(job: () => Promise<T>): Promise<T> => job() };
        const recordedDB = new RecordedDB(operator, retry);
        const dropLogFileDB = new DropLogFileDB(operator, retry);

        await expect(recordedDB.removeDropLogFileId(9_001)).resolves.toBe(expected);
        await expect(dropLogFileDB.deleteOnce(9_001)).resolves.toBe(expected);
    });

    it('maps affected=null to unchanged for the TypeORM delete result', async () => {
        const queryBuilder: any = {
            delete: vi.fn(),
            execute: vi.fn(async () => ({ affected: null })),
            from: vi.fn(),
            where: vi.fn(),
        };
        for (const method of ['delete', 'from', 'where'] as const) {
            queryBuilder[method].mockReturnValue(queryBuilder);
        }
        const operator = { getConnection: vi.fn(async () => ({ createQueryBuilder: () => queryBuilder })) };
        const retry = { run: <T>(job: () => Promise<T>): Promise<T> => job() };
        const dropLogFileDB = new DropLogFileDB(operator, retry);

        await expect(dropLogFileDB.deleteOnce(9_001)).resolves.toBe(false);
    });
});

describe('managed cleanup removal gate [RC-6.2]', () => {
    it('[RC-9.13/9.14] rejects every independently changed root identity component', async () => {
        const root = await temporaryRoot();
        const candidate = join(root, 'candidate.log');
        await writeFile(candidate, 'candidate-bytes');
        const identity = FileUtil.captureManagedRootIdentity(root);
        const mismatches: ManagedRootIdentity[] = [
            { ...identity, entryDevice: identity.entryDevice + 1 },
            { ...identity, entryInode: identity.entryInode + 1 },
            { ...identity, entryIsSymbolicLink: !identity.entryIsSymbolicLink },
            { ...identity, targetDevice: identity.targetDevice + 1 },
            { ...identity, targetInode: identity.targetInode + 1 },
        ];

        expect(mismatches.map(expected => FileUtil.isManagedEntrySafeForRemoval(root, candidate, expected))).toEqual([
            false,
            false,
            false,
            false,
            false,
        ]);
        expect(FileUtil.isManagedEntrySafeForRemoval(root, candidate, identity)).toBe(true);
    });

    it('[RC-9.13/9.14] rejects root, parent, and normalized outside paths before removal', async () => {
        const root = await temporaryRoot();
        const identity = FileUtil.captureManagedRootIdentity(root);
        const parent = resolve(root, '..');
        const outside = join(parent, 'outside.log');

        expect(FileUtil.isManagedEntrySafeForRemoval(root, root, identity)).toBe(false);
        expect(FileUtil.isManagedEntrySafeForRemoval(root, parent, identity)).toBe(false);
        expect(FileUtil.isManagedEntrySafeForRemoval(root, outside, identity)).toBe(false);
    });

    it('[RC-9.13/9.14] accepts a real nested parent and rejects link, file, and missing parents', async () => {
        const root = await temporaryRoot();
        const realParent = join(root, 'real-parent');
        const realCandidate = join(realParent, 'candidate.log');
        const linkParent = join(root, 'link-parent');
        const fileParent = join(root, 'file-parent');
        await mkdir(realParent);
        await writeFile(realCandidate, 'candidate-bytes');
        await symlink(realParent, linkParent, 'dir');
        await writeFile(fileParent, 'parent-bytes');
        const identity = FileUtil.captureManagedRootIdentity(root);

        expect(FileUtil.isManagedEntrySafeForRemoval(root, realCandidate, identity)).toBe(true);
        expect(FileUtil.isManagedEntrySafeForRemoval(root, join(linkParent, 'candidate.log'), identity)).toBe(false);
        expect(FileUtil.isManagedEntrySafeForRemoval(root, join(fileParent, 'candidate.log'), identity)).toBe(false);
        expect(FileUtil.isManagedEntrySafeForRemoval(root, join(root, 'missing', 'candidate.log'), identity)).toBe(
            false,
        );
    });

    it('[RC-9.13/9.14] accepts only an existing non-link directory when directory removal is requested', async () => {
        const root = await temporaryRoot();
        const directory = join(root, 'directory');
        const directoryLink = join(root, 'directory-link');
        const file = join(root, 'file.log');
        await mkdir(directory);
        await symlink(directory, directoryLink, 'dir');
        await writeFile(file, 'file-bytes');
        const identity = FileUtil.captureManagedRootIdentity(root);

        expect(FileUtil.isManagedEntrySafeForRemoval(root, directory, identity, true)).toBe(true);
        expect(FileUtil.isManagedEntrySafeForRemoval(root, directoryLink, identity, true)).toBe(false);
        expect(FileUtil.isManagedEntrySafeForRemoval(root, file, identity, true)).toBe(false);
        expect(FileUtil.isManagedEntrySafeForRemoval(root, join(root, 'missing'), identity, true)).toBe(false);
    });

    it('[RC-9.13/9.14] rejects a non-directory configured root with a stable diagnostic', async () => {
        const parent = await temporaryRoot();
        const fileRoot = join(parent, 'file-root.log');
        await writeFile(fileRoot, 'root-bytes');

        expect(() => FileUtil.captureManagedRootIdentity(fileRoot)).toThrow('ManagedRootIsNotDirectory');
    });
});

describe('recorded drop-log cleanup implementation characterization [RC-6.1]', () => {
    it('[RC-9.14/9.15] returns exact empty candidates and rejects synthetic root and parent entries before inspection', async () => {
        const root = await temporaryRoot();
        const parent = resolve(root, '..');
        injectDirectoryEntries(root, ['.', '..']);
        const actualLstatSync = realFs.lstatSync.bind(realFs);
        const escapedInspections: string[] = [];
        nodeFs.lstatSync.mockImplementation((entryPath: import('node:fs').PathLike) => {
            const normalizedPath = String(entryPath);
            if (normalizedPath === root || normalizedPath === parent) {
                escapedInspections.push(normalizedPath);
                throw new Error('synthetic containment inspection');
            }
            return actualLstatSync(entryPath);
        });

        const list = await FileUtil.getFileList(root);

        expect(list).toEqual({ directories: [], files: [] });
        expect(escapedInspections).toEqual([]);
    });

    it('[RC-9.17] rejects when the root listing throws synchronously instead of leaving the request pending', async () => {
        const root = await temporaryRoot();
        const failure = new Error('synthetic synchronous root listing failure');
        nodeFs.readdir.mockImplementation(() => {
            throw failure;
        });

        const settlement = await observeSettlement(FileUtil.getFileList(root));

        expect(settlement).toBe('rejected');
    });

    it('[RC-9.5/9.6/9.7/9.15] reconciles DB-only, file-only, shared, and dot entries', async () => {
        const root = await temporaryRoot();
        const shared = join(root, 'shared.log');
        const orphan = join(root, 'orphan.log');
        const hiddenFile = join(root, '.hidden.log');
        const hiddenDirectory = join(root, '.hidden-directory');
        await mkdir(hiddenDirectory);
        await Promise.all([
            writeFile(shared, 'shared-log'),
            writeFile(orphan, 'orphan-log'),
            writeFile(hiddenFile, 'hidden-log'),
            writeFile(join(hiddenDirectory, 'hidden-child.log'), 'hidden-child-log'),
        ]);
        const sharedRow: DropLogRow = { filePath: 'shared.log', id: 301 };
        const databaseOnlyRow: DropLogRow = { filePath: 'database-only.log', id: 302 };
        const { relatedIds, rows, target } = cleanupSubject(root, [sharedRow, databaseOnlyRow]);

        await target.dropLogFileCleanup();

        expect([...rows.keys()]).toEqual([sharedRow.id]);
        expect([...relatedIds]).toEqual([sharedRow.id]);
        await expect(readFile(shared, 'utf8')).resolves.toBe('shared-log');
        await expect(stat(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(hiddenFile, 'utf8')).resolves.toBe('hidden-log');
        await expect(readFile(join(hiddenDirectory, 'hidden-child.log'), 'utf8')).resolves.toBe('hidden-child-log');
        expect(target.recordedDB.removeDropLogFileId).toHaveBeenCalledOnce();
        expect(target.recordedDB.removeDropLogFileId).toHaveBeenCalledWith(databaseOnlyRow.id);
        expect(target.dropLogFileDB.deleteOnce).toHaveBeenCalledOnce();
        expect(target.dropLogFileDB.deleteOnce).toHaveBeenCalledWith(databaseOnlyRow.id);
        expect(target.recordedEvent.emitDropLogFileChanged).toHaveBeenCalledOnce();
        expect(target.recordedEvent.emitDropLogFileChanged).toHaveBeenCalledWith(databaseOnlyRow.id);
    });

    it('[RC-9.8] continues the constructed target set after relation and file deletion failures', async () => {
        const root = await temporaryRoot();
        const retainedAfterFailure = join(root, 'first-orphan.log');
        const deletedAfterFailure = join(root, 'second-orphan.log');
        await writeFile(retainedAfterFailure, 'first-log');
        await writeFile(deletedAfterFailure, 'second-log');
        const firstDatabaseOnly: DropLogRow = { filePath: 'first-missing.log', id: 311 };
        const secondDatabaseOnly: DropLogRow = { filePath: 'second-missing.log', id: 312 };
        const { relatedIds, rows, target } = cleanupSubject(root, [firstDatabaseOnly, secondDatabaseOnly]);
        target.recordedDB.removeDropLogFileId.mockImplementation(async (dropLogFileId: number) => {
            if (dropLogFileId === firstDatabaseOnly.id) throw new Error('synthetic relation deletion failure');
            return relatedIds.delete(dropLogFileId);
        });
        const actualUnlink = FileUtil.unlink.bind(FileUtil);
        vi.spyOn(FileUtil, 'unlink').mockImplementation(async filePath => {
            if (filePath === retainedAfterFailure) throw new Error('synthetic file deletion failure');
            await actualUnlink(filePath);
        });

        await target.dropLogFileCleanup();

        expect([...rows.keys()]).toEqual([firstDatabaseOnly.id]);
        expect([...relatedIds]).toEqual([firstDatabaseOnly.id]);
        expect(target.recordedDB.removeDropLogFileId.mock.calls).toEqual([
            [firstDatabaseOnly.id],
            [secondDatabaseOnly.id],
        ]);
        expect(target.dropLogFileDB.deleteOnce).toHaveBeenCalledOnce();
        expect(target.dropLogFileDB.deleteOnce).toHaveBeenCalledWith(secondDatabaseOnly.id);
        expect(target.recordedEvent.emitDropLogFileChanged.mock.calls).toEqual([[secondDatabaseOnly.id]]);
        await expect(readFile(retainedAfterFailure, 'utf8')).resolves.toBe('first-log');
        await expect(stat(deletedAfterFailure)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('[RC-9.8] continues after row deletion fails following completed relation removal', async () => {
        const root = await temporaryRoot();
        const firstDatabaseOnly: DropLogRow = { filePath: 'first-missing.log', id: 321 };
        const secondDatabaseOnly: DropLogRow = { filePath: 'second-missing.log', id: 322 };
        const failure = new Error('synthetic row deletion failure');
        const { relatedIds, rows, target } = cleanupSubject(root, [firstDatabaseOnly, secondDatabaseOnly]);
        target.dropLogFileDB.deleteOnce.mockImplementation(async (dropLogFileId: number) => {
            if (dropLogFileId === firstDatabaseOnly.id) throw failure;
            return rows.delete(dropLogFileId);
        });

        await target.dropLogFileCleanup();

        expect(target.recordedDB.removeDropLogFileId.mock.calls).toEqual([
            [firstDatabaseOnly.id],
            [secondDatabaseOnly.id],
        ]);
        expect(target.dropLogFileDB.deleteOnce.mock.calls).toEqual([[firstDatabaseOnly.id], [secondDatabaseOnly.id]]);
        expect(relatedIds.has(firstDatabaseOnly.id)).toBe(false);
        expect(rows.has(firstDatabaseOnly.id)).toBe(true);
        expect([...relatedIds]).toEqual([]);
        expect([...rows.keys()]).toEqual([firstDatabaseOnly.id]);
        expect(target.recordedEvent.emitDropLogFileChanged.mock.calls).toEqual([
            [firstDatabaseOnly.id],
            [secondDatabaseOnly.id],
        ]);
        expect(target.log.system.error).toHaveBeenCalledWith(failure);
    });

    it('[RC-1.5/RC-9.8] emits no change notification when both cleanup mutations affect zero rows', async () => {
        const root = await temporaryRoot();
        const racedRow: DropLogRow = { filePath: 'concurrently-removed.log', id: 331 };
        const { target } = cleanupSubject(root, [racedRow]);
        target.recordedDB.removeDropLogFileId.mockResolvedValue(false);
        target.dropLogFileDB.deleteOnce.mockResolvedValue(false);

        await target.dropLogFileCleanup();

        expect(target.recordedDB.removeDropLogFileId).toHaveBeenCalledWith(racedRow.id);
        expect(target.dropLogFileDB.deleteOnce).toHaveBeenCalledWith(racedRow.id);
        expect(target.recordedEvent.emitDropLogFileChanged).not.toHaveBeenCalled();
    });

    it('[RC-1.5/RC-9.6] emits one change notification when only the drop-log row deletion is confirmed', async () => {
        const root = await temporaryRoot();
        const rowOnlyChange: DropLogRow = { filePath: 'row-only-change.log', id: 332 };
        const { rows, target } = cleanupSubject(root, [rowOnlyChange]);
        target.recordedDB.removeDropLogFileId.mockResolvedValue(false);

        await target.dropLogFileCleanup();

        expect(target.recordedDB.removeDropLogFileId).toHaveBeenCalledWith(rowOnlyChange.id);
        expect(target.dropLogFileDB.deleteOnce).toHaveBeenCalledWith(rowOnlyChange.id);
        expect([...rows.keys()]).toEqual([]);
        expect(target.recordedEvent.emitDropLogFileChanged).toHaveBeenCalledOnce();
        expect(target.recordedEvent.emitDropLogFileChanged).toHaveBeenCalledWith(rowOnlyChange.id);
    });

    it('[RC-9.16] fails the drop-log cleanup when its managed root cannot be listed', async () => {
        const parent = await temporaryRoot();
        const missingRoot = join(parent, 'missing-drop-log-root');
        const { target } = cleanupSubject(missingRoot, []);

        await expect(target.dropLogFileCleanup()).rejects.toMatchObject({ code: 'ENOENT' });
    });
});

describe('recorded drop-log cleanup implementation [RC-6.2]', () => {
    it('link-dot-entry-and-continue-after-error', async () => {
        const parent = await temporaryRoot();
        const root = join(parent, 'managed');
        const outside = join(parent, 'outside.log');
        const link = join(root, 'external-link.log');
        const hidden = join(root, '.hidden.log');
        const failedDirectory = join(root, 'failed-directory');
        const retainedChild = join(failedDirectory, 'retained.log');
        const independentOrphan = join(root, 'independent-orphan.log');
        const failure = new Error('synthetic subdirectory listing failure');
        await mkdir(failedDirectory, { recursive: true });
        await Promise.all([
            writeFile(outside, 'outside-bytes'),
            writeFile(hidden, 'hidden-bytes'),
            writeFile(retainedChild, 'retained-bytes'),
            writeFile(independentOrphan, 'orphan-bytes'),
            symlink(outside, link, 'file'),
        ]);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        failDirectoryListing(failedDirectory, failure);
        const { target } = cleanupSubject(root, []);

        await target.dropLogFileCleanup();

        expect(consoleError).toHaveBeenCalledWith(
            `failed to enumerate managed subdirectory: ${failedDirectory}`,
            failure,
        );
        await expect(lstat(link)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(outside, 'utf8')).resolves.toBe('outside-bytes');
        await expect(readFile(hidden, 'utf8')).resolves.toBe('hidden-bytes');
        await expect(readFile(retainedChild, 'utf8')).resolves.toBe('retained-bytes');
        await expect(stat(independentOrphan)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('[RC-9.13/9.14] does not follow a drop-log root replaced by an external symlink after enumeration', async () => {
        const parent = await temporaryRoot();
        const root = join(parent, 'managed');
        const displacedRoot = join(parent, '.displaced-root');
        const externalDirectory = join(parent, 'external-directory');
        const listedFile = join(root, 'orphan.log');
        const displacedFile = join(displacedRoot, 'orphan.log');
        const externalFile = join(externalDirectory, 'orphan.log');
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

        await target.dropLogFileCleanup();

        await expect(readFile(externalFile, 'utf8')).resolves.toBe('external-bytes');
        await expect(readFile(displacedFile, 'utf8')).resolves.toBe('managed-bytes');
    });

    it('[RC-9.13/9.14] does not follow a drop-log parent replaced by an external symlink after enumeration', async () => {
        const parent = await temporaryRoot();
        const root = join(parent, 'managed');
        const listedParent = join(root, 'listed-parent');
        const displacedParent = join(root, '.displaced-parent');
        const externalDirectory = join(parent, 'external-directory');
        const listedFile = join(listedParent, 'orphan.log');
        const displacedFile = join(displacedParent, 'orphan.log');
        const externalFile = join(externalDirectory, 'orphan.log');
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

        await target.dropLogFileCleanup();

        await expect(readFile(externalFile, 'utf8')).resolves.toBe('external-bytes');
        await expect(readFile(displacedFile, 'utf8')).resolves.toBe('managed-bytes');
    });

    it('[RC-9.12/9.13] unlinks file, directory, and broken links without changing external targets', async () => {
        const parent = await temporaryRoot();
        const root = join(parent, 'managed');
        const externalFile = join(parent, 'external.log');
        const externalDirectory = join(parent, 'external-directory');
        const externalChild = join(externalDirectory, 'marker.log');
        const fileLink = join(root, 'file-link.log');
        const directoryLink = join(root, 'directory-link');
        const brokenLink = join(root, 'broken-link.log');
        await Promise.all([mkdir(root), mkdir(externalDirectory)]);
        await Promise.all([
            writeFile(externalFile, 'external-file-bytes'),
            writeFile(externalChild, 'external-child-bytes'),
        ]);
        await Promise.all([
            symlink(externalFile, fileLink, 'file'),
            symlink(externalDirectory, directoryLink, 'dir'),
            symlink(join(root, 'missing-target.log'), brokenLink, 'file'),
        ]);
        const { target } = cleanupSubject(root, []);

        const settlement = await observeSettlement(target.dropLogFileCleanup());

        expect(settlement).toBe('fulfilled');
        await Promise.all([
            expect(lstat(fileLink)).rejects.toMatchObject({ code: 'ENOENT' }),
            expect(lstat(directoryLink)).rejects.toMatchObject({ code: 'ENOENT' }),
            expect(lstat(brokenLink)).rejects.toMatchObject({ code: 'ENOENT' }),
        ]);
        await expect(readFile(externalFile, 'utf8')).resolves.toBe('external-file-bytes');
        await expect(readFile(externalChild, 'utf8')).resolves.toBe('external-child-bytes');
    });

    it('[RC-9.17] records a subdirectory failure and a synchronous type-check failure while continuing', async () => {
        const root = await temporaryRoot();
        const failedDirectory = join(root, 'failed-directory');
        const retainedChild = join(failedDirectory, 'retained.log');
        const failedEntry = join(root, 'failed-entry.log');
        const independentOrphan = join(root, 'independent-orphan.log');
        const directoryFailure = new Error('synthetic subdirectory listing failure');
        const typeFailure = new Error('synthetic synchronous type-check failure');
        await mkdir(failedDirectory);
        await Promise.all([
            writeFile(retainedChild, 'retained-bytes'),
            writeFile(failedEntry, 'failed-entry-bytes'),
            writeFile(independentOrphan, 'orphan-bytes'),
        ]);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        failDirectoryListing(failedDirectory, directoryFailure);
        failSynchronousTypeCheck(failedEntry, typeFailure);
        const { target } = cleanupSubject(root, []);

        const settlement = await observeSettlement(target.dropLogFileCleanup());

        expect(settlement).toBe('fulfilled');
        expect(consoleError).toHaveBeenCalledWith(
            `failed to enumerate managed subdirectory: ${failedDirectory}`,
            directoryFailure,
        );
        expect(consoleError).toHaveBeenCalledWith(`failed to inspect managed entry: ${failedEntry}`, typeFailure);
        await expect(readFile(retainedChild, 'utf8')).resolves.toBe('retained-bytes');
        await expect(readFile(failedEntry, 'utf8')).resolves.toBe('failed-entry-bytes');
        await expect(stat(independentOrphan)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('[RC-9.17] excludes an empty subdirectory whose first listing fails from cleanup candidates', async () => {
        const root = await temporaryRoot();
        const failedDirectory = join(root, 'failed-empty-directory');
        const independentOrphan = join(root, 'independent-orphan.log');
        const failure = new Error('synthetic first subdirectory listing failure');
        await mkdir(failedDirectory);
        await writeFile(independentOrphan, 'orphan-bytes');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const failedDirectoryListingCount = failFirstDirectoryListing(failedDirectory, failure);

        const list = await FileUtil.getFileList(root);

        expect(consoleError).toHaveBeenCalledWith(
            `failed to enumerate managed subdirectory: ${failedDirectory}`,
            failure,
        );
        expect(failedDirectoryListingCount()).toBe(1);
        expect(list.directories).not.toContain(failedDirectory);
        expect(list.files).toContain(independentOrphan);
        expect((await stat(failedDirectory)).isDirectory()).toBe(true);
    });
});
