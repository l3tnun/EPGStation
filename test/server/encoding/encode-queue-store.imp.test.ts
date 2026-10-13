import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type * as apid from '../../../api';
import type { EncodeQueueRow } from '../../../src/model/db/IEncodeQueueDB';
import type IEncodeQueueStore from '../../../src/model/operator/encode/IEncodeQueueStore';
import { createDeferred } from '../harness/async';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const EncodeQueueStore = (
    require(join(compiledSnapshot, 'model', 'operator', 'encode', 'EncodeQueueStore.js')) as {
        default: new (loggerModel: unknown, encodeQueueDB: unknown) => IEncodeQueueStore;
    }
).default;

interface StoreRuntime {
    nextId: number;
}

const MAX = Number.MAX_SAFE_INTEGER;

const option = (recordedId: number): apid.AddEncodeProgramOption => ({
    recordedId,
    sourceVideoFileId: recordedId + 1000,
    parentDir: 'synthetic-parent',
    mode: 'synthetic-mode',
    removeOriginal: true,
});

const row = (id: number, value: unknown = option(id % 1000)): EncodeQueueRow => ({
    id,
    option: typeof value === 'string' ? value : JSON.stringify(value),
    outputPath: null,
    createdAt: 1_700_000_000_000,
});

const makeDb = (rows: EncodeQueueRow[] = []) => {
    const table = new Map<number, EncodeQueueRow>(rows.map(item => [item.id, { ...item }]));
    return {
        table,
        insertOnce: vi.fn(async (item: EncodeQueueRow) => {
            if (table.has(item.id)) throw new Error('synthetic duplicate primary key');
            table.set(item.id, { ...item });
        }),
        updateOutputPath: vi.fn(async (id: number, outputPath: string) => {
            const current = table.get(id);
            if (typeof current === 'undefined') return false;
            current.outputPath = outputPath;
            return true;
        }),
        deleteOnce: vi.fn(async (id: number) => table.delete(id)),
        deleteAll: vi.fn(async () => {
            table.clear();
        }),
        findAll: vi.fn(async () => [...table.values()].sort((a, b) => a.id - b.id).map(item => ({ ...item }))),
    };
};

const makeStore = (rows: EncodeQueueRow[] = []) => {
    const db = makeDb(rows);
    const logger = {
        encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
        system: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    };
    const store = new EncodeQueueStore({ getLogger: () => logger }, db);
    return { db, logger, store };
};

