import log4js from 'log4js';

/**
 * 用途別に分けられた log4js logger の集合。`ILoggerModel.getLogger` から取得し、
 * ログの出力先（category）を出力内容の種類ごとに切り替えるために使う。
 */
export default interface ILogger {
    /** 通常のシステム動作ログ（エラー・警告・一般的な処理ログ）。 */
    system: log4js.Logger;
    /** API・HTTP アクセスログ。 */
    access: log4js.Logger;
    /** ストリーミング配信に関するログ。 */
    stream: log4js.Logger;
    /** エンコード処理に関するログ。 */
    encode: log4js.Logger;
}
