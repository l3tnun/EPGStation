import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger, makeReserve, RecordingUtilModel } from './_harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const FileUtil = require(join(snapshot, 'util', 'FileUtil.js')).default;

let root: string;
let tmp: string;

beforeEach(async () => {
    const base = await mkdtemp(join(tmpdir(), 'epgstation-moving-from-tmp-'));
    root = join(base, 'recorded');
    tmp = join(base, 'tmp');
    await fs.promises.mkdir(root);
    await fs.promises.mkdir(tmp);
    for (const level of ['debug', 'error', 'fatal', 'info', 'warn'] as const) {
        logger.system[level].mockClear();
    }
});

afterEach(async () => {
    vi.restoreAllMocks();
    await rm(join(root, '..'), { force: true, recursive: true });
});

const build = (
    overrides: {
        oldPath?: string | null;
        updateFilePath?: ReturnType<typeof vi.fn>;
        updateSize?: ReturnType<typeof vi.fn>;
    } = {},
) => {
    const oldPath = overrides.oldPath === undefined ? join(tmp, '1.ts') : overrides.oldPath;
    const recordPathUpdate = overrides.updateFilePath ?? vi.fn(async () => undefined);
    const recordSizeUpdate = overrides.updateSize ?? vi.fn(async () => undefined);
    // 実際のDB portと同じ名前のmethodを持つfake（呼び出しはviのmockへ転送する）。
    class FakeVideoFileDB {
        public updateFilePath(value: unknown): Promise<void> {
            return recordPathUpdate(value);
        }

        public updateSize(...args: unknown[]): Promise<void> {
            return recordSizeUpdate(...args);
        }
    }
    const videoFileDatabase = new FakeVideoFileDB();
    const execution = { getExecution: vi.fn(async () => 5), unLockExecution: vi.fn() };
    const model = new RecordingUtilModel(
        { getLogger: () => logger },
        {
            getConfig: () => ({
                recorded: [{ name: 'synthetic-root', path: root }],
                recordedFileExtension: '.ts',
                recordedFormat: 'synthetic',
                recordedTmp: tmp,
            }),
        },
        execution,
        { findId: vi.fn(async () => null) },
        { findChannelIdAndTime: vi.fn(async () => null) },
        videoFileDatabase,
        { getFullFilePathFromId: vi.fn(async () => oldPath) },
    );
    return { execution, model, oldPath: oldPath as string, pathUpdate: recordPathUpdate, sizeUpdate: recordSizeUpdate };
};

interface HandleControl {
    close?: () => Promise<void>;
    stat?: () => Promise<unknown>;
    write?: (
        real: fs.promises.FileHandle,
        ...args: [Buffer, number, number, number]
    ) => Promise<{ bytesWritten: number }>;
}

// 予約用のexclusive file（'wx'）のhandleだけを、実fileを使ったまま一部の操作だけ差し替えたものにする。
const controlReservationHandle = (control: HandleControl): { closed: () => number } => {
    const original = fs.promises.open.bind(fs.promises);
    let closes = 0;
    vi.spyOn(fs.promises, 'open').mockImplementation((async (path: fs.PathLike, flags?: fs.OpenMode) => {
        const real = await original(path as string, flags as string);
        if (flags !== 'wx') return real;
        return {
            close: async () => {
                closes += 1;
                if (control.close !== undefined) {
                    await real.close();
                    return control.close();
                }
                return real.close();
            },
            stat: () => (control.stat !== undefined ? control.stat() : real.stat()),
            truncate: (length: number) => real.truncate(length),
            write: (...args: [Buffer, number, number, number]) =>
                control.write !== undefined ? control.write(real, ...args) : real.write(...args),
        };
    }) as unknown as typeof fs.promises.open);
    return { closed: () => closes };
};

const failRenameOnce = (): void => {
    vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(
        Object.assign(new Error('synthetic-exdev'), { code: 'EXDEV' }),
    );
};

