import { inject, injectable } from 'inversify';
import AbstractStorageBaseModel from '../AbstractStorageBaseModel';
import IStorageOperationModel from '../IStorageOperationModel';
import { IOnAirSelectStreamSettingStorageModel, IOnAirSelectStreamSettingValue } from './IOnAirSelectStreamSettingStorageModel';

@injectable()
export default class OnAirSelectStreamSettingStorageModel extends AbstractStorageBaseModel<IOnAirSelectStreamSettingValue> implements IOnAirSelectStreamSettingStorageModel {
    constructor(@inject('IStorageOperationModel') op: IStorageOperationModel) {
        super(op);
    }

    public getDefaultValue(): IOnAirSelectStreamSettingValue {
        return {
            type: 'M2TS',
            mode: 0,
        };
    }

    public getStorageKey(): string {
        return 'OnAirSelectStreamSetting';
    }
}
