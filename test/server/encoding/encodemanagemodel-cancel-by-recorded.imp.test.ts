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
});
