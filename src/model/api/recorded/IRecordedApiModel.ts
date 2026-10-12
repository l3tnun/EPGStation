import type * as apid from '../../../../api.js';
import { UploadedVideoFileOption } from '../../operator/recorded/IRecordedManageModel.js';

/** 録画済み番組（`Recorded`）に対するAPI層の契約。実装は`RecordedApiModel`。 */
export default interface IRecordedApiModel {
    /**
     * 条件・ページングを指定して録画一覧を取得する。
     * @param option 検索条件・ページング指定。
     * @returns 該当録画一覧。
     */
    gets(option: apid.GetRecordedOption): Promise<apid.Records>;
    /**
     * 録画1件を取得する。
     * @param recordedId 対象録画のID。
     * @param isHalfWidth 半角文字の項目を採用するか。
     * @returns 該当録画。存在しなければ`null`。
     */
    get(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<apid.RecordedItem | null>;
    /** @returns 録画の検索画面で選択肢として使う、ルール・チャンネル等の一覧。 */
    getSearchOptionList(): Promise<apid.RecordedSearchOptions>;
    /**
     * 録画をユーザー操作として削除する（関連するエンコード等も含めて後始末される）。
     * @param recordedId 対象録画のID。
     */
    delete(recordedId: apid.RecordedId): Promise<void>;
    /**
     * 指定録画に紐づく、実行中または待機中のエンコードを取り消す。
     * @param recordedId 対象録画のID。
     */
    stopEncode(recordedId: apid.RecordedId): Promise<void>;
    /**
     * 録画の保護状態（自動削除対象から外すか）を変更する。
     * @param recordedId 対象録画のID。
     * @param isProtect 保護するなら`true`。
     */
    changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void>;
    /** 実体の無いビデオファイル・ドロップログファイルのDBレコードを掃除する（動画ファイル用・ドロップログ用のクリーンアップを並行実行）。 */
    fileCleanup(): Promise<void>;
    /**
     * アップロード済みの動画ファイルを既存の録画情報に追加登録する。
     * @param option 追加するファイルの情報（保存先・録画ID等）。
     */
    addUploadedVideoFile(option: UploadedVideoFileOption): Promise<void>;
    /**
     * 実際の録画動作を伴わずに、録画番組情報のみを新規作成する（外部で録画済みのファイルを取り込む用途）。
     * @param option 作成する録画情報。
     * @returns 作成された録画のID。
     */
    createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId>;
}
