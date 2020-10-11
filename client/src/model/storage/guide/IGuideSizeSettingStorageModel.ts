import IStorageBaseModel from '../IStorageBaseModel';

export interface SizeValue {
    channelHeight: number;
    channelWidth: number;
    channelFontsize: number;
    timescaleHeight: number;
    timescaleWidth: number;
    timescaleFontsize: number;
    programFontSize: number;
}

export interface IGuideSizeSettingValue {
    tablet: SizeValue;
    mobile: SizeValue;
}

export type IGuideSizeSettingStorageModel = IStorageBaseModel<IGuideSizeSettingValue>;
