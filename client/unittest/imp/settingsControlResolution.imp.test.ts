import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detectMpegtsLivePlaybackSupport } from '@/shared/media/mpegtsSupport'
import { formatSettingsSelectValue } from '@/features/settings/lib/settingsControlSupport'
import { rangeOptions, valueOptions } from '@/features/settings/lib/settingsControlOptions'
import {
  createSettingsControlUpdate,
  detectMpegtsSupport,
  isSettingsControlVisible,
  resolveSettingsControlDisplayValue,
  resolveSettingsPreviewTheme,
  type SettingsControlDefinition,
} from '@/features/settings/settingsControlMatrix'
import type { SettingsConsumerValue } from '@/shared/settings'

vi.mock('@/shared/media/mpegtsSupport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/media/mpegtsSupport')>()),
  detectMpegtsLivePlaybackSupport: vi.fn(),
}))

const switchControl = {
  section: '全般',
  label: 'synthetic switch',
  key: 'isEnablePWA',
  controlType: 'switch',
  tmpTarget: 'isEnablePWA',
} as const satisfies SettingsControlDefinition

const textControl = {
  section: '放映中',
  label: 'synthetic text',
  key: 'onAirM2TSViewURLScheme',
  controlType: 'text',
  tmpTarget: 'onAirM2TSViewURLScheme',
} as const satisfies SettingsControlDefinition

const selectWithoutOptions = {
  section: '番組表',
  label: 'synthetic select without options',
  key: 'guideMode',
  controlType: 'select',
  tmpTarget: 'guideMode',
} as const satisfies SettingsControlDefinition

const selectWithOptions = {
  section: '番組表',
  label: 'synthetic select',
  key: 'guideLength',
  controlType: 'select',
  tmpTarget: 'guideLength',
  options: [
    { label: '1日', value: 1 },
    { label: '2日', value: 2 },
  ],
} as const satisfies SettingsControlDefinition

function tmpWith(values: Record<string, unknown>): SettingsConsumerValue {
  return values as unknown as SettingsConsumerValue
}

describe('settings control resolution', () => {
  beforeEach(() => {
    vi.mocked(detectMpegtsLivePlaybackSupport).mockReset()
  })

  it('shows a control without a visibility condition whether or not mpegts is supported', () => {
    for (const mpegtsSupported of [false, true]) {
      expect(
        isSettingsControlVisible(switchControl, {
          tmp: tmpWith({}),
          mpegtsSupported,
          currentPreviewTheme: 'light',
        }),
      ).toBe(true)
    }
  })

  it('shows an mpegts-gated control only when mpegts is supported', () => {
    const gated = { ...switchControl, visibleWhen: 'mpegtsSupported' } as const
    expect(
      isSettingsControlVisible(gated, {
        tmp: tmpWith({}),
        mpegtsSupported: false,
        currentPreviewTheme: 'light',
      }),
    ).toBe(false)
    expect(
      isSettingsControlVisible(gated, {
        tmp: tmpWith({}),
        mpegtsSupported: true,
        currentPreviewTheme: 'light',
      }),
    ).toBe(true)
  })

  it('displays an empty string for a null text value and the string for a saved text value', () => {
    expect(
      resolveSettingsControlDisplayValue(textControl, tmpWith({ onAirM2TSViewURLScheme: null })),
    ).toBe('')
    expect(
      resolveSettingsControlDisplayValue(textControl, tmpWith({ onAirM2TSViewURLScheme: 'saved' })),
    ).toBe('saved')
  })

  it('displays a switch as true only for a true boolean and false for anything else', () => {
    expect(resolveSettingsControlDisplayValue(switchControl, tmpWith({ isEnablePWA: true }))).toBe(
      'true',
    )
    expect(resolveSettingsControlDisplayValue(switchControl, tmpWith({ isEnablePWA: false }))).toBe(
      'false',
    )
    expect(
      resolveSettingsControlDisplayValue(switchControl, tmpWith({ isEnablePWA: 'true' })),
    ).toBe('false')
    expect(resolveSettingsControlDisplayValue(switchControl, tmpWith({ isEnablePWA: null }))).toBe(
      'false',
    )
  })

  it('creates no update for a select control that has no options', () => {
    expect(createSettingsControlUpdate(selectWithoutOptions, 'sequential')).toBeNull()
  })

  it('creates a select update that keeps the option value type', () => {
    expect(createSettingsControlUpdate(selectWithOptions, '2')).toEqual({
      key: 'guideLength',
      value: 2,
    })
    expect(createSettingsControlUpdate(selectWithOptions, '3')).toBeNull()
  })

  it('creates a text update from a string and rejects a non-boolean switch value', () => {
    expect(createSettingsControlUpdate(textControl, 'abc')).toEqual({
      key: 'onAirM2TSViewURLScheme',
      value: 'abc',
    })
    expect(createSettingsControlUpdate(switchControl, 'true')).toBeNull()
    expect(createSettingsControlUpdate(switchControl, false)).toEqual({
      key: 'isEnablePWA',
      value: false,
    })
  })

  it('follows the OS preference only while the OS color theme is on, else the forced setting', () => {
    expect(
      resolveSettingsPreviewTheme({ shouldUseOSColorTheme: true, isForceDarkTheme: false }, true),
    ).toBe('dark')
    expect(
      resolveSettingsPreviewTheme({ shouldUseOSColorTheme: true, isForceDarkTheme: true }, false),
    ).toBe('light')
    expect(
      resolveSettingsPreviewTheme({ shouldUseOSColorTheme: false, isForceDarkTheme: true }, false),
    ).toBe('dark')
    expect(
      resolveSettingsPreviewTheme({ shouldUseOSColorTheme: false, isForceDarkTheme: false }, true),
    ).toBe('light')
  })

  it('reports the live playback support detected by the media layer', () => {
    vi.mocked(detectMpegtsLivePlaybackSupport).mockReturnValue(true)
    expect(detectMpegtsSupport()).toBe(true)
    vi.mocked(detectMpegtsLivePlaybackSupport).mockReturnValue(false)
    expect(detectMpegtsSupport()).toBe(false)
  })

  it('formats a select value as the raw value when the select control has no options', () => {
    expect(formatSettingsSelectValue(selectWithoutOptions, 'raw')).toBe('raw')
  })
})

describe('settings control option builders', () => {
  it('builds an inclusive range of options with the suffix', () => {
    expect(rangeOptions(3, 5, '件')).toEqual([
      { label: '3件', value: 3 },
      { label: '4件', value: 4 },
      { label: '5件', value: 5 },
    ])
    expect(rangeOptions(2, 2, '')).toEqual([{ label: '2', value: 2 }])
  })

  it('builds options from the given values in order with the suffix', () => {
    expect(valueOptions([10, 5], '分')).toEqual([
      { label: '10分', value: 10 },
      { label: '5分', value: 5 },
    ])
    expect(valueOptions([], '分')).toEqual([])
  })
})
