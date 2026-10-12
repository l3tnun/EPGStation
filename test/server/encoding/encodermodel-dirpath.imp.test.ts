import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const EncoderModel = (
    require(join(snapshot, 'model', 'service', 'encode', 'EncoderModel.js')) as {
        default: new (...args: unknown[]) => any;
    }
).default;

const parentDirectory = 'synthetic-parent-root';

const rooted = (relative: string): string => `/${relative}`;

const makeQueueItem = (directory: string): { directory?: string; parentDir: string; recordedId: number } => ({
    directory,
    parentDir: 'synthetic-parent',
    recordedId: 4,
});

const makeSubject = (recorded: unknown) => {
    const error = vi.fn();
    const warn = vi.fn();
    const findId = vi.fn(async () => recorded);
    const formatFilePathString = vi.fn(async (directory: string) => `formatted-${directory}`);
    const model = new EncoderModel(
        { getLogger: () => ({ encode: { error, info: vi.fn(), warn } }) },
        { getConfig: () => ({}) },
        {},
        {},
        {},
        { findId },
        {},
        { getParentDirPath: vi.fn(() => parentDirectory) },
        {},
        { formatFilePathString },
    );
    return { error, findId, formatFilePathString, model, warn };
};

/**
 * EncoderModel の出力先 directory の決定と、実行中の encodeId の取得。
 * 保存先の相対 directory に録画情報の書式があれば、録画情報で展開してから親 directory へ結ぶ。
 */
describe('EncoderModel output directory and encode id (unittest/imp)', () => {
    it('[EN-SPEC-R8-2] formats a relative directory with the recorded program and joins it to the parent directory', async () => {
        const recorded = { id: 4, name: 'synthetic-recorded' };
        const { findId, formatFilePathString, model } = makeSubject(recorded);
        const queueItem = { directory: '%YEAR%', parentDir: 'synthetic-parent', recordedId: 4 };

        const directory = await model.getDirPath(queueItem);

        expect(findId).toHaveBeenCalledExactlyOnceWith(4);
        expect(formatFilePathString).toHaveBeenCalledExactlyOnceWith('%YEAR%', recorded);
        expect(queueItem.directory).toBe('formatted-%YEAR%');
        expect(directory).toBe(join(parentDirectory, 'formatted-%YEAR%'));
    });

    it('[EN-SPEC-R8-2] keeps the directory unformatted when the recorded program no longer exists', async () => {
        const { formatFilePathString, model } = makeSubject(null);
        const queueItem = { directory: 'raw/dir', parentDir: 'synthetic-parent', recordedId: 4 };

        const directory = await model.getDirPath(queueItem);

        expect(formatFilePathString).not.toHaveBeenCalled();
        expect(queueItem.directory).toBe('raw/dir');
        expect(directory).toBe(join(parentDirectory, 'raw/dir'));
    });

    it('[EN-SPEC-R8-2] does not look up the recorded program for an empty directory', async () => {
        const { findId, model } = makeSubject({ id: 4 });

        const directory = await model.getDirPath({ directory: '', parentDir: 'synthetic-parent', recordedId: 4 });

        expect(findId).not.toHaveBeenCalled();
        expect(directory).toBe(parentDirectory);
    });

    it.each([
        ['relative ..', '../outside', '../outside'],
        ['.. after a leading separator', rooted('../outside'), rooted('../outside')],
        ['.. that leaves after descending', 'a/../../outside', 'a/../../outside'],
        ['a NUL character', 'synthetic\0directory', 'synthetic\0directory'],
        ['a recorded value that expands to ..', '%TITLE%', '../outside'],
    ])(
        '[EN-SPEC-R3-1] outputs directly under the parent directory and logs it when the directory has %s',
        async (_case, registered, expanded) => {
            const { formatFilePathString, model, warn } = makeSubject({ id: 4 });
            formatFilePathString.mockImplementation(async () => expanded);
            const queueItem = makeQueueItem(registered);

            const directory = await model.getDirPath(queueItem);

            expect(directory).toBe(parentDirectory);
            expect(queueItem.directory).toBeUndefined();
            expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('recordedId: 4'));
        },
    );

    it('[EN-SPEC-R3-1] also checks a directory that was not formatted because the recorded program is gone', async () => {
        const { model, warn } = makeSubject(null);
        const queueItem = makeQueueItem('../outside');

        await expect(model.getDirPath(queueItem)).resolves.toBe(parentDirectory);
        expect(queueItem.directory).toBeUndefined();
        expect(warn).toHaveBeenCalledOnce();
    });

    it.each(['a/../b', rooted('anime'), 'a/b'])(
        '[EN-SPEC-R3-1] keeps using %s, which stays inside the parent directory',
        async registered => {
            const { model, warn } = makeSubject(null);
            const queueItem = makeQueueItem(registered);

            await expect(model.getDirPath(queueItem)).resolves.toBe(join(parentDirectory, registered));
            expect(queueItem.directory).toBe(registered);
            expect(warn).not.toHaveBeenCalled();
        },
    );

    it('[EN-SPEC-R8-2] getEncodeId is null before an encode is assigned and the assigned id afterwards', () => {
        const { model } = makeSubject(null);

        expect(model.getEncodeId()).toBeNull();
        model.encodeOption = { encodeId: 12 };
        expect(model.getEncodeId()).toBe(12);
    });
});
