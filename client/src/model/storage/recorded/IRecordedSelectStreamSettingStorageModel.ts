import IStorageBaseModel from '../IStorageBaseModel';

export interface IRecordedSelectStreamSettingValue {
    type: string;
    mode: number;
}

export type IRecordedSelectStreamSettingStorageModel = IStorageBaseModel<IRecordedSelectStreamSettingValue>;
