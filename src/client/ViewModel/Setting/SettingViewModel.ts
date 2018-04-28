import { SettingValue } from '../../Model/Setting/SettingModel';
import StorageTemplateViewModel from '../StorageTemplateViewModel';

/**
 * SettingViewModel
 */
class SettingViewModel extends StorageTemplateViewModel<SettingValue> {
    /**
     * get save message
     * @return string
     */
    protected getSaveMessage(): string {
        return '設定を保存しました';
    }
}

export default SettingViewModel;

