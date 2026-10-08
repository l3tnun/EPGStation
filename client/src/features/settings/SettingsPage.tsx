import Paper from '@mui/material/Paper'
import { useEffect, useRef, useState } from 'react'
import Button from '@mui/material/Button'
import { SHELL_NAVIGATION_DRAWER_ID, type ShellSnackbarState } from '@/app/AppShell'
import { useScrollHistory } from '@/app/scrollHistory'
import { TitleBar } from '@/app/titleBar'
import type { SettingsConsumerValue, ThemeSettings } from '@/shared/settings'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createSettingsControlUpdate,
  detectMpegtsSupport,
  resolveSettingsPreviewTheme,
  type SettingsControlDefinition,
  type SettingsPreviewTheme,
} from './settingsControlMatrix'
import { SETTINGS_SECTION_ORDER } from './settingsLayoutContract'
import {
  createSettingsThemeControlTmp,
  pickThemeSettings,
  resetTmpToDefaultSettings,
  restoreSavedThemeSettings,
} from './settingsPreview'
import { saveSettingsTmp } from './settingsSave'
import { SettingsSection } from './components/SettingsSection'
import { isVisibleControl } from './lib/settingsControlSupport'
import {
  createInitialSettingsTmp,
  getNavigationRegenerationTarget,
  persistSettingsTmp,
} from './lib/settingsStorageAccess'
import styles from './SettingsPage.module.css'

export interface SettingsPageProps {
  isNavigationOpen: boolean
  onNavigationClick: () => void
  mpegtsSupported?: boolean
  currentPreviewTheme?: SettingsPreviewTheme
  osPrefersDark?: boolean
  onSnackbar?: (snackbar: ShellSnackbarState) => void
  onThemePreviewChange?: (settings: ThemeSettings) => void
  onThemePreviewRestore?: (settings: ThemeSettings) => void
  onSettingsSaved?: (settings: SettingsConsumerValue) => void
}

export function SettingsPage({
  isNavigationOpen,
  onNavigationClick,
  mpegtsSupported = detectMpegtsSupport(),
  currentPreviewTheme,
  osPrefersDark = false,
  onSnackbar,
  onThemePreviewChange,
  onThemePreviewRestore,
  onSettingsSaved,
}: SettingsPageProps) {
  const scrollHistory = useScrollHistory()
  const hasEmittedScrollDone = useRef(false)
  const [tmp, setTmp] = useState(createInitialSettingsTmp)
  const savedSettingsRef = useRef(tmp)
  // Set by reset: the next save writes only tmp (as v2 does) instead of keeping stored extras.
  const isResetPendingRef = useRef(false)
  const hasActiveThemePreviewRef = useRef(false)
  const onThemePreviewRestoreRef = useRef(onThemePreviewRestore)
  const resolvedPreviewTheme =
    currentPreviewTheme ?? resolveSettingsPreviewTheme(tmp, osPrefersDark)

  useEffect(() => {
    onThemePreviewRestoreRef.current = onThemePreviewRestore
  }, [onThemePreviewRestore])

  const handleControlChange = (control: SettingsControlDefinition, rawValue: string | boolean) => {
    if (!isVisibleControl(control, mpegtsSupported)) {
      return
    }

    const update = createSettingsControlUpdate(control, rawValue)
    if (update === null) {
      return
    }

    const themeControlKey =
      update.key === 'shouldUseOSColorTheme' || update.key === 'isForceDarkTheme'
        ? update.key
        : null
    const nextTmp = themeControlKey
      ? createSettingsThemeControlTmp({
          tmp,
          key: themeControlKey,
          value: Boolean(update.value),
          osPrefersDark,
        })
      : {
          ...tmp,
          [update.key]: update.value,
        }

    setTmp(nextTmp)

    if (themeControlKey) {
      hasActiveThemePreviewRef.current = true
      onThemePreviewChange?.(pickThemeSettings(nextTmp))
    }
  }

  const handleSave = () => {
    const result = saveSettingsTmp({
      saveTmp: () => persistSettingsTmp(tmp, { discardStored: isResetPendingRef.current }),
      navigationRegenerationTarget: getNavigationRegenerationTarget(),
      showSnackbar: onSnackbar,
    })

    if (result.ok) {
      savedSettingsRef.current = tmp
      isResetPendingRef.current = false
      hasActiveThemePreviewRef.current = false
      onSettingsSaved?.(tmp)
    }
  }

  const handleReset = () => {
    const reset = resetTmpToDefaultSettings({
      saved: savedSettingsRef.current,
      defaults: new DefaultSettingsFactory().create(),
    })

    setTmp(reset.tmp)
    isResetPendingRef.current = true
    hasActiveThemePreviewRef.current = false
    onThemePreviewRestore?.(reset.visibleThemeSettings)
  }

  useEffect(() => {
    if (hasEmittedScrollDone.current) {
      return
    }

    hasEmittedScrollDone.current = true
    scrollHistory.emitDoneGetData()
  }, [scrollHistory])

  useEffect(
    () => () => {
      if (!hasActiveThemePreviewRef.current) {
        return
      }

      const restored = restoreSavedThemeSettings(savedSettingsRef.current)

      onThemePreviewRestoreRef.current?.(restored.visibleThemeSettings)
    },
    [],
  )

  return (
    <>
      <TitleBar
        title="設定"
        isNavigationOpen={isNavigationOpen}
        navigationControlsId={SHELL_NAVIGATION_DRAWER_ID}
        onNavigationClick={onNavigationClick}
      />
      <div className={styles.screen} data-testid="settings-screen">
        <Paper className={styles.card} data-testid="settings-card" elevation={1}>
          {SETTINGS_SECTION_ORDER.map((section) => (
            <SettingsSection
              key={section}
              currentPreviewTheme={resolvedPreviewTheme}
              mpegtsSupported={mpegtsSupported}
              tmp={tmp}
              title={section}
              onControlChange={handleControlChange}
            />
          ))}
          <div className={styles.actions}>
            <Button type="button" variant="text" onClick={handleReset}>
              リセット
            </Button>
            <Button type="button" variant="text" onClick={handleSave}>
              保存
            </Button>
          </div>
        </Paper>
        <div className={styles.bottomSpacer} aria-hidden="true">
          dummy
        </div>
      </div>
    </>
  )
}
