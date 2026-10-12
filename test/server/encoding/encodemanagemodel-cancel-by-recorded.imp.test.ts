import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const EncodeManageModel = (
    require(join(snapshot, 'model', 'service', 'encode', 'EncodeManageModel.js')) as {
        default: new (...args: unknown[]) => any;
    }
).default;

const encoderWithOption = (option: { encodeId: number; recordedId: number } | null) => ({
    getEncodeOption: vi.fn(() => option),
});

/**
 * EncodeManageModel.cancelEncodeByRecordedId が対象を集める際、encode の設定がまだ無い
 * （`getEncodeOption` が null の）待機中・実行中の項目は飛ばし、該当する recordedId の
 * 項目だけをキャンセルする。
 */
describe('EncodeManageModel cancelEncodeByRecordedId queue scan (unittest/imp)', () => {
    it('[EN-SPEC-R8-2] skips queue items without an encode option and cancels the matching wait and running items', async () => {
        const model = new EncodeManageModel(
            { getLogger: () => ({ encode: { error: vi.fn(), info: vi.fn() } }) },
            { getConfig: () => ({ concurrentEncodeNum: 1 }) },
            {},
            vi.fn(),
            {},
        );
        model.waitQueue = [
            encoderWithOption(null),
            encoderWithOption({ encodeId: 1, recordedId: 5 }),
            encoderWithOption({ encodeId: 2, recordedId: 6 }),
        ];
        model.runningQueue = [encoderWithOption(null), encoderWithOption({ encodeId: 3, recordedId: 5 })];
        const cancel = vi.spyOn(model, 'cancel').mockResolvedValue(undefined);

        await expect(model.cancelEncodeByRecordedId(5)).resolves.toBeUndefined();

        expect(cancel.mock.calls).toEqual([[1], [3]]);
    });

    it('[EN-SPEC-R8-2] leaves running items of other recorded programs untouched', async () => {
        const model = new EncodeManageModel(
            { getLogger: () => ({ encode: { error: vi.fn(), info: vi.fn() } }) },
            { getConfig: () => ({ concurrentEncodeNum: 1 }) },
            {},
            vi.fn(),
            {},
        );
        model.waitQueue = [];
        model.runningQueue = [
            encoderWithOption({ encodeId: 1, recordedId: 6 }),
            encoderWithOption({ encodeId: 2, recordedId: 5 }),
            encoderWithOption({ encodeId: 3, recordedId: 7 }),
        ];
        const cancel = vi.spyOn(model, 'cancel').mockResolvedValue(undefined);

        await model.cancelEncodeByRecordedId(5);

        expect(cancel.mock.calls).toEqual([[2]]);
    });

    it('[EN-SPEC-R8-2] logs each failed cancellation, keeps cancelling the rest and then throws StopEncodeError', async () => {
        const log = { encode: { error: vi.fn(), info: vi.fn() } };
        const model = new EncodeManageModel(
            { getLogger: () => log },
            { getConfig: () => ({ concurrentEncodeNum: 1 }) },
            {},
            vi.fn(),
            {},
        );
        model.waitQueue = [
            encoderWithOption({ encodeId: 1, recordedId: 5 }),
            encoderWithOption({ encodeId: 2, recordedId: 5 }),
        ];
        model.runningQueue = [];
        const failure = new Error('synthetic cancel failure');
        const cancel = vi.spyOn(model, 'cancel').mockImplementation(async (encodeId: number) => {
            if (encodeId === 1) throw failure;
        });

        await expect(model.cancelEncodeByRecordedId(5)).rejects.toThrow('StopEncodeError');

        expect(cancel.mock.calls).toEqual([[1], [2]]);
        expect(log.encode.error.mock.calls).toEqual([['cancel encode failed: 1'], [failure]]);
    });
});

const encoderWithMode = (option: { encodeId: number; mode: string; recordedId: number } | null) => ({
    getEncodeOption: vi.fn(() => option),
});

/**
 * EncodeManageModel.getRecordedIndex は実行中・待機中の encode を recordedId ごとにまとめる。
 * 同じ recordedId の項目は、実行中、待機中の順に 1 つの配列へ積まれる。
 */
describe('EncodeManageModel getRecordedIndex (unittest/imp)', () => {
    it('[EN-SPEC-R8-2] groups running and waiting encodes by recorded id and skips items without an option', () => {
        const model = new EncodeManageModel(
            { getLogger: () => ({ encode: { error: vi.fn(), info: vi.fn() } }) },
            { getConfig: () => ({ concurrentEncodeNum: 1 }) },
            {},
            vi.fn(),
            {},
        );
        model.runningQueue = [
            encoderWithMode({ encodeId: 1, mode: 'a', recordedId: 5 }),
            encoderWithMode(null),
            encoderWithMode({ encodeId: 2, mode: 'b', recordedId: 5 }),
            encoderWithMode({ encodeId: 3, mode: 'c', recordedId: 6 }),
        ];
        model.waitQueue = [
            encoderWithMode(null),
            encoderWithMode({ encodeId: 4, mode: 'd', recordedId: 5 }),
            encoderWithMode({ encodeId: 5, mode: 'e', recordedId: 7 }),
            encoderWithMode({ encodeId: 6, mode: 'f', recordedId: 7 }),
            encoderWithMode({ encodeId: 7, mode: 'g', recordedId: 6 }),
        ];

        expect(model.getRecordedIndex()).toEqual({
            5: [
                { encodeId: 1, name: 'a' },
                { encodeId: 2, name: 'b' },
                { encodeId: 4, name: 'd' },
            ],
            6: [
                { encodeId: 3, name: 'c' },
                { encodeId: 7, name: 'g' },
            ],
            7: [
                { encodeId: 5, name: 'e' },
                { encodeId: 6, name: 'f' },
            ],
        });
    });
});
