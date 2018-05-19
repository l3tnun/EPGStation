import { StreamingTypes } from '../../Enums';
import StorageTemplateModel from '../Storage/StorageTemplateModel';

interface RecordedWatchSelectSettingValue {
    type: StreamingTypes;
    mode: number;
}

/**
 * RecordedWatchSelectSettingModel
 */
class RecordedWatchSelectSettingModel extends StorageTemplateModel<RecordedWatchSelectSettingValue> {
    /**
     * get storage key
     * @return string;
     */
    protected getStorageKey(): string {
        return 'recordedSelectSetting';
    }

    /**
     * set default value
     */
    public getDefaultValue(): RecordedWatchSelectSettingValue {
        return {
            type: 'WebM',
            mode: 0,
        };
    }
}

export { RecordedWatchSelectSettingValue, RecordedWatchSelectSettingModel };

