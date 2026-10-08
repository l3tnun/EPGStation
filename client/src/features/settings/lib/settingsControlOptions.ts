import type { SettingsControlOption } from '../settingsControlTypes'

export const rangeOptions = (
  min: number,
  max: number,
  suffix: string,
): readonly SettingsControlOption[] =>
  Array.from({ length: max - min + 1 }, (_, index) => {
    const value = min + index

    return {
      label: `${value}${suffix}`,
      value,
    }
  })

export const valueOptions = (
  values: readonly number[],
  suffix: string,
): readonly SettingsControlOption[] =>
  values.map((value) => ({
    label: `${value}${suffix}`,
    value,
  }))
