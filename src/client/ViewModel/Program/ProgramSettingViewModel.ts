import { ProgramSettingModelInterface, ProgramSettingValue } from '../../Model/Program/ProgramSettingModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import ViewModel from '../ViewModel';

/**
 * ProgramSettingViewModel
 */
class ProgramSettingViewModel extends ViewModel {
    private settingModel: ProgramSettingModelInterface;
    private snackbar: SnackbarModelInterface;

    public tmpValue: ProgramSettingValue;

    constructor(
        settingModel: ProgramSettingModelInterface,
        snackbar: SnackbarModelInterface,
    ) {
        super();
        this.settingModel = settingModel;
        this.snackbar = snackbar;
    }

    /**
     * init
     * main で一度だけ初期化される
     */
    public init(): void {
        this.settingModel.init();
    }

    /**
     * 設定画面を開くときに呼ぶ
     * 一時保存領域のセット
     */
    public setTemp(): void {
        this.tmpValue = JSON.parse(JSON.stringify(this.settingModel.value));
    }

    /**
     * isEnable
     * @return boolean
     */
    public isEnable(): boolean {
        return this.settingModel.isEnable;
    }

    /**
     * 設定画面を開くときに呼ぶ
     * 一時保存領域のセット
     */
    public reset(): void {
        this.tmpValue = this.settingModel.getDefaultValue();
    }

    /**
     * save
     */
    public save(): void {
        this.settingModel.value = this.tmpValue;
        this.settingModel.update();
        this.snackbar.open('設定を保存しました');
    }
}

export default ProgramSettingViewModel;

