import { inject, injectable } from 'inversify';
import AbstractStorageBaseModel from '../AbstractStorageBaseModel';
import IStorageOperationModel from '../IStorageOperationModel';
import { IVideoPlayerSettingModel, IVideoPlayerSettingValue } from './IVideoPlayerSettingModel';

@injectable()
export default class VideoPlayerSettingModel extends AbstractStorageBaseModel<IVideoPlayerSettingValue> implements IVideoPlayerSettingModel {
    constructor(@inject('IStorageOperationModel') op: IStorageOperationModel) {
        super(op);
    }

    public getDefaultValue(): IVideoPlayerSettingValue {
        return {
            isShowSubtitle: false,
        };
    }

    public getStorageKey(): string {
        return 'VideoPlayerSetting';
    }
}
