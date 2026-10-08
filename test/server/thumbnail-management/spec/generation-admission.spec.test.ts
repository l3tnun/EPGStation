import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '../../harness/async';
import {
    cleanupHarness,
    makeChild,
    makeModel,
    prepareCreate,
    processStubs,
    restoreSpawn,
    settleChild,
    ThumbnailEvent,
} from '../imp/_thumbnail-harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');
const Configuration = (require(join(snapshot, 'model', 'Configuration.js')) as { default: new (...args: any[]) => any })
    .default;

const startConfiguration = (thumbnailMaxPending: unknown) => {
    const logger = {
        stream: { warn: vi.fn() },
        system: { fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
    };
    const access = {
        configPath: 'synthetic-thumbnail-config.yml',
        templatePath: 'synthetic-thumbnail-config.yml.template',
        read: vi.fn(async () => JSON.stringify({ port: 49100, thumbnailMaxPending })),
        readSync: vi.fn((path: string) => {
            if (path.endsWith('.template'))
                throw Object.assign(new Error('synthetic missing template'), { code: 'ENOENT' });
            return JSON.stringify({ port: 49100, thumbnailMaxPending });
        }),
        unwatch: vi.fn(),
        watch: vi.fn(),
    };
    return { access, configuration: new Configuration({ getLogger: () => logger }, access) };
};

afterEach(cleanupHarness);
afterAll(restoreSpawn);

describe('thumbnail generation admission characterization', () => {
    it('[TM-1.4] uses the omitted pending limit default at construction', () => {
        const omitted = makeModel();

        expect(omitted.model.thumbnailMaxPending).toBe(32);
    });

    it('[TM-1.5] accepts the inclusive limits and rejects an out-of-range configuration during public startup', () => {
        const minimum = makeModel({ config: { thumbnailMaxPending: 1 } });
        const maximum = makeModel({ config: { thumbnailMaxPending: 10_000 } });
        const publicMinimum = startConfiguration(1);
        const publicMaximum = startConfiguration(10_000);

        expect(minimum.model.thumbnailMaxPending).toBe(1);
        expect(maximum.model.thumbnailMaxPending).toBe(10_000);
        expect(publicMinimum.configuration.getConfig().thumbnailMaxPending).toBe(1);
        expect(publicMaximum.configuration.getConfig().thumbnailMaxPending).toBe(10_000);
        expect(publicMinimum.access.watch).toHaveBeenCalledOnce();
        expect(publicMaximum.access.watch).toHaveBeenCalledOnce();
        for (const invalid of [0, 10_001, 1.5]) {
            expect(() => startConfiguration(invalid)).toThrow('ConfigValueError:thumbnailMaxPending');
        }
    });

    it('[TM-1.6] keeps the pending limit from the construction snapshot until a new instance starts', () => {
        const minimum = makeModel({ config: { thumbnailMaxPending: 1 } });

        minimum.config.thumbnailMaxPending = 7;
        expect(minimum.model.thumbnailMaxPending).toBe(1);
        expect(
            makeModel({ config: { thumbnailMaxPending: minimum.config.thumbnailMaxPending } }).model
                .thumbnailMaxPending,
        ).toBe(7);
    });

    it('[TM-1.7] synchronously rejects only the request beyond the waiting limit', () => {
        const jobs: Array<() => Promise<void>> = [];
        const queue = { add: vi.fn((job: () => Promise<void>) => jobs.push(job)) };
        const fixture = makeModel({ config: { thumbnailMaxPending: 2 }, queue });
        fixture.model.create = vi.fn(async () => undefined);

        expect(fixture.model.add(31)).toBeUndefined();
        expect(fixture.model.add(31)).toBeUndefined();
        expect(() => fixture.model.add(32)).toThrow('ThumbnailQueueIsFull');

        expect(jobs).toHaveLength(2);
        expect(fixture.model.pendingThumbnailCount).toBe(2);
        expect(fixture.model.create).not.toHaveBeenCalled();
    });

    it('[TM-1.1] admits a request while the queue remains below the configured waiting limit', async () => {
        const jobs: Array<() => Promise<void>> = [];
        const queue = { add: vi.fn((job: () => Promise<void>) => jobs.push(job)) };
        const fixture = makeModel({ config: { thumbnailMaxPending: 1 }, queue });
        const running = createDeferred<void>();
        fixture.model.create = vi.fn(() => running.promise);

        fixture.model.add(41);
        const first = jobs.shift();
        expect(first).toBeDefined();
        const firstResult = first!();
        expect(fixture.model.pendingThumbnailCount).toBe(0);
        expect(fixture.model.add(41)).toBeUndefined();

        expect(jobs).toHaveLength(1);
        expect(fixture.model.pendingThumbnailCount).toBe(1);
        running.resolve(undefined);
        await firstResult;
    });

    it('[TM-1.2] processes waiting requests in FIFO order, one at a time', async () => {
        const fixture = makeModel();
        const first = createDeferred<void>();
        const second = createDeferred<void>();
        const calls: number[] = [];
        fixture.model.create = vi.fn((id: number) => {
            calls.push(id);
            return calls.length === 1 ? first.promise : second.promise;
        });

        fixture.model.add(41);
        fixture.model.add(41);
        await vi.waitFor(() => expect(calls).toEqual([41]));
        first.resolve(undefined);
        await vi.waitFor(() => expect(calls).toEqual([41, 41]));
        second.resolve(undefined);
        await second.promise;

        expect(fixture.model.create).toHaveBeenCalledTimes(2);
    });

    it('[TM-1.3] keeps duplicate recorded-video requests as independent waiting entries', async () => {
        const fixture = makeModel();
        const first = createDeferred<void>();
        const second = createDeferred<void>();
        fixture.model.create = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

        fixture.model.add(42);
        fixture.model.add(42);
        await vi.waitFor(() => expect(fixture.model.create).toHaveBeenCalledOnce());
        first.resolve(undefined);
        await vi.waitFor(() => expect(fixture.model.create).toHaveBeenCalledTimes(2));
        second.resolve(undefined);
        await second.promise;

        expect(fixture.model.create.mock.calls).toEqual([[42], [42]]);
    });

    it('[TM-1.8] returns from admission before generation, JPEG registration, or notification', async () => {
        const fixture = makeModel();
        const generation = createDeferred<void>();
        fixture.model.create = vi.fn(() => generation.promise);

        expect(fixture.model.add(51)).toBeUndefined();
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();

        generation.resolve(undefined);
        await generation.promise;
    });

    it('[TM-1.9] starts the next request after notification without waiting for an asynchronous listener', async () => {
        prepareCreate();
        const event = new ThumbnailEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
        const listener = createDeferred<void>();
        event.setAdded(() => listener.promise);
        const fixture = makeModel();
        fixture.model.thumbnailEvent = event;
        const first = makeChild();
        const second = makeChild();
        processStubs.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);

        fixture.model.add(52);
        fixture.model.add(53);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
        settleChild(first, 0);

        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));
        expect(listener.state()).toEqual({ status: 'pending' });

        listener.resolve(undefined);
        settleChild(second, 0);
        await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledTimes(2));
    });

    it('[TM-1.10] retains the active request until its thumbnail registration has settled', async () => {
        prepareCreate();
        const fixture = makeModel();
        const first = makeChild();
        const second = makeChild();
        const pendingInsert = createDeferred<number>();
        fixture.thumbnailDB.insertOnce.mockReturnValueOnce(pendingInsert.promise).mockResolvedValueOnce(2);
        processStubs.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);

        fixture.model.add(54);
        fixture.model.add(55);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
        settleChild(first, 0);
        await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce());
        expect(processStubs.spawn).toHaveBeenCalledOnce();

        pendingInsert.resolve(1);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));
        settleChild(second, 0);
        await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledTimes(2));
    });
});
