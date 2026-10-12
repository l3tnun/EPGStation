import type * as apid from '../../../../api.js';

/** 録画保存先ストレージの空き容量情報を取得するAPI層の契約。実装は`StorageApiModel`。 */
export default interface IStorageApiModel {
    /** @returns 設定されている保存先ごとの容量・空き容量情報。 */
    getInfo(): Promise<apid.StorageInfo>;
}
