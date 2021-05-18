import Hls from 'hls.js';
import container from '../model/ModelContainer';
import { ISettingStorageModel } from '../model/storage/setting/ISettingStorageModel';
import UaUtil from './UaUtil';

namespace HLSUtil {
    /**
     * hls.js に対応しているか
     * @returns boolean 対応していれば true を返す
     */
    export const isSupportedHLSjs = (): boolean => {
        return UaUtil.isiOS() === true || (UaUtil.isMac() === true && UaUtil.isSafari() === true) ? false : Hls.isSupported();
    };

    /**
     * aribb24.js の option を生成する
     */
    export const getAribb24BaseOption = (): any => {
        const storageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
        const config = storageModel.getSavedValue();

        // Windows Firefox では Yu Gothic や Meiryo では Canvas の垂直位置の指定がずれるため、MS Gothic を使用する #478
        const font =
            UaUtil.isWindows() === true && UaUtil.isFirefox() === true
                ? '"Windows TV MaruGothic", "MS Gothic", "Yu Gothic", sans-serif'
                : '"Windows TV MaruGothic", "Hiragino Maru Gothic Pro", "HGMaruGothicMPRO", "Yu Gothic Medium", sans-serif';

        const baseOption: any = {
            normalFont: font,
            gaijiFont: font,
            drcsReplacement: true,
            enableAutoInBandMetadataTextTrackDetection: HLSUtil.isSupportedHLSjs() === false,
        };
        if (config.isForceEnableSubtitleStroke === true) {
            baseOption.forceStrokeColor = 'black';
        }

        return baseOption;
    };
}

export default HLSUtil;
