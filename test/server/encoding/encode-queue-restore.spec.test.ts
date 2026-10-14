import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type * as apid from '../../../api';
import type { EncodeQueueRecord } from '../../../src/model/operator/encode/IEncodeQueueStore';
import type { EncodeOption } from '../../../src/model/service/encode/IEncoderModel';
import { createDeferred } from '../harness/async';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

interface EncodeManageRuntime {
    push(option: apid.AddEncodeProgramOption): Promise<number>;
    pushPersisted(encodeId: number, option: apid.AddEncodeProgramOption): Promise<void>;
    restore(): Promise<void>;
    cancel(encodeId: number): Promise<void>;
    cancelEncodeByRecordedId(recordedId: number): Promise<void>;
    getEncodeInfo(): {
        runningQueue: Array<{ id: number; recordedId: number }>;
        waitQueue: Array<{ id: number; recordedId: number }>;
    };
    listener: EventEmitter;
}

const EncodeManageModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeManageModel.js')) as {
        default: new (...args: unknown[]) => EncodeManageRuntime;
    }
).default;
const { removeFileIfPresent } = require(join(compiledSnapshot, 'model', 'ServiceChildProcessSystem.js')) as {
    removeFileIfPresent(filePath: string): Promise<void>;
};
const EncodeEvent = (
    require(join(compiledSnapshot, 'model', 'event', 'EncodeEvent.js')) as {
        default: new (logger: unknown) => {
            setAddEncode(callback: (id: number) => void): void;
        };
    }
).default;

interface SyntheticEncoder {
    option: EncodeOption | null;
    finishCallback: ((isError: boolean, outputFilePath: string | null) => void) | null;
    started: boolean;
}

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
    createdAt: 1_700_000_000_000,
});

const flushEventLoop = async (): Promise<void> => {
    for (let round = 0; round < 8; round += 1) await new Promise<void>(resolve => setImmediate(resolve));
};

/** 管理側の依頼記録窓口を Map で模した port。呼出しの順序を `calls` に残す。 */
const makeStorePort = (records: EncodeQueueRecord[] = [], firstId = 1) => {
    let nextId = firstId;
    const calls: string[] = [];
    const stored = new Map<number, EncodeQueueRecord>(records.map(item => [item.id, { ...item }]));
    return {
        calls,
        stored,
        abandon: vi.fn(async (_requestToken: string) => undefined),
        add: vi.fn(async (value: apid.AddEncodeProgramOption, _requestToken: string) => {
            const id = nextId;
            nextId += 1;
            stored.set(id, { id, option: value, outputPath: null, createdAt: 0 });
            calls.push(`add:${id}`);
            return id;
        }),
        updateOutputPath: vi.fn(async (id: number, outputPath: string) => {
            calls.push(`update:${id}`);
            const current = stored.get(id);
            if (typeof current !== 'undefined') current.outputPath = outputPath;
        }),
        remove: vi.fn(async (id: number) => {
            calls.push(`remove:${id}`);
            stored.delete(id);
        }),
        list: vi.fn(async () => [...stored.values()].map(item => ({ ...item }))),
    };
};

/** 録画済み番組ごとの録画ファイル（識別番号と full path）。 */
type RecordedFiles = Record<number, Array<{ id: number; fullPath: string }>>;

const makeRestoreDependencies = (recordedFiles: RecordedFiles) => ({
    recordedDB: {
        findId: vi.fn(async (recordedId: number) =>
            typeof recordedFiles[recordedId] === 'undefined'
                ? null
                : { id: recordedId, videoFiles: recordedFiles[recordedId].map(file => ({ ...file })) },
        ),
    },
    videoUtil: {
        getFullFilePathFromVideoFile: vi.fn((videoFile: { fullPath: string }) => videoFile.fullPath),
        getParentDirPath: vi.fn((name: string) => (name === 'synthetic-parent' ? '<synthetic-output>' : null)),
    },
    isSameFile: vi.fn(async (_a: string, _b: string) => false),
    removeFile: vi.fn(async (_path: string) => undefined),
});

