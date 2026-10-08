import * as fs from 'node:fs';
import { chmod, mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
    deferred,
    load,
    logger,
    makeRecorder,
    makeRecordingSessionBinding,
    makeReserve,
    RecordingUtilModel,
} from './_harness';

const FileUtil = load<{ unlink(filePath: string): Promise<void> }>('util', 'FileUtil.js');

describe('recording filesystem boundary', () => {
    it('[Task 9.5] releases the path owner after an actual permission rejection without creating a partial file', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-permission-'));
        const execution = { getExecution: vi.fn(async () => 809), unLockExecution: vi.fn() };
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: root }],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            execution,
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            {},
            {},
        );
        try {
            await chmod(root, 0o500);
            await expect(model.getRecPath(makeReserve({ id: 809 }), false, true)).rejects.toMatchObject({
                code: 'EACCES',
            });
            expect(execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(809);
            await expect(stat(join(root, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await chmod(root, 0o700);
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.1] creates the selected synthetic subdirectory without creating the output file', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-fs-'));
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: root }],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            {},
            {},
        );
        try {
            const path = await model.getRecPath(makeReserve({ directory: 'synthetic-subdir' }), false);
            await expect(stat(join(root, 'synthetic-subdir'))).resolves.toMatchObject({});
            await expect(stat(path.fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.3] gives competing recordings distinct exclusively created files', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-fs-'));
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: root }],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            {},
            {},
        );
        try {
            const [first, second] = await Promise.all([
                model.getRecPath(makeReserve({ id: 401 }), false, true),
                model.getRecPath(makeReserve({ id: 402 }), false, true),
            ]);
            expect(new Set([first.fullPath, second.fullPath])).toEqual(
                new Set([join(root, 'synthetic.ts'), join(root, 'synthetic(1).ts')]),
            );
            await expect(stat(first.fullPath)).resolves.toMatchObject({});
            await expect(stat(second.fullPath)).resolves.toMatchObject({});
            await Promise.all([first.fileHandle?.close(), second.fileHandle?.close()]);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] keeps an active session reservation intact while concurrent temporary-file moves select suffixes', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-concurrent-move-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const firstSource = join(temporary, 'first.ts');
        const secondSource = join(temporary, 'second.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await Promise.all([writeFile(firstSource, 'first recording'), writeFile(secondSource, 'second recording')]);
        const makeUtil = (sourcePath: string) =>
            new RecordingUtilModel(
                { getLogger: () => logger },
                {
                    getConfig: () => ({
                        recorded: [{ name: 'synthetic-root', path: recorded }],
                        recordedTmp: temporary,
                        recordedFormat: 'synthetic',
                        recordedFileExtension: '.ts',
                    }),
                },
                { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
                { findId: vi.fn(async () => null) },
                { findChannelIdAndTime: vi.fn(async () => null) },
                { updateFilePath: vi.fn(async () => undefined) },
                { getFullFilePathFromId: vi.fn(async () => sourcePath) },
            );
        let activeFileHandle: Awaited<ReturnType<RecordingUtilModel['getRecPath']>>['fileHandle'];
        try {
            const activeReservation = await makeUtil(firstSource).getRecPath(makeReserve({ id: 500 }), false, true);
            expect(activeReservation.fullPath).toBe(join(recorded, 'synthetic.ts'));
            activeFileHandle = activeReservation.fileHandle;
            await activeFileHandle?.writeFile('active session recording');

            const [firstResult, secondResult] = await Promise.all([
                makeUtil(firstSource).movingFromTmp(makeReserve({ id: 501 }), 601),
                makeUtil(secondSource).movingFromTmp(makeReserve({ id: 502 }), 602),
            ]);

            expect(new Set([firstResult, secondResult])).toEqual(
                new Set([join(recorded, 'synthetic(1).ts'), join(recorded, 'synthetic(2).ts')]),
            );
            await expect(readFile(activeReservation.fullPath, 'utf8')).resolves.toBe('active session recording');
            await expect(readFile(firstResult, 'utf8')).resolves.toBe('first recording');
            await expect(readFile(secondResult, 'utf8')).resolves.toBe('second recording');
            await expect(stat(firstSource)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(stat(secondSource)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await activeFileHandle?.close();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] fails closed before moving a temporary file when exclusive destination ownership is absent', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-move-missing-handle-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const destination = join(recorded, 'synthetic.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await writeFile(source, 'source recording');
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn() },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        const getRecPath = vi.spyOn(model, 'getRecPath').mockResolvedValue({
            parendDir: { name: 'synthetic-root', path: recorded },
            subDir: '',
            fileName: 'synthetic.ts',
            fullPath: destination,
        });
        try {
            await expect(model.movingFromTmp(makeReserve({ id: 517 }), 617)).rejects.toThrow(
                'ReservedFileHandleIsUndefined',
            );

            await expect(readFile(source, 'utf8')).resolves.toBe('source recording');
            await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            getRecPath.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] closes its reservation without deleting an unverified path when destination identity inspection rejects', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-move-reservation-stat-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const destination = join(recorded, 'synthetic.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await writeFile(source, 'source recording');
        const destinationHandle = await open(destination, 'wx');
        const statFailure = new Error('synthetic reservation stat failure');
        const destinationStat = vi.spyOn(destinationHandle, 'stat').mockRejectedValue(statFailure);
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn() },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        const getRecPath = vi.spyOn(model, 'getRecPath').mockResolvedValue({
            parendDir: { name: 'synthetic-root', path: recorded },
            subDir: '',
            fileName: 'synthetic.ts',
            fullPath: destination,
            fileHandle: destinationHandle,
        });
        try {
            await expect(model.movingFromTmp(makeReserve({ id: 518 }), 618)).rejects.toBe(statFailure);

            await expect(readFile(source, 'utf8')).resolves.toBe('source recording');
            await expect(stat(destination)).resolves.toMatchObject({ size: 0 });
            await expect(destinationHandle.writeFile('late write')).rejects.toThrow();
        } finally {
            getRecPath.mockRestore();
            destinationStat.mockRestore();
            await destinationHandle.close().catch(() => {});
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] preserves the primary stat rejection when both reservation-close attempts reject', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-move-reservation-stat-close-failure-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const destination = join(recorded, 'synthetic.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await writeFile(source, 'source recording');
        const destinationHandle = await open(destination, 'wx');
        const statFailure = new Error('synthetic reservation stat failure');
        const closeFailure = new Error('synthetic reservation close failure');
        const destinationStat = vi.spyOn(destinationHandle, 'stat').mockRejectedValue(statFailure);
        const close = vi.spyOn(destinationHandle, 'close').mockRejectedValue(closeFailure);
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn() },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        const getRecPath = vi.spyOn(model, 'getRecPath').mockResolvedValue({
            parendDir: { name: 'synthetic-root', path: recorded },
            subDir: '',
            fileName: 'synthetic.ts',
            fullPath: destination,
            fileHandle: destinationHandle,
        });
        try {
            await expect(model.movingFromTmp(makeReserve({ id: 524 }), 624)).rejects.toBe(statFailure);

            expect(close).toHaveBeenCalledTimes(2);
            await expect(readFile(source, 'utf8')).resolves.toBe('source recording');
            await expect(stat(destination)).resolves.toMatchObject({ size: 0 });
        } finally {
            getRecPath.mockRestore();
            destinationStat.mockRestore();
            close.mockRestore();
            await destinationHandle.close();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] copies to its exclusively reserved destination when rename cannot cross the filesystem', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-copy-fallback-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const otherPath = join(recorded, 'other.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await Promise.all([writeFile(source, 'copy fallback recording'), writeFile(otherPath, 'other recording')]);
        const updateFilePath = vi.fn(async () => undefined);
        const rename = vi
            .spyOn(fs.promises, 'rename')
            .mockRejectedValueOnce(Object.assign(new Error('cross-device move'), { code: 'EXDEV' }));
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        try {
            const destination = await model.movingFromTmp(makeReserve({ id: 503 }), 603);

            expect(destination).toBe(join(recorded, 'synthetic.ts'));
            await expect(readFile(destination, 'utf8')).resolves.toBe('copy fallback recording');
            await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(otherPath, 'utf8')).resolves.toBe('other recording');
            expect(updateFilePath).toHaveBeenCalledExactlyOnceWith({
                filePath: 'synthetic.ts',
                parentDirectoryName: 'synthetic-root',
                videoFileId: 603,
            });
        } finally {
            rename.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] persists every byte when copy fallback writes to its reservation in partial chunks', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-copy-partial-write-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const destination = join(recorded, 'synthetic.ts');
        const content = Buffer.from('partial copy recording');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await writeFile(source, content);
        const destinationHandle = await open(destination, 'wx');
        const reservation = destinationHandle as unknown as {
            write(
                buffer: Uint8Array,
                offset: number,
                length: number,
                position: number,
            ): Promise<{ bytesWritten: number; buffer: Uint8Array }>;
        };
        const originalWrite = reservation.write.bind(reservation);
        let writeCount = 0;
        reservation.write = async (buffer, offset, length, position) => {
            writeCount += 1;
            return originalWrite(buffer, offset, Math.max(1, Math.floor(length / 2)), position);
        };
        const rename = vi
            .spyOn(fs.promises, 'rename')
            .mockRejectedValueOnce(Object.assign(new Error('cross-device move'), { code: 'EXDEV' }));
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn() },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        const getRecPath = vi.spyOn(model, 'getRecPath').mockResolvedValue({
            parendDir: { name: 'synthetic-root', path: recorded },
            subDir: '',
            fileName: 'synthetic.ts',
            fullPath: destination,
            fileHandle: destinationHandle,
        });
        try {
            await expect(model.movingFromTmp(makeReserve({ id: 519 }), 619)).resolves.toBe(destination);

            expect(writeCount).toBeGreaterThan(1);
            await expect(readFile(destination)).resolves.toEqual(content);
            await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(destinationHandle.writeFile('late write')).rejects.toThrow();
        } finally {
            getRecPath.mockRestore();
            rename.mockRestore();
            await destinationHandle.close().catch(() => {});
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] removes its empty reservation when copy fallback cannot write a byte', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-copy-zero-write-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const destination = join(recorded, 'synthetic.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await writeFile(source, 'source recording');
        const destinationHandle = await open(destination, 'wx');
        const reservation = destinationHandle as unknown as {
            write(
                buffer: Uint8Array,
                offset: number,
                length: number,
                position: number,
            ): Promise<{ bytesWritten: number; buffer: Uint8Array }>;
        };
        reservation.write = async buffer => ({ bytesWritten: 0, buffer });
        const rename = vi
            .spyOn(fs.promises, 'rename')
            .mockRejectedValueOnce(Object.assign(new Error('cross-device move'), { code: 'EXDEV' }));
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn() },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        const getRecPath = vi.spyOn(model, 'getRecPath').mockResolvedValue({
            parendDir: { name: 'synthetic-root', path: recorded },
            subDir: '',
            fileName: 'synthetic.ts',
            fullPath: destination,
            fileHandle: destinationHandle,
        });
        try {
            await expect(model.movingFromTmp(makeReserve({ id: 520 }), 620)).rejects.toThrow('ReservationWriteFailed');

            await expect(readFile(source, 'utf8')).resolves.toBe('source recording');
            await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(destinationHandle.writeFile('late write')).rejects.toThrow();
        } finally {
            getRecPath.mockRestore();
            rename.mockRestore();
            await destinationHandle.close().catch(() => {});
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[exclusive-partial-move][Task 9.5] removes its reserved partial destination when copy fallback rejects', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-copy-reject-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const destination = join(recorded, 'synthetic.ts');
        const otherPath = join(recorded, 'other.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await Promise.all([mkdir(source), writeFile(otherPath, 'other recording')]);
        const rename = vi
            .spyOn(fs.promises, 'rename')
            .mockRejectedValueOnce(Object.assign(new Error('cross-device move'), { code: 'EXDEV' }));
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn() },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        try {
            await expect(model.movingFromTmp(makeReserve({ id: 506 }), 606)).rejects.toThrow();

            await expect(stat(source)).resolves.toMatchObject({});
            await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(otherPath, 'utf8')).resolves.toBe('other recording');
            const lateHandle = await open(destination, 'wx');
            await lateHandle.close();
        } finally {
            rename.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] retries a failed destination-handle close before treating copy-failure cleanup as complete', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-copy-close-retry-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const destination = join(recorded, 'synthetic.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await mkdir(source);
        const destinationHandle = await open(destination, 'wx');
        const closeFailure = new Error('synthetic destination close failure');
        const close = vi.spyOn(destinationHandle, 'close').mockRejectedValueOnce(closeFailure);
        const rename = vi
            .spyOn(fs.promises, 'rename')
            .mockRejectedValueOnce(Object.assign(new Error('cross-device move'), { code: 'EXDEV' }));
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn() },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        const getRecPath = vi.spyOn(model, 'getRecPath').mockResolvedValue({
            parendDir: { name: 'synthetic-root', path: recorded },
            subDir: '',
            fileName: 'synthetic.ts',
            fullPath: destination,
            fileHandle: destinationHandle,
        });
        try {
            await expect(model.movingFromTmp(makeReserve({ id: 513 }), 613)).rejects.toThrow();

            expect(close).toHaveBeenCalledTimes(2);
            await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(destinationHandle.writeFile('late write')).rejects.toThrow();
            await expect(stat(source)).resolves.toMatchObject({});
        } finally {
            getRecPath.mockRestore();
            close.mockRestore();
            rename.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] preserves the copy rejection while close retry and reservation unlink both fail', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-copy-cleanup-failures-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const destination = join(recorded, 'synthetic.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await writeFile(source, 'source recording');
        const destinationHandle = await open(destination, 'wx');
        const copyFailure = new Error('synthetic copy open failure');
        const closeFailure = new Error('synthetic destination close failure');
        const unlinkFailure = new Error('synthetic reservation unlink failure');
        const close = vi.spyOn(destinationHandle, 'close').mockRejectedValueOnce(closeFailure);
        const actualOpen = fs.promises.open;
        const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation(async (file, flags, mode) => {
            if (file === source && flags === 'r') throw copyFailure;
            return actualOpen(file, flags, mode);
        });
        const rename = vi
            .spyOn(fs.promises, 'rename')
            .mockRejectedValueOnce(Object.assign(new Error('cross-device move'), { code: 'EXDEV' }));
        const unlink = vi.spyOn(FileUtil, 'unlink').mockRejectedValueOnce(unlinkFailure);
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn() },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        const getRecPath = vi.spyOn(model, 'getRecPath').mockResolvedValue({
            parendDir: { name: 'synthetic-root', path: recorded },
            subDir: '',
            fileName: 'synthetic.ts',
            fullPath: destination,
            fileHandle: destinationHandle,
        });
        try {
            await expect(model.movingFromTmp(makeReserve({ id: 525 }), 625)).rejects.toBe(copyFailure);

            expect(close).toHaveBeenCalledTimes(2);
            expect(unlink).toHaveBeenCalledExactlyOnceWith(destination);
            await expect(readFile(source, 'utf8')).resolves.toBe('source recording');
            await expect(stat(destination)).resolves.toMatchObject({ size: 0 });
        } finally {
            getRecPath.mockRestore();
            unlink.mockRestore();
            rename.mockRestore();
            openSpy.mockRestore();
            close.mockRestore();
            await destinationHandle.close();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] does not report a completed move when its reserved destination handle cannot close', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-destination-close-failure-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const destination = join(recorded, 'synthetic.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await writeFile(source, 'original recording');
        const destinationHandle = await open(destination, 'wx');
        const closeFailure = new Error('synthetic destination close failure');
        const close = vi.spyOn(destinationHandle, 'close').mockRejectedValue(closeFailure);
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn() },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        const getRecPath = vi.spyOn(model, 'getRecPath').mockResolvedValue({
            parendDir: { name: 'synthetic-root', path: recorded },
            subDir: '',
            fileName: 'synthetic.ts',
            fullPath: destination,
            fileHandle: destinationHandle,
        });
        try {
            await expect(model.movingFromTmp(makeReserve({ id: 514 }), 614)).rejects.toBe(closeFailure);

            expect(close).toHaveBeenCalledOnce();
            await expect(readFile(destination, 'utf8')).resolves.toBe('original recording');
            await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            getRecPath.mockRestore();
            close.mockRestore();
            await destinationHandle.close();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] unlinks only its copied destination when the move database update rejects', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-copy-rollback-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const destination = join(recorded, 'synthetic.ts');
        const otherPath = join(recorded, 'other.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await Promise.all([writeFile(source, 'source recording'), writeFile(otherPath, 'other recording')]);
        const failure = new Error('synthetic path update failure');
        const rename = vi
            .spyOn(fs.promises, 'rename')
            .mockRejectedValueOnce(Object.assign(new Error('cross-device move'), { code: 'EXDEV' }));
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn(async () => Promise.reject(failure)) },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        try {
            await expect(model.movingFromTmp(makeReserve({ id: 504 }), 604)).rejects.toBe(failure);

            await expect(readFile(source, 'utf8')).resolves.toBe('source recording');
            await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(otherPath, 'utf8')).resolves.toBe('other recording');
        } finally {
            rename.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] restores only its renamed destination when the move database update rejects', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-rename-rollback-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const destination = join(recorded, 'synthetic.ts');
        const otherPath = join(recorded, 'other.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await Promise.all([writeFile(source, 'source recording'), writeFile(otherPath, 'other recording')]);
        const failure = new Error('synthetic path update failure');
        const rename = vi.spyOn(fs.promises, 'rename');
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn(async () => Promise.reject(failure)) },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        try {
            await expect(model.movingFromTmp(makeReserve({ id: 505 }), 605)).rejects.toBe(failure);

            await expect(readFile(source, 'utf8')).resolves.toBe('source recording');
            await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(otherPath, 'utf8')).resolves.toBe('other recording');
            expect(rename).toHaveBeenNthCalledWith(1, source, destination);
            expect(rename).toHaveBeenNthCalledWith(2, destination, source);
        } finally {
            rename.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] closes a successfully rolled-back reservation exactly once', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-rename-rollback-close-once-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const destination = join(recorded, 'synthetic.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await writeFile(source, 'source recording');
        const destinationHandle = await open(destination, 'wx');
        const close = vi.spyOn(destinationHandle, 'close');
        const updateFailure = new Error('synthetic path update failure');
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn(async () => Promise.reject(updateFailure)) },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        const getRecPath = vi.spyOn(model, 'getRecPath').mockResolvedValue({
            parendDir: { name: 'synthetic-root', path: recorded },
            subDir: '',
            fileName: 'synthetic.ts',
            fullPath: destination,
            fileHandle: destinationHandle,
        });
        try {
            await expect(model.movingFromTmp(makeReserve({ id: 526 }), 626)).rejects.toBe(updateFailure);

            expect(close).toHaveBeenCalledOnce();
            await expect(readFile(source, 'utf8')).resolves.toBe('source recording');
            await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            getRecPath.mockRestore();
            close.mockRestore();
            await destinationHandle.close();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] preserves the moved file and reports the database rejection when rename rollback fails', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-rename-rollback-failure-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const destination = join(recorded, 'synthetic.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await writeFile(source, 'source recording');
        const updateFailure = new Error('synthetic path update failure');
        const rollbackFailure = new Error('synthetic rename rollback failure');
        const actualRename = fs.promises.rename;
        let renameCalls = 0;
        const rename = vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
            renameCalls += 1;
            if (renameCalls === 2) throw rollbackFailure;
            await actualRename(from, to);
        });
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn(async () => Promise.reject(updateFailure)) },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        try {
            await expect(model.movingFromTmp(makeReserve({ id: 520 }), 620)).rejects.toBe(updateFailure);

            expect(rename).toHaveBeenNthCalledWith(1, source, destination);
            expect(rename).toHaveBeenNthCalledWith(2, destination, source);
            await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(destination, 'utf8')).resolves.toBe('source recording');
        } finally {
            rename.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] keeps both files and reports the database rejection when copied-destination cleanup fails', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-copy-rollback-cleanup-failure-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const destination = join(recorded, 'synthetic.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await writeFile(source, 'source recording');
        const updateFailure = new Error('synthetic path update failure');
        const cleanupFailure = new Error('synthetic copied destination cleanup failure');
        const rename = vi
            .spyOn(fs.promises, 'rename')
            .mockRejectedValueOnce(Object.assign(new Error('cross-device move'), { code: 'EXDEV' }));
        const originalUnlink = FileUtil.unlink;
        const unlink = vi.spyOn(FileUtil, 'unlink').mockImplementation(async filePath => {
            if (filePath === destination) throw cleanupFailure;
            await originalUnlink(filePath);
        });
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn(async () => Promise.reject(updateFailure)) },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        try {
            await expect(model.movingFromTmp(makeReserve({ id: 521 }), 621)).rejects.toBe(updateFailure);

            expect(unlink).toHaveBeenCalledExactlyOnceWith(destination);
            await expect(readFile(source, 'utf8')).resolves.toBe('source recording');
            await expect(readFile(destination, 'utf8')).resolves.toBe('source recording');
        } finally {
            unlink.mockRestore();
            rename.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] keeps the temporary source and removes its reservation when copy-source close rejects', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-copy-source-close-failure-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const destination = join(recorded, 'synthetic.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await writeFile(source, 'source recording');
        const sourceHandle = await open(source, 'r');
        const closeFailure = new Error('synthetic copy source close failure');
        const close = vi.spyOn(sourceHandle, 'close').mockRejectedValue(closeFailure);
        const originalOpen = fs.promises.open;
        const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation(async (file, flags, mode) => {
            if (file === source && flags === 'r') return sourceHandle;
            return originalOpen(file, flags, mode);
        });
        const rename = vi
            .spyOn(fs.promises, 'rename')
            .mockRejectedValueOnce(Object.assign(new Error('cross-device move'), { code: 'EXDEV' }));
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn() },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        try {
            await expect(model.movingFromTmp(makeReserve({ id: 522 }), 622)).rejects.toBe(closeFailure);

            expect(close).toHaveBeenCalledOnce();
            await expect(readFile(source, 'utf8')).resolves.toBe('source recording');
            await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            openSpy.mockRestore();
            close.mockRestore();
            rename.mockRestore();
            await sourceHandle.close();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] keeps the copied destination and reports old-source cleanup failure', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-copy-old-source-cleanup-failure-'));
        const temporary = join(root, 'temporary');
        const recorded = join(root, 'recorded');
        const source = join(temporary, 'source.ts');
        const destination = join(recorded, 'synthetic.ts');
        await Promise.all([mkdir(temporary), mkdir(recorded)]);
        await writeFile(source, 'source recording');
        const cleanupFailure = new Error('synthetic old source cleanup failure');
        const rename = vi
            .spyOn(fs.promises, 'rename')
            .mockRejectedValueOnce(Object.assign(new Error('cross-device move'), { code: 'EXDEV' }));
        const originalUnlink = FileUtil.unlink;
        const unlink = vi.spyOn(FileUtil, 'unlink').mockImplementation(async filePath => {
            if (filePath === source) throw cleanupFailure;
            await originalUnlink(filePath);
        });
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recorded }],
                    recordedTmp: temporary,
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn() },
            { getFullFilePathFromId: vi.fn(async () => source) },
        );
        try {
            await expect(model.movingFromTmp(makeReserve({ id: 523 }), 623)).rejects.toBe(cleanupFailure);

            expect(unlink).toHaveBeenCalledExactlyOnceWith(source);
            await expect(readFile(source, 'utf8')).resolves.toBe('source recording');
            await expect(readFile(destination, 'utf8')).resolves.toBe('source recording');
        } finally {
            unlink.mockRestore();
            rename.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] records the observed byte size of its real destination file', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-size-'));
        const fullPath = join(root, 'sized.ts');
        const updateSize = vi.fn(async () => undefined);
        await writeFile(fullPath, 'six-bytes', 'utf8');
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            { getConfig: () => ({}) },
            { getExecution: vi.fn(), unLockExecution: vi.fn() },
            { findId: vi.fn() },
            { findChannelIdAndTime: vi.fn() },
            { updateSize },
            { getFullFilePathFromId: vi.fn(async () => fullPath) },
        );
        try {
            await model.updateVideoFileSize(606);

            expect(updateSize).toHaveBeenCalledExactlyOnceWith(606, 9);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.5] closes and unlinks the exact late exclusive file before releasing its path owner', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-overdue-fs-'));
        const channel = deferred<null>();
        const execution = { getExecution: vi.fn(async () => 481), unLockExecution: vi.fn() };
        const actualOpen = fs.promises.open;
        let lateHandle: Awaited<ReturnType<typeof open>> | undefined;
        const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
            lateHandle = await actualOpen(...args);
            return lateHandle;
        });
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: root }],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            execution,
            { findId: vi.fn(() => channel.promise) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            {},
            {},
        );
        const selected = model.getRecPath(makeReserve({ id: 482 }), false, true);
        const overdueResult = selected.then(
            () => {
                throw new Error('Late exclusive result was returned to its recording session');
            },
            error => error as Error & { terminal: Promise<void> },
        );
        try {
            for (let microtask = 0; execution.getExecution.mock.calls.length === 0 && microtask < 5; microtask += 1) {
                await Promise.resolve();
            }
            await vi.advanceTimersByTimeAsync(600_000);
            channel.resolve(null);
            const overdue = await overdueResult;
            await overdue.terminal;

            expect(execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(481);
            await expect(stat(join(root, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(lateHandle?.writeFile('late write')).rejects.toThrow();
        } finally {
            openSpy.mockRestore();
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.3][RE-4.8] preserves a conflicting legacy path-only file when writer failure wins before data', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-path-only-sentinel-'));
        const fullPath = join(root, 'sentinel.ts');
        const stream = new PassThrough();
        await writeFile(fullPath, 'other recording', 'utf8');
        const harness = makeRecorder({
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'sentinel.ts',
                    fullPath,
                })),
            },
        });
        harness.model.reserve = makeReserve();
        harness.model.stream = stream;
        const recording = harness.model.doRecord();
        try {
            await expect(recording).rejects.toMatchObject({ code: 'EEXIST' });

            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
            await expect(readFile(fullPath, 'utf8')).resolves.toBe('other recording');
        } finally {
            (harness.model as any).cancelFirstDataWait();
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.3][RE-4.8] removes an owned file when writer failure wins before data', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-path-only-owner-'));
        const fullPath = join(root, 'owned.ts');
        const stream = new PassThrough();
        const harness = makeRecorder({
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'owned.ts',
                    fullPath,
                })),
            },
        });
        harness.model.reserve = makeReserve();
        harness.model.stream = stream;
        try {
            const recording = harness.model.doRecord();
            await vi.waitFor(() => expect(harness.model.recFile.pending).toBe(false));
            const failure = new Error('synthetic writer failure');
            harness.model.recFile.emit('error', failure);
            await expect(recording).rejects.toBe(failure);

            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        } finally {
            (harness.model as any).cancelFirstDataWait();
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.3] stops a deferred path after actual cancellation and cleans only its owned handle file', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-cancelled-path-'));
        const fullPath = join(root, 'owned.ts');
        const otherPath = join(root, 'other.ts');
        const fileHandle = await open(fullPath, 'wx');
        const selected = deferred<any>();
        const stream = new PassThrough();
        await writeFile(otherPath, 'other recording', 'utf8');
        const harness = makeRecorder({ recordingUtil: { getRecPath: vi.fn(() => selected.promise) } });
        harness.model.reserve = makeReserve();
        harness.model.stream = stream;
        const pipe = vi.spyOn(stream, 'pipe');
        const recording = harness.model.doRecord();
        const settled = recording.catch(() => undefined);
        try {
            await vi.waitFor(() => expect(harness.recordingUtil.getRecPath).toHaveBeenCalledOnce());
            await harness.model.cancel(false);
            selected.resolve({
                parendDir: { name: 'synthetic-root', path: root },
                subDir: '',
                fileName: 'owned.ts',
                fullPath,
                fileHandle,
            });
            await new Promise(resolve => setImmediate(resolve));

            expect(pipe).not.toHaveBeenCalled();
            await recording;
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(otherPath, 'utf8')).resolves.toBe('other recording');
            await expect(fileHandle.writeFile('late write')).rejects.toThrow();
        } finally {
            (harness.model as any).cancelFirstDataWait();
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await settled;
            pipe.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.3] removes an owned handle file when piping fails before recording starts', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-pipe-cleanup-'));
        const fullPath = join(root, 'owned.ts');
        const fileHandle = await open(fullPath, 'wx');
        const stream = new PassThrough();
        const failure = new Error('synthetic pipe failure');
        const harness = makeRecorder({
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'owned.ts',
                    fullPath,
                    fileHandle,
                })),
            },
        });
        harness.model.reserve = makeReserve();
        harness.model.stream = stream;
        const pipe = vi.spyOn(stream, 'pipe').mockImplementation(() => {
            throw failure;
        });
        try {
            await expect(harness.model.doRecord()).rejects.toBe(failure);

            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(fileHandle.writeFile('late write')).rejects.toThrow();
        } finally {
            pipe.mockRestore();
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] unlinks and closes the exact exclusive handle at the five-second first-data timeout', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-first-data-fs-'));
        const fullPath = join(root, 'owned.ts');
        const fileHandle = await open(fullPath, 'wx');
        const stream = new PassThrough();
        const harness = makeRecorder({
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'owned.ts',
                    fullPath,
                    fileHandle,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
            },
        });
        harness.model.reserve = makeReserve({ id: 811 });
        harness.model.stream = stream;
        try {
            const recording = harness.model.doRecord();
            const rejected = expect(recording).rejects.toThrow('recordingStartError');

            await vi.advanceTimersByTimeAsync(4_999);
            await expect(stat(fullPath)).resolves.toMatchObject({});
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1);
            await rejected;
            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(fileHandle.writeFile('late write')).rejects.toThrow();
            stream.write('late first data');
            await Promise.resolve();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        } finally {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5] keeps its actual writer and file handle until the sixty-second deletion barrier, then releases both', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-deletion-barrier-fs-'));
        const fullPath = join(root, 'owned.ts');
        const fileHandle = await open(fullPath, 'wx');
        const writer = fileHandle.createWriteStream();
        const stream = new PassThrough();
        const harness = makeRecorder();
        harness.model.reserve = makeReserve({ id: 810 });
        harness.model.stream = stream;
        harness.model.recFile = writer;
        harness.model.isRecording = true;
        const end = writer.end.bind(writer);
        writer.end = vi.fn();
        let settlement: unknown;
        const stopping = harness.model.cancel(true).then(
            () => {
                settlement = 'resolved';
            },
            error => {
                settlement = error;
            },
        );
        try {
            await vi.advanceTimersByTimeAsync(59_999);
            expect(settlement).toBeUndefined();
            await expect(stat(fullPath)).resolves.toMatchObject({});
            expect(writer.closed).toBe(false);

            await vi.advanceTimersByTimeAsync(1);
            await stopping;
            expect(settlement).toMatchObject({ message: 'DeletionStopTimeoutError' });
            await expect(stat(fullPath)).resolves.toMatchObject({});
            expect(writer.closed).toBe(false);

            writer.end = end;
            writer.destroy();
            await harness.model.whenDeletionTerminal();
            await expect(fileHandle.writeFile('late write')).rejects.toThrow();
            expect(writer.closed).toBe(true);
        } finally {
            writer.destroy();
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.3][RE-4.7] closes and unlinks only the rejected registration session partial file', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-registration-fs-'));
        const fullPath = join(root, 'owned.ts');
        const otherPath = join(root, 'other.ts');
        const fileHandle = await open(fullPath, 'wx');
        const stream = new PassThrough();
        await writeFile(otherPath, 'other recording', 'utf8');
        const harness = makeRecorder({
            recordedDB: {
                insertOnce: vi.fn(async () => 21),
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(),
            },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'owned.ts',
                    fullPath,
                    fileHandle,
                })),
            },
            videoFileDB: { insertOnce: vi.fn(async () => Promise.reject(new Error('synthetic video-file rejection'))) },
        });
        harness.model.reserve = makeReserve();
        harness.model.stream = stream;
        const once = vi.spyOn(stream, 'once');
        try {
            const recording = harness.model.doRecord();
            await new Promise(resolve => setImmediate(resolve));
            const dataListener = once.mock.calls.find(([event]) => event === 'data')?.[1] as
                | (() => Promise<void>)
                | undefined;
            expect(dataListener).toBeTypeOf('function');
            await expect(dataListener!()).resolves.toBeUndefined();
            await expect(recording).rejects.toThrow('AddRecordedDBError');

            await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(otherPath, 'utf8')).resolves.toBe('other recording');
            await expect(fileHandle.writeFile('late write')).rejects.toThrow();
            expect(harness.recordingEvent.emitStartRecording).not.toHaveBeenCalled();
        } finally {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            once.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 5.5][RE-4.9][RE-4.10] keeps the owned file through registration overdue without timing out the active body', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-registration-overdue-fs-'));
        const fullPath = join(root, 'owned.ts');
        const stream = new PassThrough();
        const videoInsert = deferred<number>();
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        const harness = makeRecorder({
            recordedDB: { insertOnce: vi.fn(async () => 21), removeRecording: vi.fn(), findId: vi.fn() },
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'owned.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
            },
            videoFileDB: { insertOnce: vi.fn(() => videoInsert.promise) },
        });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.stream = stream;
        harness.model.setEndProcess = vi.fn();
        harness.model.setEventRelayTimer = vi.fn();

        const started = harness.model.doRecord();
        try {
            await vi.waitFor(() => expect(stat(fullPath)).resolves.toMatchObject({}));
            stream.write('synthetic first packet');
            for (let turn = 0; turn < 5 && harness.videoFileDB.insertOnce.mock.calls.length === 0; turn += 1) {
                await Promise.resolve();
            }
            expect(harness.videoFileDB.insertOnce).toHaveBeenCalledOnce();

            await vi.advanceTimersByTimeAsync(600_000);
            expect(session.state.phase).toBe('RegistrationOverdue');
            await expect(stat(fullPath)).resolves.toMatchObject({});
            expect(stream.destroyed).toBe(false);
            expect(harness.model.recFile).not.toBeNull();

            videoInsert.resolve(31);
            await started;
            await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);

            expect(session.state.phase).toBe('Recording');
            await expect(stat(fullPath)).resolves.toMatchObject({});
            expect(stream.destroyed).toBe(false);
            expect(harness.recordingEvent.emitStartRecording).toHaveBeenCalledOnce();
        } finally {
            videoInsert.resolve(31);
            await started.catch(() => undefined);
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });
});

