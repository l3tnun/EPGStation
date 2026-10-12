import ILogger from './ILogger.js';

/**
 * log4js の初期化と、初期化済み logger の取得を担う契約。プロセス起動時に一度だけ
 * `initialize` を呼び、以降は `getLogger` で得た `ILogger` を各所で使い回す想定。
 * 実装は `LoggerModel`。
 */
export default interface ILoggerModel {
    /**
     * log4js の設定を読み込み、logger を初期化する。設定ファイルの内容不備や読み込み
     * 失敗時はプロセスを終了する。
     * @param filePath log4js 設定ファイル（yaml）のパス。省略時はコンソール出力のみの既定設定を使う
     */
    initialize(filePath?: string): void;
    /**
     * 初期化済みの logger を取得する。`initialize` を呼ぶ前に呼び出された場合は
     * プロセスを終了する。
     * @returns 用途別（system/access/stream/encode）の logger をまとめた `ILogger`
     */
    getLogger(): ILogger;
}
