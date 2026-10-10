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
import { useEffect, useState } from 'react'

dayjs.extend(utcPlugin)
dayjs.extend(timezonePlugin)

// 週の始まりを月曜にした日本語の locale。global の dayjs locale は変えない。
export const MONDAY_FIRST_JA_LOCALE = 'ja-monday-first'
dayjs.locale({ ...ja, name: MONDAY_FIRST_JA_LOCALE, weekStart: 1 }, undefined, true)

const dateFormats = { shortDate: 'M月D日' }
const calendarHeaderFormat = 'YYYY年M月'
const localeText = jaJP.components.MuiLocalizationProvider.defaultProps.localeText

// 表示領域（Safari の toolbar の出し入れ・回転・window の resize で変わる）の大きさ。
function readViewportSize(): { width: number; height: number } {
  const viewport = window.visualViewport
  return viewport
    ? { width: viewport.width, height: viewport.height }
    : { width: window.innerWidth, height: window.innerHeight }
}

function useViewportSize(): { width: number; height: number } {
  const [size, setSize] = useState(readViewportSize)

  useEffect(() => {
    const update = () => {
      const next = readViewportSize()
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      )
    }
    update()
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)

    return () => {
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [])

  return size
}

// 縦並びの最小の高さ（dialog の余白 + 題名 + 上部の日時 + tab + 最小の calendar + 操作の button）。
// 表示領域がこれに満たず横長なら、上部の日時と tab を左に置く横並びにする。
const PORTRAIT_MIN_HEIGHT = 448

// 表示領域の高さ（100dvh）に応じて px の値を連続的に変える。高さ 548px で最小値、698px で最大値。
function ramp(min: number, max: number): string {
  return `clamp(${min}px, calc(${min}px + (100dvh - 548px) * ${(max - min) / 150}), ${max}px)`
}

// 日のセルの大きさ。縦並びは高さ 460px で 22px、548px で 36px。横並びは高さ 320px で 20px から広げる。
const PORTRAIT_CELL = 'clamp(22px, calc(22px + (100dvh - 460px) * 0.15), 36px)'
const LANDSCAPE_CELL = 'clamp(20px, calc(20px + (100dvh - 320px) * 0.1), 36px)'

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

  const viewport = useViewportSize()
  const landscape = viewport.height < PORTRAIT_MIN_HEIGHT && viewport.width > viewport.height
  const headerHeight = landscape ? 32 : 36
  const headerMargin = landscape ? 0 : 4
  const toolbarFont = ramp(22, 32)

  return (
    <Dialog
      open={open}
      aria-labelledby={titleId}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: { maxWidth: 'calc(100% - 32px)', maxHeight: 'calc(100dvh - 32px)', m: 2 },
        },
      }}
    >
      <DialogTitle id={titleId} sx={{ py: ramp(4, 16) }}>
        {title}
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <LocalizationProvider
          dateAdapter={AdapterDayjs}
          adapterLocale={MONDAY_FIRST_JA_LOCALE}
          dateFormats={dateFormats}
          localeText={localeText}
        >
          <StaticDateTimePicker
            ampm={false}
            views={['year', 'month', 'day', 'hours', 'minutes']}
            timeSteps={{ hours: 1, minutes: 1 }}
            timezone={timezone}
            displayStaticWrapperAs="mobile"
            orientation={landscape ? 'landscape' : 'portrait'}
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
              // 日のセルの大きさは表示領域の高さに応じて決め、calendar と時刻の列は同じ高さにする。
              '--pk-cell': landscape ? LANDSCAPE_CELL : PORTRAIT_CELL,
              '--pk-calendar-height': `calc(var(--pk-cell) * 7 + 28px + ${headerHeight + headerMargin * 2}px)`,
              '& .MuiDateCalendar-root': {
                width: '100%',
                maxWidth: '100%',
                height: 'var(--pk-calendar-height)',
              },
              '& .MuiPickersCalendarHeader-root': {
                minHeight: headerHeight,
                maxHeight: headerHeight,
                mt: `${headerMargin}px`,
                mb: `${headerMargin}px`,
              },
              // 年・月の画面も dialog の幅と calendar の高さに収める。
              '& .MuiMonthCalendar-root': {
                width: '100%',
                rowGap: 'min(16px, calc((var(--pk-calendar-height) - 160px) / 3))',
              },
              '& .MuiYearCalendar-root': { width: '100%', maxHeight: '100%' },
              '& .MuiPickerDay-root': { '--PickerDay-size': 'var(--pk-cell)' },
              '& .MuiDayCalendar-weekDayLabel': {
                width: 'var(--pk-cell)',
                height: 'calc(var(--pk-cell) + 4px)',
              },
              '& .MuiDayCalendar-slideTransition': {
                minHeight: 'calc((var(--pk-cell) + 4px) * 6)',
              },
              '& .MuiMultiSectionDigitalClock-root': {
                width: '100%',
                height: 'var(--pk-calendar-height)',
              },
              // MUI は pointer: fine のとき hover の間だけ列を scroll させる。入力の種類に依らず最初の操作から scroll できるよう、常に auto にする。
              '& .MuiMultiSectionDigitalClockSection-root.MuiMultiSectionDigitalClockSection-root':
                {
                  maxHeight: 'none',
                  height: '100%',
                  overflowY: 'auto',
                },
              '& .MuiDateTimePickerTabs-root .MuiTab-root': { minHeight: ramp(40, 48) },
              '& .MuiDateTimePickerTabs-root': { minHeight: ramp(40, 48) },
              // 上部の月日と時刻は同じ大きさの文字にし、下端を揃えて縦の中心を合わせる。
              '& .MuiPickersLayout-toolbar': { py: ramp(6, 16), px: 3 },
              '& .MuiPickersToolbar-title': { display: 'none' },
              '& .MuiPickersToolbar-content': { alignItems: 'flex-end' },
              '& .MuiPickersLayout-toolbar .MuiPickersToolbarText-root.MuiTypography-h3, & .MuiPickersLayout-toolbar .MuiPickersToolbarText-root.MuiTypography-h4':
                { fontSize: toolbarFont, lineHeight: 1.2, whiteSpace: 'nowrap' },
              ...(landscape
                ? {
                    // 横並びでは、左に上部の日時と tab、右に calendar と時刻の列を置く。
                    minWidth: 'min(520px, calc(100vw - 32px))',
                    gridTemplateColumns: 'max-content minmax(0, 1fr)',
                    '& .MuiPickersLayout-toolbar': { gridColumn: 1, gridRow: 1, py: 1, px: 3 },
                    '& .MuiPickersToolbar-content': {
                      alignItems: 'flex-end',
                      flexDirection: 'row',
                      flexWrap: 'nowrap',
                      justifyContent: 'space-between',
                      gap: 2,
                    },
                    '& .MuiPickersLayout-contentWrapper': { display: 'contents' },
                    '& .MuiPickersLayout-tabs': { gridColumn: 1, gridRow: 2, alignSelf: 'start' },
                    '& .MuiDateCalendar-root, & .MuiMultiSectionDigitalClock-root': {
                      gridColumn: 2,
                      gridRow: '1 / 3',
                    },
                  }
                : {}),
            }}
          />
        </LocalizationProvider>
      </DialogContent>
      <DialogActions sx={{ py: ramp(2, 8) }}>
        <Button onClick={onClear}>クリア</Button>
        <Button onClick={commit}>設定</Button>
      </DialogActions>
    </Dialog>
  )
}
