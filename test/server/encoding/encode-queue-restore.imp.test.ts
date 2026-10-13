import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { promises as fsPromises, type PathLike } from 'node:fs';
import { link, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type * as apid from '../../../api';
import type { EncodeQueueRecord } from '../../../src/model/operator/encode/IEncodeQueueStore';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

interface EncodeManageRuntime {
    restore(): Promise<void>;
    getEncodeInfo(): { runningQueue: Array<{ id: number }>; waitQueue: Array<{ id: number }> };
    listener: EventEmitter;
}

const EncodeManageModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeManageModel.js')) as {
        default: (new (...args: unknown[]) => EncodeManageRuntime) & {
            isSameFile(a: string, b: string): Promise<boolean>;
        };
    }
).default;

const option = (recordedId: number): apid.AddEncodeProgramOption => ({
    recordedId,
    sourceVideoFileId: recordedId * 10,
    parentDir: 'synthetic-parent',
    mode: 'synthetic-mode',
    removeOriginal: false,
});

const record = (id: number, recordedId: number): EncodeQueueRecord => ({
    id,
    option: option(recordedId),
    outputPath: null,
    createdAt: 0,
});

const makeManage = (
    records: EncodeQueueRecord[],
    provider: () => Promise<unknown>,
    settings: { concurrentEncodeNum?: number; withRestoreDependencies?: boolean } = {},
) => {
    const logger = {
        encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
        system: { error: vi.fn() },
    };
    const store = {
        add: vi.fn(async () => 1),
        abandon: vi.fn(async () => undefined),
        updateOutputPath: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        list: vi.fn(async () => records),
    };
    const resourceUse = { acquire: vi.fn(async () => ({ token: {} })), release: vi.fn(async () => undefined) };
    const execution = { getExecution: vi.fn(async () => 'synthetic-execution'), unLockExecution: vi.fn() };
    const restoreDependencies = {
        recordedDB: {
            findId: vi.fn(async (recordedId: number) => ({
                id: recordedId,
                videoFiles: [{ id: recordedId * 10 }],
            })),
        },
        videoUtil: { getFullFilePathFromVideoFile: vi.fn(() => null), getParentDirPath: vi.fn(() => null) },
        isSameFile: vi.fn(async () => false),
        removeFile: vi.fn(async () => undefined),
    };
    const manage = new EncodeManageModel(
        { getLogger: () => logger },
        { getConfig: () => ({ concurrentEncodeNum: settings.concurrentEncodeNum ?? 1 }) },
        execution,
        provider,
        { emitAddEncode: vi.fn(), emitCancelEncode: vi.fn(), emitErrorEncode: vi.fn() },
        resourceUse,
        undefined,
        store,
        settings.withRestoreDependencies === false ? undefined : restoreDependencies,
    );
    return { execution, logger, manage, resourceUse, restoreDependencies, store };
};

/** 開始しても終わらない変換ジョブ。 */
const makeSyntheticEncoder = () => {
    let encodeOption: { encodeId: number } | null = null;
    return {
        setOption: vi.fn((value: { encodeId: number }) => {
            encodeOption = value;
        }),
        getEncodeId: () => encodeOption?.encodeId ?? null,
        getEncodeOption: () => encodeOption,
        getProgressInfo: () => null,
        setOnFinish: vi.fn(),
        start: vi.fn(async () => undefined),
        cancel: vi.fn(async () => undefined),
    };
};

const queuedIds = (manage: EncodeManageRuntime): number[] => {
    const queue = manage.getEncodeInfo();
    return [...queue.runningQueue, ...queue.waitQueue].map(item => item.id);
};

const flushEventLoop = async (): Promise<void> => {
    for (let round = 0; round < 8; round += 1) await new Promise<void>(resolve => setImmediate(resolve));
};

