import { SETTINGS_UI_CONTRACT } from '@/shared/settings'
import type { SettingsControlDefinition } from './settingsControlTypes'
import { rangeOptions } from './lib/settingsControlOptions'

/** 全般 / 放映中 / 番組表 / 予約 / 録画中 の control 定義（表示順）。 */
export const SETTINGS_CONTROL_ROWS_FRONT = [
  {
    section: '全般',
    label: 'PWA',
    subtitle: 'PWAを有効化する(※再読込後有効になります)',
    key: 'isEnablePWA',
    controlType: 'switch',
    tmpTarget: 'isEnablePWA',
  },
  {
    section: '全般',
    label: 'OSカラーテーマ',
    subtitle: 'OSのカラーテーマに連動させる',
    key: 'shouldUseOSColorTheme',
    controlType: 'switch',
    tmpTarget: 'shouldUseOSColorTheme',
  },
  {
    section: '全般',
    label: 'ダークテーマ',
    subtitle: 'ダークテーマを有効化する',
    key: 'isForceDarkTheme',
    controlType: 'switch',
    disabledWhen: 'osColorThemeEnabled',
    tmpTarget: 'isForceDarkTheme',
  },
  {
    section: '全般',
    label: '半角表示',
    subtitle: '強制的に半角表示にする',
    key: 'isHalfWidthDisplayed',
    controlType: 'switch',
    tmpTarget: 'isHalfWidthDisplayed',
  },
  {
    section: '放映中',
    label: '放送波種別表示',
    subtitle: '放送波毎にタブで分ける',
    key: 'isOnAirTabListView',
    controlType: 'switch',
    tmpTarget: 'isOnAirTabListView',
  },
  {
    // v2 `client/src/views/Settings.vue:59-65` は放映中 section の `isOnAirTabListView` の直後に
    // 同じ文言の switch を置き、`v-if="isSupportedMpegts"` で mpegts 対応時だけ出す。束縛先は
    // 録画 section の `isPreferredPlayingOnWeb` とは別の `isPreferredPlayingLiveM2TSOnWeb` である。
    // この値を読んで挙動を変える code は v2 にも v3 にも無い（v2 側の参照は型宣言と既定値の 2 箇所
    // だけ）。それでも v2 が出している control なので同じ位置・同じ条件で出す。
    section: '放映中',
    label: 'web での再生を優先する',
    key: 'isPreferredPlayingLiveM2TSOnWeb',
    controlType: 'switch',
    tmpTarget: 'isPreferredPlayingLiveM2TSOnWeb',
    visibleWhen: 'mpegtsSupported',
  },
  {
    section: '放映中',
    label: '視聴 URL Scheme',
    key: 'onAirM2TSViewURLScheme',
    controlType: 'text',
    tmpTarget: 'onAirM2TSViewURLScheme',
  },
  {
    section: '番組表',
    label: '描画設定',
    key: 'guideMode',
    controlType: 'select',
    options: [
      { label: '逐次', value: 'sequential' },
      { label: '最小', value: 'minimum' },
      { label: 'すべて', value: 'all' },
    ],
    tmpTarget: 'guideMode',
  },
  {
    section: '番組表',
    label: '表示時間',
    key: 'guideLength',
    controlType: 'select',
    options: rangeOptions(
      SETTINGS_UI_CONTRACT.guideLength.min,
      SETTINGS_UI_CONTRACT.guideLength.max,
      '時間',
    ),
    range: {
      min: SETTINGS_UI_CONTRACT.guideLength.min,
      max: SETTINGS_UI_CONTRACT.guideLength.max,
      step: 1,
    },
    tmpTarget: 'guideLength',
  },
  {
    section: '番組表',
    label: 'ダークテーマの配色を無効化する',
    subtitle: 'ダークテーマ使用時でも通常時と同じ配色設定になります',
    key: 'isForceDisableDarkThemeForGuide',
    controlType: 'switch',
    disabledWhen: 'previewThemeLight',
    tmpTarget: 'isForceDisableDarkThemeForGuide',
  },
  {
    section: '番組表',
    label: '無料放送だけ表示する',
    key: 'isShowOnlyFreePrograms',
    controlType: 'switch',
    tmpTarget: 'isShowOnlyFreePrograms',
  },
  {
    section: '番組表',
    label: '放送波種別表示',
    subtitle: 'ナビゲーションの表示を放送波別に分ける',
    key: 'isEnableDisplayForEachBroadcastWave',
    controlType: 'switch',
    tmpTarget: 'isEnableDisplayForEachBroadcastWave',
  },
  {
    section: '番組表',
    label: '検索時に放送局情報を含むか',
    key: 'isIncludeChannelIdWhenSearching',
    controlType: 'switch',
    tmpTarget: 'isIncludeChannelIdWhenSearching',
  },
  {
    section: '番組表',
    label: '検索時にジャンル情報を含むか',
    key: 'isIncludeGenreWhenSearching',
    controlType: 'switch',
    tmpTarget: 'isIncludeGenreWhenSearching',
  },
  {
    section: '予約',
    label: '表示件数',
    key: 'reservesLength',
    controlType: 'select',
    options: rangeOptions(
      SETTINGS_UI_CONTRACT.reservesLength.min,
      SETTINGS_UI_CONTRACT.reservesLength.max,
      '件',
    ),
    range: {
      min: SETTINGS_UI_CONTRACT.reservesLength.min,
      max: SETTINGS_UI_CONTRACT.reservesLength.max,
      step: 1,
    },
    tmpTarget: 'reservesLength',
  },
  {
    section: '録画中',
    label: '表示件数',
    key: 'recordingLength',
    controlType: 'select',
    options: rangeOptions(
      SETTINGS_UI_CONTRACT.recordingLength.min,
      SETTINGS_UI_CONTRACT.recordingLength.max,
      '件',
    ),
    range: {
      min: SETTINGS_UI_CONTRACT.recordingLength.min,
      max: SETTINGS_UI_CONTRACT.recordingLength.max,
      step: 1,
    },
    tmpTarget: 'recordingLength',
  },
] as const satisfies readonly SettingsControlDefinition[]
