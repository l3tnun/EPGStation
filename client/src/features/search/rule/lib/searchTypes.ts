import type { BroadcastWave } from '@/app/navigation'

export const SEARCH_RULE_QUERY_KEY = ['search-rule'] as const
export const SEARCH_FAILURE_MESSAGE = '検索に失敗'
export const SEARCH_REFRESH_FAILURE_MESSAGE = '検索情報更新に失敗'
export const SEARCH_SCROLL_FAILURE_MESSAGE = 'スクロールに失敗'
export const RULE_RESERVES_REFRESH_FAILURE_MESSAGE = '予約情報更新に失敗'

export interface SearchWeekdayState {
  sun: boolean
  mon: boolean
  tue: boolean
  wed: boolean
  thu: boolean
  fri: boolean
  sat: boolean
}

export interface SearchKeywordTargets {
  keyCS: boolean
  keyRegExp: boolean
  name: boolean
  description: boolean
  extended: boolean
}

export interface SearchFormState {
  keyword: string
  keywordTargets: SearchKeywordTargets
  ignoreKeyword: string
  ignoreKeywordTargets: SearchKeywordTargets
  channelIds: number[]
  broadcastWaves: Partial<Record<BroadcastWave, boolean>>
  genre: number | null
  subGenre: number | null
  selectedGenres: SearchApiGenre[]
  startTime: number | null
  durationMinutes: number | null
  weekdays: SearchWeekdayState
  durationMinMinutes: number | null
  durationMaxMinutes: number | null
  startPeriod: number | null
  endPeriod: number | null
  isFree: boolean
}

export interface SearchTimeReserveFormState {
  keyword: string
  channelId: number | null
  startTime: string | null
  endTime: string | null
  weekdays: SearchWeekdayState
}

export interface SearchRouteQuery {
  keyword?: string
  channelId?: number
  genre?: number
  subGenre?: number
}

export type SearchRouteState =
  | {
      mode: 'search'
      shouldAutoSearch: boolean
      query: SearchRouteQuery
    }
  | {
      mode: 'rule-edit'
      ruleId: number
    }

export interface SearchApiGenre {
  genre: number
  subGenre?: number
}

export interface SearchApiTime {
  week: number
  start?: number
  range?: number
}

export interface SearchApiPeriod {
  startAt: number
  endAt: number
}

export interface SearchApiOption {
  keyword?: string
  keyCS?: boolean
  keyRegExp?: boolean
  name?: boolean
  description?: boolean
  extended?: boolean
  ignoreKeyword?: string
  ignoreKeyCS?: boolean
  ignoreKeyRegExp?: boolean
  ignoreName?: boolean
  ignoreDescription?: boolean
  ignoreExtended?: boolean
  channelIds?: number[]
  GR?: boolean
  BS?: boolean
  CS?: boolean
  SKY?: boolean
  BS4K?: boolean
  genres?: SearchApiGenre[]
  times: SearchApiTime[]
  searchPeriods?: SearchApiPeriod[]
  durationMin?: number
  durationMax?: number
  isFree?: boolean
  channelNames?: string[]
}

export interface SearchRequestBody {
  option: SearchApiOption
  isHalfWidth: boolean
  limit: number
}

export interface SearchRuleReserveOption {
  enable: boolean
  allowEndLack: boolean
  avoidDuplicate: boolean
  periodToAvoidDuplicate: number | null
}

export interface SearchRuleSaveOption {
  parentDirectoryName: string | null
  directory: string | null
  recordedFormat: string | null
}

export interface SearchRuleEncodeOption {
  mode1: string | null
  encodeParentDirectoryName1: string | null
  directory1: string | null
  mode2: string | null
  encodeParentDirectoryName2: string | null
  directory2: string | null
  mode3: string | null
  encodeParentDirectoryName3: string | null
  directory3: string | null
  isDeleteOriginalAfterEncode: boolean
}

export interface SearchRulePayload {
  isTimeSpecification: boolean
  searchOption: SearchApiOption
  reserveOption: SearchRuleReserveOption
  saveOption: SearchRuleSaveOption
  encodeOption?: SearchRuleEncodeOption
}

export interface SearchRuleOptionDraft {
  reserveOption: SearchRuleReserveOption
  saveOption: SearchRuleSaveOption
  encodeOption?: SearchRuleEncodeOption
}

export interface SearchRuleDetail extends SearchRulePayload {
  id: number
}

export interface RuleRouteState {
  page: number
  keyword?: string
}

export interface RuleListRequest {
  type: 'normal'
  offset: number
  limit: number
  isHalfWidth: boolean
  keyword?: string
}
