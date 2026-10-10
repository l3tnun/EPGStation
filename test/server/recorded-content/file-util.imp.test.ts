import 'reflect-metadata';

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const FileUtil = (
    require(join(snapshot, 'util/FileUtil.js')) as {
        default: {
            getFileSize(filePath: string): Promise<number>;
            getFileList(dir: string): Promise<{ files: string[]; directories: string[] }>;
            isEmptyDirectory(dir: string): Promise<boolean>;
        };
    }
).default;

let root: string;
beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'epgstation-file-util-'));
});
afterEach(async () => {
    await rm(root, { force: true, recursive: true });
});

describe('[RC-9.13] file helper implementation', () => {
    it('reports the size of an existing file and keeps the original error as the cause when it is missing', async () => {
        await writeFile(join(root, 'sized.bin'), 'abcde');

        await expect(FileUtil.getFileSize(join(root, 'sized.bin'))).resolves.toBe(5);
        const failure = await FileUtil.getFileSize(join(root, 'missing.bin')).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toBe('FileIsNotFound');
        expect(((failure as Error).cause as NodeJS.ErrnoException).code).toBe('ENOENT');
    });

    it('lists files and every nested directory, innermost first, and skips dot entries', async () => {
        await mkdir(join(root, 'a', 'b', 'c'), { recursive: true });
        await writeFile(join(root, 'top.txt'), 'x');
        await writeFile(join(root, 'a', 'mid.txt'), 'x');
        await writeFile(join(root, 'a', 'b', 'c', 'deep.txt'), 'x');
        await writeFile(join(root, '.hidden'), 'x');

        const list = await FileUtil.getFileList(root);

        expect([...list.files].sort()).toEqual(
            [join(root, 'top.txt'), join(root, 'a', 'mid.txt'), join(root, 'a', 'b', 'c', 'deep.txt')].sort(),
        );
        expect(list.directories).toEqual([join(root, 'a', 'b', 'c'), join(root, 'a', 'b'), join(root, 'a')]);
    });

    it('tells an empty directory from one that has an entry', async () => {
        await mkdir(join(root, 'empty'));
        await mkdir(join(root, 'filled'));
        await writeFile(join(root, 'filled', 'entry.txt'), 'x');

        await expect(FileUtil.isEmptyDirectory(join(root, 'empty'))).resolves.toBe(true);
        await expect(FileUtil.isEmptyDirectory(join(root, 'filled'))).resolves.toBe(false);
    });
});
