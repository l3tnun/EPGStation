import { useState } from 'react'
import { ClearableTextField } from '@/shared/ClearableTextField'
import { DateTimePickerDialog } from '@/shared/DateTimePickerDialog'
import styles from '../RecordedUploadPage.module.css'
import { formatDatetimeLocalValue, parseDatetimeLocalValue } from '../lib/uploadFormat'

export function RecordedUploadDatetimePicker({
  generation,
  value,
  onChange,
}: {
  generation: number
  value: number | null
  onChange: (value: number | null) => void
}) {
  const [isOpen, setOpen] = useState(false)

  const handleTextInput = (nextValue: string) => {
    onChange(parseDatetimeLocalValue(nextValue))
    setOpen(false)
  }

  return (
    <div
      className={styles.datetimeField}
      data-testid="recorded-upload-datetime-picker"
      data-generation={generation}
    >
      <ClearableTextField
        variant="standard"
        label="開始"
        type="text"
        slotProps={{
          htmlInput: {
            'aria-label': '日付※',
          },
        }}
        value={formatDatetimeLocalValue(value)}
        onClear={() => onChange(null)}
        onClick={() => setOpen(true)}
        onChange={(event) => handleTextInput(event.target.value)}
        onInput={(event) => handleTextInput((event.target as HTMLInputElement).value)}
      />
      <DateTimePickerDialog
        open={isOpen}
        title="日付選択"
        titleId="recorded-upload-date-dialog-title"
        value={value}
        onSet={(next) => {
          onChange(next)
          setOpen(false)
        }}
        onClear={() => {
          onChange(null)
          setOpen(false)
        }}
        onClose={() => setOpen(false)}
      />
    </div>
  )
}
