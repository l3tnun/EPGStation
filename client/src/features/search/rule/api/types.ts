import type { FeatureResult, ServerApiFetch } from '@/app/serverApi'
import type {
  GuideProgramAddReservePayload,
  GuideReserveIndex,
  GuideReserveIndexRequest,
} from '@/features/guide/guideRequests'
import type { ReserveListItem as ReserveListItemModel } from '@/features/reserves/reservesApi'
import type {
  RuleListRequest,
  SearchRequestBody,
  SearchRuleDetail,
  SearchRulePayload,
} from '../query'

export interface SearchProgram {
  id: number
  name?: string
  channelId?: number
  channelName?: string
  startAt?: number
  endAt?: number
  description?: string
  extended?: string
  genre1?: number
  subGenre1?: number
  genre2?: number
  subGenre2?: number
  genre3?: number
  subGenre3?: number
  isFree?: boolean
}

export interface RuleListItem {
  id: number
  searchOption: SearchRulePayload['searchOption'] & { channelNames?: string[] }
  reserveOption: SearchRulePayload['reserveOption']
  reservesCnt?: number
}

export interface RuleListResponse {
  rules: RuleListItem[]
  total: number
}

export interface SearchChannelOption {
  id: number
  name: string
}

export interface SearchRuleApiRepository {
  primeChannelIndex?(channels: unknown): void
  fetchSearchChannels?(
    isHalfWidth: boolean,
  ): Promise<FeatureResult<readonly SearchChannelOption[], 'search-channels-fetch-failed'>>
  searchSchedules(
    body: SearchRequestBody,
  ): Promise<FeatureResult<readonly SearchProgram[], 'search-failed'>>
  fetchReserveIndex(
    request: GuideReserveIndexRequest,
  ): Promise<FeatureResult<GuideReserveIndex, 'search-reserve-index-failed'>>
  addProgramReserve(
    payload: GuideProgramAddReservePayload,
  ): Promise<FeatureResult<{ reserveId: number }, 'search-program-reserve-add-failed'>>
  deleteReserve(reserveId: number): Promise<FeatureResult<void, 'search-reserve-delete-failed'>>
  unlockSkipReserve(reserveId: number): Promise<FeatureResult<void, 'search-reserve-unskip-failed'>>
  unlockOverlapReserve(
    reserveId: number,
  ): Promise<FeatureResult<void, 'search-reserve-unoverlap-failed'>>
  addRule(payload: SearchRulePayload): Promise<FeatureResult<{ ruleId: number }, 'rule-add-failed'>>
  updateRule(
    ruleId: number,
    payload: SearchRulePayload,
  ): Promise<FeatureResult<void, 'rule-update-failed'>>
  fetchRule(
    ruleId: number,
    isHalfWidth: boolean,
  ): Promise<FeatureResult<SearchRuleDetail, 'rule-fetch-failed'>>
  fetchRuleReserves(request: {
    ruleId: number
    isHalfWidth: boolean
  }): Promise<FeatureResult<ReserveListItemModel[], 'rule-reserves-fetch-failed'>>
  fetchRules(
    request: RuleListRequest,
  ): Promise<FeatureResult<RuleListResponse, 'rules-fetch-failed'>>
  enableRule(ruleId: number): Promise<FeatureResult<void, 'rule-enable-failed'>>
  disableRule(ruleId: number): Promise<FeatureResult<void, 'rule-disable-failed'>>
  deleteRule(ruleId: number): Promise<FeatureResult<void, 'rule-delete-failed'>>
}

export interface CreateFetchSearchRuleApiRepositoryOptions {
  fetcher?: ServerApiFetch
  basePath?: string
}
