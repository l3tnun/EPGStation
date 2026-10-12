export * from './settingsControlTypes'
import { detectMpegtsLivePlaybackSupport } from '@/shared/media/mpegtsSupport'
import type { SettingsConsumerValue, ThemeSettings } from '@/shared/settings'
import { SETTINGS_CONTROL_ROWS_BACK } from './settingsControlRowsBack'
import { SETTINGS_CONTROL_ROWS_FRONT } from './settingsControlRowsFront'
import type {
  SettingsControlDefinition,
  SettingsControlResolutionContext,
  SettingsControlUpdate,
  SettingsPreviewTheme,
  SettingsSectionName,
} from './settingsControlTypes'

export const SETTINGS_CONTROL_MATRIX = [
  ...SETTINGS_CONTROL_ROWS_FRONT,
  ...SETTINGS_CONTROL_ROWS_BACK,
] as const satisfies readonly SettingsControlDefinition[]

export function getSettingsControlsForSection(
  section: SettingsSectionName,
): readonly SettingsControlDefinition[] {
  return SETTINGS_CONTROL_MATRIX.filter((control) => control.section === section)
}

export function isSettingsControlVisible(
  control: SettingsControlDefinition,
  context: SettingsControlResolutionContext,
): boolean {
  if (control.visibleWhen === 'mpegtsSupported') {
    return context.mpegtsSupported
  }

  return true
}

export function resolveVisibleSettingsControls(
  context: SettingsControlResolutionContext,
): readonly SettingsControlDefinition[] {
  return SETTINGS_CONTROL_MATRIX.filter((control) => isSettingsControlVisible(control, context))
}

export function isSettingsControlDisabled(
  control: SettingsControlDefinition,
  context: SettingsControlResolutionContext,
): boolean {
  if (control.disabledWhen === 'osColorThemeEnabled') {
    return context.tmp.shouldUseOSColorTheme
  }

  if (control.disabledWhen === 'previewThemeLight') {
    return context.currentPreviewTheme === 'light'
  }

  return false
}

export function resolveSettingsControlDisplayValue(
  control: SettingsControlDefinition,
  tmp: SettingsConsumerValue,
): string {
  const value = tmp[control.key]

  if (control.controlType === 'select') {
    return control.options?.some((option) => option.value === value) === true ? String(value) : ''
  }

  if (control.controlType === 'text') {
    return value === null ? '' : String(value)
  }

  return typeof value === 'boolean' && value ? 'true' : 'false'
}

export function createSettingsControlUpdate(
  control: SettingsControlDefinition,
  rawValue: string | boolean,
): SettingsControlUpdate | null {
  if (control.controlType === 'switch') {
    if (typeof rawValue !== 'boolean') {
      return null
    }

    return {
      key: control.tmpTarget,
      value: rawValue,
    }
  }

  if (control.controlType === 'text') {
    return {
      key: control.tmpTarget,
      value: typeof rawValue === 'string' ? rawValue : String(rawValue),
    }
  }

  const option = control.options?.find((candidate) => String(candidate.value) === rawValue)
  if (option === undefined) {
    return null
  }

  return {
    key: control.tmpTarget,
    value: option.value,
  }
}

export function resolveSettingsPreviewTheme(
  settings: ThemeSettings,
  osPrefersDark: boolean,
): SettingsPreviewTheme {
  if (settings.shouldUseOSColorTheme) {
    return osPrefersDark ? 'dark' : 'light'
  }

  return settings.isForceDarkTheme ? 'dark' : 'light'
}

export function detectMpegtsSupport(): boolean {
  return detectMpegtsLivePlaybackSupport()
}
