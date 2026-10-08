import { useCallback, useEffect, useState } from 'react'
import type { AppProps } from '../appProps'
import {
  loadDashboardSettingsSnapshot,
  loadNavigationSettingsSnapshot,
  loadThemeSettingsSnapshot,
  mergeThemeSettings,
  resolveProvidedNavigationSettings,
} from '../lib/shellSettingsSnapshots'
import type { NavigationSettings } from '../navigation'
import { subscribeToNavigationRegenerationRequests } from '../navigation/regenerationRequest'
import type { SettingsConsumerValue, ThemeSettings } from '../../shared/settings'

// `SettingsConsumerValue` (see ../../shared/settings/settingsTypes.ts) is a flat record of
// primitive fields only (string | number | boolean | null) - no nested objects or arrays - so a
// shallow key-by-key comparison is a complete equality check, not an approximation.
function areDashboardSettingsEqual(a: SettingsConsumerValue, b: SettingsConsumerValue): boolean {
  if (a === b) {
    return true
  }

  const keys = Object.keys(a) as (keyof SettingsConsumerValue)[]
  if (keys.length !== Object.keys(b).length) {
    return false
  }

  return keys.every((key) => Object.is(a[key], b[key]))
}

export interface ShellSettingsState {
  activeThemeSettings: ThemeSettings
  activeNavigationSettings: NavigationSettings
  activeDashboardSettings: SettingsConsumerValue
  onSettingsThemePreviewChange: (settings: ThemeSettings) => void
  onSettingsThemePreviewRestore: (settings: ThemeSettings) => void
  onSettingsSaved: (settings: SettingsConsumerValue) => void
}

export function useShellSettings({
  settings,
  navigationSettings,
}: Pick<AppProps, 'settings' | 'navigationSettings'>): ShellSettingsState {
  const [storedSettings, setStoredSettings] = useState(loadThemeSettingsSnapshot)
  const [previewThemeSettings, setPreviewThemeSettings] = useState<ThemeSettings | undefined>(
    undefined,
  )
  const [storedNavigationSettings, setStoredNavigationSettings] = useState(
    loadNavigationSettingsSnapshot,
  )
  const [storedDashboardSettings, setStoredDashboardSettings] = useState(
    loadDashboardSettingsSnapshot,
  )
  const activeThemeSettings = previewThemeSettings ?? mergeThemeSettings(storedSettings, settings)
  const activeNavigationSettings =
    navigationSettings ?? resolveProvidedNavigationSettings(settings) ?? storedNavigationSettings
  // Reuses the previous object reference whenever the merged content is unchanged, even if
  // `storedDashboardSettings` or `settings` themselves are new object references (e.g. a caller
  // that recreates its `settings` prop on every render). Consumers that depend on
  // `activeDashboardSettings` in an effect dependency array must not re-run just because an
  // unrelated ancestor re-rendered (see AppRoot -> useResolvedViewportWidth, which re-renders on
  // every viewport width change such as a scrollbar appearing).
  //
  // This follows React's documented "adjust state during rendering" pattern (comparing against a
  // state value and calling its setter conditionally, in the render body itself) rather than a
  // ref: reading or writing a ref during render is not safe under the React Compiler, which this
  // project lints for (react-hooks/refs).
  const nextDashboardSettings: SettingsConsumerValue = {
    ...storedDashboardSettings,
    ...settings,
  }
  const [activeDashboardSettings, setActiveDashboardSettings] =
    useState<SettingsConsumerValue>(nextDashboardSettings)
  if (!areDashboardSettingsEqual(activeDashboardSettings, nextDashboardSettings)) {
    setActiveDashboardSettings(nextDashboardSettings)
  }
  const onSettingsThemePreviewChange = useCallback((nextSettings: ThemeSettings) => {
    setPreviewThemeSettings(nextSettings)
  }, [])
  const onSettingsThemePreviewRestore = useCallback((nextSettings: ThemeSettings) => {
    setPreviewThemeSettings(undefined)
    setStoredSettings(nextSettings)
  }, [])
  const onSettingsSaved = useCallback(
    (nextSettings: SettingsConsumerValue) => {
      setStoredSettings(mergeThemeSettings(storedSettings, nextSettings))
      setStoredDashboardSettings(nextSettings)
      setPreviewThemeSettings(undefined)
    },
    [storedSettings],
  )

  useEffect(() => {
    if (typeof window === 'undefined' || navigationSettings !== undefined) {
      return () => undefined
    }

    return subscribeToNavigationRegenerationRequests(window, () => {
      setStoredNavigationSettings(loadNavigationSettingsSnapshot())
    })
  }, [navigationSettings])

  return {
    activeThemeSettings,
    activeNavigationSettings,
    activeDashboardSettings,
    onSettingsThemePreviewChange,
    onSettingsThemePreviewRestore,
    onSettingsSaved,
  }
}
