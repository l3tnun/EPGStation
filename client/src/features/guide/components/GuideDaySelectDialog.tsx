import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import type { HTMLAttributes } from 'react'
import type { GuideDateOption } from '../lib/guideDate'
import styles from '../GuidePage.module.css'

export function GuideDaySelectDialog({
  open,
  options,
  selectedRouteDay,
  onClose,
  onSelect,
}: {
  open: boolean
  options: readonly GuideDateOption[]
  selectedRouteDay: string
  onClose: () => void
  onSelect: (value: number) => void
}) {
  return (
    <Dialog
      open={open}
      slotProps={{
        paper: {
          'aria-label': '日付選択',
          'data-max-width': '150',
          className: styles.daySelectPaper,
          sx: {
            bgcolor: 'background.paper',
            color: 'text.primary',
          },
          style: { height: 400, maxWidth: 150, width: '100%' },
        } as HTMLAttributes<HTMLDivElement>,
      }}
      onClose={onClose}
    >
      <DialogContent className={styles.daySelectContent}>
        <div className={styles.dayOptionList}>
          {options.map((option) => (
            <Button
              key={option.routeTime}
              data-testid="guide-day-option"
              disabled={option.dayRouteTime.slice(0, 6) === selectedRouteDay}
              onClick={() => onSelect(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
