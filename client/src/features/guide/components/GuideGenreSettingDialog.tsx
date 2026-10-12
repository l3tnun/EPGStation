import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import Switch from '@mui/material/Switch'
import { type HTMLAttributes, useState } from 'react'
import type { GuideGenreVisibility } from '../GuideGridRenderer'
import { GENRE_NAMES } from '../lib/programGenreLabels'
import styles from '../GuidePage.module.css'

const GUIDE_GENRE_ENTRIES = Object.keys(GENRE_NAMES)
  .map(Number)
  .sort((left, right) => left - right)
  .map((genreId) => [genreId, GENRE_NAMES[genreId]] as const)

export function GuideGenreSettingDialog({
  open,
  visibility,
  onClose,
  onSave,
}: {
  open: boolean
  visibility: GuideGenreVisibility
  onClose: () => void
  onSave: (visibility: GuideGenreVisibility) => void
}) {
  const [draft, setDraft] = useState<GuideGenreVisibility>(visibility)

  return (
    <Dialog
      open={open}
      slotProps={{
        paper: {
          'aria-label': '表示ジャンル',
          className: styles.genreDialogPaper,
          'data-max-width': '500',
          sx: {
            bgcolor: 'background.paper',
            color: 'text.primary',
          },
          style: { maxHeight: 'calc(100% - 120px)', maxWidth: 500, width: '100%' },
        } as HTMLAttributes<HTMLDivElement>,
      }}
      onClose={onClose}
    >
      <DialogContent className={styles.genreDialogContent}>
        <div className={styles.genreList}>
          {GUIDE_GENRE_ENTRIES.map(([genreId, label]) => (
            <div key={genreId} className={styles.genreItem}>
              <span className={styles.genreLabel}>{label}</span>
              <Switch
                className={styles.genreSwitch}
                checked={draft[genreId] ?? true}
                slotProps={{
                  input: {
                    'aria-label': label,
                    role: 'switch',
                  },
                }}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    [genreId]: event.target.checked,
                  }))
                }}
              />
            </div>
          ))}
        </div>
      </DialogContent>
      <DialogActions className={styles.genreDialogActions}>
        <Button className={styles.genreCancelButton} onClick={onClose}>
          キャンセル
        </Button>
        <Button className={styles.genreUpdateButton} onClick={() => onSave(draft)}>
          更新
        </Button>
      </DialogActions>
    </Dialog>
  )
}
