import IStorageBaseModel from '../IStorageBaseModel';

export interface ISendVideoFileSelectHostSettingValue {
    hostName: string | null;
}

export default interface ISendVideoFileSelectHostSettingStorageModel
    extends IStorageBaseModel<ISendVideoFileSelectHostSettingValue> {}
