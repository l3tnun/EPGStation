import IStorageBaseModel from '../IStorageBaseModel';

export interface IOnAirSelectStreamSettingValue {
    type: string;
    mode: number;
}

export type IOnAirSelectStreamSettingStorageModel = IStorageBaseModel<IOnAirSelectStreamSettingValue>;
