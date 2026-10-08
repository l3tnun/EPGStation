import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { SettingsValidator } from '@/shared/settings/settingsValidation'
import { SETTINGS_STORAGE_KEY, type ThemeSettings } from '@/shared/settings'
import type { NavigationSettings } from './navigation'

function readRawSettings(storage: Storage): string | null {
  try {
    return storage.getItem(SETTINGS_STORAGE_KEY)
  } catch {
    return null
  }
}

export function readThemeSettingsSnapshot(storage: Storage): ThemeSettings {
  const defaults = new DefaultSettingsFactory().create()
  const validator = new SettingsValidator(defaults)
  const loaded = validator.parse(readRawSettings(storage))

  return {
    shouldUseOSColorTheme: loaded.value.shouldUseOSColorTheme,
    isForceDarkTheme: loaded.value.isForceDarkTheme,
  }
}

export function readNavigationSettingsSnapshot(storage: Storage): NavigationSettings {
  const defaults = new DefaultSettingsFactory().create()
  const validator = new SettingsValidator(defaults)
  const loaded = validator.parse(readRawSettings(storage))

  return {
    isEnableDisplayForEachBroadcastWave: loaded.value.isEnableDisplayForEachBroadcastWave,
  }
}
