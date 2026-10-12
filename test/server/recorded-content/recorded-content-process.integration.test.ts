import { execFile as executeFile, spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createVideoProbe, type ExecFileFunction } from './_probe-harness';

interface ProcessFixture {
    readonly children: Set<ChildProcess>;
    readonly execFile: ExecFileFunction;
    readonly root: string;
}

const fixtures: ProcessFixture[] = [];
const cleanupTimeoutMilliseconds = 1_000;

const createTrackedExecFile =
    (children: Set<ChildProcess>): ExecFileFunction =>
    (file, args, callback) => {
        const child = executeFile(file, [...args], callback);
        children.add(child);
        return child;
    };

const createTerminalSuppressingExecFile = (children: Set<ChildProcess>) => {
    let child: ChildProcess | undefined;
    let lateResult: ((error: Error | null, stdout: string, stderr: string) => void) | undefined;
    const execFile: ExecFileFunction = (file, args, callback) => {
        lateResult = callback;
        child = spawn(file, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        children.add(child);
        const emit = child.emit.bind(child);
        child.emit = ((event: string | symbol, ...eventArgs: any[]) => {
            if (event === 'close') return false;
            return emit(event, ...eventArgs);
        }) as typeof child.emit;
        return child;
    };
    return {
        execFile,
        getChild: () => {
            if (child === undefined) throw new Error('Synthetic probe child was not started');
            return child;
        },
        sendLateResult: () => {
            if (lateResult === undefined) throw new Error('Synthetic probe callback was not installed');
            lateResult(null, '{"format":{"duration":"9","size":"9","bit_rate":"9"}}', '');
        },
    };
};

const createExecutable = async (): Promise<{ executable: string; fixture: ProcessFixture; root: string }> => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-synthetic-probe-'));
    const children = new Set<ChildProcess>();
    const fixture = { children, execFile: createTrackedExecFile(children), root };
    fixtures.push(fixture);
    const executable = join(root, 'synthetic-ffprobe');
    await writeFile(
        executable,
        `#!/usr/bin/env node
const { existsSync } = require('node:fs');
const input = process.argv.at(-1);
if (input.includes('hang')) {
    setInterval(() => undefined, 1000);
} else if (input.includes('invalid')) {
    process.stdout.write('{"format":');
} else if (input.includes('failure')) {
    process.exitCode = 17;
} else if (!existsSync(input)) {
    process.exitCode = 66;
} else {
    process.stdout.write('{"format":{"duration":"8.5","size":"1024","bit_rate":"2048"}}');
}
`,
        { mode: 0o700 },
    );
    await chmod(executable, 0o700);
    return { executable, fixture, root };
};

const processExists = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH';
    }
};

const waitForProcessExit = async (pid: number, timeoutMilliseconds: number): Promise<boolean> => {
    const deadline = performance.now() + timeoutMilliseconds;
    while (processExists(pid)) {
        const remaining = deadline - performance.now();
        if (remaining <= 0) {
            return false;
        }
        // Poll interval for the real condition (processExists(pid)) checked above; not a fixed
        // wait-then-assume delay.
        await new Promise(resolve => setTimeout(resolve, Math.min(20, remaining)));
    }
    return true;
};

const withFiniteTimeout = async <T>(operation: Promise<T>, message: string): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            operation,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(message)), cleanupTimeoutMilliseconds);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
};

const terminateChild = async (child: ChildProcess): Promise<void> => {
    const pid = child.pid;
    if (pid === undefined || !processExists(pid)) {
        return;
    }

    let killError: unknown;
    try {
        child.kill('SIGKILL');
    } catch (error: unknown) {
        killError = error;
    }
    const exited = await waitForProcessExit(pid, cleanupTimeoutMilliseconds);
    if (!exited) {
        throw new Error(`Synthetic probe child did not exit during cleanup: pid=${String(pid)}`);
    }
    if (killError !== undefined) {
        throw killError;
    }
};

const cleanupFixture = async (fixture: ProcessFixture): Promise<void> => {
    const failures: unknown[] = [];
    const terminations = await Promise.allSettled([...fixture.children].map(terminateChild));
    failures.push(...terminations.filter(result => result.status === 'rejected').map(result => result.reason));

    try {
        await withFiniteTimeout(
            rm(fixture.root, { force: true, recursive: true }),
            `Synthetic probe directory cleanup timed out: ${fixture.root}`,
        );
    } catch (error: unknown) {
        failures.push(error);
    }
    if (failures.length > 0) {
        throw new AggregateError(failures, `Synthetic probe cleanup failed: ${fixture.root}`);
    }
};

const cleanupAndUntrack = async (fixture: ProcessFixture): Promise<void> => {
    await cleanupFixture(fixture);
    const index = fixtures.indexOf(fixture);
    if (index >= 0) {
        fixtures.splice(index, 1);
    }
};

afterEach(async () => {
    const failures: unknown[] = [];
    for (const fixture of [...fixtures]) {
        try {
            await cleanupAndUntrack(fixture);
        } catch (error: unknown) {
            failures.push(error);
        }
    }
    if (failures.length > 0) {
        throw new AggregateError(failures, 'Synthetic probe afterEach cleanup failed');
    }
});

