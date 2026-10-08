import type { DefaultSettingsInput, DefaultSettingsValue } from './settingsTypes'

export class DefaultSettingsFactory {
  create(input: DefaultSettingsInput = {}): DefaultSettingsValue {
    return {
      isEnablePWA: true,
      shouldUseOSColorTheme: true,
      isForceDarkTheme: false,
      isHalfWidthDisplayed: true,
      isOnAirTabListView: true,
      isPreferredPlayingLiveM2TSOnWeb: true,
      onAirM2TSViewURLScheme: null,
      guideMode: input.isIOS === true ? 'all' : 'sequential',
      guideLength: 24,
      isForceDisableDarkThemeForGuide: false,
      isShowOnlyFreePrograms: false,
      isEnableDisplayForEachBroadcastWave: false,
      isIncludeChannelIdWhenSearching: true,
      isIncludeGenreWhenSearching: true,
      reservesLength: 24,
      recordingLength: 24,
      recordedLength: 24,
      isShowTableMode: false,
      isPreferredPlayingOnWeb: input.isIOS === true || input.isAndroid === true ? false : true,
      isShowDropInfoInsteadOfDescription: false,
      deleteRecordedDefaultValue: false,
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
      isForceEnableSubtitleStroke: true,
    }
  }
}
