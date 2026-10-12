import type { FeatureResult, ServerApiFetch } from '@/app/serverApi'
import type { RecordedListItem } from '@/features/recorded/recordedApi'
import type { ReserveListItem } from '@/features/reserves/reservesApi'
import type {
  DashboardRecordedRequest,
  DashboardRecordingRequest,
  DashboardReservesRequest,
} from '../dashboardRequests'

export interface DashboardRecordsResponse {
  records: RecordedListItem[]
  total: number
}

export interface DashboardReservesResponse {
  reserves: ReserveListItem[]
  total: number
}

export interface DashboardReserveCounts {
  normal: number
  conflicts: number
  skips: number
  overlaps: number
}

export interface DashboardApiRepository {
  primeChannelIndex?(channels: unknown): void
  fetchReserveCounts(): Promise<
    FeatureResult<DashboardReserveCounts, 'reserve-counts-fetch-failed'>
  >
  fetchRecording(
    request: DashboardRecordingRequest,
  ): Promise<FeatureResult<DashboardRecordsResponse, 'recording-fetch-failed'>>
  fetchRecorded(
    request: DashboardRecordedRequest,
  ): Promise<FeatureResult<DashboardRecordsResponse, 'recorded-fetch-failed'>>
  fetchReserves(
    request: DashboardReservesRequest,
  ): Promise<FeatureResult<DashboardReservesResponse, 'reserves-fetch-failed'>>
}

export interface CreateFetchDashboardApiRepositoryOptions {
  fetcher?: ServerApiFetch
  basePath?: string
}
