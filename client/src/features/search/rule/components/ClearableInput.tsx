import type { KeyboardEventHandler } from 'react'
import styles from '../SearchRulePage.module.css'

export function ClearableInput({
  ariaLabel,
  className,
  inputMode,
  onChange,
  onKeyDown,
  placeholder,
  readOnly = false,
  showLabel = false,
  value,
}: {
  ariaLabel: string
  className?: string
  inputMode?: 'numeric'
  onChange?: (value: string) => void
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>
  placeholder?: string
  readOnly?: boolean
  // Renders `ariaLabel` as text above the field. Needed wherever several inputs share one row and
  // the value alone does not say which box it is.
  showLabel?: boolean
  value: string
}) {
  return (
    <span className={styles.clearableInputWrap}>
      {showLabel ? <span className={styles.clearableInputLabel}>{ariaLabel}</span> : null}
      <input
        aria-label={ariaLabel}
        className={`${styles.textInput} ${className ?? ''} ${
          value !== '' && !readOnly && onChange !== undefined ? styles.clearableInput : ''
        }`}
        inputMode={inputMode}
        placeholder={placeholder}
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {value === '' || readOnly || onChange === undefined ? null : (
        <button
          aria-label={`${ariaLabel}をクリア`}
          className={styles.clearInputButton}
          type="button"
          onClick={() => onChange('')}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </span>
  )
}
