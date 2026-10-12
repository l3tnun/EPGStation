import type * as apid from '../../../api.js';

/**
 * 追加されたビデオファイル情報
 */
export interface OperatorFinishEncodeInfo {
    recordedId: apid.RecordedId;
    videoFileId: apid.VideoFileId | null;
    mode: string; // エンコードモード名
}

/**
 * operator process側でのエンコード完了通知の窓口。子processからIPC経由で届いたエンコード完了
 * （`EncodeCompletionSink`）を受けて`emitFinishEncode`が発行され、`setFinishEncode`で登録した
 * 購読者へ伝わる。実装は `OperatorEncodeEvent`。
 */
export default interface IOperatorEncodeEvent {
    emitFinishEncode(info: OperatorFinishEncodeInfo): void;
    setFinishEncode(callback: (info: OperatorFinishEncodeInfo) => void): void;
}
