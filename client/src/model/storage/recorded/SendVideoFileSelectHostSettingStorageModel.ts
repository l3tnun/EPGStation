import { inject, injectable } from 'inversify';
import AbstractStorageBaseModel from '../AbstractStorageBaseModel';
import IStorageOperationModel from '../IStorageOperationModel';
import { ISendVideoFileSelectHostSettingStorageModel, ISendVideoFileSelectHostSettingValue } from './ISendVideoFileSelectHostSettingStorageModel';

@injectable()
export default class SendVideoFileSelectHostSettingStorageModel
    extends AbstractStorageBaseModel<ISendVideoFileSelectHostSettingValue>
    implements ISendVideoFileSelectHostSettingStorageModel {
    constructor(@inject('IStorageOperationModel') op: IStorageOperationModel) {
        super(op);
    }

    public getDefaultValue(): ISendVideoFileSelectHostSettingValue {
        return {
            hostName: null,
        };
    }

    public getStorageKey(): string {
        return 'SendVideoFileSelectHostSetting';
    }
}
