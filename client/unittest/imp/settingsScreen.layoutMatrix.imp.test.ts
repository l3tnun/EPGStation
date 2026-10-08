import { describe, expect, it } from 'vitest'
import { SETTINGS_UI_CONTRACT, type SettingsConsumerValue } from '@/shared/settings'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  SETTINGS_CONTROL_MATRIX,
  createSettingsControlUpdate,
  getSettingsControlsForSection,
  isSettingsControlDisabled,
  isSettingsControlVisible,
  resolveSettingsControlDisplayValue,
  resolveSettingsPreviewTheme,
  resolveVisibleSettingsControls,
  type SettingsControlDefinition,
} from '@/features/settings/settingsControlMatrix'
import {
  SETTINGS_CARD_MAX_WIDTH_PX,
  SETTINGS_SECTION_ORDER,
  SETTINGS_URL_SCHEME_PLACEHOLDER,
} from '@/features/settings/settingsLayoutContract'

describe('Settings screen layout implementation contract', () => {
  it('keeps the task 1 section order and desktop card width stable', () => {
    expect(SETTINGS_CARD_MAX_WIDTH_PX).toBe(800)
    expect(SETTINGS_SECTION_ORDER).toStrictEqual([
      '全般',
      '放映中',
      '番組表',
      '予約',
      '録画中',
      '録画',
      '検索',
      'ルール',
      'ビデオプレーヤ',
    ])
  })

  it('uses only a synthetic long URL scheme placeholder for overflow regression', () => {
    expect(SETTINGS_URL_SCHEME_PLACEHOLDER).toContain('synthetic')
    expect(SETTINGS_URL_SCHEME_PLACEHOLDER.length).toBeGreaterThan(96)
    expect(SETTINGS_URL_SCHEME_PLACEHOLDER).not.toContain('http://')
    expect(SETTINGS_URL_SCHEME_PLACEHOLDER).not.toContain('https://')
    expect(SETTINGS_URL_SCHEME_PLACEHOLDER).not.toMatch(/token|secret|password|api[_-]?key/i)
  })
})

