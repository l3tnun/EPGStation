import type { RecordedUseSnapshotPayload, RecordedUseSnapshotClient } from '../../ipc/IRecordedResourceUse.js';
import type { RecordingRecordedUseSnapshotProvider } from '../recording/RecordingRecordedUseProvider.js';
import IStorageRecordedUseSnapshotPort, { StorageRecordedUseSnapshot } from './IStorageRecordedUseSnapshotPort.js';

const snapshotTimeoutMs = 5_000;
const UNKNOWN = Object.freeze({ status: 'unknown' as const });

/** Runtime-owned aggregation of Recording and current service-child recorded-use snapshots. */
export default class StorageRecordedUseSnapshotAdapter implements IStorageRecordedUseSnapshotPort {
    constructor(
        private readonly recording: Pick<RecordingRecordedUseSnapshotProvider, 'getActiveRecordedIds'> | null,
        private readonly serviceChild: Pick<RecordedUseSnapshotClient, 'requestSnapshot'> | null,
    ) {}

    public async getSnapshot(): Promise<StorageRecordedUseSnapshot> {
        if (this.recording === null || this.serviceChild === null) return UNKNOWN;

        const recordingSnapshot = this.readRecordingSnapshot();
        const serviceSnapshot = await this.readServiceChildSnapshot();
        if (!this.isKnownRecordingSnapshot(recordingSnapshot) || !this.isKnownServiceSnapshot(serviceSnapshot)) {
            return UNKNOWN;
        }

        return Object.freeze({
            recordedIds: new Set([...recordingSnapshot.recordedIds, ...serviceSnapshot.recordedIds]),
            status: 'known' as const,
        });
    }

    private readRecordingSnapshot(): unknown {
        try {
            return this.recording!.getActiveRecordedIds();
        } catch (_error: unknown) {
            return UNKNOWN;
        }
    }

    private async readServiceChildSnapshot(): Promise<unknown> {
        let timeoutHandle: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                Promise.resolve().then(() => this.serviceChild!.requestSnapshot()),
                new Promise<StorageRecordedUseSnapshot>(resolve => {
                    timeoutHandle = setTimeout(() => resolve(UNKNOWN), snapshotTimeoutMs);
                }),
            ]);
        } catch (_error: unknown) {
            return UNKNOWN;
        } finally {
            clearTimeout(timeoutHandle);
        }
    }

    private isKnownRecordingSnapshot(
        snapshot: unknown,
    ): snapshot is { readonly status: 'known'; readonly recordedIds: ReadonlySet<number> } {
        if (typeof snapshot !== 'object' || snapshot === null) return false;
        const candidate = snapshot as Partial<{ readonly status: string; readonly recordedIds: unknown }>;
        return (
            candidate.status === 'known' &&
            candidate.recordedIds instanceof Set &&
            [...candidate.recordedIds].every(recordedId => this.isRecordedId(recordedId))
        );
    }

    private isKnownServiceSnapshot(
        snapshot: unknown,
    ): snapshot is Extract<RecordedUseSnapshotPayload, { status: 'known' }> {
        if (typeof snapshot !== 'object' || snapshot === null) return false;
        const candidate = snapshot as Partial<RecordedUseSnapshotPayload>;
        return (
            candidate.status === 'known' &&
            Array.isArray(candidate.recordedIds) &&
            candidate.recordedIds.every(recordedId => this.isRecordedId(recordedId))
        );
    }

    private isRecordedId(recordedId: unknown): recordedId is number {
        return typeof recordedId === 'number' && Number.isSafeInteger(recordedId) && recordedId > 0;
    }
}
