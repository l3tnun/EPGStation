import StorageTemplateModel from '../Storage/StorageTemplateModel';

interface SizeValues {
    channelHeight: number;
    channelWidth: number;
    channelFontsize: number;
    timescaleHeight: number;
    timescaleWidth: number;
    timescaleFontsize: number;
    boardFontsize: number;
}

interface ProgramSettingValue {
    tablet: SizeValues;
    mobile: SizeValues;
}

/**
 * ProgramSettingModel
 */
class ProgramSettingModel extends StorageTemplateModel<ProgramSettingValue> {
    /**
     * get storage key
     * @return string;
     */
    protected getStorageKey(): string {
        return 'programSetting';
    }

    /**
     * set default value
     */
    public getDefaultValue(): ProgramSettingValue {
        return {
            tablet: {
                channelHeight: 30,
                channelWidth: 140,
                channelFontsize: 15,
                timescaleHeight: 180,
                timescaleWidth: 30,
                timescaleFontsize: 17,
                boardFontsize: 10,
            },
            mobile: {
                channelHeight: 20,
                channelWidth: 100,
                channelFontsize: 12,
                timescaleHeight: 120,
                timescaleWidth: 20,
                timescaleFontsize: 12,
                boardFontsize: 7.5,
            },
        };
    }
}

export { ProgramSettingValue, ProgramSettingModel };

