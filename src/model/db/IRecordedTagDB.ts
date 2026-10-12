import type * as apid from '../../../api.js';
import RecordedTag from '../../db/entities/RecordedTag.js';

/**
 * 録画済み番組に付与するタグ（ユーザーが定義する分類ラベル）の永続化と、
 * 録画情報との多対多の関連付けを担う DB 層の契約。実装は `RecordedTagDB`。
 */
export default interface IRecordedTagDB {
    /**
     * バックアップされたタグ一覧で DB を全件洗い替えする。
     * @param items 復元するタグの一覧
     */
    restore(items: RecordedTag[]): Promise<void>;
    /**
     * タグを 1 件挿入する。
     * @param tag 挿入するタグ
     * @returns 挿入された行の id
     */
    insertOnce(tag: RecordedTag): Promise<apid.RecordedTagId>;
    /**
     * タグの名前と色を更新する。
     * @param tagId 更新対象のタグ id
     * @param name 変更後の表示名
     * @param color 変更後の表示色
     */
    updateOnce(tagId: apid.RecordedTagId, name: string, color: string): Promise<void>;
    /**
     * 録画情報にタグを関連付ける。
     * @param tagId 関連付けるタグ id
     * @param recordedId 関連付け先の録画情報 id
     */
    setRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
    /**
     * 録画情報とタグの関連付けを 1 件解除する。
     * @param tagId 解除するタグ id
     * @param recordedId 解除対象の録画情報 id
     */
    deleteRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
    /**
     * 指定した録画情報に付いている、すべてのタグとの関連付けを解除する。
     * @param recordedId 対象の録画情報 id
     */
    deleteAllRelation(recordedId: apid.RecordedId): Promise<void>;
    /**
     * タグを 1 件削除する。
     * @param tagId 削除対象のタグ id
     */
    deleteOnce(tagId: apid.RecordedTagId): Promise<void>;
    /**
     * id を指定してタグを取得する。
     * @param tagId 検索対象のタグ id
     * @returns 該当するタグ。存在しない場合は `null`
     */
    findId(tagId: apid.RecordedTagId): Promise<RecordedTag | null>;
    /**
     * 条件を指定してタグを検索する。
     * @param option 絞り込み・ページングの条件
     * @returns 該当するタグの一覧と、絞り込み条件に一致する総件数の組
     */
    findAll(option: apid.GetRecordedTagOption): Promise<[RecordedTag[], number]>;
}
