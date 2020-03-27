import * as m from 'mithril';
import * as apid from '../../../api';
import { ViewModelStatus } from '../Enums';
import { ConfigApiModelInterface } from '../Model/Api/ConfigApiModel';
import { SettingValue } from '../Model/Setting/SettingModel';
import StorageTemplateModel from '../Model/Storage/StorageTemplateModel';
import ViewModel from './ViewModel';

/**
 * MainLayoutViewModel
 */
class MainLayoutViewModel extends ViewModel {
    private configApiModel: ConfigApiModelInterface;
    private setting: StorageTemplateModel<SettingValue>;
    private hasViewData: boolean = false;

    constructor(
        configApiModel: ConfigApiModelInterface,
        setting: StorageTemplateModel<SettingValue>,
    ) {
        super();
        this.configApiModel = configApiModel;
        this.setting = setting;
    }

    /**
     * init ParentComponent の init で呼ぶ
     * @param status: status: ViewModelStatus
     */
    public init(status: ViewModelStatus): void {
        if (status === 'init' || status === 'update') {
            this.hasViewData = !this.setting.getValue().isEnabledPageMovementAnimation;
            if (status === 'update') { m.redraw(); }
        }
    }

    /**
     * ParentComponent の init でデータ取得後に呼ぶ
     */
    public update(): void {
        this.hasViewData = true;
        m.redraw();
    }

    /**
     * MainLayout の表示状態を取得
     * @return boolean; true: 表示, false: 非表示
     */
    public isShow(): boolean {
        return this.hasViewData;
    }

    /**
     * getConfig
     * @return apid.Config | null
     */
    public getConfig(): apid.Config | null {
        return this.configApiModel.getConfig();
    }
}

export default MainLayoutViewModel;

