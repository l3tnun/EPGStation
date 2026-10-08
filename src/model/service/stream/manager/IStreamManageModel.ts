import type * as apid from '../../../../../api.js';
import { RecordedPlaybackSource } from '../../../operator/recorded/IRecordedPlaybackSourceProvider.js';
import IRecordedStreamBaseModel from '../base/IRecordedStreamBaseModel.js';
import IStreamBaseModel, { LiveStreamInfo, RecordedStreamInfo } from '../base/IStreamBaseModel.js';
import RecordedDeliveryLeaseConsumer, {
    AcquiredRecordedDeliverySource,
} from '../recorded/RecordedDeliveryLeaseConsumer.js';

/**
 * `getStreamInfos()` が返す、streamId と紐付けた配信情報。
 */
export interface StreamInfoWithStreamId {
    streamId: apid.StreamId;
    info: LiveStreamInfo | RecordedStreamInfo;
}

/**
 * `startRecorded()`の開始要求1件分の内容。stream 実体は`streamProvider`が
 * 生成するため、実体が確定する前に必要な情報をここへ渡す。
 */
export interface RecordedStreamStartOption {
    readonly mode: number;
    /**
     * stream 実体がまだ存在しない開始直後の間、getStreamInfos() 等に応答するための
     * 仮の stream 種別。呼び出し元（実際に生成する stream の種別を知っている側）が
     * 確定した値をそのまま渡す。
     */
    readonly pendingInfoType: RecordedStreamInfo['type'];
    readonly playPosition: number;
    /**
     * この開始要求が、ディスク上の既存成果物と衝突しない streamId の採番
     * （IStreamIdAllocator 経由）を必要とするかどうか。stream 実体が生成される前に
     * streamId を決める必要があるため、呼び出し元が明示的に渡す。
     */
    readonly usesManagedId: boolean;
    readonly videoFileId: number;
    configure(stream: IRecordedStreamBaseModel, source: RecordedPlaybackSource): void;
}

/**
 * `startRecorded` が成功した際に返す、生成された stream とその streamId の組。
 */
export interface RecordedStreamStartResult {
    readonly stream: IRecordedStreamBaseModel;
    readonly streamId: apid.StreamId;
}

/**
 * 複数の配信（ライブ・録画済み、配信方式を問わない）の生存期間を集中管理する。
 * 個々の stream の実装差異（`IStreamBaseModel#ownsDiskArtifacts()` 等の契約越し以外）を
 * 意識せず、streamId の払い出し・停止・情報照会のみを責務とする。
 */
export default interface IStreamManageModel {
    /**
     * setOption() 済みの stream を受け取り、streamId を払い出して開始する。
     * @param stream setOption() した状態で渡す。
     * @returns 払い出された streamId。
     */
    start(stream: IStreamBaseModel<any>): Promise<apid.StreamId>;
    /**
     * 録画済み配信元（`RecordedDeliveryLeaseConsumer` 経由の再生用リース）を取得してから
     * stream を生成・開始する。stream 本体を先に用意できない（配信元取得が先に必要な）
     * 録画済み配信専用の開始経路。
     * @param streamProvider リース取得に成功した後で stream 実体を生成する factory。
     * @param option 開始に必要な option（`configure` で取得した stream へ配信元を注入する）。
     * @param consumer 省略時は DI で注入された既定の consumer を使う（test 等での差し替え用）。
     */
    startRecorded(
        streamProvider: () => Promise<IRecordedStreamBaseModel>,
        option: RecordedStreamStartOption,
        consumer?: Pick<RecordedDeliveryLeaseConsumer, 'acquireAndOpen'>,
    ): Promise<RecordedStreamStartResult>;
    /**
     * stream を生成せず、録画済み配信元のリースだけを取得する（直接配信用途向け）。
     * @param isActive リース取得の途中で呼び出し元がまだ有効かを確認するための callback。
     *                 省略時は常に有効として扱う。
     * @param consumer 省略時は DI で注入された既定の consumer を使う。
     */
    acquireRecordedDelivery(
        videoFileId: number,
        playPosition: number,
        isActive?: () => boolean,
        consumer?: Pick<RecordedDeliveryLeaseConsumer, 'acquireAndOpen'>,
    ): Promise<AcquiredRecordedDeliverySource>;
    /**
     * 指定した stream を停止する。存在しない streamId は無視する。
     * @param isForce 停止処理の優先度を上げ、他の待機中処理より先に完了させる。
     */
    stop(streamId: apid.StreamId, isForce?: boolean): Promise<void>;
    /**
     * 管理下の全ての stream を停止する。
     */
    stopAll(): Promise<void>;
    /**
     * 指定した stream の自動停止タイマーを再セットし、継続を要求する。
     */
    keep(streamId: apid.StreamId): void;
    /**
     * 指定した stream の現在の配信情報を返す。存在しなければ例外を投げる。
     */
    getStreamInfo(streamId: apid.StreamId): LiveStreamInfo | RecordedStreamInfo;
    /**
     * 管理下の全ての stream の配信情報を返す。
     */
    getStreamInfos(): StreamInfoWithStreamId[];
}
