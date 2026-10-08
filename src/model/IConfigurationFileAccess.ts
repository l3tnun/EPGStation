/**
 * 設定ファイル（config.yml）の変更を検知した際に呼ばれるコールバック。引数は無く、
 * 変更があったこと自体だけを通知する。
 */
export type ConfigurationChangeListener = () => void;

/**
 * 設定ファイルの実 I/O（読み込み・変更監視）を Node.js の `fs` から切り離すための契約。
 * `Configuration` から利用され、テスト時には差し替え用の実装に置き換えられる。
 * 実装は `ConfigurationFileAccess`。
 */
export default interface IConfigurationFileAccess {
    /** 実際に読み込む設定ファイル（config.yml）の絶対パス。 */
    readonly configPath: string;
    /** 設定ファイルが存在しない場合の雛形として使うテンプレートファイルの絶対パス。 */
    readonly templatePath: string;
    /**
     * 指定したファイルを同期的に読み込む。
     * @param path 読み込むファイルの絶対パス
     * @returns ファイルの内容（UTF-8 文字列）
     */
    readSync(path: string): string;
    /**
     * 指定したファイルを非同期に読み込む。
     * @param path 読み込むファイルの絶対パス
     * @returns ファイルの内容（UTF-8 文字列）
     */
    read(path: string): Promise<string>;
    /**
     * 指定したファイルの変更監視を開始する。
     * @param path 監視対象のファイルの絶対パス
     * @param listener 変更を検知した際に呼ばれるコールバック
     */
    watch(path: string, listener: ConfigurationChangeListener): void;
    /**
     * `watch` で開始した変更監視を停止する。
     * @param path 監視を止める対象のファイルの絶対パス
     * @param listener 解除対象のコールバック（`watch` に渡したものと同一の参照である必要がある）
     */
    unwatch(path: string, listener: ConfigurationChangeListener): void;
}
