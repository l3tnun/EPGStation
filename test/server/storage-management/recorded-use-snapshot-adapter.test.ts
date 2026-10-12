import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
    RecordedUseSnapshotPayload,
    RecordedUseSnapshotClient,
} from '../../../src/model/ipc/IRecordedResourceUse';
import type { RecordingRecordedUseSnapshotProvider } from '../../../src/model/operator/recording/RecordingRecordedUseProvider';

type RecordingDouble = Pick<RecordingRecordedUseSnapshotProvider, 'getActiveRecordedIds'>;
type ServiceChildDouble = Pick<RecordedUseSnapshotClient, 'requestSnapshot'>;

interface StorageRecordedUseSnapshotAdapterRuntime {
    getSnapshot(): Promise<unknown>;
}

interface StorageRecordedUseSnapshotAdapterConstructor {
    new (
        recording: RecordingDouble | null,
        serviceChild: ServiceChildDouble | null,
    ): StorageRecordedUseSnapshotAdapterRuntime;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}
const StorageRecordedUseSnapshotAdapter = (
    require(join(compiledSnapshot, 'model', 'operator', 'storage', 'StorageRecordedUseSnapshotAdapter.js')) as {
        default: StorageRecordedUseSnapshotAdapterConstructor;
    }
).default;

afterEach(() => {
    vi.useRealTimers();
});

