import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const EncodeApiModel = (
    require(join(snapshot, 'model', 'api', 'encode', 'EncodeApiModel.js')) as {
        default: new (...args: unknown[]) => {
            add(option: Record<string, unknown>): Promise<number>;
            cancel(encodeId: number): Promise<void>;
        };
    }
).default;

/**
 * EncodeApiModel の手動追加で保存先の親 directory が明示された場合と、キャンセルの委譲。
 * 親 directory を指定した追加は video file を引かずにそのまま登録し、キャンセルは
 * encode 管理へ id を渡す。
 */
describe('EncodeApiModel explicit parent directory and cancel (unittest/imp)', () => {
    it('[EN-SPEC-R8-2] pushes an explicit parentDir option as given without looking up the source video file', async () => {
        const push = vi.fn(async () => 77);
        const findId = vi.fn();
        const model = new EncodeApiModel({ push }, { findId }, {}, {});

        await expect(
            model.add({
                directory: 'sub/dir',
                mode: 'synthetic-mode',
                parentDir: 'synthetic-parent',
                recordedId: 11,
                removeOriginal: true,
                sourceVideoFileId: 21,
            }),
        ).resolves.toBe(77);

        expect(findId).not.toHaveBeenCalled();
        expect(push).toHaveBeenCalledExactlyOnceWith({
            directory: 'sub/dir',
            mode: 'synthetic-mode',
            parentDir: 'synthetic-parent',
            recordedId: 11,
            removeOriginal: true,
            sourceVideoFileId: 21,
        });
    });

    it('[EN-SPEC-R8-2] cancel passes the encode id to the encode manager', async () => {
        const cancel = vi.fn(async () => undefined);
        const model = new EncodeApiModel({ cancel }, {}, {}, {});

        await expect(model.cancel(33)).resolves.toBeUndefined();

        expect(cancel).toHaveBeenCalledExactlyOnceWith(33);
    });
});
