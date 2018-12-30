import { RecordedSettingValue } from '../../Model/Recorded/RecordedSettingModel';
import StorageTemplateViewModel from '../StorageTemplateViewModel';

/**
 * RecordedSettingViewModel
 */
class RecordedSettingViewModel extends StorageTemplateViewModel<RecordedSettingValue> {
    public init(): void {
        super.init();

        this.setTemp();
    }

    /**
     * get save message
     * @return null
     */
    protected getSaveMessage(): null { return null; }
}

namespace RecordedSettingViewModel {
    export const id = 'recorded-setting-id';
}

export default RecordedSettingViewModel;

