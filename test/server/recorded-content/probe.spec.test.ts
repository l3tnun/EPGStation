import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { controlledExecFile, createVideoProbe } from './_probe-harness';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('recorded content video information contract', () => {
    it('[RC-7.1] returns duration, size, and bit rate only from successful probe JSON', async () => {
        const process = controlledExecFile();
        const { videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/recording.ts');

        process.callback()(null, '{"format":{"duration":"12.5","size":"4096","bit_rate":"8192.25"}}', '');

        await expect(result).resolves.toEqual({ bitRate: 8192.25, duration: 12.5, size: 4096 });
        expect(process.execFile).toHaveBeenCalledWith(
            'synthetic-ffprobe',
            ['-v', '0', '-show_format', '-of', 'json', 'synthetic-root/recording.ts'],
            expect.any(Function),
        );
    });

    it('returns the normal duration through VideoApiModel.getDuration', async () => {
        const process = controlledExecFile();
        const rows = new Map([[70, { filePath: 'duration.ts', id: 70, parentDirectoryName: 'synthetic-storage' }]]);
        const { videoApi } = await createVideoProbe({ execFile: process.execFile, rows });
        const result = videoApi.getDuration(70);
        await vi.waitFor(() => expect(process.execFile).toHaveBeenCalledOnce());

        process.callback()(null, '{"format":{"duration":"12.5","size":"4096","bit_rate":"8192.25"}}', '');

        await expect(result).resolves.toBe(12.5);
    });

    it('[RC-7.3] starts no probe when registration or configured storage cannot resolve a path', async () => {
        const unregisteredProcess = controlledExecFile();
        const unregistered = await createVideoProbe({ execFile: unregisteredProcess.execFile });

        await expect(unregistered.videoApi.getDuration(71)).rejects.toThrow('VideoFileIsUndefined');
        expect(unregisteredProcess.execFile).not.toHaveBeenCalled();

        const unknownStorageProcess = controlledExecFile();
        const rows = new Map([[71, { filePath: 'recording.ts', id: 71, parentDirectoryName: 'unknown-storage' }]]);
        const unknownStorage = await createVideoProbe({ execFile: unknownStorageProcess.execFile, rows });

        await expect(unknownStorage.videoApi.getDuration(71)).rejects.toThrow('VideoFileIsUndefined');
        expect(unknownStorageProcess.execFile).not.toHaveBeenCalled();
    });

    it('resolves configured recorded and temporary parents without probing', async () => {
        const process = controlledExecFile();
        const rows = new Map([
            [72, { filePath: 'nested/recording.ts', id: 72, parentDirectoryName: 'synthetic-storage' }],
            [73, { filePath: 'temporary.ts', id: 73, parentDirectoryName: 'tmp' }],
        ]);
        const { videoUtil } = await createVideoProbe({
            execFile: process.execFile,
            recordedTmp: 'synthetic-temporary-root',
            rows,
        });

        await expect(videoUtil.getFullFilePathFromId(72)).resolves.toBe(join('synthetic-root', 'nested/recording.ts'));
        await expect(videoUtil.getFullFilePathFromId(73)).resolves.toBe(
            join('synthetic-temporary-root', 'temporary.ts'),
        );
        expect(
            videoUtil.getFullFilePathFromVideoFile({
                filePath: 'direct.ts',
                parentDirectoryName: 'synthetic-storage',
            }),
        ).toBe(join('synthetic-root', 'direct.ts'));
        expect(
            videoUtil.getFullFilePathFromVideoFile({ filePath: 'direct.ts', parentDirectoryName: 'unknown-storage' }),
        ).toBeNull();
        expect(process.execFile).not.toHaveBeenCalled();
    });

    it('[RC-7.4] propagates the same external missing-file failure after a resolved path starts probing', async () => {
        const process = controlledExecFile();
        const failure = Object.assign(new Error('SYNTHETIC_FILE_MISSING'), { code: 'ENOENT' });
        const rows = new Map([[74, { filePath: 'missing.ts', id: 74, parentDirectoryName: 'synthetic-storage' }]]);
        const { videoApi } = await createVideoProbe({ execFile: process.execFile, rows });
        const result = videoApi.getDuration(74);
        await vi.waitFor(() => expect(process.execFile).toHaveBeenCalledOnce());

        process.callback()(failure, '', 'redacted synthetic diagnostic');

        await expect(result).rejects.toBe(failure);
        expect(process.execFile).toHaveBeenCalledWith(
            'synthetic-ffprobe',
            ['-v', '0', '-show_format', '-of', 'json', join('synthetic-root', 'missing.ts')],
            expect.any(Function),
        );
    });

    it('[RC-7.2] succeeds immediately before 30,000ms and times out at the deadline', async () => {
        vi.useFakeTimers();
        const beforeDeadline = controlledExecFile();
        const beforeProbe = await createVideoProbe({ execFile: beforeDeadline.execFile });
        const beforeResult = beforeProbe.videoUtil.getInfo('synthetic-root/before-deadline.ts');

        await vi.advanceTimersByTimeAsync(29_999);
        beforeDeadline.callback()(null, '{"format":{"duration":"1","size":"2","bit_rate":"3"}}', '');
        await expect(beforeResult).resolves.toEqual({ bitRate: 3, duration: 1, size: 2 });
        expect(beforeDeadline.child.kill).not.toHaveBeenCalled();

        const atDeadline = controlledExecFile();
        const atProbe = await createVideoProbe({ execFile: atDeadline.execFile });
        const atResult = atProbe.videoUtil.getInfo('synthetic-root/at-deadline.ts');
        const outcome = atResult.then(
            value => ({ value }),
            error => ({ error }),
        );
        await vi.advanceTimersByTimeAsync(30_000);

        expect(atDeadline.child.kill).toHaveBeenCalledOnce();
        expect(atDeadline.child.kill).toHaveBeenCalledWith('SIGKILL');
        await expect(outcome).resolves.toMatchObject({ error: { message: 'VideoInfoTimeout' } });
    });

    it('rechecks the monotonic deadline immediately before successful settlement', async () => {
        vi.useFakeTimers();
        let monotonicNow = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
        const originalParse = JSON.parse;
        vi.spyOn(JSON, 'parse').mockImplementation((text: string) => {
            const parsed = originalParse(text);
            monotonicNow = 30_000;
            return parsed;
        });
        const process = controlledExecFile();
        const { videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/settlement-boundary.ts');
        const outcome = result.then(
            value => ({ value }),
            error => ({ error }),
        );

        process.callback()(null, '{"format":{"duration":"1","size":"2","bit_rate":"3"}}', '');

        expect(process.child.kill).toHaveBeenCalledOnce();
        await expect(outcome).resolves.toMatchObject({ error: { message: 'VideoInfoTimeout' } });
    });

    it('[RC-7.5] requests SIGKILL once and logs only after the independent 3-second stop grace', async () => {
        vi.useFakeTimers();
        const process = controlledExecFile();
        const { logger, videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/stuck.ts');
        const outcome = result.then(
            value => ({ value }),
            error => ({ error }),
        );

        await vi.advanceTimersByTimeAsync(30_000);
        expect(process.child.kill).toHaveBeenCalledOnce();
        expect(process.child.kill).toHaveBeenCalledWith('SIGKILL');
        expect(logger.system.error).not.toHaveBeenCalled();
        await expect(outcome).resolves.toMatchObject({ error: { message: 'VideoInfoTimeout' } });

        await vi.advanceTimersByTimeAsync(2_999);
        expect(logger.system.error).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(logger.system.error).toHaveBeenCalledOnce();
        expect(process.child.listenerCount('close')).toBe(0);
    });

    it('[RC-7.6] leaves unrelated event-loop work runnable and fences a late result after timeout', async () => {
        vi.useFakeTimers();
        const process = controlledExecFile();
        const parse = vi.spyOn(JSON, 'parse');
        const { videoUtil } = await createVideoProbe({ execFile: process.execFile });
        let probeSettled = false;
        const outcome = videoUtil.getInfo('synthetic-root/stalled-event-loop.ts').then(
            value => {
                probeSettled = true;
                return { value };
            },
            error => {
                probeSettled = true;
                return { error };
            },
        );
        let unrelatedOperationCompleted = false;
        const unrelatedOperation = new Promise<void>(resolve => {
            setImmediate(() => {
                unrelatedOperationCompleted = true;
                resolve();
            });
        });

        await vi.advanceTimersByTimeAsync(0);
        await unrelatedOperation;
        expect(unrelatedOperationCompleted).toBe(true);
        expect(probeSettled).toBe(false);

        await vi.advanceTimersByTimeAsync(30_000);
        process.callback()(null, '{"format":{"duration":"9","size":"9","bit_rate":"9"}}', '');
        process.child.emit('close', null, 'SIGKILL');

        await expect(outcome).resolves.toMatchObject({ error: { message: 'VideoInfoTimeout' } });
        expect(parse).not.toHaveBeenCalled();
        expect(process.child.kill).toHaveBeenCalledOnce();
    });
});
