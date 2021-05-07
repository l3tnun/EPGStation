import IStorageBaseModel from '../IStorageBaseModel';

export interface IVideoPlayerSettingValue {
    isShowSubtitle: boolean;
}

export type IVideoPlayerSettingModel = IStorageBaseModel<IVideoPlayerSettingValue>;
