import container from '../model/ModelContainer';
import { ISettingStorageModel } from '../model/storage/setting/ISettingStorageModel';

namespace SubtitleUtil {
    /**
     * aribb24.js の option を生成する
     */
    export const getAribb24BaseOption = (): any => {
        const storageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
        const config = storageModel.getSavedValue();

        const baseOption: any = {
            normalFont: '"Windows TV MaruGothic", "MS Gothic", "Yu Gothic", sans-serif',
            gaijiFont: '"Windows TV MaruGothic", "MS Gothic", "Yu Gothic", sans-serif',
            drcsReplacement: true,
        };
        if (config.isForceEnableSubtitleStroke === true) {
            baseOption.forceStrokeColor = 'black';
        }

        return baseOption;
    };
}

export default SubtitleUtil;
