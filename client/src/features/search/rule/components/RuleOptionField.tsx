import { AppSelect } from '@/shared/AppSelect'
import styles from '../SearchRulePage.module.css'
import { ClearableInput } from './ClearableInput'

export function RuleOptionField({
  inputMode,
  label,
  onChange,
  options,
  value,
  wide = false,
  width = 'default',
}: {
  inputMode?: 'numeric'
  label: string
  onChange?: (value: string) => void
  options?: readonly string[]
  value: string
  wide?: boolean
  width?: 'default' | 'period' | 'directory' | 'encode'
}) {
  const optionValues = options ?? []
  const needsFallback = value !== '' && !optionValues.includes(value)

  return (
    <label
      className={styles.ruleOptionField}
      data-wide={wide ? 'true' : 'false'}
      data-width={width}
    >
      <span className={styles.ruleOptionLabel}>{label}</span>
      {options === undefined ? (
        <ClearableInput
          ariaLabel={label}
          inputMode={inputMode}
          readOnly={onChange === undefined}
          value={value}
          onChange={onChange}
        />
      ) : (
        <AppSelect
          ariaLabel={label}
          className={`${styles.textInput} ${styles.selectLikeInput}`}
          wrapperClassName={styles.ruleOptionSelectWrap}
          clearable
          value={value}
          options={[
            { label, value: '', hidden: true },
            ...(needsFallback ? [{ label: value, value }] : []),
            ...optionValues.map((option) => ({ label: option, value: option })),
          ]}
          onChange={(nextValue) => onChange?.(nextValue)}
          onClear={() => onChange?.('')}
        />
      )}
    </label>
  )
}
