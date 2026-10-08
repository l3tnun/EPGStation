import { describe, expect, it } from 'vitest'
import {
  formatSettingsSelectValue,
  getAccessibleName,
  isVisibleControl,
} from '@/features/settings/lib/settingsControlSupport'
import type { SettingsControlDefinition } from '@/features/settings/settingsControlMatrix'

const switchControl = {
  section: '全般',
  label: 'synthetic switch',
  key: 'isEnablePWA',
  controlType: 'switch',
  tmpTarget: 'isEnablePWA',
} as const satisfies SettingsControlDefinition

const selectControl = {
  section: '番組表',
  label: 'synthetic select',
  key: 'guideMode',
  controlType: 'select',
  tmpTarget: 'guideMode',
  options: [
    { label: '逐次', value: 'sequential' },
    { label: '最小', value: 'minimum' },
  ],
} as const satisfies SettingsControlDefinition

const mpegtsOnlyControl = {
  section: '放映中',
  label: 'synthetic mpegts-only control',
  key: 'isOnAirTabListView',
  controlType: 'switch',
  tmpTarget: 'isOnAirTabListView',
  visibleWhen: 'mpegtsSupported',
} as const satisfies SettingsControlDefinition

describe('settingsControlSupport implementation contract', () => {
  it('builds the accessible name from section and label', () => {
    expect(getAccessibleName(switchControl)).toBe('全般 synthetic switch')
  })

  it('returns the raw value unchanged for non-select controls', () => {
    expect(formatSettingsSelectValue(switchControl, 'true')).toBe('true')
  })

  it('resolves the option label for a matching select value', () => {
    expect(formatSettingsSelectValue(selectControl, 'sequential')).toBe('逐次')
  })

  it('falls back to the raw value when no select option matches', () => {
    expect(formatSettingsSelectValue(selectControl, 'unknown-legacy-value')).toBe(
      'unknown-legacy-value',
    )
  })

  it('treats controls without visibleWhen as always visible regardless of mpegts support', () => {
    expect(isVisibleControl(switchControl, false)).toBe(true)
    expect(isVisibleControl(switchControl, true)).toBe(true)
  })

  it('hides an mpegtsSupported-gated control until mpegts support is detected', () => {
    expect(isVisibleControl(mpegtsOnlyControl, false)).toBe(false)
    expect(isVisibleControl(mpegtsOnlyControl, true)).toBe(true)
  })
})
