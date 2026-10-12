import { describe, expect, it } from 'vitest';

import { compiled } from './_media-harness';

const snapshotModule = compiled<any>(
    'model',
    'service',
    'stream',
    'recorded',
    'DeliveryRecordedUseSnapshotProvider.js',
);
const ActiveRecordedDeliveryRegistry = snapshotModule.ActiveRecordedDeliveryRegistry;

describe('recorded delivery active ID registry implementation', () => {
    it('[MD-2.5] retains a duplicate recorded ID until every registration releases and ignores a stale release', () => {
        const registry = new ActiveRecordedDeliveryRegistry();
        const first = registry.register(41);
        const second = registry.register(41);

        first.release();
        first.release();

        expect(registry.getActiveRecordedFileDeliveryIds()).toEqual(new Set([41]));

        second.release();

        expect(registry.getActiveRecordedFileDeliveryIds()).toEqual(new Set());
    });
});
