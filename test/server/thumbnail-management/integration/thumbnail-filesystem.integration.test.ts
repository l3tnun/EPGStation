import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
    cleanupHarness,
    FileUtil,
    makeChild,
    makeModel,
    processStubs,
    restoreSpawn,
    settleChild,
} from '../imp/_thumbnail-harness';

afterEach(cleanupHarness);
afterAll(restoreSpawn);

describe('thumbnail filesystem integration', () => {
    it('[TM-7.4-filesystem] exclusive-claim-temporary-publish-reconcile-and-cleanup preserves the reserved final and removes owned resources', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-filesystem-'));
        try {
            const preserved = join(root, '101.jpg');
            await writeFile(preserved, 'preserved-jpeg');
            const fixture = makeModel({ config: { thumbnail: root } });
            const child = makeChild();
            processStubs.spawn.mockReturnValue(child);

            fixture.model.add(801);
            await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
            const args = processStubs.spawn.mock.calls[0][1] as string[];
            const temporaryPath = args[args.indexOf('--output') + 1]!;
            const finalPath = join(root, '101(1).jpg');
            const unregistered = join(root, 'unregistered.jpg');
            expect(temporaryPath).toContain(`${join(root, '.thumbnail-')}`);
            expect(temporaryPath).not.toBe(finalPath);

            await writeFile(finalPath, 'active-reservation-jpeg');
            await writeFile(unregistered, 'unregistered-jpeg');
            fixture.thumbnailDB.findAll.mockResolvedValue([{ id: 99, filePath: '101.jpg' }]);
            await fixture.model.fileCleanup();
            await expect(readFile(finalPath, 'utf8')).resolves.toBe('active-reservation-jpeg');
            await expect(readFile(unregistered, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

            await writeFile(temporaryPath, 'synthetic-jpeg');
            settleChild(child, 0);
            await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce());

            await expect(readFile(finalPath, 'utf8')).resolves.toBe('synthetic-jpeg');
            await expect(readFile(preserved, 'utf8')).resolves.toBe('preserved-jpeg');
            await expect(readFile(temporaryPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
            await writeFile(unregistered, 'unregistered-jpeg');
            fixture.thumbnailDB.findAll.mockResolvedValue([
                { id: 99, filePath: '101.jpg' },
                { id: 1, filePath: '101(1).jpg' },
                { id: 2, filePath: 'missing.jpg' },
            ]);
            await fixture.model.fileCleanup();
            await expect(readFile(finalPath, 'utf8')).resolves.toBe('synthetic-jpeg');
            await expect(readFile(unregistered, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
            expect(fixture.thumbnailDB.deleteOnce).toHaveBeenCalledWith(2);
            fixture.thumbnailDB.findId.mockResolvedValue({ filePath: '101(1).jpg', recordedId: 101 });
            await fixture.model.delete(1);

            await expect(readFile(finalPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(preserved, 'utf8')).resolves.toBe('preserved-jpeg');
            expect(fixture.thumbnailDB.deleteOnce).toHaveBeenCalledWith(1);
            expect(fixture.thumbnailEvent.emitDeleted).toHaveBeenCalledOnce();

            const failedFixture = makeModel({ config: { thumbnail: root } });
            const failedChild = makeChild();
            processStubs.spawn.mockReset().mockReturnValueOnce(failedChild);
            const unlink = vi.spyOn(FileUtil, 'unlink');
            failedFixture.model.add(802);
            await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
            const failedArgs = processStubs.spawn.mock.calls[0][1] as string[];
            const failedTemporary = failedArgs[failedArgs.indexOf('--output') + 1]!;
            const failedFileName = (await readdir(root)).find(file => file.startsWith('101') && file !== '101.jpg');
            expect(failedFileName).toBeDefined();
            const failedFinal = join(root, failedFileName!);
            await writeFile(failedTemporary, 'failed-owned-jpeg');
            settleChild(failedChild, 1);
            await vi.waitFor(() => expect(unlink).toHaveBeenCalledWith(failedTemporary));
            await vi.waitFor(() => expect(unlink).toHaveBeenCalledWith(failedFinal));
            expect(unlink.mock.calls.map(([path]) => path)).toEqual([failedTemporary, failedFinal]);
            await expect(readFile(failedTemporary, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(failedFinal, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(preserved, 'utf8')).resolves.toBe('preserved-jpeg');
        } finally {
            await rm(root, { force: true, recursive: true });
            await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
        }
    });
});
