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
} from '../imp/_thumbnail-harness';

afterEach(cleanupHarness);
afterAll(restoreSpawn);

describe('thumbnail restart characterization', () => {
    it('[TM-6.1] keeps waiting and generating requests in the queue instance that accepted them', async () => {
        prepareCreate();
        const runningChild = makeChild();
        const restartedChild = makeChild();
        const waitingChild = makeChild();
        processStubs.spawn
            .mockReturnValueOnce(runningChild)
            .mockReturnValueOnce(restartedChild)
            .mockReturnValueOnce(waitingChild);
        const oldInstance = makeModel({ config: { thumbnail: 'synthetic-old-thumbnail-root' } });
        oldInstance.model.add(101);
        oldInstance.model.add(102);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(1));

        const restarted = makeModel({ config: { thumbnail: 'synthetic-new-thumbnail-root' } });

        expect(processStubs.spawn).toHaveBeenCalledTimes(1);
        expect(oldInstance.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(oldInstance.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
        expect(oldInstance.recordedDB.findAll).not.toHaveBeenCalled();
        expect(FileUtil.mkdir).not.toHaveBeenCalled();
        expect(FileUtil.unlink).not.toHaveBeenCalled();
        expect(restarted.thumbnailDB.findId).not.toHaveBeenCalled();
        expect(restarted.videoFileDB.findId).not.toHaveBeenCalled();
        expect(restarted.thumbnailDB.insertOnce).not.toHaveBeenCalled();

        restarted.recordedDB.findAll.mockResolvedValue([[{ id: 103, thumbnails: [], videoFiles: [{ id: 1031 }] }], 1]);
        permitSyntheticCleanupRoot();
        vi.spyOn(FileUtil, 'getFileList').mockResolvedValue({ directories: [], files: [] });
        await expect(restarted.model.regenerate()).resolves.toBeUndefined();
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));
        settleChild(restartedChild, 0);
        await vi.waitFor(() => expect(restarted.thumbnailDB.insertOnce).toHaveBeenCalledTimes(1));
        await expect(restarted.model.fileCleanup()).resolves.toBeUndefined();
        const restartedEffects = {
            event: restarted.thumbnailEvent.emitAdded.mock.calls.length,
            insert: restarted.thumbnailDB.insertOnce.mock.calls.length,
            videoLookup: restarted.videoFileDB.findId.mock.calls.length,
        };
        const restartedFileCalls = [
            FileUtil.access,
            FileUtil.stat,
            FileUtil.mkdir,
            FileUtil.unlink,
            FileUtil.getFileList,
        ]
            .flatMap(method => vi.mocked(method).mock.calls)
            .filter(([file]) => String(file).includes('synthetic-new-thumbnail-root')).length;

        settleChild(runningChild, 0);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(3));

        expect(restarted.thumbnailDB.insertOnce).toHaveBeenCalledTimes(restartedEffects.insert);
        expect(restarted.thumbnailEvent.emitAdded).toHaveBeenCalledTimes(restartedEffects.event);
        expect(restarted.videoFileDB.findId).toHaveBeenCalledTimes(restartedEffects.videoLookup);
        expect(
            [FileUtil.access, FileUtil.stat, FileUtil.mkdir, FileUtil.unlink, FileUtil.getFileList]
                .flatMap(method => vi.mocked(method).mock.calls)
                .filter(([file]) => String(file).includes('synthetic-new-thumbnail-root')),
        ).toHaveLength(restartedFileCalls);

        settleChild(waitingChild, 0);
        await vi.waitFor(() => expect(oldInstance.thumbnailDB.insertOnce).toHaveBeenCalledTimes(2));
    });

    it('[TM-6.2] does not restore waiting requests into a newly constructed thumbnail manager', async () => {
        prepareCreate();
        const waiting = makeChild();
        const running = makeChild();
        processStubs.spawn.mockReturnValueOnce(running).mockReturnValueOnce(waiting);
        const oldInstance = makeModel();
        oldInstance.model.add(104);
        oldInstance.model.add(105);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());

        const restarted = makeModel();

        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(restarted.videoFileDB.findId).not.toHaveBeenCalled();
        expect(restarted.thumbnailDB.insertOnce).not.toHaveBeenCalled();

        settleChild(running, 0);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));
        settleChild(waiting, 0);
        await vi.waitFor(() => expect(oldInstance.thumbnailDB.insertOnce).toHaveBeenCalledTimes(2));
    });

    it('[TM-6.3] does not resume a pre-restart generating request on a newly constructed manager', async () => {
        prepareCreate();
        const running = makeChild();
        processStubs.spawn.mockReturnValueOnce(running);
        const oldInstance = makeModel();
        oldInstance.model.add(106);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());

        const restarted = makeModel();
        expect(restarted.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(restarted.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
        expect(restarted.videoFileDB.findId).not.toHaveBeenCalled();

        settleChild(running, 0);
        await vi.waitFor(() => expect(oldInstance.thumbnailDB.insertOnce).toHaveBeenCalledOnce());
        expect(restarted.thumbnailDB.insertOnce).not.toHaveBeenCalled();
    });

    it('[TM-6.4] accepts explicit regenerate and cleanup calls on a new instance', async () => {
        permitSyntheticCleanupRoot();
        const restarted = makeModel();
        vi.spyOn(FileUtil, 'getFileList').mockResolvedValue({ directories: [], files: [] });

        await expect(restarted.model.regenerate()).resolves.toBeUndefined();
        await expect(restarted.model.fileCleanup()).resolves.toBeUndefined();

        expect(restarted.recordedDB.findAll).toHaveBeenCalledOnce();
        expect(restarted.thumbnailDB.findAll).toHaveBeenCalledTimes(2);
    });
});
