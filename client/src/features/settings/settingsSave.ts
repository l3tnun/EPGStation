import type { ShellSnackbarState } from '@/app/AppShell'
import { requestNavigationRegeneration } from '@/app/navigation/regenerationRequest'
import type { SettingsSaveResult } from '@/shared/settings'

export const SETTINGS_SAVE_SUCCESS_SNACKBAR: ShellSnackbarState = {
  text: '保存されました',
  severity: 'success',
}

export const SETTINGS_SAVE_FAILURE_SNACKBAR: ShellSnackbarState = {
  text: '設定の保存に失敗しました',
  severity: 'error',
}

export interface SettingsSaveControllerInput {
  saveTmp: () => SettingsSaveResult
  navigationRegenerationTarget: EventTarget
  showSnackbar?: (snackbar: ShellSnackbarState) => void
}

export function saveSettingsTmp({
  saveTmp,
  navigationRegenerationTarget,
  showSnackbar,
}: SettingsSaveControllerInput): SettingsSaveResult {
  const result = saveTmp()

  if (!result.ok) {
    showSnackbar?.(SETTINGS_SAVE_FAILURE_SNACKBAR)

    return result
  }

  showSnackbar?.(SETTINGS_SAVE_SUCCESS_SNACKBAR)
  requestNavigationRegeneration(navigationRegenerationTarget)

  return result
}