const makeFixture = (
    options: {
        concurrentEncodeNum?: number;
        encodeQueueLimit?: number;
        encodeRemoveInterruptedOutput?: unknown;
        records?: EncodeQueueRecord[];
        recordedFiles?: RecordedFiles;
        firstId?: number;
    } = {},
) => {
    const calls: string[] = [];
    const encoders: SyntheticEncoder[] = [];
    const logger = {
        encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
        system: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    };
    const event = new EncodeEvent({ getLogger: () => logger });
    const added: number[] = [];
    event.setAddEncode(id => added.push(id));
    const config: Record<string, unknown> = { concurrentEncodeNum: options.concurrentEncodeNum ?? 1 };
    if (typeof options.encodeQueueLimit !== 'undefined') config.encodeQueueLimit = options.encodeQueueLimit;
    if ('encodeRemoveInterruptedOutput' in options) {
        config.encodeRemoveInterruptedOutput = options.encodeRemoveInterruptedOutput;
    }
    const execution = {
        getExecution: vi.fn(async () => 'synthetic-execution'),
        unLockExecution: vi.fn(),
    };
    const provider = vi.fn(async () => {
        const encoder: SyntheticEncoder & Record<string, unknown> = {
            option: null,
            finishCallback: null,
            started: false,
            cancel: vi.fn(async () => undefined),
            getEncodeId: () => encoder.option?.encodeId ?? null,
            getEncodeOption: () => encoder.option,
            getProgressInfo: () => null,
            setOnFinish: (callback: (isError: boolean, outputFilePath: string | null) => void) => {
                encoder.finishCallback = callback;
            },
            setOption: (value: EncodeOption) => {
                encoder.option = value;
            },
            start: vi.fn(async () => {
                encoder.started = true;
            }),
        };
        encoders.push(encoder);
        return encoder;
    });
    // 使用権の token は中身を持たない object とし、どの録画済み番組の token かは対応表で引く
    const leaseRecordedIds = new WeakMap<object, number>();
    const grantLease = (recordedId: number): { token: object } => {
        const lease = { token: {} };
        leaseRecordedIds.set(lease.token, recordedId);
        return lease;
    };
    const resourceUse = {
        acquire: vi.fn(async (recordedId: number) => {
            calls.push(`acquire:${recordedId}`);
            return grantLease(recordedId);
        }),
        release: vi.fn(async (token: object) => {
            calls.push(`release:${leaseRecordedIds.get(token)}`);
        }),
    };
    const store = makeStorePort(options.records ?? [], options.firstId ?? 1);
    // 記録の操作も、使用権の操作と同じ列に順序を残す
    const storeAdd = store.add.getMockImplementation()!;
    store.add.mockImplementation(async (value: apid.AddEncodeProgramOption, requestToken: string) => {
        const id = await storeAdd(value, requestToken);
        calls.push(`add:${id}`);
        return id;
    });
    store.remove.mockImplementation(async (id: number) => {
        calls.push(`remove:${id}`);
        store.stored.delete(id);
    });
    const restoreDependencies = makeRestoreDependencies(options.recordedFiles ?? {});
    restoreDependencies.removeFile.mockImplementation(async (path: string) => {
        calls.push(`removeFile:${path}`);
    });
    const manage = new EncodeManageModel(
        { getLogger: () => logger },
        { getConfig: () => config },
        execution,
        provider,
        event,
        resourceUse,
        undefined,
        store,
        restoreDependencies,
    );
    const release = (): void => {
        manage.listener.removeAllListeners();
        (event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
    };
    return {
        added,
        calls,
        encoders,
        execution,
        grantLease,
        logger,
        manage,
        provider,
        release,
        resourceUse,
        restoreDependencies,
        store,
    };
};

const ids = (items: Array<{ id: number }>): number[] => items.map(item => item.id);

describe('encode request records in the Web/API process (unittest/spec)', () => {
    it('[EN-SPEC-R1-3] returns the identifier that the request record store assigned', async () => {
        const fixture = makeFixture({ concurrentEncodeNum: 1, firstId: Number.MAX_SAFE_INTEGER });
        try {
            await expect(fixture.manage.push(option(31))).resolves.toBe(Number.MAX_SAFE_INTEGER);
            expect(fixture.store.add).toHaveBeenCalledWith(option(31), expect.any(String));
            expect(fixture.added).toEqual([Number.MAX_SAFE_INTEGER]);
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R1-12] fails a request whose record cannot be stored and releases what it took', async () => {
        const fixture = makeFixture({ concurrentEncodeNum: 1 });
        fixture.store.add.mockRejectedValueOnce(new Error('synthetic record failure'));
        try {
            await expect(fixture.manage.push(option(112))).rejects.toThrow('synthetic record failure');
            await flushEventLoop();

            expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            expect(fixture.provider).not.toHaveBeenCalled();
            expect(fixture.added).toEqual([]);
            expect(fixture.calls).toEqual(['acquire:112', 'release:112']);
            expect(fixture.execution.unLockExecution).toHaveBeenCalledTimes(1);
            // 応答を得られなかった要求の記録の取消しを、同じ要求ごとの値で依頼する
            const requestToken = fixture.store.add.mock.calls[0][1];
            expect(requestToken).toEqual(expect.any(String));
            expect(fixture.store.abandon.mock.calls).toEqual([[requestToken]]);

            // 上限の予約も戻り、次の依頼を受け付ける
            await expect(fixture.manage.push(option(113))).resolves.toBe(1);
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R2-6] records a request on admission and removes the record before releasing the lease at the end', async () => {
        const fixture = makeFixture({ concurrentEncodeNum: 1 });
        try {
            const first = await fixture.manage.push(option(261));
            const second = await fixture.manage.push(option(262));
            await flushEventLoop();
            expect(fixture.encoders[0].started).toBe(true);

            // 待機中の取消: 記録を削除してから使用権を解放する
            await fixture.manage.cancel(second);
            await flushEventLoop();
            // 正常終了: 結果反映の後で記録を削除し、その後で使用権を解放する
            fixture.encoders[0].finishCallback?.(false, null);
            await flushEventLoop();

            expect(fixture.calls).toEqual([
                'acquire:261',
                'add:1',
                'acquire:262',
                'add:2',
                'remove:2',
                'release:262',
                'remove:1',
                'release:261',
            ]);
            expect([first, second]).toEqual([1, 2]);
            expect(fixture.store.stored.size).toBe(0);
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R2-6] keeps finishing when removing the record fails and logs it', async () => {
        const fixture = makeFixture({ concurrentEncodeNum: 1 });
        fixture.store.remove.mockRejectedValueOnce(new Error('synthetic remove failure'));
        try {
            await fixture.manage.push(option(263));
            await flushEventLoop();
            fixture.encoders[0].finishCallback?.(true, null);
            await flushEventLoop();

            expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            expect(fixture.resourceUse.release).toHaveBeenCalledTimes(1);
            expect(fixture.logger.encode.error).toHaveBeenCalled();
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-2] restores every record in acceptance order before accepting new requests', async () => {
        const fixture = makeFixture({
            concurrentEncodeNum: 1,
            encodeQueueLimit: 1,
            records: [record(Number.MAX_SAFE_INTEGER, 71), record(1, 72), record(2, 73)],
            recordedFiles: {
                71: [{ id: 710, fullPath: 'p71' }],
                72: [{ id: 720, fullPath: 'p72' }],
                73: [{ id: 730, fullPath: 'p73' }],
            },
            firstId: 3,
        });
        const listed = createDeferred<EncodeQueueRecord[]>();
        const original = fixture.store.list.getMockImplementation()!;
        fixture.store.list.mockImplementationOnce(async () => {
            await listed.promise;
            return original();
        });
        try {
            const restoring = fixture.manage.restore();
            // 復元中の受付は、復元が終わるまで待つ
            const pushed = fixture.manage.push(option(74));
            await flushEventLoop();
            expect(fixture.store.add).not.toHaveBeenCalled();

            listed.resolve([]);
            await restoring;
            await expect(pushed).rejects.toThrow('EncodeQueueIsFull');
            await flushEventLoop();

            // 上限 1 でも記録はすべて戻し、追加通知は作らない。実行中だった依頼も最初から変換し直す
            const queue = fixture.manage.getEncodeInfo();
            expect([...ids(queue.runningQueue), ...ids(queue.waitQueue)]).toEqual([Number.MAX_SAFE_INTEGER, 1, 2]);
            expect(fixture.encoders[0].started).toBe(true);
            expect(fixture.added).toEqual([]);
            expect(fixture.store.stored.has(Number.MAX_SAFE_INTEGER)).toBe(true);
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-6] treats a record whose output is a registered file as converted', async () => {
        const fixture = makeFixture({
            records: [{ ...record(6, 76), outputPath: '<synthetic-output>/done.mp4' }],
            recordedFiles: {
                76: [
                    { id: 760, fullPath: '<synthetic-source>/a.ts' },
                    { id: 761, fullPath: '<synthetic-output>/done.mp4' },
                ],
            },
        });
        try {
            await fixture.manage.restore();

            expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            expect(fixture.calls).toEqual(['remove:6']);
            expect(fixture.restoreDependencies.removeFile).not.toHaveBeenCalled();
        } finally {
            fixture.release();
        }
    });

    it.each([
        ['enabled', true, true],
        ['omitted', undefined, true],
        ['disabled', false, false],
    ] as const)(
        '[EN-SPEC-R7-7] handles an unregistered interrupted output when the setting is %s and restores the request',
        async (_label, setting, removes) => {
            const fixture = makeFixture({
                concurrentEncodeNum: 1,
                ...(typeof setting === 'undefined' ? {} : { encodeRemoveInterruptedOutput: setting }),
                records: [{ ...record(7, 77), outputPath: '<synthetic-output>/partial.mp4' }],
                recordedFiles: { 77: [{ id: 770, fullPath: '<synthetic-source>/b.ts' }] },
            });
            try {
                await fixture.manage.restore();
                await flushEventLoop();

                expect(fixture.calls).toEqual([
                    ...(removes ? ['removeFile:<synthetic-output>/partial.mp4'] : []),
                    'acquire:77',
                ]);
                expect(ids(fixture.manage.getEncodeInfo().runningQueue)).toEqual([7]);
                expect(fixture.store.stored.has(7)).toBe(true);
            } finally {
                fixture.release();
            }
        },
    );

    it('[EN-SPEC-R7-7] restores the request when removing the interrupted output fails and logs it', async () => {
        const fixture = makeFixture({
            records: [{ ...record(8, 78), outputPath: '<synthetic-output>/locked.mp4' }],
            recordedFiles: { 78: [{ id: 780, fullPath: '<synthetic-source>/c.ts' }] },
        });
        fixture.restoreDependencies.removeFile.mockRejectedValueOnce(new Error('synthetic unlink failure'));
        try {
            await fixture.manage.restore();

            expect(ids(fixture.manage.getEncodeInfo().runningQueue)).toEqual([8]);
            expect(fixture.logger.encode.error).toHaveBeenCalled();
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-7] treats an interrupted output that is already gone as deleted without logging a failure', async () => {
        const fixture = makeFixture({
            records: [{ ...record(9, 79), outputPath: '<synthetic-output>/already-removed.mp4' }],
            recordedFiles: { 79: [{ id: 790, fullPath: '<synthetic-source>/e.ts' }] },
        });
        fixture.restoreDependencies.removeFile.mockImplementationOnce(removeFileIfPresent);
        try {
            await fixture.manage.restore();

            expect(fixture.restoreDependencies.removeFile).toHaveBeenCalledWith('<synthetic-output>/already-removed.mp4');
            expect(ids(fixture.manage.getEncodeInfo().runningQueue)).toEqual([9]);
            expect(fixture.logger.encode.error).not.toHaveBeenCalled();
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-8] drops and removes records without a recorded program, source file, or lease', async () => {
        const fixture = makeFixture({
            concurrentEncodeNum: 3,
            records: [record(1, 81), record(2, 82), record(3, 83), record(4, 84)],
            // 81: 録画済み番組なし。82: 変換元ファイルなし。83: 使用権を取得できない。84: 戻す
            recordedFiles: {
                82: [{ id: 999, fullPath: '<synthetic-source>/other.ts' }],
                83: [{ id: 830, fullPath: '<synthetic-source>/d.ts' }],
                84: [{ id: 840, fullPath: '<synthetic-source>/e.ts' }],
            },
        });
        fixture.resourceUse.acquire.mockImplementation(async (recordedId: number) => {
            fixture.calls.push(`acquire:${recordedId}`);
            if (recordedId === 83) throw new Error('synthetic lease failure');
            return fixture.grantLease(recordedId);
        });
        try {
            await fixture.manage.restore();

            expect(fixture.calls).toEqual(['remove:1', 'remove:2', 'acquire:83', 'remove:3', 'acquire:84']);
            expect(ids(fixture.manage.getEncodeInfo().runningQueue)).toEqual([4]);
            expect([...fixture.store.stored.keys()]).toEqual([4]);
            expect(fixture.logger.encode.error).toHaveBeenCalled();
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-2] keeps every record when listing fails, accepts requests meanwhile, and lists again after 60 seconds', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const fixture = makeFixture({
            records: [record(5, 85)],
            recordedFiles: { 85: [{ id: 850, fullPath: 'p85' }] },
            firstId: 6,
        });
        fixture.store.list.mockRejectedValueOnce(new Error('synthetic list failure'));
        try {
            await expect(fixture.manage.restore()).resolves.toBeUndefined();

            expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            expect(fixture.store.remove).not.toHaveBeenCalled();
            expect(fixture.store.stored.has(5)).toBe(true);
            expect(fixture.logger.encode.error).toHaveBeenCalled();
            // 一覧を取得できない間も、新しい受付は待たない
            await expect(fixture.manage.push(option(86))).resolves.toBe(6);
            await flushEventLoop();

            await vi.advanceTimersByTimeAsync(60 * 1000 - 1);
            expect(fixture.store.list).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            await flushEventLoop();

            expect(fixture.store.list).toHaveBeenCalledTimes(2);
            expect(ids(fixture.manage.getEncodeInfo().runningQueue)).toEqual([6]);
            expect(ids(fixture.manage.getEncodeInfo().waitQueue)).toEqual([5]);
        } finally {
            vi.useRealTimers();
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-2] starts restored requests within the free slots and lets a cancel requested during restoration reach them', async () => {
        const fixture = makeFixture({
            concurrentEncodeNum: 2,
            records: [record(1, 91), record(2, 92), record(3, 93)],
            recordedFiles: {
                91: [{ id: 910, fullPath: 'p91' }],
                92: [{ id: 920, fullPath: 'p92' }],
                93: [{ id: 930, fullPath: 'p93' }],
            },
        });
        const listed = createDeferred<void>();
        const original = fixture.store.list.getMockImplementation()!;
        fixture.store.list.mockImplementationOnce(async () => {
            await listed.promise;
            return original();
        });
        try {
            const restoring = fixture.manage.restore();
            // まだ戻していない識別番号への取消は、復元が終わるまで待つ
            const cancelling = fixture.manage.cancel(3);
            await flushEventLoop();
            expect(fixture.execution.getExecution).not.toHaveBeenCalled();

            listed.resolve(undefined);
            await restoring;
            await cancelling;
            await flushEventLoop();

            expect(ids(fixture.manage.getEncodeInfo().runningQueue)).toEqual([1, 2]);
            expect(fixture.manage.getEncodeInfo().waitQueue).toEqual([]);
            expect(fixture.encoders.filter(encoder => encoder.started)).toHaveLength(2);
            expect(fixture.store.stored.has(3)).toBe(false);
        } finally {
            fixture.release();
        }
    });

    it.each([
        ['the concurrency is zero', { concurrentEncodeNum: 0 }, false],
        ['the queue is full', { concurrentEncodeNum: 1, encodeQueueLimit: 1 }, true],
        ['the lease cannot be acquired', { concurrentEncodeNum: 1 }, false],
    ] as const)(
        '[EN-SPEC-R7-10] removes a recorded request handed over by the manager when %s',
        async (label, settings, fillsQueue) => {
            const fixture = makeFixture(settings);
            try {
                if (fillsQueue) {
                    // 実行中 1 件と待機中 1 件で上限に達する
                    await fixture.manage.push(option(100));
                    await flushEventLoop();
                    await fixture.manage.push(option(101));
                }
                if (label === 'the lease cannot be acquired') {
                    fixture.resourceUse.acquire.mockRejectedValueOnce(new Error('synthetic lease failure'));
                }
                const callsBefore = fixture.calls.length;
                const addedBefore = fixture.added.length;
                fixture.store.stored.set(90, record(90, 109));

                await expect(fixture.manage.pushPersisted(90, option(109))).resolves.toBeUndefined();
                await flushEventLoop();

                expect(fixture.calls.slice(callsBefore).filter(call => call.startsWith('remove'))).toEqual([
                    'remove:90',
                ]);
                expect(fixture.store.stored.has(90)).toBe(false);
                expect(fixture.added.slice(addedBefore)).toEqual([]);
                expect([
                    ...ids(fixture.manage.getEncodeInfo().runningQueue),
                    ...ids(fixture.manage.getEncodeInfo().waitQueue),
                ]).not.toContain(90);
                expect(fixture.logger.encode.error).toHaveBeenCalled();
            } finally {
                fixture.release();
            }
        },
    );

    it('[EN-SPEC-R7-10] accepts a recorded request handed over by the manager with its identifier', async () => {
        const fixture = makeFixture({ concurrentEncodeNum: 1 });
        try {
            fixture.store.stored.set(95, record(95, 195));
            await fixture.manage.pushPersisted(95, option(195));
            await flushEventLoop();

            expect(ids(fixture.manage.getEncodeInfo().runningQueue)).toEqual([95]);
            expect(fixture.added).toEqual([95]);
            expect(fixture.store.add).not.toHaveBeenCalled();
            expect(fixture.store.remove).not.toHaveBeenCalled();
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-11] ignores a handed-over request whose identifier is already queued or running', async () => {
        const fixture = makeFixture({
            concurrentEncodeNum: 1,
            records: [record(11, 111), record(12, 112)],
            recordedFiles: { 111: [{ id: 1110, fullPath: 'p111' }], 112: [{ id: 1120, fullPath: 'p112' }] },
        });
        try {
            await fixture.manage.restore();
            await flushEventLoop();
            const callsBefore = [...fixture.calls];

            await fixture.manage.pushPersisted(11, option(111));
            await fixture.manage.pushPersisted(12, option(112));
            await flushEventLoop();

            expect(fixture.calls).toEqual(callsBefore);
            expect(fixture.added).toEqual([]);
            expect(ids(fixture.manage.getEncodeInfo().runningQueue)).toEqual([11]);
            expect(ids(fixture.manage.getEncodeInfo().waitQueue)).toEqual([12]);
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-6] treats a record whose output is the same file as a registered one under another path as converted', async () => {
        const fixture = makeFixture({
            records: [{ ...record(9, 79), outputPath: '<synthetic-old-root>/done.mp4' }],
            recordedFiles: {
                79: [
                    { id: 790, fullPath: '<synthetic-source>/f.ts' },
                    { id: 791, fullPath: '<synthetic-output>/done.mp4' },
                ],
            },
        });
        fixture.restoreDependencies.isSameFile.mockImplementation(
            async (a: string, b: string) =>
                [a, b].sort().join('|') ===
                ['<synthetic-old-root>/done.mp4', '<synthetic-output>/done.mp4'].sort().join('|'),
        );
        try {
            await fixture.manage.restore();

            expect(fixture.calls).toEqual(['remove:9']);
            expect(fixture.restoreDependencies.removeFile).not.toHaveBeenCalled();
            expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-7] keeps an interrupted output outside the parent directory and restores the request', async () => {
        const fixture = makeFixture({
            records: [{ ...record(10, 80), outputPath: '<synthetic-elsewhere>/partial.mp4' }],
            recordedFiles: { 80: [{ id: 800, fullPath: '<synthetic-source>/g.ts' }] },
        });
        try {
            await fixture.manage.restore();

            expect(fixture.restoreDependencies.removeFile).not.toHaveBeenCalled();
            expect(fixture.calls).toEqual(['acquire:80']);
            expect(ids(fixture.manage.getEncodeInfo().runningQueue)).toEqual([10]);
            expect(fixture.logger.encode.warn).toHaveBeenCalled();
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-8] keeps a record whose recorded program cannot be read and does not restore it', async () => {
        const fixture = makeFixture({
            records: [record(11, 87), record(12, 88)],
            recordedFiles: { 88: [{ id: 880, fullPath: 'p88' }] },
        });
        fixture.restoreDependencies.recordedDB.findId.mockRejectedValueOnce(new Error('synthetic read failure'));
        try {
            await fixture.manage.restore();

            expect(fixture.store.remove).not.toHaveBeenCalled();
            expect(fixture.store.stored.has(11)).toBe(true);
            expect(ids(fixture.manage.getEncodeInfo().runningQueue)).toEqual([12]);
            expect(fixture.logger.encode.error).toHaveBeenCalled();
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-11] ignores a handed-over request listed at restoration even after it finished', async () => {
        const fixture = makeFixture({
            concurrentEncodeNum: 1,
            records: [record(13, 113)],
            recordedFiles: { 113: [{ id: 1130, fullPath: 'p113' }] },
        });
        try {
            await fixture.manage.restore();
            await flushEventLoop();
            fixture.encoders[0].finishCallback?.(true, null);
            await flushEventLoop();
            expect(fixture.store.stored.has(13)).toBe(false);
            const callsBefore = [...fixture.calls];

            await fixture.manage.pushPersisted(13, option(113));
            await flushEventLoop();

            expect(fixture.calls).toEqual(callsBefore);
            expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            expect(fixture.added).toEqual([]);
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R1-12] logs a failure to abandon the record of a request without a reply', async () => {
        const fixture = makeFixture({ concurrentEncodeNum: 1 });
        fixture.store.add.mockRejectedValueOnce(new Error('synthetic record timeout'));
        fixture.store.abandon.mockRejectedValueOnce(new Error('synthetic abandon failure'));
        try {
            await expect(fixture.manage.push(option(114))).rejects.toThrow('synthetic record timeout');
            await flushEventLoop();

            expect(fixture.store.abandon).toHaveBeenCalledTimes(1);
            expect(fixture.logger.encode.error).toHaveBeenCalledWith('failed to abandon an encode request record');
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-6] skips a registered file whose full path cannot be resolved when judging the output', async () => {
        const fixture = makeFixture({
            records: [{ ...record(14, 89), outputPath: '<synthetic-output>/partial-89.mp4' }],
            recordedFiles: {
                89: [
                    { id: 890, fullPath: '<synthetic-source>/h.ts' },
                    { id: 891, fullPath: '<unresolvable>' },
                ],
            },
        });
        fixture.restoreDependencies.videoUtil.getFullFilePathFromVideoFile.mockImplementation(
            (videoFile: { fullPath: string }) =>
                videoFile.fullPath === '<unresolvable>' ? (null as unknown as string) : videoFile.fullPath,
        );
        try {
            await fixture.manage.restore();

            // 解決できない録画ファイルは比べずに飛ばし、未登録として途中出力を削除してから戻す
            expect(fixture.restoreDependencies.isSameFile).toHaveBeenCalledTimes(1);
            expect(fixture.calls).toEqual(['removeFile:<synthetic-output>/partial-89.mp4', 'acquire:89']);
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-7] keeps an interrupted output when the parent directory of the request is unknown', async () => {
        const fixture = makeFixture({
            records: [{ ...record(15, 90), outputPath: '<synthetic-output>/partial-90.mp4' }],
            recordedFiles: { 90: [{ id: 900, fullPath: '<synthetic-source>/i.ts' }] },
        });
        fixture.restoreDependencies.videoUtil.getParentDirPath.mockReturnValue(null);
        try {
            await fixture.manage.restore();

            expect(fixture.restoreDependencies.removeFile).not.toHaveBeenCalled();
            expect(ids(fixture.manage.getEncodeInfo().runningQueue)).toEqual([15]);
            expect(fixture.logger.encode.warn).toHaveBeenCalled();
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-11] waits for restoration before judging a handed-over request listed at restoration', async () => {
        const fixture = makeFixture({
            concurrentEncodeNum: 1,
            records: [record(16, 116)],
            recordedFiles: { 116: [{ id: 1160, fullPath: 'p116' }] },
        });
        const listed = createDeferred<void>();
        const original = fixture.store.list.getMockImplementation()!;
        fixture.store.list.mockImplementationOnce(async () => {
            await listed.promise;
            return original();
        });
        try {
            const restoring = fixture.manage.restore();
            const handedOver = fixture.manage.pushPersisted(16, option(116));
            await flushEventLoop();
            expect(fixture.resourceUse.acquire).not.toHaveBeenCalled();

            listed.resolve(undefined);
            await restoring;
            await handedOver;
            await flushEventLoop();

            // 復元が戻した 1 件だけで、受け渡しは重複として捨てる
            expect(fixture.resourceUse.acquire).toHaveBeenCalledTimes(1);
            expect(ids(fixture.manage.getEncodeInfo().runningQueue)).toEqual([16]);
            expect(fixture.added).toEqual([]);
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-2] lets a cancel by recorded program requested during restoration reach the restored requests', async () => {
        const fixture = makeFixture({
            concurrentEncodeNum: 1,
            records: [record(21, 121), record(22, 122)],
            recordedFiles: { 121: [{ id: 1210, fullPath: 'p121' }], 122: [{ id: 1220, fullPath: 'p122' }] },
        });
        const listed = createDeferred<void>();
        const original = fixture.store.list.getMockImplementation()!;
        fixture.store.list.mockImplementationOnce(async () => {
            await listed.promise;
            return original();
        });
        try {
            const restoring = fixture.manage.restore();
            const cancelling = (
                fixture.manage as unknown as { cancelEncodeByRecordedId(id: number): Promise<void> }
            ).cancelEncodeByRecordedId(122);
            await flushEventLoop();

            listed.resolve(undefined);
            await restoring;
            await cancelling;
            await flushEventLoop();

            expect(ids(fixture.manage.getEncodeInfo().runningQueue)).toEqual([21]);
            expect(fixture.manage.getEncodeInfo().waitQueue).toEqual([]);
            expect(fixture.store.stored.has(22)).toBe(false);
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-11] keeps one job when a retried restoration and a handed-over request carry the same identifier', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const fixture = makeFixture({
            concurrentEncodeNum: 1,
            records: [record(7, 107)],
            recordedFiles: { 107: [{ id: 1070, fullPath: 'p107' }] },
        });
        fixture.store.list.mockRejectedValueOnce(new Error('synthetic list failure'));
        const leaseGate = createDeferred<void>();
        fixture.resourceUse.acquire.mockImplementationOnce(async (recordedId: number) => {
            fixture.calls.push(`acquire:${recordedId}`);
            await leaseGate.promise;
            return fixture.grantLease(recordedId);
        });
        try {
            await fixture.manage.restore();
            // 受け渡しが使用権の取得を待つ間に、やり直しの復元が同じ識別番号を判定する
            const handedOver = fixture.manage.pushPersisted(7, option(107));
            await flushEventLoop();
            await vi.advanceTimersByTimeAsync(60 * 1000);
            await flushEventLoop();
            leaseGate.resolve(undefined);
            await handedOver;
            await flushEventLoop();

            const queue = fixture.manage.getEncodeInfo();
            expect([...ids(queue.runningQueue), ...ids(queue.waitQueue)]).toEqual([7]);
            expect(fixture.resourceUse.acquire).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-2] lets requests, hand-overs and cancels proceed without waiting once restoration has finished', async () => {
        const fixture = makeFixture({ concurrentEncodeNum: 1 });
        try {
            await fixture.manage.restore();
            await fixture.manage.push(option(131));
            const waiting = await fixture.manage.push(option(132));
            await flushEventLoop();
            const requestsBefore = fixture.execution.getExecution.mock.calls.length;

            // 復元が終わった後は、どの操作も呼び出しと同じ同期処理の中で実行権を求める（復元を待たない）
            const pushed = fixture.manage.push(option(133));
            expect(fixture.execution.getExecution).toHaveBeenCalledTimes(requestsBefore + 1);
            fixture.store.stored.set(97, record(97, 134));
            const handedOver = fixture.manage.pushPersisted(97, option(134));
            expect(fixture.execution.getExecution).toHaveBeenCalledTimes(requestsBefore + 2);
            const cancelled = fixture.manage.cancel(waiting);
            expect(fixture.execution.getExecution).toHaveBeenCalledTimes(requestsBefore + 3);
            const cancelledByRecorded = fixture.manage.cancelEncodeByRecordedId(131);
            expect(fixture.execution.getExecution).toHaveBeenCalledTimes(requestsBefore + 4);

            await Promise.all([pushed, handedOver, cancelled, cancelledByRecorded]);
            await flushEventLoop();
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-2] restores on the retried listing a handed-over record that was rejected and could not be removed', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const fixture = makeFixture({
            concurrentEncodeNum: 1,
            recordedFiles: { 141: [{ id: 1410, fullPath: 'p141' }] },
        });
        fixture.store.list.mockRejectedValueOnce(new Error('synthetic list failure'));
        try {
            await fixture.manage.restore();
            // 受け渡しを使用権の取得の失敗で拒否し、記録の削除にも失敗したので記録が残る
            fixture.store.stored.set(41, record(41, 141));
            fixture.resourceUse.acquire.mockRejectedValueOnce(new Error('synthetic lease failure'));
            fixture.store.remove.mockRejectedValueOnce(new Error('synthetic remove failure'));
            await fixture.manage.pushPersisted(41, option(141));
            expect(fixture.store.stored.has(41)).toBe(true);
            expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });

            // やり直しの一覧に残っていた記録は、待機列へ戻す
            await vi.advanceTimersByTimeAsync(60 * 1000);
            await flushEventLoop();

            expect(ids(fixture.manage.getEncodeInfo().runningQueue)).toEqual([41]);
            expect(fixture.store.stored.has(41)).toBe(true);
        } finally {
            vi.useRealTimers();
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-10] removes a handed-over record once after releasing its lease when the job cannot be made', async () => {
        const fixture = makeFixture({ concurrentEncodeNum: 1 });
        fixture.provider.mockRejectedValueOnce(new Error('synthetic provider failure'));
        try {
            fixture.store.stored.set(92, record(92, 192));

            await expect(fixture.manage.pushPersisted(92, option(192))).resolves.toBeUndefined();
            await flushEventLoop();

            expect(fixture.calls).toEqual(['acquire:192', 'release:192', 'remove:92']);
            expect(fixture.store.stored.has(92)).toBe(false);
            expect(fixture.added).toEqual([]);
            expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-11] ignores a handed-over identifier that is being admitted, waiting or running without a restoration listing', async () => {
        const fixture = makeFixture({ concurrentEncodeNum: 1 });
        try {
            fixture.store.stored.set(93, record(93, 193));
            fixture.store.stored.set(94, record(94, 194));

            // 同じ識別番号の受け渡しが受付中
            await Promise.all([
                fixture.manage.pushPersisted(93, option(193)),
                fixture.manage.pushPersisted(93, option(193)),
            ]);
            await flushEventLoop();
            await fixture.manage.pushPersisted(94, option(194));
            await flushEventLoop();
            // 実行中の 93 と待機中の 94 を、もう一度渡す
            await fixture.manage.pushPersisted(93, option(193));
            await fixture.manage.pushPersisted(94, option(194));
            await flushEventLoop();

            expect(ids(fixture.manage.getEncodeInfo().runningQueue)).toEqual([93]);
            expect(ids(fixture.manage.getEncodeInfo().waitQueue)).toEqual([94]);
            expect(fixture.calls).toEqual(['acquire:193', 'acquire:194']);
            expect(fixture.added).toEqual([93, 94]);
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R2-6] removes the record of a restored request and then releases its lease when it ends', async () => {
        const fixture = makeFixture({
            concurrentEncodeNum: 1,
            records: [record(17, 117)],
            recordedFiles: { 117: [{ id: 1170, fullPath: 'p117' }] },
        });
        try {
            await fixture.manage.restore();
            await flushEventLoop();
            expect(fixture.encoders[0].started).toBe(true);

            fixture.encoders[0].finishCallback?.(false, null);
            await flushEventLoop();

            expect(fixture.calls).toEqual(['acquire:117', 'remove:17', 'release:117']);
            expect(fixture.store.stored.size).toBe(0);
        } finally {
            fixture.release();
        }
    });

    it('[EN-SPEC-R7-7] keeps an interrupted output that points at the parent directory itself and restores the request', async () => {
        const fixture = makeFixture({
            records: [{ ...record(18, 118), outputPath: '<synthetic-output>' }],
            recordedFiles: { 118: [{ id: 1180, fullPath: '<synthetic-source>/j.ts' }] },
        });
        try {
            await fixture.manage.restore();

            expect(fixture.restoreDependencies.removeFile).not.toHaveBeenCalled();
            expect(fixture.calls).toEqual(['acquire:118']);
            expect(ids(fixture.manage.getEncodeInfo().runningQueue)).toEqual([18]);
            expect(fixture.logger.encode.warn).toHaveBeenCalled();
        } finally {
            fixture.release();
        }
    });
});
