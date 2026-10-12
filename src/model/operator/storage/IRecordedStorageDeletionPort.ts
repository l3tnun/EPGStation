import type * as apid from '../../../../api.js';

/** `deleteForStoragePressure`の結果。`'not-deleted'`は、削除準備の失敗や録画・視聴中の競合等、
 *  安全に削除できないと判断して削除を見送ったことを表す（例外は投げない）。 */
export type RecordedStorageDeletionOutcome = 'deleted' | 'not-deleted';

/**
 * 保存先の空き容量不足を解消するために、録画を1件削除する契約。実装は`StoragePressureDeletionAdapter`で、
 * 単なるfile削除ではなく、録画中／再生中（service child側の使用）でないことを排他制御で確認してから
 * 削除する。`StorageManageModel`（`IStorageDeletionCandidatePort`で見つけた削除候補に対して）が呼び出す。
 */
export default interface IRecordedStorageDeletionPort {
    /**
     * 指定した録画を、空き容量確保のために削除する。
     * @param recordedId 削除対象の録画ID。
     * @param storageName 空き容量が不足している保存先の名前（ログ・削除処理の対象保存先の特定に使う）。
     * @returns 実際に削除できたか。録画中・再生中等で安全に削除できない場合は`'not-deleted'`。
     */
    deleteForStoragePressure(recordedId: apid.RecordedId, storageName: string): Promise<RecordedStorageDeletionOutcome>;
}
