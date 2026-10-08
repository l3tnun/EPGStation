import { AppSelect } from '@/shared/AppSelect'
import type { AppSelectOption } from '@/shared/AppSelect'
import styles from '../RecordedUploadPage.module.css'

export function UploadSelect({
  label,
  ariaLabel,
  value,
  className,
  inputProps,
  options,
  onChange,
  onClear,
}: {
  label: string
  ariaLabel?: string
  value: string
  className?: string
  inputProps?: Record<string, string>
  options: readonly AppSelectOption[]
  onChange: (value: string) => void
  onClear?: () => void
}) {
  const selectClassName =
    className === undefined ? styles.legacySelectField : `${styles.legacySelectField} ${className}`

  return (
    <AppSelect
      variant="standard"
      wrapperClassName={styles.uploadSelectWrapper}
      className={selectClassName}
      label={label}
      value={value}
      ariaLabel={ariaLabel ?? label}
      inputProps={inputProps}
      options={options}
      clearable={onClear !== undefined}
      onClear={onClear}
      onChange={onChange}
    />
  )
}
