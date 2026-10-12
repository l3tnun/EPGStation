import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface ProcessUtilModule {
    kill(child: unknown, wait?: number): Promise<void>;
    parseCmdStr(cmd: string): { args: string[]; bin: string };
}

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');
const ProcessUtil = (require(join(snapshot, 'util', 'ProcessUtil.js')) as { default: ProcessUtilModule }).default;

const makeChild = (stdio: { stderr: boolean; stdin: boolean; stdout: boolean }) =>
    Object.assign(new EventEmitter(), {
        kill: vi.fn(),
        stderr: stdio.stderr ? new PassThrough() : null,
        stdin: stdio.stdin ? new PassThrough() : null,
        stdout: stdio.stdout ? new PassThrough() : null,
    });

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('process termination preparation', () => {
    it('[MP-1.4] detaches the output pipes, drops the data listeners and interrupts the child after the wait', async () => {
        vi.useFakeTimers();
        const child = makeChild({ stderr: true, stdin: true, stdout: true });
        const stdinEnd = vi.spyOn(child.stdin!, 'end');
        const stdoutUnpipe = vi.spyOn(child.stdout!, 'unpipe');
        const stderrUnpipe = vi.spyOn(child.stderr!, 'unpipe');
        const stdoutEndListener = vi.fn();
        const stderrEndListener = vi.fn();
        child.stdout!.on('data', () => undefined);
        child.stdout!.on('end', stdoutEndListener);
        child.stderr!.on('data', () => undefined);
        child.stderr!.on('end', stderrEndListener);

        const killed = ProcessUtil.kill(child, 300);
        const settled = vi.fn();
        void killed.then(settled);

        expect(stdinEnd).toHaveBeenCalledOnce();
        expect(stdoutUnpipe).toHaveBeenCalledOnce();
        expect(stderrUnpipe).toHaveBeenCalledOnce();
        expect(child.stdout!.destroyed).toBe(true);
        expect(child.stderr!.destroyed).toBe(true);
        expect(child.stdout!.listenerCount('data')).toBe(0);
        expect(child.stderr!.listenerCount('data')).toBe(0);
        expect(child.stdout!.listenerCount('end')).toBe(1);
        expect(child.stderr!.listenerCount('end')).toBe(1);
        expect(child.kill).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(299);
        expect(child.kill).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await killed;
        expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGINT');
        expect(settled).toHaveBeenCalledOnce();
    });

    it.each([
        ['without stdin', { stderr: true, stdin: false, stdout: true }],
        ['without stdout', { stderr: true, stdin: true, stdout: false }],
        ['without stderr', { stderr: false, stdin: true, stdout: true }],
        ['without any stdio', { stderr: false, stdin: false, stdout: false }],
    ])('[MP-1.4] still interrupts a child %s', async (_label, stdio) => {
        vi.useFakeTimers();
        const child = makeChild(stdio);

        const killed = ProcessUtil.kill(child, 10);
        await vi.advanceTimersByTimeAsync(10);

        await expect(killed).resolves.toBeUndefined();
        expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGINT');
    });

    it('[MP-1.4] interrupts a child after the default 500 ms wait', async () => {
        vi.useFakeTimers();
        const child = makeChild({ stderr: false, stdin: false, stdout: false });

        const killed = ProcessUtil.kill(child);
        await vi.advanceTimersByTimeAsync(499);
        expect(child.kill).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await killed;
        expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGINT');
    });

    it('[MP-1.4] rejects with the preparation error when a stream cannot be closed', async () => {
        const failure = new Error('synthetic-stdin-failure');
        const child = makeChild({ stderr: false, stdin: true, stdout: false });
        vi.spyOn(child.stdin!, 'end').mockImplementation(() => {
            throw failure;
        });

        await expect(ProcessUtil.kill(child, 1)).rejects.toBe(failure);
        expect(child.kill).not.toHaveBeenCalled();
    });
});

describe('command string parsing', () => {
    it('[MP-1.4] reports a missing binary with the file system error as the cause', () => {
        let thrown: unknown;
        try {
            ProcessUtil.parseCmdStr(join(process.cwd(), 'no-such-synthetic-binary') + ' --flag');
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toBe('CmdBinIsNotFound');
        expect(((thrown as Error).cause as NodeJS.ErrnoException).code).toBe('ENOENT');
    });
});
