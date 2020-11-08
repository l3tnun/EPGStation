import { inject, injectable } from 'inversify';
import UaUtil from '../../../util/UaUtil';
import AbstractStorageBaseModel from '../AbstractStorageBaseModel';
import IStorageOperationModel from '../IStorageOperationModel';
import { ISettingStorageModel, ISettingValue } from './ISettingStorageModel';

@injectable()
export default class SettingStorageModel extends AbstractStorageBaseModel<ISettingValue> implements ISettingStorageModel {
    constructor(@inject('IStorageOperationModel') op: IStorageOperationModel) {
        super(op);
    }

    public getDefaultValue(): ISettingValue {
        return {
            isEnablePWA: true,
            isForceDarkTheme: false,
            isHalfWidthDisplayed: true,
            isOnAirTabListView: true,
            onAirM2TSViewURLScheme: null,
            guideMode: UaUtil.isiOS() === true ? 'all' : 'sequential',
            guideLength: 24,
            isEnableDisplayForEachBroadcastWave: false,
            isIncludeChannelIdWhenSearching: true,
            isIncludeGenreWhenSearching: true,
            reservesLength: 24,
            recordingLength: 24,
            recordedLength: 24,
            isPreferredPlayingOnWeb: UaUtil.isAndroid() !== true && UaUtil.isiOS() !== true,
            isShowTableMode: false,
            isShowDropInfoInsteadOfDescription: false,
            shouldUseRecordedViewURLScheme: true,
            recordedViewURLScheme: null,
            shouldUseRecordedDownloadURLScheme: true,
            recordedDownloadURLScheme: null,
            searchLength: 300,
            isEnableAutoScrollWhenEditingRule: true,
            isEnableCopyKeywordToDirectory: false,
            isCheckAvoidDuplicate: false,
            isEnableEncodingSettingWhenCreateRule: false,
            isCheckDeleteOriginalAfterEncode: false,
            rulesLength: 24,
        };
    }

    public getStorageKey(): string {
        return 'settings';
    }
}
