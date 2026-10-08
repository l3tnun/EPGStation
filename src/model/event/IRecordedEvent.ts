import type * as apid from '../../../api.js';
import Recorded from '../../db/entities/Recorded.js';

/**
 * 録画済み番組・その実体ファイル（ビデオファイル・ドロップログ）に関する変化を、
 * 発生元（録画情報管理）から他の module へ通知するための event の契約。`emitXxx` は
 * 発生元が呼び出してイベントを発行し、`setXxx` は購読側がコールバックを登録する。
 * 実装は `RecordedEvent`。
 */
export default interface IRecordedEvent {
    /**
     * 録画情報が削除されたことを通知する。
     * @param recorded 削除された録画情報（削除前の内容）
     */
    emitDeleteRecorded(recorded: Recorded): void;
    /**
     * ビデオファイルのサイズが変わったことを通知する（エンコード完了等でサイズが
     * 確定した際に発火する）。
     * @param videoFileId 対象のビデオファイル id
     */
    emitUpdateVideoFileSize(videoFileId: apid.VideoFileId): void;
    /**
     * 新しい録画情報が作成されたことを通知する（録画開始時）。
     * @param recordedId 作成された録画情報の id
     */
    emitCreateNewRecorded(recordedId: apid.RecordedId): void;
    /**
     * ビデオファイルが追加されたことを通知する（エンコード結果の追加を含む一般的な通知）。
     * @param newVideoFileId 追加されたビデオファイルの id
     */
    emitAddVideoFile(newVideoFileId: apid.VideoFileId): void;
    /**
     * ユーザーがアップロードしたビデオファイルが追加されたことを通知する。
     * `emitAddVideoFile` とは別に、アップロード起因であることを区別するために発火する。
     * @param newVideoFileId 追加されたビデオファイルの id
     * @param needsCreateThumbnail 対象の録画にまだサムネイルが存在せず、生成が必要な場合 `true`
     */
    emitAddUploadedVideoFile(newVideoFileId: apid.VideoFileId, needsCreateThumbnail: boolean): void;
    /**
     * ビデオファイルが削除されたことを通知する。
     * @param videoFileId 削除されたビデオファイルの id
     */
    emitDeleteVideoFile(videoFileId: apid.VideoFileId): void;
    /**
     * 録画情報と drop log file の関連付けが変化したことを通知する（drop log file の
     * 実体が失われて関連付けを解除した場合など）。
     * @param dropLogFileId 対象の drop log file id
     */
    emitDropLogFileChanged(dropLogFileId: apid.DropLogFileId): void;
    /**
     * 録画の保護状態が変更されたことを通知する。
     * @param recordedId 対象の録画情報 id
     * @param isProtected 変更後の保護状態
     */
    emitChangeProtect(recordedId: apid.RecordedId, isProtected: boolean): void;
    /**
     * `emitDeleteRecorded` を購読する。
     * @param callback 削除された録画情報を受け取るコールバック
     */
    setDeleteRecorded(callback: (recorded: Recorded) => void): void;
    /**
     * `emitCreateNewRecorded` を購読する。
     * @param callback 作成された録画情報の id を受け取るコールバック
     */
    setCreateNewRecorded(callback: (recordedId: apid.RecordedId) => void): void;
    /**
     * `emitUpdateVideoFileSize` を購読する。
     * @param callback 対象のビデオファイル id を受け取るコールバック
     */
    setUpdateVideoFileSize(callback: (videoFileId: apid.VideoFileId) => void): void;
    /**
     * `emitAddVideoFile` を購読する。
     * @param callback 追加されたビデオファイルの id を受け取るコールバック
     */
    setAddVideoFile(callback: (newVideoFileId: apid.VideoFileId) => void): void;
    /**
     * `emitAddUploadedVideoFile` を購読する。
     * @param callback 追加されたビデオファイルの id とサムネイル生成要否を受け取るコールバック
     */
    setAddUploadedVideoFile(callback: (newVideoFileId: apid.VideoFileId, needsCreateThumbnail: boolean) => void): void;
    /**
     * `emitDeleteVideoFile` を購読する。
     * @param callback 削除されたビデオファイルの id を受け取るコールバック
     */
    setDeleteVideoFile(callback: (videoFileId: apid.VideoFileId) => void): void;
    /**
     * `emitDropLogFileChanged` を購読する。
     * @param callback 対象の drop log file id を受け取るコールバック
     */
    setDropLogFileChanged(callback: (dropLogFileId: apid.DropLogFileId) => void): void;
    /**
     * `emitChangeProtect` を購読する。
     * @param callback 対象の録画情報 id と変更後の保護状態を受け取るコールバック
     */
    setChangeProtect(callback: (recordedId: apid.RecordedId, isProtected: boolean) => void): void;
}
