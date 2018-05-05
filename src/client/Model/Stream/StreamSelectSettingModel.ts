import { StreamType } from '../../Enums';
import StorageTemplateModel from '../Storage/StorageTemplateModel';

interface StreamSelectSettingValue {
    type: StreamType;
    mode: number;
}

/**
 * StreamSelectSettingModel
 */
class StreamSelectSettingModel extends StorageTemplateModel<StreamSelectSettingValue> {
    /**
     * get storage key
     * @return string;
     */
    protected getStorageKey(): string {
        return 'streamSelectSetting';
    }

    /**
     * set default value
     */
    public getDefaultValue(): StreamSelectSettingValue {
        return {
            type: 'M2TS',
            mode: 0,
        };
    }
}

export { StreamSelectSettingValue, StreamSelectSettingModel };