describe('storage recorded-use snapshot adapter', () => {
    it('[SM-4.1-SNAPSHOT] reports unknown without querying either source when the Recording provider is absent', async () => {
        const requestSnapshot = vi.fn<() => Promise<RecordedUseSnapshotPayload>>();
        const adapter = new StorageRecordedUseSnapshotAdapter(null, { requestSnapshot });

        await expect(adapter.getSnapshot()).resolves.toEqual({ status: 'unknown' });

        expect(requestSnapshot).not.toHaveBeenCalled();
    });

    it('[SM-4.1-SNAPSHOT] reports unknown without querying either source when the service-child client is absent', async () => {
        const getActiveRecordedIds = vi.fn(() => ({ recordedIds: new Set<number>(), status: 'known' as const }));
        const adapter = new StorageRecordedUseSnapshotAdapter({ getActiveRecordedIds }, null);

        await expect(adapter.getSnapshot()).resolves.toEqual({ status: 'unknown' });

        expect(getActiveRecordedIds).not.toHaveBeenCalled();
    });

    it('[SM-4.1-SNAPSHOT] merges known Recording and service-child IDs into a single deduplicated set', async () => {
        const recording: RecordingDouble = {
            getActiveRecordedIds: () => ({ recordedIds: new Set([1, 2]), status: 'known' }),
        };
        const serviceChild: ServiceChildDouble = {
            requestSnapshot: async () => ({ recordedIds: [2, 3], status: 'known' }),
        };
        const adapter = new StorageRecordedUseSnapshotAdapter(recording, serviceChild);

        const result = await adapter.getSnapshot();

        expect(result).toEqual({ recordedIds: new Set([1, 2, 3]), status: 'known' });
    });

    it('[SM-4.1-SNAPSHOT] reports unknown when the Recording snapshot itself is unknown even though the service-child snapshot is known', async () => {
        const recording: RecordingDouble = { getActiveRecordedIds: () => ({ status: 'unknown' }) };
        const serviceChild: ServiceChildDouble = {
            requestSnapshot: async () => ({ recordedIds: [3], status: 'known' }),
        };
        const adapter = new StorageRecordedUseSnapshotAdapter(recording, serviceChild);

        await expect(adapter.getSnapshot()).resolves.toEqual({ status: 'unknown' });
    });

    it('[SM-4.1-SNAPSHOT] reports unknown when the service-child snapshot itself is unknown even though the Recording snapshot is known', async () => {
        const recording: RecordingDouble = {
            getActiveRecordedIds: () => ({ recordedIds: new Set([1]), status: 'known' }),
        };
        const serviceChild: ServiceChildDouble = { requestSnapshot: async () => ({ status: 'unknown' }) };
        const adapter = new StorageRecordedUseSnapshotAdapter(recording, serviceChild);

        await expect(adapter.getSnapshot()).resolves.toEqual({ status: 'unknown' });
    });

    it('[SM-4.1-SNAPSHOT] reports unknown when reading the Recording snapshot throws synchronously', async () => {
        const recording: RecordingDouble = {
            getActiveRecordedIds: () => {
                throw new Error('synthetic recording snapshot failure');
            },
        };
        const serviceChild: ServiceChildDouble = {
            requestSnapshot: async () => ({ recordedIds: [1], status: 'known' }),
        };
        const adapter = new StorageRecordedUseSnapshotAdapter(recording, serviceChild);

        await expect(adapter.getSnapshot()).resolves.toEqual({ status: 'unknown' });
    });

    it('[SM-4.1-SNAPSHOT] reports unknown when the service-child snapshot request rejects', async () => {
        const recording: RecordingDouble = {
            getActiveRecordedIds: () => ({ recordedIds: new Set([1]), status: 'known' }),
        };
        const rejection = new Error('synthetic service-child snapshot rejection');
        const serviceChild: ServiceChildDouble = {
            requestSnapshot: async () => {
                throw rejection;
            },
        };
        const adapter = new StorageRecordedUseSnapshotAdapter(recording, serviceChild);

        await expect(adapter.getSnapshot()).resolves.toEqual({ status: 'unknown' });
    });

    it('[SM-4.1-SNAPSHOT] reports the merged known snapshot and clears its timer once the service-child snapshot resolves before the 5000 ms deadline', async () => {
        vi.useFakeTimers();
        const recording: RecordingDouble = {
            getActiveRecordedIds: () => ({ recordedIds: new Set([1]), status: 'known' }),
        };
        const serviceChild: ServiceChildDouble = {
            requestSnapshot: async () => ({ recordedIds: [1], status: 'known' }),
        };
        const adapter = new StorageRecordedUseSnapshotAdapter(recording, serviceChild);

        const pending = adapter.getSnapshot();
        await vi.advanceTimersByTimeAsync(0);
        const result = await pending;

        expect(result).toEqual({ recordedIds: new Set([1]), status: 'known' });
        expect(vi.getTimerCount()).toBe(0);
    });

    // 5_000 (5s) is snapshotTimeoutMs
    // (src/model/operator/storage/StorageRecordedUseSnapshotAdapter.ts:5), matching the ordinary
    // (non-upload/non-bulk) IPC request timeout approved in
    // .kiro/specs/server-process-messaging/design.md:212,521.
    it('[SM-4.1-SNAPSHOT] reports unknown when the Recording provider returns a non-object snapshot', async () => {
        const recording: RecordingDouble = { getActiveRecordedIds: () => null as unknown as { status: 'unknown' } };
        const serviceChild: ServiceChildDouble = {
            requestSnapshot: async () => ({ recordedIds: [1], status: 'known' }),
        };
        const adapter = new StorageRecordedUseSnapshotAdapter(recording, serviceChild);

        await expect(adapter.getSnapshot()).resolves.toEqual({ status: 'unknown' });
    });

    it('[SM-4.1-SNAPSHOT] reports unknown when the service-child snapshot itself resolves to a non-object value', async () => {
        const recording: RecordingDouble = {
            getActiveRecordedIds: () => ({ recordedIds: new Set([1]), status: 'known' }),
        };
        const serviceChild: ServiceChildDouble = {
            requestSnapshot: async () => null as unknown as RecordedUseSnapshotPayload,
        };
        const adapter = new StorageRecordedUseSnapshotAdapter(recording, serviceChild);

        await expect(adapter.getSnapshot()).resolves.toEqual({ status: 'unknown' });
    });

    it('[SM-4.1-SNAPSHOT] reports unknown when the service-child snapshot does not settle within 5000 ms', async () => {
        vi.useFakeTimers();
        const recording: RecordingDouble = {
            getActiveRecordedIds: () => ({ recordedIds: new Set([1]), status: 'known' }),
        };
        const serviceChild: ServiceChildDouble = {
            requestSnapshot: () => new Promise<RecordedUseSnapshotPayload>(() => undefined),
        };
        const adapter = new StorageRecordedUseSnapshotAdapter(recording, serviceChild);

        const pending = adapter.getSnapshot();
        await vi.advanceTimersByTimeAsync(4999);
        let settled = false;
        pending.then(() => {
            settled = true;
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toEqual({ status: 'unknown' });
    });
});
