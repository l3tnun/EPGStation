import type * as apid from '../../../api.js';
import Thumbnail from '../../db/entities/Thumbnail.js';

/**
 * 録画済み番組から生成されたサムネイル画像情報の永続化を担う DB 層の契約。
 * 画像本体はファイルシステム上にあり、ここで扱うのはそのメタ情報。実装は `ThumbnailDB`。
 */
export default interface IThumbnailDB {
    /**
     * バックアップされたサムネイル情報一覧で DB を全件洗い替えする。
     * @param items 復元するサムネイル情報の一覧
     */
    restore(items: Thumbnail[]): Promise<void>;
    /**
     * サムネイル情報を 1 件挿入する。
     * @param thumbnail 挿入するサムネイル情報
     * @returns 挿入された行の id
     */
    insertOnce(thumbnail: Thumbnail): Promise<apid.ThumbnailId>;
    /**
     * サムネイル情報を 1 件削除する。
     * @param thumbnailId 削除対象の id
     */
    deleteOnce(thumbnailId: apid.ThumbnailId): Promise<void>;
    /**
     * 指定した録画情報に紐づくサムネイル情報をまとめて削除する。録画情報自体の削除に
     * 追従してサムネイルも消すために使う。
     * @param recordedId 対象の録画情報 id
     */
    deleteRecordedId(recordedId: apid.RecordedId): Promise<void>;
    /**
     * id を指定してサムネイル情報を取得する。
     * @param thumbnailId 検索対象の id
     * @returns 該当するサムネイル情報。存在しない場合は `null`
     */
    findId(thumbnailId: apid.ThumbnailId): Promise<Thumbnail | null>;
    /**
     * 登録済みのサムネイル情報を全件取得する。
     * @returns サムネイル情報の一覧
     */
    findAll(): Promise<Thumbnail[]>;
}
