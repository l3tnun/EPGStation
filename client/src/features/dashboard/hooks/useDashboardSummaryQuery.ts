import { useQuery } from '@tanstack/react-query'
import type { ShellSnackbarState } from '@/app/AppShell'
import type {
  DashboardApiRepository,
  DashboardRecordsResponse,
  DashboardReserveCounts,
  DashboardReservesResponse,
} from '../dashboardApi'
import { DASHBOARD_QUERY_KEY, type DashboardSummaryRequestSet } from '../dashboardRequests'

export interface DashboardSummary {
  reserveCounts: DashboardReserveCounts
  recording: DashboardRecordsResponse
  recorded: DashboardRecordsResponse
  reserves: DashboardReservesResponse
}

const EMPTY_RECORDS: DashboardRecordsResponse = {
  records: [],
  total: 0,
}

const EMPTY_RESERVES: DashboardReservesResponse = {
  reserves: [],
  total: 0,
}

const EMPTY_RESERVE_COUNTS: DashboardReserveCounts = {
  normal: 0,
  conflicts: 0,
  skips: 0,
  overlaps: 0,
}

export function useDashboardSummaryQuery({
  apiRepository,
  requestSet,
  pathname,
  search,
  shouldUseRealtimeFallbackPolling,
  onFetchFailure,
}: {
  apiRepository: DashboardApiRepository
  requestSet: DashboardSummaryRequestSet
  pathname: string
  search: string
  shouldUseRealtimeFallbackPolling: boolean
  onFetchFailure: (snackbar: ShellSnackbarState) => void
}) {
  return useQuery({
    queryKey: [...DASHBOARD_QUERY_KEY, pathname, search, requestSet],
    refetchInterval: shouldUseRealtimeFallbackPolling ? 3000 : false,
    refetchIntervalInBackground: shouldUseRealtimeFallbackPolling,
    queryFn: async (): Promise<DashboardSummary> => {
      const [reserveCounts, recording, recorded, reserves] = await Promise.all([
        apiRepository.fetchReserveCounts(),
        apiRepository.fetchRecording(requestSet.recording),
        apiRepository.fetchRecorded(requestSet.recorded),
        apiRepository.fetchReserves(requestSet.reserves),
      ])

      ;[reserveCounts, recording, recorded, reserves].forEach((result) => {
        if (!result.ok) {
          onFetchFailure({
            text: result.message,
            severity: 'error',
          })
        }
      })

      return {
        reserveCounts: reserveCounts.ok ? reserveCounts.value : EMPTY_RESERVE_COUNTS,
        recording: recording.ok ? recording.value : EMPTY_RECORDS,
        recorded: recorded.ok ? recorded.value : EMPTY_RECORDS,
        reserves: reserves.ok ? reserves.value : EMPTY_RESERVES,
      }
    },
  })
}
