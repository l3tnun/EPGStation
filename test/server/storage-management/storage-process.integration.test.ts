import { spawn as actualSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStorageManager, deferred } from './_storage-harness';

afterEach(() => {
    vi.useRealTimers();
});

interface ChildTerminal {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
}

interface PlatformBoundaryObservation {
    readonly capacity: {
        readonly mountPoint: boolean;
        readonly normal: boolean;
        readonly samePath: boolean;
        readonly symlink: boolean;
    };
    readonly failedChild: {
        readonly close: boolean;
        readonly errorCode: string | undefined;
    };
    readonly inheritedMarker: boolean;
    readonly normalChild: {
        readonly close: ChildTerminal;
        readonly exit: ChildTerminal;
    };
    readonly stoppedChild: {
        readonly close: ChildTerminal;
        readonly exit: ChildTerminal;
    };
}

interface DiskUsage {
    readonly available: number;
    readonly total: number;
    readonly used: number;
}

interface StorageInformationRuntime {
    getInfo(): Promise<{ items: Array<DiskUsage & { name: string }> }>;
}

interface StorageInformationConstructor {
    new (configuration: { getConfig(): Record<string, unknown> }): StorageInformationRuntime;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}
const StorageApiModel = (
    require(join(compiledSnapshot, 'model', 'api', 'storage', 'StorageApiModel.js')) as {
        default: StorageInformationConstructor;
    }
).default;

const observationDeadlineMilliseconds = 2_000;

const waitForSpawn = (child: ChildProcess): Promise<void> =>
    new Promise((resolve, reject) => {
        const cleanup = (): void => {
            child.removeListener('error', onError);
            child.removeListener('spawn', onSpawn);
        };
        const onError = (error: Error): void => {
            cleanup();
            reject(error);
        };
        const onSpawn = (): void => {
            cleanup();
            resolve();
        };

        child.once('error', onError);
        child.once('spawn', onSpawn);
    });

const waitForTerminal = (child: ChildProcess): Promise<{ close: ChildTerminal; exit: ChildTerminal }> =>
    new Promise((resolve, reject) => {
        let close: ChildTerminal | undefined;
        let exit: ChildTerminal | undefined;
        const deadline = setTimeout(
            () => fail(new Error('Synthetic child terminal was not observed')),
            observationDeadlineMilliseconds,
        );
        const cleanup = (): void => {
            clearTimeout(deadline);
            child.removeListener('close', onClose);
            child.removeListener('error', onError);
            child.removeListener('exit', onExit);
        };
        const fail = (error: Error): void => {
            cleanup();
            reject(error);
        };
        const finish = (): void => {
            if (close !== undefined && exit !== undefined) {
                cleanup();
                resolve({ close, exit });
            }
        };
        const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
            close = { code, signal };
            finish();
        };
        const onError = (error: Error): void => fail(error);
        const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
            exit = { code, signal };
            finish();
        };

        child.once('close', onClose);
        child.once('error', onError);
        child.once('exit', onExit);
    });

const waitForClose = (child: ChildProcess): Promise<ChildTerminal> =>
    new Promise(resolve => {
        child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
            resolve({ code, signal });
        });
    });

const waitForFailedSpawn = (child: ChildProcess): Promise<{ close: boolean; errorCode: string | undefined }> =>
    new Promise((resolve, reject) => {
        let closed = false;
        let errorCode: string | undefined;
        const deadline = setTimeout(
            () => fail(new Error('Synthetic failed child terminal was not observed')),
            observationDeadlineMilliseconds,
        );
        const cleanup = (): void => {
            clearTimeout(deadline);
            child.removeListener('close', onClose);
            child.removeListener('error', onError);
        };
        const fail = (error: Error): void => {
            cleanup();
            reject(error);
        };
        const finish = (): void => {
            if (closed && errorCode !== undefined) {
                cleanup();
                resolve({ close: true, errorCode });
            }
        };
        const onClose = (): void => {
            closed = true;
            finish();
        };
        const onError = (error: NodeJS.ErrnoException): void => {
            errorCode = error.code;
            finish();
        };

        child.once('close', onClose);
        child.once('error', onError);
    });

