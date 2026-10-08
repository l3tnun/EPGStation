import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

type CleanupMode = 'absent' | 'directory' | 'generic';

const outputFrom = (args: string[]): string => args[args.indexOf('--output') + 1]!;

const observeOwnedCleanup = async (mode: CleanupMode): Promise<void> => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-absent-'));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const genericFailure = new Error('synthetic-owned-cleanup-failure');
    try {
        const preserved = join(root, 'preserved.jpg');
        await writeFile(preserved, 'synthetic-unrelated-jpeg');
        const fixture = makeModel({ config: { thumbnail: root } });
        fixture.videoFileDB.findId
            .mockResolvedValueOnce({ id: 11, recordedId: 101 })
            .mockResolvedValueOnce({ id: 12, recordedId: 102 });
        const failed = makeChild();
        const next = makeChild();
        let temporary = '';
        let successorStart: { temporary: boolean; directory: boolean; final: boolean } | undefined;
        const realUnlink = FileUtil.unlink;
        const unlink = vi.spyOn(FileUtil, 'unlink');
        if (mode === 'generic') {
            unlink.mockImplementation((filePath: string) => {
                if (filePath === temporary) return Promise.reject(genericFailure);
                return realUnlink(filePath);
            });
        }
        processStubs.spawn.mockReturnValueOnce(failed).mockImplementationOnce(() => {
            successorStart = {
                temporary: existsSync(temporary),
                directory: existsSync(dirname(temporary)),
                final: existsSync(join(root, '101.jpg')),
            };
            return next;
        });

        fixture.model.add(1101);
        fixture.model.add(1102);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
        temporary = outputFrom(processStubs.spawn.mock.calls[0][1] as string[]);
        expect(temporary).toContain(join(root, '.thumbnail-'));
        await expect(stat(temporary)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(stat(join(root, '101.jpg'))).resolves.toMatchObject({ size: 0 });
        if (mode === 'directory') {
            await mkdir(temporary);
            expect((await stat(temporary)).isDirectory()).toBe(true);
        }

        // Child terminalは合成するが、存在しないJPEGのunlinkと残りの回収は実filesystemを通す。
        settleChild(failed, 7);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));
        expect(successorStart).toEqual({ temporary: false, directory: false, final: false });
        expect(unlink).toHaveBeenCalledWith(temporary);
        expect(unlink).toHaveBeenCalledWith(join(root, '101.jpg'));
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();

        const nextTemporary = outputFrom(processStubs.spawn.mock.calls[1][1] as string[]);
        await writeFile(nextTemporary, 'synthetic-successor-jpeg');
        settleChild(next, 0);
        await vi.waitFor(() => expect(fixture.thumbnailEvent.emitAdded).toHaveBeenCalledWith(1102, 102));
        await vi.waitFor(async () => {
            await expect(stat(dirname(nextTemporary))).rejects.toMatchObject({ code: 'ENOENT' });
        });
        await expect(readFile(join(root, '102.jpg'), 'utf8')).resolves.toBe('synthetic-successor-jpeg');
        await expect(readFile(preserved, 'utf8')).resolves.toBe('synthetic-unrelated-jpeg');
        expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce();
        expect(fixture.thumbnailDB.insertOnce.mock.calls[0][0]).toMatchObject({
            recordedId: 102,
            filePath: '102.jpg',
        });
        expect(failed.listenerCount('close')).toBe(0);
        expect(failed.listenerCount('error')).toBe(0);
        expect(next.listenerCount('close')).toBe(0);
        expect(next.listenerCount('error')).toBe(0);

        expect(fixture.log.system.error).toHaveBeenCalledWith('create thumbnail cmd error: 7');
        expect(fixture.log.system.error).toHaveBeenCalledWith(
            'thumbnail process failed: requestId=thumbnail-request-1, reservationId=thumbnail-reservation-1',
        );
        expect(fixture.log.system.error).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'CreateThumbnailExitError' }),
        );
        expect(fixture.log.system.error).toHaveBeenCalledWith('create thumbnail error: 1101');
        const cleanupMessages = fixture.log.system.error.mock.calls
            .map(([entry]) => entry)
            .filter(entry => typeof entry === 'string' && entry.startsWith('thumbnail cleanup '));
        if (mode === 'absent') {
            expect(cleanupMessages).toEqual([]);
        } else {
            expect(cleanupMessages).toEqual([
                'thumbnail cleanup temporary file failed: requestId=thumbnail-request-1, reservationId=thumbnail-reservation-1',
            ]);
            if (mode === 'generic') {
                expect(fixture.log.system.error.mock.calls.filter(([entry]) => entry === genericFailure)).toHaveLength(
                    1,
                );
            } else {
                const failures = fixture.log.system.error.mock.calls
                    .map(([entry]) => entry)
                    .filter(entry => entry instanceof Error && (entry as NodeJS.ErrnoException).code === 'EISDIR');
                expect(failures).toHaveLength(1);
                expect(failures[0]).toMatchObject({ code: 'EISDIR', syscall: 'unlink', path: temporary });
            }
        }
    } finally {
        // timer/listener fallbackも本体で先に回収し、遅いcallbackによる一時rootへのアクセスを防ぐ。
        cleanupHarness();
        await rm(root, { force: true, recursive: true });
        await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
    }
};

describe('owned thumbnail temporary JPEG cleanup', () => {
    it('[TM-2.12][TM-7.4-filesystem] treats an ungenerated temporary JPEG as absent while retaining the original failure and completing the successor', async () => {
        await observeOwnedCleanup('absent');
    });

    it('[TM-2.12][TM-7.4-filesystem] records a real EISDIR cleanup failure separately and still removes the owned directory and final claim', async () => {
        await observeOwnedCleanup('directory');
    });

    it('[TM-2.12][TM-7.4-filesystem] retains a cleanup exception without an errno and the original generation failure', async () => {
        await observeOwnedCleanup('generic');
    });
});
