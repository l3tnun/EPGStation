import type * as apid from '../../../../api.js';
import { EncodeQueueRecord } from '../../operator/encode/IEncodeQueueStore.js';

/**
 * Web・API 側処理（service child）から見た依頼記録窓口。記録への書き込みは管理側（親 process）の
 * `EncodeQueueStore` だけが行うため、実装はプロセス間通信（`IPCClient.encodeQueue`）へ渡す。
 */
export default interface IEncodeQueueStorePort {
    /**
     * 識別番号を割り当てて依頼を記録する。
     * @param option 依頼内容
     * @param requestToken 要求ごとに作る値。応答を受け取れなかったときに `abandon` へ渡す
     * @returns 割り当てられた識別番号
     */
    add(option: apid.AddEncodeProgramOption, requestToken: string): Promise<apid.EncodeId>;
    /**
     * `add` の応答を受け取れなかった要求で作られた記録を取り消す。
     * @param requestToken `add` に渡した値
     */
    abandon(requestToken: string): Promise<void>;
    /**
     * 記録へ出力先を加える。
     * @param encodeId 対象の識別番号
     * @param outputPath 出力ファイルの full path
     */
    updateOutputPath(encodeId: apid.EncodeId, outputPath: string): Promise<void>;
    /**
     * 記録を削除する。
     * @param encodeId 対象の識別番号
     */
    remove(encodeId: apid.EncodeId): Promise<void>;
    /**
     * 記録を受け付け順に並べて取得する。
     * @returns 記録の一覧
     */
    list(): Promise<EncodeQueueRecord[]>;
}
