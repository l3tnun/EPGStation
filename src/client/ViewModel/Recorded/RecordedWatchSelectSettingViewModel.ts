import { RecordedWatchSelectSettingValue } from '../../Model/Recorded/RecordedWatchSelectSettingModel';
import StorageTemplateViewModel from '../StorageTemplateViewModel';

/**
 * RecordedWatchSelectSettingViewModel
 */
class RecordedWatchSelectSettingViewModel extends StorageTemplateViewModel<RecordedWatchSelectSettingValue> {
    /**
     * get save message
     * @return null
     */
    protected getSaveMessage(): null { return null; }
}

export default RecordedWatchSelectSettingViewModel;

