import IStorageBaseModel from '../IStorageBaseModel';

export interface IOnAirSelectStreamSettingValue {
    useURLScheme: boolean;
    type: string;
    mode: number;
}

export type IOnAirSelectStreamSettingStorageModel = IStorageBaseModel<IOnAirSelectStreamSettingValue>;
