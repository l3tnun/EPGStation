import { inject, injectable } from 'inversify';
import AbstractStorageBaseModel from '../AbstractStorageBaseModel';
import IStorageOperationModel from '../IStorageOperationModel';
import { IRecordedSelectStreamSettingStorageModel, IRecordedSelectStreamSettingValue } from './IRecordedSelectStreamSettingStorageModel';

@injectable()
export default class RecordedSelectStreamSettingStorageModel
    extends AbstractStorageBaseModel<IRecordedSelectStreamSettingValue>
    implements IRecordedSelectStreamSettingStorageModel {
    constructor(@inject('IStorageOperationModel') op: IStorageOperationModel) {
        super(op);
    }

    public getDefaultValue(): IRecordedSelectStreamSettingValue {
        return {
            type: 'WebM',
            mode: 0,
        };
    }

    public getStorageKey(): string {
        return 'RecordedSelectStreamSetting';
    }
}
