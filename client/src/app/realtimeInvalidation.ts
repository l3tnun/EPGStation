import type { QueryClient } from '@tanstack/react-query'
import { DASHBOARD_QUERY_KEY } from '@/features/dashboard/dashboardRequests'
import { ENCODE_QUERY_KEY } from '@/features/encode'
import {
  GUIDE_RESERVE_INDEX_QUERY_KEY,
  GUIDE_SCHEDULE_QUERY_KEY,
} from '@/features/guide/guideRequests'
import { ONAIR_QUERY_KEY, ONAIR_WATCH_INFO_QUERY_KEY } from '@/features/onair'
import { RECORDED_DETAIL_QUERY_KEY, RECORDED_QUERY_KEY } from '@/features/recorded/recordedRequests'
import { RECORDING_QUERY_KEY } from '@/features/recording'
import { RESERVES_QUERY_KEY } from '@/features/reserves/reservesRequests'
import { SEARCH_RULE_QUERY_KEY } from '@/features/search/rule'
import { STORAGES_QUERY_KEY } from '@/features/storages/storagesRequests'
import { RECORDED_WATCH_INFO_QUERY_KEY } from '@/features/video/playback'

export const REALTIME_UPDATE_STATUS_QUERY_KEYS = [
  DASHBOARD_QUERY_KEY,
  GUIDE_RESERVE_INDEX_QUERY_KEY,
  ONAIR_QUERY_KEY,
  ONAIR_WATCH_INFO_QUERY_KEY,
  RECORDED_QUERY_KEY,
  RECORDED_DETAIL_QUERY_KEY,
  RECORDED_WATCH_INFO_QUERY_KEY,
  RECORDING_QUERY_KEY,
  ENCODE_QUERY_KEY,
  RESERVES_QUERY_KEY,
  SEARCH_RULE_QUERY_KEY,
  STORAGES_QUERY_KEY,
] as const

export const REALTIME_UPDATE_ENCODE_QUERY_KEYS = [ENCODE_QUERY_KEY] as const

export const REALTIME_RECONNECT_QUERY_KEYS = [
  DASHBOARD_QUERY_KEY,
  GUIDE_SCHEDULE_QUERY_KEY,
  GUIDE_RESERVE_INDEX_QUERY_KEY,
  ONAIR_QUERY_KEY,
  ONAIR_WATCH_INFO_QUERY_KEY,
  RECORDED_QUERY_KEY,
  RECORDED_DETAIL_QUERY_KEY,
  RECORDED_WATCH_INFO_QUERY_KEY,
  RECORDING_QUERY_KEY,
  ENCODE_QUERY_KEY,
  RESERVES_QUERY_KEY,
  SEARCH_RULE_QUERY_KEY,
  STORAGES_QUERY_KEY,
] as const

export function invalidateRealtimeQueries({
  queryClient,
  queryKeys,
}: {
  queryClient: QueryClient
  queryKeys: readonly (readonly unknown[])[]
}): void {
  queryKeys.forEach((queryKey) => {
    void queryClient.invalidateQueries({
      queryKey,
    })
  })
}
