import 'reflect-metadata';

import { EventEmitter } from 'node:events';
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

const makeManage = (records: EncodeQueueRecord[], provider: () => Promise<unknown>) => {
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
    const manage = new EncodeManageModel(
        { getLogger: () => logger },
        { getConfig: () => ({ concurrentEncodeNum: 1 }) },
        { getExecution: vi.fn(async () => 'synthetic-execution'), unLockExecution: vi.fn() },
        provider,
        { emitAddEncode: vi.fn(), emitCancelEncode: vi.fn(), emitErrorEncode: vi.fn() },
        resourceUse,
        undefined,
        store,
        {
            recordedDB: {
                findId: vi.fn(async (recordedId: number) => ({
                    id: recordedId,
                    videoFiles: [{ id: recordedId * 10 }],
                })),
            },
            videoUtil: { getFullFilePathFromVideoFile: vi.fn(() => null), getParentDirPath: vi.fn(() => null) },
            isSameFile: vi.fn(async () => false),
            removeFile: vi.fn(async () => undefined),
        },
    );
    return { logger, manage, resourceUse, store };
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
        ) as unknown as EncodeManageRuntime & { push(option: apid.AddEncodeProgramOption): Promise<number> };
        try {
            await expect(manage.restore()).resolves.toBeUndefined();
            expect(manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
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
});
