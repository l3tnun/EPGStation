/* eslint-disable no-fallthrough */
namespace ChannelUtil {
    /**
     * 映像・音声サービスであるかを返す
     * @param serviceType: number 対象のサービスタイプ
     * @see https://github.com/DBCTRADO/LibISDB/blob/master/LibISDB/LibISDBConsts.hpp#L122
     */
    export const isMediaService = (serviceType: number): boolean => {
        switch (serviceType) {
            // デジタルTVサービス
            case 0x01:
            // デジタル音声サービス
            case 0x02:
            // 臨時映像サービス
            case 0xa1:
            // 臨時音声サービス
            case 0xa2:
            // プロモーション映像サービス
            case 0xa5:
            // プロモーション音声サービス
            case 0xa6:
            // 超高精細度4K専用TVサービス
            case 0xad:
                return true;
            default:
                return false;
        }
    };
}

export default ChannelUtil;
