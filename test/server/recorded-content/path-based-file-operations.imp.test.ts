import 'reflect-metadata';

import {
    copyFile,
    link,
    lstat,
    mkdir,
    mkdtemp,
    open,
    readFile,
    readdir,
    realpath,
    rename,
    rm,
    rmdir,
    stat,
    symlink,
    unlink,
    writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
// Windows の drive 付き path は、文字と `:` を別の値にして組み立てる（保存先らしい絶対 path の literal を file に書かない）。
const winDrive = 'C:';
const otherWinDrive = 'D:';
const RecordedManageModel = (
    require(join(snapshot, 'model/operator/recorded/RecordedManageModel.js')) as {
        default: { prototype: Record<string, unknown> };
    }
).default;
const FileUtil = require(join(snapshot, 'util', 'FileUtil.js')).default;

let base: string;
let storage: string;
let outside: string;
let adopted: string;

beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'epgstation-path-based-ops-')));
    storage = join(base, 'storage');
    outside = join(base, 'outside');
    adopted = join(base, 'adopted', 'synthetic-token');
    await Promise.all([mkdir(storage), mkdir(outside), mkdir(adopted, { recursive: true })]);
    await writeFile(join(adopted, 'payload'), 'synthetic-upload-bytes');
});

afterEach(async () => {
    vi.restoreAllMocks();
    await rm(base, { force: true, recursive: true });
});

const realFileSystem = () => ({ copyFile, link, lstat, mkdir, open, realpath, rmdir, stat, unlink });

/** 実file systemへ渡されたpathを記録する。 */
const recordingFileSystem = () => {
    const accessedPaths: string[] = [];
    const record =
        <A extends unknown[], R>(operation: (first: string, ...rest: A) => R) =>
        (first: string, ...rest: A): R => {
            accessedPaths.push(first);
            return operation(first, ...rest);
        };
    const real = realFileSystem();
    const recorded = {
        copyFile: (source: string, destination: string, mode?: number) => {
            accessedPaths.push(destination);
            return real.copyFile(source, destination, mode);
        },
        link: (source: string, destination: string) => {
            accessedPaths.push(destination);
            return real.link(source, destination);
        },
        lstat: record(real.lstat),
        mkdir: record(real.mkdir),
        open: record(real.open),
        realpath: record(real.realpath),
        rmdir: record(real.rmdir),
        stat: record(real.stat),
        unlink: record(real.unlink),
    };
    return { accessedPaths, fileSystem: recorded };
};

const subject = (platform: NodeJS.Platform | undefined, overrides: Record<string, unknown> = {}) => {
    const target: any = Object.create(RecordedManageModel.prototype);
    target.log = { system: { error: vi.fn(), info: vi.fn() } };
    target.recordedDB = { findId: vi.fn(async () => ({ id: 401, thumbnails: [] })) };
    target.videoFileDB = { insertOnce: vi.fn(async () => 412) };
    target.recordedEvent = { emitAddUploadedVideoFile: vi.fn(), emitAddVideoFile: vi.fn() };
    target.videoUtil = { getParentDirPath: vi.fn(() => storage) };
    target.recordingUtilModel = { formatFilePathString: vi.fn(async (value: string) => value) };
    if (typeof platform !== 'undefined') {
        target.uploadPlatform = platform;
    }
    Object.assign(target, overrides);
    return target;
};

const uploadOption = (overrides: Record<string, unknown> = {}) => ({
    fileName: 'name.ts',
    filePath: join(adopted, 'payload'),
    fileType: 'ts',
    parentDirectoryName: 'synthetic-storage',
    recordedId: 401,
    viewName: 'synthetic-view',
    ...overrides,
});

const exists = async (filePath: string): Promise<boolean> =>
    lstat(filePath).then(
        () => true,
        () => false,
    );

