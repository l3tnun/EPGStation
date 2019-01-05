import StorageTemplateModel from '../Storage/StorageTemplateModel';

interface SearchSettingValue {
    isGoBackPreviousPage: boolean;
    setKeyowordToDirectory: boolean;
    setDefaultEncodeOption: boolean;
    isEnableAvoidDuplicate: boolean;
    delTs: boolean;
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
            isGoBackPreviousPage: false,
            setKeyowordToDirectory: false,
            setDefaultEncodeOption: false,
            isEnableAvoidDuplicate: false,
            delTs: false,
        };
    }
}

export { SearchSettingValue, SearchSettingModel };

