import StorageTemplateModel from '../Storage/StorageTemplateModel';

interface StreamProgramCardsSettingValue {
    isHideTabMode: boolean;
}

/**
 * StreamProgramCardsSettingModel
 */
class StreamProgramCardsSettingModel extends StorageTemplateModel<StreamProgramCardsSettingValue> {
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
    public getDefaultValue(): StreamProgramCardsSettingValue {
        return {
            isHideTabMode: false,
        };
    }
}

export { StreamProgramCardsSettingValue, StreamProgramCardsSettingModel };

