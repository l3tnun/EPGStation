import type { MutableRefObject } from 'react'
import type { BroadcastWave } from '@/app/navigation'
import type { SearchChannelOption } from '../api'
import { KEYWORD_TARGET_LABELS } from '../lib/searchFormItems'
import type { SearchFormState } from '../query'
import styles from '../SearchRulePage.module.css'
import { ChannelMultiSelect } from './ChannelMultiSelect'
import { ClearableInput } from './ClearableInput'
import { SearchCheckbox } from './SearchCheckbox'
import type { SearchFormFieldProps } from './searchFormProps'

export function SearchKeywordRows({
  form,
  setForm,
  enabledBroadcastWaves,
  channelSelectOptions,
  keywordInputValueRef,
  ignoreKeywordInputValueRef,
  submitSearch,
}: SearchFormFieldProps & {
  enabledBroadcastWaves: readonly BroadcastWave[]
  channelSelectOptions: readonly SearchChannelOption[]
  keywordInputValueRef: MutableRefObject<string>
  ignoreKeywordInputValueRef: MutableRefObject<string>
  submitSearch: (nextForm: SearchFormState) => void
}) {
  return (
    <>
      <div className={styles.searchRow}>
        <span className={styles.searchLabel}>キーワード</span>
        <div className={styles.searchControl}>
          <label className={`${styles.searchField} ${styles.legacyFloatingField}`}>
            <span>keyword</span>
            <ClearableInput
              ariaLabel="keyword"
              className={styles.keywordInput}
              placeholder="keyword"
              value={form.keyword}
              onChange={(value) => {
                keywordInputValueRef.current = value
                setForm((current) => ({ ...current, keyword: value }))
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  submitSearch({
                    ...form,
                    keyword: keywordInputValueRef.current,
                  })
                }
              }}
            />
          </label>
          <div className={`${styles.checkboxLine} ${styles.keywordCheckboxLine}`}>
            {KEYWORD_TARGET_LABELS.map(([key, label]) => (
              <SearchCheckbox
                key={key}
                checked={form.keywordTargets[key]}
                label={label}
                onChange={(checked) =>
                  setForm((current) => ({
                    ...current,
                    keywordTargets: {
                      ...current.keywordTargets,
                      [key]: checked,
                    },
                  }))
                }
              />
            ))}
          </div>
        </div>
      </div>
      <div className={styles.searchRow}>
        <span className={styles.searchLabel}>除外キーワード</span>
        <div className={styles.searchControl}>
          <label className={`${styles.searchField} ${styles.legacyFloatingField}`}>
            <span>ignore keyword</span>
            <ClearableInput
              ariaLabel="ignore keyword"
              placeholder="ignore keyword"
              value={form.ignoreKeyword}
              onChange={(value) => {
                ignoreKeywordInputValueRef.current = value
                setForm((current) => ({ ...current, ignoreKeyword: value }))
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  submitSearch({
                    ...form,
                    ignoreKeyword: ignoreKeywordInputValueRef.current,
                  })
                }
              }}
            />
          </label>
          <div className={`${styles.checkboxLine} ${styles.keywordCheckboxLine}`}>
            {KEYWORD_TARGET_LABELS.map(([key, label]) => (
              <SearchCheckbox
                key={key}
                checked={form.ignoreKeywordTargets[key]}
                label={label}
                onChange={(checked) =>
                  setForm((current) => ({
                    ...current,
                    ignoreKeywordTargets: {
                      ...current.ignoreKeywordTargets,
                      [key]: checked,
                    },
                  }))
                }
              />
            ))}
          </div>
        </div>
      </div>
      <div className={styles.searchRow}>
        <span className={styles.searchLabel}>放送局</span>
        <div className={styles.searchControl}>
          <label className={`${styles.searchField} ${styles.legacyFloatingField}`}>
            <span>channel</span>
            <ChannelMultiSelect
              channelIds={form.channelIds}
              options={channelSelectOptions}
              onChange={(channelIds) =>
                setForm((current) => ({
                  ...current,
                  channelIds,
                }))
              }
            />
          </label>
          <div className={`${styles.checkboxLine} ${styles.selectCheckboxGap}`}>
            {enabledBroadcastWaves.map((wave) => (
              <SearchCheckbox
                key={wave}
                checked={form.broadcastWaves[wave] ?? false}
                label={wave}
                onChange={(checked) =>
                  setForm((current) => ({
                    ...current,
                    broadcastWaves: {
                      ...current.broadcastWaves,
                      [wave]: checked,
                    },
                  }))
                }
              />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
