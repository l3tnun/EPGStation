import type { ChangeEvent } from 'react'
import type { SettingsConsumerValue } from '@/shared/settings'
import {
  resolveSettingsControlDisplayValue,
  type SettingsControlDefinition,
} from '../settingsControlMatrix'
import styles from '../SettingsPage.module.css'
import { getAccessibleName, type SettingsControlChangeHandler } from '../lib/settingsControlSupport'
import { SettingsControlText } from './SettingsControlText'

export function SettingsSchemeControl({
  switchControl,
  textControl,
  tmp,
  disabled,
  onChange,
}: {
  switchControl: SettingsControlDefinition
  textControl: SettingsControlDefinition
  tmp: SettingsConsumerValue
  disabled: boolean
  onChange: SettingsControlChangeHandler
}) {
  const switchValue = resolveSettingsControlDisplayValue(switchControl, tmp)
  const textValue = resolveSettingsControlDisplayValue(textControl, tmp)

  return (
    <label className={`${styles.controlRow} ${styles.textControlRow} ${styles.schemeControlRow}`}>
      <span className={styles.schemeHeader}>
        <SettingsControlText control={textControl} />
        <input
          aria-label={getAccessibleName(switchControl)}
          checked={switchValue === 'true'}
          className={styles.switchControl}
          disabled={disabled}
          role="switch"
          type="checkbox"
          onChange={(event) => onChange(switchControl, event.currentTarget.checked)}
        />
      </span>
      <span className={styles.textControlInputWrap}>
        <input
          aria-label={getAccessibleName(textControl)}
          className={`${styles.textControl} ${textValue === '' ? '' : styles.textControlClearable}`}
          disabled={disabled}
          placeholder="URL"
          type="text"
          value={textValue}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onChange(textControl, event.currentTarget.value)
          }
        />
        {textValue === '' || disabled ? null : (
          <button
            aria-label={`${getAccessibleName(textControl)}をクリア`}
            className={styles.textControlClearButton}
            type="button"
            onClick={() => onChange(textControl, '')}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </span>
    </label>
  )
}
