import IStorageBaseModel from '../IStorageBaseModel';

export type GuideViewMode = 'sequential' | 'minimum' | 'all';
export type B24RenderType = 'default' | 'aribb24.js' | 'b24.js';

export interface ISettingValue {
    isEnablePWA: boolean;
    shouldUseOSColorTheme: boolean;
    isForceDarkTheme: boolean;
    isHalfWidthDisplayed: boolean;
    isOnAirTabListView: boolean;
    onAirM2TSViewURLScheme: string | null;
    guideMode: GuideViewMode;
    guideLength: number;
    isEnableDisplayForEachBroadcastWave: boolean;
    isIncludeChannelIdWhenSearching: boolean;
    isIncludeGenreWhenSearching: boolean;
    reservesLength: number;
    recordingLength: number;
    recordedLength: number;
    isShowTableMode: boolean;
    isPreferredPlayingOnWeb: boolean;
    isShowDropInfoInsteadOfDescription: boolean;
    shouldUseRecordedViewURLScheme: boolean;
    recordedViewURLScheme: string | null;
    shouldUseRecordedDownloadURLScheme: boolean;
    recordedDownloadURLScheme: string | null;
    searchLength: number;
    isEnableAutoScrollWhenEditingRule: boolean;
    isEnableCopyKeywordToDirectory: boolean;
    isCheckAvoidDuplicate: boolean;
    isEnableEncodingSettingWhenCreateRule: boolean;
    isCheckDeleteOriginalAfterEncode: boolean;
    rulesLength: number;
    b24RenderType: B24RenderType;
}

export type ISettingStorageModel = IStorageBaseModel<ISettingValue>;
