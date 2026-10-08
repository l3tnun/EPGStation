import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import { useId, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ReserveListItem as ReserveListItemModel } from '../lib/reservesApiTypes'
import {
  formatReserveDialogTimeRange,
  reserveChannelLabel,
  reserveGenreLabels,
  reserveLabel,
  resolveDialogBroadcastWave,
  type ReserveBroadcastWaveResolver,
} from '../lib/reserveLabels'
import { buildReserveGuidePath, linkifyReserveExtendedText } from '../lib/reserveRoutes'
import styles from '../ReservesPage.module.css'

export function ReserveDialog({
  open,
  reserve,
  isEnableDisplayForEachBroadcastWave = false,
  resolveBroadcastWave,
  onClose,
}: {
  open: boolean
  reserve: ReserveListItemModel | null
  isEnableDisplayForEachBroadcastWave?: boolean
  resolveBroadcastWave?: ReserveBroadcastWaveResolver
  onClose: () => void
}) {
  const titleId = useId()
  const navigate = useNavigate()
  const label = reserve === null ? '' : reserveLabel(reserve)
  const timeText = reserve === null ? '' : formatReserveDialogTimeRange(reserve)
  const extendedTokens = useMemo(
    () => linkifyReserveExtendedText(reserve?.extended),
    [reserve?.extended],
  )

  if (!open || reserve === null) {
    return null
  }

  const goToGuide = () => {
    // Only rendered behind the time button below, which itself only renders when
    // formatReserveDialogTimeRange(reserve) is non-empty -- and that requires both startAt and
    // endAt to be defined. So reserve.startAt is always defined whenever this runs.
    onClose()
    navigate(
      buildReserveGuidePath({
        startAt: reserve.startAt as number,
        broadcastWave: resolveDialogBroadcastWave({
          isEnableDisplayForEachBroadcastWave,
          reserve,
          resolveBroadcastWave,
        }),
      }),
    )
  }
  const channelLabel = reserveChannelLabel(reserve)
  const genreLabels = reserveGenreLabels(reserve)

  return (
    <Dialog
      open={open}
      aria-labelledby={titleId}
      keepMounted={false}
      scroll="paper"
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            m: {
              xs: '60px 0',
              sm: '60px 0',
            },
            maxWidth: 500,
            maxHeight: {
              xs: 'calc(100% - 120px)',
              sm: 'calc(100% - 120px)',
            },
            width: {
              xs: '100%',
              sm: 'calc(100% - 32px)',
            },
          },
        },
      }}
    >
      <DialogContent
        className={styles.reserveDialogContent}
        sx={{ p: { xs: '16px 16px 8px', sm: '20px 24px' } }}
      >
        <div id={titleId} className={styles.reserveDialogTitle}>
          {label}
        </div>
        {channelLabel === undefined ? undefined : (
          <div className={styles.reserveDialogSubText}>{channelLabel}</div>
        )}
        {timeText === '' ? undefined : (
          <button className={styles.reserveDialogTimeButton} type="button" onClick={goToGuide}>
            {timeText}
          </button>
        )}
        {genreLabels.length === 0 ? undefined : (
          <div className={styles.reserveDialogGenres}>
            {genreLabels.map((genre) => (
              <div key={genre}>{genre}</div>
            ))}
          </div>
        )}
        {reserve.description === undefined ? undefined : (
          <p className={styles.preWrap}>{reserve.description}</p>
        )}
        {extendedTokens.length === 0 ? undefined : (
          <p className={styles.preWrap}>
            {extendedTokens.map((token, index) => {
              if (token.type === 'text') {
                return <span key={`${index}-text`}>{token.text}</span>
              }

              return (
                <a
                  key={`${index}-link`}
                  href={token.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {token.text}
                </a>
              )
            })}
          </p>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>閉じる</Button>
      </DialogActions>
    </Dialog>
  )
}
