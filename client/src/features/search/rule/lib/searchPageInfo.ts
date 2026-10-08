import type {
  SearchFormState,
  SearchRouteState,
  SearchRuleOptionDraft,
  SearchTimeReserveFormState,
} from './searchTypes'

/**
 * Search 画面の route leave/update 時に保存し、history restore のときだけ復元する page state。
 * v2 `Search.vue` の `PageInfo`（39-48 行目）に相当する。v2 の `searchOption`/`reserveOption`/
 * `saveOption`/`encodeOption` は v3 では `optionDraft` にまとまっており、`genreSelect`
 * （選択中ジャンルそのもの）は `form.selectedGenres` に含まれるため、別フィールドとしては持たない。
 */
export interface SearchPageInfo {
  form: SearchFormState
  isTimeSpecification: boolean
  timeReserveForm: SearchTimeReserveFormState
  optionDraft: SearchRuleOptionDraft
  isSearched: boolean
}

export function createSearchPageInfoFromState({
  form,
  isTimeSpecification,
  timeReserveForm,
  optionDraft,
  isSearched,
}: {
  form: SearchFormState
  isTimeSpecification: boolean
  timeReserveForm: SearchTimeReserveFormState
  optionDraft: SearchRuleOptionDraft
  isSearched: boolean
}): SearchPageInfo {
  return { form, isTimeSpecification, timeReserveForm, optionDraft, isSearched }
}

/**
 * v2 `savePageInfo()`（Search.vue 251-269 行目）の `isEditingRule() === true` の間は保存しない、
 * という guard に相当する。ルール編集画面を離れるときの page state はここでは保存しない。
 */
export function shouldSaveSearchPageInfo({ mode }: { mode: SearchRouteState['mode'] }): boolean {
  return mode === 'search'
}

/**
 * `pageInfo` が `SearchPageInfo` の形をしているかを確認する。`ScrollHistoryState.getScrollData`
 * は URL を key にした保存領域を全 route 共通で使い回しており、型引数は呼び出し側の自己申告に
 * 過ぎない（実体は `unknown`）。history の current entry が指す URL key が別 route
 * （例: Guide の `{scrollLeft, scrollTop}`）の保存 data と一致した場合、その形のまま
 * `SearchPageInfo` として signature 上は返ってきてしまうため、`form` 等を読む前に
 * 実際の形を確認する。
 */
function isSearchPageInfo(value: unknown): value is SearchPageInfo {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<SearchPageInfo>

  return (
    typeof candidate.form === 'object' &&
    candidate.form !== null &&
    typeof candidate.form.keyword === 'string' &&
    typeof candidate.isTimeSpecification === 'boolean' &&
    typeof candidate.timeReserveForm === 'object' &&
    candidate.timeReserveForm !== null &&
    typeof candidate.optionDraft === 'object' &&
    candidate.optionDraft !== null &&
    typeof candidate.isSearched === 'boolean'
  )
}

/**
 * history による復帰のときだけ、保存済み page info を復元対象として返す。plain `/search` を
 * navigation drawer から新規に開いた場合（history restore ではない場合）や、ルール編集route
 * （`mode !== 'search'`）では常に null を返し、呼び出し側は route query から作った初期値を使う。
 * `pageInfo` は呼び出し側で `unknown` として渡す想定 - `getScrollData` の型引数は自己申告でしか
 * ないため、ここで `isSearchPageInfo` により実際の形を確認してから返す。
 */
export function resolveSearchPageInfoForRoute({
  mode,
  shouldRestoreHistory,
  pageInfo,
}: {
  mode: SearchRouteState['mode']
  shouldRestoreHistory: boolean
  pageInfo: unknown
}): SearchPageInfo | null {
  if (mode !== 'search' || !shouldRestoreHistory || !isSearchPageInfo(pageInfo)) {
    return null
  }

  return pageInfo
}
