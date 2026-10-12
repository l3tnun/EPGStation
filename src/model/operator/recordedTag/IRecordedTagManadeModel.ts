import type * as apid from '../../../../api.js';

/**
 * 録画タグ（RecordedTag）の作成・更新・削除と、録画情報との関連付けを行う契約。
 * `IRecordedTagDB` への永続化と `IRecordedTagEvent` による変更通知をまとめて行う
 * 上位層（rule 管理・API から呼ばれる）向けの窓口。実装は `RecordedTagManadeModel`。
 */
export default interface IRecordedTagManadeModel {
    /**
     * タグを新規作成する。
     * @param name タグの表示名
     * @param color タグの表示色
     * @returns 作成されたタグの id
     */
    create(name: string, color: string): Promise<apid.RecordedTagId>;
    /**
     * タグの名前と色を更新する。
     * @param tagId 更新対象のタグ id
     * @param name 変更後の表示名
     * @param color 変更後の表示色
     */
    update(tagId: apid.RecordedTagId, name: string, color: string): Promise<void>;
    /**
     * タグを録画情報に関連付ける。
     * @param tagId 関連付けるタグ id
     * @param recordedId 関連付け先の録画情報 id
     */
    setRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
    /**
     * タグを削除する。
     * @param tagId 削除対象のタグ id
     */
    delete(tagId: apid.RecordedTagId): Promise<void>;
    /**
     * タグと録画情報の関連付けを解除する。
     * @param tagId 対象のタグ id
     * @param recordedId 対象の録画情報 id
     */
    deleteRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
}
