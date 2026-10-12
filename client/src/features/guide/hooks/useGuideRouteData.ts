import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { BroadcastWave } from '@/app/navigation'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { GuideApiRepository, GuideSchedule } from '../guideApi'
import { buildGuideFetchRequestSet, createGuideQueryKeys } from '../guideRequests'
import { hasDisplayChannels, type GuideRequestSet } from '../lib/guidePageState'

export function useGuideRouteData({
  settings,
  search,
  now,
  invalidChannelIds,
  enabledBroadcastWaves,
  apiRepository,
}: {
  settings: SettingsConsumerValue
  search: string
  now: number | undefined
  invalidChannelIds: ReadonlySet<number>
  enabledBroadcastWaves: readonly BroadcastWave[]
  apiRepository: GuideApiRepository
}) {
  const requestSet: GuideRequestSet = useMemo(
    () =>
      buildGuideFetchRequestSet({
        settings,
        search,
        now,
        invalidChannelIds,
        enabledBroadcastWaves,
      }),
    [enabledBroadcastWaves, invalidChannelIds, search, now, settings],
  )
  const queryKeys = useMemo(() => createGuideQueryKeys(requestSet), [requestSet])
  const scheduleQuery = useQuery({
    queryKey: queryKeys.schedule,
    queryFn: () => apiRepository.fetchSchedule(requestSet.schedule),
  })
  const reserveIndexQuery = useQuery({
    queryKey: queryKeys.reserveIndex,
    queryFn: () => apiRepository.fetchReserveIndex(requestSet.reserveIndex),
  })
  const scheduleData: readonly GuideSchedule[] | undefined =
    scheduleQuery.data?.ok === true ? scheduleQuery.data.value : undefined
  const reserveIndex = useMemo(
    () => (reserveIndexQuery.data?.ok === true ? reserveIndexQuery.data.value : {}),
    [reserveIndexQuery.data],
  )
  const hasResolvedSchedule = scheduleQuery.data?.ok === true
  const hasScheduleData = hasDisplayChannels({ schedules: scheduleData, requestSet })
  const hasRouteData = scheduleQuery.data !== undefined && reserveIndexQuery.data !== undefined
  const hasCompletedRouteData =
    hasRouteData && !scheduleQuery.isFetching && !reserveIndexQuery.isFetching

  return {
    requestSet,
    scheduleQuery,
    reserveIndexQuery,
    scheduleData,
    reserveIndex,
    hasResolvedSchedule,
    hasScheduleData,
    hasRouteData,
    hasCompletedRouteData,
  }
}
