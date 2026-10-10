import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '../../harness/async';
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

describe('regeneration-cleanup-and-reservation-release thumbnail observable implementation branches', () => {
    it('[TM-IMP-REGENERATE-QUERY] asks for non-half-width records with their video files and thumbnails only', async () => {
        const fixture = makeModel();
        fixture.model.add = vi.fn();

        await fixture.model.regenerate();

        expect(fixture.recordedDB.findAll).toHaveBeenCalledExactlyOnceWith(
            { isHalfWidth: false },
            { isNeedVideoFiles: true, isNeedThumbnails: true, isNeedsDropLog: false, isNeedTags: false },
        );
    });

    it('[TM-IMP-REGENERATE-NO-THUMBNAIL-FIELD] admits the first video of a record whose thumbnail list is absent', async () => {
        const fixture = makeModel();
        fixture.recordedDB.findAll.mockResolvedValue([
            [
                { id: 301, videoFiles: [{ id: 3011 }, { id: 3012 }] },
                { id: 302, thumbnails: [], videoFiles: [] },
                { id: 303, videoFiles: [] },
            ],
            3,
        ]);
        fixture.model.add = vi.fn();

        await fixture.model.regenerate();

        expect(fixture.model.add.mock.calls).toEqual([[3011]]);
        expect(fixture.thumbnailDB.deleteOnce).not.toHaveBeenCalled();
    });

    it('[TM-IMP-CLEANUP-KEEP-EXISTING] keeps the row and the file of a thumbnail whose file exists', async () => {
        permitSyntheticCleanupRoot();
        const fixture = makeModel();
        fixture.thumbnailDB.findAll.mockResolvedValue([{ id: 311, filePath: 'synthetic-present.jpg' }]);
        vi.spyOn(FileUtil, 'stat').mockResolvedValue({});
        vi.spyOn(FileUtil, 'getFileList').mockResolvedValue({
            directories: [],
            files: ['synthetic-thumbnail-root/synthetic-present.jpg'],
        });
        const unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);

        await fixture.model.fileCleanup();

        expect(fixture.thumbnailDB.deleteOnce).not.toHaveBeenCalled();
        expect(unlink).not.toHaveBeenCalled();
        expect(fixture.log.system.warn).not.toHaveBeenCalled();
    });

    it('[TM-IMP-CLEANUP-INDEX-SNAPSHOT] keeps a file that was registered when the scan began even if the later listing no longer has it', async () => {
        permitSyntheticCleanupRoot();
        const fixture = makeModel();
        fixture.thumbnailDB.findAll
            .mockResolvedValueOnce([{ id: 312, filePath: 'synthetic-snapshot.jpg' }])
            .mockResolvedValue([]);
        vi.spyOn(FileUtil, 'stat').mockResolvedValue({});
        vi.spyOn(FileUtil, 'getFileList').mockResolvedValue({
            directories: [],
            files: ['synthetic-thumbnail-root/synthetic-snapshot.jpg'],
        });
        const unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);

        await fixture.model.fileCleanup();

        expect(unlink).not.toHaveBeenCalled();
    });

    it('[TM-IMP-CLEANUP-INDEX-CURRENT] keeps a file that was registered after the scan began', async () => {
        permitSyntheticCleanupRoot();
        const fixture = makeModel();
        fixture.thumbnailDB.findAll
            .mockResolvedValueOnce([])
            .mockResolvedValue([{ id: 313, filePath: 'synthetic-late.jpg' }]);
        vi.spyOn(FileUtil, 'getFileList').mockResolvedValue({
            directories: [],
            files: ['synthetic-thumbnail-root/synthetic-late.jpg', 'synthetic-thumbnail-root/synthetic-orphan.jpg'],
        });
        const unlink = vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);

        await fixture.model.fileCleanup();

        expect(unlink.mock.calls).toEqual([['synthetic-thumbnail-root/synthetic-orphan.jpg']]);
    });

    it.each([
        ['the process exits with a failure code', 1],
        ['the process exits successfully', 0],
    ])('[TM-IMP-RESERVATION-RELEASE] forgets the output reservation once %s', async (_label, code) => {
        prepareCreate();
        const fixture = makeModel();
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(321);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
        expect(fixture.model.activeReservations.size).toBe(1);

        settleChild(child, code);

        await vi.waitFor(() => expect(fixture.model.activeReservations.size).toBe(0));
    });

    it('[TM-IMP-DEADLINE-TIMER-SUCCESS] stops the generation deadline timer as soon as the process exits successfully', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        prepareCreate();
        const fixture = makeModel();
        const insert = createDeferred<number>();
        fixture.thumbnailDB.insertOnce.mockReturnValue(insert.promise);
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(331);
        await vi.advanceTimersByTimeAsync(0);
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        const before = vi.getTimerCount();
        expect(before).toBeGreaterThan(0);

        settleChild(child, 0);
        await vi.advanceTimersByTimeAsync(0);

        expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(before - 1);
        insert.resolve(1);
        await vi.advanceTimersByTimeAsync(0);
    });

    it('[TM-IMP-DEADLINE-TIMER-FAILURE] stops the generation deadline timer as soon as the process reports a spawn error', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        prepareCreate();
        const fixture = makeModel();
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(332);
        await vi.advanceTimersByTimeAsync(0);
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        const before = vi.getTimerCount();
        expect(before).toBeGreaterThan(0);

        child.emit('error', new Error('synthetic-spawn-error'));
        await vi.advanceTimersByTimeAsync(0);

        expect(vi.getTimerCount()).toBe(before - 1);
        settleChild(child, 1);
        await vi.advanceTimersByTimeAsync(0);
    });
});