describe.each<NodeJS.Platform>(['darwin', 'win32'])(
    '[RC-8.10] deletion on %s (no descriptor-relative path)',
    platform => {
        it('deletes by the checked path directly under the root, in a nested directory, and with a leading separator', async () => {
            await mkdir(join(storage, 'a', 'b'), { recursive: true });
            await Promise.all([
                writeFile(join(storage, 'top.ts'), 'x'),
                writeFile(join(storage, 'a', 'b', 'nested.ts'), 'x'),
                writeFile(join(storage, 'a', 'lead.ts'), 'x'),
            ]);
            const target = subject(platform);
            const unlinkSpy = vi.spyOn(FileUtil, 'unlink');

            await expect(target.removeManagedFile(storage, 'top.ts')).resolves.toBe('removed');
            await expect(target.removeManagedFile(storage, join('a', 'b', 'nested.ts'))).resolves.toBe('removed');
            await expect(target.removeManagedFile(storage, '/a/lead.ts')).resolves.toBe('removed');

            expect(unlinkSpy.mock.calls).toEqual([
                [join(storage, 'top.ts')],
                [join(storage, 'a', 'b', 'nested.ts')],
                [join(storage, 'a', 'lead.ts')],
            ]);
            expect(await readdir(join(storage, 'a', 'b'))).toEqual([]);
            expect(await exists(join(storage, 'top.ts'))).toBe(false);
        });

        it('refuses a path that leaves the root with ".." and leaves the outside file', async () => {
            await writeFile(join(outside, 'secret.ts'), 'x');
            const target = subject(platform);

            await expect(target.removeManagedFile(storage, '../outside/secret.ts')).resolves.toBe('unsafe-path');
            await expect(target.removeManagedFile(storage, '/../outside/secret.ts')).resolves.toBe('unsafe-path');

            expect(await readFile(join(outside, 'secret.ts'), 'utf8')).toBe('x');
        });

        it('refuses a path through a symbolic-link directory that points outside or inside the root', async () => {
            await mkdir(join(storage, 'real'));
            await Promise.all([
                writeFile(join(outside, 'secret.ts'), 'x'),
                writeFile(join(storage, 'real', 'own.ts'), 'x'),
            ]);
            await symlink(outside, join(storage, 'to-outside'));
            await symlink(join(storage, 'real'), join(storage, 'to-inside'));
            const target = subject(platform);

            await expect(target.removeManagedFile(storage, 'to-outside/secret.ts')).resolves.toBe('unsafe-path');
            await expect(target.removeManagedFile(storage, 'to-inside/own.ts')).resolves.toBe('unsafe-path');

            expect(await exists(join(outside, 'secret.ts'))).toBe(true);
            expect(await exists(join(storage, 'real', 'own.ts'))).toBe(true);
        });

        it('removes only the link when the final entry is a symbolic link', async () => {
            await writeFile(join(outside, 'secret.ts'), 'x');
            await symlink(join(outside, 'secret.ts'), join(storage, 'final-link.ts'));
            const target = subject(platform);

            await expect(target.removeManagedFile(storage, 'final-link.ts')).resolves.toBe('removed');

            expect(await exists(join(storage, 'final-link.ts'))).toBe(false);
            expect(await readFile(join(outside, 'secret.ts'), 'utf8')).toBe('x');
        });

        it('refuses a missing parent directory and reports a failed unlink of a missing file', async () => {
            const target = subject(platform);

            await expect(target.removeManagedFile(storage, 'missing/file.ts')).resolves.toBe('unsafe-path');
            await expect(target.removeManagedFile(storage, 'missing-file.ts')).resolves.toBe('unlink-attempt-failed');
        });

        it('refuses to unlink when a directory on the way is swapped for a symbolic link after the parent was opened', async () => {
            await mkdir(join(storage, 'a'));
            await Promise.all([
                writeFile(join(storage, 'a', 'x.ts'), 'x'),
                writeFile(join(outside, 'x.ts'), 'outside'),
            ]);
            const target = subject(platform);
            const original = target.openPinnedDeletionParent.bind(target);
            target.openPinnedDeletionParent = async (...arguments_: unknown[]) => {
                const parent = await original(...arguments_);
                await rename(join(storage, 'a'), join(storage, 'a-moved'));
                await symlink(outside, join(storage, 'a'));
                return parent;
            };

            await expect(target.removeManagedFile(storage, 'a/x.ts')).resolves.toBe('unsafe-path');

            expect(await readFile(join(outside, 'x.ts'), 'utf8')).toBe('outside');
            expect(target.log.system.error).toHaveBeenCalledWith(expect.stringMatching(/refused unsafe deletion: /));
        });

        it('refuses to unlink when a middle directory is swapped for a link to the same directory moved inside the root', async () => {
            await mkdir(join(storage, 'a', 'b'), { recursive: true });
            await writeFile(join(storage, 'a', 'b', 'x.ts'), 'x');
            const target = subject(platform);
            const original = target.openPinnedDeletionParent.bind(target);
            target.openPinnedDeletionParent = async (...arguments_: unknown[]) => {
                const parent = await original(...arguments_);
                await rename(join(storage, 'a'), join(storage, 'a-moved'));
                await symlink(join(storage, 'a-moved'), join(storage, 'a'));
                return parent;
            };

            await expect(target.removeManagedFile(storage, 'a/b/x.ts')).resolves.toBe('unsafe-path');

            expect(await readFile(join(storage, 'a-moved', 'b', 'x.ts'), 'utf8')).toBe('x');
        });
    },
);

