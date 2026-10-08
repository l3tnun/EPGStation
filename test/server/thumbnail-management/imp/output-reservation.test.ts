import * as fs from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '../../harness/async';
import {
    cleanupHarness,
    FileUtil,
    makeChild,
    makeModel,
    prepareCreate,
    processStubs,
    restoreSpawn,
    settleChild,
} from './_thumbnail-harness';

const temporaryRoots: string[] = [];

const outputPathFrom = (spawnCall: unknown[]): string => {
    const args = spawnCall[1] as string[];
    return args[args.indexOf('--output') + 1];
};

afterEach(async () => {
    cleanupHarness();
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { force: true, recursive: true })));
});
afterAll(restoreSpawn);

describe('exclusive-claim-temporary-publish-cleanup-and-same-name-race thumbnail output reservation', () => {
    it('[TM-2.7][TM-5.1][TM-5.3] claims a suffix, gives the child a request-only path, and excludes the active claim from cleanup', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-output-'));
        temporaryRoots.push(root);
        const standardPath = join(root, '101.jpg');
        const numberedPath = join(root, '101(1).jpg');
        const fixture = makeModel({ config: { thumbnail: root } });
        fixture.thumbnailDB.findAll.mockResolvedValue([{ id: 9010, filePath: '101.jpg' }]);
        const actualOpen = fs.promises.open;
        let standardAttempts = 0;
        vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
            const [candidate] = args;
            if (candidate === root) {
                throw Object.assign(new Error('synthetic-empty-output-name'), { code: 'EACCES' });
            }
            if (candidate === standardPath) {
                standardAttempts++;
                throw Object.assign(new Error('synthetic-output-conflict'), {
                    code: standardAttempts === 1 ? 'EEXIST' : 'EACCES',
                });
            }
            return actualOpen(...args);
        });
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(901);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
        expect(fs.promises.open).toHaveBeenNthCalledWith(1, standardPath, 'wx');
        expect(fs.promises.open).toHaveBeenNthCalledWith(2, numberedPath, 'wx');
        const temporaryOutput = outputPathFrom(processStubs.spawn.mock.calls[0]);

        expect(temporaryOutput).not.toBe(join(root, '101(1).jpg'));
        expect(temporaryOutput).toContain('.thumbnail-');
        await writeFile(temporaryOutput, 'generated-jpeg');
        await fixture.model.fileCleanup();
        await expect(readFile(numberedPath, 'utf8')).resolves.toBe('');

        settleChild(child, 0);
        await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce());

        expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledWith(
            expect.objectContaining({ filePath: '101(1).jpg', recordedId: 101 }),
        );
        await expect(readFile(numberedPath, 'utf8')).resolves.toBe('generated-jpeg');
        await expect(readdir(root)).resolves.toEqual(['101(1).jpg']);
    });

    it('[TM-5.3] keeps an active final reservation when the configured root is relative', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-output-'));
        temporaryRoots.push(root);
        const fixture = makeModel({ config: { thumbnail: relative(process.cwd(), root) } });
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(9011);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
        await fixture.model.fileCleanup();

        await expect(readFile(join(root, '101.jpg'), 'utf8')).resolves.toBe('');
    });

    it('[TM-5.3] retains a final committed and released while cleanup refreshes stale DB rows', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-output-'));
        temporaryRoots.push(root);
        const finalPath = join(root, '101.jpg');
        const fixture = makeModel({ config: { thumbnail: root } });
        const listedFiles = createDeferred<{ directories: string[]; files: string[] }>();
        const refreshedRows = createDeferred<{ id: number; filePath: string }[]>();
        fixture.thumbnailDB.findAll.mockResolvedValueOnce([]).mockReturnValueOnce(refreshedRows.promise);
        vi.spyOn(FileUtil, 'getFileList').mockReturnValueOnce(listedFiles.promise);
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(9012);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
        await writeFile(outputPathFrom(processStubs.spawn.mock.calls[0]), 'generated-jpeg');
        const cleanup = fixture.model.fileCleanup();
        await vi.waitFor(() => expect(FileUtil.getFileList).toHaveBeenCalledOnce());
        listedFiles.resolve({ directories: [], files: [finalPath] });
        await vi.waitFor(() => expect(fixture.thumbnailDB.findAll).toHaveBeenCalledTimes(2));

        settleChild(child, 0);
        await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce());
        await vi.waitFor(async () => expect(await readdir(root)).toEqual(['101.jpg']));
        refreshedRows.resolve([]);
        await cleanup;

        await expect(readFile(finalPath, 'utf8')).resolves.toBe('generated-jpeg');
    });

    it('[TM-5.3] recognizes only the active final, temporary file, and temporary directory paths', () => {
        const root = 'synthetic-thumbnail-root';
        const temporaryDirectory = join(root, '.thumbnail-active-request');
        const temporaryPath = join(temporaryDirectory, 'thumbnail.jpg');
        const fixture = makeModel({ config: { thumbnail: root } });
        fixture.model.activeReservations.add({
            finalPath: join(root, '101.jpg'),
            temporaryDirectory,
            temporaryPath,
        });
        fixture.model.activeReservations.add({
            finalPath: join(root, '102.jpg'),
            temporaryDirectory: null,
            temporaryPath: null,
        });

        expect(fixture.model.isActiveReservationPath(join(root, '101.jpg'))).toBe(true);
        expect(fixture.model.isActiveReservationPath(temporaryPath)).toBe(true);
        expect(fixture.model.isActiveReservationPath(temporaryDirectory)).toBe(true);
        expect(fixture.model.isActiveReservationPath(join(temporaryDirectory, 'nested-output.jpg'))).toBe(true);
        expect(fixture.model.isActiveReservationPath(join(root, '.thumbnail-active-request-other', 'thumbnail.jpg'))).toBe(
            false,
        );
        expect(fixture.model.isActiveReservationPath(join(root, 'unrelated.jpg'))).toBe(false);
    });

    it('[TM-2.12] releases a claimed final and its request directory when command parsing fails', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-output-'));
        temporaryRoots.push(root);
        const fixture = makeModel({
            config: { thumbnail: root, thumbnailCmd: '/synthetic-command-that-does-not-exist %OUTPUT%' },
        });

        fixture.model.add(9012);
        await vi.waitFor(() =>
            expect(fixture.log.system.error).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'CmdBinIsNotFound' }),
            ),
        );

        await expect(readdir(root)).resolves.toEqual([]);
    });

    it.each([
        ['empty', '', { message: 'CmdBinIsNotFound' }],
        ['null', null, { name: 'TypeError' }],
    ])(
        '[TM-2.13] does not spawn and releases the claimed final and request directory when thumbnailCmd is %s',
        async (_label, thumbnailCmd, expectedError) => {
            const root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-output-'));
            temporaryRoots.push(root);
            const fixture = makeModel({ config: { thumbnail: root, thumbnailCmd } });

            fixture.model.add(9013);
            await vi.waitFor(() =>
                expect(fixture.log.system.error).toHaveBeenCalledWith(expect.objectContaining(expectedError)),
            );

            expect(fixture.log.system.error).toHaveBeenCalledWith('create thumbnail error: 9013');
            expect(processStubs.spawn).not.toHaveBeenCalled();
            expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
            expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
            await expect(readdir(root)).resolves.toEqual([]);
        },
    );

    it('[TM-2.7] gives simultaneous model instances distinct exclusively claimed finals for the same recorded item', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-output-'));
        temporaryRoots.push(root);
        const first = makeModel({ config: { thumbnail: root } });
        const second = makeModel({ config: { thumbnail: root } });
        const firstChild = makeChild();
        const secondChild = makeChild();
        processStubs.spawn.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
        const standardPath = join(root, '101.jpg');
        const numberedPath = join(root, '101(1).jpg');
        const actualOpen = fs.promises.open;
        let standardAttempts = 0;
        vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
            const [candidate] = args;
            if (candidate === root) {
                throw Object.assign(new Error('synthetic-empty-output-name'), { code: 'EACCES' });
            }
            if (candidate === standardPath) {
                standardAttempts++;
                if (standardAttempts === 1) {
                    return actualOpen(...args);
                }
                throw Object.assign(new Error('synthetic-output-conflict'), {
                    code: standardAttempts === 2 ? 'EEXIST' : 'EACCES',
                });
            }
            return actualOpen(...args);
        });

        first.model.add(902);
        second.model.add(903);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));
        expect(fs.promises.open).toHaveBeenNthCalledWith(1, standardPath, 'wx');
        expect(fs.promises.open).toHaveBeenNthCalledWith(2, standardPath, 'wx');
        expect(fs.promises.open).toHaveBeenNthCalledWith(3, numberedPath, 'wx');
        const firstOutput = outputPathFrom(processStubs.spawn.mock.calls[0]);
        const secondOutput = outputPathFrom(processStubs.spawn.mock.calls[1]);

        expect(firstOutput).not.toBe(secondOutput);
        await Promise.all([writeFile(firstOutput, 'first-jpeg'), writeFile(secondOutput, 'second-jpeg')]);
        settleChild(firstChild, 0);
        settleChild(secondChild, 0);
        await vi.waitFor(() => expect(first.thumbnailDB.insertOnce).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(second.thumbnailDB.insertOnce).toHaveBeenCalledOnce());

        expect(
            [first.thumbnailDB.insertOnce.mock.calls[0][0].filePath, second.thumbnailDB.insertOnce.mock.calls[0][0].filePath].sort(),
        ).toEqual(['101(1).jpg', '101.jpg']);
        expect(await readdir(root)).toEqual(['101(1).jpg', '101.jpg']);
    });

    it('[TM-2.12] records a DB failure by request and reservation identity and leaves an unrelated JPEG untouched', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-output-'));
        temporaryRoots.push(root);
        const preservedPath = join(root, 'preserved.jpg');
        await writeFile(preservedPath, 'preserved-jpeg');
        const fixture = makeModel({ config: { thumbnail: root } });
        const dbFailure = new Error('synthetic-thumbnail-db-failure');
        fixture.thumbnailDB.insertOnce.mockRejectedValue(dbFailure);
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(904);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
        await writeFile(outputPathFrom(processStubs.spawn.mock.calls[0]), 'generated-jpeg');
        settleChild(child, 0);

        await vi.waitFor(() =>
            expect(fixture.log.system.error).toHaveBeenCalledWith(
                'thumbnail database failed: requestId=thumbnail-request-1, reservationId=thumbnail-reservation-1',
            ),
        );
        await expect(readFile(preservedPath, 'utf8')).resolves.toBe('preserved-jpeg');
        await expect(readdir(root)).resolves.toEqual(['preserved.jpg']);
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
    });

    it('[TM-2.12] records publish and owned-cleanup failures separately without changing another JPEG', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-output-'));
        temporaryRoots.push(root);
        const preservedPath = join(root, 'preserved.jpg');
        await writeFile(preservedPath, 'preserved-jpeg');
        const fixture = makeModel({ config: { thumbnail: root } });
        const publishFailure = new Error('synthetic-publish-failure');
        const cleanupFailure = new Error('synthetic-cleanup-failure');
        vi.spyOn(FileUtil, 'copyFile').mockRejectedValue(publishFailure);
        vi.spyOn(FileUtil, 'unlink').mockRejectedValue(cleanupFailure);
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(905);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
        await writeFile(outputPathFrom(processStubs.spawn.mock.calls[0]), 'generated-jpeg');
        settleChild(child, 0);

        await vi.waitFor(() => expect(fixture.log.system.error).toHaveBeenCalledWith(publishFailure));
        expect(fixture.log.system.error).toHaveBeenCalledWith(
            'thumbnail publish failed: requestId=thumbnail-request-1, reservationId=thumbnail-reservation-1',
        );
        expect(
            fixture.log.system.error.mock.calls.filter(
                ([entry]) =>
                    typeof entry === 'string' &&
                    entry.includes('requestId=thumbnail-request-1, reservationId=thumbnail-reservation-1'),
            ),
        ).toHaveLength(3);
        await expect(readFile(preservedPath, 'utf8')).resolves.toBe('preserved-jpeg');
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
    });

    it('[TM-2.7] rethrows non-collision claims and releases a partially reserved final when temporary allocation fails', async () => {
        prepareCreate();
        const fixture = makeModel();
        const denied = Object.assign(new Error('synthetic-output-denied'), { code: 'EACCES' });
        const temporaryFailure = new Error('synthetic-temporary-directory-failure');
        vi.mocked(fs.promises.open).mockRejectedValueOnce(denied);

        await expect(fixture.model.reserveOutput(101, 'thumbnail-request-denied')).rejects.toBe(denied);
        expect(fs.promises.open).toHaveBeenCalledTimes(1);
        expect(fs.promises.mkdtemp).not.toHaveBeenCalled();

        vi.mocked(fs.promises.mkdtemp).mockRejectedValueOnce(temporaryFailure);
        await expect(fixture.model.reserveOutput(101, 'thumbnail-request-temporary')).rejects.toBe(temporaryFailure);
        expect(fixture.log.system.error).toHaveBeenCalledWith(
            'thumbnail reservation failed: requestId=thumbnail-request-temporary, reservationId=thumbnail-reservation-1',
        );
        expect(FileUtil.unlink).toHaveBeenCalledWith('synthetic-thumbnail-root/101.jpg');
    });

    it('[TM-2.7] preserves an unknown claim failure and publishes an owned temporary only once', async () => {
        prepareCreate();
        const fixture = makeModel();
        vi.mocked(fs.promises.open).mockRejectedValueOnce(undefined);

        await expect(fixture.model.reserveOutput(101, 'thumbnail-request-unknown')).rejects.toBeUndefined();

        const reservation = {
            fileName: '101.jpg',
            finalPath: 'synthetic-thumbnail-root/101.jpg',
            requestId: 'thumbnail-request-publish',
            reservationId: 'thumbnail-reservation-publish',
            temporaryDirectory: 'synthetic-thumbnail-root/.thumbnail-publish',
            temporaryPath: 'synthetic-thumbnail-root/.thumbnail-publish/thumbnail.jpg',
            published: false,
            released: false,
        };
        await fixture.model.publishOutput(reservation);
        await fixture.model.publishOutput(reservation);

        expect(fs.promises.stat).toHaveBeenCalledTimes(1);
        expect(FileUtil.copyFile).toHaveBeenCalledTimes(1);
        expect(reservation.published).toBe(true);

        vi.clearAllMocks();
        await fixture.model.publishOutput({ ...reservation, published: false, temporaryPath: null });
        expect(fs.promises.stat).not.toHaveBeenCalled();
        expect(FileUtil.copyFile).not.toHaveBeenCalled();
    });
});
