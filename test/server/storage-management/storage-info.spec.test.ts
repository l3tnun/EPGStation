import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

interface DiskUsage {
    readonly available: number;
    readonly total: number;
    readonly used: number;
}

interface StorageInformationRuntime {
    getDiskInfo(path: string): Promise<DiskUsage>;
    getInfo(): Promise<{ items: Array<DiskUsage & { name: string }> }>;
}

interface StorageInformationConstructor {
    new (configuration: { getConfig(): Record<string, unknown> }): StorageInformationRuntime;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}
const StorageApiModel = (
    require(join(compiledSnapshot, 'model', 'api', 'storage', 'StorageApiModel.js')) as {
        default: StorageInformationConstructor;
    }
).default;

const createModel = (
    entries: ReadonlyArray<Record<string, unknown>>,
    read: (path: string) => Promise<DiskUsage>,
): StorageInformationRuntime => {
    const model = new StorageApiModel({ getConfig: () => ({ recorded: entries }) });
    model.getDiskInfo = read;
    return model;
};

describe('storage information characterization', () => {
    it('[SM-1.1][SM-1.3] reads every configured entry in order regardless of monitoring settings', async () => {
        const entries = [
            { name: 'plain', path: 'synthetic-storage/plain' },
            { action: 'none', limitThreshold: 0, name: 'limited', path: 'synthetic-storage/limited' },
            {
                action: 'remove',
                limitCmd: 'synthetic-command-marker',
                limitThreshold: 1,
                name: 'managed',
                path: 'synthetic-storage/managed',
            },
        ];
        const reads: string[] = [];
        const model = createModel(entries, async path => {
            reads.push(path);
            const index = reads.length;
            return { available: index, total: index * 10, used: index * 9 };
        });

        const result = await model.getInfo();

        expect(reads).toEqual(entries.map(entry => entry.path));
        expect(result.items.map(item => item.name)).toEqual(['plain', 'limited', 'managed']);
    });

    it('[SM-1.2][SM-1.6] projects only name and exact unconverted byte values', async () => {
        const model = createModel([{ name: 'byte-entry', path: 'synthetic-storage/bytes' }], async () => ({
            available: 9_007_199_254_740_000,
            total: 9_007_199_254_740_002,
            used: 2,
        }));

        const result = await model.getInfo();

        expect(result).toEqual({
            items: [
                {
                    available: 9_007_199_254_740_000,
                    name: 'byte-entry',
                    total: 9_007_199_254_740_002,
                    used: 2,
                },
            ],
        });
        expect(Object.keys(result.items[0]).sort()).toEqual(['available', 'name', 'total', 'used']);
    });

    it('[SM-1.4] preserves duplicate paths as separate configured items', async () => {
        const usage = { available: 512, total: 2_048, used: 1_536 };
        const read = vi.fn(async () => ({ ...usage }));
        const model = createModel(
            [
                { name: 'duplicate-a', path: 'synthetic-storage/shared' },
                { name: 'duplicate-b', path: 'synthetic-storage/shared' },
            ],
            read,
        );

        await expect(model.getInfo()).resolves.toEqual({
            items: [
                { ...usage, name: 'duplicate-a' },
                { ...usage, name: 'duplicate-b' },
            ],
        });
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('[SM-1.5] rejects the entire query on one read failure without returning partial items', async () => {
        const failure = new Error('synthetic capacity failure');
        const read = vi
            .fn<(path: string) => Promise<DiskUsage>>()
            .mockResolvedValueOnce({ available: 1, total: 3, used: 2 })
            .mockRejectedValueOnce(failure)
            .mockResolvedValueOnce({ available: 4, total: 9, used: 5 });
        const model = createModel(
            [
                { name: 'before', path: 'synthetic-storage/before' },
                { name: 'failure', path: 'synthetic-storage/failure' },
                { name: 'after', path: 'synthetic-storage/after' },
            ],
            read,
        );

        await expect(model.getInfo()).rejects.toBe(failure);
        expect(read.mock.calls.map(([path]) => path)).toEqual([
            'synthetic-storage/before',
            'synthetic-storage/failure',
        ]);
    });
});
