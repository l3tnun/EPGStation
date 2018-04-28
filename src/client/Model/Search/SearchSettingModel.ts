import StorageTemplateModel from '../Storage/StorageTemplateModel';

interface SearchSettingValue {
    setKeyowordToDirectory: boolean;
}

/**
 * SearchSettingModel
 */
class SearchSettingModel extends StorageTemplateModel<SearchSettingValue> {
    /**
     * get storage key
     * @return string;
     */
    protected getStorageKey(): string {
        return 'searchSetting';
    }

    /**
     * set default value
     */
    public getDefaultValue(): SearchSettingValue {
        return {
            setKeyowordToDirectory: false,
        };
    }
}

export { SearchSettingValue, SearchSettingModel };

