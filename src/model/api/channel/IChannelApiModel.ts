import type * as apid from '../../../../api.js';

/** `ChannelApiModel`が投げる`Error`の`message`に使う識別子。呼び出し側（route層）はこの文字列でエラー種別を判別する。 */
export namespace IChannelApiModelError {
    /** `getLogo`で該当チャンネル、またはロゴ画像が存在しなかった場合に投げられる。 */
    export const NOT_FOUND = 'notfound';
}

/** チャンネル一覧・ロゴ画像を取得するAPI層の契約。実装は`ChannelApiModel`。 */
export default interface IChannelApiModel {
    /** @returns 登録済み全チャンネルの一覧。 */
    getChannels(): Promise<apid.ChannelItem[]>;
    /**
     * 指定チャンネルのロゴ画像を取得する。
     * @param channelId 対象チャンネルのID。
     * @returns ロゴ画像のバイナリ。チャンネルまたはロゴが存在しない場合は`IChannelApiModelError.NOT_FOUND`を`message`に持つ`Error`を投げる。
     */
    getLogo(channelId: apid.ChannelId): Promise<Buffer>;
}
