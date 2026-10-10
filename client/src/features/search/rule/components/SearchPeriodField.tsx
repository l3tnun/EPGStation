import { useState } from 'react'
import { ClearableTextField } from '@/shared/ClearableTextField'
import { DateTimePickerDialog } from '@/shared/DateTimePickerDialog'
import { formatDatetimeLocalInput } from '../lib/inputParsers'
import styles from '../SearchRulePage.module.css'

export function SearchPeriodField({
  label,
  value,
  onChange,
}: {
  label: '開始' | '終了'
  value: number | null
  onChange: (value: number | null) => void
}) {
  const [isOpen, setOpen] = useState(false)

  const close = () => setOpen(false)
  const clear = () => {
    onChange(null)
    close()
  }

  return (
    <>
      <ClearableTextField
        className={styles.periodField}
        fullWidth
        label={label}
        variant="standard"
        value={formatDatetimeLocalInput(value)}
        onClear={clear}
        onClick={() => setOpen(true)}
        slotProps={{
          htmlInput: {
            'aria-label': label,
            readOnly: true,
          },
        }}
      />
      <DateTimePickerDialog
        open={isOpen}
        title={`期間 ${label}`}
        titleId={`search-period-${label}-title`}
        value={value}
        onSet={(next) => {
          onChange(next)
          close()
        }}
        onClear={clear}
        onClose={close}
      />
    </>
  )
}