describe.each<NodeJS.Platform>(['darwin', 'win32'])(
    '[RC-4.13] upload placement on %s (no descriptor-relative path)',
    platform => {
        it('places the payload by path, creates sub directories, avoids an existing name, and never uses a descriptor path', async () => {
            const target = subject(platform);
            const { accessedPaths, fileSystem } = recordingFileSystem();
            target.uploadFileSystem = fileSystem;
            await mkdir(join(storage, 'existing'));
            await writeFile(join(storage, 'existing', 'name.ts'), 'older');

            await target.addUploadedVideoFile(uploadOption({ subDirectory: 'existing/new' }));
            await mkdir(join(adopted, '..', 'second'));
            await writeFile(join(adopted, '..', 'second', 'payload'), 'second-bytes');
            await target.addUploadedVideoFile(
                uploadOption({ filePath: join(adopted, '..', 'second', 'payload'), subDirectory: 'existing/new' }),
            );
            await mkdir(join(adopted, '..', 'third'));
            await writeFile(join(adopted, '..', 'third', 'payload'), 'third-bytes');
            await target.addUploadedVideoFile(uploadOption({ filePath: join(adopted, '..', 'third', 'payload') }));

            expect(await readFile(join(storage, 'existing', 'new', 'name.ts'), 'utf8')).toBe('synthetic-upload-bytes');
            expect(await readFile(join(storage, 'existing', 'new', 'name(1).ts'), 'utf8')).toBe('second-bytes');
            expect(await readFile(join(storage, 'name.ts'), 'utf8')).toBe('third-bytes');
            expect(await readFile(join(storage, 'existing', 'name.ts'), 'utf8')).toBe('older');
            expect(target.videoFileDB.insertOnce).toHaveBeenCalledTimes(3);
            expect(target.videoFileDB.insertOnce.mock.calls[0][0]).toMatchObject({
                filePath: join('existing', 'new', 'name.ts'),
            });
            expect(accessedPaths.length).toBeGreaterThan(0);
            expect(accessedPaths.filter(value => value.includes('/proc/self/fd') || value.includes('/dev/fd'))).toEqual(
                [],
            );
            expect(await exists(join(adopted, 'payload'))).toBe(false);
        });

        it('rejects a sub directory that is a symbolic link and writes nothing outside the root', async () => {
            await symlink(outside, join(storage, 'linked'));
            const target = subject(platform);

            await expect(target.addUploadedVideoFile(uploadOption({ subDirectory: 'linked/sub' }))).rejects.toThrow(
                'UploadPathError',
            );

            expect(await readdir(outside)).toEqual([]);
            expect(target.videoFileDB.insertOnce).not.toHaveBeenCalled();
        });

        it('rejects ".." in the sub directory and a path separator in the file name', async () => {
            const target = subject(platform);

            await expect(target.addUploadedVideoFile(uploadOption({ subDirectory: '../outside' }))).rejects.toThrow(
                'UploadPathError',
            );
            await expect(target.addUploadedVideoFile(uploadOption({ fileName: '../x.ts' }))).rejects.toThrow(
                'UploadPathError',
            );

            expect(await readdir(outside)).toEqual([]);
        });

        it('refuses to place the file when the sub directory is swapped for a symbolic link after it was prepared', async () => {
            const target = subject(platform);
            const original = target.placeUploadedFile.bind(target);
            target.placeUploadedFile = async (...arguments_: unknown[]) => {
                await rename(join(storage, 'sub'), join(storage, 'sub-moved'));
                await symlink(outside, join(storage, 'sub'));
                return original(...arguments_);
            };

            await expect(target.addUploadedVideoFile(uploadOption({ subDirectory: 'sub' }))).rejects.toThrow(
                'UploadPathError',
            );

            expect(await readdir(outside)).toEqual([]);
            expect(target.videoFileDB.insertOnce).not.toHaveBeenCalled();
            expect(await exists(join(adopted, 'payload'))).toBe(false);
        });

        describe('cleanup after the check found a swap', () => {
            const swapSubDirectory = async () => {
                await rename(join(storage, 'sub'), join(storage, 'sub-moved'));
                await symlink(outside, join(storage, 'sub'));
            };
            const uploadToSub = (target: any) => target.addUploadedVideoFile(uploadOption({ subDirectory: 'sub' }));
            const skippedCleanupLogged = (target: any) =>
                expect(target.log.system.error).toHaveBeenCalledWith(
                    expect.stringMatching(/skipped cleanup of an unverified/),
                );

            beforeEach(async () => {
                await mkdir(join(storage, 'sub'));
                await writeFile(join(outside, 'name.ts'), 'victim');
            });

            it('does not unlink the same name outside the root when the swap is found after the candidate was linked', async () => {
                const target = subject(platform, {
                    uploadFileSystem: {
                        ...realFileSystem(),
                        link: async (source: string, destination: string) => {
                            await link(source, destination);
                            await swapSubDirectory();
                        },
                    },
                });

                await expect(uploadToSub(target)).rejects.toThrow('UploadPathError');

                expect(await readFile(join(outside, 'name.ts'), 'utf8')).toBe('victim');
                skippedCleanupLogged(target);
            });

            it('does not unlink the same name outside the root when a copy fails after the swap', async () => {
                const target = subject(platform, {
                    uploadFileSystem: {
                        ...realFileSystem(),
                        link: async () => Promise.reject(Object.assign(new Error('cross-device'), { code: 'EXDEV' })),
                        copyFile: async (source: string, destination: string, mode?: number) => {
                            await copyFile(source, destination, mode);
                            await swapSubDirectory();
                            throw new Error('synthetic copy failure');
                        },
                    },
                });

                await expect(uploadToSub(target)).rejects.toThrow('FileMoveError');

                expect(await readFile(join(outside, 'name.ts'), 'utf8')).toBe('victim');
                skippedCleanupLogged(target);
            });

            it('does not unlink the same name outside the root when the registration fails after the swap', async () => {
                const target = subject(platform);
                target.videoFileDB.insertOnce = vi.fn(async () => {
                    await swapSubDirectory();
                    throw new Error('synthetic registration failure');
                });

                await expect(uploadToSub(target)).rejects.toThrow('synthetic registration failure');

                expect(await readFile(join(outside, 'name.ts'), 'utf8')).toBe('victim');
                skippedCleanupLogged(target);
            });

            it('still removes its own placed file when the registration fails and the directory is unchanged', async () => {
                const target = subject(platform);
                target.videoFileDB.insertOnce = vi.fn(async () =>
                    Promise.reject(new Error('synthetic registration failure')),
                );

                await expect(uploadToSub(target)).rejects.toThrow('synthetic registration failure');

                expect(await exists(join(storage, 'sub', 'name.ts'))).toBe(false);
                expect(await readFile(join(outside, 'name.ts'), 'utf8')).toBe('victim');
            });
        });
    },
);

