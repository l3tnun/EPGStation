import { describe, expect, it, vi } from 'vitest';

import { compiled, deferred } from './_media-harness';

describe('recorded delivery local lease integration', () => {
    it('[MD-2.5] exposes an acquired recorded delivery to a read-only snapshot until its exact lease releases', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const snapshotModule = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'DeliveryRecordedUseSnapshotProvider.js',
        );
        const ActiveRecordedDeliveryRegistry = snapshotModule.ActiveRecordedDeliveryRegistry;
        const DeliveryRecordedUseSnapshotProvider = snapshotModule.default;
        const release = vi.fn(async () => undefined);
        const registry = new ActiveRecordedDeliveryRegistry();
        const consumer = new RecordedDeliveryLeaseConsumer(
            {
                open: async () => ({
                    adopt: () => ({
                        source: {
                            inputPath: 'synthetic/encoded.m2ts',
                            kind: 'encoded-direct',
                            playPosition: 12,
                            recordedId: 41,
                            videoFileId: 31,
                            videoInfo: { bitRate: 8, duration: 60, size: 480 },
                        },
                        status: 'adopted',
                    }),
                }),
                resolveRecordedId: async () => 41,
            },
            { acquire: async () => ({ release }) },
            registry,
        );
        const snapshot = new DeliveryRecordedUseSnapshotProvider(registry);

        const delivery = await consumer.acquireAndOpen(31, 12);

        expect(snapshot.getActiveRecordedFileDeliveryIds()).toEqual({ recordedIds: new Set([41]), status: 'known' });

        await delivery.release();

        expect(release).toHaveBeenCalledOnce();
        expect(snapshot.getActiveRecordedFileDeliveryIds()).toEqual({ recordedIds: new Set(), status: 'known' });
    });

    it('[MD-2.5] retains a deduplicated ID until every exact lease releases successfully', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const snapshotModule = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'DeliveryRecordedUseSnapshotProvider.js',
        );
        const ActiveRecordedDeliveryRegistry = snapshotModule.ActiveRecordedDeliveryRegistry;
        const DeliveryRecordedUseSnapshotProvider = snapshotModule.default;
        const firstRelease = vi.fn(async () => undefined);
        const secondRelease = vi.fn(async () => {
            throw new Error('synthetic release failure');
        });
        const registry = new ActiveRecordedDeliveryRegistry();
        const consumer = new RecordedDeliveryLeaseConsumer(
            {
                open: async (videoFileId: number, _recordedId: number, playPosition: number) => ({
                    adopt: () => ({
                        source: {
                            inputPath: `synthetic/${videoFileId}.m2ts`,
                            kind: 'encoded-direct',
                            playPosition,
                            recordedId: 41,
                            videoFileId,
                            videoInfo: { bitRate: 8, duration: 60, size: 480 },
                        },
                        status: 'adopted',
                    }),
                }),
                resolveRecordedId: async () => 41,
            },
            {
                acquire: vi
                    .fn()
                    .mockResolvedValueOnce({ release: firstRelease })
                    .mockResolvedValueOnce({ release: secondRelease }),
            },
            registry,
        );
        const snapshot = new DeliveryRecordedUseSnapshotProvider(registry);
        const first = await consumer.acquireAndOpen(31, 12);
        const second = await consumer.acquireAndOpen(32, 13);

        await first.release();
        await expect(second.release()).rejects.toThrow('synthetic release failure');

        expect(snapshot.getActiveRecordedFileDeliveryIds()).toEqual({ recordedIds: new Set([41]), status: 'known' });
    });

    it('[MD-2.5] exposes a known ID as soon as its exact lease is acquired while source opening is pending', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const snapshotModule = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'DeliveryRecordedUseSnapshotProvider.js',
        );
        const ActiveRecordedDeliveryRegistry = snapshotModule.ActiveRecordedDeliveryRegistry;
        const DeliveryRecordedUseSnapshotProvider = snapshotModule.default;
        const opening = deferred<any>();
        const registry = new ActiveRecordedDeliveryRegistry();
        const consumer = new RecordedDeliveryLeaseConsumer(
            {
                open: () => opening.promise,
                resolveRecordedId: async () => 41,
            },
            { acquire: async () => ({ release: async () => undefined }) },
            registry,
        );
        const snapshot = new DeliveryRecordedUseSnapshotProvider(registry);

        const starting = consumer.acquireAndOpen(31, 12);
        await vi.waitFor(() =>
            expect(snapshot.getActiveRecordedFileDeliveryIds()).toEqual({
                recordedIds: new Set([41]),
                status: 'known',
            }),
        );
        opening.resolve({
            adopt: () => ({
                source: {
                    inputPath: 'synthetic/encoded.m2ts',
                    kind: 'encoded-direct',
                    playPosition: 12,
                    recordedId: 41,
                    videoFileId: 31,
                    videoInfo: { bitRate: 8, duration: 60, size: 480 },
                },
                status: 'adopted',
            }),
        });

        await expect(starting).resolves.toMatchObject({ recordedId: 41 });
    });

    it('[MD-2.5] retains the active ID when release remains unconfirmed after source opening fails', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const snapshotModule = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'DeliveryRecordedUseSnapshotProvider.js',
        );
        const ActiveRecordedDeliveryRegistry = snapshotModule.ActiveRecordedDeliveryRegistry;
        const DeliveryRecordedUseSnapshotProvider = snapshotModule.default;
        const registry = new ActiveRecordedDeliveryRegistry();
        const consumer = new RecordedDeliveryLeaseConsumer(
            {
                open: async () => {
                    throw new Error('synthetic open failure');
                },
                resolveRecordedId: async () => 41,
            },
            {
                acquire: async () => ({
                    release: async () => {
                        throw new Error('synthetic release failure');
                    },
                }),
            },
            registry,
        );
        const snapshot = new DeliveryRecordedUseSnapshotProvider(registry);

        await expect(consumer.acquireAndOpen(31, 12)).rejects.toThrow('synthetic open failure');

        expect(snapshot.getActiveRecordedFileDeliveryIds()).toEqual({ recordedIds: new Set([41]), status: 'known' });
    });

    it('[MD-2.5] removes the active ID after a source opening failure when its exact lease releases successfully', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const snapshotModule = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'DeliveryRecordedUseSnapshotProvider.js',
        );
        const ActiveRecordedDeliveryRegistry = snapshotModule.ActiveRecordedDeliveryRegistry;
        const DeliveryRecordedUseSnapshotProvider = snapshotModule.default;
        const release = vi.fn(async () => undefined);
        const registry = new ActiveRecordedDeliveryRegistry();
        const consumer = new RecordedDeliveryLeaseConsumer(
            {
                open: async () => {
                    throw new Error('synthetic open failure');
                },
                resolveRecordedId: async () => 41,
            },
            { acquire: async () => ({ release }) },
            registry,
        );
        const snapshot = new DeliveryRecordedUseSnapshotProvider(registry);

        await expect(consumer.acquireAndOpen(31, 12)).rejects.toThrow('synthetic open failure');

        expect(release).toHaveBeenCalledOnce();
        expect(snapshot.getActiveRecordedFileDeliveryIds()).toEqual({ recordedIds: new Set(), status: 'known' });
    });

    it('[MD-2.5] lets independent active guards adopt deferred sources without superseding either delivery', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const snapshotModule = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'DeliveryRecordedUseSnapshotProvider.js',
        );
        const ActiveRecordedDeliveryRegistry = snapshotModule.ActiveRecordedDeliveryRegistry;
        const DeliveryRecordedUseSnapshotProvider = snapshotModule.default;
        const firstOpening = deferred<any>();
        const secondOpening = deferred<any>();
        const firstRelease = vi.fn(async () => undefined);
        const secondRelease = vi.fn(async () => undefined);
        const firstAdopt = vi.fn(() => ({
            source: {
                inputPath: 'synthetic/31.m2ts',
                kind: 'encoded-direct',
                playPosition: 12,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            status: 'adopted',
        }));
        const secondAdopt = vi.fn(() => ({
            source: {
                inputPath: 'synthetic/32.m2ts',
                kind: 'encoded-direct',
                playPosition: 12,
                recordedId: 41,
                videoFileId: 32,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            status: 'adopted',
        }));
        const registry = new ActiveRecordedDeliveryRegistry();
        const open = vi.fn(async (videoFileId: number) => {
            if (videoFileId === 31) {
                return firstOpening.promise;
            }
            return secondOpening.promise;
        });
        const consumer = new RecordedDeliveryLeaseConsumer(
            {
                open,
                resolveRecordedId: async () => 41,
            },
            {
                acquire: vi
                    .fn()
                    .mockResolvedValueOnce({ release: firstRelease })
                    .mockResolvedValueOnce({ release: secondRelease }),
            },
            registry,
        );
        const snapshot = new DeliveryRecordedUseSnapshotProvider(registry);
        const firstActive = () => true;
        const secondActive = () => true;

        const first = consumer.acquireAndOpen(31, 12, firstActive);
        await vi.waitFor(() =>
            expect(snapshot.getActiveRecordedFileDeliveryIds()).toEqual({
                recordedIds: new Set([41]),
                status: 'known',
            }),
        );
        const second = consumer.acquireAndOpen(32, 12, secondActive);
        await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
        firstOpening.resolve({ adopt: firstAdopt });
        secondOpening.resolve({ adopt: secondAdopt });

        const [firstDelivery, secondDelivery] = await Promise.all([first, second]);

        expect(firstAdopt).toHaveBeenCalledOnce();
        expect(secondAdopt).toHaveBeenCalledOnce();
        expect(snapshot.getActiveRecordedFileDeliveryIds()).toEqual({ recordedIds: new Set([41]), status: 'known' });

        await firstDelivery.release();
        await secondDelivery.release();

        expect(firstRelease).toHaveBeenCalledOnce();
        expect(secondRelease).toHaveBeenCalledOnce();
        expect(snapshot.getActiveRecordedFileDeliveryIds()).toEqual({ recordedIds: new Set(), status: 'known' });
    });

    it('[MD-2.5] stops before acquiring a lease when its own guard becomes inactive after ID resolution', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const resolving = deferred<number>();
        const release = vi.fn(async () => undefined);
        const open = vi.fn(async () => ({
            adopt: () => ({
                source: {
                    inputPath: 'synthetic/31.m2ts',
                    kind: 'encoded-direct',
                    playPosition: 12,
                    recordedId: 41,
                    videoFileId: 31,
                    videoInfo: { bitRate: 8, duration: 60, size: 480 },
                },
                status: 'adopted',
            }),
        }));
        const acquire = vi.fn(async () => ({ release }));
        let active = true;
        const consumer = new RecordedDeliveryLeaseConsumer({ open, resolveRecordedId: () => resolving.promise }, { acquire });

        const starting = consumer.acquireAndOpen(31, 12, () => active);
        active = false;
        resolving.resolve(41);

        await expect(starting).rejects.toThrow('RecordedDeliveryLeaseAcquisitionStale');

        expect(acquire).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
    });

    it('[MD-2.5] releases its exact late lease without opening a source when its own guard becomes inactive', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const acquired = deferred<any>();
        const release = vi.fn(async () => undefined);
        const open = vi.fn(async () => ({
            adopt: () => ({
                source: {
                    inputPath: 'synthetic/31.m2ts',
                    kind: 'encoded-direct',
                    playPosition: 12,
                    recordedId: 41,
                    videoFileId: 31,
                    videoInfo: { bitRate: 8, duration: 60, size: 480 },
                },
                status: 'adopted',
            }),
        }));
        const acquire = vi.fn(() => acquired.promise);
        let active = true;
        const consumer = new RecordedDeliveryLeaseConsumer(
            { open, resolveRecordedId: async () => 41 },
            { acquire },
        );

        const starting = consumer.acquireAndOpen(31, 12, () => active);
        await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce());
        active = false;
        acquired.resolve({ release });

        await expect(starting).rejects.toThrow('RecordedDeliveryLeaseAcquisitionStale');

        expect(release).toHaveBeenCalledOnce();
        expect(open).not.toHaveBeenCalled();
    });

    it('[MD-2.5] retains the exact acquired ID when its inactive guard cannot release the lease', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const snapshotModule = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'DeliveryRecordedUseSnapshotProvider.js',
        );
        const ActiveRecordedDeliveryRegistry = snapshotModule.ActiveRecordedDeliveryRegistry;
        const DeliveryRecordedUseSnapshotProvider = snapshotModule.default;
        const acquired = deferred<any>();
        const release = vi.fn(async () => {
            throw new Error('synthetic release failure');
        });
        const open = vi.fn();
        const acquire = vi.fn(() => acquired.promise);
        const registry = new ActiveRecordedDeliveryRegistry();
        const consumer = new RecordedDeliveryLeaseConsumer(
            { open, resolveRecordedId: async () => 41 },
            { acquire },
            registry,
        );
        const snapshot = new DeliveryRecordedUseSnapshotProvider(registry);
        let active = true;

        const starting = consumer.acquireAndOpen(31, 12, () => active);
        await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce());
        active = false;
        acquired.resolve({ release });

        await expect(starting).rejects.toThrow('RecordedDeliveryLeaseAcquisitionStale');

        expect(release).toHaveBeenCalledOnce();
        expect(open).not.toHaveBeenCalled();
        expect(snapshot.getActiveRecordedFileDeliveryIds()).toEqual({ recordedIds: new Set([41]), status: 'known' });
    });

    it('[MD-2.5] disposes a late opened source and removes its ID when its own guard becomes inactive', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const snapshotModule = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'DeliveryRecordedUseSnapshotProvider.js',
        );
        const ActiveRecordedDeliveryRegistry = snapshotModule.ActiveRecordedDeliveryRegistry;
        const DeliveryRecordedUseSnapshotProvider = snapshotModule.default;
        const opening = deferred<any>();
        const release = vi.fn(async () => undefined);
        const lateAdopt = vi.fn(() => ({
            source: {
                inputPath: 'synthetic/31.m2ts',
                kind: 'encoded-direct',
                playPosition: 12,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            status: 'adopted',
        }));
        const lateDispose = vi.fn(async () => undefined);
        const registry = new ActiveRecordedDeliveryRegistry();
        let active = true;
        const consumer = new RecordedDeliveryLeaseConsumer(
            {
                open: () => opening.promise,
                resolveRecordedId: async () => 41,
            },
            { acquire: async () => ({ release }) },
            registry,
        );
        const snapshot = new DeliveryRecordedUseSnapshotProvider(registry);

        const starting = consumer.acquireAndOpen(31, 12, () => active);
        await vi.waitFor(() =>
            expect(snapshot.getActiveRecordedFileDeliveryIds()).toEqual({
                recordedIds: new Set([41]),
                status: 'known',
            }),
        );
        active = false;
        opening.resolve({ adopt: lateAdopt, disposeBeforeAdoption: lateDispose });

        await expect(starting).rejects.toThrow('RecordedDeliveryLeaseAcquisitionStale');

        expect(lateAdopt).not.toHaveBeenCalled();
        expect(lateDispose).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledOnce();
        expect(snapshot.getActiveRecordedFileDeliveryIds()).toEqual({ recordedIds: new Set(), status: 'known' });
    });

    it('[MD-2.5] retains a late opened source ID when its exact lease release remains unconfirmed', async () => {
        const RecordedDeliveryLeaseConsumer = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'RecordedDeliveryLeaseConsumer.js',
        ).default;
        const snapshotModule = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'DeliveryRecordedUseSnapshotProvider.js',
        );
        const ActiveRecordedDeliveryRegistry = snapshotModule.ActiveRecordedDeliveryRegistry;
        const DeliveryRecordedUseSnapshotProvider = snapshotModule.default;
        const opening = deferred<any>();
        const release = vi.fn(async () => {
            throw new Error('synthetic release failure');
        });
        const lateAdopt = vi.fn(() => ({
            source: {
                inputPath: 'synthetic/31.m2ts',
                kind: 'encoded-direct',
                playPosition: 12,
                recordedId: 41,
                videoFileId: 31,
                videoInfo: { bitRate: 8, duration: 60, size: 480 },
            },
            status: 'adopted',
        }));
        const lateDispose = vi.fn(async () => undefined);
        const registry = new ActiveRecordedDeliveryRegistry();
        let active = true;
        const consumer = new RecordedDeliveryLeaseConsumer(
            { open: () => opening.promise, resolveRecordedId: async () => 41 },
            { acquire: async () => ({ release }) },
            registry,
        );
        const snapshot = new DeliveryRecordedUseSnapshotProvider(registry);

        const starting = consumer.acquireAndOpen(31, 12, () => active);
        await vi.waitFor(() =>
            expect(snapshot.getActiveRecordedFileDeliveryIds()).toEqual({
                recordedIds: new Set([41]),
                status: 'known',
            }),
        );
        active = false;
        opening.resolve({ adopt: lateAdopt, disposeBeforeAdoption: lateDispose });

        await expect(starting).rejects.toThrow('RecordedDeliveryLeaseAcquisitionStale');

        expect(release).toHaveBeenCalledOnce();
        expect(lateAdopt).not.toHaveBeenCalled();
        expect(lateDispose).toHaveBeenCalledOnce();
        expect(snapshot.getActiveRecordedFileDeliveryIds()).toEqual({ recordedIds: new Set([41]), status: 'known' });
    });
});
