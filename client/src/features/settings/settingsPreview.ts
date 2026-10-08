import type { SettingsConsumerValue, ThemeSettings } from '@/shared/settings'

export type SettingsThemeControlKey = 'shouldUseOSColorTheme' | 'isForceDarkTheme'

export interface SettingsThemeControlUpdate {
  tmp: SettingsConsumerValue
  key: SettingsThemeControlKey
  value: boolean
  osPrefersDark: boolean
}

export interface SettingsResetPreviewInput {
  saved: SettingsConsumerValue
  defaults: SettingsConsumerValue
}

export interface SettingsPreviewStateUpdate {
  tmp: SettingsConsumerValue
  visibleThemeSettings: ThemeSettings
}

export function pickThemeSettings(settings: SettingsConsumerValue): ThemeSettings {
  return {
    shouldUseOSColorTheme: settings.shouldUseOSColorTheme,
    isForceDarkTheme: settings.isForceDarkTheme,
  }
}

export function createSettingsThemeControlTmp({
  tmp,
  key,
  value,
  osPrefersDark,
}: SettingsThemeControlUpdate): SettingsConsumerValue {
  if (key === 'shouldUseOSColorTheme' && value) {
    return {
      ...tmp,
      shouldUseOSColorTheme: true,
      isForceDarkTheme: osPrefersDark,
    }
  }

  return {
    ...tmp,
    [key]: value,
  }
}

export function resetTmpToDefaultSettings({
  saved,
  defaults,
}: SettingsResetPreviewInput): SettingsPreviewStateUpdate {
  return {
    tmp: { ...defaults },
    visibleThemeSettings: pickThemeSettings(saved),
  }
}

export function restoreSavedThemeSettings(
  saved: SettingsConsumerValue,
): SettingsPreviewStateUpdate {
  return {
    tmp: { ...saved },
    visibleThemeSettings: pickThemeSettings(saved),
  }
}
