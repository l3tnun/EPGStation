import IRecordedPlaybackSourceProvider, {
    OpenedRecordedPlaybackSource,
    RecordedPlaybackOpenOption,
    RecordedPlaybackSource,
} from '../../../operator/recorded/IRecordedPlaybackSourceProvider.js';
import {
    ActiveRecordedDeliveryRegistration,
    ActiveRecordedDeliveryRegistry,
} from './DeliveryRecordedUseSnapshotProvider.js';

/**
 * 録画済みファイルの「使用中」を表明する lease。`recordedUsePort.acquire` で取得し、
 * 配信終了時に `release()` で返却する（他の削除処理等が使用中のファイルを消さないための
 * 排他表明で、実体・実装先は `recordedUsePort` 側が持つ）。
 */
export interface RecordedDeliveryUseLease {
    release(): Promise<void>;
}

/**
 * 「配信のために録画済みファイルを使用する」ことを登録する先。
 * `kind: 'delivery'` は将来他の使用目的（エンコード等）と区別するための固定値。
 */
export interface RecordedDeliveryUsePort {
    acquire(recordedId: number, kind: 'delivery'): Promise<RecordedDeliveryUseLease>;
}

/**
 * `acquireAndOpen` が成功した際に返す、配信可能になったソースと解放操作。
 * `release()` は lease の返却と、`activeRegistry` への登録解除の両方を行う。
 */
export interface AcquiredRecordedDeliverySource {
    readonly recordedId: number;
    readonly source: RecordedPlaybackSource;
    release(): Promise<void>;
}

/** 取得処理の途中で呼び出し元がまだこの取得を必要としているかを確認する callback。 */
type RecordedDeliveryLivenessGuard = () => boolean;

/** `isActive` が省略された場合の既定値。常に有効として扱い、途中中断を行わない。 */
const alwaysActiveRecordedDeliveryLiveness: RecordedDeliveryLivenessGuard = () => true;

/**
 * Playback-source providers deliberately expose precise internal failures.  The
 * service boundary retains the legacy stream errors instead of leaking those
 * provider implementation details through HTTP response bodies.
 */
export const toLegacyRecordedDeliveryError = (error: unknown): Error => {
    if (error instanceof Error === false) {
        return new Error(String(error));
    }

    switch (error.message) {
        case 'RecordedPlaybackVideoFileNotFound':
        case 'RecordedPlaybackRecordedIdMismatch':
        case 'RecordedPlaybackSourceMismatch':
            return new Error('VideoIsNull');
        case 'RecordedPlaybackRecordedNotFound':
            return new Error('RecordedIsNull');
        case 'RecordedPlaybackPathNotFound':
            return new Error('GetVideoFilePathError');
        default:
            return error;
    }
};

/**
 * `AcquiredRecordedDeliverySource` の実装。取得済みの lease・registry 登録を束ね、
 * `release()` が複数回呼ばれても実際の解放は一度しか行わないようにする。
 */
class AcquiredRecordedDelivery implements AcquiredRecordedDeliverySource {
    /** `release()` の結果を1度だけ計算するためのキャッシュ。null の間は未着手。 */
    private releasePromise: Promise<void> | null = null;

    constructor(
        private readonly lease: RecordedDeliveryUseLease,
        public readonly recordedId: number,
        public readonly source: RecordedPlaybackSource,
        private readonly registration: ActiveRecordedDeliveryRegistration | null,
    ) {}

    public release(): Promise<void> {
        this.releasePromise ??= this.releaseLease();
        return this.releasePromise;
    }

    private async releaseLease(): Promise<void> {
        await this.lease.release();
        this.registration?.release();
    }
}

/**
 * 録画済みファイルの配信元を、「使用中」の lease 取得（`recordedUsePort`）と
 * 実際の再生ソースを開く処理（`playbackSourceProvider`）の両方を通してから受け渡す。
 * 途中の各段階で `isActive` を確認し、要求が既に不要になっていれば取得済みの資源
 * （lease・開いたソース）を破棄してから中断する。
 */
