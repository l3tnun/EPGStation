import { FinishEncodeInfo } from '../../event/IEncodeEvent.js';

/**
 * encode処理の完了・追加・キャンセル等のイベントを受けて、クライアントへの通知やencode管理側への
 * 状態反映を行う契約。実装は`EncodeFinishModel`。`IEncodeEvent`へ自身のhandlerを登録する側であり、
 * `IEncodeManageModel`から直接呼ばれるのは`finishEncode`のみ。
 */
export default interface IEncodeFinishModel {
    /** `IEncodeEvent`へ各種encodeイベントのhandlerを登録する。DI解決後、起動時に1度だけ呼ぶ想定。 */
    set(): void;
    /**
     * encode完了処理。`IEncodeManageModel`が保持するqueueの状態更新後に呼ばれる想定で、
     * `IEncodeEvent`経由の`finishEncode`イベントとは別に、明示的な後始末として呼び出せる。
     * @param info 完了したencodeの内容（対象録画、成否、出力file等）。
     */
    finishEncode(info: FinishEncodeInfo): Promise<void>;
}
