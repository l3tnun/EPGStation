import ViewModel from './ViewModel';
import * as apid from '../../../api';
import { ConfigApiModelInterface } from '../Model/Api/ConfigApiModel';

/**
* NavigationViewModel
* configApiModel は HeaderViewModel で初期化しているため get だけ
*/
class NavigationViewModel extends ViewModel {
    private configApiModel: ConfigApiModelInterface;

    constructor(configApiModel: ConfigApiModelInterface) {
        super();
        this.configApiModel = configApiModel;
    }

    /**
    * getConfig
    * @return apid.Config | null
    */
    public getConfig(): apid.Config | null {
        return this.configApiModel.getConfig();
    }
}

export default NavigationViewModel;

