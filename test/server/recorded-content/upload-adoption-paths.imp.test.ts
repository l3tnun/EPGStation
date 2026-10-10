import 'reflect-metadata';

import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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

let root: string;
beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'epgstation-upload-adoption-paths-'));
});
afterEach(async () => {
    await rm(root, { force: true, recursive: true });
});

const prepare = async (): Promise<InstanceType<typeof RecordedUploadAdoptionModel>> => {
    await mkdir(join(root, 'incoming', 'synthetic-token'), { recursive: true });
    await writeFile(join(root, 'incoming', 'synthetic-token', 'payload'), 'x');
    await writeFile(join(root, 'incoming', 'payload'), 'x');
    await writeFile(join(root, 'payload'), 'x');
    await writeFile(join(root, 'incoming', 'synthetic-token', 'other'), 'x');
    const model = new RecordedUploadAdoptionModel(root);
    await model.initialize();
    return model;
};

describe('[RC-10.2] upload adoption accepts only the exact incoming payload path', () => {
    it('adopts the relative form incoming/<token>/payload and the absolute form of the same file', async () => {
        const model = await prepare();

        await expect(model.adopt('incoming/synthetic-token/payload')).resolves.toBe(
            join(root, 'adopted', 'synthetic-token', 'payload'),
        );
        await mkdir(join(root, 'incoming', 'second-token'));
        await writeFile(join(root, 'incoming', 'second-token', 'payload'), 'x');
        await expect(model.adopt(join(root, 'incoming', 'second-token', 'payload'))).resolves.toBe(
            join(root, 'adopted', 'second-token', 'payload'),
        );
    });

    it.each([
        ['a prefix before incoming', 'elsewhere/incoming/synthetic-token/payload'],
        ['a suffix after payload', 'incoming/synthetic-token/payload/extra'],
        ['a dot token', 'incoming/./payload'],
        ['a dot-dot token', 'incoming/../payload'],
        ['an empty token', 'incoming//payload'],
    ])('rejects a relative path with %s and leaves the files in place', async (_label, filePath) => {
        const model = await prepare();

        await expect(model.adopt(filePath)).rejects.toThrow('UploadPathError');

        expect(await readdir(join(root, 'adopted'))).toEqual([]);
        expect(await readdir(join(root, 'incoming', 'synthetic-token'))).toEqual(['other', 'payload']);
        await expect(stat(join(root, 'payload'))).resolves.toBeDefined();
        await expect(stat(join(root, 'incoming', 'payload'))).resolves.toBeDefined();
    });

    it.each([
        ['a token that climbs out of incoming', (r: string) => join(r, 'payload')],
        ['a file name other than payload', (r: string) => join(r, 'incoming', 'synthetic-token', 'other')],
        ['a payload directly under incoming', (r: string) => join(r, 'incoming', 'payload')],
        ['a path that is not normalized', (r: string) => `${r}/incoming/./synthetic-token/payload`],
        ['a path with a doubled separator', (r: string) => `${r}/incoming/synthetic-token//payload`],
        ['a path with a deeper component', (r: string) => join(r, 'incoming', 'synthetic-token', 'payload', 'extra')],
    ])('rejects an absolute path with %s and leaves the files in place', async (_label, build) => {
        const model = await prepare();

        await expect(model.adopt(build(root))).rejects.toThrow('UploadPathError');

        expect(await readdir(join(root, 'adopted'))).toEqual([]);
        expect(await readdir(join(root, 'incoming', 'synthetic-token'))).toEqual(['other', 'payload']);
        await expect(stat(join(root, 'payload'))).resolves.toBeDefined();
    });

    it('rejects a payload that is reached through a symbolic link to the incoming directory', async () => {
        await mkdir(join(root, 'real', 'synthetic-token'), { recursive: true });
        await writeFile(join(root, 'real', 'synthetic-token', 'payload'), 'x');
        await symlink(join(root, 'real'), join(root, 'incoming'));
        const model = new RecordedUploadAdoptionModel(root);
        await model.initialize();

        await expect(model.adopt('incoming/synthetic-token/payload')).rejects.toThrow('UploadPathError');

        expect(await readdir(join(root, 'adopted'))).toEqual([]);
        expect(await readdir(join(root, 'real', 'synthetic-token'))).toEqual(['payload']);
    });
});

describe('[RC-10.2] upload adoption initialization removes leftovers under adopted', () => {
    it('removes token directories, empty directories, plain files and symbolic links but not the link target', async () => {
        await mkdir(join(root, 'adopted', 'half-moved'), { recursive: true });
        await writeFile(join(root, 'adopted', 'half-moved', 'payload'), 'x');
        await mkdir(join(root, 'adopted', 'empty-token'));
        await writeFile(join(root, 'adopted', 'plain-file'), 'x');
        await mkdir(join(root, 'elsewhere'));
        await writeFile(join(root, 'elsewhere', 'payload'), 'x');
        await symlink(join(root, 'elsewhere'), join(root, 'adopted', 'link-token'));
        const model = new RecordedUploadAdoptionModel(root);

        await model.initialize();

        expect(await readdir(join(root, 'adopted'))).toEqual([]);
        expect(await readdir(join(root, 'elsewhere'))).toEqual(['payload']);
    });
});