describe('EncodeQueueStore internals (unittest/imp)', () => {
    it('[EN-IMP-QUEUE-STORE-ID] skips ids that records still use', async () => {
        const { store } = makeStore([row(MAX - 1), row(MAX)]);
        await store.list();
        // 次に割り当てる値が使用中の値に当たった場合を作る
        (store as unknown as StoreRuntime).nextId = MAX - 1;

        expect(await store.add(option(1))).toBe(1);
        expect(await store.add(option(2))).toBe(2);
    });

    it('[EN-IMP-QUEUE-STORE-ID] keeps the id and the next value unchanged when storing fails', async () => {
        const { db, store } = makeStore();
        db.insertOnce.mockRejectedValueOnce(new Error('synthetic insert failure'));

        await expect(store.add(option(1))).rejects.toThrow('synthetic insert failure');
        expect(await store.add(option(2))).toBe(1);
        expect((await store.list()).map(record => record.option)).toEqual([option(2)]);
    });

    it('[EN-IMP-QUEUE-STORE-ID] stores the request as JSON with a null output path and the record time', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(1_760_000_000_123);
        try {
            const { db, store } = makeStore();
            await store.add(option(3));

            expect(db.insertOnce).toHaveBeenCalledWith({
                id: 1,
                option: JSON.stringify(option(3)),
                outputPath: null,
                createdAt: 1_760_000_000_123,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('[EN-IMP-QUEUE-STORE-ID] updates the output path of a record and rejects when storing fails', async () => {
        const { db, store } = makeStore([row(4)]);

        await store.updateOutputPath(4, '<synthetic-output>/b.mp4');
        expect((await store.list())[0].outputPath).toBe('<synthetic-output>/b.mp4');

        db.updateOutputPath.mockRejectedValueOnce(new Error('synthetic update failure'));
        await expect(store.updateOutputPath(4, '<synthetic-output>/c.mp4')).rejects.toThrow('synthetic update failure');
        expect((await store.list())[0].outputPath).toBe('<synthetic-output>/b.mp4');

        // 記録の無い識別番号への更新は何もしない
        await expect(store.updateOutputPath(5, '<synthetic-output>/d.mp4')).resolves.toBeUndefined();
        expect((await store.list()).map(record => record.id)).toEqual([4]);
    });

    it('[EN-IMP-QUEUE-STORE-ID] keeps a record whose removal fails', async () => {
        const { db, store } = makeStore([row(6)]);
        db.deleteOnce.mockRejectedValueOnce(new Error('synthetic delete failure'));

        await expect(store.remove(6)).rejects.toThrow('synthetic delete failure');
        expect((await store.list()).map(record => record.id)).toEqual([6]);

        await store.remove(6);
        expect(await store.list()).toEqual([]);
        // 記録の無い識別番号の削除は成功として扱う
        await expect(store.remove(6)).resolves.toBeUndefined();
    });

    it('[EN-IMP-QUEUE-STORE-SERIAL] runs operations one at a time in call order', async () => {
        const { db, store } = makeStore();
        const firstInsert = createDeferred<void>();
        const original = db.insertOnce.getMockImplementation()!;
        db.insertOnce.mockImplementationOnce(async item => {
            await firstInsert.promise;
            await original(item);
        });

        const first = store.add(option(1));
        const second = store.add(option(2));
        const listed = store.list();
        for (let round = 0; round < 8; round += 1) await new Promise<void>(resolve => setImmediate(resolve));
        expect(db.insertOnce).toHaveBeenCalledTimes(1);

        firstInsert.resolve(undefined);
        expect(await first).toBe(1);
        expect(await second).toBe(2);
        expect((await listed).map(record => record.id)).toEqual([1, 2]);
    });

    it('[EN-IMP-QUEUE-STORE-SERIAL] retries loading the records after a failed load', async () => {
        const { db, store } = makeStore([row(8)]);
        db.findAll.mockRejectedValueOnce(new Error('synthetic load failure'));

        await expect(store.list()).rejects.toThrow('synthetic load failure');
        expect((await store.list()).map(record => record.id)).toEqual([8]);
        expect(await store.add(option(9))).toBe(9);
        expect(db.findAll).toHaveBeenCalledTimes(2);
    });

    it('[EN-IMP-QUEUE-STORE-SERIAL] loads the records only once', async () => {
        const { db, store } = makeStore([row(1)]);

        await store.list();
        await store.add(option(2));
        await store.remove(1);
        await store.list();

        expect(db.findAll).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['broken JSON', row(2, '{"recordedId":'), 'option'],
        ['a JSON array', row(2, [1, 2]), 'option'],
        ['a JSON null', row(2, 'null'), 'option'],
        ['a missing recordedId', row(2, { ...option(2), recordedId: undefined }), 'option'],
        ['a string sourceVideoFileId', row(2, { ...option(2), sourceVideoFileId: '1002' }), 'option'],
        ['a missing parentDir', row(2, { ...option(2), parentDir: undefined }), 'option'],
        ['a numeric directory', row(2, { ...option(2), directory: 1 }), 'option'],
        ['a missing mode', row(2, { ...option(2), mode: undefined }), 'option'],
        ['a string removeOriginal', row(2, { ...option(2), removeOriginal: 'true' }), 'option'],
        ['an id of 0', row(0), 'id'],
        ['an unsafe id', row(MAX + 2), 'id'],
    ])(
        '[EN-IMP-QUEUE-STORE-SERIAL] deletes a record with %s while loading and keeps the others',
        async (_label, broken) => {
            const { db, logger, store } = makeStore([row(1), broken, row(3)]);

            expect((await store.list()).map(record => record.id)).toEqual([1, 3]);
            expect(db.deleteOnce).toHaveBeenCalledWith(broken.id);
            expect(db.table.has(broken.id)).toBe(false);
            expect(logger.encode.error).toHaveBeenCalled();
        },
    );

    it('[EN-IMP-QUEUE-STORE-SERIAL] keeps loading when deleting a broken record fails', async () => {
        const { db, logger, store } = makeStore([row(1), row(2, 'not-json')]);
        db.deleteOnce.mockRejectedValueOnce(new Error('synthetic delete failure'));

        expect((await store.list()).map(record => record.id)).toEqual([1]);
        // 削除できなかった壊れた記録の識別番号は使用中として扱い、割り当てない
        (store as unknown as StoreRuntime).nextId = 2;
        expect(await store.add(option(5))).toBe(3);
        expect(logger.encode.error).toHaveBeenCalled();
    });

    it('[EN-IMP-QUEUE-STORE-ORDER] starts after the first of equal largest gaps in ascending order', async () => {
        const gap = 3_100_000_000_000_000;
        // 隣り合う差が gap で二つ同じ。最後から先頭への差（最大値を越えて 1 へ戻る差）はそれより小さい
        const { store } = makeStore([row(1), row(1 + gap), row(1 + 2 * gap)]);

        expect((await store.list()).map(record => record.id)).toEqual([1 + gap, 1 + 2 * gap, 1]);
    });
});