describe('Requirements 1.6-1.14 Settings control matrix implementation contract', () => {
  const defaultTmp = new DefaultSettingsFactory().create()

  it('fixes every Settings screen control key in the approved section order', () => {
    expect(SETTINGS_CONTROL_MATRIX.map((control) => control.key)).toStrictEqual([
      'isEnablePWA',
      'shouldUseOSColorTheme',
      'isForceDarkTheme',
      'isHalfWidthDisplayed',
      'isOnAirTabListView',
      'isPreferredPlayingLiveM2TSOnWeb',
      'onAirM2TSViewURLScheme',
      'guideMode',
      'guideLength',
      'isForceDisableDarkThemeForGuide',
      'isShowOnlyFreePrograms',
      'isEnableDisplayForEachBroadcastWave',
      'isIncludeChannelIdWhenSearching',
      'isIncludeGenreWhenSearching',
      'reservesLength',
      'recordingLength',
      'recordedLength',
      'isShowTableMode',
      'isShowDropInfoInsteadOfDescription',
      'deleteRecordedDefaultValue',
      'isPreferredPlayingOnWeb',
      'shouldUseRecordedViewURLScheme',
      'recordedViewURLScheme',
      'shouldUseRecordedDownloadURLScheme',
      'recordedDownloadURLScheme',
      'searchLength',
      'isEnableAutoScrollWhenEditingRule',
      'isEnableCopyKeywordToDirectory',
      'isCheckAvoidDuplicate',
      'isEnableEncodingSettingWhenCreateRule',
      'isCheckDeleteOriginalAfterEncode',
      'rulesLength',
      'isForceEnableSubtitleStroke',
    ])

    expect(
      SETTINGS_SECTION_ORDER.flatMap((section) => getSettingsControlsForSection(section)),
    ).toStrictEqual(SETTINGS_CONTROL_MATRIX)

    SETTINGS_CONTROL_MATRIX.forEach((control) => {
      expect(control.tmpTarget).toBe(control.key)
      expect(control.section).toBeTypeOf('string')
      expect(control.label).toBeTypeOf('string')
      expect(['switch', 'select', 'text']).toContain(control.controlType)
    })
  })

  it('keeps Vue-compatible subtitles for settings rows that include helper text', () => {
    expect(
      SETTINGS_CONTROL_MATRIX.filter((control) => 'subtitle' in control).map((control) => [
        control.key,
        control.subtitle,
      ]),
    ).toStrictEqual([
      ['isEnablePWA', 'PWAを有効化する(※再読込後有効になります)'],
      ['shouldUseOSColorTheme', 'OSのカラーテーマに連動させる'],
      ['isForceDarkTheme', 'ダークテーマを有効化する'],
      ['isHalfWidthDisplayed', '強制的に半角表示にする'],
      ['isOnAirTabListView', '放送波毎にタブで分ける'],
      ['isForceDisableDarkThemeForGuide', 'ダークテーマ使用時でも通常時と同じ配色設定になります'],
      ['isEnableDisplayForEachBroadcastWave', 'ナビゲーションの表示を放送波別に分ける'],
      [
        'isShowDropInfoInsteadOfDescription',
        '概要の代わりにドロップとファイルサイズ情報を表示する',
      ],
      [
        'deleteRecordedDefaultValue',
        '有効にするとファイル削除のチェックが入れられた状態で録画削除ダイアログが開かれます',
      ],
      ['isEnableAutoScrollWhenEditingRule', 'ルール編集時に検索結果へ自動スクロールする'],
      ['isEnableCopyKeywordToDirectory', 'ルール作成時にキーワードをサブディレクトリにコピーする'],
      ['isCheckAvoidDuplicate', 'ルール作成時に録画済み番組を排除をチェックする'],
      ['isEnableEncodingSettingWhenCreateRule', 'ルール作成時にエンコード設定を自動で行う'],
      ['isCheckDeleteOriginalAfterEncode', 'ルール作成時に元ファイルの自動削除をチェックする'],
      ['isForceEnableSubtitleStroke', 'aribb24.js 使用時に有効になります'],
    ])
  })

  it('derives select options from Settings Storage UI contract', () => {
    const guideMode = SETTINGS_CONTROL_MATRIX.find((control) => control.key === 'guideMode')
    const guideLength = SETTINGS_CONTROL_MATRIX.find((control) => control.key === 'guideLength')
    const searchLength = SETTINGS_CONTROL_MATRIX.find((control) => control.key === 'searchLength')

    expect(guideMode?.options).toStrictEqual([
      { label: '逐次', value: 'sequential' },
      { label: '最小', value: 'minimum' },
      { label: 'すべて', value: 'all' },
    ])
    expect(guideMode?.options?.map((option) => option.value)).toStrictEqual(
      SETTINGS_UI_CONTRACT.guideMode.values,
    )
    expect(guideLength?.options?.map((option) => option.value)).toStrictEqual(
      Array.from({ length: 24 }, (_, index) => index + 1),
    )
    expect(guideLength?.range).toStrictEqual({ min: 1, max: 24, step: 1 })
    expect(searchLength?.options?.map((option) => option.value)).toStrictEqual(
      SETTINGS_UI_CONTRACT.searchLength.values,
    )
    expect(searchLength?.range).toStrictEqual({ min: 50, max: 600, step: 50 })
    expect(
      SETTINGS_CONTROL_MATRIX.find((control) => control.key === 'reservesLength')?.range,
    ).toStrictEqual({ min: 1, max: 100, step: 1 })
    expect(
      SETTINGS_CONTROL_MATRIX.find((control) => control.key === 'recordingLength')?.range,
    ).toStrictEqual({ min: 1, max: 100, step: 1 })
    expect(
      SETTINGS_CONTROL_MATRIX.find((control) => control.key === 'recordedLength')?.range,
    ).toStrictEqual({ min: 1, max: 100, step: 1 })
    expect(
      SETTINGS_CONTROL_MATRIX.find((control) => control.key === 'rulesLength')?.range,
    ).toStrictEqual({ min: 1, max: 100, step: 1 })
  })

  it('fixes visible and disabled conditions in the matrix contract', () => {
    const matrixKeys: readonly string[] = SETTINGS_CONTROL_MATRIX.map((control) => control.key)

    expect(matrixKeys).toContain('isPreferredPlayingLiveM2TSOnWeb')
    expect(
      SETTINGS_CONTROL_MATRIX.find((control) => control.key === 'isForceDarkTheme'),
    ).toMatchObject({
      disabledWhen: 'osColorThemeEnabled',
      tmpTarget: 'isForceDarkTheme',
    })
    expect(
      SETTINGS_CONTROL_MATRIX.find((control) => control.key === 'isForceDisableDarkThemeForGuide'),
    ).toMatchObject({
      disabledWhen: 'previewThemeLight',
      tmpTarget: 'isForceDisableDarkThemeForGuide',
    })
  })

  it('resolves mpegts visibility and theme-based disabled conditions without mutating tmp', () => {
    const mpegtsOnlyControl = {
      section: '放映中',
      label: 'synthetic mpegts-only control',
      key: 'isOnAirTabListView',
      controlType: 'switch',
      tmpTarget: 'isOnAirTabListView',
      visibleWhen: 'mpegtsSupported',
    } as const satisfies SettingsControlDefinition
    const controlsWithoutMpegts = resolveVisibleSettingsControls({
      tmp: defaultTmp,
      mpegtsSupported: false,
      currentPreviewTheme: 'dark',
    })

    const visibleKeys: readonly string[] = controlsWithoutMpegts.map((control) => control.key)

    expect(visibleKeys).not.toContain('isPreferredPlayingLiveM2TSOnWeb')
    expect(
      isSettingsControlVisible(mpegtsOnlyControl, {
        tmp: defaultTmp,
        mpegtsSupported: false,
        currentPreviewTheme: 'dark',
      }),
    ).toBe(false)
    expect(
      isSettingsControlVisible(mpegtsOnlyControl, {
        tmp: defaultTmp,
        mpegtsSupported: true,
        currentPreviewTheme: 'dark',
      }),
    ).toBe(true)

    const manualDarkTheme = SETTINGS_CONTROL_MATRIX.find(
      (control) => control.key === 'isForceDarkTheme',
    )
    const guideDarkTheme = SETTINGS_CONTROL_MATRIX.find(
      (control) => control.key === 'isForceDisableDarkThemeForGuide',
    )
    const osThemeTmp: SettingsConsumerValue = {
      ...defaultTmp,
      shouldUseOSColorTheme: true,
    }

    expect(manualDarkTheme).toBeDefined()
    expect(guideDarkTheme).toBeDefined()
    expect(
      isSettingsControlDisabled(manualDarkTheme!, {
        tmp: osThemeTmp,
        mpegtsSupported: true,
        currentPreviewTheme: 'dark',
      }),
    ).toBe(true)
    expect(
      isSettingsControlDisabled(guideDarkTheme!, {
        tmp: defaultTmp,
        mpegtsSupported: true,
        currentPreviewTheme: 'light',
      }),
    ).toBe(true)
  })

  it('shows out-of-range select values as unselected and only writes allowed user choices', () => {
    const guideLength = SETTINGS_CONTROL_MATRIX.find((control) => control.key === 'guideLength')
    const invalidTmp: SettingsConsumerValue = {
      ...defaultTmp,
      guideLength: 99,
    }

    expect(guideLength).toBeDefined()
    expect(resolveSettingsControlDisplayValue(guideLength!, invalidTmp)).toBe('')
    expect(createSettingsControlUpdate(guideLength!, '99')).toBeNull()
    expect(createSettingsControlUpdate(guideLength!, '24')).toStrictEqual({
      key: 'guideLength',
      value: 24,
    })
  })

  it('rejects a non-boolean value for a switch control instead of producing a tmp update', () => {
    const switchControl = SETTINGS_CONTROL_MATRIX.find((control) => control.key === 'isEnablePWA')

    expect(switchControl).toBeDefined()
    expect(createSettingsControlUpdate(switchControl!, 'not-a-boolean')).toBeNull()
  })

  it('coerces a non-string value for a text control into its update', () => {
    const textControl = SETTINGS_CONTROL_MATRIX.find(
      (control) => control.key === 'onAirM2TSViewURLScheme',
    )

    expect(textControl).toBeDefined()
    expect(createSettingsControlUpdate(textControl!, true)).toStrictEqual({
      key: 'onAirM2TSViewURLScheme',
      value: 'true',
    })
  })

  it('resolves the preview theme to dark when the OS prefers dark and OS color theme is enabled', () => {
    expect(
      resolveSettingsPreviewTheme({ shouldUseOSColorTheme: true, isForceDarkTheme: false }, true),
    ).toBe('dark')
    expect(
      resolveSettingsPreviewTheme({ shouldUseOSColorTheme: true, isForceDarkTheme: false }, false),
    ).toBe('light')
  })
})
