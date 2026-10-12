import 'reflect-metadata';

import { constants } from 'node:fs';
import {
    copyFile,
    link,
    lstat,
    mkdir,
    mkdtemp,
    open,
    readdir,
    readFile,
    realpath,
    rm,
    rmdir,
    stat,
    unlink,
    writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RecordedManageModel = (
    require(join(snapshot, 'model/operator/recorded/RecordedManageModel.js')) as {
        default: { prototype: Record<string, unknown> };
    }
).default;

let base: string;
let storage: string;
let adopted: string;
let payload: string;

beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'epgstation-upload-fault-'));
    storage = join(base, 'storage');
    adopted = join(base, 'adopted', 'synthetic-token');
    payload = join(adopted, 'payload');
    await mkdir(storage);
    await mkdir(adopted, { recursive: true });
    await writeFile(payload, 'synthetic-upload-bytes');
});

afterEach(async () => {
    await rm(base, { force: true, recursive: true });
});

const realFileSystem = { copyFile, link, lstat, mkdir, open, realpath, rmdir, stat, unlink };

const subject = (fileSystem: Record<string, unknown> = {}) => {
    const target: any = Object.create(RecordedManageModel.prototype);
    target.log = { system: { error: vi.fn(), info: vi.fn() } };
    target.recordedDB = { findId: vi.fn(async () => ({ id: 401, thumbnails: [] })) };
    target.videoFileDB = { insertOnce: vi.fn(async () => 412) };
    target.recordedEvent = { emitAddUploadedVideoFile: vi.fn(), emitAddVideoFile: vi.fn() };
    target.videoUtil = { getParentDirPath: vi.fn(() => storage) };
    target.recordingUtilModel = { formatFilePathString: vi.fn(async (value: string) => value) };
    target.uploadFileSystem = { ...realFileSystem, ...fileSystem };
    return target;
};

const option = (overrides: Record<string, unknown> = {}) => ({
    fileName: 'name.ts',
    filePath: payload,
    fileType: 'ts',
    parentDirectoryName: 'synthetic-storage',
    recordedId: 401,
    viewName: 'synthetic-view',
    ...overrides,
});

const codeError = (code: string): Error => Object.assign(new Error(`synthetic-${code}`), { code });

