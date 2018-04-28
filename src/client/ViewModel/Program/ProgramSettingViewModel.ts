import { ProgramSettingValue } from '../../Model/Program/ProgramSettingModel';
import StorageTemplateViewModel from '../StorageTemplateViewModel';

/**
 * ProgramSettingViewModel
 */
class ProgramSettingViewModel extends StorageTemplateViewModel<ProgramSettingValue> {
    /**
     * get save message
     * @return string
     */
    protected getSaveMessage(): string {
        return 'サイズ設定を保存しました';
    }
}

export default ProgramSettingViewModel;

