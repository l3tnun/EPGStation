import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
    cleanupHarness,
    FileUtil,
    makeChild,
    makeModel,
    permitSyntheticCleanupRoot,
    prepareCreate,
    processStubs,
    restoreSpawn,
    settleChild,
} from './_thumbnail-harness';

afterEach(cleanupHarness);
afterAll(restoreSpawn);

describe('delete-regenerate-cleanup-restart-and-resource-release thumbnail maintenance implementation branches', () => {
    it('[TM-IMP-PREPARE] checks both video boundaries and stops before filesystem/process work when either is absent', async () => {
        const missingRow = makeModel();
        missingRow.videoFileDB.findId.mockResolvedValue(null);
        missingRow.model.add(151);
        await vi.waitFor(() => expect(missingRow.log.system.error).toHaveBeenCalled());

        const missingPath = makeModel();
        missingPath.videoUtil.getFullFilePathFromId.mockResolvedValue(null);
        missingPath.model.add(152);
        await vi.waitFor(() => expect(missingPath.log.system.error).toHaveBeenCalled());

        expect(processStubs.spawn).not.toHaveBeenCalled();
        expect(missingRow.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(missingPath.thumbnailDB.insertOnce).not.toHaveBeenCalled();
    });

    it('[TM-2.4-MKDIR-FAILURE] propagates a thumbnail directory creation failure without spawning or registering', async () => {
        prepareCreate();
        vi.mocked(FileUtil.access).mockRejectedValueOnce(
            Object.assign(new Error('synthetic-missing'), { code: 'ENOENT' }),
        );
        const failure = new Error('synthetic-mkdir-denied');
        vi.mocked(FileUtil.mkdir).mockRejectedValueOnce(failure);
        const fixture = makeModel();
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(181);
        await vi.waitFor(() => expect(fixture.log.system.error).toHaveBeenCalledWith(failure));

        expect(fixture.log.system.error).toHaveBeenCalledWith('create thumbnail error: 181');
        expect(FileUtil.mkdir).toHaveBeenCalledOnce();
        expect(FileUtil.mkdir).toHaveBeenCalledWith('synthetic-thumbnail-root');
        expect(processStubs.spawn).not.toHaveBeenCalled();
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();

        fixture.model.add(182);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(1));
        settleChild(child, 0);
        await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledTimes(1));
    });

    it('[TM-IMP-DELETE-ORDER] leaves the DB deletion committed when unlink rejects and emits only on full success', async () => {
        const fixture = makeModel();
        const rows = new Map([[161, { id: 161, filePath: 'synthetic-delete.jpg' }]]);
        const ledger: string[] = [];
        fixture.thumbnailDB.findId.mockImplementation(async id => rows.get(id) ?? null);
        fixture.thumbnailDB.deleteOnce.mockImplementation(async id => {
            ledger.push(`delete:${id}`);
            rows.delete(id);
        });
        const failure = new Error('synthetic-unlink-failure');
        vi.spyOn(FileUtil, 'unlink').mockRejectedValue(failure);

        await expect(fixture.model.delete(161)).rejects.toBe(failure);
        expect(ledger).toEqual(['delete:161']);
        expect(rows.size).toBe(0);
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitDeleted).not.toHaveBeenCalled();
    });

    it('[TM-IMP-REGENERATE] deletes each missing row but admits only the first video for records with no usable JPEG', async () => {
        const fixture = makeModel();
        fixture.recordedDB.findAll.mockResolvedValue([
            [
                { id: 171, thumbnails: [], videoFiles: [{ id: 1711 }, { id: 1712 }] },
                {
                    id: 172,
                    thumbnails: [{ id: 1721, filePath: 'synthetic-missing.jpg' }],
                    videoFiles: [{ id: 1722 }],
                },
                {
                    id: 173,
                    thumbnails: [{ id: 1731, filePath: 'synthetic-present.jpg' }],
                    videoFiles: [{ id: 1732 }],
                },
            ],
            3,
        ]);
        vi.spyOn(FileUtil, 'stat').mockImplementation(async (file: unknown) => {
            if (String(file).endsWith('synthetic-present.jpg')) return {};
            throw new Error('synthetic-missing');
        });
        fixture.model.add = vi.fn();

        await fixture.model.regenerate();

        expect(fixture.thumbnailDB.deleteOnce).toHaveBeenCalledWith(1721);
        expect(fixture.model.add.mock.calls).toEqual([[1711], [1722]]);
    });

    it('[TM-IMP-REGENERATE-ADMISSION] isolates a full queue to one recorded target and preserves accepted requests', async () => {
        const fixture = makeModel();
        const failure = new Error('ThumbnailQueueIsFull');
        fixture.recordedDB.findAll.mockResolvedValue([
            [
                { id: 174, thumbnails: [], videoFiles: [{ id: 1741 }] },
                {
                    id: 175,
                    thumbnails: [{ id: 1750, filePath: 'synthetic-missing-admission.jpg' }],
                    videoFiles: [{ id: 1751 }],
                },
                { id: 176, thumbnails: [], videoFiles: [{ id: 1761 }] },
            ],
            3,
        ]);
        vi.spyOn(FileUtil, 'stat').mockRejectedValue(new Error('synthetic-missing-admission'));
        fixture.model.add = vi
            .fn()
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => {
                throw failure;
            })
            .mockImplementationOnce(() => undefined);

        await fixture.model.regenerate();

        expect(fixture.thumbnailDB.deleteOnce).toHaveBeenCalledWith(1750);
        expect(fixture.model.add.mock.calls).toEqual([[1741], [1751], [1761]]);
        expect(fixture.log.system.error.mock.calls).toContainEqual([
            'failed to add regenerated thumbnail: recordedId=175, videoFileId=1751',
        ]);
        expect(
            fixture.log.system.error.mock.calls.filter(
                ([value]) => value === 'failed to add regenerated thumbnail: recordedId=175, videoFileId=1751',
            ),
        ).toHaveLength(1);
        expect(fixture.log.system.error.mock.calls.filter(([value]) => value === failure)).toEqual([[failure]]);
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
    });

    it('[TM-IMP-CLEANUP-CONTINUE] continues after local DB and unlink failures and never admits generation', async () => {
        permitSyntheticCleanupRoot();
        const fixture = makeModel();
        fixture.thumbnailDB.findAll.mockResolvedValue([
            { id: 181, filePath: 'synthetic-missing-a.jpg' },
            { id: 182, filePath: 'synthetic-missing-b.jpg' },
        ]);
        fixture.thumbnailDB.deleteOnce
            .mockRejectedValueOnce(new Error('synthetic-db-failure'))
            .mockResolvedValueOnce(undefined);
        vi.spyOn(FileUtil, 'stat').mockRejectedValue(new Error('synthetic-missing'));
        vi.spyOn(FileUtil, 'getFileList').mockResolvedValue({
            directories: [],
            files: [
                'synthetic-thumbnail-root/synthetic-orphan-a.jpg',
                'synthetic-thumbnail-root/synthetic-orphan-b.jpg',
            ],
        });
        vi.spyOn(FileUtil, 'unlink')
            .mockRejectedValueOnce(new Error('synthetic-unlink-failure'))
            .mockResolvedValueOnce(undefined);
        fixture.model.add = vi.fn();

        await fixture.model.fileCleanup();

        expect(fixture.thumbnailDB.deleteOnce).toHaveBeenCalledTimes(2);
        expect(FileUtil.unlink).toHaveBeenCalledTimes(2);
        expect(fixture.model.add).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
    });

    it('[TM-IMP-MAINTENANCE-ISOLATION] keeps later regeneration and cleanup targets independent after earlier local failures', async () => {
        permitSyntheticCleanupRoot();
        const fixture = makeModel();
        const regenerationFailure = new Error('synthetic-regeneration-delete-failure');
        fixture.recordedDB.findAll.mockResolvedValue([
            [
                {
                    id: 183,
                    thumbnails: [{ id: 1831, filePath: 'synthetic-missing-regeneration-a.jpg' }],
                    videoFiles: [{ id: 1832 }],
                },
                { id: 184, thumbnails: [], videoFiles: [{ id: 1841 }] },
            ],
            2,
        ]);
        fixture.thumbnailDB.deleteOnce.mockRejectedValueOnce(regenerationFailure).mockResolvedValue(undefined);
        vi.spyOn(FileUtil, 'stat').mockRejectedValue(new Error('synthetic-missing'));
        fixture.model.add = vi.fn();

        await fixture.model.regenerate();

        expect(fixture.model.add.mock.calls).toEqual([[1832], [1841]]);
        expect(fixture.log.system.error).toHaveBeenCalledWith(regenerationFailure);
    });

    it('[TM-IMP-RESTART] gives a new instance an independent actual queue and accepts explicit maintenance', async () => {
        permitSyntheticCleanupRoot();
        prepareCreate();
        const runningChild = makeChild();
        const waitingChild = makeChild();
        processStubs.spawn.mockReturnValueOnce(runningChild).mockReturnValueOnce(waitingChild);
        const oldInstance = makeModel({ config: { thumbnail: 'synthetic-old-thumbnail-root' } });
        oldInstance.model.add(191);
        oldInstance.model.add(192);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(1));

        const restarted = makeModel({ config: { thumbnail: 'synthetic-new-thumbnail-root' } });
        vi.spyOn(FileUtil, 'getFileList').mockResolvedValue({ directories: [], files: [] });

        await restarted.model.regenerate();
        await restarted.model.fileCleanup();

        expect(processStubs.spawn).toHaveBeenCalledTimes(1);
        expect(restarted.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(restarted.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
        expect(restarted.recordedDB.findAll).toHaveBeenCalledOnce();
        expect(restarted.thumbnailDB.findAll).toHaveBeenCalledTimes(2);

        settleChild(runningChild, 0);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));
        expect(restarted.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(restarted.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
        settleChild(waitingChild, 0);
        await vi.waitFor(() => expect(oldInstance.thumbnailDB.insertOnce).toHaveBeenCalledTimes(2));
    });

    it('[TM-IMP-STDOUT-DRAIN] drains child stdout without side effects during generation', async () => {
        prepareCreate();
        const fixture = makeModel();
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(602);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());

        child.stdout!.write('synthetic ffmpeg stdout chatter');
        // The stdout data handler is a pure drain (`child.stdout!.on('data', () => {})`) with no
        // other effect, so writing to it must not itself trigger (or otherwise influence)
        // generation completion before the child actually exits.
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();

        settleChild(child, 0);
        await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce());
    });

    it('[TM-IMP-CLEANUP-ACTIVE-TEMP] preserves a file inside an active reservation temporary directory during fileCleanup', async () => {
        permitSyntheticCleanupRoot();
        const fixture = makeModel();
        const temporaryDirectory = 'synthetic-thumbnail-root/.thumbnail-active';
        fixture.model.activeReservations.add({
            fileName: 'synthetic.jpg',
            finalPath: 'synthetic-thumbnail-root/synthetic-final.jpg',
            published: false,
            released: false,
            reservationId: 'synthetic-active-reservation',
            requestId: 1,
            temporaryDirectory,
            temporaryPath: `${temporaryDirectory}/thumbnail.jpg`,
        });
        vi.spyOn(FileUtil, 'getFileList').mockResolvedValue({
            directories: [],
            files: [`${temporaryDirectory}/thumbnail.jpg`],
        });
        const unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);

        await fixture.model.fileCleanup();

        expect(unlink).not.toHaveBeenCalled();
    });
});
