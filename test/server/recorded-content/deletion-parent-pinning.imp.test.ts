import 'reflect-metadata';

import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RecordedManageModel = (
    require(join(snapshot, 'model/operator/recorded/RecordedManageModel.js')) as {
        default: { prototype: Record<string, unknown> };
    }
).default;

let root: string;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'epgstation-deletion-parent-')));
    await mkdir(join(root, 'a', 'b'), { recursive: true });
});

afterEach(async () => {
    await rm(root, { force: true, recursive: true });
});

describe('[RC-10.2] deletion parent directory pinning on the default file system', () => {
    it('returns the root itself pinned when the target sits directly under the root', async () => {
        const target: any = Object.create(RecordedManageModel.prototype);

        const parent = await target.openPinnedDeletionParent(root, '.');

        expect(parent.logicalPath).toBe(root);
        await expect(parent.close()).resolves.toBeUndefined();
    });

    it('walks every nested segment, keeps only the deepest directory open, and reports its logical path', async () => {
        const target: any = Object.create(RecordedManageModel.prototype);

        const parent = await target.openPinnedDeletionParent(root, join('a', 'b'));

        expect(parent.logicalPath).toBe(join(root, 'a', 'b'));
        await expect(parent.close()).resolves.toBeUndefined();
    });

    it('rejects a missing nested segment as a path error', async () => {
        const target: any = Object.create(RecordedManageModel.prototype);

        await expect(target.openPinnedDeletionParent(root, join('a', 'missing'))).rejects.toThrow('UploadPathError');
    });
});
