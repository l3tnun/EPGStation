import type IRecordedStorageDeletionProvider from '../recorded/IRecordedStorageDeletionProvider.js';
import type { RecordingRecordedUseGate } from '../recording/RecordingRecordedUseProvider.js';
import IRecordedStorageDeletionPort, { RecordedStorageDeletionOutcome } from './IRecordedStorageDeletionPort.js';

type DeletionTokenResult = { readonly token: object } | { readonly status: 'busy' | 'unknown' };

/** Runtime-owned composition of prepared deletion with Recording and service-child exclusion gates. */
export default class StoragePressureDeletionAdapter implements IRecordedStorageDeletionPort {
    constructor(
        private readonly recorded: IRecordedStorageDeletionProvider,
        private readonly recordingGate: RecordingRecordedUseGate,
        private readonly serviceChildGate: RecordingRecordedUseGate,
    ) {}

    public async deleteForStoragePressure(
        recordedId: number,
        storageName: string,
    ): Promise<RecordedStorageDeletionOutcome> {
        const preparation = await this.recorded.prepareStorageDeletion(recordedId, storageName);
        if (preparation.status !== 'prepared') return 'not-deleted';

        const recording = this.recordingGate.tryAcquireDeletion(recordedId);
        if (!this.hasToken(recording)) return 'not-deleted';

        try {
            const serviceChild = this.serviceChildGate.tryAcquireDeletion(recordedId);
            if (!this.hasToken(serviceChild)) return 'not-deleted';

            try {
                return await this.recorded.deletePreparedForStorage(preparation.token);
            } finally {
                this.serviceChildGate.releaseDeletion(serviceChild.token);
            }
        } finally {
            this.recordingGate.releaseDeletion(recording.token);
        }
    }

    private hasToken(result: DeletionTokenResult): result is { readonly token: object } {
        return 'token' in result && typeof result.token === 'object' && result.token !== null;
    }
}