describe('[RC-8.10][RC-4.13] the platform that runs the tests (no platform override)', () => {
    it('deletes a nested file, refuses a symbolic-link directory, and places an upload into a new sub directory', async () => {
        await mkdir(join(storage, 'a'));
        await Promise.all([writeFile(join(storage, 'a', 'x.ts'), 'x'), writeFile(join(outside, 'secret.ts'), 'x')]);
        await symlink(outside, join(storage, 'linked'));
        const target = subject(undefined);

        await expect(target.removeManagedFile(storage, '/a/x.ts')).resolves.toBe('removed');
        await expect(target.removeManagedFile(storage, 'linked/secret.ts')).resolves.toBe('unsafe-path');
        await target.addUploadedVideoFile(uploadOption({ subDirectory: 'b/c' }));

        expect(await exists(join(storage, 'a', 'x.ts'))).toBe(false);
        expect(await exists(join(outside, 'secret.ts'))).toBe(true);
        expect(await readFile(join(storage, 'b', 'c', 'name.ts'), 'utf8')).toBe('synthetic-upload-bytes');
        await expect(target.addUploadedVideoFile(uploadOption({ subDirectory: 'linked/d' }))).rejects.toThrow(
            'UploadPathError',
        );
        expect(await readdir(outside)).toEqual(['secret.ts']);
    });
});

