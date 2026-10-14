import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type * as apid from '../../../api';
import type { EncodeQueueRow } from '../../../src/model/db/IEncodeQueueDB';
import type IEncodeQueueStore from '../../../src/model/operator/encode/IEncodeQueueStore';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const EncodeQueueStore = (
    require(join(compiledSnapshot, 'model', 'operator', 'encode', 'EncodeQueueStore.js')) as {
        default: new (loggerModel: unknown, encodeQueueDB: unknown) => IEncodeQueueStore;
    }
).default;

const MAX = Number.MAX_SAFE_INTEGER;

const option = (recordedId: number): apid.AddEncodeProgramOption => ({
    recordedId,
    sourceVideoFileId: recordedId + 1000,
    parentDir: 'synthetic-parent',
    directory: 'synthetic-subdirectory',
    mode: 'synthetic-mode',
    removeOriginal: false,
});

const row = (id: number, recordedId = id % 1000): EncodeQueueRow => ({
    id,
    option: JSON.stringify(option(recordedId)),
    outputPath: null,
    createdAt: 1_700_000_000_000,
});

/** encode_queue の table を Map で模した DB。 */
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

const makeLogger = () => ({
    encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    system: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
});

const makeStore = (rows: EncodeQueueRow[] = []) => {
    const db = makeDb(rows);
    const logger = makeLogger();
    const store = new EncodeQueueStore({ getLogger: () => logger }, db);
    return { db, logger, store };
};

/** 直列の処理に並んだ操作が終わるまで待つ。 */
const drain = async (store: IEncodeQueueStore): Promise<void> => {
    await store.list();
};

