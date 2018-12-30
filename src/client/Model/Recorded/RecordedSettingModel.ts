import StorageTemplateModel from '../Storage/StorageTemplateModel';

interface RecordedSettingValue {
    isEnabledListMode: boolean;
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
        };
    }
}

export { RecordedSettingValue, RecordedSettingModel };

