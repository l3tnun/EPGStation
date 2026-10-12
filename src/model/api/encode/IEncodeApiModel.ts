import type * as apid from '../../../../api.js';

/** 手動エンコードの投入・状況取得を行うAPI層の契約。実装は`EncodeApiModel`。 */
export default interface IEncodeApiModel {
    /**
     * 実行中・待機中のエンコードキュー情報を取得する。
     * @param isHalfWidth 番組名等を半角文字で返すか。
     * @returns 実行中・待機中それぞれのエンコード項目一覧。
     */
    getAll(isHalfWidth: boolean): Promise<apid.EncodeInfo>;
    /**
     * 手動エンコードをキューへ追加する。
     * @param addOption エンコード対象・出力先・保存先ディレクトリ等の指定。保存先ディレクトリ未指定かつ「録画と同じディレクトリに保存」も指定されていない場合はエラーになる。
     * @returns 追加されたエンコードのID。
     */
    add(addOption: apid.AddManualEncodeProgramOption): Promise<apid.EncodeId>;
    /**
     * 実行中または待機中のエンコードを取り消す。
     * @param encodeId 対象エンコードのID。
     */
    cancel(encodeId: apid.EncodeId): Promise<void>;
}