describe('encode request records (unittest/spec)', () => {
    it('[EN-SPEC-R7-3] starts at 1 without records, continues after the newest record, and never gives an id back', async () => {
        const empty = makeStore();
        const first = await empty.store.add(option(1));
        const second = await empty.store.add(option(2));
        await empty.store.remove(first);
        await empty.store.remove(second);
        const third = await empty.store.add(option(3));
        expect([first, second, third]).toEqual([1, 2, 3]);
        expect([...empty.db.table.keys()]).toEqual([3]);

        const restarted = makeStore([row(5), row(9)]);
        expect(await restarted.store.add(option(10))).toBe(10);
        expect((await restarted.store.list()).map(record => record.id)).toEqual([5, 9, 10]);
    });

    it('[EN-SPEC-R7-4] wraps from Number.MAX_SAFE_INTEGER to 1 and keeps accepting requests', async () => {
        const { db, store } = makeStore([row(MAX - 1), row(MAX)]);

        expect(await store.add(option(1))).toBe(1);
        expect(await store.add(option(2))).toBe(2);
        expect([...db.table.keys()].sort((a, b) => a - b)).toEqual([1, 2, MAX - 1, MAX]);
        // 受け付け順は、最大値から 1 へ戻った箇所を境目に並ぶ
        expect((await store.list()).map(record => record.id)).toEqual([MAX - 1, MAX, 1, 2]);
    });

    it.each([
        ['no records', [], [], 1],
        ['one record', [7], [7], 8],
        ['records without a wrap', [3, 5, 9], [3, 5, 9], 10],
        ['records across the wrap', [1, 2, MAX - 1, MAX], [MAX - 1, MAX, 1, 2], 3],
        ['the newest record at the maximum', [MAX - 2, MAX], [MAX - 2, MAX], 1],
        ['the oldest record at the maximum', [1, MAX], [MAX, 1], 2],
    ])(
        '[EN-SPEC-R7-5] orders %s in acceptance order and continues after the newest',
        async (_label, ids, ordered, next) => {
            const { store } = makeStore(ids.map(id => row(id)));

            const records = await store.list();
            expect(records.map(record => record.id)).toEqual(ordered);
            expect(await store.add(option(100))).toBe(next);
        },
    );

    it('[EN-SPEC-R7-5] keeps acceptance order across the wrap for a request added after the restart', async () => {
        // DB は識別番号の昇順で返すので、読込直後の並びは受け付け順と異なる
        const { store } = makeStore([row(1), row(2), row(MAX - 1), row(MAX)]);

        expect(await store.add(option(100))).toBe(3);
        expect((await store.list()).map(record => record.id)).toEqual([MAX - 1, MAX, 1, 2, 3]);
    });

    it('[EN-SPEC-R7-5] returns the stored request, output path and record time', async () => {
        const { store } = makeStore([{ ...row(4, 44), outputPath: '<synthetic-output>/a.mp4', createdAt: 123 }]);

        expect(await store.list()).toEqual([
            { id: 4, option: option(44), outputPath: '<synthetic-output>/a.mp4', createdAt: 123 },
        ]);
    });

    it('[EN-SPEC-R1-12] removes the record made by a request whose caller gave up waiting for the reply', async () => {
        const { db, store } = makeStore();

        const abandoned = await store.add(option(121), 'synthetic-request-1');
        const kept = await store.add(option(122), 'synthetic-request-2');
        await store.abandon('synthetic-request-1');
        // 知らない値と、取り消し済みの値は何もしない
        await store.abandon('synthetic-request-unknown');
        await store.abandon('synthetic-request-1');

        expect([...db.table.keys()]).toEqual([kept]);
        expect(db.deleteOnce.mock.calls).toEqual([[abandoned]]);
        expect((await store.list()).map(record => record.id)).toEqual([kept]);
    });

    it('[EN-SPEC-R1-12] does not remove a record through a request value after the record was removed', async () => {
        const { db, store } = makeStore();

        const first = await store.add(option(123), 'synthetic-request-3');
        await store.remove(first);
        const second = await store.add(option(124));
        await store.abandon('synthetic-request-3');

        expect([...db.table.keys()]).toEqual([second]);
        expect(db.deleteOnce.mock.calls).toEqual([[first]]);
    });

    it('[EN-SPEC-R1-12] keeps the request value of another record when one record is removed', async () => {
        const { db, store } = makeStore();

        const first = await store.add(option(125), 'synthetic-request-4');
        const second = await store.add(option(126), 'synthetic-request-5');
        await store.remove(first);
        // 削除した記録の値だけが消え、別の要求の値では取り消せる
        await store.abandon('synthetic-request-5');

        expect(db.table.size).toBe(0);
        expect(db.deleteOnce.mock.calls).toEqual([[first], [second]]);
    });

    it('[EN-SPEC-R7-9] records a request from a finished recording before handing it over with its id', async () => {
        const { db, logger, store } = makeStore();
        const sent: Array<{ id: number; stored: boolean }> = [];
        const send = vi.fn((id: number) => {
            sent.push({ id, stored: db.table.has(id) });
            return true;
        });

        expect(store.enqueueFromRecording(option(71), send)).toBeUndefined();
        await drain(store);

        expect(send).toHaveBeenCalledWith(1, option(71));
        expect(sent).toEqual([{ id: 1, stored: true }]);
        expect(logger.encode.error).not.toHaveBeenCalled();
    });

    it('[EN-SPEC-R7-9] keeps the record when no Web/API process is there to receive it', async () => {
        const { db, store } = makeStore();
        const send = vi.fn(() => false);

        store.enqueueFromRecording(option(72), send);
        await drain(store);

        expect(send).toHaveBeenCalledTimes(1);
        expect([...db.table.keys()]).toEqual([1]);
        expect((await store.list()).map(record => record.option)).toEqual([option(72)]);
    });

    it('[EN-SPEC-R7-9] sends nothing when the record cannot be stored and logs the failure', async () => {
        const { db, logger, store } = makeStore();
        db.insertOnce.mockRejectedValueOnce(new Error('synthetic insert failure'));
        const send = vi.fn(() => true);

        store.enqueueFromRecording(option(73), send);
        await drain(store);

        expect(send).not.toHaveBeenCalled();
        expect(db.table.size).toBe(0);
        expect(logger.encode.error).toHaveBeenCalled();
    });

    it('[EN-SPEC-R7-9] keeps the record and logs when handing it over throws', async () => {
        const { db, logger, store } = makeStore();
        const send = vi.fn(() => {
            throw new Error('synthetic send failure');
        });

        store.enqueueFromRecording(option(74), send);
        await drain(store);

        expect([...db.table.keys()]).toEqual([1]);
        expect(logger.encode.error).toHaveBeenCalled();
    });

    it('[EN-SPEC-R7-9] logs a request from a finished recording that cannot be recorded because the records cannot be read', async () => {
        const { db, logger, store } = makeStore([row(3)]);
        db.findAll.mockRejectedValueOnce(new Error('synthetic load failure'));
        const send = vi.fn(() => true);

        store.enqueueFromRecording(option(75), send);
        await drain(store);

        expect(send).not.toHaveBeenCalled();
        expect(logger.encode.error).toHaveBeenCalled();
        expect([...db.table.keys()]).toEqual([3]);
    });

    it('[EN-SPEC-R7-12] fails an operation while the records cannot be read and reads them again on the next one', async () => {
        const { db, store } = makeStore([row(5)]);
        db.findAll.mockRejectedValueOnce(new Error('synthetic load failure'));

        await expect(store.add(option(6))).rejects.toThrow('synthetic load failure');
        expect(db.insertOnce).not.toHaveBeenCalled();
        expect(await store.add(option(6))).toBe(6);
        expect(db.findAll).toHaveBeenCalledTimes(2);
    });

    it('[EN-SPEC-R7-12] deletes records that cannot be interpreted, logs them, and uses the rest', async () => {
        const broken = { ...row(2), option: '{"recordedId":' };
        const { db, logger, store } = makeStore([
            row(1),
            broken,
            { ...row(4), option: JSON.stringify({ recordedId: 4 }) },
        ]);

        expect((await store.list()).map(record => record.id)).toEqual([1]);
        expect([...db.table.keys()]).toEqual([1]);
        expect(logger.encode.error).toHaveBeenCalled();
    });

    it('[EN-SPEC-R7-12] never assigns the id of a broken record that could not be deleted', async () => {
        const { db, store } = makeStore([row(1), { ...row(2), option: 'not-json' }]);
        db.deleteOnce.mockRejectedValueOnce(new Error('synthetic delete failure'));

        await store.list();
        await store.remove(1);
        // 次の値は 2 だが、削除できなかった壊れた記録の 2 を飛ばす
        expect(await store.add(option(9))).toBe(3);
    });

    it('[EN-SPEC-R7-12] never assigns 1 when the broken record that could not be deleted has the id 1', async () => {
        const { db, store } = makeStore([{ ...row(1), option: 'not-json' }]);
        db.deleteOnce.mockRejectedValueOnce(new Error('synthetic delete failure'));

        expect(await store.add(option(9))).toBe(2);
        expect([...db.table.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
    });
});