const reapChild = async (
    child: ChildProcess | undefined,
    terminal?: Promise<unknown>,
    closeTerminal?: Promise<unknown>,
): Promise<void> => {
    if (child === undefined) {
        return;
    }

    const terminalObservation = terminal ?? Promise.resolve();
    const closeObservation = closeTerminal ?? waitForClose(child);
    if (child.exitCode === null && child.signalCode === null && !child.kill('SIGKILL')) {
        throw new Error('Synthetic child rejected cleanup');
    }
    const [terminalResult] = await Promise.allSettled([terminalObservation, closeObservation]);
    if (terminalResult.status === 'rejected') {
        throw terminalResult.reason;
    }
};

const findMountPoint = async (path: string): Promise<string> => {
    let candidate = path;
    for (;;) {
        const parent = dirname(candidate);
        if (parent === candidate) {
            return candidate;
        }

        const [candidateStats, parentStats] = await Promise.all([stat(candidate), stat(parent)]);
        if (candidateStats.dev !== parentStats.dev) {
            return candidate;
        }
        candidate = parent;
    }
};

const isObservedCapacity = (usage: DiskUsage | undefined): boolean =>
    usage !== undefined &&
    [usage.available, usage.total, usage.used].every(value => Number.isFinite(value) && value >= 0);

const observePlatformBoundary = async (): Promise<PlatformBoundaryObservation> => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-storage-platform-'));
    const markerPath = join(temporaryRoot, 'marker.txt');
    const symbolicPath = join(temporaryRoot, 'symlink');
    const environmentKey = 'EPGSTATION_SYNTHETIC_STORAGE_PLATFORM_MARKER';
    const markerValue = 'synthetic-storage-platform-marker';
    const previousMarker = process.env[environmentKey];
    let normalChild: ChildProcess | undefined;
    let normalTerminal: ReturnType<typeof waitForTerminal> | undefined;
    let normalClose: ReturnType<typeof waitForClose> | undefined;
    let stoppedChild: ChildProcess | undefined;
    let stoppedTerminal: ReturnType<typeof waitForTerminal> | undefined;
    let stoppedClose: ReturnType<typeof waitForClose> | undefined;
    let primaryFailure: unknown;

    process.env[environmentKey] = markerValue;
    try {
        await symlink(temporaryRoot, symbolicPath, 'dir');
        const mountPoint = await findMountPoint(temporaryRoot);
        const capacity = await new StorageApiModel({
            getConfig: () => ({
                recorded: [
                    { name: 'normal', path: temporaryRoot },
                    { name: 'same-path', path: temporaryRoot },
                    { name: 'symlink', path: symbolicPath },
                    { name: 'mount-point', path: mountPoint },
                ],
            }),
        }).getInfo();
        const [normal, samePath, symbolic, mount] = capacity.items;

        normalChild = actualSpawn(
            process.execPath,
            [
                '-e',
                "require('node:fs').writeFileSync(process.argv[1], process.env[process.argv[2]] ?? '');",
                markerPath,
                environmentKey,
            ],
            { stdio: 'ignore' },
        );
        normalClose = waitForClose(normalChild);
        normalTerminal = waitForTerminal(normalChild);
        const normalChildTerminal = await normalTerminal;
        const failedChild = actualSpawn(join(temporaryRoot, 'missing-synthetic-child'), [], { stdio: 'ignore' });
        const failedSpawn = await waitForFailedSpawn(failedChild);

        stoppedChild = actualSpawn(process.execPath, ['-e', 'setInterval(() => undefined, 60_000);'], {
            stdio: 'ignore',
        });
        stoppedClose = waitForClose(stoppedChild);
        stoppedTerminal = waitForTerminal(stoppedChild);
        await waitForSpawn(stoppedChild);
        if (!stoppedChild.kill('SIGKILL')) {
            throw new Error('Synthetic child rejected the stop request');
        }

        return {
            capacity: {
                mountPoint: isObservedCapacity(mount),
                normal: isObservedCapacity(normal),
                samePath: isObservedCapacity(samePath),
                symlink: isObservedCapacity(symbolic),
            },
            failedChild: failedSpawn,
            inheritedMarker: (await readFile(markerPath, 'utf8')) === markerValue,
            normalChild: normalChildTerminal,
            stoppedChild: await stoppedTerminal,
        };
    } catch (error) {
        primaryFailure = error;
        throw error;
    } finally {
        const cleanupResults = await Promise.allSettled([
            reapChild(normalChild, normalTerminal, normalClose),
            reapChild(stoppedChild, stoppedTerminal, stoppedClose),
        ]);
        let cleanupFailure: unknown;
        let cleanupFailed = false;
        for (const result of cleanupResults) {
            if (result.status === 'rejected' && !cleanupFailed) {
                cleanupFailed = true;
                cleanupFailure = result.reason;
            }
        }

        try {
            if (previousMarker === undefined) {
                delete process.env[environmentKey];
            } else {
                process.env[environmentKey] = previousMarker;
            }
        } finally {
            await rm(temporaryRoot, { force: true, recursive: true });
        }
        if (primaryFailure === undefined && cleanupFailed) {
            throw cleanupFailure;
        }
    }
};

