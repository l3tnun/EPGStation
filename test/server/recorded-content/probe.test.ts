import type { ExecFileException } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { controlledExecFile, createVideoProbe, syntheticProbeChild, type ExecFileFunction } from './_probe-harness';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('recorded content probe characterization', () => {
    it('process-failure-invalid-json-and-deadline', async () => {
        const processFailure = controlledExecFile();
        const processFailureError = new Error('SYNTHETIC_PROCESS_FAILURE');
        const failedProbe = await createVideoProbe({ execFile: processFailure.execFile });
        const failedResult = failedProbe.videoUtil.getInfo('synthetic-root/process-failure.ts');
        processFailure.callback()(processFailureError, '', '');
        await expect(failedResult).rejects.toBe(processFailureError);

        const invalidJson = controlledExecFile();
        const invalidJsonProbe = await createVideoProbe({ execFile: invalidJson.execFile });
        const invalidJsonResult = invalidJsonProbe.videoUtil.getInfo('synthetic-root/invalid-json.ts');
        invalidJson.callback()(null, '{"format":', '');
        await expect(invalidJsonResult).rejects.toBeInstanceOf(SyntaxError);

        vi.useFakeTimers();
        const deadline = controlledExecFile();
        const deadlineProbe = await createVideoProbe({ execFile: deadline.execFile });
        const deadlineResult = deadlineProbe.videoUtil.getInfo('synthetic-root/deadline.ts');
        const deadlineRejection = expect(deadlineResult).rejects.toThrow('VideoInfoTimeout');
        await vi.advanceTimersByTimeAsync(30_000);
        await deadlineRejection;
        expect(deadline.child.kill).toHaveBeenCalledOnce();
        deadline.child.emit('close', null, 'SIGKILL');
        expect(deadline.child.listenerCount('close')).toBe(0);
    });

    it.each([
        ['missing file', Object.assign(new Error('SYNTHETIC_FILE_MISSING'), { code: 'ENOENT' })],
        ['spawn failure', Object.assign(new Error('SYNTHETIC_SPAWN_FAILURE'), { code: 'ENOEXEC' })],
        ['non-zero exit', Object.assign(new Error('SYNTHETIC_NON_ZERO_EXIT'), { code: 17 })],
    ])('[RC-7.4] returns no successful value after %s', async (_label, failure) => {
        const process = controlledExecFile();
        const { videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/missing-or-failed.ts');

        process.callback()(failure as ExecFileException, '', 'redacted synthetic diagnostic');

        await expect(result).rejects.toBe(failure);
        expect(process.execFile).toHaveBeenCalledOnce();
    });

    it('[RC-7.4] returns no successful value for invalid JSON', async () => {
        const process = controlledExecFile();
        const { videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/invalid-json.ts');

        process.callback()(null, '{"format":', '');

        await expect(result).rejects.toBeInstanceOf(SyntaxError);
    });

    it('[RC-7.4/7.6] fences a queued successful callback after process failure', async () => {
        const process = controlledExecFile();
        const parse = vi.spyOn(JSON, 'parse');
        const failure = new Error('SYNTHETIC_TERMINAL_FAILURE');
        const { videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/failed-then-late.ts');

        process.callback()(failure, '', '');
        await expect(result).rejects.toBe(failure);
        process.callback()(null, '{"format":{"duration":"1","size":"2","bit_rate":"3"}}', '');

        expect(parse).not.toHaveBeenCalled();
        expect(process.child.listenerCount('close')).toBe(0);
    });

    it('[RC-7.4] rejects a synchronous execFile throw without installing resources', async () => {
        vi.useFakeTimers();
        const failure = new Error('SYNTHETIC_SYNCHRONOUS_SPAWN_FAILURE');
        const execFile = vi.fn<ExecFileFunction>(() => {
            throw failure;
        });
        const { videoUtil } = await createVideoProbe({ execFile });

        await expect(videoUtil.getInfo('synthetic-root/synchronous-failure.ts')).rejects.toBe(failure);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RC-7.1] releases safely when execFile invokes a successful callback synchronously', async () => {
        vi.useFakeTimers();
        const child = syntheticProbeChild();
        const execFile = vi.fn<ExecFileFunction>((_file, _args, callback) => {
            callback(null, '{"format":{"duration":"1","size":"2","bit_rate":"3"}}', '');
            return child;
        });
        const { videoUtil } = await createVideoProbe({ execFile });

        await expect(videoUtil.getInfo('synthetic-root/synchronous-success.ts')).resolves.toEqual({
            bitRate: 3,
            duration: 1,
            size: 2,
        });
        expect(child.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RC-7.5] rejects once, requests SIGKILL once, and logs only after the 3-second stop grace', async () => {
        vi.useFakeTimers();
        const process = controlledExecFile();
        const { logger, videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/stuck.ts');
        const rejection = expect(result).rejects.toThrow('VideoInfoTimeout');

        await vi.advanceTimersByTimeAsync(30_000);
        expect(process.child.kill).toHaveBeenCalledOnce();
        expect(process.child.kill).toHaveBeenCalledWith('SIGKILL');
        expect(logger.system.error).not.toHaveBeenCalled();
        await rejection;

        await vi.advanceTimersByTimeAsync(2_999);
        expect(logger.system.error).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(logger.system.error).toHaveBeenCalledOnce();
        expect(logger.system.error).toHaveBeenCalledWith('video probe terminal not observed after SIGKILL: pid=4242');
        expect(process.child.kill).toHaveBeenCalledOnce();
        expect(process.child.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RC-7.5] clears the stop grace without logging when close is observed', async () => {
        vi.useFakeTimers();
        const timeoutSpy = vi.spyOn(global, 'setTimeout');
        const process = controlledExecFile();
        const { logger, videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/stops.ts');
        const rejection = expect(result).rejects.toThrow('VideoInfoTimeout');

        await vi.advanceTimersByTimeAsync(30_000);
        const staleGrace = timeoutSpy.mock.calls[1][0] as () => void;
        process.child.emit('close', null, 'SIGKILL');
        await vi.advanceTimersByTimeAsync(3_000);

        await rejection;
        expect(logger.system.error).not.toHaveBeenCalled();
        expect(process.child.kill).toHaveBeenCalledOnce();
        expect(process.child.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);

        staleGrace();
        expect(logger.system.error).not.toHaveBeenCalled();
    });

    it('[RC-7.5] does not arm the stop grace when SIGKILL synchronously observes close', async () => {
        vi.useFakeTimers();
        const process = controlledExecFile();
        vi.mocked(process.child.kill).mockImplementation(() => {
            process.child.emit('close', null, 'SIGKILL');
            return true;
        });
        const { logger, videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/synchronous-stop.ts');
        const rejection = expect(result).rejects.toThrow('VideoInfoTimeout');

        await vi.advanceTimersByTimeAsync(30_000);
        await rejection;
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(3_000);

        expect(process.child.kill).toHaveBeenCalledOnce();
        expect(logger.system.error).not.toHaveBeenCalled();
        expect(process.child.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RC-7.5] keeps the stop confirmation finite when SIGKILL throws', async () => {
        vi.useFakeTimers();
        const process = controlledExecFile();
        vi.mocked(process.child.kill).mockImplementation(() => {
            throw new Error('SYNTHETIC_KILL_FAILURE');
        });
        const { logger, videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/kill-failure.ts');
        const rejection = expect(result).rejects.toThrow('VideoInfoTimeout');

        await vi.advanceTimersByTimeAsync(33_000);

        await rejection;
        expect(process.child.kill).toHaveBeenCalledOnce();
        expect(logger.system.error).toHaveBeenCalledOnce();
        expect(process.child.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RC-7.5] keeps timeout cleanup safe when no logger was injected', async () => {
        vi.useFakeTimers();
        const process = controlledExecFile();
        const { videoUtil } = await createVideoProbe({ execFile: process.execFile, provideLogger: false });
        const result = videoUtil.getInfo('synthetic-root/no-logger.ts');
        const rejection = expect(result).rejects.toThrow('VideoInfoTimeout');

        await vi.advanceTimersByTimeAsync(33_000);

        await rejection;
        expect(process.child.kill).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RC-7.2] times out immediately when the spawn call itself crosses the deadline', async () => {
        vi.useFakeTimers();
        let monotonicNow = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
        const process = controlledExecFile();
        process.execFile.mockImplementation((_file, _args, callback) => {
            monotonicNow = 30_000;
            return process.child;
        });
        const { videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/slow-spawn.ts');

        await expect(result).rejects.toThrow('VideoInfoTimeout');
        expect(process.child.kill).toHaveBeenCalledOnce();
        expect(process.child.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('reschedules an early deadline timer callback for the remaining monotonic time', async () => {
        vi.useFakeTimers();
        let monotonicNow = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
        const timeoutSpy = vi.spyOn(global, 'setTimeout');
        const process = controlledExecFile();
        const { videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/early-deadline-callback.ts');
        const outcome = result.then(
            value => ({ value }),
            error => ({ error }),
        );
        const earlyDeadline = timeoutSpy.mock.calls[0][0] as () => void;
        clearTimeout(timeoutSpy.mock.results[0].value as NodeJS.Timeout);

        monotonicNow = 29_999;
        earlyDeadline();

        expect(process.child.kill).not.toHaveBeenCalled();
        expect(timeoutSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 1);

        const deadline = timeoutSpy.mock.calls[1][0] as () => void;
        clearTimeout(timeoutSpy.mock.results[1].value as NodeJS.Timeout);
        monotonicNow = 30_000;
        deadline();

        expect(process.child.kill).toHaveBeenCalledOnce();
        await expect(outcome).resolves.toMatchObject({ error: { message: 'VideoInfoTimeout' } });
    });

    it('reschedules an early stop-grace callback until its independent monotonic deadline', async () => {
        vi.useFakeTimers();
        let monotonicNow = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
        const timeoutSpy = vi.spyOn(global, 'setTimeout');
        const process = controlledExecFile();
        const { logger, videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/early-stop-grace-callback.ts');
        const outcome = result.then(
            value => ({ value }),
            error => ({ error }),
        );
        const deadline = timeoutSpy.mock.calls[0][0] as () => void;
        clearTimeout(timeoutSpy.mock.results[0].value as NodeJS.Timeout);

        monotonicNow = 30_000;
        deadline();
        const earlyStopGrace = timeoutSpy.mock.calls[1][0] as () => void;
        clearTimeout(timeoutSpy.mock.results[1].value as NodeJS.Timeout);

        monotonicNow = 32_999;
        earlyStopGrace();

        expect(logger.system.error).not.toHaveBeenCalled();
        expect(timeoutSpy).toHaveBeenNthCalledWith(3, expect.any(Function), 1);

        const stopGrace = timeoutSpy.mock.calls[2][0] as () => void;
        clearTimeout(timeoutSpy.mock.results[2].value as NodeJS.Timeout);
        monotonicNow = 33_000;
        stopGrace();

        await expect(outcome).resolves.toMatchObject({ error: { message: 'VideoInfoTimeout' } });
        expect(logger.system.error).toHaveBeenCalledOnce();
        expect(process.child.listenerCount('close')).toBe(0);
    });

    it('subtracts synchronous SIGKILL time when initially arming the monotonic stop grace', async () => {
        vi.useFakeTimers();
        let monotonicNow = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
        const timeoutSpy = vi.spyOn(global, 'setTimeout');
        const process = controlledExecFile();
        vi.mocked(process.child.kill).mockImplementation(() => {
            monotonicNow = 31_000;
            return true;
        });
        const { videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/slow-sigkill.ts');
        const outcome = result.then(
            value => ({ value }),
            error => ({ error }),
        );
        const deadline = timeoutSpy.mock.calls[0][0] as () => void;
        clearTimeout(timeoutSpy.mock.results[0].value as NodeJS.Timeout);

        monotonicNow = 30_000;
        deadline();

        expect(timeoutSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 2_000);
        process.child.emit('close', null, 'SIGKILL');
        await expect(outcome).resolves.toMatchObject({ error: { message: 'VideoInfoTimeout' } });
    });

    it('[RC-7.2/7.6] gives timeout precedence when a result callback starts at the deadline', async () => {
        vi.useFakeTimers();
        let monotonicNow = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
        const parse = vi.spyOn(JSON, 'parse');
        const process = controlledExecFile();
        const { videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/result-at-deadline.ts');
        monotonicNow = 30_000;

        process.callback()(null, '{"format":{"duration":"1","size":"2","bit_rate":"3"}}', '');

        await expect(result).rejects.toThrow('VideoInfoTimeout');
        expect(parse).not.toHaveBeenCalled();
        expect(process.child.kill).toHaveBeenCalledOnce();
    });

    it('[RC-7.2/7.6] gives timeout precedence when failed parsing reaches the deadline', async () => {
        vi.useFakeTimers();
        let monotonicNow = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
        vi.spyOn(JSON, 'parse').mockImplementation(() => {
            monotonicNow = 30_000;
            throw new SyntaxError('SYNTHETIC_LATE_PARSE_FAILURE');
        });
        const process = controlledExecFile();
        const { videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/parse-at-deadline.ts');

        process.callback()(null, '{"format":', '');

        expect(process.child.kill).toHaveBeenCalledOnce();
        await expect(result).rejects.toThrow('VideoInfoTimeout');
    });

    it.each(['size parseInt', 'bit-rate parseFloat'] as const)(
        'rechecks the deadline after %s crosses it and before successful settlement',
        async conversion => {
            vi.useFakeTimers();
            let monotonicNow = 0;
            vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
            const process = controlledExecFile();
            const { videoUtil } = await createVideoProbe({ execFile: process.execFile });
            const result = videoUtil.getInfo(`synthetic-root/${conversion}.ts`);
            const outcome = result.then(
                value => ({ value }),
                error => ({ error }),
            );
            const originalParseFloat = globalThis.parseFloat;
            const originalParseInt = globalThis.parseInt;
            let parseFloatCalls = 0;
            vi.spyOn(globalThis, 'parseFloat').mockImplementation(value => {
                parseFloatCalls += 1;
                const parsed = originalParseFloat(value);
                if (conversion === 'bit-rate parseFloat' && parseFloatCalls === 2) {
                    monotonicNow = 30_000;
                }
                return parsed;
            });
            vi.spyOn(globalThis, 'parseInt').mockImplementation((value, radix) => {
                const parsed = originalParseInt(value, radix);
                if (conversion === 'size parseInt') {
                    monotonicNow = 30_000;
                }
                return parsed;
            });

            process.callback()(null, '{"format":{"duration":"1","size":"2","bit_rate":"3"}}', '');

            expect(process.child.kill).toHaveBeenCalledOnce();
            await expect(outcome).resolves.toMatchObject({ error: { message: 'VideoInfoTimeout' } });
        },
    );

    it('[RC-7.6] fences queued deadline and result callbacks after successful settlement', async () => {
        vi.useFakeTimers();
        const timeoutSpy = vi.spyOn(global, 'setTimeout');
        const parse = vi.spyOn(JSON, 'parse');
        const process = controlledExecFile();
        const { videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/settled.ts');
        const staleDeadline = timeoutSpy.mock.calls[0][0] as () => void;

        process.callback()(null, '{"format":{"duration":"1","size":"2","bit_rate":"3"}}', '');
        await expect(result).resolves.toEqual({ bitRate: 3, duration: 1, size: 2 });
        const parseCalls = parse.mock.calls.length;
        staleDeadline();
        process.callback()(null, '{"format":{"duration":"4","size":"5","bit_rate":"6"}}', '');

        expect(process.child.kill).not.toHaveBeenCalled();
        expect(parse).toHaveBeenCalledTimes(parseCalls);
        expect(process.child.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RC-7.6] fences late output, duplicate terminal callbacks, and parse after timeout', async () => {
        vi.useFakeTimers();
        const process = controlledExecFile();
        const parse = vi.spyOn(JSON, 'parse');
        const { videoUtil } = await createVideoProbe({ execFile: process.execFile });
        const result = videoUtil.getInfo('synthetic-root/late.ts');
        const rejection = expect(result).rejects.toThrow('VideoInfoTimeout');

        await vi.advanceTimersByTimeAsync(30_001);
        await rejection;
        process.callback()(null, '{"format":{"duration":"9","size":"9","bit_rate":"9"}}', '');
        process.callback()(null, '{"format":{"duration":"10","size":"10","bit_rate":"10"}}', '');
        process.child.emit('close', null, 'SIGKILL');

        expect(parse).not.toHaveBeenCalled();
        expect(process.child.kill).toHaveBeenCalledOnce();
        expect(process.child.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[RC-7.6] keeps a concurrent successful request independent from a timed-out request', async () => {
        vi.useFakeTimers();
        const stuck = controlledExecFile();
        const successful = controlledExecFile();
        const stuckProbe = await createVideoProbe({ execFile: stuck.execFile });
        const successfulProbe = await createVideoProbe({ execFile: successful.execFile });
        const stuckResult = stuckProbe.videoUtil.getInfo('synthetic-root/stuck-independent.ts');
        const stuckRejection = expect(stuckResult).rejects.toThrow('VideoInfoTimeout');
        const successfulResult = successfulProbe.videoUtil.getInfo('synthetic-root/success-independent.ts');

        await vi.advanceTimersByTimeAsync(29_999);
        successful.callback()(null, '{"format":{"duration":"4","size":"5","bit_rate":"6"}}', '');
        await vi.advanceTimersByTimeAsync(1);
        stuck.callback()(null, '{"format":{"duration":"7","size":"8","bit_rate":"9"}}', '');
        stuck.child.emit('close', null, 'SIGKILL');

        await stuckRejection;
        await expect(successfulResult).resolves.toEqual({ bitRate: 6, duration: 4, size: 5 });
        expect(stuck.child.kill).toHaveBeenCalledOnce();
        expect(successful.child.kill).not.toHaveBeenCalled();
    });
});
