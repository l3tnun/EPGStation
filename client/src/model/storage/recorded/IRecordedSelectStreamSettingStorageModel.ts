import IStorageBaseModel from '../IStorageBaseModel';

export interface IRecordedSelectStreamSettingValue {
    type: string;
    mode: number;
}

export default interface IRecordedSelectStreamSettingStorageModel
    extends IStorageBaseModel<IRecordedSelectStreamSettingValue> {}
