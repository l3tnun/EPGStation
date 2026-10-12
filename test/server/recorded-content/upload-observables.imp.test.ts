import 'reflect-metadata';

import {
    copyFile,
    link,
    lstat,
    mkdir,
    mkdtemp,
    open,
    readdir,
    realpath,
    rm,
    rmdir,
    stat,
    unlink,
    writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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
    base = await mkdtemp(join(tmpdir(), 'epgstation-upload-observables-'));
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

const subject = (
    fileSystem: Record<string, unknown> = {},
    recorded: Record<string, unknown> = { id: 401, thumbnails: [] },
) => {
    const target: any = Object.create(RecordedManageModel.prototype);
    target.log = { system: { error: vi.fn(), info: vi.fn() } };
    target.recordedDB = { findId: vi.fn(async () => recorded) };
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

describe('[RC-10.2] upload without a sub directory and with the thumbnail state', () => {
    it('does not format a sub directory when none was requested', async () => {
        const target = subject();

        await target.addUploadedVideoFile(option());

        expect(target.recordingUtilModel.formatFilePathString).not.toHaveBeenCalled();
        expect(await readdir(storage)).toEqual(['name.ts']);
    });

    it.each([
        ['has no thumbnail list', { id: 401 }, true],
        ['has an empty thumbnail list', { id: 401, thumbnails: [] }, true],
        ['already has a thumbnail', { id: 401, thumbnails: [{ id: 1 }] }, false],
    ])('tells whether a thumbnail is still needed when the recorded %s', async (_label, recorded, needsThumbnail) => {
        const target = subject({}, recorded);

        await target.addUploadedVideoFile(option());

        expect(target.recordedEvent.emitAddUploadedVideoFile).toHaveBeenCalledExactlyOnceWith(412, needsThumbnail);
    });

    it('places the file directly in the storage when the formatted sub directory is empty', async () => {
        const target = subject();

        await target.addUploadedVideoFile(option({ subDirectory: '' }));

        expect(await readdir(storage)).toEqual(['name.ts']);
    });

    it.each([
        ['a current directory segment', 'a/./b'],
        ['a parent directory segment', 'a/../b'],
        ['an empty segment', 'a//b'],
        ['a leading separator', '/a'],
        ['a backslash', 'a\\b'],
    ])('rejects a sub directory with %s and creates nothing', async (_label, subDirectory) => {
        const target = subject();

        await expect(target.addUploadedVideoFile(option({ subDirectory }))).rejects.toThrow('UploadPathError');

        expect(await readdir(storage)).toEqual([]);
    });
});

describe('[RC-10.2] upload directory pinning failures', () => {
    it.each(['ELOOP', 'ENOENT', 'ENOTDIR'])(
        'reports an %s while opening the storage as an upload path error',
        async code => {
            const failure = codeError(code);
            const target = subject({ open: vi.fn(async () => Promise.reject(failure)) });

            await expect(target.addUploadedVideoFile(option())).rejects.toMatchObject({
                cause: failure,
                message: 'UploadPathError',
            });
        },
    );

    it('rethrows other failures while opening the storage unchanged', async () => {
        const failure = codeError('EACCES');
        const target = subject({ open: vi.fn(async () => Promise.reject(failure)) });

        await expect(target.addUploadedVideoFile(option())).rejects.toBe(failure);
    });

    it('rejects the storage when the directory device differs from the one that was opened', async () => {
        const target = subject({
            stat: vi.fn(async (path: string) => {
                const stats = await stat(path);
                return path.startsWith('/proc/self/fd/')
                    ? Object.create(stats, { dev: { value: stats.dev + 1 } })
                    : stats;
            }),
        });

        await expect(target.addUploadedVideoFile(option())).rejects.toThrow('UploadPathError');

        expect(await readdir(storage)).toEqual([]);
    });
});

describe('[RC-10.2] upload on a platform without descriptor paths', () => {
    it.each(['ENOENT', 'ENOTDIR'])(
        'reports %s from the directory check as an upload path error with its cause',
        async code => {
            const failure = codeError(code);
            const target = subject({
                lstat: vi.fn(async (path: string) => (path === storage ? Promise.reject(failure) : lstat(path))),
            });
            target.uploadPlatform = 'darwin';

            await expect(target.addUploadedVideoFile(option())).rejects.toMatchObject({
                cause: failure,
                message: 'UploadPathError',
            });
        },
    );

    it('rethrows other failures from the directory check unchanged', async () => {
        const failure = codeError('EACCES');
        const target = subject({
            lstat: vi.fn(async (path: string) => (path === storage ? Promise.reject(failure) : lstat(path))),
        });
        target.uploadPlatform = 'darwin';

        await expect(target.addUploadedVideoFile(option())).rejects.toBe(failure);
    });
});

describe('[RC-10.2] upload cleanup bookkeeping', () => {
    it('closes a pinned directory once however many times it is closed', async () => {
        const closes: ReturnType<typeof vi.fn>[] = [];
        const target = subject({
            open: vi.fn(async (path: string, flags: number) => {
                const handle = await open(path, flags);
                const close = vi.fn(handle.close.bind(handle));
                closes.push(close);
                handle.close = close;
                return handle;
            }),
        });

        const directory = await target.openPinnedUploadDirectory(storage, storage);
        const first = directory.close();
        const second = directory.close();
        await Promise.all([first, second]);

        expect(second).toBe(first);
        expect(closes).toHaveLength(1);
        expect(closes[0]).toHaveBeenCalledOnce();
    });

    it('tries to remove the uploaded source only once even when a later step fails', async () => {
        const unlinkMock = vi.fn(unlink);
        const target = subject({ unlink: unlinkMock });
        target.videoFileDB.insertOnce.mockRejectedValue(new Error('synthetic-insert-failure'));

        await expect(target.addUploadedVideoFile(option())).rejects.toThrow('synthetic-insert-failure');

        expect(unlinkMock.mock.calls.filter(([path]) => path === payload)).toHaveLength(1);
        expect(await readdir(storage)).toEqual([]);
    });
});

describe('[RC-10.2] upload file name limits', () => {
    it('shortens the stem so that a numbered candidate still fits in 255 bytes', async () => {
        const fileName = `${'a'.repeat(251)}.ts`;
        const target = subject({
            link: vi.fn(async (source: string, destination: string) => {
                if (basename(destination).length === 254) throw codeError('EEXIST');
                return link(source, destination);
            }),
        });

        await target.addUploadedVideoFile(option({ fileName }));

        expect(await readdir(storage)).toEqual([`${'a'.repeat(249)}(1).ts`]);
    });

    it('accepts an extension that leaves no room for the stem and rejects one that does not fit', async () => {
        const fitting = `a.${'e'.repeat(254)}`;
        await subject().addUploadedVideoFile(option({ fileName: fitting }));
        expect(await readdir(storage)).toEqual([`.${'e'.repeat(254)}`]);

        await mkdir(adopted, { recursive: true });
        await writeFile(payload, 'synthetic-upload-bytes');
        const target = subject();
        await expect(target.addUploadedVideoFile(option({ fileName: `a.${'e'.repeat(255)}` }))).rejects.toThrow(
            'UploadPathError',
        );
    });
});

describe('[RC-10.2] adopted token directory cleanup', () => {
    it.each([
        ['an adopted payload', ['adopted', 'token', 'payload'], true],
        ['a file other than payload in an adopted token', ['adopted', 'token', 'other'], false],
        ['a payload outside adopted', ['elsewhere', 'token', 'payload'], false],
    ])('removes the token directory only for %s', async (_label, segments, removed) => {
        const rmdirMock = vi.fn(async () => undefined);
        const target = subject({ rmdir: rmdirMock });

        await target.cleanAdoptedDirectory(join(base, ...segments));

        if (removed) {
            expect(rmdirMock).toHaveBeenCalledExactlyOnceWith(join(base, 'adopted', 'token'));
        } else {
            expect(rmdirMock).not.toHaveBeenCalled();
        }
    });
});
