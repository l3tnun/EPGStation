import { StreamSelectSettingValue } from '../../Model/Stream/StreamSelectSettingModel';
import StorageTemplateViewModel from '../StorageTemplateViewModel';

/**
 * StreamSelectSettingViewModel
 */
class StreamSelectSettingViewModel extends StorageTemplateViewModel<StreamSelectSettingValue> {
    /**
     * get save message
     * @return null
     */
    protected getSaveMessage(): null { return null; }
}

export default StreamSelectSettingViewModel;

