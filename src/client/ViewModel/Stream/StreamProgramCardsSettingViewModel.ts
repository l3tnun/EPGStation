import { StreamProgramCardsSettingValue } from '../../Model/Stream/StreamProgramCardsSettingModel';
import StorageTemplateViewModel from '../StorageTemplateViewModel';

/**
 * StreamProgramCardsSettingViewModel
 */
class StreamProgramCardsSettingViewModel extends StorageTemplateViewModel<StreamProgramCardsSettingValue> {
    /**
     * get save message
     * @return null
     */
    protected getSaveMessage(): null { return null; }
}

namespace StreamProgramCardsSettingViewModel {
    export const id = 'stream-program-card-setting-id';
}

export default StreamProgramCardsSettingViewModel;