describe('storage command process integration: spawn environment, timeout, kill, and late terminal', () => {
    it('[STORAGE-T6.2-PLATFORM-BOUNDARY] observes synthetic child terminals and capacity path categories without persisting platform values', async () => {
        await expect(observePlatformBoundary()).resolves.toEqual({
            capacity: {
                mountPoint: true,
                normal: true,
                samePath: true,
                symlink: true,
            },
            failedChild: {
                close: true,
                errorCode: 'ENOENT',
            },
            inheritedMarker: true,
            normalChild: {
                close: { code: 0, signal: null },
                exit: { code: 0, signal: null },
            },
            stoppedChild: {
                close: { code: null, signal: 'SIGKILL' },
                exit: { code: null, signal: 'SIGKILL' },
            },
        });
    });

    it('[STORAGE-T6.2-CLEANUP] waits for close after exit was already observed', async () => {
        const child = Object.assign(new EventEmitter(), {
            exitCode: 0,
            kill: vi.fn(() => true),
            signalCode: null,
        }) as unknown as ChildProcess;
        let settled = false;
        const cleanup = reapChild(child).then(() => {
            settled = true;
        });

        await Promise.resolve();
        expect(settled).toBe(false);
        child.emit('close', 0, null);
        await cleanup;
        expect(child.kill).not.toHaveBeenCalled();
    });

    it('[STORAGE-T6.2-CLEANUP] waits for close after the retained terminal observation rejects', async () => {
        const child = Object.assign(new EventEmitter(), {
            exitCode: null,
            kill: vi.fn(() => true),
            signalCode: null,
        }) as unknown as ChildProcess;
        const observationFailure = new Error('synthetic terminal observation failure');
        const terminal = Promise.reject(observationFailure);
        void terminal.catch(() => undefined);
        let settled = false;
        const cleanup = reapChild(child, terminal);
        void cleanup
            .finally(() => {
                settled = true;
            })
            .catch(() => undefined);

        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(child.kill).toHaveBeenCalledWith('SIGKILL');
        child.emit('close', null, 'SIGKILL');
        await expect(cleanup).rejects.toBe(observationFailure);
    });

    it('inherits the synthetic environment, starts deletion before terminal, and reaps the timed-out child', async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-storage-process-'));
        const markerPath = join(temporaryRoot, 'marker.txt');
        const environmentKey = 'EPGSTATION_SYNTHETIC_STORAGE_PROCESS_MARKER';
        const markerValue = 'synthetic-storage-process-value';
        const previousMarker = process.env[environmentKey];
        const pendingDelete = deferred<void>();
        const deletionStarted = deferred<void>();
        const childClosed = deferred<{ code: number | null; signal: NodeJS.Signals | null }>();
        let child: ChildProcess | undefined;
        const spawn = vi.fn((bin: string, args: readonly string[], options: unknown) => {
            child = actualSpawn(bin, [...args], options as SpawnOptions);
            child.once('close', (code, signal) => childClosed.resolve({ code, signal }));
            child.once('error', childClosed.reject);
            return child;
        });
        process.env[environmentKey] = markerValue;

        try {
            const { deleteRecorded, manager } = createStorageManager({
                deleteRecorded: async () => {
                    deletionStarted.resolve();
                    return pendingDelete.promise;
                },
                findOld: async () => ({ id: 901 }),
                spawn,
                storageLimitCommandTimeoutMs: 100,
            });
            manager.getFreeSize = vi
                .fn<(path: string) => Promise<number>>()
                .mockResolvedValueOnce(0)
                .mockResolvedValueOnce(2 * 1024 * 1024);
            const script = `require('fs').writeFileSync(process.argv[1],process.env.${environmentKey});setInterval(()=>{},1000)`;

            const check = manager.check([
                {
                    action: 'remove',
                    limitCmd: `%NODE% -e ${script} ${markerPath}`,
                    limitThreshold: 1,
                    name: 'process-integration',
                    path: 'synthetic-storage/process-integration',
                },
            ]);
            await deletionStarted.promise;

            expect(deleteRecorded).toHaveBeenCalledWith(901);
            expect(manager.isRunning).toBe(true);
            expect(child).toBeDefined();
            const options = spawn.mock.calls[0][2] as SpawnOptions;
            expect(options).toEqual({ stdio: 'ignore' });
            expect(Object.hasOwn(options, 'env')).toBe(false);
            expect(Object.hasOwn(options, 'shell')).toBe(false);

            pendingDelete.resolve();
            const terminal = await childClosed.promise;
            await check;

            expect(await readFile(markerPath, 'utf8')).toBe(markerValue);
            expect(terminal).toEqual({ code: null, signal: 'SIGKILL' });
            expect(manager.isRunning).toBe(false);
            expect(child?.listenerCount('close')).toBe(0);
        } finally {
            if (child !== undefined && child.exitCode === null && child.signalCode === null) {
                child.kill('SIGKILL');
            }
            if (previousMarker === undefined) {
                delete process.env[environmentKey];
            } else {
                process.env[environmentKey] = previousMarker;
            }
            await rm(temporaryRoot, { force: true, recursive: true });
        }
    });

    it('[STORAGE-T7.7-PROCESS] launches the configured bin and args with the inherited synthetic environment on success', async () => {
        const environmentKey = 'EPGSTATION_SYNTHETIC_PROCESS_BOUNDARY';
        const environmentValue = 'synthetic-process-boundary-value';
        const command = `%NODE% -e process.exit(process.env.${environmentKey}==='${environmentValue}'?0:17)`;
        const previousValue = process.env[environmentKey];
        let child: ChildProcess | undefined;
        let terminal: ReturnType<typeof waitForClose> | undefined;
        const spawn = vi.fn((bin: string, args: readonly string[], options: unknown) => {
            child = actualSpawn(bin, [...args], options as SpawnOptions);
            terminal = waitForClose(child);
            return child;
        });
        process.env[environmentKey] = environmentValue;

        try {
            const { deleteRecorded, getSnapshot, manager } = createStorageManager({ spawn });
            manager.getFreeSize = vi.fn(async () => 0);

            await manager.check([
                {
                    action: 'none',
                    limitCmd: command,
                    limitThreshold: 1,
                    name: 'success',
                    path: 'synthetic-storage/process-success',
                },
            ]);

            expect(spawn).toHaveBeenCalledOnce();
            expect(spawn.mock.calls[0].slice(0, 2)).toEqual([
                process.argv[0],
                ['-e', `process.exit(process.env.${environmentKey}==='${environmentValue}'?0:17)`],
            ]);
            const options = spawn.mock.calls[0][2] as SpawnOptions;
            expect(options).toEqual({ stdio: 'ignore' });
            expect(Object.hasOwn(options, 'env')).toBe(false);
            expect(Object.hasOwn(options, 'shell')).toBe(false);
            await expect(terminal).resolves.toEqual({ code: 0, signal: null });
            expect(deleteRecorded).not.toHaveBeenCalled();
            expect(getSnapshot).not.toHaveBeenCalled();
            expect(manager.activeCommands).toHaveLength(0);
            expect(child?.listenerCount('close')).toBe(0);
            expect(child?.listenerCount('error')).toBe(0);
            expect(child?.listenerCount('spawn')).toBe(0);
        } finally {
            if (child !== undefined && child.exitCode === null && child.signalCode === null) {
                child.kill('SIGKILL');
            }
            if (previousValue === undefined) {
                delete process.env[environmentKey];
            } else {
                process.env[environmentKey] = previousValue;
            }
        }
    });

    it('[STORAGE-T7.7-PROCESS] exposes a nonzero synthetic child terminal as a completed command boundary', async () => {
        const command = '%NODE% -e process.exit(23)';
        let child: ChildProcess | undefined;
        let terminal: ReturnType<typeof waitForClose> | undefined;
        const spawn = vi.fn((bin: string, args: readonly string[], options: unknown) => {
            child = actualSpawn(bin, [...args], options as SpawnOptions);
            terminal = waitForClose(child);
            return child;
        });

        try {
            const { deleteRecorded, getSnapshot, manager } = createStorageManager({ spawn });
            manager.getFreeSize = vi.fn(async () => 0);

            await manager.check([
                {
                    action: 'none',
                    limitCmd: command,
                    limitThreshold: 1,
                    name: 'failure',
                    path: 'synthetic-storage/process-failure',
                },
            ]);

            await expect(terminal).resolves.toEqual({ code: 23, signal: null });
            expect(deleteRecorded).not.toHaveBeenCalled();
            expect(getSnapshot).not.toHaveBeenCalled();
            expect(manager.activeCommands).toHaveLength(0);
            expect(child?.listenerCount('close')).toBe(0);
            expect(child?.listenerCount('error')).toBe(0);
            expect(child?.listenerCount('spawn')).toBe(0);
        } finally {
            if (child !== undefined && child.exitCode === null && child.signalCode === null) {
                child.kill('SIGKILL');
            }
        }
    });

    it('[STORAGE-T7.7-PROCESS] requests one deadline stop and releases the late synthetic terminal observer', async () => {
        const command = '%NODE% -e setInterval(()=>{},1000)';
        const stopRequests: Array<NodeJS.Signals | number | undefined> = [];
        let child: ChildProcess | undefined;
        let terminal: ReturnType<typeof waitForClose> | undefined;
        const spawn = vi.fn((bin: string, args: readonly string[], options: unknown) => {
            child = actualSpawn(bin, [...args], options as SpawnOptions);
            const kill = child.kill.bind(child);
            child.kill = (signal?: NodeJS.Signals | number) => {
                stopRequests.push(signal);
                return kill(signal);
            };
            terminal = waitForClose(child);
            return child;
        });

        try {
            const { deleteRecorded, getSnapshot, logger, manager } = createStorageManager({
                spawn,
                storageLimitCommandTimeoutMs: 50,
            });
            manager.getFreeSize = vi.fn(async () => 0);

            await manager.check([
                {
                    action: 'none',
                    limitCmd: command,
                    limitThreshold: 1,
                    name: 'timeout',
                    path: 'synthetic-storage/process-timeout',
                },
            ]);

            await expect(terminal).resolves.toEqual({ code: null, signal: 'SIGKILL' });
            expect(stopRequests).toEqual(['SIGKILL']);
            expect(logger.system.error).toHaveBeenCalledWith(`limit cmd timeout: ${command}`);
            expect(deleteRecorded).not.toHaveBeenCalled();
            expect(getSnapshot).not.toHaveBeenCalled();
            expect(manager.activeCommands).toHaveLength(0);
            expect(child?.listenerCount('close')).toBe(0);
            expect(child?.listenerCount('error')).toBe(0);
            expect(child?.listenerCount('spawn')).toBe(0);
        } finally {
            if (child !== undefined && child.exitCode === null && child.signalCode === null) {
                child.kill('SIGKILL');
            }
        }
    });

    it('[STORAGE-T7.7-PROCESS] retains an unreaped isolated child through the stop grace period and releases its late terminal exactly once', async () => {
        const command = '%NODE% -e setInterval(()=>{},1000)';
        const stopRequests: Array<NodeJS.Signals | number | undefined> = [];
        let child: ChildProcess | undefined;
        let originalKill: ((signal?: NodeJS.Signals | number) => boolean) | undefined;
        let terminal: ReturnType<typeof waitForClose> | undefined;
        const spawn = vi.fn((bin: string, args: readonly string[], options: unknown) => {
            child = actualSpawn(bin, [...args], options as SpawnOptions);
            originalKill = child.kill.bind(child);
            child.kill = (signal?: NodeJS.Signals | number) => {
                stopRequests.push(signal);
                return true;
            };
            terminal = waitForClose(child);
            return child;
        });

        let check: Promise<void> | undefined;
        try {
            const { deleteRecorded, getSnapshot, logger, manager } = createStorageManager({
                spawn,
                storageLimitCommandTimeoutMs: 50,
            });
            manager.getFreeSize = vi.fn(async () => 0);
            let settled = false;
            check = manager
                .check([
                    {
                        action: 'none',
                        limitCmd: command,
                        limitThreshold: 1,
                        name: 'late-terminal',
                        path: 'synthetic-storage/process-late-terminal',
                    },
                ])
                .then(() => {
                    settled = true;
                });

            await vi.waitFor(() => expect(child).toBeDefined(), { timeout: 1_000 });
            if (child === undefined || originalKill === undefined || terminal === undefined) {
                throw new Error('Synthetic child was not launched');
            }
            await vi.waitFor(() => expect([...manager.activeCommands.values()][0]?.spawned).toBe(true), {
                timeout: 1_000,
            });
            await vi.waitFor(() => expect(stopRequests).toEqual(['SIGKILL']), { timeout: 1_000 });

            expect(logger.system.error).toHaveBeenCalledWith(`limit cmd timeout: ${command}`);
            expect(settled).toBe(false);
            expect(manager.activeCommands).toHaveLength(1);

            await vi.waitFor(
                () => expect(logger.system.error).toHaveBeenCalledWith(`limit cmd terminal not observed: ${command}`),
                { timeout: 4_000 },
            );

            expect(settled).toBe(false);
            expect(manager.activeCommands).toHaveLength(1);
            expect(originalKill('SIGKILL')).toBe(true);
            await expect(terminal).resolves.toEqual({ code: null, signal: 'SIGKILL' });
            await check;

            expect(deleteRecorded).not.toHaveBeenCalled();
            expect(getSnapshot).not.toHaveBeenCalled();
            expect(manager.activeCommands).toHaveLength(0);
            expect(child.listenerCount('close')).toBe(0);
            expect(child.listenerCount('error')).toBe(0);
            expect(child.listenerCount('spawn')).toBe(0);
        } finally {
            if (
                child !== undefined &&
                child.exitCode === null &&
                child.signalCode === null &&
                originalKill !== undefined
            ) {
                originalKill('SIGKILL');
            }
            await Promise.allSettled([check ?? Promise.resolve(), terminal ?? Promise.resolve()]);
            vi.useRealTimers();
        }
    }, 10_000);
});
