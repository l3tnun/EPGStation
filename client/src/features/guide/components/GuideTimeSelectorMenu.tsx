import Button from '@mui/material/Button'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { BROADCAST_WAVE_ORDER, type BroadcastWave } from '@/app/navigation'
import { AppSelect } from '@/shared/AppSelect'
import {
  HOUR_MS,
  formatGuideRouteDay,
  getJapanDateParts,
  type GuideDateOption,
} from '../lib/guideDate'
import styles from '../GuidePage.module.css'

export function GuideTimeSelectorMenu({
  anchorEl,
  open,
  options,
  currentStartAt,
  currentType,
  enabledBroadcastWaves,
  showBroadcastSelect,
  onClose,
  onDisplay,
}: {
  anchorEl: HTMLElement | null
  open: boolean
  options: readonly GuideDateOption[]
  currentStartAt: number
  currentType?: BroadcastWave
  enabledBroadcastWaves: readonly BroadcastWave[]
  showBroadcastSelect: boolean
  onClose: () => void
  onDisplay: (time: number, type?: BroadcastWave) => void
}) {
  const [dayValue, setDayValue] = useState(formatGuideRouteDay(currentStartAt))
  const [hour, setHour] = useState(() => String(getJapanDateParts(currentStartAt).hour))
  const broadcastOptions = useMemo(
    () => BROADCAST_WAVE_ORDER.filter((wave) => enabledBroadcastWaves.includes(wave)),
    [enabledBroadcastWaves],
  )
  const [type, setType] = useState<BroadcastWave | ''>(currentType ?? '')

  useEffect(() => {
    if (!open) {
      return () => undefined
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  useEffect(() => {
    if (!open || anchorEl === null || anchorEl.isConnected) {
      return
    }

    onClose()
  }, [anchorEl, onClose, open])

  const display = () => {
    const day = options.find((option) => option.dayRouteTime.slice(0, 6) === dayValue)
    const selectedHour = Number(hour)

    if (day === undefined || !Number.isSafeInteger(selectedHour)) {
      return
    }

    onDisplay(day.dayStartAt + selectedHour * HOUR_MS, type === '' ? undefined : type)
  }

  if (!open || anchorEl === null || !anchorEl.isConnected) {
    return null
  }

  const anchorRect = anchorEl.getBoundingClientRect()
  const menuStyle: CSSProperties = {
    left: anchorRect.right - 196,
    top: anchorRect.top + 8,
  }

  return (
    <>
      <div className={styles.timeSelectorBackground} onClick={onClose} />
      <div className={styles.timeSelectorPaper} role="menu" style={menuStyle}>
        <div className={styles.timeSelectorContent}>
          <div className={styles.timeSelectorControls}>
            {showBroadcastSelect ? (
              <label
                className={`${styles.timeSelectorField} ${styles.timeSelectorBroadcast}`}
                role="button"
              >
                <AppSelect
                  className={styles.timeSelectorSelect}
                  ariaLabel="放送波"
                  value={type}
                  options={[
                    ...(currentType === undefined ? [{ label: 'すべて', value: '' }] : []),
                    ...broadcastOptions.map((wave) => ({ label: wave, value: wave })),
                  ]}
                  onChange={(value) => setType(value as BroadcastWave)}
                />
              </label>
            ) : undefined}
            <label
              className={`${styles.timeSelectorField} ${styles.timeSelectorDay}`}
              role="button"
            >
              <AppSelect
                className={styles.timeSelectorSelect}
                ariaLabel="日付"
                value={dayValue}
                options={options.map((option) => ({
                  label: option.label,
                  value: option.dayRouteTime.slice(0, 6),
                }))}
                onChange={setDayValue}
              />
            </label>
            <label
              className={`${styles.timeSelectorField} ${styles.timeSelectorHour}`}
              role="button"
            >
              <AppSelect
                className={styles.timeSelectorSelect}
                ariaLabel="時"
                value={hour}
                options={Array.from({ length: 24 }, (_, value) => ({
                  label: `${value}時`,
                  value: String(value),
                }))}
                onChange={setHour}
              />
            </label>
          </div>
        </div>
        <div className={styles.timeSelectorActions}>
          <Button className={styles.timeSelectorCancelButton} color="error" onClick={onClose}>
            閉じる
          </Button>
          <Button className={styles.timeSelectorShowButton} onClick={display}>
            表示
          </Button>
        </div>
      </div>
    </>
  )
}
