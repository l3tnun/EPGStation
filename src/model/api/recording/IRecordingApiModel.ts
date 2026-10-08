import type * as apid from '../../../../api.js';

/** 録画中番組の一覧取得・タイマー再設定を行うAPI層の契約。実装は`RecordingApiModel`。 */
export default interface IRecordingApiModel {
    /**
     * 条件を指定して、録画中の番組一覧を取得する。
     * @param option 検索条件・ページング指定。
     * @returns 該当する録画中番組の一覧。
     */
    gets(option: apid.GetRecordedOption): Promise<apid.Records>;
    /** 全録画のタイマー（開始・終了予定時刻）を、最新の番組情報に基づいて再設定する。 */
    resetTimer(): Promise<void>;
}
