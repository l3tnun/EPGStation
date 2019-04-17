import StorageTemplateModel from '../Storage/StorageTemplateModel';

interface StreamWatchVideoSettingValue {
    isEnabledSubtitle: boolean;
}

/**
 * StreamWatchVideoSettingModel
 */
class StreamWatchVideoSettingModel extends StorageTemplateModel<StreamWatchVideoSettingValue> {
    /**
     * get storage key
     * @return string;
     */
    protected getStorageKey(): string {
        return 'streamViewSetting';
    }

    /**
     * set default value
     */
    public getDefaultValue(): StreamWatchVideoSettingValue {
        return {
            isEnabledSubtitle: false,
        };
    }
}

export { StreamWatchVideoSettingValue, StreamWatchVideoSettingModel };

