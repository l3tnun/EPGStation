import type { ChangeEvent } from 'react'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { appSelectMenuProps } from '@/shared/appSelectConfig'
import type { SettingsConsumerValue } from '@/shared/settings'
import {
  resolveSettingsControlDisplayValue,
  type SettingsControlDefinition,
} from '../settingsControlMatrix'
import styles from '../SettingsPage.module.css'
import {
  formatSettingsSelectValue,
  getAccessibleName,
  type SettingsControlChangeHandler,
} from '../lib/settingsControlSupport'
import { SettingsControlText } from './SettingsControlText'

interface SettingsControlProps {
  control: SettingsControlDefinition
  tmp: SettingsConsumerValue
  disabled: boolean
  onChange: SettingsControlChangeHandler
}

export function SettingsControl({ control, tmp, disabled, onChange }: SettingsControlProps) {
  const accessibleName = getAccessibleName(control)
  const value = resolveSettingsControlDisplayValue(control, tmp)

  if (control.controlType === 'switch') {
    return (
      <label
        className={`${styles.controlRow} ${
          control.subtitle === undefined ? styles.compactControlRow : ''
        } ${control.key === 'deleteRecordedDefaultValue' ? styles.compactSubtitleRow : ''}`}
      >
        <SettingsControlText control={control} />
        <input
          aria-label={accessibleName}
          checked={value === 'true'}
          className={styles.switchControl}
          disabled={disabled}
          role="switch"
          type="checkbox"
          onChange={(event) => onChange(control, event.currentTarget.checked)}
        />
      </label>
    )
  }

  if (control.controlType === 'text') {
    return (
      <label className={`${styles.controlRow} ${styles.textControlRow}`}>
        <SettingsControlText control={control} />
        <span className={styles.textControlInputWrap}>
          <input
            aria-label={accessibleName}
            className={`${styles.textControl} ${value === '' ? '' : styles.textControlClearable}`}
            data-testid={
              control.key === 'onAirM2TSViewURLScheme'
                ? 'settings-url-scheme-placeholder'
                : undefined
            }
            disabled={disabled}
            placeholder="URL"
            type="text"
            value={value}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onChange(control, event.currentTarget.value)
            }
          />
          {value === '' || disabled ? null : (
            <button
              aria-label={`${accessibleName}をクリア`}
              className={styles.textControlClearButton}
              type="button"
              onClick={() => onChange(control, '')}
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </span>
      </label>
    )
  }

  const hasSelectedOption =
    control.options?.some((option) => String(option.value) === value) ?? false
  const selectValue = hasSelectedOption ? value : ''

  return (
    <label
      className={`${styles.controlRow} ${styles.selectControlRow} ${
        control.key === 'guideMode' ? styles.wideSelectRow : ''
      }`}
    >
      <SettingsControlText control={control} />
      <TextField
        select
        className={styles.selectControl}
        disabled={disabled}
        variant="standard"
        value={selectValue}
        slotProps={{
          select: {
            MenuProps: appSelectMenuProps,
            inputProps: { 'aria-label': accessibleName },
            renderValue: (selected: unknown) =>
              formatSettingsSelectValue(control, String(selected)).replace(/時間$|件$/u, ''),
          },
        }}
        onChange={(event) => onChange(control, event.target.value)}
      >
        <MenuItem aria-hidden="true" value="" sx={{ display: 'none' }}>
          <em />
        </MenuItem>
        {control.options?.map((option) => (
          <MenuItem key={`${control.key}-${option.value}`} value={String(option.value)}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
    </label>
  )
}
