import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { jaJP } from '@mui/x-date-pickers/locales'
import { StaticDateTimePicker } from '@mui/x-date-pickers/StaticDateTimePicker'
import dayjs, { type Dayjs } from 'dayjs'
import ja from 'dayjs/locale/ja'
import timezonePlugin from 'dayjs/plugin/timezone'
import utcPlugin from 'dayjs/plugin/utc'
import { useState } from 'react'

dayjs.extend(utcPlugin)
dayjs.extend(timezonePlugin)

// 週の始まりを月曜にした日本語の locale。global の dayjs locale は変えない。
export const MONDAY_FIRST_JA_LOCALE = 'ja-monday-first'
dayjs.locale({ ...ja, name: MONDAY_FIRST_JA_LOCALE, weekStart: 1 }, undefined, true)

const dateFormats = { shortDate: 'M月D日' }
const calendarHeaderFormat = 'YYYY年M月'
const localeText = jaJP.components.MuiLocalizationProvider.defaultProps.localeText

function toDayjs(value: number | null, timezone: string | undefined): Dayjs | null {
  if (value === null) {
    return null
  }

  return timezone === undefined ? dayjs(value) : dayjs(value).tz(timezone)
}

export function DateTimePickerDialog({
  open,
  title,
  titleId,
  value,
  onSet,
  onClear,
  onClose,
  timezone,
}: {
  open: boolean
  title: string
  titleId: string
  value: number | null
  onSet: (value: number | null) => void
  onClear: () => void
  onClose: () => void
  // 指定すると、calendar と時刻をこの IANA timezone の壁時計で扱う（省略時は browser の local）。
  timezone?: string
}) {
  const [draft, setDraft] = useState<Dayjs | null>(() => toDayjs(value, timezone))
  const [wasOpen, setWasOpen] = useState(open)

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDraft(toDayjs(value, timezone))
    }
  }

  const commit = () => onSet(draft === null ? null : draft.startOf('minute').valueOf())

  return (
    <Dialog
      open={open}
      aria-labelledby={titleId}
      onClose={onClose}
      slotProps={{ paper: { sx: { maxWidth: 'calc(100% - 32px)', m: 2 } } }}
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <LocalizationProvider
          dateAdapter={AdapterDayjs}
          adapterLocale={MONDAY_FIRST_JA_LOCALE}
          dateFormats={dateFormats}
          localeText={localeText}
        >
          <StaticDateTimePicker
            ampm={false}
            timezone={timezone}
            displayStaticWrapperAs="mobile"
            value={draft}
            onChange={(next) => setDraft(next)}
            slotProps={{
              actionBar: { actions: [] },
              calendarHeader: { format: calendarHeaderFormat },
            }}
            sx={{
              bgcolor: 'transparent',
              // 狭い幅では dialog の幅に合わせて縮める（MUI の既定は 320px 固定）。
              minWidth: 'min(320px, calc(100vw - 32px))',
              maxWidth: '100%',
              '& .MuiDateCalendar-root': { width: '100%', maxWidth: '100%' },
              '& .MuiMultiSectionDigitalClock-root': { width: '100%' },
            }}
          />
        </LocalizationProvider>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClear}>クリア</Button>
        <Button onClick={commit}>設定</Button>
      </DialogActions>
    </Dialog>
  )
}
