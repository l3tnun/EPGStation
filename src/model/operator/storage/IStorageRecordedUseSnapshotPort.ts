import type * as apid from '../../../../api.js';

/** 現在使用中（録画中または再生中）の録画ID一覧のsnapshot。`'unknown'`は取得元
 *  （録画側・service child側のいずれか）が未接続、timeout、例外等で確定できなかったことを表し、
 *  この場合は空集合ではなく「安全側に倒して削除候補から一切除外できない」ことを意味する。 */
export type StorageRecordedUseSnapshot =
    { readonly status: 'known'; readonly recordedIds: ReadonlySet<apid.RecordedId> } | { readonly status: 'unknown' };

/**
 * 削除候補から除外すべき「現在使用中の録画」の一覧を取得する契約。実装は`StorageRecordedUseSnapshotAdapter`で、
 * 録画中（`RecordingRecordedUseSnapshotProvider`）とservice child側（再生等、`RecordedUseSnapshotClient`
 * 経由でIPCを跨いで問い合わせる）の2つの情報源を集約する。`StorageManageModel`が削除候補を選ぶ前に呼び出す。
 */
export default interface IStorageRecordedUseSnapshotPort {
    /**
     * 現在使用中の録画ID一覧を取得する。
     * @returns 使用中録画IDのsnapshot。いずれかの情報源から確定した値が得られない場合は`'unknown'`
     *          （呼び出し側は`'unknown'`の場合、削除処理自体を中断する想定）。
     */
    getSnapshot(): Promise<StorageRecordedUseSnapshot>;
}
