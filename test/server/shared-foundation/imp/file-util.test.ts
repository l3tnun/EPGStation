import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required to resolve server foundation evidence');
}

interface ManagedRootIdentity {
    readonly entryDevice: number;
    readonly entryInode: number;
    readonly entryIsSymbolicLink: boolean;
    readonly targetDevice: number;
    readonly targetInode: number;
}

interface FileUtilModule {
    unlink: (filePath: string) => Promise<void>;
    mkdir: (dirPath: string) => Promise<void>;
    stat: (filePath: string) => Promise<{ size: number }>;
    getFileSize: (filePath: string) => Promise<number>;
    readDir: (dirPath: string) => Promise<string[]>;
    readFile: (filePath: string) => Promise<string>;
    writeFile: (filePath: string, data: string) => Promise<void>;
    rename: (src: string, dest: string) => Promise<void>;
    copyFile: (src: string, dest: string) => Promise<void>;
    move: (src: string, dest: string) => Promise<void>;

    touchFile: (file: string) => Promise<void>;
    appendFile: (file: string, str: string) => Promise<void>;
    isEmptyDirectory: (dir: string) => Promise<boolean>;
    rmdir: (dir: string) => Promise<void>;
    captureManagedRootIdentity: (managedRoot: string) => ManagedRootIdentity;
    isManagedEntrySafeForRemoval: (
        managedRoot: string,
        entryPath: string,
        expectedRoot: ManagedRootIdentity,
        expectedDirectory?: boolean,
    ) => boolean;
    getFileList: (fileDir: string) => Promise<{ files: string[]; directories: string[] }>;
}

async function loadFileUtil(): Promise<FileUtilModule> {
    const moduleUrl = pathToFileURL(join(compiledSnapshot!, 'util', 'FileUtil.js'));
    const { default: FileUtil } = (await import(moduleUrl.href)) as { default: FileUtilModule };
    return FileUtil;
}

