import { inject, injectable } from 'inversify';
import AbstractStorageBaseModel from '../AbstractStorageBaseModel';
import IStorageOperationModel from '../IStorageOperationModel';
import ISettingStorageModel, { ISettingValue } from './ISettingStorageModel';

@injectable()
export default class SettingStorageModel extends AbstractStorageBaseModel<ISettingValue>
    implements ISettingStorageModel {
    constructor(@inject('IStorageOperationModel') op: IStorageOperationModel) {
        super(op);
    }

    public getDefaultValue(): ISettingValue {
        return {
            isForceDarkTheme: false,
            guideMode: 'sequential',
            guideLength: 24,
            isGuideHalfWidthDisplayed: true,
            isEnableDisplayForEachBroadcastWave: false,
            reservesLength: 24,
            isReservesHalfWidthDisplayed: true,
            recordedLength: 24,
            isRecordedHalfWidthDisplayed: true,
            shouldUseRecordedViewURLScheme: true,
            recordedViewURLScheme: null,
            shouldUseRecordedDownloadURLScheme: true,
            recordedDownloadURLScheme: null,
            searchLength: 300,
            isSearchHalfWidthDisplayed: true,
            isEnableAutoScrollWhenEditingRule: true,
            isEnableCopyKeywordToDirectory: false,
            isCheckAvoidDuplicate: false,
            isEnableEncodingSettingWhenCreateRule: false,
            isCheckDelTs: false,
            rulesLength: 24,
        };
    }

    public getStorageKey(): string {
        return 'settings';
    }
}
