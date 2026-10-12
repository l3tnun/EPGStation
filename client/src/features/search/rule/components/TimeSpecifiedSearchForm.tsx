import type { Dispatch, SetStateAction } from 'react'
import { AppSelect } from '@/shared/AppSelect'
import type { SearchChannelOption } from '../api'
import { parseNumberInput } from '../lib/inputParsers'
import { WEEKDAY_LABELS } from '../lib/searchFormItems'
import type { SearchTimeReserveFormState } from '../query'
import styles from '../SearchRulePage.module.css'
import { ClearableInput } from './ClearableInput'
import { SearchCheckbox } from './SearchCheckbox'

export function TimeSpecifiedSearchForm({
  channelOptions,
  timeReserveForm,
  setTimeReserveForm,
}: {
  channelOptions: readonly SearchChannelOption[]
  timeReserveForm: SearchTimeReserveFormState
  setTimeReserveForm: Dispatch<SetStateAction<SearchTimeReserveFormState>>
}) {
  return (
    <div className={styles.searchCard}>
      <div className={styles.searchRow}>
        <span className={styles.searchLabel}>番組名</span>
        <div className={styles.searchControl}>
          <label className={styles.searchField}>
            <span>keyword</span>
            <ClearableInput
              ariaLabel="番組名 keyword"
              className={styles.keywordInput}
              placeholder="keyword"
              value={timeReserveForm.keyword}
              onChange={(keyword) => setTimeReserveForm((current) => ({ ...current, keyword }))}
            />
          </label>
        </div>
      </div>
      <div className={styles.searchRow}>
        <span className={styles.searchLabel}>放送局</span>
        <div className={styles.searchControl}>
          <label className={styles.searchField}>
            <span>channel</span>
            <AppSelect
              ariaLabel="時刻指定 channel"
              className={`${styles.textInput} ${styles.selectLikeInput}`}
              value={timeReserveForm.channelId ?? ''}
              options={[
                { label: 'channel', value: '', hidden: true },
                ...channelOptions.map((channel) => ({
                  label: channel.name,
                  value: channel.id,
                })),
              ]}
              onChange={(value) =>
                setTimeReserveForm((current) => ({
                  ...current,
                  channelId: parseNumberInput(value),
                }))
              }
            />
          </label>
        </div>
      </div>
      <div className={styles.searchRow}>
        <span className={styles.searchLabel}>時刻</span>
        <div className={styles.searchControl}>
          <div className={styles.timeFields}>
            <ClearableInput
              ariaLabel="開始"
              className={styles.timeTextInput}
              placeholder="開始"
              value={timeReserveForm.startTime ?? ''}
              onChange={(startTime) =>
                setTimeReserveForm((current) => ({
                  ...current,
                  startTime: startTime === '' ? null : startTime,
                }))
              }
            />
            <span className={styles.timeSeparator}>~</span>
            <ClearableInput
              ariaLabel="終了"
              className={styles.timeTextInput}
              placeholder="終了"
              value={timeReserveForm.endTime ?? ''}
              onChange={(endTime) =>
                setTimeReserveForm((current) => ({
                  ...current,
                  endTime: endTime === '' ? null : endTime,
                }))
              }
            />
          </div>
          <div className={`${styles.checkboxLine} ${styles.selectCheckboxGap}`}>
            {WEEKDAY_LABELS.map(([key, label]) => (
              <SearchCheckbox
                key={key}
                checked={timeReserveForm.weekdays[key]}
                label={label}
                onChange={(checked) =>
                  setTimeReserveForm((current) => ({
                    ...current,
                    weekdays: { ...current.weekdays, [key]: checked },
                  }))
                }
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
