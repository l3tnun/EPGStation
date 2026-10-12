import type * as apid from '../../../../api.js';

/** 予約（`Reserve`）の作成・編集・取得・取り消しを行うAPI層の契約。実装は`ReserveApiModel`。 */
export default interface IReserveApiModel {
    /**
     * 手動予約を追加する。
     * @param option 予約対象番組・録画設定。
     * @returns 作成された予約のID。
     */
    add(option: apid.ManualReserveOption): Promise<apid.ReserveId>;
    /**
     * 既存の予約を編集する。
     * @param reserveId 対象予約のID。
     * @param option 編集後の予約内容。
     */
    edit(reserveId: apid.ReserveId, option: apid.EditManualReserveOption): Promise<void>;
    /**
     * 予約1件を取得する。
     * @param reserveId 対象予約のID。
     * @param isHalfWidth 半角文字の項目を採用するか。
     * @returns 該当予約。存在しなければ`null`。
     */
    get(reserveId: apid.ReserveId, isHalfWidth: boolean): Promise<apid.ReserveItem | null>;
    /**
     * 条件・ページングを指定して予約一覧を取得する。
     * @param option 検索条件・ページング指定。
     * @returns 該当予約一覧。
     */
    gets(option: apid.GetReserveOption): Promise<apid.Reserves>;
    /**
     * 条件を指定して予約一覧を取得する（`gets`と異なり、正常・競合・重複等の種別ごとに分けて返す）。
     * @param option 検索条件。
     * @returns 種別ごとに分けた予約一覧。
     */
    getLists(option: apid.GetReserveListsOption): Promise<apid.ReserveLists>;
    /** @returns 正常・競合・重複・スキップそれぞれの予約件数。 */
    getCnts(): Promise<apid.ReserveCnts>;
    /**
     * 予約を取り消す。
     * @param reserveId 対象予約のID。
     */
    cancel(reserveId: apid.ReserveId): Promise<void>;
    /**
     * スキップ状態の予約を、スキップ扱いから元に戻す。
     * @param reserveId 対象予約のID。
     */
    removeSkip(reserveId: apid.ReserveId): Promise<void>;
    /**
     * 重複状態の予約を、重複扱いから元に戻す。
     * @param reserveId 対象予約のID。
     */
    removeOverlap(reserveId: apid.ReserveId): Promise<void>;
    /** 全ルール予約を最新の番組情報に基づいて再計算し、予約内容を更新する。 */
    updateAll(): Promise<void>;
}