describe('recorded content child-process boundary', () => {
    it('[RC-7.1/7.4] accepts only normal JSON from a synthetic executable', async () => {
        const { executable, fixture, root } = await createExecutable();
        const normal = join(root, 'normal.ts');
        const invalid = join(root, 'invalid.ts');
        const failure = join(root, 'failure.ts');
        const missing = join(root, 'missing.ts');
        await Promise.all([normal, invalid, failure].map(path => writeFile(path, 'synthetic')));
        const { videoUtil } = await createVideoProbe({ execFile: fixture.execFile, ffprobe: executable, recordedPath: root });

        await expect(videoUtil.getInfo(normal)).resolves.toEqual({ bitRate: 2048, duration: 8.5, size: 1024 });
        await expect(videoUtil.getInfo(invalid)).rejects.toBeInstanceOf(SyntaxError);
        await expect(videoUtil.getInfo(failure)).rejects.toMatchObject({ code: 17 });
        await expect(videoUtil.getInfo(missing)).rejects.toMatchObject({ code: 66 });
    });

    it('[RC-7.4] rejects a synthetic spawn failure', async () => {
        const { fixture, root } = await createExecutable();
        const input = join(root, 'spawn-failure.ts');
        await writeFile(input, 'synthetic');
        const { videoUtil } = await createVideoProbe({
            execFile: fixture.execFile,
            ffprobe: join(root, 'missing-executable'),
            recordedPath: root,
        });

        await expect(videoUtil.getInfo(input)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('[RC-7.2/7.5/7.6] kills a stuck synthetic child at 30 seconds and leaves no process or temp resource', async () => {
        const { executable, fixture, root } = await createExecutable();
        const input = join(root, 'hang.ts');
        await writeFile(input, 'synthetic');
        const { videoUtil } = await createVideoProbe({ execFile: fixture.execFile, ffprobe: executable, recordedPath: root });

        try {
            const startedAt = performance.now();
            const result = videoUtil.getInfo(input);
            const child = [...fixture.children].at(-1);
            if (child?.pid === undefined) {
                throw new Error('Synthetic probe child handle was not captured at start');
            }
            const pid = child.pid;

            await expect(result).rejects.toThrow('VideoInfoTimeout');
            const elapsed = performance.now() - startedAt;
            const exited = await waitForProcessExit(pid, cleanupTimeoutMilliseconds);

            expect(elapsed).toBeGreaterThanOrEqual(29_900);
            expect(elapsed).toBeLessThan(33_000);
            expect(exited).toBe(true);
            expect(processExists(pid)).toBe(false);
        } finally {
            await cleanupAndUntrack(fixture);
        }
    }, 36_000);

    it('probe-timeout-kill-and-late-output', async () => {
        const { executable, fixture, root } = await createExecutable();
        const input = join(root, 'hang-with-terminal-suppressed.ts');
        await writeFile(input, 'synthetic');
        const nativeSetTimeout = global.setTimeout;
        let monotonicNow = 0;
        const timers = new Map<unknown, { dueAt: number; run: () => void }>();
        vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
        vi.spyOn(global, 'setTimeout').mockImplementation(
            ((handler: (...args: any[]) => void, delay = 0, ...args: any[]) => {
                const handle = {};
                timers.set(handle, { dueAt: monotonicNow + Number(delay), run: () => handler(...args) });
                return handle as unknown as NodeJS.Timeout;
            }) as typeof setTimeout,
        );
        vi.spyOn(global, 'clearTimeout').mockImplementation(
            ((handle: NodeJS.Timeout | number | undefined) => {
                timers.delete(handle);
            }) as typeof clearTimeout,
        );
        const runTimer = (dueAt: number): void => {
            const entry = [...timers.entries()].find(([, timer]) => timer.dueAt === dueAt);
            if (entry === undefined) throw new Error(`Synthetic timer is missing at ${String(dueAt)}`);
            timers.delete(entry[0]);
            entry[1].run();
        };
        const waitForActualExit = async (pid: number): Promise<boolean> => {
            const deadline = Date.now() + cleanupTimeoutMilliseconds;
            while (processExists(pid)) {
                if (Date.now() >= deadline) return false;
                await new Promise<void>(resolve => nativeSetTimeout(resolve, 20));
            }
            return true;
        };
        const process = createTerminalSuppressingExecFile(fixture.children);
        const parse = vi.spyOn(JSON, 'parse');
        const { logger, videoUtil } = await createVideoProbe({
            execFile: process.execFile,
            ffprobe: executable,
            recordedPath: root,
        });
        const result = videoUtil.getInfo(input);
        const child = process.getChild();
        if (child.pid === undefined) throw new Error('Synthetic probe child handle was not captured at start');
        const pid = child.pid;
        const closeListenerCountAfterAttach = child.listenerCount('close');
        const outcome = result.then(
            value => ({ value }),
            (error: Error) => ({ error }),
        );

        try {
            monotonicNow = 30_000;
            runTimer(30_000);
            await expect(outcome).resolves.toMatchObject({ error: { message: 'VideoInfoTimeout' } });
            expect(await waitForActualExit(pid)).toBe(true);
            expect(processExists(pid)).toBe(false);
            expect(child.stdout).not.toBeNull();
            expect(child.stderr).not.toBeNull();
            expect(child.stdout?.destroyed).toBe(true);
            expect(child.stderr?.destroyed).toBe(true);
            expect(closeListenerCountAfterAttach).toBe(1);
            expect(child.listenerCount('close')).toBe(closeListenerCountAfterAttach);

            monotonicNow = 32_999;
            runTimer(33_000);
            expect(logger.system.error).not.toHaveBeenCalled();
            expect(child.listenerCount('close')).toBe(closeListenerCountAfterAttach);
            expect(timers.size).toBe(1);

            monotonicNow = 33_000;
            runTimer(33_000);
            expect(logger.system.error).toHaveBeenCalledWith(
                `video probe terminal not observed after SIGKILL: pid=${String(pid)}`,
            );
            expect(child.listenerCount('close')).toBe(0);
            expect(timers.size).toBe(0);

            process.sendLateResult();
            expect(parse).not.toHaveBeenCalled();
        } finally {
            vi.restoreAllMocks();
            await cleanupAndUntrack(fixture);
        }
    }, 10_000);
});