describe('encode request restoration internals (unittest/imp)', () => {
    it('[EN-IMP-QUEUE-RESTORE] judges two paths of one hard-linked file as the same file and others as different', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encode-same-file-'));
        try {
            const original = join(root, 'synthetic-original.mp4');
            const linked = join(root, 'synthetic-linked.mp4');
            const other = join(root, 'synthetic-other.mp4');
            await writeFile(original, 'synthetic output');
            await link(original, linked);
            await writeFile(other, 'synthetic output');

            await expect(EncodeManageModel.isSameFile(original, linked)).resolves.toBe(true);
            await expect(EncodeManageModel.isSameFile(original, other)).resolves.toBe(false);
            await expect(EncodeManageModel.isSameFile(original, join(root, 'synthetic-missing.mp4'))).resolves.toBe(
                false,
            );
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('[EN-IMP-QUEUE-RESTORE] restores nothing without a request record store and keeps numbering locally', async () => {
        const logger = { encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }, system: { error: vi.fn() } };
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1 }) },
            { getExecution: vi.fn(async () => 'synthetic-execution'), unLockExecution: vi.fn() },
            vi.fn(async () => ({
                setOption: vi.fn(),
                getEncodeId: () => null,
                getEncodeOption: () => null,
                start: vi.fn(async () => undefined),
                setOnFinish: vi.fn(),
            })),
            { emitAddEncode: vi.fn(), emitCancelEncode: vi.fn(), emitErrorEncode: vi.fn() },
        ) as unknown as EncodeManageRuntime & {
            push(option: apid.AddEncodeProgramOption): Promise<number>;
            restoreRetryTimer: unknown;
        };
        try {
            await expect(manage.restore()).resolves.toBeUndefined();
            expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            // 記録が無いので、一覧の取得の失敗として扱わず、やり直しも設定しない
            expect(logger.encode.error).not.toHaveBeenCalled();
            expect(manage.restoreRetryTimer).toBeNull();
            await expect(manage.push(option(61))).resolves.toBe(1);
            await expect(manage.push(option(62))).resolves.toBe(2);
        } finally {
            manage.listener.removeAllListeners();
        }
    });

    it('[EN-IMP-QUEUE-RESTORE] restores only once however many times it is requested', async () => {
        const { manage, store } = makeManage([], async () => {
            throw new Error('unexpected provider call');
        });
        try {
            const first = manage.restore();
            const second = manage.restore();

            expect(second).toBe(first);
            await first;
            await manage.restore();
            expect(store.list).toHaveBeenCalledTimes(1);
        } finally {
            manage.listener.removeAllListeners();
        }
    });

    it('[EN-IMP-QUEUE-RESTORE] releases the lease and keeps the record when making the job fails', async () => {
        const { logger, manage, resourceUse, store } = makeManage([record(4, 44)], async () => {
            throw new Error('synthetic provider failure');
        });
        try {
            await manage.restore();

            expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            expect(resourceUse.acquire).toHaveBeenCalledTimes(1);
            expect(resourceUse.release).toHaveBeenCalledTimes(1);
            expect(store.remove).not.toHaveBeenCalled();
            expect(logger.encode.error).toHaveBeenCalled();
        } finally {
            manage.listener.removeAllListeners();
        }
    });

    it.each([
        ['a null carrier', null],
        ['a missing token', {}],
        ['a null token', { token: null }],
    ])(
        '[EN-IMP-QUEUE-RESTORE] drops and removes the record when the lease acquisition returns %s',
        async (_label, acquired) => {
            const { manage, resourceUse, store } = makeManage([record(5, 55)], async () => {
                throw new Error('unexpected provider call');
            });
            resourceUse.acquire.mockResolvedValueOnce(acquired as never);
            try {
                await manage.restore();

                expect(store.remove.mock.calls).toEqual([[5]]);
                expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            } finally {
                manage.listener.removeAllListeners();
            }
        },
    );

    it('[EN-IMP-QUEUE-RESTORE] judges files on different devices with the same inode number as different', async () => {
        const stat = vi
            .spyOn(fsPromises, 'stat')
            .mockImplementation(
                async (target: PathLike) => ({ dev: target === '<synthetic-a>' ? 1 : 2, ino: 7 }) as never,
            );
        try {
            await expect(EncodeManageModel.isSameFile('<synthetic-a>', '<synthetic-b>')).resolves.toBe(false);
            expect(stat).toHaveBeenCalledTimes(2);
        } finally {
            stat.mockRestore();
        }
    });

    it('[EN-IMP-QUEUE-RESTORE] retries the listing with a timer that does not keep the process alive', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const { manage, store } = makeManage([], async () => {
            throw new Error('unexpected provider call');
        });
        store.list.mockRejectedValueOnce(new Error('synthetic list failure'));
        const runtime = manage as unknown as { restoreRetryTimer: (NodeJS.Timeout & { hasRef(): boolean }) | null };
        try {
            await manage.restore();
            expect(runtime.restoreRetryTimer?.hasRef()).toBe(false);

            await vi.advanceTimersByTimeAsync(60 * 1000);
            expect(store.list).toHaveBeenCalledTimes(2);
            expect(runtime.restoreRetryTimer).toBeNull();
        } finally {
            vi.useRealTimers();
            manage.listener.removeAllListeners();
        }
    });

    it('[EN-IMP-QUEUE-RESTORE] restores records without judging them when no restoration dependencies are given', async () => {
        const { manage, resourceUse, restoreDependencies } = makeManage(
            [record(6, 66)],
            async () => makeSyntheticEncoder(),
            { withRestoreDependencies: false },
        );
        try {
            await manage.restore();
            await flushEventLoop();

            expect(queuedIds(manage)).toEqual([6]);
            expect(restoreDependencies.recordedDB.findId).not.toHaveBeenCalled();
            expect(resourceUse.acquire.mock.calls).toEqual([[66, 'encoding']]);
        } finally {
            manage.listener.removeAllListeners();
        }
    });

    it('[EN-IMP-QUEUE-RESTORE] requests queue checks only for the free slots after restoring', async () => {
        const { execution, manage } = makeManage(
            [record(4, 44), record(5, 55), record(6, 66)],
            async () => makeSyntheticEncoder(),
            { concurrentEncodeNum: 2 },
        );
        const runtime = manage as unknown as EncodeManageRuntime & {
            push(option: apid.AddEncodeProgramOption): Promise<number>;
        };
        try {
            // 復元の前に受け付けた 1 件が実行中で、空き枠は 1 つ
            await runtime.push(option(41));
            await flushEventLoop();
            const requestsBefore = execution.getExecution.mock.calls.length;

            await manage.restore();
            expect(execution.getExecution).toHaveBeenCalledTimes(requestsBefore + 1);
            await flushEventLoop();

            expect(manage.getEncodeInfo().runningQueue.map(item => item.id)).toEqual([1, 4]);
            expect(manage.getEncodeInfo().waitQueue.map(item => item.id)).toEqual([5, 6]);
        } finally {
            manage.listener.removeAllListeners();
        }
    });
});
