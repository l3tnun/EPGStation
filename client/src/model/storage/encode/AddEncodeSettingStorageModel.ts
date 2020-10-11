import { inject, injectable } from 'inversify';
import AbstractStorageBaseModel from '../AbstractStorageBaseModel';
import IStorageOperationModel from '../IStorageOperationModel';
import { IAddEncodeSettingStorageModel, IAddEncodeSettingValue } from './IAddEncodeSettingStorageModel';

@injectable()
export default class AddEncodeSettingStorageModel extends AbstractStorageBaseModel<IAddEncodeSettingValue> implements IAddEncodeSettingStorageModel {
    constructor(@inject('IStorageOperationModel') op: IStorageOperationModel) {
        super(op);
    }

    public getDefaultValue(): IAddEncodeSettingValue {
        return {
            encodeMode: null,
            parentDirectory: null,
            isSaveSameDirectory: false,
            removeOriginal: false,
        };
    }

    public getStorageKey(): string {
        return 'AddEncodeSeting';
    }
}
