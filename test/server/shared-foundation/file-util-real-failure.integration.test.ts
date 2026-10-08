import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/*
 * FileUtil.move の失敗を、spy で注入せず実 file system 上の失敗で確かめる。
 * 失敗しても移動元は残り、移動先に壊れた file を残さない。
 */

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required to resolve server foundation evidence');
}

interface FileUtilModule {
    move: (src: string, dest: string) => Promise<void>;
}

const loadFileUtil = async (): Promise<FileUtilModule> => {
    const moduleUrl = pathToFileURL(join(compiledSnapshot, 'util', 'FileUtil.js'));
    return ((await import(moduleUrl.href)) as { default: FileUtilModule }).default;
};

describe('FileUtil.move with real file system failures', () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'shared-foundation-file-util-move-'));
    });

    afterEach(async () => {
        await rm(root, { force: true, recursive: true });
    });

    it('[SF-4.3] keeps the source and creates no destination when the destination directory does not exist', async () => {
        const FileUtil = await loadFileUtil();
        const src = join(root, 'source.ts');
        const dest = join(root, 'missing-directory', 'dest.ts');
        await writeFile(src, 'recorded-content');

        await expect(FileUtil.move(src, dest)).rejects.toMatchObject({ code: 'ENOENT' });

        await expect(readFile(src, 'utf8')).resolves.toBe('recorded-content');
        expect(existsSync(join(root, 'missing-directory'))).toBe(false);
    });

    it('[SF-4.3] keeps the source and leaves an existing directory at the destination untouched', async () => {
        const FileUtil = await loadFileUtil();
        const src = join(root, 'source.ts');
        const dest = join(root, 'dest-directory');
        await writeFile(src, 'recorded-content');
        await mkdir(dest);

        await expect(FileUtil.move(src, dest)).rejects.toBeInstanceOf(Error);

        await expect(readFile(src, 'utf8')).resolves.toBe('recorded-content');
        expect((await stat(dest)).isDirectory()).toBe(true);
    });
});
