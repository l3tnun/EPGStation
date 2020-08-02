import IStorageBaseModel from '../IStorageBaseModel';

export interface IGuideProgramDialogSettingValue {
    encode: string;
    isDeleteOriginalAfterEncode: boolean;
}

export const NONE_ENCODE_OPTION = 'TS';

export default interface IGuideProgramDialogSettingStorageModel
    extends IStorageBaseModel<IGuideProgramDialogSettingValue> {}
