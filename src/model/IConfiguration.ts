import IConfigFile from './IConfigFile.js';

/**
 * 読み込み済みの設定ファイル（config.yml）内容へのアクセスを提供する契約。
 * config.yml は起動時（および変更検知時）に読み込まれ、それ以降アプリケーション全体から
 * この interface 経由で参照される。実装は `Configuration`。
 */
export default interface IConfiguration {
    /**
     * 現在有効な設定内容を取得する。
     * @returns パース済みの設定内容
     */
    getConfig(): IConfigFile;
}
