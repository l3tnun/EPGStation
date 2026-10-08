import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type * as apid from '../../../api';

interface EncodeApiRuntime {
    add(addOption: apid.AddManualEncodeProgramOption): Promise<apid.EncodeId>;
}

interface EncodeApiConstructor {
    new (...dependencies: unknown[]): EncodeApiRuntime;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const EncodeApiModel = (
    require(join(compiledSnapshot, 'model', 'api', 'encode', 'EncodeApiModel.js')) as {
        default: EncodeApiConstructor;
    }
).default;

const baseOption = (): apid.AddManualEncodeProgramOption => ({
    mode: 'synthetic-mode',
    recordedId: 101,
    removeOriginal: false,
    sourceVideoFileId: 202,
});

describe('EncodeApiModel manual add() failure boundary', () => {
    it('[EN-SPEC-API-ADD-OPTION-ERROR] rejects with OptionError before any port call when parentDir and isSaveSameDirectory are both absent', async () => {
        const push = vi.fn();
        const findId = vi.fn();
        const api = new EncodeApiModel({ push }, { findId }, {}, {});

        await expect(api.add(baseOption())).rejects.toThrow('OptionError');
        expect(findId).not.toHaveBeenCalled();
        expect(push).not.toHaveBeenCalled();
    });

    it.each([
        ['relative ..', '../outside'],
        ['.. after a leading separator', '/../outside'],
        ['.. that leaves after descending', 'a/../../outside'],
        ['a NUL character', 'synthetic\0directory'],
    ])(
        '[EN-SPEC-API-ADD-DIRECTORY-OUTSIDE] rejects with InvalidSubDirectory before any port call when the explicit directory has %s',
        async (_case, directory) => {
            const push = vi.fn();
            const findId = vi.fn();
            const api = new EncodeApiModel({ push }, { findId }, {}, {});

            await expect(api.add({ ...baseOption(), directory, parentDir: 'synthetic-parent' })).rejects.toThrow(
                'InvalidSubDirectory',
            );
            expect(findId).not.toHaveBeenCalled();
            expect(push).not.toHaveBeenCalled();
        },
    );

    it.each(['a/../b', '/anime', 'a/b'])(
        '[EN-SPEC-API-ADD-DIRECTORY-INSIDE] keeps pushing the explicit directory %s, which stays inside the recording directory',
        async directory => {
            const push = vi.fn(async () => 5);
            const api = new EncodeApiModel({ push }, { findId: vi.fn() }, {}, {});

            await expect(api.add({ ...baseOption(), directory, parentDir: 'synthetic-parent' })).resolves.toBe(5);
            expect(push).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ directory }));
        },
    );

    it('[EN-SPEC-API-ADD-DIRECTORY-IGNORED] does not check the directory of a same-directory request, which is derived from the source video', async () => {
        const push = vi.fn(async () => 6);
        const findId = vi.fn(async () => ({ filePath: 'a/b/video.ts', parentDirectoryName: 'synthetic-parent' }));
        const api = new EncodeApiModel({ push }, { findId }, {}, {});

        await expect(api.add({ ...baseOption(), directory: '../outside', isSaveSameDirectory: true })).resolves.toBe(6);
        expect(push).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ directory: 'a/b', parentDir: 'synthetic-parent' }),
        );
    });

    it('[EN-SPEC-API-ADD-VIDEO-NOT-FOUND] rejects with VideoFileIsNotFound after an unresolved source video lookup', async () => {
        const push = vi.fn();
        const findId = vi.fn(async () => null);
        const api = new EncodeApiModel({ push }, { findId }, {}, {});

        await expect(api.add({ ...baseOption(), isSaveSameDirectory: true })).rejects.toThrow('VideoFileIsNotFound');
        expect(findId).toHaveBeenCalledExactlyOnceWith(202);
        expect(push).not.toHaveBeenCalled();
    });

    it('[EN-SPEC-API-ADD-VIDEO-DIRECTORY] derives parentDir and directory from the resolved source video before pushing', async () => {
        const push = vi.fn(async () => 55);
        const findId = vi.fn(async () => ({
            filePath: 'synthetic-root/nested/video.ts',
            parentDirectoryName: 'synthetic-parent',
        }));
        const api = new EncodeApiModel({ push }, { findId }, {}, {});

        await expect(api.add({ ...baseOption(), isSaveSameDirectory: true, removeOriginal: true })).resolves.toBe(
            55,
        );
        expect(push).toHaveBeenCalledExactlyOnceWith({
            directory: 'synthetic-root/nested',
            mode: 'synthetic-mode',
            parentDir: 'synthetic-parent',
            recordedId: 101,
            removeOriginal: true,
            sourceVideoFileId: 202,
        });
    });
});
