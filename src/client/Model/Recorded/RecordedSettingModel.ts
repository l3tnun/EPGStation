import { EncodeQueryOption } from '../../Model/Api/RecordedApiModel';
import StorageTemplateModel from '../Storage/StorageTemplateModel';

interface RecordedSettingValue {
    isEnabledListMode: boolean;
    encodeOption: EncodeQueryOption;
}

/**
 * RecordedSettingModel
 */
class RecordedSettingModel extends StorageTemplateModel<RecordedSettingValue> {
    /**
     * get storage key
     * @return string;
     */
    protected getStorageKey(): string {
        return 'recordedSetting';
    }

    /**
     * set default value
     */
    public getDefaultValue(): RecordedSettingValue {
        return {
            isEnabledListMode: false,
            encodeOption: {
                mode: 0,
                isOutputTheOriginalDirectory: false,
                delTs: false,
            },
        };
    }
}

export { RecordedSettingValue, RecordedSettingModel };

