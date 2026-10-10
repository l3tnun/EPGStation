import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { useEffect, useRef, useState } from 'react'
import type { UseFormSetValue } from 'react-hook-form'
import { ClearableTextField } from '@/shared/ClearableTextField'
import { DateTimePickerDialog } from '@/shared/DateTimePickerDialog'
import { appSelectMenuProps } from '@/shared/appSelectConfig'
import {
  MANUAL_RESERVE_TIME_ZONE,
  formatManualDateTimeInput,
  nullableString,
  parseManualDateTimeInput,
  parseNullableNumber,
  valueFromNullableNumber,
  type ManualReserveFormState,
} from '../lib/manualReserveForm'
import type { ManualChannelOption } from '../lib/manualReserveServerOptions'
import styles from '../ReservesPage.module.css'

// Manual Reserve の時刻指定 start/end は "yyyy-MM-dd HH:mm" 表示・編集の text field だが、内部の
// 保持値は milliseconds number である (requirements.md 4-23)。value を毎 render `formState` の
// number から再フォーマットして表示すると、まだ完全な形式になっていない入力途中の文字列
// (1 文字目だけ、Backspace で一部消した状態など) が formatManualDateTimeInput 経由で毎回上書き
// され、日付として成立しない入力を打つたびに表示が壊れる。この hook は編集中の生文字列を
// component local state (draft) として保持し、`committedValue` (formState 側の値) が
// draft 由来ではない外部要因 (program mode 切替、reset、reserveId edit mode の初期読み込みなど)
// で変化したときだけ draft を再フォーマットして同期する。
function useManualDateTimeDraft(
  committedValue: number | null | undefined,
  commit: (parsed: number | null) => void,
): [string, (text: string) => void, (value: number | null) => void] {
  const normalized = committedValue ?? null
  const [draft, setDraft] = useState(() => formatManualDateTimeInput(normalized))
  const lastCommittedRef = useRef<number | null>(normalized)

  useEffect(() => {
    if (normalized !== lastCommittedRef.current) {
      lastCommittedRef.current = normalized
      setDraft(formatManualDateTimeInput(normalized))
    }
  }, [normalized])

  const commitValue = (parsed: number | null) => {
    lastCommittedRef.current = parsed
    commit(parsed)
  }

  const handleChange = (text: string) => {
    setDraft(text)
    // 完全に "yyyy-MM-dd[ T]HH:mm" と一致しない入力 (途中まで打った状態や無効な文字列) は
    // milliseconds へ変換しない。number へ commit するのは空文字 (null) か完全一致のときだけ。
    commitValue(parseManualDateTimeInput(text))
  }

  // 日時 picker dialog の確定は、整った値なので draft をその表示形式へ揃えて commit する。
  const handlePicked = (picked: number | null) => {
    setDraft(formatManualDateTimeInput(picked))
    commitValue(picked)
  }

  return [draft, handleChange, handlePicked]
}

export function ManualTimeSpecifiedFields({
  formState,
  channels,
  disabled,
  setValue,
}: {
  formState: ManualReserveFormState
  channels: readonly ManualChannelOption[]
  disabled: boolean
  setValue: UseFormSetValue<ManualReserveFormState>
}) {
  const [startDraft, handleStartChange, handleStartPicked] = useManualDateTimeDraft(
    formState.timeSpecifiedOption?.startAt,
    (parsed) => setValue('timeSpecifiedOption.startAt', parsed),
  )
  const [endDraft, handleEndChange, handleEndPicked] = useManualDateTimeDraft(
    formState.timeSpecifiedOption?.endAt,
    (parsed) => setValue('timeSpecifiedOption.endAt', parsed),
  )

  const [openedPicker, setOpenedPicker] = useState<'start' | 'end' | null>(null)
  const closePicker = () => setOpenedPicker(null)
  const openPicker = (which: 'start' | 'end') => {
    if (!disabled) {
      setOpenedPicker(which)
    }
  }

  return (
    <section className={styles.manualTimeReserveCard} aria-label="時刻指定予約">
      <div className={styles.manualSearchOptionRow}>
        <div className={styles.manualSearchOptionTitle}>番組名</div>
        <ClearableTextField
          className={styles.manualSearchOptionContent}
          label="name"
          variant="standard"
          value={formState.timeSpecifiedOption?.name ?? ''}
          disabled={disabled}
          onClear={() => setValue('timeSpecifiedOption.name', null)}
          onChange={(event) =>
            setValue('timeSpecifiedOption.name', nullableString(event.target.value))
          }
        />
      </div>
      <div className={styles.manualSearchOptionRow}>
        <div className={styles.manualSearchOptionTitle}>放送局</div>
        <TextField
          className={`${styles.manualSearchOptionContent} ${styles.manualSelectField}`}
          label="channel"
          variant="standard"
          select
          slotProps={{
            select: {
              MenuProps: appSelectMenuProps,
            },
          }}
          value={valueFromNullableNumber(formState.timeSpecifiedOption?.channelId)}
          disabled={disabled}
          onChange={(event) =>
            setValue('timeSpecifiedOption.channelId', parseNullableNumber(event.target.value))
          }
        >
          <MenuItem value="" sx={{ display: 'none' }}>
            <em />
          </MenuItem>
          {channels.map((channel) => (
            <MenuItem key={channel.id} value={String(channel.id)}>
              {channel.name}
            </MenuItem>
          ))}
        </TextField>
      </div>
      <div className={styles.manualSearchOptionRow}>
        <div className={styles.manualSearchOptionTitle}>時刻</div>
        <div className={`${styles.manualSearchOptionContent} ${styles.manualDateFields}`}>
          <ClearableTextField
            label="開始"
            variant="standard"
            value={startDraft}
            disabled={disabled}
            onClear={() => handleStartChange('')}
            onClick={() => openPicker('start')}
            onChange={(event) => handleStartChange(event.target.value)}
          />
          <span className={styles.manualDateSpacer} aria-hidden="true" />
          <ClearableTextField
            label="終了"
            variant="standard"
            value={endDraft}
            disabled={disabled}
            onClear={() => handleEndChange('')}
            onClick={() => openPicker('end')}
            onChange={(event) => handleEndChange(event.target.value)}
          />
        </div>
        <DateTimePickerDialog
          open={openedPicker === 'start'}
          title="時刻 開始"
          titleId="manual-time-start-title"
          timezone={MANUAL_RESERVE_TIME_ZONE}
          value={formState.timeSpecifiedOption?.startAt ?? null}
          onSet={(picked) => {
            handleStartPicked(picked)
            closePicker()
          }}
          onClear={() => {
            handleStartPicked(null)
            closePicker()
          }}
          onClose={closePicker}
        />
        <DateTimePickerDialog
          open={openedPicker === 'end'}
          title="時刻 終了"
          titleId="manual-time-end-title"
          timezone={MANUAL_RESERVE_TIME_ZONE}
          value={formState.timeSpecifiedOption?.endAt ?? null}
          onSet={(picked) => {
            handleEndPicked(picked)
            closePicker()
          }}
          onClear={() => {
            handleEndPicked(null)
            closePicker()
          }}
          onClose={closePicker}
        />
      </div>
    </section>
  )
}
