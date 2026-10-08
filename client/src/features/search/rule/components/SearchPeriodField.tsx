import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import { useState } from 'react'
import { ClearableTextField } from '@/shared/ClearableTextField'
import { formatDatetimeLocalInput, parseDatetimeLocalInput } from '../lib/inputParsers'
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
  const [draft, setDraft] = useState(() => formatDatetimeLocalInput(value))

  const open = () => {
    setDraft(formatDatetimeLocalInput(value))
    setOpen(true)
  }
  const close = () => setOpen(false)
  const clear = () => {
    onChange(null)
    close()
  }
  const submit = () => {
    onChange(parseDatetimeLocalInput(draft))
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
        onClick={open}
        slotProps={{
          htmlInput: {
            'aria-label': label,
            readOnly: true,
          },
        }}
      />
      <Dialog
        open={isOpen}
        aria-labelledby={`search-period-${label}-title`}
        onClose={close}
        slotProps={{
          paper: {
            sx: {
              width: 'calc(100% - 32px)',
              maxWidth: 360,
            },
          },
        }}
      >
        <DialogTitle id={`search-period-${label}-title`}>期間 {label}</DialogTitle>
        <DialogContent>
          <ClearableTextField
            autoFocus
            fullWidth
            label={`${label}日時`}
            type="datetime-local"
            value={draft}
            variant="standard"
            onClear={() => setDraft('')}
            onChange={(event) => setDraft(event.target.value)}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: {
                'aria-label': `${label}日時`,
              },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={clear}>
            クリア
          </Button>
          <Button variant="text" onClick={submit}>
            設定
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