describe('[RC-10.2] upload file move failures', () => {
    it('reports a link failure other than exists or cross-device as a move error, logs its cause, and cleans the adopted payload', async () => {
        const failure = codeError('EACCES');
        const target = subject({ link: vi.fn(async () => Promise.reject(failure)) });

        await expect(target.addUploadedVideoFile(option())).rejects.toMatchObject({
            cause: failure,
            message: 'FileMoveError',
        });

        expect(target.log.system.error).toHaveBeenCalledWith('move file error');
        expect(target.log.system.error).toHaveBeenCalledWith(failure);
        expect(await readdir(storage)).toEqual([]);
        await expect(stat(payload)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(target.videoFileDB.insertOnce).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitAddVideoFile).not.toHaveBeenCalled();
    });

    it('treats a link failure that is not an Error object as a move error', async () => {
        const target = subject({ link: vi.fn(async () => Promise.reject('synthetic-text-failure')) });

        await expect(target.addUploadedVideoFile(option())).rejects.toMatchObject({
            cause: 'synthetic-text-failure',
            message: 'FileMoveError',
        });
    });

    it('copies exclusively when linking crosses devices, then removes the source', async () => {
        const copy = vi.fn(copyFile);
        const target = subject({ copyFile: copy, link: vi.fn(async () => Promise.reject(codeError('EXDEV'))) });

        await target.addUploadedVideoFile(option());

        expect(copy).toHaveBeenCalledTimes(1);
        expect(copy).toHaveBeenCalledWith(payload, expect.stringMatching(/\/name\.ts$/u), constants.COPYFILE_EXCL);
        expect(await readFile(join(storage, 'name.ts'), 'utf8')).toBe('synthetic-upload-bytes');
        await expect(stat(payload)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('moves on to the next numbered candidate when the copy target already exists', async () => {
        const copy = vi.fn(async (source: string, destination: string, mode?: number) => {
            if (destination.endsWith('name.ts')) throw codeError('EEXIST');
            return copyFile(source, destination, mode);
        });
        const target = subject({ copyFile: copy, link: vi.fn(async () => Promise.reject(codeError('EXDEV'))) });

        await target.addUploadedVideoFile(option());

        expect(copy).toHaveBeenCalledTimes(2);
        expect(await readdir(storage)).toEqual(['name(1).ts']);
    });

    it('removes the partial copy and reports a move error when copying fails, even if removing the partial copy also fails', async () => {
        const failure = codeError('EIO');
        const unlinkCalls: string[] = [];
        const target = subject({
            copyFile: vi.fn(async () => Promise.reject(failure)),
            link: vi.fn(async () => Promise.reject(codeError('EXDEV'))),
            unlink: vi.fn(async (path: string) => {
                unlinkCalls.push(path);
                if (path.endsWith('name.ts')) throw codeError('EPERM');
                return unlink(path);
            }),
        });

        await expect(target.addUploadedVideoFile(option())).rejects.toMatchObject({
            cause: failure,
            message: 'FileMoveError',
        });

        expect(unlinkCalls.some(path => path.endsWith('/name.ts'))).toBe(true);
        expect(target.log.system.error).toHaveBeenCalledWith(failure);
    });

    it('stops with a candidate limit error when every numbered candidate already exists', async () => {
        const linkCalls = vi.fn(async () => Promise.reject(codeError('EEXIST')));
        const target = subject({ link: linkCalls });

        await expect(target.addUploadedVideoFile(option())).rejects.toThrow('UploadCandidateLimitError');

        expect(linkCalls).toHaveBeenCalledTimes(10_000);
        await expect(stat(payload)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('removes the placed candidate and reports a move error when the source cannot be removed after linking', async () => {
        const failure = codeError('EIO');
        const target = subject({
            unlink: vi.fn(async (path: string) => {
                if (path === payload) throw failure;
                return unlink(path);
            }),
        });

        await expect(target.addUploadedVideoFile(option())).rejects.toMatchObject({
            cause: failure,
            message: 'FileMoveError',
        });

        expect(await readdir(storage)).toEqual([]);
        expect(await readFile(payload, 'utf8')).toBe('synthetic-upload-bytes');
    });
    it('logs a move error raised without a cause by the registration step using the error itself', async () => {
        const failure = new Error('FileMoveError');
        const target = subject();
        target.videoFileDB.insertOnce = vi.fn(async () => Promise.reject(failure));

        await expect(target.addUploadedVideoFile(option())).rejects.toBe(failure);

        // 登録段階の log のあとに、move error の log が元の error 自身で続く。
        expect(target.log.system.error.mock.calls).toEqual([
            ['failed to add video: synthetic-storage/name.ts'],
            [failure],
            ['move file error'],
            [failure],
        ]);
        expect(await readdir(storage)).toEqual([]);
    });

    it('rejects and closes the opened descriptor when the opened path is not a directory', async () => {
        const closes: number[] = [];
        const target = subject({
            open: vi.fn(async (path: string, flags: number) => {
                const handle = await open(path, flags);
                return {
                    close: async () => {
                        closes.push(handle.fd);
                        await handle.close();
                    },
                    fd: handle.fd,
                    // 識別子は実物のまま、directoryでないことだけを偽る。
                    stat: async () => {
                        const real = await handle.stat();
                        return new Proxy(real, {
                            get: (stats, property) =>
                                property === 'isDirectory' ? () => false : Reflect.get(stats, property),
                        });
                    },
                };
            }),
        });

        await expect(target.addUploadedVideoFile(option())).rejects.toThrow('UploadPathError');

        expect(closes).toHaveLength(1);
        expect(target.videoFileDB.insertOnce).not.toHaveBeenCalled();
    });
});

describe('[RC-10.2] upload destination identity checks', () => {
    // 保存先directoryを論理pathで見たとき、n回目の検査からだけ差し替えられたように見せる。
    const swappedAfter = (calls: number, replace: (real: Awaited<ReturnType<typeof lstat>>) => unknown) => {
        let seen = 0;
        return vi.fn(async (path: string) => {
            const real = await lstat(path);
            if (path !== (await realpath(storage))) return real;
            seen += 1;
            return seen > calls ? replace(real) : real;
        });
    };

    it('removes the placed candidate and rejects when the destination no longer has the opened identity', async () => {
        const target = subject({
            lstat: swappedAfter(1, real => ({ dev: real.dev, ino: real.ino + 1, isDirectory: () => true })),
        });

        await expect(target.addUploadedVideoFile(option())).rejects.toThrow('UploadPathError');

        expect(await readdir(storage)).toEqual([]);
        expect(target.videoFileDB.insertOnce).not.toHaveBeenCalled();
    });

    it('rejects when the destination is no longer a directory', async () => {
        const target = subject({
            lstat: swappedAfter(1, real => ({ dev: real.dev, ino: real.ino, isDirectory: () => false })),
        });

        await expect(target.addUploadedVideoFile(option())).rejects.toThrow('UploadPathError');

        expect(await readdir(storage)).toEqual([]);
    });

    it('rejects when the identity differs on the logical side (device) or the descriptor side (inode)', async () => {
        const logical = subject({
            lstat: swappedAfter(1, real => ({ dev: real.dev + 1, ino: real.ino, isDirectory: () => true })),
        });
        await expect(logical.addUploadedVideoFile(option())).rejects.toThrow('UploadPathError');

        await mkdir(adopted, { recursive: true });
        await writeFile(payload, 'synthetic-upload-bytes');
        let statCalls = 0;
        const descriptor = subject({
            stat: vi.fn(async (path: string) => {
                const real = await stat(path);
                if (!path.startsWith('/proc/self/fd/')) return real;
                statCalls += 1;
                return statCalls > 2 ? { dev: real.dev, ino: real.ino + 1, isDirectory: () => true } : real;
            }),
        });
        await expect(descriptor.addUploadedVideoFile(option())).rejects.toThrow('UploadPathError');
        expect(await readdir(storage)).toEqual([]);
    });

    it('rejects when the destination cannot be inspected', async () => {
        const failure = codeError('EIO');
        let seen = 0;
        const target = subject({
            lstat: vi.fn(async (path: string) => {
                if (path === (await realpath(storage))) {
                    seen += 1;
                    if (seen > 1) throw failure;
                }
                return lstat(path);
            }),
        });

        await expect(target.addUploadedVideoFile(option())).rejects.toThrow('UploadPathError');

        expect(await readdir(storage)).toEqual([]);
    });
});

describe('[RC-10.2] upload file name and directory handling', () => {
    it.each(['', '.', '..', 'a/b', 'a\\b'])('rejects the file name %j without placing anything', async fileName => {
        const target = subject();

        await expect(target.addUploadedVideoFile(option({ fileName }))).rejects.toThrow('UploadPathError');

        expect(await readdir(storage)).toEqual([]);
    });

    it('rejects a file name whose extension alone exceeds the name limit', async () => {
        const target = subject();

        await expect(target.addUploadedVideoFile(option({ fileName: `a.${'b'.repeat(260)}` }))).rejects.toThrow(
            'UploadPathError',
        );

        expect(await readdir(storage)).toEqual([]);
    });

    it('truncates a long multibyte name on a character boundary within the byte limit', async () => {
        const target = subject();

        await target.addUploadedVideoFile(option({ fileName: `${'あ'.repeat(100)}.ts` }));

        const [placed] = await readdir(storage);
        expect(placed).toBe(`${'あ'.repeat(84)}.ts`);
        expect(Buffer.byteLength(placed)).toBe(255);
    });

    it('keeps an adopted token directory whose payload is not named payload', async () => {
        const other = join(adopted, 'other.bin');
        await writeFile(other, 'synthetic-other-bytes');
        const target = subject();

        await target.addUploadedVideoFile(option({ filePath: other }));

        expect(await readFile(join(storage, 'name.ts'), 'utf8')).toBe('synthetic-other-bytes');
        expect(await readdir(adopted)).toEqual(['payload']);
    });

    it('logs and absorbs a failure to close the pinned directory after a successful upload', async () => {
        const closeFailure = codeError('EIO');
        const target = subject({
            open: vi.fn(async (path: string, flags: number) => {
                const handle = await open(path, flags);
                return {
                    close: async () => {
                        await handle.close();
                        throw closeFailure;
                    },
                    fd: handle.fd,
                    stat: () => handle.stat(),
                };
            }),
        });

        await expect(target.addUploadedVideoFile(option())).resolves.toBeUndefined();

        expect(target.log.system.error).toHaveBeenCalledWith('failed to close pinned upload directory');
        expect(target.log.system.error).toHaveBeenCalledWith(closeFailure);
        expect(await readFile(join(storage, 'name.ts'), 'utf8')).toBe('synthetic-upload-bytes');
    });

    it('propagates a directory creation failure other than already-exists and closes the opened parent', async () => {
        const failure = codeError('EACCES');
        const closes: string[] = [];
        const target = subject({
            mkdir: vi.fn(async () => Promise.reject(failure)),
            open: vi.fn(async (path: string, flags: number) => {
                const handle = await open(path, flags);
                return {
                    close: async () => {
                        closes.push(path);
                        await handle.close();
                    },
                    fd: handle.fd,
                    stat: () => handle.stat(),
                };
            }),
        });

        await expect(target.addUploadedVideoFile(option({ subDirectory: 'nested' }))).rejects.toBe(failure);

        expect(closes).toHaveLength(1);
        expect(await readdir(storage)).toEqual([]);
    });

    it('propagates an open failure that is not a path error unchanged', async () => {
        const failure = codeError('EACCES');
        const target = subject({ open: vi.fn(async () => Promise.reject(failure)) });

        await expect(target.addUploadedVideoFile(option())).rejects.toBe(failure);

        expect(target.videoFileDB.insertOnce).not.toHaveBeenCalled();
    });

    it('treats a rejection that is not an Error object like an unknown failure', async () => {
        const target = subject({ open: vi.fn(async () => Promise.reject('synthetic-text-failure')) });

        await expect(target.addUploadedVideoFile(option())).rejects.toBe('synthetic-text-failure');
    });
});
