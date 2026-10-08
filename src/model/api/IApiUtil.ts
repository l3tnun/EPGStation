import { KodiInfo } from '../IConfigFile.js';

/** `createM3U8PlayListStr`が参照するm3u8生成用の情報。 */
export interface CreateM3U8Option {
    host: string;
    isSecure: boolean;
    name: string;
    duration: number;
    baseUrl: string; // http://host 以下の url
}

/** API層で共通に使う雑多なユーティリティの契約（m3u8生成、サブディレクトリ付きhost組み立て、Kodiへの再生指示送信）。実装は`ApiUtil`。 */
export default interface IApiUtil {
    /**
     * ストリームの再生用m3u8プレイリスト文字列を組み立てる。
     * @param option 再生対象のhost・スキーム・タイトル・再生用パス等。
     * @returns m3u8形式のプレイリスト文字列。
     */
    createM3U8PlayListStr(option: CreateM3U8Option): string;
    /**
     * 設定されたサブディレクトリ（`subDirectory`）を反映したhostを組み立てる。
     * @param baseHost サブディレクトリ反映前のhost。
     * @returns `subDirectory`が未設定なら`baseHost`をそのまま、設定されていればそれを連結したhost。
     */
    getHost(baseHost: string): string;
    /**
     * Kodiへ動画の再生を指示する（`Player.Open` JSON-RPC）。認証情報が設定されていれば付与し、一定時間応答が無ければ要求を中断してエラーにする。
     * @param source Kodiに開かせる動画のURL。
     * @param kodiInfo 送信先Kodiのhost・認証情報。
     */
    sendToKodi(source: string, kodiInfo: KodiInfo): Promise<void>;
}
