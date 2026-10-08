import { describe, expect, it, vi } from 'vitest'
import type { SettingsConsumerValue } from '@/shared/settings'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createSettingsThemeControlTmp,
  restoreSavedThemeSettings,
  resetTmpToDefaultSettings,
} from '@/features/settings/settingsPreview'
import {
  SETTINGS_SAVE_FAILURE_SNACKBAR,
  SETTINGS_SAVE_SUCCESS_SNACKBAR,
  saveSettingsTmp,
} from '@/features/settings/settingsSave'

describe('Requirements 2.2-2.4 Settings save implementation contract', () => {
  it('persists tmp before emitting the success snackbar and navigation regeneration request', () => {
    const calls: string[] = []
    const target = new EventTarget()
    const showSnackbar = vi.fn(() => {
      calls.push('snackbar')
    })

    target.addEventListener('epgstation:navigation-regeneration-request', () => {
      calls.push('navigation')
    })

    const result = saveSettingsTmp({
      saveTmp: () => {
        calls.push('save')
        return { ok: true }
      },
      navigationRegenerationTarget: target,
      showSnackbar,
    })

    expect(result).toStrictEqual({ ok: true })
    expect(calls).toStrictEqual(['save', 'snackbar', 'navigation'])
    expect(showSnackbar).toHaveBeenCalledWith(SETTINGS_SAVE_SUCCESS_SNACKBAR)
  })

  it('reports a persistence failure with an error snackbar and requests no navigation regeneration', () => {
    const target = new EventTarget()
    const showSnackbar = vi.fn()
    const navigationRequest = vi.fn()

    target.addEventListener('epgstation:navigation-regeneration-request', navigationRequest)

    const result = saveSettingsTmp({
      saveTmp: () => ({ ok: false }),
      navigationRegenerationTarget: target,
      showSnackbar,
    })

    expect(result).toStrictEqual({ ok: false })
    expect(showSnackbar).toHaveBeenCalledTimes(1)
    expect(showSnackbar).toHaveBeenCalledWith(SETTINGS_SAVE_FAILURE_SNACKBAR)
    expect(SETTINGS_SAVE_FAILURE_SNACKBAR).toStrictEqual({
      text: '設定の保存に失敗しました',
      severity: 'error',
    })
    expect(navigationRequest).not.toHaveBeenCalled()
  })
})

describe('Requirements 2.5, 3.1-3.7 Settings preview implementation contract', () => {
  it('sets manual dark tmp from the OS-derived state when OS color theme is enabled', () => {
    const tmp: SettingsConsumerValue = {
      ...new DefaultSettingsFactory().create(),
      shouldUseOSColorTheme: false,
      isForceDarkTheme: false,
    }

    expect(
      createSettingsThemeControlTmp({
        tmp,
        key: 'shouldUseOSColorTheme',
        value: true,
        osPrefersDark: true,
      }),
    ).toMatchObject({
      shouldUseOSColorTheme: true,
      isForceDarkTheme: true,
    })
  })

  it('keeps reset theme preview on saved settings until a later theme control change', () => {
    const saved: SettingsConsumerValue = {
      ...new DefaultSettingsFactory().create(),
      isEnablePWA: false,
      shouldUseOSColorTheme: false,
      isForceDarkTheme: true,
    }

    const reset = resetTmpToDefaultSettings({
      saved,
      defaults: new DefaultSettingsFactory().create(),
    })

    expect(reset.tmp).toMatchObject({
      isEnablePWA: true,
      shouldUseOSColorTheme: true,
      isForceDarkTheme: false,
    })
    expect(reset.visibleThemeSettings).toStrictEqual({
      shouldUseOSColorTheme: false,
      isForceDarkTheme: true,
    })
  })

  it('restores tmp and visible theme settings from saved settings on route leave', () => {
    const saved: SettingsConsumerValue = {
      ...new DefaultSettingsFactory().create(),
      isEnablePWA: false,
      shouldUseOSColorTheme: false,
      isForceDarkTheme: false,
    }

    expect(restoreSavedThemeSettings(saved)).toStrictEqual({
      tmp: saved,
      visibleThemeSettings: {
        shouldUseOSColorTheme: false,
        isForceDarkTheme: false,
      },
    })
  })
})
