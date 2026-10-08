import type * as apid from '../../../../api.js';

/** 番組表（EPG）の取得・検索を行うAPI層の契約。実装は`ScheduleApiModel`。 */
export default interface IScheduleApiModel {
    /**
     * 番組1件の情報を取得する。
     * @param programId 対象番組のID。
     * @param isHalfWidth 番組名・番組詳細を半角文字で返すか。
     * @returns 該当番組。存在しなければ`null`。
     */
    getSchedule(programId: apid.ProgramId, isHalfWidth: boolean): Promise<apid.ScheduleProgramItem | null>;
    /**
     * 条件を指定して番組表を取得する。
     * @param option 取得対象の種別（地上波/BS等）・日時範囲等の条件。
     * @returns チャンネルごとの番組一覧。
     */
    getSchedules(option: apid.ScheduleOption): Promise<apid.Schedule[]>;
    /**
     * 指定チャンネルの番組表を取得する。
     * @param option 対象チャンネル・日時範囲等の条件。
     * @returns 指定チャンネルの番組一覧。
     */
    getChannelSchedule(option: apid.ChannelScheduleOption): Promise<apid.Schedule[]>;
    /**
     * 現在放送中の番組表を取得する。
     * @param option 取得対象の種別等の条件。
     * @returns 放送中番組の一覧。
     */
    getBroadcastingSchedule(option: apid.BroadcastingScheduleOption): Promise<apid.Schedule[]>;
    /**
     * ルール検索条件に一致する番組を検索する（ルール新規作成時のプレビュー等に使う）。
     * @param option キーワード・ジャンル等の検索条件。
     * @param isHalfWidth 番組名・番組詳細を半角文字で返すか。
     * @param limit 取得件数の上限。未指定の場合は実装側の既定値が使われる。
     * @returns 該当番組の一覧。
     */
    search(option: apid.RuleSearchOption, isHalfWidth: boolean, limit?: number): Promise<apid.ScheduleProgramItem[]>;
}
