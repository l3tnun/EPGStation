import { inject, injectable } from 'inversify';
import AbstractStorageBaseModel from '../AbstractStorageBaseModel';
import IStorageOperationModel from '../IStorageOperationModel';
import { IGuideProgramDialogSettingStorageModel, IGuideProgramDialogSettingValue, NONE_ENCODE_OPTION } from './IGuideProgramDialogSettingStorageModel';

@injectable()
export default class GuideProgramDialogSettingStorageModel extends AbstractStorageBaseModel<IGuideProgramDialogSettingValue> implements IGuideProgramDialogSettingStorageModel {
    constructor(@inject('IStorageOperationModel') op: IStorageOperationModel) {
        super(op);
    }

    public getDefaultValue(): IGuideProgramDialogSettingValue {
        return {
            encode: NONE_ENCODE_OPTION,
            isDeleteOriginalAfterEncode: false,
        };
    }

    public getStorageKey(): string {
        return 'GuideProgramDetailSetting';
    }
}
