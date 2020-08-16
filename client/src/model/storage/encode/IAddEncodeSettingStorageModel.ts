import IStorageBaseModel from '../IStorageBaseModel';

export interface IAddEncodeSettingValue {
    encodeMode: string | null;
    parentDirectory: string | null;
    isSaveSameDirectory: boolean;
    removeOriginal: boolean;
}

export default interface IAddEncodeSettingStorageModel extends IStorageBaseModel<IAddEncodeSettingValue> {}
