import * as fs from 'node:fs';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '../../harness/async';
import {
    cleanupHarness,
    FileUtil,
    makeChild,
    makeModel,
    prepareCreate,
    ProcessUtil,
    processStubs,
    restoreSpawn,
    settleChild,
} from './_thumbnail-harness';

afterEach(cleanupHarness);
afterAll(restoreSpawn);

describe('preparation-generation-stop-failure-late-close-and-callback-races thumbnail preparation deadline fences', () => {
    it('[TM-IMP-DEADLINE-SUCCESS] clears its timer and request reference once after successful preparation', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const clearTimeout = vi.spyOn(globalThis, 'clearTimeout');
        prepareCreate();
        const fixture = makeModel();
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(711);
        await vi.advanceTimersByTimeAsync(0);

        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(clearTimeout).toHaveBeenCalledOnce();
        expect(fixture.model.activePreparationRequest).toBeNull();

        settleChild(child, 0);
        await vi.advanceTimersByTimeAsync(0);
    });

    it('[TM-IMP-DEADLINE-FAILURE] clears its timer and request reference once and advances after lookup failure', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const clearTimeout = vi.spyOn(globalThis, 'clearTimeout');
        prepareCreate();
        const fixture = makeModel();
        const lookupFailure = new Error('synthetic-video-lookup-failure');
        fixture.videoFileDB.findId.mockRejectedValueOnce(lookupFailure).mockResolvedValueOnce(null);

        fixture.model.add(712);
        fixture.model.add(713);
        await vi.advanceTimersByTimeAsync(0);

        expect(fixture.videoFileDB.findId).toHaveBeenCalledTimes(2);
        expect(clearTimeout).toHaveBeenCalledTimes(2);
        expect(fixture.model.activePreparationRequest).toBeNull();
        expect(processStubs.spawn).not.toHaveBeenCalled();
    });

    it('[TM-IMP-DEADLINE-CONFIRMATION] rechecks the deadline after resolving the actual path', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        let monotonicNow = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
        const clearTimeout = vi.spyOn(globalThis, 'clearTimeout');
        prepareCreate();
        const fixture = makeModel();
        const path = createDeferred<string | null>();
        fixture.videoUtil.getFullFilePathFromId.mockReturnValueOnce(path.promise);

        fixture.model.add(7131);
        await vi.advanceTimersByTimeAsync(0);
        expect(fixture.videoUtil.getFullFilePathFromId).toHaveBeenCalledWith(7131);
        monotonicNow = 30_000;
        path.resolve('synthetic-input.ts');
        await vi.advanceTimersByTimeAsync(0);

        expect(clearTimeout).toHaveBeenCalledOnce();
        expect(fixture.model.activePreparationRequest).toBeNull();
        expect(processStubs.spawn).not.toHaveBeenCalled();
        expect(fixture.log.system.error).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'ThumbnailPreparationTimeout' }),
        );
    });

    it('[TM-IMP-DEADLINE-SPAWN-FENCE] rechecks the absolute deadline immediately before generation', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(30_000);
        vi.spyOn(performance, 'now').mockReturnValue(30_000);
        prepareCreate();
        const fixture = makeModel();
        fixture.model.prepareVideoFile = vi.fn().mockResolvedValue({
            deadline: 30_000,
            videoFile: { id: 714, recordedId: 101 },
            videoFilePath: 'synthetic-input.ts',
        });

        fixture.model.add(714);
        await vi.advanceTimersByTimeAsync(0);

        expect(FileUtil.access).not.toHaveBeenCalled();
        expect(processStubs.spawn).not.toHaveBeenCalled();
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
        expect(fixture.log.system.error).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'ThumbnailPreparationTimeout' }),
        );
    });

    it('[TM-IMP-DEADLINE-TIMEOUT] settles once, releases the queue head, and does not let a late failure release the next request', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const clearTimeout = vi.spyOn(globalThis, 'clearTimeout');
        prepareCreate();
        const fixture = makeModel();
        const lateVideo = createDeferred<{ id: number; recordedId: number } | null>();
        const nextPath = createDeferred<string | null>();
        fixture.videoFileDB.findId.mockReturnValueOnce(lateVideo.promise).mockResolvedValueOnce(null);
        fixture.videoUtil.getFullFilePathFromId.mockReturnValueOnce(nextPath.promise);

        fixture.model.add(714);
        fixture.model.add(715);
        await vi.advanceTimersByTimeAsync(30_000);

        expect(fixture.videoFileDB.findId).toHaveBeenCalledTimes(2);
        expect(clearTimeout).toHaveBeenCalledOnce();
        const nextRequest = fixture.model.activePreparationRequest;
        expect(nextRequest).not.toBeNull();
        expect(processStubs.spawn).not.toHaveBeenCalled();
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
        expect(fixture.log.system.error).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'ThumbnailPreparationTimeout' }),
        );

        expect(lateVideo.reject(new Error('synthetic-late-failure'))).toBe(true);
        await vi.advanceTimersByTimeAsync(0);

        expect(fixture.videoUtil.getFullFilePathFromId).toHaveBeenCalledOnce();
        expect(fixture.videoUtil.getFullFilePathFromId).toHaveBeenCalledWith(715);
        expect(fixture.videoUtil.getFullFilePathFromId).not.toHaveBeenCalledWith(714);
        expect(clearTimeout).toHaveBeenCalledOnce();
        expect(fixture.model.activePreparationRequest).toBe(nextRequest);
        expect(processStubs.spawn).not.toHaveBeenCalled();
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();

        nextPath.resolve(null);
        await vi.advanceTimersByTimeAsync(0);
        expect(clearTimeout).toHaveBeenCalledTimes(2);
        expect(fixture.model.activePreparationRequest).toBeNull();
    });

    it.each([300_000, 300_001])(
        '[TM-2.8][TM-2.9] stops once at %ims, fences late callbacks, and keeps the next child pending until close',
        async elapsed => {
            vi.useFakeTimers();
            vi.setSystemTime(0);
            const stop = vi.spyOn(ProcessUtil, 'kill').mockResolvedValue(undefined);
            prepareCreate();
            const fixture = makeModel();
            const timedOut = makeChild();
            const next = makeChild();
            processStubs.spawn.mockReturnValueOnce(timedOut).mockReturnValueOnce(next);

            fixture.model.add(721);
            fixture.model.add(722);
            await vi.advanceTimersByTimeAsync(0);
            expect(processStubs.spawn).toHaveBeenCalledOnce();

            await vi.advanceTimersByTimeAsync(elapsed);
            expect(stop).toHaveBeenCalledOnce();
            expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
            expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
            expect(processStubs.spawn).toHaveBeenCalledOnce();

            timedOut.emit('exit', 0);
            timedOut.emit('error', new Error('synthetic-late-process-error'));
            await vi.advanceTimersByTimeAsync(0);
            expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
            expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
            expect(fixture.log.system.error).not.toHaveBeenCalledWith('create thumbnail failed: 721');
            expect(processStubs.spawn).toHaveBeenCalledOnce();

            timedOut.emit('close', 7);
            await vi.advanceTimersByTimeAsync(0);
            expect(fixture.log.system.error).not.toHaveBeenCalledWith('create thumbnail cmd error: 7');
            expect(processStubs.spawn).toHaveBeenCalledTimes(2);
        },
    );

    it.each(['nonzero close', 'deadline'] as const)(
        '[TM-1.9] waits for owned cleanup before advancing after a %s failure',
        async terminal => {
            if (terminal === 'deadline') {
                vi.useFakeTimers();
                vi.setSystemTime(0);
                vi.spyOn(ProcessUtil, 'kill').mockResolvedValue(undefined);
            }
            prepareCreate();
            const fixture = makeModel();
            const failed = makeChild();
            const next = makeChild();
            const cleanup = createDeferred<void>();
            vi.mocked(FileUtil.unlink)
                .mockImplementationOnce(() => cleanup.promise)
                .mockResolvedValue(undefined);
            processStubs.spawn.mockReturnValueOnce(failed).mockReturnValueOnce(next);

            fixture.model.add(725);
            fixture.model.add(726);
            if (terminal === 'deadline') {
                await vi.advanceTimersByTimeAsync(0);
                expect(processStubs.spawn).toHaveBeenCalledOnce();
                await vi.advanceTimersByTimeAsync(300_000);
            } else {
                await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
            }
            failed.emit('close', 7);

            if (terminal === 'deadline') {
                await vi.advanceTimersByTimeAsync(0);
            } else {
                await vi.waitFor(() => expect(FileUtil.unlink).toHaveBeenCalledOnce());
                await Promise.resolve();
                await new Promise<void>(resolve => setImmediate(resolve));
            }

            expect(FileUtil.unlink).toHaveBeenCalledOnce();
            expect(processStubs.spawn).toHaveBeenCalledOnce();

            cleanup.resolve();
            if (terminal === 'deadline') {
                await vi.advanceTimersByTimeAsync(0);
                expect(processStubs.spawn).toHaveBeenCalledTimes(2);
            } else {
                await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));
            }
        },
    );

    it('[TM-2.8] treats a zero close observed at 300000ms before timer dispatch as a deadline failure', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        let monotonicNow = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
        const stop = vi.spyOn(ProcessUtil, 'kill').mockResolvedValue(undefined);
        prepareCreate();
        const fixture = makeModel();
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(727);
        await vi.advanceTimersByTimeAsync(0);
        monotonicNow = 300_000;
        child.emit('close', 0);
        await vi.advanceTimersByTimeAsync(0);

        expect(stop).toHaveBeenCalledOnce();
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
        expect(fixture.log.system.error).toHaveBeenCalledWith(
            'thumbnail deadline failed: requestId=thumbnail-request-1, reservationId=thumbnail-reservation-1',
        );
    });

    it('[TM-1.2][TM-1.9] treats an error as the first business failure but waits for close before advancing the child lease', async () => {
        prepareCreate();
        const fixture = makeModel();
        const failed = makeChild();
        const next = makeChild();
        processStubs.spawn.mockReturnValueOnce(failed).mockReturnValueOnce(next);

        fixture.model.add(731);
        fixture.model.add(732);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
        failed.emit('error', new Error('synthetic-first-process-error'));
        failed.emit('exit', 0);
        await vi.waitFor(() =>
            expect(fixture.log.system.error).toHaveBeenCalledWith(
                'thumbnail spawn failed: requestId=thumbnail-request-1, reservationId=thumbnail-reservation-1',
            ),
        );
        expect(fixture.log.system.error).toHaveBeenCalledWith('create thumbnail failed: 731');
        expect(fixture.log.system.error).toHaveBeenCalledWith(expect.any(Error));

        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
        await new Promise(resolve => setImmediate(resolve));
        expect(FileUtil.unlink).not.toHaveBeenCalled();
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        failed.emit('close', 0);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));
    });

    it('[TM-2.9] records a failed stop once with request and reservation identity while retaining the lease until close', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const stopFailure = new Error('synthetic-stop-failure');
        const stop = vi.spyOn(ProcessUtil, 'kill').mockRejectedValue(stopFailure);
        prepareCreate();
        const fixture = makeModel();
        const child = makeChild();
        const next = makeChild();
        processStubs.spawn.mockReturnValueOnce(child).mockReturnValueOnce(next);

        fixture.model.add(741);
        fixture.model.add(742);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(300_000);

        await vi.advanceTimersByTimeAsync(0);
        expect(stop).toHaveBeenCalledOnce();
        expect(fixture.log.system.error).toHaveBeenCalledWith(
            'thumbnail deadline failed: requestId=thumbnail-request-1, reservationId=thumbnail-reservation-1',
        );
        expect(fixture.log.system.error).toHaveBeenCalledWith(
            'thumbnail stop failed: requestId=thumbnail-request-1, reservationId=thumbnail-reservation-1',
        );
        expect(fixture.log.system.error).toHaveBeenCalledWith(stopFailure);
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        child.emit('close', 0);
        await vi.advanceTimersByTimeAsync(0);
        expect(processStubs.spawn).toHaveBeenCalledTimes(2);
    });

    it('[TM-1.2] releases a synchronous spawn failure and allows the next request without publishing the failed request', async () => {
        prepareCreate();
        const fixture = makeModel();
        const spawnFailure = new Error('synthetic-spawn-failure');
        const next = makeChild();
        processStubs.spawn
            .mockImplementationOnce(() => {
                throw spawnFailure;
            })
            .mockReturnValueOnce(next);

        fixture.model.add(751);
        fixture.model.add(752);

        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
        expect(fixture.log.system.error).toHaveBeenCalledWith(
            'thumbnail spawn failed: requestId=thumbnail-request-1, reservationId=thumbnail-reservation-1',
        );
        expect(FileUtil.unlink).toHaveBeenNthCalledWith(1, 'synthetic-thumbnail-root/.thumbnail-request/thumbnail.jpg');
        expect(FileUtil.unlink).toHaveBeenNthCalledWith(2, 'synthetic-thumbnail-root/101.jpg');
        settleChild(next, 1);
    });

    it("[TM-5.1] drains child stdio, clears the process deadline, and removes only this child's listeners on success", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        prepareCreate();
        const fixture = makeModel();
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(761);
        await vi.advanceTimersByTimeAsync(0);
        const clearTimeout = vi.spyOn(globalThis, 'clearTimeout');
        expect(child.stderr?.listenerCount('data')).toBe(1);
        expect(child.stdout?.listenerCount('data')).toBe(1);
        child.stderr?.write('synthetic-ffmpeg-stderr');
        await vi.advanceTimersByTimeAsync(0);
        expect(fixture.log.system.debug).toHaveBeenCalledWith('synthetic-ffmpeg-stderr');

        settleChild(child, 0);
        await vi.advanceTimersByTimeAsync(0);

        expect(clearTimeout).toHaveBeenCalledOnce();
        expect(child.listenerCount('close')).toBe(0);
        expect(child.listenerCount('error')).toBe(0);
        expect(child.stderr?.listenerCount('data')).toBe(0);
        expect(child.stdout?.listenerCount('data')).toBe(0);
    });

    it('[TM-1.2][TM-1.9][TM-2.9] holds the child lease when an exit code arrives without close', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        prepareCreate();
        const fixture = makeModel();
        const child = makeChild();
        child.exitCode = 0;
        const next = makeChild();
        processStubs.spawn.mockReturnValueOnce(child).mockReturnValueOnce(next);

        fixture.model.add(762);
        fixture.model.add(763);
        await vi.advanceTimersByTimeAsync(0);

        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
        expect(child.listenerCount('close')).toBe(1);
        expect(child.listenerCount('error')).toBe(1);
    });

    it('[TM-5.1] retains the child lease until its successful publish and database work has settled', async () => {
        prepareCreate();
        const fixture = makeModel();
        const first = makeChild();
        const next = makeChild();
        const database = createDeferred<number>();
        fixture.thumbnailDB.insertOnce.mockReturnValueOnce(database.promise);
        processStubs.spawn.mockReturnValueOnce(first).mockReturnValueOnce(next);

        fixture.model.add(771);
        fixture.model.add(772);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
        settleChild(first, 0);
        await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce());
        expect(FileUtil.copyFile).toHaveBeenCalledWith(
            'synthetic-thumbnail-root/.thumbnail-request/thumbnail.jpg',
            'synthetic-thumbnail-root/101.jpg',
        );
        expect(fixture.log.system.info).toHaveBeenCalledWith('create thumbnail: 771, synthetic-thumbnail-root/101.jpg');

        first.emit('error', new Error('synthetic-late-success-error'));
        await new Promise(resolve => setImmediate(resolve));
        expect(fixture.log.system.error).not.toHaveBeenCalledWith('create thumbnail failed: 771');
        expect(processStubs.spawn).toHaveBeenCalledOnce();

        database.resolve(1);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));
        expect(fixture.thumbnailEvent.emitAdded).toHaveBeenCalledWith(771, 101);
        expect(FileUtil.unlink).toHaveBeenCalledTimes(1);
        expect(FileUtil.unlink).toHaveBeenCalledWith('synthetic-thumbnail-root/.thumbnail-request/thumbnail.jpg');
    });

    it.each([['publish'], ['database']] as const)(
        '[TM-5.1] fences %s settlement failure before notification and releases the next lease',
        async operation => {
            prepareCreate();
            const fixture = makeModel();
            const failure = new Error(`synthetic-${operation}-failure`);
            if (operation === 'database') {
                fixture.thumbnailDB.insertOnce.mockRejectedValueOnce(failure);
            } else {
                vi.mocked(FileUtil.copyFile).mockRejectedValueOnce(failure);
            }
            const failed = makeChild();
            const next = makeChild();
            processStubs.spawn.mockReturnValueOnce(failed).mockReturnValueOnce(next);

            fixture.model.add(781);
            fixture.model.add(782);
            await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
            settleChild(failed, 0);

            await vi.waitFor(() =>
                expect(fixture.log.system.error).toHaveBeenCalledWith(
                    `thumbnail ${operation} failed: requestId=thumbnail-request-1, reservationId=thumbnail-reservation-1`,
                ),
            );
            expect(fixture.log.system.error).toHaveBeenCalledWith(failure);
            expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
            if (operation === 'publish') {
                expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
            }
            await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));
            expect(FileUtil.unlink).toHaveBeenCalledWith('synthetic-thumbnail-root/101.jpg');
        },
    );

    it('[TM-5.1] treats an error with no child PID as terminal and releases the next lease', async () => {
        prepareCreate();
        const fixture = makeModel();
        const failed = makeChild({ pid: undefined });
        const next = makeChild();
        processStubs.spawn.mockReturnValueOnce(failed).mockReturnValueOnce(next);

        fixture.model.add(791);
        fixture.model.add(792);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
        failed.emit('error', new Error('synthetic-no-pid-spawn-error'));

        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));
        expect(fixture.log.system.error).toHaveBeenCalledWith(
            'thumbnail spawn failed: requestId=thumbnail-request-1, reservationId=thumbnail-reservation-1',
        );
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
    });

    it('[TM-5.1] schedules the stop from the remaining absolute deadline rather than adding elapsed time', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        prepareCreate();
        const fixture = makeModel();
        const child = makeChild();
        const stop = vi.spyOn(ProcessUtil, 'kill').mockResolvedValue(undefined);
        vi.spyOn(performance, 'now').mockReturnValue(200);
        const reservation = {
            fileName: '101.jpg',
            finalPath: 'synthetic-thumbnail-root/101.jpg',
            requestId: 'thumbnail-request-deadline',
            reservationId: 'thumbnail-reservation-deadline',
            temporaryDirectory: 'synthetic-thumbnail-root/.thumbnail-request',
            temporaryPath: 'synthetic-thumbnail-root/.thumbnail-request/thumbnail.jpg',
            published: false,
            released: false,
        };
        const request = {
            requestId: reservation.requestId,
            businessComplete: false,
            childTerminal: false,
            failure: null,
            finalized: false,
            settled: false,
            stopAttempted: false,
        };
        const completed = fixture.model.awaitChildSettlement(child, 300_100, request, reservation, 801, 101);

        await vi.advanceTimersByTimeAsync(299_900);
        expect(stop).toHaveBeenCalledOnce();
        child.emit('close', 0);
        await expect(completed).rejects.toThrow('ThumbnailProcessTimeout');
    });

    it('[TM-2.12] records a nonzero exit as a process failure with its request and reservation identity', async () => {
        prepareCreate();
        const fixture = makeModel();
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(811);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
        settleChild(child, 7);

        await vi.waitFor(() =>
            expect(fixture.log.system.error).toHaveBeenCalledWith(
                'thumbnail process failed: requestId=thumbnail-request-1, reservationId=thumbnail-reservation-1',
            ),
        );
        expect(fixture.log.system.error).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'CreateThumbnailExitError' }),
        );
        expect(fixture.log.system.error).toHaveBeenCalledWith('create thumbnail cmd error: 7');
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
    });

    it('[TM-5.1] removes the owned temporary directory recursively and never removes a missing temporary path', async () => {
        prepareCreate();
        const fixture = makeModel();
        const reservation = {
            fileName: '101.jpg',
            finalPath: 'synthetic-thumbnail-root/101.jpg',
            requestId: 'thumbnail-request-cleanup',
            reservationId: 'thumbnail-reservation-cleanup',
            temporaryDirectory: 'synthetic-thumbnail-root/.thumbnail-request',
            temporaryPath: 'synthetic-thumbnail-root/.thumbnail-request/thumbnail.jpg',
            published: false,
            released: false,
        };

        await fixture.model.cleanupReservation(reservation, false);
        expect(FileUtil.unlink).toHaveBeenNthCalledWith(1, 'synthetic-thumbnail-root/.thumbnail-request/thumbnail.jpg');
        expect(fs.promises.rm).toHaveBeenCalledWith('synthetic-thumbnail-root/.thumbnail-request', {
            force: true,
            recursive: true,
        });
        expect(FileUtil.unlink).toHaveBeenNthCalledWith(2, 'synthetic-thumbnail-root/101.jpg');

        vi.clearAllMocks();
        await fixture.model.cleanupReservation(
            {
                ...reservation,
                released: false,
                temporaryDirectory: null,
                temporaryPath: null,
            },
            false,
        );
        expect(FileUtil.unlink).toHaveBeenCalledOnce();
        expect(FileUtil.unlink).toHaveBeenCalledWith('synthetic-thumbnail-root/101.jpg');
        expect(fs.promises.rm).not.toHaveBeenCalled();
    });

    it('[TM-2.12] marks a reservation released before its first cleanup I/O, preventing an overlapping cleanup', async () => {
        prepareCreate();
        const fixture = makeModel();
        const firstCleanup = createDeferred<void>();
        const reservation = {
            fileName: '101.jpg',
            finalPath: 'synthetic-thumbnail-root/101.jpg',
            requestId: 'thumbnail-request-overlapping-cleanup',
            reservationId: 'thumbnail-reservation-overlapping-cleanup',
            temporaryDirectory: 'synthetic-thumbnail-root/.thumbnail-request',
            temporaryPath: 'synthetic-thumbnail-root/.thumbnail-request/thumbnail.jpg',
            published: false,
            released: false,
        };
        vi.mocked(FileUtil.unlink)
            .mockImplementationOnce(() => firstCleanup.promise)
            .mockResolvedValue(undefined);

        const cleanup = fixture.model.cleanupReservation(reservation, false);
        await vi.waitFor(() => expect(FileUtil.unlink).toHaveBeenCalledOnce());
        await fixture.model.cleanupReservation(reservation, false);

        expect(FileUtil.unlink).toHaveBeenCalledOnce();

        firstCleanup.resolve();
        await cleanup;
    });

    it('[TM-5.1] records individual temporary cleanup failures without suppressing the owned-final cleanup', async () => {
        prepareCreate();
        const fixture = makeModel();
        const temporaryFileFailure = new Error('synthetic-temporary-file-cleanup-failure');
        const temporaryDirectoryFailure = new Error('synthetic-temporary-directory-cleanup-failure');
        vi.mocked(FileUtil.unlink).mockRejectedValueOnce(temporaryFileFailure).mockResolvedValueOnce(undefined);
        vi.mocked(fs.promises.rm).mockRejectedValueOnce(temporaryDirectoryFailure);
        const reservation = {
            fileName: '101.jpg',
            finalPath: 'synthetic-thumbnail-root/101.jpg',
            requestId: 'thumbnail-request-cleanup-failure',
            reservationId: 'thumbnail-reservation-cleanup-failure',
            temporaryDirectory: 'synthetic-thumbnail-root/.thumbnail-request',
            temporaryPath: 'synthetic-thumbnail-root/.thumbnail-request/thumbnail.jpg',
            published: false,
            released: false,
        };

        await fixture.model.cleanupReservation(reservation, false);

        expect(fixture.log.system.error).toHaveBeenCalledWith(
            'thumbnail cleanup temporary file failed: requestId=thumbnail-request-cleanup-failure, reservationId=thumbnail-reservation-cleanup-failure',
        );
        expect(fixture.log.system.error).toHaveBeenCalledWith(temporaryFileFailure);
        expect(fixture.log.system.error).toHaveBeenCalledWith(
            'thumbnail cleanup temporary directory failed: requestId=thumbnail-request-cleanup-failure, reservationId=thumbnail-reservation-cleanup-failure',
        );
        expect(fixture.log.system.error).toHaveBeenCalledWith(temporaryDirectoryFailure);
        expect(FileUtil.unlink).toHaveBeenLastCalledWith('synthetic-thumbnail-root/101.jpg');
    });

    it('[TM-5.1] records an owned-final cleanup failure without masking it as a temporary cleanup failure', async () => {
        prepareCreate();
        const fixture = makeModel();
        const finalFailure = new Error('synthetic-final-cleanup-failure');
        vi.mocked(FileUtil.unlink).mockResolvedValueOnce(undefined).mockRejectedValueOnce(finalFailure);
        const reservation = {
            fileName: '101.jpg',
            finalPath: 'synthetic-thumbnail-root/101.jpg',
            requestId: 'thumbnail-request-final-cleanup-failure',
            reservationId: 'thumbnail-reservation-final-cleanup-failure',
            temporaryDirectory: 'synthetic-thumbnail-root/.thumbnail-request',
            temporaryPath: 'synthetic-thumbnail-root/.thumbnail-request/thumbnail.jpg',
            published: false,
            released: false,
        };

        await fixture.model.cleanupReservation(reservation, false);

        expect(fixture.log.system.error).toHaveBeenCalledWith(
            'thumbnail cleanup final file failed: requestId=thumbnail-request-final-cleanup-failure, reservationId=thumbnail-reservation-final-cleanup-failure',
        );
        expect(fixture.log.system.error).toHaveBeenCalledWith(finalFailure);
    });

    it('[TM-5.1] recognizes the active reservation final path before cleanup can inspect it as an orphan', () => {
        const fixture = makeModel();
        fixture.model.activeReservations.add({
            finalPath: 'synthetic-thumbnail-root/101.jpg',
            temporaryDirectory: null,
            temporaryPath: null,
        });

        expect(fixture.model.isActiveReservationPath('synthetic-thumbnail-root/101.jpg')).toBe(true);
    });
});