describe('[IMP-CHAR-SF-5] FileUtil file operation success and failure', () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'shared-foundation-file-util-'));
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it('writes then reads back the same UTF-8 content', async () => {
        const FileUtil = await loadFileUtil();
        const target = join(root, 'a.txt');

        await FileUtil.writeFile(target, 'synthetic-content');

        await expect(FileUtil.readFile(target)).resolves.toBe('synthetic-content');
    });

    it('rejects writing a file whose parent directory does not exist', async () => {
        const FileUtil = await loadFileUtil();
        const target = join(root, 'missing-parent', 'a.txt');

        await expect(FileUtil.writeFile(target, 'synthetic-content')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('rejects copying a file whose source does not exist', async () => {
        const FileUtil = await loadFileUtil();

        await expect(
            FileUtil.copyFile(join(root, 'missing-src.txt'), join(root, 'copy-dest.txt')),
        ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('rejects reading a file that does not exist', async () => {
        const FileUtil = await loadFileUtil();

        await expect(FileUtil.readFile(join(root, 'missing.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('unlinks an existing file and rejects unlinking it again', async () => {
        const FileUtil = await loadFileUtil();
        const target = join(root, 'b.txt');
        await FileUtil.writeFile(target, '');

        await expect(FileUtil.unlink(target)).resolves.toBeUndefined();
        await expect(FileUtil.unlink(target)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('reports getFileSize as "FileIsNotFound" for a missing file, not the raw fs error', async () => {
        const FileUtil = await loadFileUtil();

        await expect(FileUtil.getFileSize(join(root, 'missing.txt'))).rejects.toThrowError('FileIsNotFound');
    });

    it('returns the byte length written for an existing file', async () => {
        const FileUtil = await loadFileUtil();
        const target = join(root, 'c.txt');
        await FileUtil.writeFile(target, 'abcde');

        await expect(FileUtil.getFileSize(target)).resolves.toBe(5);
    });

    it('creates nested directories recursively via mkdir', async () => {
        const FileUtil = await loadFileUtil();
        const nested = join(root, 'x', 'y', 'z');

        await FileUtil.mkdir(nested);

        await expect(FileUtil.isEmptyDirectory(nested)).resolves.toBe(true);
    });

    it('rejects isEmptyDirectory for a directory that does not exist', async () => {
        const FileUtil = await loadFileUtil();

        await expect(FileUtil.isEmptyDirectory(join(root, 'missing-dir'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('appends to an existing file instead of overwriting it', async () => {
        const FileUtil = await loadFileUtil();
        const target = join(root, 'd.txt');
        await FileUtil.writeFile(target, 'first-');
        await FileUtil.appendFile(target, 'second');

        await expect(FileUtil.readFile(target)).resolves.toBe('first-second');
    });

    it('rejects appending to a file whose parent directory does not exist', async () => {
        const FileUtil = await loadFileUtil();
        const target = join(root, 'missing-parent', 'd.txt');

        await expect(FileUtil.appendFile(target, 'second')).rejects.toBeInstanceOf(Error);
    });

    it('touchFile creates an empty file even when one already has content', async () => {
        const FileUtil = await loadFileUtil();
        const target = join(root, 'e.txt');
        await FileUtil.writeFile(target, 'will-be-cleared');

        await FileUtil.touchFile(target);

        await expect(FileUtil.readFile(target)).resolves.toBe('');
    });

    it('rejects touchFile when the parent directory does not exist', async () => {
        const FileUtil = await loadFileUtil();
        const target = join(root, 'missing-parent', 'e.txt');

        await expect(FileUtil.touchFile(target)).rejects.toBeInstanceOf(Error);
    });

    it('renames an existing file so the content is readable at the destination path', async () => {
        // Requirement 4 AC1 / Task 4: public FileUtil.rename success — destination readable,
        // source absent. Residual portfolio seam: exact five statements on rename success path.
        const FileUtil = await loadFileUtil();
        const src = join(root, 'rename-src.txt');
        const dest = join(root, 'rename-dest.txt');
        await FileUtil.writeFile(src, 'renamed-content');

        await expect(FileUtil.rename(src, dest)).resolves.toBeUndefined();

        await expect(FileUtil.readFile(dest)).resolves.toBe('renamed-content');
        await expect(FileUtil.readFile(src)).rejects.toBeInstanceOf(Error);
    });

    it('rejects rename when the source path is missing and leaves destination absent', async () => {
        // Task 4 rename failure: exported rename rejects; no destination content is created.
        const FileUtil = await loadFileUtil();
        const src = join(root, 'rename-missing-src.txt');
        const dest = join(root, 'rename-missing-dest.txt');

        await expect(FileUtil.rename(src, dest)).rejects.toBeInstanceOf(Error);
        await expect(FileUtil.readFile(dest)).rejects.toBeInstanceOf(Error);
        await expect(FileUtil.readFile(src)).rejects.toBeInstanceOf(Error);
    });

    it('moves a file by copying then deleting the source, leaving no source behind', async () => {
        const FileUtil = await loadFileUtil();
        const src = join(root, 'src.txt');
        const dest = join(root, 'dest.txt');
        await FileUtil.writeFile(src, 'moved-content');

        await FileUtil.move(src, dest);

        await expect(FileUtil.readFile(dest)).resolves.toBe('moved-content');
        await expect(FileUtil.readFile(src)).rejects.toBeInstanceOf(Error);
    });

    it('move cleans up a partially-written destination and retains the source when the copy fails', async () => {
        const FileUtil = await loadFileUtil();
        const src = join(root, 'move-src.txt');
        const dest = join(root, 'move-dest.txt');
        await FileUtil.writeFile(src, 'source-content');

        // Force a copy failure *after* dest has been (partially) written, so the failure path
        // actually has something to clean up -- a missing/unreadable src fails before dest exists
        // and never exercises FileUtil.ts's `unlink(dest).catch(() => {})` cleanup line at all.
        const copySpy = vi.spyOn(FileUtil, 'copyFile').mockImplementation(async (_copySrc, copyDest) => {
            await FileUtil.writeFile(copyDest, 'partially-written');
            throw new Error('synthetic-copy-failure');
        });

        try {
            await expect(FileUtil.move(src, dest)).rejects.toBeInstanceOf(Error);
        } finally {
            copySpy.mockRestore();
        }

        await expect(FileUtil.readFile(dest)).rejects.toBeInstanceOf(Error);
        await expect(FileUtil.readFile(src)).resolves.toBe('source-content');
    });

    it('move retains the copy failure when destination cleanup also fails', async () => {
        const FileUtil = await loadFileUtil();
        const src = join(root, 'move-cleanup-src.txt');
        const dest = join(root, 'move-cleanup-dest.txt');
        const copyFailure = new Error('synthetic-copy-failure');
        const cleanupFailure = new Error('synthetic-cleanup-failure');
        await FileUtil.writeFile(src, 'source-content');

        const copySpy = vi.spyOn(FileUtil, 'copyFile').mockImplementation(async (_copySrc, copyDest) => {
            await FileUtil.writeFile(copyDest, 'partially-written');
            throw copyFailure;
        });
        const unlinkSpy = vi.spyOn(FileUtil, 'unlink').mockRejectedValue(cleanupFailure);

        try {
            await expect(FileUtil.move(src, dest)).rejects.toBe(copyFailure);
        } finally {
            unlinkSpy.mockRestore();
            copySpy.mockRestore();
        }

        await expect(FileUtil.readFile(src)).resolves.toBe('source-content');
        await expect(FileUtil.readFile(dest)).resolves.toBe('partially-written');
    });

    it('lists files and directories recursively under a root, ignoring dotfiles', async () => {
        const FileUtil = await loadFileUtil();
        await FileUtil.mkdir(join(root, 'sub'));
        await FileUtil.writeFile(join(root, 'top.txt'), '');
        await FileUtil.writeFile(join(root, 'sub', 'nested.txt'), '');
        await FileUtil.writeFile(join(root, '.hidden'), '');

        const list = await FileUtil.getFileList(root);

        expect(list.files.sort()).toEqual([join(root, 'sub', 'nested.txt'), join(root, 'top.txt')].sort());
        expect(list.directories).toEqual([join(root, 'sub')]);
    });

    it('rmdir removes an empty directory and rejects removing it again', async () => {
        const FileUtil = await loadFileUtil();
        const dir = join(root, 'empty-dir');
        await FileUtil.mkdir(dir);

        await expect(FileUtil.rmdir(dir)).resolves.toBeUndefined();
        await expect(FileUtil.rmdir(dir)).rejects.toBeInstanceOf(Error);
    });
});

describe('[IMP-CHAR-SF-5] FileUtil managed root safety', () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'shared-foundation-file-util-managed-'));
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it('treats a direct child of the captured managed root as safe for removal', async () => {
        const FileUtil = await loadFileUtil();
        const identity = FileUtil.captureManagedRootIdentity(root);
        const target = join(root, 'child.txt');
        await FileUtil.writeFile(target, '');

        expect(FileUtil.isManagedEntrySafeForRemoval(root, target, identity)).toBe(true);
    });

    it('rejects a path outside the managed root', async () => {
        const FileUtil = await loadFileUtil();
        const identity = FileUtil.captureManagedRootIdentity(root);
        const outside = join(root, '..', 'outside.txt');

        expect(FileUtil.isManagedEntrySafeForRemoval(root, outside, identity)).toBe(false);
    });

    it('rejects the managed root itself (empty relative path)', async () => {
        const FileUtil = await loadFileUtil();
        const identity = FileUtil.captureManagedRootIdentity(root);

        expect(FileUtil.isManagedEntrySafeForRemoval(root, root, identity)).toBe(false);
    });

    it('rejects when the expected root identity belongs to a different directory', async () => {
        const FileUtil = await loadFileUtil();
        const otherRoot = await mkdtemp(join(tmpdir(), 'shared-foundation-file-util-managed-other-'));
        try {
            const otherIdentity = FileUtil.captureManagedRootIdentity(otherRoot);
            const target = join(root, 'child.txt');
            await FileUtil.writeFile(target, '');

            expect(FileUtil.isManagedEntrySafeForRemoval(root, target, otherIdentity)).toBe(false);
        } finally {
            await rm(otherRoot, { recursive: true, force: true });
        }
    });
});
