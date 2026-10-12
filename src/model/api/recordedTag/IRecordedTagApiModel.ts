import type * as apid from '../../../../api.js';

/** 録画タグ（`RecordedTag`）の作成・録画への付け外しを行うAPI層の契約。実装は`RecordedTagApiModel`。 */
export default interface IRecordedTagApiModel {
    /**
     * タグを新規作成する。
     * @param name タグ名。
     * @param color タグの表示色。
     * @returns 作成されたタグのID。
     */
    create(name: string, color: string): Promise<apid.RecordedTagId>;
    /**
     * タグの名前・色を更新する。
     * @param tagId 対象タグのID。
     * @param name 更新後のタグ名。
     * @param color 更新後の表示色。
     */
    update(tagId: apid.RecordedTagId, name: string, color: string): Promise<void>;
    /**
     * タグを録画に紐づける。
     * @param tagId 対象タグのID。
     * @param recordedId 紐づける録画のID。
     */
    setRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
    /**
     * タグそのものを削除する（紐づく全ての録画との関連も解除される）。
     * @param tagId 対象タグのID。
     */
    delete(tagId: apid.RecordedTagId): Promise<void>;
    /**
     * タグと録画の紐づけのみを解除する（タグ自体は残る）。
     * @param tagId 対象タグのID。
     * @param recordedId 対象録画のID。
     */
    deleteRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
    /**
     * 条件を指定してタグ一覧を取得する。
     * @param option 検索条件。
     * @returns 該当タグ一覧。
     */
    gets(option: apid.GetRecordedTagOption): Promise<apid.RecordedTags>;
}
