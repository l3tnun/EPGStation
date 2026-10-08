import 'reflect-metadata';

import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RecordedUploadAdoptionModel = (
    require(join(snapshot, 'model/operator/recorded/RecordedUploadAdoptionModel.js')) as {
        default: new (uploadRoot: string) => { adopt(filePath: string): Promise<string>; initialize(): Promise<void> };
    }
).default;
const fsPromises = require('node:fs/promises') as Record<string, unknown>;

// ESMのnamed importへ反映させるため、builtinの関数を差し替えて同期する。
const replaceFsFunction = (name: string, replacement: unknown): (() => void) => {
    const original = fsPromises[name];
    fsPromises[name] = replacement;
    syncBuiltinESMExports();
    return () => {
        fsPromises[name] = original;
        syncBuiltinESMExports();
    };
};

let root: string;
beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'epgstation-upload-adoption-'));
});
afterEach(async () => {
    await rm(root, { force: true, recursive: true });
});

describe('[RC-10.2] upload adoption path and directory checks', () => {
    it('rejects an incoming path whose token directory does not exist and leaves adopted untouched', async () => {
        const model = new RecordedUploadAdoptionModel(root);
        await model.initialize();

        await expect(model.adopt('incoming/synthetic-token/payload')).rejects.toThrow('UploadPathError');

        expect(await readdir(join(root, 'adopted'))).toEqual([]);
    });

    it('rejects initialization when the adopted root exists but is not a directory', async () => {
        await writeFile(join(root, 'adopted'), 'synthetic');
        const model = new RecordedUploadAdoptionModel(root);

        await expect(model.initialize()).rejects.toThrow('UploadPathError');
    });

    it('rejects initialization when the adopted root is a symbolic link', async () => {
        await mkdir(join(root, 'elsewhere'));
        await symlink(join(root, 'elsewhere'), join(root, 'adopted'));
        const model = new RecordedUploadAdoptionModel(root);

        await expect(model.initialize()).rejects.toThrow('UploadPathError');
    });

    it('propagates a directory creation failure other than already-exists and creates nothing', async () => {
        await mkdir(join(root, 'incoming', 'synthetic-token'), { recursive: true });
        await writeFile(join(root, 'incoming', 'synthetic-token', 'payload'), 'x');
        const failure = Object.assign(new Error('synthetic-denied'), { code: 'EACCES' });
        const original = fsPromises.mkdir as (...args: unknown[]) => Promise<unknown>;
        const restore = replaceFsFunction('mkdir', async (path: string, ...rest: unknown[]) => {
            if (path.endsWith('adopted')) {
                throw failure;
            }
            return original(path, ...rest);
        });
        try {
            const model = new RecordedUploadAdoptionModel(root);

            await expect(model.adopt('incoming/synthetic-token/payload')).rejects.toBe(failure);
        } finally {
            restore();
        }

        await expect(stat(join(root, 'adopted'))).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await readdir(join(root, 'incoming', 'synthetic-token'))).toEqual(['payload']);
    });
});
