import 'reflect-metadata';

import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
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

beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'epgstation-upload-default-fs-'));
    storage = join(base, 'storage');
    adopted = join(base, 'adopted', 'synthetic-token');
    await mkdir(storage);
    await mkdir(adopted, { recursive: true });
    await writeFile(join(adopted, 'payload'), 'synthetic-upload-bytes');
});

afterEach(async () => {
    await rm(base, { force: true, recursive: true });
});

// uploadFileSystemを持たないmodelを作り、実のfile system（既定の実装）で動かす。
const subject = (overrides: Record<string, unknown> = {}) => {
    const target: any = Object.create(RecordedManageModel.prototype);
    target.log = { system: { error: vi.fn(), info: vi.fn() } };
    target.recordedDB = { findId: vi.fn(async () => ({ id: 401, thumbnails: [] })) };
    target.videoFileDB = { insertOnce: vi.fn(async () => 412) };
    target.recordedEvent = { emitAddUploadedVideoFile: vi.fn(), emitAddVideoFile: vi.fn() };
    target.videoUtil = { getParentDirPath: vi.fn(() => storage) };
    target.recordingUtilModel = { formatFilePathString: vi.fn(async (value: string) => value) };
    Object.assign(target, overrides);
    return target;
};

const option = (overrides: Record<string, unknown> = {}) => ({
    fileName: 'name.ts',
    filePath: join(adopted, 'payload'),
    fileType: 'ts',
    parentDirectoryName: 'synthetic-storage',
    recordedId: 401,
    viewName: 'synthetic-view',
    ...overrides,
});

describe('[RC-10.2] upload placement on the default file system', () => {
    it('places the payload under created sub directories, removes the adopted token, and registers the relative path', async () => {
        const target = subject();
        await mkdir(join(storage, 'existing'));

        await target.addUploadedVideoFile(option({ subDirectory: 'existing/nested' }));

        expect(await readFile(join(storage, 'existing', 'nested', 'name.ts'), 'utf8')).toBe('synthetic-upload-bytes');
        await expect(stat(join(base, 'adopted', 'synthetic-token'))).rejects.toMatchObject({ code: 'ENOENT' });
        expect(target.videoFileDB.insertOnce).toHaveBeenCalledWith(
            expect.objectContaining({
                filePath: join('existing', 'nested', 'name.ts'),
                parentDirectoryName: 'synthetic-storage',
                recordedId: 401,
                size: 22,
                type: 'ts',
            }),
        );
        expect(target.recordedEvent.emitAddVideoFile).toHaveBeenCalledWith(412);
        expect(target.recordedEvent.emitAddUploadedVideoFile).toHaveBeenCalledWith(412, true);
    });

    it('chooses a numbered name when the file already exists in the destination', async () => {
        const target = subject();
        await writeFile(join(storage, 'name.ts'), 'synthetic-existing');

        await target.addUploadedVideoFile(option());

        expect(await readFile(join(storage, 'name.ts'), 'utf8')).toBe('synthetic-existing');
        expect(await readFile(join(storage, 'name(1).ts'), 'utf8')).toBe('synthetic-upload-bytes');
    });

    it('rejects a sub directory that is a symbolic link and keeps the adopted payload out of the destination', async () => {
        const target = subject();
        await mkdir(join(base, 'outside'));
        await symlink(join(base, 'outside'), join(storage, 'linked'));

        // Linuxはdescriptorを`O_NOFOLLOW`で開くためopen失敗が原因として付く。Linux以外はlstatで種類を見るため原因は付かない。
        await expect(target.addUploadedVideoFile(option({ subDirectory: 'linked' }))).rejects.toMatchObject({
            ...(process.platform === 'linux'
                ? { cause: expect.objectContaining({ code: expect.stringMatching(/^(ELOOP|ENOTDIR)$/u) }) }
                : {}),
            message: 'UploadPathError',
        });

        expect(await readdir(join(base, 'outside'))).toEqual([]);
        expect(target.videoFileDB.insertOnce).not.toHaveBeenCalled();
    });

    it('rejects when the parent directory of the storage is not configured', async () => {
        const target = subject({ videoUtil: { getParentDirPath: vi.fn(() => null) } });

        await expect(target.addUploadedVideoFile(option())).rejects.toThrow('ParentDirectoryIsNull');

        expect(target.log.system.error).toHaveBeenCalledWith('parent directory is null: synthetic-storage');
        expect(target.videoFileDB.insertOnce).not.toHaveBeenCalled();
    });

    it('rejects a sub directory containing a backslash or an empty or dot segment', async () => {
        const target = subject();

        for (const subDirectory of ['a\\b', 'a//b', './a', 'a/..']) {
            await expect(target.addUploadedVideoFile(option({ subDirectory }))).rejects.toThrow('UploadPathError');
        }

        expect(await readdir(storage)).toEqual([]);
    });
});
