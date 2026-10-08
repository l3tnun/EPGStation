import { skipToken, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useScrollHistoryPageReady } from '@/app/scrollHistory'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { SearchChannelOption, SearchRuleApiRepository } from '../api'
import { createReserveIndexRequest } from '../lib/programDisplay'
import { SEARCH_RULE_QUERY_KEY, type SearchRouteState, type SearchRuleDetail } from '../query'
import type { ActiveSearchRequest } from './useSearchRuleFormState'

export type SearchRuleQueries = ReturnType<typeof useSearchRuleQueries>

export function useSearchRuleQueries({
  apiRepository,
  routeState,
  routeKey,
  settings,
  activeRequest,
}: {
  apiRepository: SearchRuleApiRepository
  routeState: SearchRouteState
  routeKey: string
  settings: SettingsConsumerValue
  activeRequest: ActiveSearchRequest | null
}) {
  const ruleId = routeState.mode === 'rule-edit' ? routeState.ruleId : null
  const ruleDetailQuery = useQuery({
    queryKey: [...SEARCH_RULE_QUERY_KEY, 'rule', ruleId, settings.isHalfWidthDisplayed],
    queryFn:
      ruleId === null
        ? skipToken
        : () => apiRepository.fetchRule(ruleId, settings.isHalfWidthDisplayed),
  })
  const ruleDetail: SearchRuleDetail | null = ruleDetailQuery.data?.ok
    ? ruleDetailQuery.data.value
    : null
  const channelOptionsQuery = useQuery({
    queryKey: [...SEARCH_RULE_QUERY_KEY, 'channels', settings.isHalfWidthDisplayed],
    queryFn: async () =>
      apiRepository.fetchSearchChannels?.(settings.isHalfWidthDisplayed) ?? {
        ok: true as const,
        value: [] as readonly SearchChannelOption[],
      },
  })
  const channelOptions = channelOptionsQuery.data?.ok ? channelOptionsQuery.data.value : []
  const searchRequest =
    activeRequest !== null &&
    (routeState.mode === 'search' ||
      (routeState.mode === 'rule-edit' &&
        ruleDetail?.isTimeSpecification === false &&
        (activeRequest.source === 'rule-edit-preload' ||
          activeRequest.source === 'rule-edit-submit')))
      ? activeRequest
      : null
  const isSearchEnabled = searchRequest !== null
  const query = useQuery({
    queryKey: [...SEARCH_RULE_QUERY_KEY, 'search', activeRequest],
    queryFn:
      searchRequest === null
        ? skipToken
        : async () => ({
            requestKey: JSON.stringify(searchRequest),
            response: await apiRepository.searchSchedules(searchRequest.body),
          }),
  })
  const ruleReservesRuleId = ruleDetail?.isTimeSpecification === true ? ruleId : null
  const ruleReservesQuery = useQuery({
    queryKey: [
      ...SEARCH_RULE_QUERY_KEY,
      'rule-reserves',
      ruleReservesRuleId,
      settings.isHalfWidthDisplayed,
    ],
    queryFn:
      ruleReservesRuleId === null
        ? skipToken
        : () =>
            apiRepository.fetchRuleReserves({
              ruleId: ruleReservesRuleId,
              isHalfWidth: settings.isHalfWidthDisplayed,
            }),
  })
  const canShowSearchPrograms =
    activeRequest !== null &&
    ((routeState.mode === 'search' &&
      (activeRequest.source === 'route-search' || activeRequest.source === 'search-submit')) ||
      (routeState.mode === 'rule-edit' &&
        (activeRequest.source === 'rule-edit-preload' ||
          activeRequest.source === 'rule-edit-submit')))
  const activeRequestKey = activeRequest === null ? null : JSON.stringify(activeRequest)
  const isCurrentSearchQueryData = query.data?.requestKey === activeRequestKey
  const currentSearchResponse = isCurrentSearchQueryData ? query.data?.response : undefined
  const programs =
    canShowSearchPrograms && currentSearchResponse?.ok ? currentSearchResponse.value : null
  const reserveIndexRequest = useMemo(() => createReserveIndexRequest(programs), [programs])
  const reserveIndexQuery = useQuery({
    queryKey: [...SEARCH_RULE_QUERY_KEY, 'reserveIndex', reserveIndexRequest],
    queryFn:
      reserveIndexRequest === null
        ? skipToken
        : () => apiRepository.fetchReserveIndex(reserveIndexRequest),
  })
  const isRuleDetailReady =
    routeState.mode !== 'rule-edit' ||
    (ruleDetailQuery.data !== undefined && !ruleDetailQuery.isFetching)
  const isSearchResultReady = !isSearchEnabled || (query.data !== undefined && !query.isFetching)
  const isRuleReserveReady =
    !(routeState.mode === 'rule-edit' && ruleDetail?.isTimeSpecification === true) ||
    (ruleReservesQuery.data !== undefined && !ruleReservesQuery.isFetching)
  const isReserveIndexReady =
    reserveIndexRequest === null ||
    (reserveIndexQuery.data !== undefined && !reserveIndexQuery.isFetching)
  useScrollHistoryPageReady(
    channelOptionsQuery.data !== undefined &&
      !channelOptionsQuery.isFetching &&
      isRuleDetailReady &&
      isSearchResultReady &&
      isRuleReserveReady &&
      isReserveIndexReady,
    routeKey,
  )
  const reserveIndex = reserveIndexQuery.data?.ok ? reserveIndexQuery.data.value : {}

  return {
    ruleDetailQuery,
    ruleDetail,
    channelOptions,
    query,
    ruleReservesQuery,
    currentSearchResponse,
    programs,
    reserveIndex,
  }
}
