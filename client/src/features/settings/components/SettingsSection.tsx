import type { ReactNode } from 'react'
import type { SettingsConsumerValue } from '@/shared/settings'
import {
  getSettingsControlsForSection,
  isSettingsControlDisabled,
  type SettingsPreviewTheme,
} from '../settingsControlMatrix'
import type { SETTINGS_SECTION_ORDER } from '../settingsLayoutContract'
import styles from '../SettingsPage.module.css'
import { SettingsControl } from './SettingsControl'
import { SettingsSchemeControl } from './SettingsSchemeControl'
import { isVisibleControl, type SettingsControlChangeHandler } from '../lib/settingsControlSupport'

export function SettingsSection({
  title,
  tmp,
  mpegtsSupported,
  currentPreviewTheme,
  onControlChange,
}: {
  title: (typeof SETTINGS_SECTION_ORDER)[number]
  tmp: SettingsConsumerValue
  mpegtsSupported: boolean
  currentPreviewTheme: SettingsPreviewTheme
  onControlChange: SettingsControlChangeHandler
}) {
  const controls = getSettingsControlsForSection(title).filter((control) =>
    isVisibleControl(control, mpegtsSupported),
  )
  const renderedControls: ReactNode[] = []

  for (let index = 0; index < controls.length; index += 1) {
    const control = controls[index]
    const nextControl = controls[index + 1]

    if (
      control.controlType === 'switch' &&
      nextControl?.controlType === 'text' &&
      control.label === nextControl.label
    ) {
      renderedControls.push(
        <SettingsSchemeControl
          key={`${control.key}-${nextControl.key}`}
          disabled={
            isSettingsControlDisabled(control, {
              tmp,
              mpegtsSupported,
              currentPreviewTheme,
            }) ||
            isSettingsControlDisabled(nextControl, {
              tmp,
              mpegtsSupported,
              currentPreviewTheme,
            })
          }
          switchControl={control}
          textControl={nextControl}
          tmp={tmp}
          onChange={onControlChange}
        />,
      )
      index += 1
      continue
    }

    renderedControls.push(
      <SettingsControl
        key={control.key}
        control={control}
        disabled={isSettingsControlDisabled(control, {
          tmp,
          mpegtsSupported,
          currentPreviewTheme,
        })}
        tmp={tmp}
        onChange={onControlChange}
      />,
    )
  }

  return (
    <section className={styles.section} aria-labelledby={`settings-section-${title}`}>
      <h2 className={styles.sectionHeading} id={`settings-section-${title}`}>
        {title}
      </h2>
      <div className={styles.controlsGrid}>{renderedControls}</div>
    </section>
  )
}
