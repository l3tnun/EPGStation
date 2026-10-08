import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { cleanupHarness, logger, restoreSpawn, ThumbnailManageModel } from './_thumbnail-harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');
const Configuration = (require(join(snapshot, 'model', 'Configuration.js')) as { default: any }).default;

afterEach(cleanupHarness);
afterAll(restoreSpawn);

const instantiate = (
    source: Record<string, unknown>,
    queue: { add: ReturnType<typeof vi.fn> } | undefined = undefined,
    getConfig = vi.fn(() => source),
) => {
    const jobs: Array<() => Promise<void>> = [];
    const model = new ThumbnailManageModel(
        { getLogger: logger },
        { getConfig },
        queue ?? { add: vi.fn((job: () => Promise<void>) => jobs.push(job)) },
        { findAll: vi.fn() },
        { findId: vi.fn() },
        { deleteOnce: vi.fn(), findAll: vi.fn(), findId: vi.fn(), insertOnce: vi.fn() },
        { emitAdded: vi.fn(), emitDeleted: vi.fn() },
        { getFullFilePathFromId: vi.fn() },
    );
    model.create = vi.fn(async () => undefined);
    return { getConfig, jobs, model };
};

describe('null-empty-zero-one-min-max-out-of-range-invalid-and-duplicate thumbnail admission limit implementation', () => {
    it.each([
        [null, 'null'],
        ['', 'empty'],
        [0, 'zero'],
        [-1, 'negative'],
        [10_001, 'above maximum'],
        [1.5, 'fraction'],
        ['1', 'string'],
        [Number.NaN, 'NaN'],
        [Number.POSITIVE_INFINITY, 'infinity'],
    ])('[TM-IMP-ADMISSION-CONFIG] rejects %s through the Configuration carrier', (thumbnailMaxPending, _label) => {
        const source = {
            ...structuredClone(Configuration.DEFAULT_VALUE),
            apiServers: [],
            port: 8_888,
            recorded: [],
            thumbnail: 'synthetic-thumbnail-root',
            thumbnailMaxPending,
        };

        const configuration = Object.create(Configuration.prototype);
        configuration.templateConfig = null;
        expect(() => configuration.formatConfig(source)).toThrow('ConfigValueError:thumbnailMaxPending');
    });

    it('[TM-IMP-ADMISSION-SNAPSHOT] reads configuration once and keeps the instance snapshot', () => {
        const source = { thumbnailMaxPending: 1 };
        const current = instantiate(source);
        expect(current.getConfig).toHaveBeenCalledOnce();
        expect(current.model.thumbnailMaxPending).toBe(1);

        source.thumbnailMaxPending = 10_000;
        current.model.add(1);
        expect(() => current.model.add(2)).toThrow('ThumbnailQueueIsFull');
        expect(current.model.thumbnailMaxPending).toBe(1);
        expect(instantiate(source).model.thumbnailMaxPending).toBe(10_000);
    });

    it.each([1, 10_000])('[TM-IMP-ADMISSION-BOUNDARY] accepts exactly %i waiting requests', limit => {
        const fixture = instantiate({ thumbnailMaxPending: limit });
        for (let id = 1; id <= limit; id++) fixture.model.add(id);

        expect(fixture.jobs).toHaveLength(limit);
        expect(fixture.model.pendingThumbnailCount).toBe(limit);
        expect(() => fixture.model.add(limit + 1)).toThrow('ThumbnailQueueIsFull');
        expect(fixture.jobs).toHaveLength(limit);
    });

    it('[TM-IMP-ADMISSION-RELEASE] releases one waiting count when each accepted job starts or fails', async () => {
        const fixture = instantiate({ thumbnailMaxPending: 2 });
        fixture.model.create.mockRejectedValueOnce(new Error('synthetic-generation-failure'));
        fixture.model.add(71);
        fixture.model.add(72);
        const first = fixture.jobs.shift();
        const second = fixture.jobs.shift();
        expect(first).toBeDefined();
        expect(second).toBeDefined();

        await expect(first!()).resolves.toBeUndefined();
        expect(fixture.model.pendingThumbnailCount).toBe(1);
        await expect(second!()).resolves.toBeUndefined();
        expect(fixture.model.pendingThumbnailCount).toBe(0);
        expect(fixture.model.create).toHaveBeenCalledTimes(2);
    });

    it('[TM-IMP-ADMISSION-REGISTER-THROW] releases a failed registration and admits the next request', () => {
        const failure = new Error('synthetic-queue-registration-failure');
        const jobs: Array<() => Promise<void>> = [];
        const queue = {
            add: vi
                .fn()
                .mockImplementationOnce(() => {
                    throw failure;
                })
                .mockImplementationOnce((job: () => Promise<void>) => jobs.push(job)),
        };
        const fixture = instantiate({ thumbnailMaxPending: 1 }, queue);

        let thrown: unknown;
        try {
            fixture.model.add(81);
        } catch (err: unknown) {
            thrown = err;
        }
        expect(thrown).toBe(failure);
        expect(fixture.model.pendingThumbnailCount).toBe(0);

        expect(fixture.model.add(82)).toBeUndefined();
        expect(jobs).toHaveLength(1);
        expect(fixture.model.pendingThumbnailCount).toBe(1);
    });

    it('[TM-IMP-ADMISSION-REGISTER-REENTRY] releases exactly once when registration starts the callback and throws', async () => {
        const failure = new Error('synthetic-reentrant-registration-failure');
        const callbackResults: Promise<void>[] = [];
        const queue = {
            add: vi.fn((job: () => Promise<void>) => {
                callbackResults.push(job(), job());
                throw failure;
            }),
        };
        const fixture = instantiate({ thumbnailMaxPending: 1 }, queue);

        expect(() => fixture.model.add(91)).toThrow(failure);
        expect(fixture.model.pendingThumbnailCount).toBe(0);
        expect(callbackResults).toHaveLength(2);
        await Promise.all(callbackResults);
        expect(fixture.model.pendingThumbnailCount).toBe(0);
    });
});
