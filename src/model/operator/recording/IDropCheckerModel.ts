import aribts from 'aribts';
import * as stream from 'stream';

/**
 * 録画中の TS ストリームを監視し、パケットのドロップ・エラー・スクランブル状況を
 * 集計する契約。1 回の録画につき 1 インスタンスを生成し、`prepare`・`attach`〜`stop` の間に
 * 集計したログをファイルへ書き出す。実装は `DropCheckerModel`（aribts を使用）。
 */
export default interface IDropCheckerModel {
    /**
     * ドロップチェックの準備をする。ログファイルを新規作成する。ストリームには触れない。
     * @param logDirPath ログファイルの保存先ディレクトリ
     * @param srcFilePath 元になる録画ファイルのパス（ログファイル名の生成に使う）
     */
    prepare(logDirPath: string, srcFilePath: string): Promise<void>;
    /**
     * ドロップチェックを開始する。`prepare` の後に、await を挟まず同期的にストリームへ繋ぎ、
     * 以降の内容を解析し続ける。録画ファイルへの pipe と同じ tick で呼ぶことで、
     * 先頭の chunk を録画ファイルと同じ位置から受け取る。
     * @param srcFilePath 元になる録画ファイルのパス
     * @param readableStream 監視対象の TS ストリーム
     */
    attach(srcFilePath: string, readableStream: stream.Readable): void;
    /** ドロップチェックを終了し、監視していたストリームから切り離す。 */
    stop(): Promise<void>;
    /**
     * 生成したログファイルのパスを取得する。
     * @returns `prepare` 未実行、または失敗している場合は `null`
     */
    getFilePath(): string | null;
    /**
     * 集計結果を取得する。呼び出し時点で終了処理が済んでいなければ完了を待ってから返す。
     * @returns ドロップ・エラー・スクランブルの集計結果
     */
    getResult(): Promise<aribts.Result>;
}
