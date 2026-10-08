import type * as apid from '../../../../api.js';

/** client へ配布する設定情報を組み立てるAPI層の契約。実装は`ConfigApiModel`。 */
export default interface IConfigApiModel {
    /**
     * client 向け設定情報を取得する。
     * @param isSecure 接続が https（またはそれに準ずる安全な経路）かどうか。値によって client へ返すURLのスキーム等が変わる。
     * @returns client へ配布する設定情報。
     */
    getConfig(isSecure: boolean): Promise<apid.Config>;
}
