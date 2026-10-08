import * as fs from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { deferred, ExecutionManagementModel, logger, makeReserve, RecordingUtilModel } from './_harness';

describe('recording path coordination', () => {
    it('[Task 4.1] acquires priority one with the five-second timeout and always releases', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-path-'));
        const execution = { getExecution: vi.fn(async () => 71), unLockExecution: vi.fn() };
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: root }],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            execution,
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            {},
            {},
        );
        try {
            await expect(
                model.getRecPath(makeReserve({ recordedFormat: 'synthetic-file' }), false),
            ).resolves.toMatchObject({
                fileName: 'synthetic-file.ts',
            });
            expect(execution.getExecution).toHaveBeenCalledWith(1, 5_000);
            expect(execution.unLockExecution).toHaveBeenCalledWith(71);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.3] retries only EEXIST candidates and returns the exclusively opened suffix handle', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-path-'));
        const execution = { getExecution: vi.fn(async () => 74), unLockExecution: vi.fn() };
        const handle = { close: vi.fn() } as any;
        const alreadyExists = Object.assign(new Error('already exists'), { code: 'EEXIST' });
        const open = vi.spyOn(fs.promises, 'open').mockRejectedValueOnce(alreadyExists).mockResolvedValueOnce(handle);
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: root }],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            execution,
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            {},
            {},
        );
        try {
            await expect(model.getRecPath(makeReserve(), false, true)).resolves.toMatchObject({
                fileName: 'synthetic(1).ts',
                fullPath: join(root, 'synthetic(1).ts'),
                fileHandle: handle,
            });
            expect(open).toHaveBeenNthCalledWith(1, join(root, 'synthetic.ts'), 'wx');
            expect(open).toHaveBeenNthCalledWith(2, join(root, 'synthetic(1).ts'), 'wx');
            expect(execution.unLockExecution).toHaveBeenCalledWith(74);
        } finally {
            open.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.3] releases the execution right and propagates a non-conflict open failure without trying a suffix', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-path-'));
        const execution = { getExecution: vi.fn(async () => 75), unLockExecution: vi.fn() };
        const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' });
        const open = vi.spyOn(fs.promises, 'open').mockRejectedValueOnce(failure);
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: root }],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            execution,
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            {},
            {},
        );
        try {
            await expect(model.getRecPath(makeReserve(), false, true)).rejects.toBe(failure);
            expect(open).toHaveBeenCalledOnce();
            expect(open).toHaveBeenCalledWith(join(root, 'synthetic.ts'), 'wx');
            expect(execution.unLockExecution).toHaveBeenCalledWith(75);
        } finally {
            open.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.3] releases the execution right and preserves an undefined open rejection', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-path-'));
        const execution = { getExecution: vi.fn(async () => 76), unLockExecution: vi.fn() };
        const open = vi.spyOn(fs.promises, 'open').mockRejectedValueOnce(undefined);
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: root }],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            execution,
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            {},
            {},
        );
        try {
            await expect(model.getRecPath(makeReserve(), false, true)).rejects.toBeUndefined();
            expect(open).toHaveBeenCalledOnce();
            expect(execution.unLockExecution).toHaveBeenCalledWith(76);
        } finally {
            open.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.1] retains the execution token across deferred path reads and releases after settlement', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-path-'));
        const channel = deferred<null>();
        const ledger: string[] = [];
        const execution = {
            getExecution: vi.fn(async () => (ledger.push('acquire'), 72)),
            unLockExecution: vi.fn(() => ledger.push('release')),
        };
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: root }],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            execution,
            { findId: vi.fn(() => (ledger.push('channel'), channel.promise)) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            {},
            {},
        );
        try {
            const pending = model.getRecPath(makeReserve(), false);
            await Promise.resolve();
            expect(ledger).toEqual(['acquire', 'channel']);
            expect(execution.unLockExecution).not.toHaveBeenCalled();
            channel.resolve(null);
            await pending;
            expect(ledger.at(-1)).toBe('release');
            expect(execution.unLockExecution).toHaveBeenCalledWith(72);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    // The 600_000 (600s) deadlines exercised across the [Task 4.5] cases below are
    // RecordingUtilModel.GET_REC_PATH_OWNER_TIMEOUT (src/model/operator/recording/
    // RecordingUtilModel.ts:521). v2's equivalent constant is GET_REC_PATH_LOCK_TIMEOUT = 5.0*1000
    // (v2 5cf2ea383 src/model/operator/recording/RecordingUtilModel.ts:353), a
    // different, unrelated lock-acquisition timeout -- this 600s owner watchdog has no v2
    // counterpart. Approved as a v3 contract in .kiro/specs/server-recording-execution/design.md:839-841.
    it('[priority-exclusive-overdue][Task 4.5] keeps an overdue path owner fenced until its late exclusive result is cleaned and released once', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-overdue-path-'));
        const execution = new ExecutionManagementModel({ getLogger: () => logger });
        const otherDomain = new ExecutionManagementModel({ getLogger: () => logger });
        const unlock = vi.spyOn(execution, 'unLockExecution');
        const firstChannel = deferred<null>();
        const started: string[] = [];
        const makeModel = (name: string, channel: () => Promise<null>) =>
            new RecordingUtilModel(
                { getLogger: () => logger },
                {
                    getConfig: () => ({
                        recorded: [{ name: 'synthetic-root', path: root }],
                        recordedFormat: 'synthetic',
                        recordedFileExtension: '.ts',
                    }),
                },
                execution,
                {
                    findId: vi.fn(() => {
                        started.push(name);
                        return channel();
                    }),
                },
                { findChannelIdAndTime: vi.fn(async () => null) },
                {},
                {},
            );
        const first = makeModel('first', () => firstChannel.promise);
        const second = makeModel('second', async () => null);
        const firstPath = first.getRecPath(makeReserve({ id: 91 }), false, true);
        const overdueResult = firstPath.then(
            () => {
                throw new Error('Path selection settled after its owner watchdog');
            },
            error => error as Error & { terminal: Promise<void> },
        );
        try {
            for (let microtask = 0; started.length === 0 && microtask < 5; microtask += 1) {
                await Promise.resolve();
            }
            expect(started).toEqual(['first']);
            await vi.advanceTimersByTimeAsync(600_000);
            expect(unlock).not.toHaveBeenCalled();
            const otherDomainExecution = await otherDomain.getExecution(1);
            otherDomain.unLockExecution(otherDomainExecution);
            firstChannel.resolve(null);
            const overdue = await overdueResult;
            expect(overdue.name).toBe('PathSelectionOverdueError');
            expect(unlock).not.toHaveBeenCalled();

            const secondPath = second.getRecPath(makeReserve({ id: 92 }), false);
            await Promise.resolve();
            expect(started).toEqual(['first']);
            await overdue.terminal;

            expect(unlock).toHaveBeenCalledTimes(1);
            await expect(stat(join(root, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
            await secondPath;
            expect(started).toEqual(['first', 'second']);
            expect(execution.lockId).toBeNull();
            expect(execution.exeQueue).toEqual([]);
        } finally {
            unlock.mockRestore();
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.5] completes a path selection settled at 599,999ms without entering the overdue path', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-path-before-watchdog-'));
        const channel = deferred<null>();
        const execution = { getExecution: vi.fn(async () => 93), unLockExecution: vi.fn() };
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: root }],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            execution,
            { findId: vi.fn(() => channel.promise) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            {},
            {},
        );
        try {
            const selected = model.getRecPath(makeReserve({ id: 93 }), false);
            for (let microtask = 0; execution.getExecution.mock.calls.length === 0 && microtask < 5; microtask += 1) {
                await Promise.resolve();
            }
            await vi.advanceTimersByTimeAsync(599_999);
            channel.resolve(null);

            await expect(selected).resolves.toMatchObject({ fullPath: join(root, 'synthetic.ts') });
            expect(execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(93);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.5] releases an overdue rejected selection exactly once without rerunning its path read', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-overdue-path-rejection-'));
        const channel = deferred<null>();
        const failure = new Error('synthetic late channel failure');
        const execution = { getExecution: vi.fn(async () => 94), unLockExecution: vi.fn() };
        const findId = vi.fn(() => channel.promise);
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: root }],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            execution,
            { findId },
            { findChannelIdAndTime: vi.fn(async () => null) },
            {},
            {},
        );
        const selected = model.getRecPath(makeReserve({ id: 94 }), false);
        const overdueResult = selected.then(
            () => {
                throw new Error('Late path failure was returned as a normal selection result');
            },
            error => error as Error & { terminal: Promise<void> },
        );
        try {
            for (let microtask = 0; findId.mock.calls.length === 0 && microtask < 5; microtask += 1) {
                await Promise.resolve();
            }
            await vi.advanceTimersByTimeAsync(600_000);
            vi.useRealTimers();
            channel.reject(failure);
            const overdue = await overdueResult;
            let terminalTimeout!: ReturnType<typeof setTimeout>;
            const terminalOutcome = await Promise.race([
                overdue.terminal.then(() => 'settled'),
                new Promise<'timed-out'>(resolve => {
                    terminalTimeout = setTimeout(() => resolve('timed-out'), 1_000);
                }),
            ]);
            clearTimeout(terminalTimeout);

            expect(terminalOutcome).toBe('settled');
            await overdue.terminal;

            expect(overdue.name).toBe('PathSelectionOverdueError');
            expect(findId).toHaveBeenCalledOnce();
            expect(execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(94);
        } finally {
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.5] releases a late path-only selection without treating an unreserved file as owned', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-overdue-path-only-selection-'));
        const channel = deferred<null>();
        const execution = { getExecution: vi.fn(async () => 95), unLockExecution: vi.fn() };
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: root }],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            execution,
            { findId: vi.fn(() => channel.promise) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            {},
            {},
        );
        const selected = model.getRecPath(makeReserve({ id: 95 }), false);
        const overdueResult = selected.then(
            () => {
                throw new Error('Late path-only result was returned to its recording session');
            },
            error => error as Error & { terminal: Promise<void> },
        );
        try {
            for (let microtask = 0; execution.getExecution.mock.calls.length === 0 && microtask < 5; microtask += 1) {
                await Promise.resolve();
            }
            await vi.advanceTimersByTimeAsync(600_000);
            channel.resolve(null);
            const overdue = await overdueResult;
            await overdue.terminal;

            expect(execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(95);
            await expect(stat(join(root, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.5] contains late handle and unlink cleanup failures before releasing the exact owner', async () => {
        vi.useFakeTimers();
        const root = await mkdtemp(join(tmpdir(), 'epgstation-overdue-path-cleanup-failure-'));
        const channel = deferred<null>();
        const execution = { getExecution: vi.fn(async () => 96), unLockExecution: vi.fn() };
        const closeFailure = new Error('synthetic close failure');
        const fileHandle = { close: vi.fn(async () => Promise.reject(closeFailure)) } as any;
        const open = vi.spyOn(fs.promises, 'open').mockResolvedValueOnce(fileHandle);
        const errorCount = logger.system.error.mock.calls.length;
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: root }],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            execution,
            { findId: vi.fn(() => channel.promise) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            {},
            {},
        );
        const selected = model.getRecPath(makeReserve({ id: 96 }), false, true);
        const overdueResult = selected.then(
            () => {
                throw new Error('Late failed cleanup result was returned to its recording session');
            },
            error => error as Error & { terminal: Promise<void> },
        );
        try {
            for (let microtask = 0; execution.getExecution.mock.calls.length === 0 && microtask < 5; microtask += 1) {
                await Promise.resolve();
            }
            await vi.advanceTimersByTimeAsync(600_000);
            channel.resolve(null);
            const overdue = await overdueResult;
            await overdue.terminal;

            expect(fileHandle.close).toHaveBeenCalledOnce();
            expect(execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(96);
            expect(logger.system.error.mock.calls.slice(errorCount)).toEqual([
                [`close overdue recFile error: ${join(root, 'synthetic.ts')}`],
                [closeFailure],
                [`delete overdue recFile error: ${join(root, 'synthetic.ts')}`],
                [expect.objectContaining({ code: 'ENOENT' })],
            ]);
        } finally {
            open.mockRestore();
            vi.useRealTimers();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.1] releases the exact token after a path-stage failure', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-path-'));
        const failure = new Error('synthetic channel failure');
        const execution = { getExecution: vi.fn(async () => 73), unLockExecution: vi.fn() };
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: root }],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            execution,
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => Promise.reject(failure)) },
            {},
            {},
        );
        try {
            await expect(model.getRecPath(makeReserve({ isTimeSpecified: true }), false)).rejects.toBe(failure);
            expect(execution.unLockExecution).toHaveBeenCalledOnce();
            expect(execution.unLockExecution).toHaveBeenCalledWith(73);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.1] does not start path selection or release when the five-second acquisition rejects', async () => {
        const failure = new Error('GetExecutionTimeoutError');
        const execution = { getExecution: vi.fn(async () => Promise.reject(failure)), unLockExecution: vi.fn() };
        const channelDB = { findId: vi.fn() };
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            { getConfig: () => ({ recorded: [], recordedFormat: 'synthetic', recordedFileExtension: '.ts' }) },
            execution,
            channelDB,
            { findChannelIdAndTime: vi.fn() },
            {},
            {},
        );
        await expect(model.getRecPath(makeReserve(), false)).rejects.toBe(failure);
        expect(execution.getExecution).toHaveBeenCalledWith(1, 5_000);
        expect(channelDB.findId).not.toHaveBeenCalled();
        expect(execution.unLockExecution).not.toHaveBeenCalled();
    });

    it('[Task 4.1] releases the real execution carrier before the next queued path selector starts', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-queue-'));
        const execution = new ExecutionManagementModel({ getLogger: () => logger });
        const acquire = vi.spyOn(execution, 'getExecution');
        const unlock = vi.spyOn(execution, 'unLockExecution');
        const firstChannel = deferred<null>();
        const ledger: string[] = [];
        const makeModel = (findId: () => Promise<null>) =>
            new RecordingUtilModel(
                { getLogger: () => logger },
                {
                    getConfig: () => ({
                        recorded: [{ name: 'synthetic-root', path: root }],
                        recordedFormat: 'synthetic',
                        recordedFileExtension: '.ts',
                    }),
                },
                execution,
                { findId: vi.fn(findId) },
                { findChannelIdAndTime: vi.fn(async () => null) },
                {},
                {},
            );
        const first = makeModel(async () => {
            ledger.push('first:path');
            return firstChannel.promise;
        });
        const second = makeModel(async () => {
            ledger.push('second:path');
            return null;
        });
        try {
            const firstPath = first.getRecPath(makeReserve({ id: 81 }), false);
            await Promise.resolve();
            const secondPath = second.getRecPath(makeReserve({ id: 82 }), false);
            await Promise.resolve();
            expect(ledger).toEqual(['first:path']);
            firstChannel.resolve(null);
            await firstPath;
            await secondPath;
            expect(ledger).toEqual(['first:path', 'second:path']);
            const acquiredIds = await Promise.all(acquire.mock.results.map(result => result.value as Promise<number>));
            expect([...new Set(acquiredIds)]).toHaveLength(2);
            expect(unlock).toHaveBeenCalledTimes(acquiredIds.length);
            for (const executionId of acquiredIds) {
                expect(unlock.mock.calls.filter(([id]) => id === executionId)).toHaveLength(1);
            }
            expect(execution.lockId).toBeNull();
            expect(execution.exeQueue).toEqual([]);
        } finally {
            acquire.mockRestore();
            unlock.mockRestore();
            await rm(root, { recursive: true, force: true });
        }
    });

    // design.md#6.3 の親保存先fallback: parentDirectoryNameが無い、または現在のconfig.recordedに一致する名前が
    // 無い場合は、いずれもerrorにせずconfig.recordedの先頭要素へsilentにfallbackする。
    describe('[design.md#6.3] parent directory fallback across multiple config.recorded entries', () => {
        const makeMultiRootModel = async (rootA: string, rootB: string) =>
            new RecordingUtilModel(
                { getLogger: () => logger },
                {
                    getConfig: () => ({
                        recorded: [
                            { name: 'first-root', path: rootA },
                            { name: 'second-root', path: rootB },
                        ],
                        recordedFormat: 'synthetic-file',
                        recordedFileExtension: '.ts',
                    }),
                },
                { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
                { findId: vi.fn(async () => null) },
                { findChannelIdAndTime: vi.fn(async () => null) },
                {},
                {},
            );

        it('uses config.recorded[0] when the reservation has no parentDirectoryName', async () => {
            const rootA = await mkdtemp(join(tmpdir(), 'epgstation-parent-a-'));
            const rootB = await mkdtemp(join(tmpdir(), 'epgstation-parent-b-'));
            try {
                const model = await makeMultiRootModel(rootA, rootB);
                const result = await model.getRecPath(makeReserve({ parentDirectoryName: null }), false);
                expect(result.parendDir).toEqual({ name: 'first-root', path: rootA });
                expect(result.fullPath).toBe(join(rootA, 'synthetic-file.ts'));
            } finally {
                await rm(rootA, { recursive: true, force: true });
                await rm(rootB, { recursive: true, force: true });
            }
        });

        it('uses the matching entry by name when parentDirectoryName matches a non-first entry', async () => {
            const rootA = await mkdtemp(join(tmpdir(), 'epgstation-parent-a-'));
            const rootB = await mkdtemp(join(tmpdir(), 'epgstation-parent-b-'));
            try {
                const model = await makeMultiRootModel(rootA, rootB);
                const result = await model.getRecPath(makeReserve({ parentDirectoryName: 'second-root' }), false);
                expect(result.parendDir).toEqual({ name: 'second-root', path: rootB });
                expect(result.fullPath).toBe(join(rootB, 'synthetic-file.ts'));
            } finally {
                await rm(rootA, { recursive: true, force: true });
                await rm(rootB, { recursive: true, force: true });
            }
        });

        it('falls back to config.recorded[0] without error when parentDirectoryName matches no configured entry', async () => {
            const rootA = await mkdtemp(join(tmpdir(), 'epgstation-parent-a-'));
            const rootB = await mkdtemp(join(tmpdir(), 'epgstation-parent-b-'));
            try {
                const model = await makeMultiRootModel(rootA, rootB);
                const result = await model.getRecPath(
                    makeReserve({ parentDirectoryName: 'removed-from-config' }),
                    false,
                );
                expect(result.parendDir).toEqual({ name: 'first-root', path: rootA });
                expect(result.fullPath).toBe(join(rootA, 'synthetic-file.ts'));
            } finally {
                await rm(rootA, { recursive: true, force: true });
                await rm(rootB, { recursive: true, force: true });
            }
        });
    });

    it('[design.md#6.3 gap] resolves under the configured tmp directory when isEnableTmp is set', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-path-tmp-'));
        const execution = { getExecution: vi.fn(async () => 74), unLockExecution: vi.fn() };
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: '/should-not-be-used' }],
                    recordedTmp: root,
                    recordedFormat: 'synthetic-tmp-file',
                    recordedFileExtension: '.ts',
                }),
            },
            execution,
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            {},
            {},
        );
        try {
            const result = await model.getRecPath(makeReserve(), true);
            expect(result.parendDir).toEqual({ name: 'tmp', path: root });
            expect(result.fullPath).toBe(join(root, 'synthetic-tmp-file.ts'));
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 4.3 gap] increments the conflict suffix past an existing file at the base name', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-conflict-'));
        const execution = { getExecution: vi.fn(async () => 75), unLockExecution: vi.fn() };
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: root }],
                    recordedFormat: 'synthetic-file',
                    recordedFileExtension: '.ts',
                }),
            },
            execution,
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            {},
            {},
        );
        try {
            await writeFile(join(root, 'synthetic-file.ts'), 'already recorded');
            const result = await model.getRecPath(makeReserve(), false);
            expect(result.fullPath).toBe(join(root, 'synthetic-file(1).ts'));
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[Task 9.5 gap] rejects moving a temporary file when its stored path is null', async () => {
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 76), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn() },
            { getFullFilePathFromId: vi.fn(async () => null) },
        );

        await expect(model.movingFromTmp(makeReserve({ id: 971 }), 971)).rejects.toThrow('VideoFilePathIsNull');
    });

    it('[Task 9.5 gap] rejects moving a temporary file when recordedTmp is not configured', async () => {
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 77), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: vi.fn() },
            { getFullFilePathFromId: vi.fn(async () => '/synthetic-tmp/972.ts') },
        );

        await expect(model.movingFromTmp(makeReserve({ id: 972 }), 972)).rejects.toThrow('RecordedTmpIsUndefined');
    });

    it('[Task 9.5 gap] rejects updating a video file size when its stored path is null', async () => {
        const model = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [],
                    recordedFormat: 'synthetic',
                    recordedFileExtension: '.ts',
                }),
            },
            { getExecution: vi.fn(async () => 78), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateSize: vi.fn() },
            { getFullFilePathFromId: vi.fn(async () => null) },
        );

        await expect(model.updateVideoFileSize(973)).rejects.toThrow('VideoFilePathIsNull');
    });
});
