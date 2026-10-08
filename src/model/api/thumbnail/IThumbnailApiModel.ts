import type * as apid from '../../../../api.js';

/** サムネイル画像の取得・再生成・追加・削除を行うAPI層の契約。実装は`ThumbnailApiModel`。 */
export default interface IThumbnailApiModel {
    /**
     * サムネイル画像の絶対パスを取得する。
     * @param thumbnailId 対象サムネイルのID。
     * @returns サムネイル画像の絶対パス。該当サムネイルが存在しなければ`null`。
     */
    getIdFilePath(thumbnailId: apid.ThumbnailId): Promise<string | null>;
    /** 未生成・欠損しているサムネイルを再生成する。 */
    regenerate(): Promise<void>;
    /** 実体の無いサムネイルファイルのDBレコードを掃除する。 */
    fileCleanup(): Promise<void>;
    /**
     * 指定したビデオファイルのサムネイルを新規に生成させる。
     * @param videoFileId 対象ビデオファイルのID。
     */
    add(videoFileId: apid.VideoFileId): Promise<void>;
    /**
     * サムネイルを削除する。
     * @param thumbnailId 対象サムネイルのID。
     */
    delete(thumbnailId: apid.ThumbnailId): Promise<void>;
}
