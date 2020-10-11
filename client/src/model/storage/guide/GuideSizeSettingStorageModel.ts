import { inject, injectable } from 'inversify';
import AbstractStorageBaseModel from '../AbstractStorageBaseModel';
import IStorageOperationModel from '../IStorageOperationModel';
import { IGuideSizeSettingStorageModel, IGuideSizeSettingValue } from './IGuideSizeSettingStorageModel';

@injectable()
export default class GuideSizeSettingStorageModel extends AbstractStorageBaseModel<IGuideSizeSettingValue> implements IGuideSizeSettingStorageModel {
    constructor(@inject('IStorageOperationModel') op: IStorageOperationModel) {
        super(op);
    }

    public getDefaultValue(): IGuideSizeSettingValue {
        return {
            tablet: {
                channelHeight: 30,
                channelWidth: 140,
                channelFontsize: 14,
                timescaleHeight: 180,
                timescaleWidth: 30,
                timescaleFontsize: 16,
                programFontSize: 10,
            },
            mobile: {
                channelHeight: 20,
                channelWidth: 100,
                channelFontsize: 12,
                timescaleHeight: 120,
                timescaleWidth: 20,
                timescaleFontsize: 12,
                programFontSize: 7.5,
            },
        };
    }

    public getStorageKey(): string {
        return 'GuideSizeSetting';
    }
}
