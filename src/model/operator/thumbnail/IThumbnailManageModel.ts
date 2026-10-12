import type * as apid from '../../../../api.js';

/**
 * 録画済み番組から生成するサムネイル画像の、生成キュー管理・削除・再生成・
 * 孤立ファイルの掃除を担う契約。実装は `ThumbnailManageModel`。
 */
export default interface IThumbnailManageModel {
    /**
     * 指定したビデオファイルからサムネイル画像を生成するようキューへ追加する。
     * キューの待機件数上限（`thumbnailMaxPending`）を超えている場合は例外を投げる。
     * @param videoFileId 生成元となるビデオファイルの id
     */
    add(videoFileId: apid.VideoFileId): void;
    /**
     * サムネイル情報を DB・実ファイルの双方から削除する。
     * @param thumbnailId 削除対象のサムネイル id
     */
    delete(thumbnailId: apid.ThumbnailId): Promise<void>;
    /** サムネイルを持たない録画済み番組を洗い出し、まとめて再生成する。 */
    regenerate(): Promise<void>;
    /** DB 上のサムネイル情報のうち実ファイルが存在しないものを削除し、対応関係を整合させる。 */
    fileCleanup(): Promise<void>;
}
