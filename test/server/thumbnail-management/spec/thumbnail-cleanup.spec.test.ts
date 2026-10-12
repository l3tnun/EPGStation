import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '../../harness/async';
import {
    cleanupHarness,
    FileUtil,
    makeChild,
    makeModel,
    permitSyntheticCleanupRoot,
    processStubs,
    restoreSpawn,
    settleChild,
} from '../imp/_thumbnail-harness';

const temporaryRoots: string[] = [];

afterEach(async () => {
    cleanupHarness();
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { force: true, recursive: true })));
});
afterAll(restoreSpawn);

describe('thumbnail cleanup characterization', () => {
    it('[TM-5.3] does not follow a thumbnail root replaced by an external symlink after enumeration', async () => {
        const parent = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-cleanup-'));
        temporaryRoots.push(parent);
        const root = join(parent, 'managed');
        const displacedRoot = join(parent, '.displaced-root');
        const externalDirectory = join(parent, 'external-directory');
        const listedFile = join(root, 'orphan.jpg');
        const displacedFile = join(displacedRoot, 'orphan.jpg');
        const externalFile = join(externalDirectory, 'orphan.jpg');
        await Promise.all([mkdir(root), mkdir(externalDirectory)]);
        await Promise.all([writeFile(listedFile, 'managed-bytes'), writeFile(externalFile, 'external-bytes')]);
        const actualGetFileList = FileUtil.getFileList.bind(FileUtil);
        vi.spyOn(FileUtil, 'getFileList').mockImplementation(async (managedRoot: string) => {
            const list = await actualGetFileList(managedRoot);
            await rename(root, displacedRoot);
            await symlink(externalDirectory, root, 'dir');
            return list;
        });
        const fixture = makeModel({ config: { thumbnail: root } });

        await fixture.model.fileCleanup();

        await expect(readFile(externalFile, 'utf8')).resolves.toBe('external-bytes');
        await expect(readFile(displacedFile, 'utf8')).resolves.toBe('managed-bytes');

        const parentReplacement = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-cleanup-'));
        temporaryRoots.push(parentReplacement);
        const parentRoot = join(parentReplacement, 'managed');
        const listedParent = join(parentRoot, 'listed-parent');
        const displacedParent = join(parentRoot, '.displaced-parent');
        const externalParent = join(parentReplacement, 'external-directory');
        const parentListedFile = join(listedParent, 'orphan.jpg');
        const parentDisplacedFile = join(displacedParent, 'orphan.jpg');
        const parentExternalFile = join(externalParent, 'orphan.jpg');
        await Promise.all([mkdir(listedParent, { recursive: true }), mkdir(externalParent)]);
        await Promise.all([
            writeFile(parentListedFile, 'managed-bytes'),
            writeFile(parentExternalFile, 'external-bytes'),
        ]);
        const originalList = actualGetFileList;
        vi.spyOn(FileUtil, 'getFileList').mockImplementationOnce(async (managedRoot: string) => {
            const list = await originalList(managedRoot);
            await rename(listedParent, displacedParent);
            await symlink(externalParent, listedParent, 'dir');
            return list;
        });
        const parentFixture = makeModel({ config: { thumbnail: parentRoot } });

        await parentFixture.model.fileCleanup();

        await expect(readFile(parentExternalFile, 'utf8')).resolves.toBe('external-bytes');
        await expect(readFile(parentDisplacedFile, 'utf8')).resolves.toBe('managed-bytes');

        const activeRoot = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-cleanup-'));
        temporaryRoots.push(activeRoot);
        const activeFinal = join(activeRoot, '101.jpg');
        const activeFixture = makeModel({ config: { thumbnail: activeRoot } });
        const refreshedRows = createDeferred<{ id: number; filePath: string }[]>();
        activeFixture.thumbnailDB.findAll.mockResolvedValueOnce([]).mockReturnValueOnce(refreshedRows.promise);
        // Vitest 5's `vi.spyOn` keeps the prior spy's call history when re-spying an
        // already-spied method (Vitest 3 started each re-spy with a fresh call count). This test
        // re-spies `FileUtil.getFileList` twice earlier for unrelated fixtures, so `mockClear()`
        // resets the call count baseline before asserting this fixture's own single call below.
        vi.spyOn(FileUtil, 'getFileList')
            .mockResolvedValue({ directories: [], files: [activeFinal] })
            .mockClear();
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        activeFixture.model.add(951);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
        const args = processStubs.spawn.mock.calls[0][1] as string[];
        await writeFile(args[args.indexOf('--output') + 1]!, 'generated-jpeg');
        const cleanup = activeFixture.model.fileCleanup();
        await vi.waitFor(() => expect(FileUtil.getFileList).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(activeFixture.thumbnailDB.findAll).toHaveBeenCalledTimes(2));

        settleChild(child, 0);
        await vi.waitFor(() => expect(activeFixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce());
        await vi.waitFor(async () => expect(await readdir(activeRoot)).toEqual(['101.jpg']));
        refreshedRows.resolve([]);
        await cleanup;

        await expect(readFile(activeFinal, 'utf8')).resolves.toBe('generated-jpeg');
        vi.mocked(FileUtil.getFileList).mockRestore();

        const refreshedRoot = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-cleanup-'));
        temporaryRoots.push(refreshedRoot);
        const refreshedFinal = join(refreshedRoot, '101.jpg');
        await writeFile(refreshedFinal, 'registered-jpeg');
        const refreshedFixture = makeModel({ config: { thumbnail: refreshedRoot } });
        refreshedFixture.thumbnailDB.findAll
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ id: 101, filePath: '101.jpg' }]);

        await refreshedFixture.model.fileCleanup();

        await expect(readFile(refreshedFinal, 'utf8')).resolves.toBe('registered-jpeg');
    });

    it('[TM-5.1] reconciles database registrations against the thumbnail directory', async () => {
        permitSyntheticCleanupRoot();
        const fixture = makeModel();
        fixture.thumbnailDB.findAll.mockResolvedValue([
            { id: 91, filePath: 'synthetic-present.jpg' },
            { id: 92, filePath: 'synthetic-missing.jpg' },
        ]);
        vi.spyOn(FileUtil, 'stat').mockImplementation(async (file: unknown) => {
            if (String(file).endsWith('synthetic-present.jpg')) return {};
            throw new Error('synthetic-missing');
        });
        vi.spyOn(FileUtil, 'getFileList').mockResolvedValue({
            directories: [],
            files: ['synthetic-thumbnail-root/synthetic-present.jpg', 'synthetic-thumbnail-root/synthetic-orphan.jpg'],
        });
        vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);

        await fixture.model.fileCleanup();

        expect(fixture.thumbnailDB.deleteOnce).toHaveBeenCalledWith(92);
        expect(FileUtil.unlink).toHaveBeenCalledOnce();
        expect(FileUtil.unlink).toHaveBeenCalledWith('synthetic-thumbnail-root/synthetic-orphan.jpg');
    });

    it('[TM-5.2] removes a missing database-only registration without admitting JPEG generation', async () => {
        permitSyntheticCleanupRoot();
        const fixture = makeModel();
        fixture.model.add = vi.fn();
        fixture.thumbnailDB.findAll.mockResolvedValue([{ id: 921, filePath: 'synthetic-db-only-missing.jpg' }]);
        vi.spyOn(FileUtil, 'stat').mockRejectedValue(new Error('synthetic-missing'));
        vi.spyOn(FileUtil, 'getFileList').mockResolvedValue({ directories: [], files: [] });
        const unlink = vi.spyOn(FileUtil, 'unlink');

        await fixture.model.fileCleanup();

        expect(fixture.thumbnailDB.deleteOnce).toHaveBeenCalledExactlyOnceWith(921);
        expect(unlink).not.toHaveBeenCalled();
        expect(fixture.model.add).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
    });

    it('[TM-5.4] records local failures and continues reconciling later targets', async () => {
        permitSyntheticCleanupRoot();
        const fixture = makeModel();
        const dbFailure = new Error('synthetic-db-delete-failure');
        const fileFailure = new Error('synthetic-file-delete-failure');
        fixture.thumbnailDB.findAll.mockResolvedValue([
            { id: 93, filePath: 'synthetic-missing-a.jpg' },
            { id: 94, filePath: 'synthetic-missing-b.jpg' },
        ]);
        fixture.thumbnailDB.deleteOnce.mockRejectedValueOnce(dbFailure).mockResolvedValueOnce(undefined);
        vi.spyOn(FileUtil, 'stat').mockRejectedValue(new Error('synthetic-missing'));
        vi.spyOn(FileUtil, 'getFileList').mockResolvedValue({
            directories: [],
            files: [
                'synthetic-thumbnail-root/synthetic-orphan-a.jpg',
                'synthetic-thumbnail-root/synthetic-orphan-b.jpg',
            ],
        });
        vi.spyOn(FileUtil, 'unlink').mockRejectedValueOnce(fileFailure).mockResolvedValueOnce(undefined);

        await fixture.model.fileCleanup();

        expect(fixture.thumbnailDB.deleteOnce).toHaveBeenCalledTimes(2);
        expect(fixture.thumbnailDB.deleteOnce).toHaveBeenNthCalledWith(2, 94);
        expect(FileUtil.unlink).toHaveBeenCalledTimes(2);
        expect(fixture.log.system.error.mock.calls.filter(([entry]) => entry === dbFailure)).toHaveLength(1);
        expect(fixture.log.system.error).toHaveBeenCalledWith(
            'failed to thumbnail file: synthetic-thumbnail-root/synthetic-orphan-a.jpg',
        );
        expect(fixture.log.system.error).toHaveBeenCalledWith(fileFailure);
    });

    it('[TM-5.5] never admits generation or emits an added event from cleanup', async () => {
        permitSyntheticCleanupRoot();
        const fixture = makeModel();
        fixture.model.add = vi.fn();
        vi.spyOn(FileUtil, 'getFileList').mockResolvedValue({ directories: [], files: [] });

        await fixture.model.fileCleanup();

        expect(fixture.model.add).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
    });
});
