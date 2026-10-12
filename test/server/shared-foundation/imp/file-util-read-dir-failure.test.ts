import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required to resolve server foundation evidence');
}

const { default: FileUtil } = (await import(pathToFileURL(join(compiledSnapshot, 'util', 'FileUtil.js')).href)) as {
    default: { readDir: (dirPath: string) => Promise<string[]> };
};

describe('FileUtil.readDir failure', () => {
    it('[SF-4.2] rejects with the underlying filesystem error when the directory does not exist', async () => {
        const missingDirectory = join(process.cwd(), 'test', 'server', '.artifacts', 'file-util-read-dir-missing');

        await expect(FileUtil.readDir(missingDirectory)).rejects.toMatchObject({
            code: 'ENOENT',
            path: missingDirectory,
        });
    });
});
