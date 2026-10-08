import type { AppProps } from '../appProps'
import type { NavigationSettings } from '../navigation'
import { applyPwaStartupSettings, readPwaSettingsSnapshot } from '../pwa'
import {
  readNavigationSettingsSnapshot,
  readThemeSettingsSnapshot,
} from '../settingsStorageAdapter'
import type { SettingsConsumerValue, ThemeSettings } from '../../shared/settings'
import { DefaultSettingsFactory } from '../../shared/settings/defaultSettings'
import { createDefaultSettingsInputFromNavigator } from '../../shared/settings/platformDefaultSettings'
import { SettingsValidator } from '../../shared/settings/settingsValidation'

export function loadThemeSettingsSnapshot(): ThemeSettings {
  try {
    if (typeof window !== 'undefined') {
      return readThemeSettingsSnapshot(window.localStorage)
    }
  } catch {
    // Storage の getter が拒否されても、既定の表示設定で起動する。
  }

  const defaults = new DefaultSettingsFactory().create()
  return {
    shouldUseOSColorTheme: defaults.shouldUseOSColorTheme,
    isForceDarkTheme: defaults.isForceDarkTheme,
  }
}

export function loadNavigationSettingsSnapshot(): NavigationSettings {
  try {
    if (typeof window !== 'undefined') {
      return readNavigationSettingsSnapshot(window.localStorage)
    }
  } catch {
    // Storage の getter が拒否されても、既定の表示設定で起動する。
  }

  return {
    isEnableDisplayForEachBroadcastWave: new DefaultSettingsFactory().create()
      .isEnableDisplayForEachBroadcastWave,
  }
}

export function loadDashboardSettingsSnapshot(): SettingsConsumerValue {
  if (typeof window === 'undefined') {
    return new DefaultSettingsFactory().create()
  }

  const defaults = new DefaultSettingsFactory().create(
    createDefaultSettingsInputFromNavigator(window.navigator),
  )
  const validator = new SettingsValidator(defaults)

  try {
    return validator.parse(window.localStorage.getItem('settings')).value
  } catch {
    return defaults
  }
}

export function applyBrowserPwaStartupSettings(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  let settings = { isEnablePWA: new DefaultSettingsFactory().create().isEnablePWA }
  try {
    settings = readPwaSettingsSnapshot(window.localStorage)
  } catch {
    // Storage の getter が拒否されても、既定の PWA 設定を使う。
  }

  applyPwaStartupSettings(settings, {
    document,
    serviceWorker: window.navigator.serviceWorker,
  })
}

export function resolveProvidedNavigationSettings(
  settings: AppProps['settings'],
): NavigationSettings | undefined {
  if (settings?.isEnableDisplayForEachBroadcastWave === undefined) {
    return undefined
  }

  return {
    isEnableDisplayForEachBroadcastWave: settings.isEnableDisplayForEachBroadcastWave,
  }
}

export function mergeThemeSettings(
  storedSettings: ThemeSettings,
  settings: AppProps['settings'],
): ThemeSettings {
  return {
    shouldUseOSColorTheme: settings?.shouldUseOSColorTheme ?? storedSettings.shouldUseOSColorTheme,
    isForceDarkTheme: settings?.isForceDarkTheme ?? storedSettings.isForceDarkTheme,
  }
}