describe('[RC-8.10][RC-4.13] Linux keeps the descriptor-relative route', () => {
    it('deletes through the pinned descriptor path without re-checking the path chain', async () => {
        const target = subject('linux');
        const parent = { descriptorPath: '/proc/self/fd/77', close: vi.fn(async () => undefined) };
        target.openPinnedDeletionParent = vi.fn(async () => parent);
        target.assertPinnedUploadDirectory = vi.fn();
        const unlinkSpy = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);

        await expect(target.removeManagedFile(storage, 'x.ts')).resolves.toBe('removed');

        expect(unlinkSpy.mock.calls).toEqual([['/proc/self/fd/77/x.ts']]);
        expect(target.assertPinnedUploadDirectory).not.toHaveBeenCalled();
        expect(parent.close).toHaveBeenCalledOnce();
    });

    it('pins a directory by file descriptor and checks the path chain only when not on Linux', async () => {
        const directoryStats = await stat(storage);
        const handle = {
            fd: 12,
            stat: vi.fn(async () => directoryStats),
            close: vi.fn(async () => undefined),
        };
        const fileSystem = {
            ...realFileSystem(),
            open: vi.fn(async () => handle),
            stat: vi.fn(async () => directoryStats),
            lstat: vi.fn(async () => directoryStats),
            realpath: vi.fn(async (value: string) => value),
        };
        const target = subject('linux', { uploadFileSystem: fileSystem });

        const pinned = await target.openPinnedUploadDirectory(storage, storage);
        await target.confirmDirectoryBeforeMutation(pinned);

        expect(pinned.descriptorPath).toBe('/proc/self/fd/12');
        expect(pinned.boundary).toBe(storage);
        expect(fileSystem.open).toHaveBeenCalledOnce();
        expect(fileSystem.open.mock.calls[0][0]).toBe(storage);
        expect(fileSystem.stat).toHaveBeenCalledWith('/proc/self/fd/12');
        expect(fileSystem.realpath).not.toHaveBeenCalled();
        // 論理pathのlstatは固定時の1回だけで、操作の直前の確認でも増えない
        expect(fileSystem.lstat).toHaveBeenCalledTimes(1);
        await pinned.close();
        expect(handle.close).toHaveBeenCalledOnce();

        target.uploadPlatform = 'darwin';
        await target.confirmDirectoryBeforeMutation(await target.openPinnedUploadDirectory(storage, storage));
        expect(fileSystem.open).toHaveBeenCalledOnce();
        expect(fileSystem.realpath).toHaveBeenCalled();
    });

    it('uses descriptors only on Linux', () => {
        const target = subject(undefined);

        expect(target.usesDescriptorPaths()).toBe(process.platform === 'linux');
        target.uploadPlatform = 'linux';
        expect(target.usesDescriptorPaths()).toBe(true);
        target.uploadPlatform = 'darwin';
        expect(target.usesDescriptorPaths()).toBe(false);
        target.uploadPlatform = 'win32';
        expect(target.usesDescriptorPaths()).toBe(false);
    });
});

