import IStorageBaseModel from '../IStorageBaseModel';

export interface IGuideProgramDialogSettingValue {
    encode: string;
    isDeleteOriginalAfterEncode: boolean;
}

export const NONE_ENCODE_OPTION = 'TS';

export type IGuideProgramDialogSettingStorageModel = IStorageBaseModel<IGuideProgramDialogSettingValue>;
