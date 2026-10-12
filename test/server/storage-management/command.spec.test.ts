import { spawn as actualSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStorageManager, deferred, settleMicrotasks, syntheticSpawnResult } from './_storage-harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}
const ProcessUtil = (
    require(join(compiledSnapshot, 'util', 'ProcessUtil.js')) as {
        default: { readonly ROOT_PATH: string };
    }
).default;

afterEach(() => {
    vi.useRealTimers();
});

describe('storage limit command characterization', () => {
    it('[SM-3.1] does not parse or spawn a command when limitCmd is absent', async () => {
        const spawn = vi.fn(() => syntheticSpawnResult());
        const { manager } = createStorageManager({ spawn });
        manager.getFreeSize = vi.fn(async () => 0);

        await manager.check([
            { action: 'none', limitThreshold: 1, name: 'no-command', path: 'synthetic-storage/no-command' },
        ]);

        expect(spawn).not.toHaveBeenCalled();
    });

    it('[SM-3.7] uses the actual parser placeholders and empty-argument removal for bin and args', async () => {
        const spawn = vi.fn(() => syntheticSpawnResult());
        const { manager } = createStorageManager({ spawn });
        manager.getFreeSize = vi.fn(async () => 0);

        await manager.check([
            {
                action: 'none',
                limitCmd: '%NODE% first  %ROOT%/synthetic%SPACE%argument',
                limitThreshold: 1,
                name: 'parsed-command',
                path: 'synthetic-storage/parsed-command',
            },
        ]);

        expect(spawn).toHaveBeenCalledOnce();
        expect(spawn).toHaveBeenCalledWith(process.argv[0], ['first', `${ProcessUtil.ROOT_PATH}/synthetic argument`], {
            stdio: 'ignore',
        });
    });

    it('[SM-3.5-PARSE] logs parser failure and still evaluates the remove action', async () => {
        const spawn = vi.fn(() => syntheticSpawnResult());
        const { findOld, logger, manager } = createStorageManager({ spawn });
        manager.getFreeSize = vi.fn(async () => 0);
        const command = 'synthetic-nonexistent-command-marker';

        await manager.check([
            {
                action: 'remove',
                limitCmd: command,
                limitThreshold: 1,
                name: 'parse-failure',
                path: 'synthetic-storage/parse-failure',
            },
        ]);

        expect(spawn).not.toHaveBeenCalled();
        expect(logger.system.error).toHaveBeenCalledWith(`limit cmd error: ${command}`);
        expect(findOld).toHaveBeenCalledOnce();
    });

    it('[SM-3.5-SPAWN] logs synchronous spawn failure and still evaluates the remove action', async () => {
        const spawnFailure = new Error('synthetic synchronous spawn failure');
        const spawn = vi.fn(() => {
            throw spawnFailure;
        });
        const { findOld, logger, manager } = createStorageManager({ spawn });
        manager.getFreeSize = vi.fn(async () => 0);

        await manager.check([
            {
                action: 'remove',
                limitCmd: '%NODE%',
                limitThreshold: 1,
                name: 'spawn-failure',
                path: 'synthetic-storage/spawn-failure',
            },
        ]);

        expect(spawn).toHaveBeenCalledOnce();
        expect(logger.system.error).toHaveBeenCalledWith('limit cmd error: %NODE%');
        expect(logger.system.error).toHaveBeenCalledWith(spawnFailure);
        expect(findOld).toHaveBeenCalledOnce();
    });

    it('[SM-3.4] starts deletion without waiting for a synthetic child terminal event', async () => {
        vi.useFakeTimers();
        const pendingDelete = deferred<'deleted'>();
        const spawn = vi.fn(() => syntheticSpawnResult());
        const { deletionPort, manager } = createStorageManager({
            deleteForStoragePressure: async () => pendingDelete.promise,
            findOld: async () => ({ id: 81 }),
            spawn,
        });
        manager.getFreeSize = vi
            .fn<(path: string) => Promise<number>>()
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(2 * 1024 * 1024);

        const check = manager.check([
            {
                action: 'remove',
                limitCmd: '%NODE%',
                limitThreshold: 1,
                name: 'non-waiting',
                path: 'synthetic-storage/non-waiting',
            },
        ]);
        await settleMicrotasks();
        await settleMicrotasks();

        expect(spawn).toHaveBeenCalledOnce();
        expect(deletionPort.requests).toEqual([{ recordedId: 81, storageName: 'non-waiting' }]);
        pendingDelete.resolve('deleted');
        await vi.advanceTimersByTimeAsync(100);
        await check;
    });

    it('[SM-3.8] omits shell and env options so an isolated synthetic child inherits the parent marker', async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-storage-command-'));
        const markerPath = join(temporaryRoot, 'marker.txt');
        const environmentKey = 'EPGSTATION_SYNTHETIC_STORAGE_PARENT_MARKER';
        const markerValue = 'synthetic-parent-environment-marker';
        const previousMarker = process.env[environmentKey];
        const childClosed = deferred<void>();
        let child: ChildProcess | undefined;
        const spawn = vi.fn((bin: string, args: readonly string[], options: unknown) => {
            child = actualSpawn(bin, [...args], options as SpawnOptions);
            child.once('close', () => childClosed.resolve());
            child.once('error', childClosed.reject);
            return child;
        });
        process.env[environmentKey] = markerValue;

        try {
            const { manager } = createStorageManager({ spawn });
            manager.getFreeSize = vi.fn(async () => 0);
            const script = `require('fs').writeFileSync(process.argv[1],process.env.${environmentKey})`;

            await manager.check([
                {
                    action: 'none',
                    limitCmd: `%NODE% -e ${script} ${markerPath}`,
                    limitThreshold: 1,
                    name: 'environment-child',
                    path: 'synthetic-storage/environment-child',
                },
            ]);
            await childClosed.promise;

            expect(child).toBeDefined();
            expect(await readFile(markerPath, 'utf8')).toBe(markerValue);
            const options = spawn.mock.calls[0][2] as SpawnOptions;
            expect(options).toEqual({ stdio: 'ignore' });
            expect(Object.hasOwn(options, 'env')).toBe(false);
            expect(Object.hasOwn(options, 'shell')).toBe(false);
        } finally {
            if (previousMarker === undefined) {
                delete process.env[environmentKey];
            } else {
                process.env[environmentKey] = previousMarker;
            }
            await rm(temporaryRoot, { force: true, recursive: true });
        }
    });

    it('[SM-3.1][SM-3.2][SM-3.6] starts a configured command with one finite deadline and finishes an action-none entry on terminal', async () => {
        vi.useFakeTimers();
        const child = syntheticSpawnResult(false);
        const spawn = vi.fn(() => child);
        const entry = {
            action: 'none' as const,
            limitCmd: '%NODE%',
            limitThreshold: 1,
            name: 'command-only',
            path: 'synthetic-storage/command-only',
        };
        const { deletionPort, manager } = createStorageManager({ spawn, storageLimitCommandTimeoutMs: 10 });
        manager.getFreeSize = vi.fn(async () => 0);

        const check = manager.check([entry]);
        await settleMicrotasks();
        expect(spawn).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(1);
        expect(deletionPort.requests).toEqual([]);
        expect(manager.isRunning).toBe(true);

        child.emit('close', 0, null);
        await check;
        expect(manager.isRunning).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[SM-3.3][SM-3.9] requests one SIGKILL at the deadline and keeps the entry unreaped until its terminal event', async () => {
        vi.useFakeTimers();
        const child = syntheticSpawnResult(false);
        const spawn = vi.fn(() => child);
        const entry = {
            action: 'none' as const,
            limitCmd: '%NODE%',
            limitThreshold: 1,
            name: 'timed-command',
            path: 'synthetic-storage/timed-command',
        };
        const { logger, manager } = createStorageManager({ spawn, storageLimitCommandTimeoutMs: 10 });
        manager.getFreeSize = vi.fn(async () => 0);

        const check = manager.check([entry]);
        await settleMicrotasks();
        child.emit('spawn');
        await vi.advanceTimersByTimeAsync(10);
        expect(child.kill).toHaveBeenCalledOnce();
        expect(child.kill).toHaveBeenCalledWith('SIGKILL');
        expect(manager.isRunning).toBe(true);

        await vi.advanceTimersByTimeAsync(3_000);
        expect(logger.system.error).toHaveBeenCalledWith('limit cmd terminal not observed: %NODE%');
        expect(manager.isRunning).toBe(true);

        child.emit('close', null, 'SIGKILL');
        await check;
        expect(manager.isRunning).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[SM-3.10] ignores a terminal callback from a completed command while its replacement remains active', async () => {
        vi.useFakeTimers();
        const firstChild = syntheticSpawnResult(false);
        const secondChild = syntheticSpawnResult(false);
        const spawn = vi.fn().mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
        const entry = {
            action: 'none' as const,
            limitCmd: '%NODE%',
            limitThreshold: 1,
            name: 'replacement-command',
            path: 'synthetic-storage/replacement-command',
        };
        const { manager } = createStorageManager({ spawn, storageLimitCommandTimeoutMs: 10 });
        manager.getFreeSize = vi.fn(async () => 0);

        const firstCheck = manager.check([entry]);
        await settleMicrotasks();
        const staleClose = firstChild.listeners('close')[0] as (
            code: number | null,
            signal: NodeJS.Signals | null,
        ) => void;
        firstChild.emit('close', 0, null);
        await firstCheck;

        const secondCheck = manager.check([entry]);
        await settleMicrotasks();
        expect(manager.isRunning).toBe(true);
        staleClose(0, null);
        expect(manager.isRunning).toBe(true);

        secondChild.emit('close', 0, null);
        await secondCheck;
        expect(manager.isRunning).toBe(false);
    });

    it('[SM-3.11] holds one command-owning entry while another entry completes independently', async () => {
        vi.useFakeTimers();
        const firstChild = syntheticSpawnResult(false);
        const secondChild = syntheticSpawnResult(false);
        const spawn = vi.fn().mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
        const first = {
            action: 'none' as const,
            limitCmd: '%NODE%',
            limitThreshold: 1,
            name: 'first-command',
            path: 'synthetic-storage/first-command',
        };
        const second = { ...first, name: 'second-command', path: 'synthetic-storage/second-command' };
        const { manager } = createStorageManager({ spawn, storageLimitCommandTimeoutMs: 10 });
        manager.getFreeSize = vi.fn(async () => 0);

        const firstCheck = manager.check([first]);
        await settleMicrotasks();
        const overlappingCheck = manager.check([first, second]);
        await settleMicrotasks();
        expect(spawn).toHaveBeenCalledTimes(2);

        secondChild.emit('close', 0, null);
        await overlappingCheck;
        expect(manager.isRunning).toBe(true);

        firstChild.emit('close', 0, null);
        await firstCheck;
        expect(manager.isRunning).toBe(false);
    });
});
