import type * as apid from '../../../api.js';

/**
 * サムネイル画像の変化を、発生元（サムネイル管理）から他の module へ通知するための
 * event の契約。`emitXxx` は発生元が呼び出してイベントを発行し、`setXxx` は購読側が
 * コールバックを登録する。実装は `ThumbnailEvent`。
 */
export default interface IThumbnailEvent {
    /**
     * サムネイルが生成・追加されたことを通知する。
     * @param videoFileId 元になったビデオファイルの id
     * @param recordedId サムネイルの追加先となる録画情報の id
     */
    emitAdded(videoFileId: apid.VideoFileId, recordedId: apid.RecordedId): void;
    /** サムネイルが削除されたことを通知する。 */
    emitDeleted(): void;
    /**
     * `emitAdded` を購読する。
     * @param callback 元のビデオファイル id と録画情報 id を受け取るコールバック
     */
    setAdded(callback: (videoFileId: apid.VideoFileId, recordedId: apid.RecordedId) => void): void;
    /**
     * `emitDeleted` を購読する。
     * @param callback 削除時に呼ばれるコールバック
     */
    setDeleted(callback: () => void): void;
}
