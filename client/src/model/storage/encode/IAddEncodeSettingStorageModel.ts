import IStorageBaseModel from '../IStorageBaseModel';

export interface IAddEncodeSettingValue {
    isSaveSameDirectory: boolean;
    removeOriginal: boolean;
}

export default interface IAddEncodeSettingStorageModel extends IStorageBaseModel<IAddEncodeSettingValue> {}
