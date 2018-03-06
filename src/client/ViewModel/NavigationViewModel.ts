import * as apid from '../../../api';
import { ConfigApiModelInterface } from '../Model/Api/ConfigApiModel';
import { SettingModelInterface } from '../Model/Setting/SettingModel';
import ViewModel from './ViewModel';

/**
 * NavigationViewModel
 * configApiModel は HeaderViewModel で初期化しているため get だけ
 */
class NavigationViewModel extends ViewModel {
    private configApiModel: ConfigApiModelInterface;
    private setting: SettingModelInterface;

    constructor(
        configApiModel: ConfigApiModelInterface,
        setting: SettingModelInterface,
    ) {
        super();
        this.configApiModel = configApiModel;
        this.setting = setting;
    }

    /**
     * getConfig
     * @return apid.Config | null
     */
    public getConfig(): apid.Config | null {
        return this.configApiModel.getConfig();
    }

    /**
     * navigation を自動で開くか
     * @return boolean
     */
    public isAutoOpen(): boolean {
        return this.setting.value.isAutoOpenNavigation;
    }
}

export default NavigationViewModel;

