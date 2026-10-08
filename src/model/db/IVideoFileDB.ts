import type * as apid from '../../../api.js';
import VideoFile from '../../db/entities/VideoFile.js';

/**
 * `updateFilePath` でビデオファイルの保存場所を更新する際に渡すオプション。
 * 保存先（parentDirectoryName）の変更とファイルパスの変更をまとめて指定する。
 */
export interface UpdateFilePathOption {
    videoFileId: apid.VideoFileId;
    parentDirectoryName: string;
    filePath: string;
}

/**
 * 録画済み番組の実体ファイル（元ファイル・エンコード済みファイル）のメタ情報の
 * 永続化を担う DB 層の契約。実装は `VideoFileDB`。
 */
export default interface IVideoFileDB {
    /**
     * バックアップされたビデオファイル情報一覧で DB を全件洗い替えする。
     * @param items 復元するビデオファイル情報の一覧
     */
    restore(items: VideoFile[]): Promise<void>;
    /**
     * ビデオファイル情報を 1 件挿入する。
     * @param videoFile 挿入するビデオファイル情報
     * @returns 挿入された行の id
     */
    insertOnce(videoFile: VideoFile): Promise<apid.VideoFileId>;
    /**
     * ビデオファイルの保存先ディレクトリ名とファイルパスを更新する。ファイルの
     * 移動（保存先の切り替え等）に追従して DB 上の記録を合わせるために使う。
     * @param option 更新対象の id と変更後の保存先・パス
     */
    updateFilePath(option: UpdateFilePathOption): Promise<void>;
    /**
     * ビデオファイルのサイズを更新する。
     * @param videoFileId 更新対象の id
     * @param size 変更後のファイルサイズ（バイト数）
     */
    updateSize(videoFileId: apid.VideoFileId, size: number): Promise<void>;
    /**
     * ビデオファイル情報を 1 件削除する。
     * @param VideoFileId 削除対象の id
     */
    deleteOnce(VideoFileId: apid.VideoFileId): Promise<void>;
    /**
     * 指定した録画情報に紐づくビデオファイル情報をまとめて削除する。録画情報自体の
     * 削除に追従してビデオファイルも消すために使う。
     * @param recordedId 対象の録画情報 id
     */
    deleteRecordedId(recordedId: apid.RecordedId): Promise<void>;
    /**
     * id を指定してビデオファイル情報を取得する。
     * @param videoFileId 検索対象の id
     * @returns 該当するビデオファイル情報。存在しない場合は `null`
     */
    findId(videoFileId: apid.VideoFileId): Promise<VideoFile | null>;
    /**
     * 登録済みのビデオファイル情報を全件取得する。
     * @returns ビデオファイル情報の一覧
     */
    findAll(): Promise<VideoFile[]>;
}
