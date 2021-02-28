import { inject, injectable } from 'inversify';
import IColorThemeState from '@/model/state/IColorThemeState';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';

@injectable()
export default class ColorThemeState implements IColorThemeState {
    private settingModel: ISettingStorageModel;

    constructor(@inject('ISettingStorageModel') settingModel: ISettingStorageModel) {
        this.settingModel = settingModel;
    }

    private static isDarkTheme(shouldUseOSColorTheme: boolean, isForceDarkTheme: boolean): boolean {
        if (shouldUseOSColorTheme) {
            return Util.getOSDarkTheme();
        } else {
            return isForceDarkTheme;
        }
    }

    public isDarkTheme(): boolean {
        const shouldUseOSColorTheme = this.settingModel.getSavedValue().shouldUseOSColorTheme;
        const isForceDarkTheme = this.settingModel.getSavedValue().isForceDarkTheme;

        return ColorThemeState.isDarkTheme(shouldUseOSColorTheme, isForceDarkTheme);
    }

    public isTmpDarkTheme(): boolean {
        const shouldUseOSColorTheme = this.settingModel.tmp.shouldUseOSColorTheme;
        const isForceDarkTheme = this.settingModel.tmp.isForceDarkTheme;

        return ColorThemeState.isDarkTheme(shouldUseOSColorTheme, isForceDarkTheme);
    }
}
