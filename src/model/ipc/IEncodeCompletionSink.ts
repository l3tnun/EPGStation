import type * as apid from '../../../api.js';

/** encode完了1件分の通知内容。`videoFileId`はencodeが実際に動画fileを生成した場合のみ値を持ち、
 *  失敗などでfileが生成されなかった場合は`null`。 */
export interface EncodeCompletionInfo {
    readonly recordedId: apid.RecordedId;
    readonly videoFileId: apid.VideoFileId | null;
    readonly mode: string;
}

/**
 * encode process側からのencode完了通知を受け取る契約。実装は`OperatorEncodeEvent`
 * （operator process側）で、IPC越しに`IPCServer.encodeCompletionSinkRegistrationPort`経由で登録される。
 */
export interface EncodeCompletionSink {
    /**
     * encode完了を受け取る。
     * @param info 完了したencodeの内容。
     */
    accept(info: EncodeCompletionInfo): void | Promise<void>;
}

/** `EncodeCompletionSink`の実体を後から1つだけ登録するための窓口。DI時点では循環依存になるため、
 *  constructor注入ではなくこのportを介して結び付ける。 */
export interface EncodeCompletionSinkRegistrationPort {
    register(sink: EncodeCompletionSink): void;
}
