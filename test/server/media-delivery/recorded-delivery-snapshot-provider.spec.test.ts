import { describe, expect, it } from 'vitest';

import { compiled } from './_media-harness';

describe('recorded delivery use snapshot contract', () => {
    it('[MD-2.5] projects a copy of active recorded delivery IDs without changing the source registry', () => {
        const DeliveryRecordedUseSnapshotProvider = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'DeliveryRecordedUseSnapshotProvider.js',
        ).default;
        const activeRecordedIds = new Set([41, 44]);
        const source = {
            getActiveRecordedFileDeliveryIds: () => activeRecordedIds,
        };
        const provider = new DeliveryRecordedUseSnapshotProvider(source);

        const snapshot = provider.getActiveRecordedFileDeliveryIds();

        expect(snapshot).toEqual({ recordedIds: new Set([41, 44]), status: 'known' });
        expect(snapshot.recordedIds).not.toBe(activeRecordedIds);
        expect(source.getActiveRecordedFileDeliveryIds()).toBe(activeRecordedIds);
    });

    it('[MD-2.5] reports unknown instead of a partial set when active deliveries cannot be enumerated safely', () => {
        const DeliveryRecordedUseSnapshotProvider = compiled<any>(
            'model',
            'service',
            'stream',
            'recorded',
            'DeliveryRecordedUseSnapshotProvider.js',
        ).default;
        const provider = new DeliveryRecordedUseSnapshotProvider({
            getActiveRecordedFileDeliveryIds: () => {
                throw new Error('synthetic registry unavailable');
            },
        });

        expect(provider.getActiveRecordedFileDeliveryIds()).toEqual({ status: 'unknown' });
    });
});
