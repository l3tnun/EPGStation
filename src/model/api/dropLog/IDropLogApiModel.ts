import type * as apid from '../../../../api.js';

/** `DropLogApiModel`が投げる`Error`の`message`に使う識別子。route層はこの文字列でエラー種別を判別する。 */
export namespace DropLogApiErrors {
    /** `getIdFilePath`で対象ファイルのサイズが`maxSize`を超えていた場合に投げられる。 */
    export const FILE_IS_TOO_LARGE = 'FileIsTooLarge';
}
/** drop log（受信時のドロップ・スクランブル情報）ファイルの実体を取得するAPI層の契約。実装は`DropLogApiModel`。 */
export default interface IDropLogApiModel {
    /**
     * drop log ファイルの絶対パスを取得する。
     * @param dropLogFileId 対象ファイルのID。
     * @param maxSize 許容する最大ファイルサイズ（KByte）。超過している場合は`DropLogApiErrors.FILE_IS_TOO_LARGE`を`message`に持つ`Error`を投げる。
     * @returns ファイルの絶対パス。該当ファイルが存在しなければ`null`。
     */
    getIdFilePath(dropLogFileId: apid.DropLogFileId, maxSize: number): Promise<string | null>;
}
