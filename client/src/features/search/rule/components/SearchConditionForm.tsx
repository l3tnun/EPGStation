import type { MutableRefObject } from 'react'
import type { BroadcastWave } from '@/app/navigation'
import type { SearchChannelOption } from '../api'
import type { SearchFormState } from '../query'
import styles from '../SearchRulePage.module.css'
import type { SearchFormFieldProps } from './searchFormProps'
import { SearchGenreRow } from './SearchGenreRow'
import { SearchKeywordRows } from './SearchKeywordRows'
import { SearchTimeRows } from './SearchTimeRows'

export function SearchConditionForm({
  form,
  setForm,
  enabledBroadcastWaves,
  channelSelectOptions,
  keywordInputValueRef,
  ignoreKeywordInputValueRef,
  isSubGenreVisible,
  setSubGenreVisible,
  submitSearch,
  clearSearch,
}: SearchFormFieldProps & {
  enabledBroadcastWaves: readonly BroadcastWave[]
  channelSelectOptions: readonly SearchChannelOption[]
  keywordInputValueRef: MutableRefObject<string>
  ignoreKeywordInputValueRef: MutableRefObject<string>
  isSubGenreVisible: boolean
  setSubGenreVisible: (isVisible: boolean) => void
  submitSearch: (nextForm?: SearchFormState) => void
  clearSearch: () => void
}) {
  return (
    <div className={styles.searchCard}>
      <SearchKeywordRows
        form={form}
        setForm={setForm}
        enabledBroadcastWaves={enabledBroadcastWaves}
        channelSelectOptions={channelSelectOptions}
        keywordInputValueRef={keywordInputValueRef}
        ignoreKeywordInputValueRef={ignoreKeywordInputValueRef}
        submitSearch={submitSearch}
      />
      <SearchGenreRow
        form={form}
        setForm={setForm}
        isSubGenreVisible={isSubGenreVisible}
        setSubGenreVisible={setSubGenreVisible}
      />
      <SearchTimeRows
        form={form}
        setForm={setForm}
        onClear={clearSearch}
        onSubmit={() => submitSearch()}
      />
    </div>
  )
}
