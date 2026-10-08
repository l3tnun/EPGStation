import type * as apid from '../../../../api.js';

/** `IEncoderModel`1個分のencode依頼内容。`apid.AddEncodeProgramOption`（呼び出し元からの依頼内容）に、
 *  `IEncodeManageModel`が発行した`encodeId`を加えたもの。 */
export interface EncodeOption extends apid.AddEncodeProgramOption {
    encodeId: apid.EncodeId;
}

/** encode実行中の進捗。`percent`はencode process側の出力を解析して得られる概算値、`log`は
 *  直近の出力ログ行。 */
export interface EncodeProgressInfo {
    percent: number;
    log: string;
}

/** `IEncoderModel`のインスタンスをDI経由で1つ生成するための関数型。`IEncodeManageModel`は
 *  encodeをqueueへ積むたびにこれを呼び、encode1件につき1つの`IEncoderModel`インスタンスを使う。 */
export type EncoderModelProvider = () => Promise<IEncoderModel>;

/**
 * encode1件分の実行を担う契約。実装は`EncoderModel`で、実際のencode子processの起動・監視・停止を行う。
 * `IEncodeManageModel`がqueue管理のために1件ずつ生成・保持し、`setOption`→`start`の順で使う
 * （`setOption`は1インスタンスにつき1回のみ許され、2回目の呼び出しは例外を投げる）。
 */
export interface IEncoderModel {
    /**
     * encodeを開始する前に、対象・設定を確定させる。
     * @param encodeOption 実行するencodeの内容。
     */
    setOption(encodeOption: EncodeOption): void;
    /**
     * encode終了（成功・失敗を問わない）を1回だけ通知するcallbackを登録する。
     * @param callback 終了時に呼ばれる。`isError`が`true`なら失敗、`outputFilePath`は
     *                 成功時の出力fileパス（失敗時は`null`）。
     */
    setOnFinish(callback: (isError: boolean, outputFilePath: string | null) => void): void;
    /**
     * `setOption`で設定済みのencodeを開始する。`encodeOption`が未設定の場合は例外を投げる。
     */
    start(): Promise<void>;
    /** 実行中のencode processへ停止を要求する。既に完了・未開始の場合は何もしない。 */
    cancel(): Promise<void>;
    /** `setOption`で設定済みのencode内容を返す。未設定なら`null`。 */
    getEncodeOption(): EncodeOption | null;
    /** 直近の進捗情報を返す。encode開始前、または進捗情報が1度も届いていなければ`null`。 */
    getProgressInfo(): EncodeProgressInfo | null;
    /** このencoderが担当しているencodeIDを返す。`setOption`未設定なら`null`。 */
    getEncodeId(): apid.EncodeId | null;
}
