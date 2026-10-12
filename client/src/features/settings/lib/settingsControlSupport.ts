import type { SettingsControlDefinition } from '../settingsControlMatrix'

export function getAccessibleName(control: SettingsControlDefinition): string {
  return `${control.section} ${control.label}`
}

export function formatSettingsSelectValue(
  control: SettingsControlDefinition,
  value: string,
): string {
  if (control.controlType !== 'select') {
    return value
  }

  return control.options?.find((option) => String(option.value) === value)?.label ?? value
}

export function isVisibleControl(
  control: SettingsControlDefinition,
  mpegtsSupported: boolean,
): boolean {
  return control.visibleWhen !== 'mpegtsSupported' || mpegtsSupported
}

export type SettingsControlChangeHandler = (
  control: SettingsControlDefinition,
  value: string | boolean,
) => void
