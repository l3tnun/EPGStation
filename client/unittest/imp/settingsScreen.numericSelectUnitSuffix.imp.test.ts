import { describe, expect, it } from 'vitest'
import { SETTINGS_CONTROL_MATRIX } from '@/features/settings/settingsControlMatrix'

// Requirement (frontend-settings-screen requirements.md 1.21, design.md 表示値 suffix 記述):
// v2 (`client/src/views/Settings.vue:419-431`) built numeric select options from plain
// `i.toString(10)` values ("24", "300", ...) with no unit. v3 appends a unit suffix so the
// select itself communicates whether the value is a duration ("時間") or a count ("件").
const HOUR_SUFFIX_KEYS = ['guideLength'] as const
const COUNT_SUFFIX_KEYS = [
  'reservesLength',
  'recordingLength',
  'recordedLength',
  'searchLength',
  'rulesLength',
] as const

function optionsFor(key: string) {
  const control = SETTINGS_CONTROL_MATRIX.find((candidate) => candidate.key === key)

  if (!control || !('options' in control)) {
    throw new Error(`expected a select control with options for key: ${key}`)
  }

  return control.options
}

describe('Settings screen v2 parity: numeric select unit suffix', () => {
  it.each(HOUR_SUFFIX_KEYS)('[AC 1.21] labels every %s option with the 時間 suffix', (key) => {
    const options = optionsFor(key)

    expect(options.length).toBeGreaterThan(0)
    options.forEach((option) => {
      expect(option.label).toBe(`${option.value}時間`)
    })
  })

  it.each(COUNT_SUFFIX_KEYS)('[AC 1.21] labels every %s option with the 件 suffix', (key) => {
    const options = optionsFor(key)

    expect(options.length).toBeGreaterThan(0)
    options.forEach((option) => {
      expect(option.label).toBe(`${option.value}件`)
    })
  })

  it('[AC 1.21] never falls back to a bare numeric string label (matches v2 exactly)', () => {
    const allNumericOptions = [...HOUR_SUFFIX_KEYS, ...COUNT_SUFFIX_KEYS].flatMap((key) =>
      optionsFor(key),
    )

    allNumericOptions.forEach((option) => {
      expect(option.label).not.toBe(String(option.value))
    })
  })
})
