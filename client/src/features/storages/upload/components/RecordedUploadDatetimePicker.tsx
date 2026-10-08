import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import { useState } from 'react'
import { ClearableTextField } from '@/shared/ClearableTextField'
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
  const [draftValue, setDraftValue] = useState(formatDatetimeLocalValue(value))
  const [draftDate, setDraftDate] = useState('')
  const [draftTime, setDraftTime] = useState('')
  const openDialog = () => {
    const formatted = formatDatetimeLocalValue(value)
    setDraftValue(formatted)
    const [date = '', time = ''] = formatted.split('T')
    setDraftDate(date)
    setDraftTime(time)
    setOpen(true)
  }

  const commit = () => {
    const nextValue =
      draftDate === '' && draftTime === '' ? draftValue : `${draftDate}T${draftTime}`
    onChange(parseDatetimeLocalValue(nextValue))
    setOpen(false)
  }
  const handleTextInput = (nextValue: string) => {
    onChange(parseDatetimeLocalValue(nextValue))
    setOpen(false)
  }

  return (
    <div
      className={styles.datetimeField}
      data-testid="recorded-upload-datetime-picker"
      data-generation={generation}
      data-locale="ja-JP"
      data-week-start="1"
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
        onClick={openDialog}
        onChange={(event) => handleTextInput(event.target.value)}
        onInput={(event) => handleTextInput((event.target as HTMLInputElement).value)}
      />
      <Dialog
        open={isOpen}
        aria-labelledby="recorded-upload-date-dialog-title"
        onClose={() => setOpen(false)}
      >
        <DialogTitle id="recorded-upload-date-dialog-title">日付選択</DialogTitle>
        <DialogContent className={styles.datetimeDialogContent}>
          <ClearableTextField
            variant="standard"
            label="日付"
            type="date"
            value={draftDate}
            onClear={() => setDraftDate('')}
            slotProps={{
              inputLabel: {
                shrink: true,
              },
              htmlInput: {
                'aria-label': '日付',
              },
            }}
            onChange={(event) => setDraftDate(event.target.value)}
          />
          <ClearableTextField
            variant="standard"
            label="時刻"
            type="time"
            value={draftTime}
            onClear={() => setDraftTime('')}
            slotProps={{
              inputLabel: {
                shrink: true,
              },
              htmlInput: {
                'aria-label': '時刻',
              },
            }}
            onChange={(event) => setDraftTime(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDraftValue('')
              onChange(null)
              setOpen(false)
            }}
          >
            クリア
          </Button>
          <Button onClick={commit}>設定</Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