describe('[RE-9.2] movingFromTmp moves by rename when possible', () => {
    it('renames onto the reserved destination, records the new path, and leaves no temporary file', async () => {
        const { model, oldPath, pathUpdate } = build();
        await writeFile(oldPath, 'synthetic-payload');

        const moved = await model.movingFromTmp(makeReserve({ id: 1 }), 71);

        expect(moved).toBe(join(root, 'synthetic.ts'));
        expect(await readFile(moved, 'utf8')).toBe('synthetic-payload');
        await expect(stat(oldPath)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(pathUpdate).toHaveBeenCalledWith({
            filePath: 'synthetic.ts',
            parentDirectoryName: 'synthetic-root',
            videoFileId: 71,
        });
    });

    it('rolls the renamed file back to the temporary path when the database update fails', async () => {
        const failure = new Error('synthetic-db-failure');
        const { model, oldPath } = build({ updateFilePath: vi.fn(async () => Promise.reject(failure)) });
        await writeFile(oldPath, 'synthetic-payload');

        await expect(model.movingFromTmp(makeReserve({ id: 1 }), 71)).rejects.toBe(failure);

        expect(await readFile(oldPath, 'utf8')).toBe('synthetic-payload');
        expect(logger.system.info).toHaveBeenCalledWith(
            `rollback renamed file: ${join(root, 'synthetic.ts')} -> ${oldPath}`,
        );
    });

    it('surfaces the database failure when the rollback rename itself fails', async () => {
        const failure = new Error('synthetic-db-failure');
        const { model, oldPath } = build({ updateFilePath: vi.fn(async () => Promise.reject(failure)) });
        await writeFile(oldPath, 'synthetic-payload');
        const original = fs.promises.rename.bind(fs.promises);
        const rename = vi.spyOn(fs.promises, 'rename');
        let calls = 0;
        rename.mockImplementation(async (from, to) => {
            calls += 1;
            if (calls === 2) throw new Error('synthetic-rollback-failure');
            return original(from, to);
        });

        await expect(model.movingFromTmp(makeReserve({ id: 1 }), 71)).rejects.toBe(failure);

        expect(logger.system.error).toHaveBeenCalledWith(
            `rollback renamed file error: ${join(root, 'synthetic.ts')} -> ${oldPath}`,
        );
        expect(calls).toBe(2);
    });

    it('surfaces the database failure when the destination cannot be closed before the rollback rename', async () => {
        const failure = new Error('synthetic-db-failure');
        const { model, oldPath } = build({ updateFilePath: vi.fn(async () => Promise.reject(failure)) });
        await writeFile(oldPath, 'synthetic-payload');
        controlReservationHandle({ close: async () => Promise.reject(new Error('synthetic-close-failure')) });

        await expect(model.movingFromTmp(makeReserve({ id: 1 }), 71)).rejects.toBe(failure);

        expect(logger.system.error).toHaveBeenCalledWith(
            `rollback renamed file error: ${join(root, 'synthetic.ts')} -> ${oldPath}`,
        );
    });
});

describe('[RE-9.2] movingFromTmp falls back to copying', () => {
    it('copies a multi-chunk file with partial writes, removes the old file, and records the path', async () => {
        const { model, oldPath, pathUpdate } = build();
        const payload = Buffer.alloc(150_000, 7);
        await writeFile(oldPath, payload);
        failRenameOnce();
        const writes: number[] = [];
        controlReservationHandle({
            write: async (real, buffer, offset, length, position) => {
                const partial = Math.min(length, 40_000);
                writes.push(partial);
                return real.write(buffer, offset, partial, position);
            },
        });

        const moved = await model.movingFromTmp(makeReserve({ id: 1 }), 71);

        expect(moved).toBe(join(root, 'synthetic.ts'));
        expect(Buffer.compare(await readFile(moved), payload)).toBe(0);
        expect(Math.max(...writes)).toBe(40_000);
        expect(writes.length).toBeGreaterThan(3);
        await expect(stat(oldPath)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(pathUpdate).toHaveBeenCalledTimes(1);
        expect(logger.system.info).toHaveBeenCalledWith(`delete old file: ${oldPath}`);
    });

    it('fails the copy and deletes the destination when a write makes no progress', async () => {
        const { model, oldPath, pathUpdate } = build();
        await writeFile(oldPath, 'synthetic-payload');
        failRenameOnce();
        controlReservationHandle({ write: async () => ({ bytesWritten: 0 }) });

        await expect(model.movingFromTmp(makeReserve({ id: 1 }), 71)).rejects.toThrow('ReservationWriteFailed');

        expect(await readFile(oldPath, 'utf8')).toBe('synthetic-payload');
        await expect(stat(join(root, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
        expect(pathUpdate).not.toHaveBeenCalled();
        expect(logger.system.error).toHaveBeenCalledWith(
            `copy file error: ${oldPath} -> ${join(root, 'synthetic.ts')}`,
        );
    });

    it('still throws the copy failure when closing and deleting the destination also fail', async () => {
        const { model, oldPath } = build();
        await writeFile(oldPath, 'synthetic-payload');
        failRenameOnce();
        const closeFailure = new Error('synthetic-close-failure');
        controlReservationHandle({
            close: async () => Promise.reject(closeFailure),
            write: async () => ({ bytesWritten: 0 }),
        });
        const unlinkFailure = new Error('synthetic-unlink-failure');
        vi.spyOn(FileUtil, 'unlink').mockRejectedValue(unlinkFailure);

        await expect(model.movingFromTmp(makeReserve({ id: 1 }), 71)).rejects.toThrow('ReservationWriteFailed');

        const destination = join(root, 'synthetic.ts');
        expect(logger.system.error).toHaveBeenCalledWith(`close reserved file error: ${destination}`);
        expect(logger.system.error).toHaveBeenCalledWith(closeFailure);
        expect(logger.system.error).toHaveBeenCalledWith(`delete copied file error: ${destination}`);
        expect(logger.system.error).toHaveBeenCalledWith(unlinkFailure);
    });

    it('fails the copy when the source cannot be opened', async () => {
        const { model, oldPath } = build();
        failRenameOnce();

        await expect(model.movingFromTmp(makeReserve({ id: 1 }), 71)).rejects.toMatchObject({ code: 'ENOENT' });

        expect(await readdir(root)).toEqual([]);
        expect(await readdir(tmp)).toEqual([]);
    });

    it('deletes the copied destination when the database update fails after a copy', async () => {
        const failure = new Error('synthetic-db-failure');
        const { model, oldPath } = build({ updateFilePath: vi.fn(async () => Promise.reject(failure)) });
        await writeFile(oldPath, 'synthetic-payload');
        failRenameOnce();

        await expect(model.movingFromTmp(makeReserve({ id: 1 }), 71)).rejects.toBe(failure);

        expect(await readFile(oldPath, 'utf8')).toBe('synthetic-payload');
        expect(await readdir(root)).toEqual([]);
        expect(logger.system.info).toHaveBeenCalledWith(`delete copied file: ${join(root, 'synthetic.ts')}`);
    });

    it('surfaces the database failure when deleting the copied destination fails', async () => {
        const failure = new Error('synthetic-db-failure');
        const { model, oldPath } = build({ updateFilePath: vi.fn(async () => Promise.reject(failure)) });
        await writeFile(oldPath, 'synthetic-payload');
        failRenameOnce();
        vi.spyOn(FileUtil, 'unlink').mockRejectedValue(new Error('synthetic-unlink-failure'));

        await expect(model.movingFromTmp(makeReserve({ id: 1 }), 71)).rejects.toBe(failure);

        expect(logger.system.error).toHaveBeenCalledWith(`delete copied file error: ${join(root, 'synthetic.ts')}`);
    });

    it('rejects with the delete error when the old temporary file cannot be removed after the copy', async () => {
        const { model, oldPath } = build();
        await writeFile(oldPath, 'synthetic-payload');
        failRenameOnce();
        const unlinkFailure = new Error('synthetic-unlink-failure');
        vi.spyOn(FileUtil, 'unlink').mockRejectedValue(unlinkFailure);

        await expect(model.movingFromTmp(makeReserve({ id: 1 }), 71)).rejects.toBe(unlinkFailure);

        expect(logger.system.error).toHaveBeenCalledWith(`delete old file error: ${oldPath}`);
    });
});

describe('[RE-9.2] movingFromTmp reservation handle failures', () => {
    it('closes the reservation and rethrows when the reserved file cannot be inspected', async () => {
        const { model, oldPath, pathUpdate } = build();
        await writeFile(oldPath, 'synthetic-payload');
        const statFailure = new Error('synthetic-stat-failure');
        const control = controlReservationHandle({ stat: async () => Promise.reject(statFailure) });

        await expect(model.movingFromTmp(makeReserve({ id: 1 }), 71)).rejects.toBe(statFailure);

        expect(control.closed()).toBe(1);
        expect(pathUpdate).not.toHaveBeenCalled();
        expect(await readFile(oldPath, 'utf8')).toBe('synthetic-payload');
    });

    it('logs the close failure and still rethrows the inspection failure', async () => {
        const { model, oldPath } = build();
        await writeFile(oldPath, 'synthetic-payload');
        const statFailure = new Error('synthetic-stat-failure');
        const closeFailure = new Error('synthetic-close-failure');
        controlReservationHandle({
            close: async () => Promise.reject(closeFailure),
            stat: async () => Promise.reject(statFailure),
        });

        await expect(model.movingFromTmp(makeReserve({ id: 1 }), 71)).rejects.toBe(statFailure);

        expect(logger.system.error).toHaveBeenCalledWith(closeFailure);
    });

    it('fails with the final close error when the move completed but the reservation cannot be closed', async () => {
        const { model, oldPath } = build();
        await writeFile(oldPath, 'synthetic-payload');
        const closeFailure = new Error('synthetic-close-failure');
        controlReservationHandle({ close: async () => Promise.reject(closeFailure) });

        await expect(model.movingFromTmp(makeReserve({ id: 1 }), 71)).rejects.toBe(closeFailure);

        expect(await readFile(join(root, 'synthetic.ts'), 'utf8')).toBe('synthetic-payload');
    });

    it('rejects when the destination path selection returns no reserved file handle', async () => {
        const { model, oldPath } = build();
        await writeFile(oldPath, 'synthetic-payload');
        vi.spyOn(model, 'getRecPath').mockResolvedValue({
            fileName: 'synthetic.ts',
            fullPath: join(root, 'synthetic.ts'),
            parendDir: { name: 'synthetic-root', path: root },
            subDir: '',
        });

        await expect(model.movingFromTmp(makeReserve({ id: 1 }), 71)).rejects.toThrow('ReservedFileHandleIsUndefined');
    });
});

describe('[RE-9.2] recording directory permission and file size update', () => {
    it.each([
        ['an EACCES error', Object.assign(new Error('synthetic-denied'), { code: 'EACCES' })],
        ['an error without a code', new Error('synthetic-no-code')],
    ])('logs a fatal permission error and rethrows %s from the directory check', async (_name, failure) => {
        const { model } = build();
        vi.spyOn(FileUtil, 'access').mockRejectedValue(failure);

        await expect(model.getRecPath(makeReserve({ id: 1 }), false)).rejects.toBe(failure);

        expect(logger.system.fatal).toHaveBeenCalledWith(`dir permission error: ${root}`);
        expect(logger.system.fatal).toHaveBeenCalledWith(failure);
    });

    it('stores the measured file size of the video file', async () => {
        const { model, oldPath, sizeUpdate } = build();
        await writeFile(oldPath, '12345');

        await model.updateVideoFileSize(71);

        expect(sizeUpdate).toHaveBeenCalledWith(71, 5);
    });

    it('logs and resolves when the size cannot be measured or stored', async () => {
        const { model, sizeUpdate } = build({ oldPath: join(tmp, 'missing.ts') });

        await expect(model.updateVideoFileSize(71)).resolves.toBeUndefined();

        expect(sizeUpdate).not.toHaveBeenCalled();
        expect(logger.system.error).toHaveBeenCalledWith('update file size error: 71');
    });
});
