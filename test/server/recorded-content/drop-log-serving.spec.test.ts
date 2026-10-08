import 'reflect-metadata';

import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
const DropLogApiModel = load<new (...args: any[]) => any>('model/api/dropLog/DropLogApiModel.js');
const { DropLogApiErrors } = require(join(snapshot, 'model/api/dropLog/IDropLogApiModel.js')) as {
    DropLogApiErrors: { FILE_IS_TOO_LARGE: string };
};

const temporaryRoots: string[] = [];
const temporaryRoot = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-drop-log-serving-'));
    temporaryRoots.push(root);
    return root;
};

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { force: true, recursive: true })));
});

describe('drop log serving characterization', () => {
    it('[RC-2.3-DROPLOG] returns null for an unregistered drop log id without touching the filesystem', async () => {
        const dropLogFileDB = { findId: vi.fn(async () => null) };
        const api = new DropLogApiModel({ getConfig: () => ({ dropLog: '/unused' }) }, dropLogFileDB);

        await expect(api.getIdFilePath(901, 10)).resolves.toBeNull();
        expect(dropLogFileDB.findId).toHaveBeenCalledWith(901);
    });

    it('[RC-2.3-DROPLOG] resolves a registered drop log to the configured root joined with its relative path', async () => {
        const root = await temporaryRoot();
        const filePath = join(root, 'synthetic.log');
        await writeFile(filePath, 'x'.repeat(10));
        const dropLogFileDB = { findId: vi.fn(async () => ({ id: 902, filePath: 'synthetic.log' })) };
        const api = new DropLogApiModel({ getConfig: () => ({ dropLog: root }) }, dropLogFileDB);

        await expect(api.getIdFilePath(902, 1)).resolves.toBe(filePath);
    });

    it('[RC-2.3-DROPLOG] rejects a file whose real size exceeds the kilobyte maxSize budget', async () => {
        const root = await temporaryRoot();
        const filePath = join(root, 'oversize.log');
        await writeFile(filePath, Buffer.alloc(1025));
        const dropLogFileDB = { findId: vi.fn(async () => ({ id: 903, filePath: 'oversize.log' })) };
        const api = new DropLogApiModel({ getConfig: () => ({ dropLog: root }) }, dropLogFileDB);

        await expect(api.getIdFilePath(903, 1)).rejects.toThrow(DropLogApiErrors.FILE_IS_TOO_LARGE);
    });

    it('[RC-2.3-DROPLOG] allows a file whose real size is exactly the kilobyte maxSize boundary', async () => {
        const root = await temporaryRoot();
        const filePath = join(root, 'boundary.log');
        await writeFile(filePath, Buffer.alloc(1024));
        const dropLogFileDB = { findId: vi.fn(async () => ({ id: 904, filePath: 'boundary.log' })) };
        const api = new DropLogApiModel({ getConfig: () => ({ dropLog: root }) }, dropLogFileDB);

        await expect(api.getIdFilePath(904, 1)).resolves.toBe(filePath);
    });

    it('[RC-2.3-DROPLOG] composes the configured root with a nested relative path against a real subdirectory layout', async () => {
        const root = await temporaryRoot();
        await mkdir(join(root, 'nested', 'sub'), { recursive: true });
        const filePath = join(root, 'nested', 'sub', 'synthetic.log');
        await writeFile(filePath, 'nested-bytes');
        const dropLogFileDB = {
            findId: vi.fn(async () => ({ id: 905, filePath: join('nested', 'sub', 'synthetic.log') })),
        };
        const api = new DropLogApiModel({ getConfig: () => ({ dropLog: root }) }, dropLogFileDB);

        await expect(api.getIdFilePath(905, 1)).resolves.toBe(filePath);
    });
});
