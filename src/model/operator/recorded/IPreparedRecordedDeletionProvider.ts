import type * as apid from '../../../../api.js';
declare const preparedRecordedDeletionTokenBrand: unique symbol;
/**
 * `prepareUserDeletion` が発行し `deletePrepared` に渡すことで、実際の削除を許可する印。
 * 中身を持たない brand 型で、`prepareUserDeletion` を経由せず直接値を作ることはできない
 * （prepare で検証済みの状態からしか削除を実行できないようにするための型的な強制）。
 */
export type PreparedRecordedDeletionToken = {
    readonly [preparedRecordedDeletionTokenBrand]: never;
};

/**
 * `prepareUserDeletion` の結果。削除可能であれば `prepared` として token と、
 * 削除前後で呼び出し側が必要とする付随情報（録画中かどうか、紐づく予約 id）を返す。
 */
export type UserDeletionPreparation =
    | { readonly status: 'not-found' }
    | { readonly status: 'protected' }
    | {
          readonly status: 'prepared';
          readonly token: PreparedRecordedDeletionToken;
          readonly isRecording: boolean;
          readonly reserveId: apid.ReserveId | null;
      };

/**
 * ユーザー操作による録画削除を、確認（prepare）と実行（commit）の 2 段階に分ける契約。
 * `prepare` と `delete` の間で、呼び出し側（`ParentUserDeletionCoordinator`）が録画中の
 * 予約を止める等の非同期処理を挟めるようにし、その間に状態が変わっていないかを
 * `deletePrepared` 側で再検証する。実装は `RecordedManageModel`。
 */
export default interface IPreparedRecordedDeletionProvider {
    /**
     * 録画情報が削除可能かを検証し、可能であれば削除用の token を発行する。
     * @param recordedId 削除対象の録画情報 id
     * @returns 存在しない・保護されている場合はその旨。削除可能なら token と付随情報を含む `prepared`
     */
    prepareUserDeletion(recordedId: apid.RecordedId): Promise<UserDeletionPreparation>;
    /**
     * `prepareUserDeletion` で発行された token を使って、実際に録画情報と実体ファイルを削除する。
     * 発行時から状態（録画中フラグ・予約 id）が変わっていた場合は例外を投げる。
     * @param token `prepareUserDeletion` が返した token
     */
    deletePrepared(token: PreparedRecordedDeletionToken): Promise<void>;
}
