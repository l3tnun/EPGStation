import 'reflect-metadata';

import { mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createStorageManager } from './_storage-harness';

interface DiskUsage {
    readonly available: number;
    readonly total: number;
    readonly used: number;
}

interface StorageInformationRuntime {
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

const findMountPoint = async (path: string): Promise<string> => {
    let candidate = path;
    for (;;) {
        const parent = dirname(candidate);
        if (parent === candidate) {
            return candidate;
        }

        const [candidateStats, parentStats] = await Promise.all([stat(candidate), stat(parent)]);
        if (candidateStats.dev !== parentStats.dev) {
            return candidate;
        }
        candidate = parent;
    }
};

const expectObservedCapacity = (items: ReadonlyArray<DiskUsage & { name: string }>): void => {
    for (const item of items) {
        expect([item.available, item.total, item.used].every(value => Number.isFinite(value) && value >= 0)).toBe(true);
    }
};

describe('storage filesystem integration: capacity and configured entry identity', () => {
    it('[STORAGE-T7.6-FILESYSTEM] connects temporary configured paths to the capacity adapter without coalescing aliases', async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-storage-filesystem-'));
        const symbolicPath = join(temporaryRoot, 'symlink');
        try {
            await symlink(temporaryRoot, symbolicPath, 'dir');
            const mountPoint = await findMountPoint(temporaryRoot);
            const model = new StorageApiModel({
                getConfig: () => ({
                    recorded: [
                        { name: 'direct-first', path: temporaryRoot },
                        { name: 'direct-second', path: temporaryRoot },
                        { name: 'symlink', path: symbolicPath },
                        { name: 'mount-point', path: mountPoint },
                    ],
                }),
            });

            const firstRead = await model.getInfo();
            const secondRead = await model.getInfo();

            expect(firstRead.items.map(item => item.name)).toEqual([
                'direct-first',
                'direct-second',
                'symlink',
                'mount-point',
            ]);
            expect(secondRead.items.map(item => item.name)).toEqual(firstRead.items.map(item => item.name));
            expectObservedCapacity(firstRead.items);
            expectObservedCapacity(secondRead.items);
        } finally {
            await rm(temporaryRoot, { force: true, recursive: true });
        }
    });

    it('[STORAGE-T7.6-FILESYSTEM] re-reads the same temporary monitoring path through the Storage owner without asserting a file effect', async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-storage-filesystem-'));
        try {
            const entry = {
                action: 'remove' as const,
                limitThreshold: Number.MAX_SAFE_INTEGER,
                name: 'temporary-monitor',
                path: temporaryRoot,
            };
            const { manager } = createStorageManager({
                deleteForStoragePressure: async () => 'deleted',
                entries: [entry],
                findOld: async () => ({ id: 1 }),
            });
            const readPaths: string[] = [];
            const readAdapter = manager.getFreeSize.bind(manager);
            manager.getFreeSize = async path => {
                readPaths.push(path);
                return readAdapter(path);
            };

            await manager.check([entry]);

            expect(readPaths).toEqual([temporaryRoot, temporaryRoot]);
        } finally {
            await rm(temporaryRoot, { force: true, recursive: true });
        }
    });

    it('[STORAGE-T7.6-FILESYSTEM] propagates a temporary monitoring-path read error without a partial capacity result', async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-storage-filesystem-'));
        try {
            const model = new StorageApiModel({
                getConfig: () => ({
                    recorded: [
                        { name: 'before-error', path: temporaryRoot },
                        { name: 'missing', path: join(temporaryRoot, 'missing') },
                    ],
                }),
            });

            await expect(model.getInfo()).rejects.toBeInstanceOf(Error);
        } finally {
            await rm(temporaryRoot, { force: true, recursive: true });
        }
    });
});
