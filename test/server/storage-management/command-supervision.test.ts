import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStorageManager, settleMicrotasks, syntheticSpawnResult } from './_storage-harness';

const entry = {
    action: 'none' as const,
    limitCmd: '%NODE%',
    limitThreshold: 1,
    name: 'supervised-command',
    path: 'synthetic-storage/supervised-command',
};

const startCheck = (timeout?: unknown) => {
    const child = syntheticSpawnResult(false);
    const spawn = vi.fn(() => child);
    const harness = createStorageManager({ spawn, storageLimitCommandTimeoutMs: timeout });
    harness.manager.getFreeSize = vi.fn(async () => 0);
    const check = harness.manager.check([entry]);
    return { ...harness, check, child, spawn };
};

afterEach(() => {
    vi.useRealTimers();
});

describe('storage command supervision: spawn failure, deadline, terminal races, and release', () => {
    it('does not create command or deletion work when both settings are absent', async () => {
        const spawn = vi.fn(() => syntheticSpawnResult());
        const { findOld, logger, manager } = createStorageManager({ spawn });
        manager.getFreeSize = vi.fn(async () => 0);

        await manager.check([{ limitThreshold: 1, name: 'no-work', path: 'synthetic-storage/no-work' }]);

        expect(spawn).not.toHaveBeenCalled();
        expect(findOld).not.toHaveBeenCalled();
        expect(logger.system.error).not.toHaveBeenCalled();
    });

    // 300_000 default and 2_147_483_647 maximum are DEFAULT_STORAGE_COMMAND_TIMEOUT_MS and
    // MAX_STORAGE_COMMAND_TIMEOUT_MS (src/model/operator/storage/StorageManageModel.ts:16-17),
    // a v3-only `storageLimitCommandTimeoutMs` contract with no v2 counterpart -- approved in
    // .kiro/specs/server-storage-management/design.md:11,137 (default) and :139,867 (SM-3.2, max).
    it.each([
        ['default', undefined, 300_000],
        ['minimum', 1, 1],
        ['maximum', 2_147_483_647, 2_147_483_647],
    ])('normalizes the %s timeout and releases terminal resources once', async (_label, timeout, deadline) => {
        vi.useFakeTimers();
        const { check, child, logger, manager, spawn } = startCheck(timeout);
        await settleMicrotasks();

        expect(spawn).toHaveBeenCalledOnce();
        expect(logger.system.info).toHaveBeenCalledWith('run storage limit cmd: %NODE%');
        expect(manager.isRunning).toBe(true);
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(deadline - 1);
        expect(child.kill).not.toHaveBeenCalled();
        child.emit('close', 0, null);
        child.emit('close', 0, null);
        await check;

        expect(child.kill).not.toHaveBeenCalled();
        expect(manager.isRunning).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        expect((child as EventEmitter).listenerCount('close')).toBe(0);
        expect((child as EventEmitter).listenerCount('error')).toBe(0);
        expect((child as EventEmitter).listenerCount('spawn')).toBe(0);
    });

    it.each([null, '10', true, {}, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
        'rejects invalid timeout %s at component construction before spawn',
        timeout => {
            const spawn = vi.fn(() => syntheticSpawnResult());

            expect(() => createStorageManager({ spawn, storageLimitCommandTimeoutMs: timeout })).toThrow(
                /storageLimitCommandTimeoutMs/u,
            );
            expect(spawn).not.toHaveBeenCalled();
        },
    );

    it('treats pre-spawn error as spawn failure but post-spawn error as non-terminal', async () => {
        vi.useFakeTimers();
        const preSpawn = startCheck(10);
        await settleMicrotasks();
        preSpawn.child.emit('error', new Error('synthetic process not generated'));
        await preSpawn.check;
        expect(preSpawn.manager.isRunning).toBe(false);
        expect(preSpawn.child.kill).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expect(preSpawn.logger.system.error).toHaveBeenCalledWith('limit cmd error: %NODE%');

        const postSpawn = startCheck(10);
        await settleMicrotasks();
        postSpawn.child.emit('spawn');
        postSpawn.child.emit('error', new Error('synthetic non-terminal child error'));
        await settleMicrotasks();
        expect(postSpawn.manager.isRunning).toBe(true);
        expect(postSpawn.logger.system.error).toHaveBeenCalledWith('limit cmd error: %NODE%');

        postSpawn.child.emit('close', 1, null);
        await postSpawn.check;
        expect(postSpawn.manager.isRunning).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        ['returns false', () => false],
        [
            'throws',
            () => {
                throw new Error('synthetic kill failure');
            },
        ],
    ])('keeps an unreaped operation after SIGKILL %s until exact late terminal', async (_label, killResult) => {
        vi.useFakeTimers();
        const running = startCheck(10);
        vi.mocked(running.child.kill).mockImplementation(killResult);
        await settleMicrotasks();
        running.child.emit('spawn');

        await vi.advanceTimersByTimeAsync(10);
        expect(running.child.kill).toHaveBeenCalledOnce();
        expect(running.child.kill).toHaveBeenCalledWith('SIGKILL');
        expect(running.manager.isRunning).toBe(true);
        expect(running.logger.system.error).toHaveBeenCalledWith('limit cmd timeout: %NODE%');
        expect(running.logger.system.error).toHaveBeenCalledWith('limit cmd stop failed: %NODE%');

        await vi.advanceTimersByTimeAsync(3_000);
        expect(running.child.kill).toHaveBeenCalledOnce();
        expect(running.manager.isRunning).toBe(true);
        expect((running.child as EventEmitter).listenerCount('close')).toBe(1);
        expect(running.logger.system.error).toHaveBeenCalledWith('limit cmd terminal not observed: %NODE%');
        const [unreaped] = [...running.manager.activeCommands.values()];
        expect(unreaped).toMatchObject({ deadline: undefined, state: 'unreaped', stopGrace: undefined });

        running.child.emit('close', null, 'SIGKILL');
        running.child.emit('close', null, 'SIGKILL');
        await running.check;
        expect(running.manager.isRunning).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        expect((running.child as EventEmitter).listenerCount('close')).toBe(0);
    });

    it('[SM-3.9-DOMAIN-PROBE] keeps an independent domain probe running while an operation stays unreaped and starts no new command for that entry', async () => {
        vi.useFakeTimers();
        let domainRuns = 0;
        let domainContinuations = 0;
        const domainProbe = setInterval(() => {
            domainRuns += 1;
            void Promise.resolve().then(() => {
                domainContinuations += 1;
            });
        }, 1_000);
        try {
            const running = startCheck(10);
            vi.mocked(running.child.kill).mockImplementation(() => false);
            await settleMicrotasks();
            running.child.emit('spawn');

            await vi.advanceTimersByTimeAsync(10 + 3_000);
            const [unreaped] = [...running.manager.activeCommands.values()];
            expect(unreaped).toMatchObject({ state: 'unreaped' });
            expect(running.manager.isRunning).toBe(true);
            expect(domainRuns).toBe(3);

            await vi.advanceTimersByTimeAsync(10_000);
            expect(domainRuns).toBe(13);
            expect(domainContinuations).toBe(13);

            await running.manager.check([entry]);
            expect(running.spawn).toHaveBeenCalledOnce();
            expect(running.manager.activeCommands.size).toBe(1);

            running.child.emit('close', null, 'SIGKILL');
            await running.check;
            expect(running.manager.isRunning).toBe(false);
            await vi.advanceTimersByTimeAsync(1_000);
            expect(domainRuns).toBe(14);
        } finally {
            clearInterval(domainProbe);
        }
    });

    it('settles the operation with the exact terminal or spawn-failure result', async () => {
        vi.useFakeTimers();
        const terminalChild = syntheticSpawnResult(false);
        const spawnFailureChild = syntheticSpawnResult(false);
        const spawn = vi.fn().mockReturnValueOnce(terminalChild).mockReturnValueOnce(spawnFailureChild);
        const { manager } = createStorageManager({ spawn, storageLimitCommandTimeoutMs: 10 });

        const terminal = manager.launchCommand(process.execPath, [], '%NODE%');
        terminalChild.emit('spawn');
        terminalChild.emit('close', 0, null);
        await expect(terminal.observationDone).resolves.toBe('terminal');

        const spawnFailure = manager.launchCommand(process.execPath, [], '%NODE%');
        spawnFailureChild.emit('error', new Error('synthetic process not generated'));
        await expect(spawnFailure.observationDone).resolves.toBe('spawn-failure');
        expect(manager.activeCommands.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('fences already queued child callbacks after terminal cleanup', async () => {
        vi.useFakeTimers();
        const child = syntheticSpawnResult(false);
        const spawn = vi.fn(() => child);
        const { logger, manager } = createStorageManager({ spawn, storageLimitCommandTimeoutMs: 10 });
        const removeListener = vi.spyOn(child, 'removeListener');
        const launched = manager.launchCommand(process.execPath, [], '%NODE%');
        const [operation] = [...manager.activeCommands.values()];
        const staleSpawn = child.listeners('spawn')[0] as () => void;
        const staleError = child.listeners('error')[0] as (error: Error) => void;
        const staleClose = child.listeners('close')[0] as () => void;

        child.emit('close', 0, null);
        await launched.observationDone;
        const removeCalls = removeListener.mock.calls.length;
        const errorCalls = logger.system.error.mock.calls.length;

        staleSpawn();
        staleError(new Error('synthetic stale error'));
        staleClose();

        expect(operation.spawned).toBe(false);
        expect(logger.system.error).toHaveBeenCalledTimes(errorCalls);
        expect(removeListener).toHaveBeenCalledTimes(removeCalls);
        expect(manager.activeCommands.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('fences queued deadline and grace callbacks after exact terminal cleanup', async () => {
        vi.useFakeTimers();
        const timeoutSpy = vi.spyOn(global, 'setTimeout');
        const child = syntheticSpawnResult(false);
        const spawn = vi.fn(() => child);
        const { logger, manager } = createStorageManager({ spawn, storageLimitCommandTimeoutMs: 10 });
        const beforeDeadline = manager.launchCommand(process.execPath, [], '%NODE%');
        const deadline = timeoutSpy.mock.calls[0][0] as () => void;
        child.emit('close', 0, null);
        await beforeDeadline.observationDone;

        deadline();
        expect(child.kill).not.toHaveBeenCalled();
        expect(logger.system.error).not.toHaveBeenCalled();

        const timeoutChild = syntheticSpawnResult(false);
        spawn.mockReturnValueOnce(timeoutChild);
        const afterDeadline = manager.launchCommand(process.execPath, [], '%NODE%');
        const secondDeadline = timeoutSpy.mock.calls[1][0] as () => void;
        timeoutChild.emit('spawn');
        const [timingOutOperation] = [...manager.activeCommands.values()];
        clearTimeout(timingOutOperation.deadline);
        secondDeadline();
        const grace = timeoutSpy.mock.calls[2][0] as () => void;
        expect(timeoutChild.kill).toHaveBeenCalledOnce();
        timeoutChild.emit('close', null, 'SIGKILL');
        await afterDeadline.observationDone;
        const errorCalls = logger.system.error.mock.calls.length;

        grace();
        expect(logger.system.error).toHaveBeenCalledTimes(errorCalls);
        expect(manager.activeCommands.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('accepts each current deadline and grace callback only once', async () => {
        vi.useFakeTimers();
        const timeoutSpy = vi.spyOn(global, 'setTimeout');
        const child = syntheticSpawnResult(false);
        const spawn = vi.fn(() => child);
        const { logger, manager } = createStorageManager({ spawn, storageLimitCommandTimeoutMs: 10 });
        const launched = manager.launchCommand(process.execPath, [], '%NODE%');
        const deadline = timeoutSpy.mock.calls[0][0] as () => void;
        const [operation] = [...manager.activeCommands.values()];
        clearTimeout(operation.deadline);
        child.emit('spawn');

        deadline();
        deadline();
        expect(child.kill).toHaveBeenCalledTimes(1);
        expect(
            logger.system.error.mock.calls.filter(([message]) => message === 'limit cmd timeout: %NODE%'),
        ).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(1);

        const grace = timeoutSpy.mock.calls[1][0] as () => void;
        clearTimeout(operation.stopGrace);
        grace();
        grace();
        expect(
            logger.system.error.mock.calls.filter(([message]) => message === 'limit cmd terminal not observed: %NODE%'),
        ).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);

        child.emit('close', null, 'SIGKILL');
        await launched.observationDone;
        expect(manager.activeCommands.size).toBe(0);
    });

    it('cleans up when terminal arrives inside the 3-second escalation window', async () => {
        vi.useFakeTimers();
        const running = startCheck(10);
        await settleMicrotasks();
        running.child.emit('spawn');

        await vi.advanceTimersByTimeAsync(10);
        await vi.advanceTimersByTimeAsync(2_999);
        expect(
            running.logger.system.error.mock.calls.filter(
                ([message]) => message === 'limit cmd terminal not observed: %NODE%',
            ),
        ).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(1);
        running.child.emit('close', null, 'SIGKILL');
        await running.check;

        expect(running.child.kill).toHaveBeenCalledOnce();
        expect(running.manager.isRunning).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('holds the exact entry key until terminal while a different entry continues', async () => {
        vi.useFakeTimers();
        const firstChild = syntheticSpawnResult(false);
        const secondChild = syntheticSpawnResult(false);
        const spawn = vi.fn().mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
        const { manager } = createStorageManager({ spawn, storageLimitCommandTimeoutMs: 100 });
        manager.getFreeSize = vi.fn(async () => 0);
        const otherEntry = { ...entry, name: 'other-command', path: 'synthetic-storage/other-command' };

        const firstCheck = manager.check([entry]);
        await settleMicrotasks();
        firstChild.emit('spawn');
        const overlappingCheck = manager.check([entry, otherEntry]);
        await settleMicrotasks();
        secondChild.emit('spawn');

        expect(spawn).toHaveBeenCalledTimes(2);
        expect(manager.isRunning).toBe(true);

        secondChild.emit('close', 0, null);
        await overlappingCheck;
        expect(manager.isRunning).toBe(true);

        firstChild.emit('close', 0, null);
        await firstCheck;
        expect(manager.isRunning).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('continues command deadline supervision after monitoring stop', async () => {
        vi.useFakeTimers();
        const child = syntheticSpawnResult(false);
        const spawn = vi.fn(() => child);
        const { manager } = createStorageManager({
            entries: [entry],
            intervalSeconds: 1,
            spawn,
            storageLimitCommandTimeoutMs: 10,
        });
        manager.getFreeSize = vi.fn(async () => 0);
        manager.start();

        await vi.advanceTimersByTimeAsync(1_000);
        child.emit('spawn');
        manager.stop();
        await vi.advanceTimersByTimeAsync(10);

        expect(child.kill).toHaveBeenCalledOnce();
        expect(child.kill).toHaveBeenCalledWith('SIGKILL');
        expect(manager.isRunning).toBe(true);

        child.emit('close', null, 'SIGKILL');
        await settleMicrotasks();
        expect(manager.isRunning).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });
});