export default class RecordedDeliveryLeaseConsumer {
    constructor(
        private readonly playbackSourceProvider: Pick<IRecordedPlaybackSourceProvider, 'open' | 'resolveRecordedId'>,
        private readonly recordedUsePort: RecordedDeliveryUsePort,
        /** 配信中の recordedId を追跡する registry。省略時は追跡自体を行わない。 */
        private readonly activeRegistry: ActiveRecordedDeliveryRegistry | null = null,
    ) {}

    /**
     * videoFileId から recordedId を解決し、使用中 lease の取得・再生ソースを開く処理を
     * 順に行う。各段階の後で `isActive()` を確認し、途中で不要になった場合は取得済みの
     * 資源を解放してから失敗として終わる。
     * @param isActive 取得の各段階で、まだこの取得が必要かを確認する callback。
     * @param openOption 再生ソースを開くときの任意指定（動画情報を使わない直接配信は動画情報の取得失敗を許す）。
     * @returns 配信可能になったソースと、その解放操作。
     */
    public async acquireAndOpen(
        videoFileId: number,
        playPosition: number,
        isActive: RecordedDeliveryLivenessGuard = alwaysActiveRecordedDeliveryLiveness,
        openOption?: RecordedPlaybackOpenOption,
    ): Promise<AcquiredRecordedDeliverySource> {
        const recordedId = await this.playbackSourceProvider.resolveRecordedId(videoFileId);
        if (!isActive()) {
            throw new Error('RecordedDeliveryLeaseAcquisitionStale');
        }
        const lease = await this.recordedUsePort.acquire(recordedId, 'delivery');
        const registration = this.activeRegistry?.register(recordedId) ?? null;
        if (!isActive()) {
            await this.releaseAfterFailure(lease, registration);
            throw new Error('RecordedDeliveryLeaseAcquisitionStale');
        }
        let adoptedSource: RecordedPlaybackSource | null = null;
        try {
            const openedSource =
                openOption === undefined
                    ? await this.playbackSourceProvider.open(videoFileId, recordedId, playPosition)
                    : await this.playbackSourceProvider.open(videoFileId, recordedId, playPosition, openOption);
            if (!isActive()) {
                await this.disposeBeforeAdoption(openedSource);
                throw new Error('RecordedDeliveryLeaseAcquisitionStale');
            }
            const adoption = openedSource.adopt();
            if (adoption.status === 'stale') {
                throw new Error('RecordedPlaybackSourceAdoptionStale');
            }
            const source = adoption.source;
            adoptedSource = source;
            if (
                source.recordedId !== recordedId ||
                source.videoFileId !== videoFileId ||
                source.playPosition !== playPosition
            ) {
                throw new Error('RecordedPlaybackSourceMismatch');
            }

            return new AcquiredRecordedDelivery(lease, recordedId, source, registration);
        } catch (error) {
            if (adoptedSource !== null) {
                await this.disposeUnconsumedSource(adoptedSource);
            }
            await this.releaseAfterFailure(lease, registration);
            throw error;
        }
    }

    private async releaseAfterFailure(
        lease: RecordedDeliveryUseLease,
        registration: ActiveRecordedDeliveryRegistration | null,
    ): Promise<void> {
        try {
            await lease.release();
        } catch {
            // The source failure remains observable while the registry conservatively retains an unconfirmed lease.
            return;
        }
        if (registration !== null) {
            registration.release();
        }
    }

    private async disposeBeforeAdoption(source: OpenedRecordedPlaybackSource): Promise<void> {
        try {
            await source.disposeBeforeAdoption();
        } catch {
            // A late source never becomes a delivery input even when provider cleanup itself fails.
        }
    }

    private async disposeUnconsumedSource(source: RecordedPlaybackSource): Promise<void> {
        if (source.kind === 'encoded-direct') {
            return;
        }
        try {
            await source.reader.close();
        } catch {
            // Source revalidation failure remains the observable failure before activation.
        }
    }
}
