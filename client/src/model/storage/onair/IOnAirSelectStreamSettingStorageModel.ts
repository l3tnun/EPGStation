import IStorageBaseModel from '../IStorageBaseModel';

export interface IOnAirSelectStreamSettingValue {
    type: string;
    mode: number;
}

export default interface IOnAirSelectStreamSettingStorageModel
    extends IStorageBaseModel<IOnAirSelectStreamSettingValue> {}