describe('path-based directory pinning (no descriptor)', () => {
    it('opens the root and a child by lstat, keeps the boundary, and closes without a handle', async () => {
        await mkdir(join(storage, 'a'));
        const target = subject('darwin');

        const root = await target.openPinnedUploadDirectory(storage, storage);
        const child = await target.openPinnedUploadDirectory(join(storage, 'a'), join(storage, 'a'), root.boundary);

        expect(root.boundary).toBe(storage);
        expect(root.descriptorPath).toBe(storage);
        expect(child.boundary).toBe(storage);
        expect(child.descriptorPath).toBe(join(storage, 'a'));
        await expect(root.close()).resolves.toBeUndefined();
        await expect(child.close()).resolves.toBeUndefined();
    });

    it('maps a missing directory to a path error and rethrows other failures', async () => {
        const target = subject('darwin');
        const permission = Object.assign(new Error('synthetic permission failure'), { code: 'EACCES' });

        await expect(
            target.openPinnedUploadDirectory(join(storage, 'missing'), join(storage, 'missing')),
        ).rejects.toThrow('UploadPathError');
        target.uploadFileSystem = {
            ...realFileSystem(),
            lstat: vi
                .fn()
                .mockRejectedValueOnce(Object.assign(new Error('synthetic not a directory'), { code: 'ENOTDIR' }))
                .mockRejectedValueOnce(permission),
        };
        await expect(target.openPinnedUploadDirectory(storage, storage)).rejects.toThrow('UploadPathError');
        await expect(target.openPinnedUploadDirectory(storage, storage)).rejects.toBe(permission);
    });

    it('refuses a regular file and a symbolic link as a directory', async () => {
        await writeFile(join(storage, 'file'), 'x');
        await symlink(outside, join(storage, 'link'));
        const target = subject('darwin');

        await expect(target.openPinnedUploadDirectory(join(storage, 'file'), join(storage, 'file'))).rejects.toThrow(
            'UploadPathError',
        );
        await expect(target.openPinnedUploadDirectory(join(storage, 'link'), join(storage, 'link'))).rejects.toThrow(
            'UploadPathError',
        );
    });

    it('fails the check when the directory is outside the boundary, a component stops being a directory, or a lookup fails', async () => {
        await mkdir(join(storage, 'a'));
        const target = subject('darwin');
        const pinned = await target.openPinnedUploadDirectory(join(storage, 'a'), join(storage, 'a'), storage);

        await expect(target.openPinnedUploadDirectory(outside, outside, join(storage, 'a'))).rejects.toThrow(
            'UploadPathError',
        );

        await rm(join(storage, 'a'), { recursive: true });
        await writeFile(join(storage, 'a'), 'now a file');
        await expect(target.assertPinnedUploadDirectory(pinned)).rejects.toThrow('UploadPathError');
        await rm(join(storage, 'a'));
        await expect(target.assertPinnedUploadDirectory(pinned)).rejects.toThrow('UploadPathError');
    });

    it('fails the check when a component is a symbolic link or the real path leaves the boundary', async () => {
        await mkdir(join(outside, 'deep'));
        const target = subject('darwin');
        await symlink(outside, join(storage, 'link'));
        const base = await target.openPinnedUploadDirectory(storage, storage);

        // lstatでは通常のdirectoryに見えるがrealpathがrootの外になる状況（lstatの結果を差し替えて再現）
        const leaving = { ...base, logicalPath: join(storage, 'link', 'deep'), boundary: storage };
        await expect(target.assertPathChain(leaving)).rejects.toThrow('UploadPathError');

        const fileSystem = realFileSystem();
        target.uploadFileSystem = {
            ...fileSystem,
            lstat: async (value: string) => fileSystem.lstat(value === join(storage, 'link') ? storage : value),
        };
        await expect(target.assertPathChain(leaving)).rejects.toThrow('UploadPathError');
    });

    it('lists the components from the boundary to the directory, for POSIX and Windows paths', () => {
        const target = subject('darwin');

        expect(target.getPathChain('/s', '/s')).toEqual(['/s']);
        expect(target.getPathChain('/s', '/s/a/b')).toEqual(['/s', '/s/a', '/s/a/b']);
        expect(target.getPathChain('/s', '/s/../x')).toBeUndefined();
        expect(target.getPathChain('/s/a', '/s')).toBeUndefined();
        expect(target.getPathChain('/s', '/other')).toBeUndefined();
        expect(target.getPathChain('/s', '/s/a/..', posix)).toEqual(['/s']);
        const root = `${winDrive}\\s`;
        expect(target.getPathChain(root, `${root}\\a\\b`, win32)).toEqual([root, `${root}\\a`, `${root}\\a\\b`]);
        expect(target.getPathChain(root, root, win32)).toEqual([root]);
        expect(target.getPathChain(root, `${root}\\..\\x`, win32)).toBeUndefined();
        expect(target.getPathChain(root, `${root}x`, win32)).toBeUndefined();
        expect(target.getPathChain(root, `${otherWinDrive}\\s\\a`, win32)).toBeUndefined();
        expect(target.getPathChain(root, '\\\\server\\share\\a', win32)).toBeUndefined();
    });
});
