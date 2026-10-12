export const SETTINGS_STORAGE_KEY = 'settings'

export interface DefaultSettingsInput {
  isIOS?: boolean
  isAndroid?: boolean
}

export type GuideViewMode = 'sequential' | 'minimum' | 'all'

export const GUIDE_VIEW_MODE_VALUES = [
  'sequential',
  'minimum',
  'all',
] as const satisfies readonly GuideViewMode[]

export type SettingsRawValue =
  string | number | boolean | null | SettingsRawObject | readonly unknown[]

export interface DefaultSettingsValue {
  isEnablePWA: boolean
  shouldUseOSColorTheme: boolean
  isForceDarkTheme: boolean
  isHalfWidthDisplayed: boolean
  isOnAirTabListView: boolean
  isPreferredPlayingLiveM2TSOnWeb: boolean
  onAirM2TSViewURLScheme: string | null
  guideMode: GuideViewMode
  guideLength: number
  isForceDisableDarkThemeForGuide: boolean
  isShowOnlyFreePrograms: boolean
  isEnableDisplayForEachBroadcastWave: boolean
  isIncludeChannelIdWhenSearching: boolean
  isIncludeGenreWhenSearching: boolean
  reservesLength: number
  recordingLength: number
  recordedLength: number
  isShowTableMode: boolean
  isPreferredPlayingOnWeb: boolean
  isShowDropInfoInsteadOfDescription: boolean
  deleteRecordedDefaultValue: boolean
  shouldUseRecordedViewURLScheme: boolean
  recordedViewURLScheme: string | null
  shouldUseRecordedDownloadURLScheme: boolean
  recordedDownloadURLScheme: string | null
  searchLength: number
  isEnableAutoScrollWhenEditingRule: boolean
  isEnableCopyKeywordToDirectory: boolean
  isCheckAvoidDuplicate: boolean
  isEnableEncodingSettingWhenCreateRule: boolean
  isCheckDeleteOriginalAfterEncode: boolean
  rulesLength: number
  isEnableExtendedPagination: boolean
  isForceEnableSubtitleStroke: boolean
}

export type SettingsConsumerValue = DefaultSettingsValue

export interface SettingsRawObject {
  [key: string]: SettingsRawValue | undefined
}

export interface SettingsLoadResult {
  value: SettingsConsumerValue
  raw: SettingsRawObject
  repaired: boolean
  persisted: boolean
}

export interface SettingsSaveResult {
  ok: boolean
}

export interface SettingsValidationResult {
  value: SettingsConsumerValue
  raw: SettingsRawObject
  repaired: boolean
}

export interface ThemeSettings {
  shouldUseOSColorTheme: boolean
  isForceDarkTheme: boolean
}

export type AdjacentStorageKey =
  | 'OnAirSelectStreamSetting'
  | 'RecordedSelectStreamSetting'
  | 'SendVideoFileSelectHostSetting'
  | 'VideoPlayerSetting'
  | 'GuideSizeSetting'
  | 'GuideGenreSetting'
  | 'GuideProgramDetailSetting'
  | 'AddEncodeSeting'

export interface AdjacentStorageDefinition {
  key: AdjacentStorageKey
  owner: string
  defaultValue: SettingsRawObject | null
}
