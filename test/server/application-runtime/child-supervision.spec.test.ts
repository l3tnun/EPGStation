import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { isAbsolute, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

type EpgTerminalEvent = 'close' | 'disconnect' | 'error' | 'exit';

type EpgChild = EventEmitter & {
    readonly kill: ReturnType<typeof vi.fn>;
    readonly pid: number;
    readonly stderr: PassThrough;
    readonly stdout: PassThrough;
};

type EpgSupervisorConstructor = new (
    loggerModel: {
        getLogger(): {
            system: { error(error: unknown): void; fatal(message: string): void; info(message: string): void };
        };
    },
    epgUpdateEvent: { emitUpdated(): void },
) => { execute(): Promise<void> };

const terminalEvents: readonly EpgTerminalEvent[] = ['exit', 'disconnect', 'close', 'error'];
const terminalFatalMessages: Readonly<Record<EpgTerminalEvent, string>> = {
    close: 'epg update is closed',
    disconnect: 'epg updater is disconnected',
    error: 'epg updater is error',
    exit: 'epg updater is abort',
};

const permutationsOf = <T>(values: readonly T[]): T[][] => {
    if (values.length <= 1) return [Array.from(values)];

    return values.flatMap((value, index) =>
        permutationsOf([...values.slice(0, index), ...values.slice(index + 1)]).map(rest => [value, ...rest]),
    );
};

const terminalPermutations = permutationsOf(terminalEvents);

const compiledSnapshotRoot = (): string => {
    const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
    if (compiledSnapshot === undefined || !isAbsolute(compiledSnapshot)) {
        throw new Error('Server test runner did not provide an absolute compiled snapshot');
    }
    return compiledSnapshot;
};

/**
 * Loads the compiled `EPGUpdateExecutorManageModel.js` fresh, with `child_process` (both the bare and
 * `node:`-prefixed specifiers the module might resolve through) stubbed to `spawnImplementation`.
 *
 * The compiled module is ES modules (`import * as child_process from 'child_process'`), so a CJS-side
 * `require()` + `vi.spyOn(childProcess, 'spawn')` does not reach it: only the first import of the module
 * observes the spy, because the module's own binding to `child_process` is resolved once when it is
 * first evaluated and does not go back through a require-based namespace object on every call. Each
 * call here instead registers `vi.doMock` for the exact specifiers the compiled module imports, drops
 * the whole module registry with `vi.resetModules()`, and re-imports the module fresh via a dynamic
 * `import()`, so every test gets its own module instance wired to its own spawn stub.
 */
const loadEpgSupervisor = async (
    spawnImplementation: (...arguments_: unknown[]) => unknown,
): Promise<EpgSupervisorConstructor> => {
    const modulePath = join(compiledSnapshotRoot(), 'model', 'epgUpdater', 'EPGUpdateExecutorManageModel.js');
    vi.doMock('node:child_process', () => ({ spawn: spawnImplementation }));
    vi.doMock('child_process', () => ({ spawn: spawnImplementation }));
    try {
        vi.resetModules();
        const imported = (await import(pathToFileURL(modulePath).href)) as { default: EpgSupervisorConstructor };
        return imported.default;
    } finally {
        vi.doUnmock('node:child_process');
        vi.doUnmock('child_process');
    }
};

const createChild = (pid: number): EpgChild =>
    Object.assign(new EventEmitter(), {
        kill: vi.fn(() => true),
        pid,
        stderr: new PassThrough(),
        stdout: new PassThrough(),
    }) as EpgChild;

const emitTerminal = (child: EpgChild, event: EpgTerminalEvent): void => {
    if (event === 'error') {
        child.emit('error', new Error('synthetic terminal'));
        return;
    }
    if (event === 'exit' || event === 'close') {
        child.emit(event, 1, null);
        return;
    }
    child.emit(event);
};

const invokeTerminalCallback = (event: EpgTerminalEvent, callback: (...arguments_: unknown[]) => void): void => {
    if (event === 'error') {
        callback(new Error('synthetic terminal'));
        return;
    }
    if (event === 'exit' || event === 'close') {
        callback(1, null);
        return;
    }
    callback();
};

describe('EPG child generation supervision', () => {
    it('[AR-8.4] emits only current updated messages across a generation replacement', async () => {
        const first = createChild(7_180);
        const replacement = createChild(7_181);
        const spawn = vi.fn().mockReturnValueOnce(first as never).mockReturnValueOnce(replacement as never);
        const log = { system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() } };
        const emitUpdated = vi.fn();
        const EpgSupervisor = await loadEpgSupervisor(spawn);
        const supervisor = new EpgSupervisor({ getLogger: () => log }, { emitUpdated });

        try {
            await supervisor.execute();
            const [staleMessage] = first.listeners('message');
            if (staleMessage === undefined) throw new Error('EPG child did not register message');

            first.emit('message', { msg: 'updated' });
            first.emit('message', { msg: 'ignored' });
            expect(emitUpdated).toHaveBeenCalledTimes(1);

            first.emit('close', 1, null);
            replacement.emit('message', { msg: 'updated' });
            (staleMessage as (message: unknown) => void)({ msg: 'updated' });

            expect(spawn).toHaveBeenCalledTimes(2);
            expect(emitUpdated).toHaveBeenCalledTimes(2);
        } finally {
            for (const child of [first, replacement]) {
                child.removeAllListeners();
                child.stdout.removeAllListeners();
                child.stderr.removeAllListeners();
                child.stdout.destroy();
                child.stderr.destroy();
            }
        }
    });

    it('[AR-8.1][AR-8.4][AR-8.7] restarts through the same piped EPG child process boundary', async () => {
        const first = createChild(7_182);
        const replacement = createChild(7_183);
        const spawn = vi.fn().mockReturnValueOnce(first as never).mockReturnValueOnce(replacement as never);
        const log = { system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() } };
        const EpgSupervisor = await loadEpgSupervisor(spawn);
        const supervisor = new EpgSupervisor({ getLogger: () => log }, { emitUpdated: vi.fn() });
        const expectedSpawnArguments = [
            process.argv[0],
            [expect.stringMatching(/[\\/]EPGUpdateExecutor\.js$/)],
            { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
        ] as const;

        try {
            await supervisor.execute();
            expect(spawn).toHaveBeenNthCalledWith(1, ...expectedSpawnArguments);

            first.emit('close', 1, null);
            expect(spawn).toHaveBeenNthCalledWith(2, ...expectedSpawnArguments);
            expect(first.stdout.listenerCount('data')).toBe(0);
            expect(first.stderr.listenerCount('data')).toBe(0);
        } finally {
            for (const child of [first, replacement]) {
                child.removeAllListeners();
                child.stdout.removeAllListeners();
                child.stderr.removeAllListeners();
                child.stdout.destroy();
                child.stderr.destroy();
            }
        }
    });

    it('[AR-8.7] supervises a non-piped EPG child without retaining pipe listeners', async () => {
        const noPipeChild = Object.assign(new EventEmitter(), {
            kill: vi.fn(() => true),
            pid: 7_184,
            stderr: null,
            stdout: null,
        }) as unknown as EpgChild;
        const replacement = createChild(7_185);
        const spawn = vi.fn().mockReturnValueOnce(noPipeChild as never).mockReturnValueOnce(replacement as never);
        const log = { system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() } };
        const EpgSupervisor = await loadEpgSupervisor(spawn);
        const supervisor = new EpgSupervisor({ getLogger: () => log }, { emitUpdated: vi.fn() });

        try {
            await supervisor.execute();
            noPipeChild.emit('close', 1, null);

            expect(spawn).toHaveBeenCalledTimes(2);
            await Promise.resolve();
            expect(noPipeChild.eventNames()).toEqual([]);
        } finally {
            noPipeChild.removeAllListeners();
            replacement.removeAllListeners();
            replacement.stdout.removeAllListeners();
            replacement.stderr.removeAllListeners();
            replacement.stdout.destroy();
            replacement.stderr.destroy();
        }
    });

    it.each(terminalPermutations.map(terminalOrder => [terminalOrder]))(
        '[AR-7.3][AR-8.4][AR-8.5][AR-8.7] settles same-tick terminal order %j once and ignores detached stale callbacks',
        async terminalOrder => {
            const first = createChild(7_201);
            const replacement = createChild(7_202);
            const children = [first, replacement];
            const terminalOperations: string[] = [];
            let emittedTerminal: EpgTerminalEvent | null = null;
            let spawnedChildren = 0;
            const spawn = vi.fn().mockImplementation(() => {
                const child = children[spawnedChildren] ?? createChild(7_201 + spawnedChildren);
                if (children[spawnedChildren] === undefined) children.push(child);
                if (spawnedChildren !== 0) terminalOperations.push('spawn');
                spawnedChildren += 1;
                return child as never;
            });
            const log = { system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() } };
            const emitUpdated = vi.fn();
            const EpgSupervisor = await loadEpgSupervisor(spawn);
            const supervisor = new EpgSupervisor({ getLogger: () => log }, { emitUpdated });

            try {
                await supervisor.execute();

                const callbacks = new Map<EpgTerminalEvent, (...arguments_: unknown[]) => void>();
                const [messageCallback] = first.listeners('message');
                if (messageCallback === undefined) throw new Error('EPG child did not register message');
                for (const event of terminalEvents) {
                    expect(first.listenerCount(event)).toBe(1);
                    const [callback] = first.listeners(event);
                    if (callback === undefined) throw new Error(`EPG child did not register ${event}`);
                    callbacks.set(event, callback as (...arguments_: unknown[]) => void);
                }
                const onListenerRemoved = (event: string | symbol): void => {
                    if (event === emittedTerminal) return;
                    if (terminalEvents.includes(event as EpgTerminalEvent) || event === 'message') {
                        terminalOperations.push(`detach:${String(event)}`);
                    }
                };
                first.on('removeListener', onListenerRemoved);
                first.kill.mockImplementation(() => {
                    terminalOperations.push('signal:SIGINT');
                    first.emit('message', { msg: 'updated' });
                    return true;
                });

                expect(first.stdout.listenerCount('data')).toBe(1);
                expect(first.stderr.listenerCount('data')).toBe(1);
                first.stdout.write('stdout');
                first.stderr.write('stderr');
                expect(first.stdout.readableLength).toBe(0);
                expect(first.stderr.readableLength).toBe(0);

                const [firstTerminal, ...lateTerminals] = terminalOrder;
                if (firstTerminal === undefined) throw new Error('Terminal order must not be empty');
                emittedTerminal = firstTerminal;
                emitTerminal(first, firstTerminal);
                emittedTerminal = null;

                expect(spawn).toHaveBeenCalledTimes(2);
                expect(first.kill).toHaveBeenCalledTimes(firstTerminal === 'disconnect' ? 1 : 0);
                if (firstTerminal === 'disconnect') expect(first.kill).toHaveBeenCalledWith('SIGINT');
                expect(log.system.fatal).toHaveBeenCalledExactlyOnceWith(terminalFatalMessages[firstTerminal]);
                if (firstTerminal === 'error') {
                    expect(log.system.error).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
                } else {
                    expect(log.system.error).not.toHaveBeenCalled();
                }
                expect(first.listenerCount('message')).toBe(0);
                expect(first.listenerCount('exit')).toBe(0);
                expect(first.listenerCount('disconnect')).toBe(0);
                expect(first.listenerCount('close')).toBe(
                    firstTerminal === 'exit' || firstTerminal === 'disconnect' ? 1 : 0,
                );
                expect(first.listenerCount('error')).toBe(firstTerminal === 'error' ? 0 : 1);
                expect(first.stdout.listenerCount('data')).toBe(0);
                expect(first.stderr.listenerCount('data')).toBe(0);
                expect(terminalOperations).toEqual([
                    ...(firstTerminal === 'disconnect' ? ['signal:SIGINT'] : []),
                    'detach:message',
                    ...terminalEvents.filter(event => event !== firstTerminal).map(event => `detach:${event}`),
                    'spawn',
                ]);

                for (const staleTerminal of lateTerminals) {
                    expect(() => emitTerminal(first, staleTerminal)).not.toThrow();
                }
                await Promise.resolve();
                for (const staleTerminal of lateTerminals) {
                    invokeTerminalCallback(
                        staleTerminal,
                        callbacks.get(staleTerminal) as (...arguments_: unknown[]) => void,
                    );
                }
                (messageCallback as (message: unknown) => void)({ msg: 'updated' });
                expect(spawn).toHaveBeenCalledTimes(2);
                expect(first.kill).toHaveBeenCalledTimes(firstTerminal === 'disconnect' ? 1 : 0);
                expect(log.system.fatal).toHaveBeenCalledExactlyOnceWith(terminalFatalMessages[firstTerminal]);
                if (firstTerminal === 'error') {
                    expect(log.system.error).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
                } else {
                    expect(log.system.error).not.toHaveBeenCalled();
                }
                expect(emitUpdated).not.toHaveBeenCalled();

                first.removeListener('removeListener', onListenerRemoved);
                expect(first.eventNames()).toEqual([]);
            } finally {
                for (const child of children) {
                    child.removeAllListeners();
                    child.stdout.removeAllListeners();
                    child.stderr.removeAllListeners();
                    child.stdout.destroy();
                    child.stderr.destroy();
                }
            }
        },
    );

    it('[AR-8.4][AR-8.5][AR-8.7] ignores a close callback re-entered while disconnect detaches listeners', async () => {
        const first = createChild(7_230);
        const replacement = createChild(7_231);
        const children = [first, replacement];
        let spawnedChildren = 0;
        const spawn = vi.fn().mockImplementation(() => {
            const child = children[spawnedChildren] ?? createChild(7_230 + spawnedChildren);
            if (children[spawnedChildren] === undefined) children.push(child);
            spawnedChildren += 1;
            return child as never;
        });
        const log = { system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() } };
        const emitUpdated = vi.fn();
        const EpgSupervisor = await loadEpgSupervisor(spawn);
        const supervisor = new EpgSupervisor({ getLogger: () => log }, { emitUpdated });

        try {
            await supervisor.execute();

            const [closeCallback] = first.listeners('close');
            if (closeCallback === undefined) throw new Error('EPG child did not register close');

            let reentered = false;
            const reenterCloseDuringDetach = (event: string | symbol): void => {
                if (reentered || event !== 'message') return;
                reentered = true;
                invokeTerminalCallback('close', closeCallback as (...arguments_: unknown[]) => void);
            };
            first.on('removeListener', reenterCloseDuringDetach);

            first.emit('disconnect');

            expect(reentered).toBe(true);
            expect(spawn).toHaveBeenCalledTimes(2);
            expect(first.kill).toHaveBeenCalledExactlyOnceWith('SIGINT');
            expect(emitUpdated).not.toHaveBeenCalled();
            expect(first.listenerCount('message')).toBe(0);
            expect(first.listenerCount('exit')).toBe(0);
            expect(first.listenerCount('disconnect')).toBe(0);
            expect(first.stdout.listenerCount('data')).toBe(0);
            expect(first.stderr.listenerCount('data')).toBe(0);

            first.emit('close', 1, null);
            await Promise.resolve();
            first.removeListener('removeListener', reenterCloseDuringDetach);
            expect(first.eventNames()).toEqual([]);
        } finally {
            for (const child of children) {
                child.removeAllListeners();
                child.stdout.removeAllListeners();
                child.stderr.removeAllListeners();
                child.stdout.destroy();
                child.stderr.destroy();
            }
        }
    });

    it.each(['exit', 'disconnect', 'close'] as const)(
        '[AR-8.4][AR-8.5][AR-8.7] absorbs a same-tick late error after %s without global drain or descendant reaping',
        async firstTerminal => {
            const first = createChild(7_250);
            const replacement = createChild(7_251);
            const spawn = vi.fn().mockReturnValueOnce(first as never).mockReturnValueOnce(replacement as never);
            const log = { system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() } };
            const EpgSupervisor = await loadEpgSupervisor(spawn);
            const supervisor = new EpgSupervisor({ getLogger: () => log }, { emitUpdated: vi.fn() });
            const stdoutDestroy = vi.spyOn(first.stdout, 'destroy');
            const stderrDestroy = vi.spyOn(first.stderr, 'destroy');
            const processKill = vi.spyOn(process, 'kill').mockReturnValue(true);

            try {
                await supervisor.execute();
                if (firstTerminal === 'exit') {
                    first.emit('exit', 1, null);
                } else if (firstTerminal === 'disconnect') {
                    first.emit('disconnect');
                } else {
                    first.emit('close', 1, null);
                }

                if (firstTerminal === 'close') {
                    expect(() => first.emit('error', new Error('late terminal'))).not.toThrow();
                    await Promise.resolve();
                } else {
                    await Promise.resolve();
                    expect(() => first.emit('error', new Error('late terminal'))).not.toThrow();
                    first.emit('close', 1, null);
                    expect(() => first.emit('error', new Error('late terminal after close'))).not.toThrow();
                    await Promise.resolve();
                }

                expect(spawn).toHaveBeenCalledTimes(2);
                expect(first.kill.mock.calls).toEqual(firstTerminal === 'disconnect' ? [['SIGINT']] : []);
                expect(processKill).not.toHaveBeenCalled();
                expect(stdoutDestroy).not.toHaveBeenCalled();
                expect(stderrDestroy).not.toHaveBeenCalled();
                expect(first.stdout.destroyed).toBe(false);
                expect(first.stderr.destroyed).toBe(false);
                expect(log.system.fatal).toHaveBeenCalledExactlyOnceWith(terminalFatalMessages[firstTerminal]);
                expect(log.system.error).not.toHaveBeenCalled();
                expect(first.eventNames()).toEqual([]);
            } finally {
                processKill.mockRestore();
                stdoutDestroy.mockRestore();
                stderrDestroy.mockRestore();
                for (const child of [first, replacement]) {
                    child.removeAllListeners();
                    child.stdout.removeAllListeners();
                    child.stderr.removeAllListeners();
                    child.stdout.destroy();
                    child.stderr.destroy();
                }
            }
        },
    );

    it('[AR-8.6][AR-8.7] continues through bounded accepted generations without a cap, delay, or stale pipe listener', async () => {
        const children = Array.from({ length: 6 }, (_, index) => createChild(7_300 + index));
        let spawnedChildren = 0;
        const spawn = vi.fn().mockImplementation(() => {
            const child = children[spawnedChildren];
            spawnedChildren += 1;
            if (child === undefined) throw new Error('EPG supervisor applied an unexpected restart cap');
            return child as never;
        });
        const log = { system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() } };
        const EpgSupervisor = await loadEpgSupervisor(spawn);
        const supervisor = new EpgSupervisor({ getLogger: () => log }, { emitUpdated: vi.fn() });

        try {
            await supervisor.execute();

            for (const [index, child] of children.slice(0, 5).entries()) {
                child.emit('close', 1, null);
                await Promise.resolve();

                expect(spawn).toHaveBeenCalledTimes(index + 2);
                expect(child.kill).not.toHaveBeenCalled();
                expect(child.eventNames()).toEqual([]);
                expect(child.stdout.listenerCount('data')).toBe(0);
                expect(child.stderr.listenerCount('data')).toBe(0);
            }

            expect(log.system.fatal).toHaveBeenCalledTimes(5);
            expect(children[5]?.listenerCount('message')).toBe(1);
            expect(children[5]?.stdout.listenerCount('data')).toBe(1);
            expect(children[5]?.stderr.listenerCount('data')).toBe(1);
        } finally {
            for (const child of children) {
                child.removeAllListeners();
                child.stdout.removeAllListeners();
                child.stderr.removeAllListeners();
                child.stdout.destroy();
                child.stderr.destroy();
            }
        }
    });
});
