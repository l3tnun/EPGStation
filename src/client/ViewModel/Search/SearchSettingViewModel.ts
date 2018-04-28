import { SearchSettingValue } from '../../Model/Search/SearchSettingModel';
import StorageTemplateViewModel from '../StorageTemplateViewModel';

/**
 * SearchSettingViewModel
 */
class SearchSettingViewModel extends StorageTemplateViewModel<SearchSettingValue> {
    /**
     * get save message
     * @return null
     */
    protected getSaveMessage(): null {
        return null;
    }
}

namespace SearchSettingViewModel {
    export const id = 'search-setting-id';
}

export default SearchSettingViewModel;

