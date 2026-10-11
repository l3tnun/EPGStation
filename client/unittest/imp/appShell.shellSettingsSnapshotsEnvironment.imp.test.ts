import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyBrowserPwaStartupSettings,
  loadNavigationSettingsSnapshot,
  loadThemeSettingsSnapshot,
  mergeThemeSettings,
} from '@/app/lib/shellSettingsSnapshots'
import { readPwaSettingsSnapshot } from '@/app/pwa'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('shell settings snapshots without a browser environment', () => {
  it('uses the default settings when there is no window', () => {
    const defaults = new DefaultSettingsFactory().create()
    vi.stubGlobal('window', undefined)

    expect(loadThemeSettingsSnapshot()).toStrictEqual({
      shouldUseOSColorTheme: defaults.shouldUseOSColorTheme,
      isForceDarkTheme: defaults.isForceDarkTheme,
    })
    expect(loadNavigationSettingsSnapshot()).toStrictEqual({
      isEnableDisplayForEachBroadcastWave: defaults.isEnableDisplayForEachBroadcastWave,
    })
  })

  it('does nothing for PWA startup without a window or without a document', () => {
    window.localStorage.setItem('settings', JSON.stringify({ isEnablePWA: false }))
    expect(readPwaSettingsSnapshot(window.localStorage).isEnablePWA).toBe(false)
    vi.stubGlobal('document', undefined)
    expect(() => applyBrowserPwaStartupSettings()).not.toThrow()
    vi.unstubAllGlobals()
    vi.stubGlobal('window', undefined)
    expect(() => applyBrowserPwaStartupSettings()).not.toThrow()
  })
})

describe('theme settings merge', () => {
  it('prefers the provided setting over the stored one even when it is false', () => {
    const stored = { shouldUseOSColorTheme: true, isForceDarkTheme: true }

    expect(
      mergeThemeSettings(stored, {
        shouldUseOSColorTheme: false,
        isForceDarkTheme: false,
      } as never),
    ).toStrictEqual({
      shouldUseOSColorTheme: false,
      isForceDarkTheme: false,
    })
    expect(
      mergeThemeSettings({ shouldUseOSColorTheme: false, isForceDarkTheme: false }, {
        shouldUseOSColorTheme: true,
        isForceDarkTheme: true,
      } as never),
    ).toStrictEqual({ shouldUseOSColorTheme: true, isForceDarkTheme: true })
    expect(mergeThemeSettings(stored, undefined)).toStrictEqual(stored)
  })
})
