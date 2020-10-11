import IStorageBaseModel from '../IStorageBaseModel';

export interface ISendVideoFileSelectHostSettingValue {
    hostName: string | null;
}

export type ISendVideoFileSelectHostSettingStorageModel = IStorageBaseModel<ISendVideoFileSelectHostSettingValue>;
