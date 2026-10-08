import Button from '@mui/material/Button'
import { AppSelect } from '@/shared/AppSelect'
import { parseNumberInput } from '../lib/inputParsers'
import { RANGE_TIME_ITEMS, START_TIME_ITEMS, WEEKDAY_LABELS } from '../lib/searchFormItems'
import styles from '../SearchRulePage.module.css'
import { ClearableInput } from './ClearableInput'
import { SearchCheckbox } from './SearchCheckbox'
import type { SearchFormFieldProps } from './searchFormProps'
import { SearchPeriodField } from './SearchPeriodField'

export function SearchTimeRows({
  form,
  setForm,
  onClear,
  onSubmit,
}: SearchFormFieldProps & {
  onClear: () => void
  onSubmit: () => void
}) {
  return (
    <>
      <div className={styles.searchRow}>
        <span className={styles.searchLabel}>時刻</span>
        <div className={styles.searchControl}>
          <div className={styles.timeFields}>
            <AppSelect
              ariaLabel="start"
              className={`${styles.textInput} ${styles.selectLikeInput}`}
              value={form.startTime ?? ''}
              clearable
              showEmptyOptionLabel
              options={[
                { label: 'start', value: '', hidden: true },
                ...START_TIME_ITEMS.map((item) => ({
                  label: item.label,
                  value: item.value,
                })),
              ]}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  startTime: parseNumberInput(value),
                }))
              }
              onClear={() => setForm((current) => ({ ...current, startTime: null }))}
            />
            <span className={styles.timeSeparator}>~</span>
            <AppSelect
              ariaLabel="range"
              className={`${styles.textInput} ${styles.selectLikeInput}`}
              clearable
              showEmptyOptionLabel
              value={form.durationMinutes ?? ''}
              options={[
                { label: 'range', value: '', hidden: true },
                ...RANGE_TIME_ITEMS.map((item) => ({
                  label: item.label,
                  value: item.value,
                })),
              ]}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  durationMinutes: parseNumberInput(value),
                }))
              }
              onClear={() => setForm((current) => ({ ...current, durationMinutes: null }))}
            />
          </div>
          <div className={`${styles.checkboxLine} ${styles.selectCheckboxGap}`}>
            {WEEKDAY_LABELS.map(([key, label]) => (
              <SearchCheckbox
                key={key}
                checked={form.weekdays[key]}
                label={label}
                onChange={(checked) =>
                  setForm((current) => ({
                    ...current,
                    weekdays: { ...current.weekdays, [key]: checked },
                  }))
                }
              />
            ))}
          </div>
        </div>
      </div>
      <div className={styles.searchRow}>
        <span className={styles.searchLabel}>長さ</span>
        <div className={styles.searchControl}>
          <div className={styles.searchInlineFields}>
            <ClearableInput
              ariaLabel="最小(分)"
              inputMode="numeric"
              showLabel
              value={form.durationMinMinutes === null ? '' : String(form.durationMinMinutes)}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  durationMinMinutes: parseNumberInput(value),
                }))
              }
            />
            <ClearableInput
              ariaLabel="最大(分)"
              inputMode="numeric"
              showLabel
              value={form.durationMaxMinutes === null ? '' : String(form.durationMaxMinutes)}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  durationMaxMinutes: parseNumberInput(value),
                }))
              }
            />
          </div>
        </div>
      </div>
      <div className={styles.searchRow}>
        <span className={styles.searchLabel}>期間</span>
        <div className={styles.searchControl}>
          <div className={styles.periodFields}>
            <SearchPeriodField
              label="開始"
              value={form.startPeriod}
              onChange={(startPeriod) =>
                setForm((current) => ({
                  ...current,
                  startPeriod,
                }))
              }
            />
            <SearchPeriodField
              label="終了"
              value={form.endPeriod}
              onChange={(endPeriod) =>
                setForm((current) => ({
                  ...current,
                  endPeriod,
                }))
              }
            />
          </div>
        </div>
      </div>
      <div className={styles.searchRow}>
        <span className={styles.searchLabel}>その他</span>
        <div className={styles.searchControl}>
          <SearchCheckbox
            checked={form.isFree}
            label="無料放送"
            onChange={(checked) => setForm((current) => ({ ...current, isFree: checked }))}
          />
        </div>
      </div>
      <div className={styles.actions}>
        <Button color="error" variant="text" onClick={onClear}>
          クリア
        </Button>
        <Button variant="text" onClick={onSubmit}>
          検索
        </Button>
      </div>
    </>
  )
}
