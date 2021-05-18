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

        const baseOption: any = {
            normalFont: '"Windows TV MaruGothic", "Hiragino Maru Gothic Pro", "HGMaruGothicMPRO", "Yu Gothic Medium", sans-serif',
            gaijiFont: '"Windows TV MaruGothic", "Hiragino Maru Gothic Pro", "HGMaruGothicMPRO", "Yu Gothic Medium", sans-serif',
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
