import 'reflect-metadata';

import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;

/*
 * `diskusage-ng` は compiled の StorageApiModel.js が静的 import するため、
 * `vi.doMock` + `vi.resetModules` + 動的 `import()` で束縛を差し替える。
 */
const diskusageDispatch = vi.fn<(path: string, callback: (error: Error | null, usage?: unknown) => void) => void>();

let StorageApiModel: new (...args: unknown[]) => { getInfo(): Promise<{ items: unknown[] }> };

beforeAll(async () => {
    vi.doMock('diskusage-ng', () => ({
        default: (path: string, callback: (error: Error | null, usage?: unknown) => void) =>
            diskusageDispatch(path, callback),
    }));
    try {
        vi.resetModules();
        StorageApiModel = ((await import(join(snapshot, 'model', 'api', 'storage', 'StorageApiModel.js'))) as any)
            .default;
    } finally {
        vi.doUnmock('diskusage-ng');
    }
});

const makeModel = () =>
    new StorageApiModel({
        getConfig: () => ({
            recorded: [
                { name: 'first', path: 'synthetic-first-dir' },
                { name: 'second', path: 'synthetic-second-dir' },
            ],
        }),
    });

/**
 * StorageApiModel.getInfo が、設定された録画先ごとにディスク使用量を問い合わせて名前付きで返し、
 * 問い合わせが失敗したらその失敗で終える。
 */
describe('StorageApiModel.getInfo disk usage (unittest/imp)', () => {
    it('[SM-6.2] returns each recorded directory with its name and the reported usage', async () => {
        diskusageDispatch.mockImplementation((path, callback) => {
            callback(null, { available: path.includes('first') ? 10 : 20, total: 100, used: 90, extra: 'ignored' });
        });

        await expect(makeModel().getInfo()).resolves.toEqual({
            items: [
                { available: 10, name: 'first', total: 100, used: 90 },
                { available: 20, name: 'second', total: 100, used: 90 },
            ],
        });
        expect(diskusageDispatch.mock.calls.map(call => call[0])).toEqual([
            'synthetic-first-dir',
            'synthetic-second-dir',
        ]);
    });

    it('[SM-6.2] rejects with the disk usage failure and stops asking further directories', async () => {
        diskusageDispatch.mockReset();
        const failure = new Error('synthetic disk usage failure');
        diskusageDispatch.mockImplementation((_path, callback) => callback(failure));

        await expect(makeModel().getInfo()).rejects.toBe(failure);

        expect(diskusageDispatch).toHaveBeenCalledOnce();
    });
});
