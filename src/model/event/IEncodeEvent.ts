import type * as apid from '../../../api.js';

/**
 * `emitFinishEncode` で通知される、エンコード完了時の結果情報。
 */
export interface FinishEncodeInfo {
    recordedId: apid.RecordedId;
    videoFileId: apid.VideoFileId;
    parentDirName: string; // 親ディレクトリ名
    filePath: string | null; // 親ディレクトリ以下のファイルパス
    fullOutputPath: string | null; // 出力したファイルのフルパス
    mode: string; // エンコードモード名
    removeOriginal: boolean; // ts を削除するか
}

/**
 * エンコード処理の進行状況を、発生元（エンコード処理管理）から他の module へ通知するための
 * event の契約。`emitXxx` は発生元が呼び出してイベントを発行し、`setXxx` は購読側が
 * コールバックを登録する。実装は `EncodeEvent`（内部は Node.js の `EventEmitter` を利用）。
 */
export default interface IEncodeEvent {
    /**
     * エンコードがキューに追加されたことを通知する。
     * @param encodeId 追加されたエンコードの id
     */
    emitAddEncode(encodeId: apid.EncodeId): void;
    /**
     * エンコードがキャンセルされたことを通知する。
     * @param encodeId キャンセルされたエンコードの id
     */
    emitCancelEncode(encodeId: apid.EncodeId): void;
    /**
     * エンコードが完了したことを通知する。
     * @param info 完了したエンコードの結果情報
     */
    emitFinishEncode(info: FinishEncodeInfo): void;
    /** エンコード処理でエラーが発生したことを通知する。 */
    emitErrorEncode(): void;
    /** エンコードキューの進捗（実行中・待機中の件数等）が変化したことを通知する。 */
    emitUpdateEncodeProgress(): void;
    /**
     * `emitAddEncode` を購読する。
     * @param callback 追加されたエンコードの id を受け取るコールバック
     */
    setAddEncode(callback: (encodeId: apid.EncodeId) => void): void;
    /**
     * `emitCancelEncode` を購読する。
     * @param callback キャンセルされたエンコードの id を受け取るコールバック
     */
    setCancelEncode(callback: (encodeId: apid.EncodeId) => void): void;
    /**
     * `emitFinishEncode` を購読する。
     * @param callback 完了したエンコードの結果情報を受け取るコールバック
     */
    setFinishEncode(callback: (info: FinishEncodeInfo) => void): void;
    /**
     * `emitErrorEncode` を購読する。
     * @param callback エラー発生時に呼ばれるコールバック
     */
    setErrorEncode(callback: () => void): void;
    /**
     * `emitUpdateEncodeProgress` を購読する。
     * @param callback 進捗変化時に呼ばれるコールバック
     */
    setUpdateEncodeProgress(callback: () => void): void;
}
