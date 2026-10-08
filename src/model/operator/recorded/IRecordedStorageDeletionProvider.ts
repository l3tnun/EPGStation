import type * as apid from '../../../../api.js';
/**
 * `prepareStorageDeletion` が削除を拒否した理由。ストレージ容量確保のための自動削除
 * （ユーザー操作ではない）を行う `StoragePressureDeletionAdapter` が、拒否理由に応じて
 * 次の削除候補へ移るかどうかを判断するために使う。
 */
export type StorageDeletionNotDeletedReason =
    'recorded-not-found' | 'protected' | 'recording-active' | 'no-video-relations' | 'storage-mismatch';

declare const storageDeletionPreparationTokenBrand: unique symbol;
/**
 * `prepareStorageDeletion` が発行し `deletePreparedForStorage` に渡すことで、実際の削除を
 * 許可する印。中身を持たない brand 型で、prepare を経由せず直接値を作ることはできない。
 */
export type StorageDeletionPreparationToken = {
    readonly [storageDeletionPreparationTokenBrand]: never;
};

/**
 * `prepareStorageDeletion` の結果。
 */
export type StorageDeletionPreparation =
    | { readonly status: 'not-deleted'; readonly reason: StorageDeletionNotDeletedReason }
    | { readonly status: 'prepared'; readonly token: StorageDeletionPreparationToken };

/**
 * 保存先（storage）の空き容量を確保するための自動削除を、確認（prepare）と実行（commit）の
 * 2 段階に分ける契約。ユーザー操作による削除（`IPreparedRecordedDeletionProvider`）とは別に、
 * 対象の storage 名が一致するかどうかの検証（`storage-mismatch`）を持つのが特徴。
 * `prepare` と `delete` の間で、呼び出し側（`StoragePressureDeletionAdapter`）が録画中利用・
 * サービス子プロセス利用の排他制御を挟めるようにする。実装は `RecordedManageModel`。
 */
export default interface IRecordedStorageDeletionProvider {
    /**
     * 指定した録画が、指定した storage から自動削除可能かを検証し、可能であれば
     * 削除用の token を発行する。
     * @param recordedId 削除対象の録画情報 id
     * @param storageName 空き容量を確保したい保存先の名前
     * @returns 拒否理由、または token を含む `prepared`
     */
    prepareStorageDeletion(recordedId: apid.RecordedId, storageName: string): Promise<StorageDeletionPreparation>;
    /**
     * `prepareStorageDeletion` で発行された token を使って、実際に録画情報と実体ファイルを削除する。
     * 発行時から拒否条件に該当する状態へ変わっていた場合は削除を行わない。
     * @param token `prepareStorageDeletion` が返した token
     * @returns 削除できたかどうか
     */
    deletePreparedForStorage(token: StorageDeletionPreparationToken): Promise<'deleted' | 'not-deleted'>;
}
