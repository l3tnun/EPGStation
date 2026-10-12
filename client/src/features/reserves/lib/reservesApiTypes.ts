import type { FeatureResult, ServerApiFetch } from '@/app/serverApi'
import type { BroadcastWave } from '@/app/navigation'
import type { ManualReservePayload } from './manualReserveTypes'
import type { ReservesListRequest } from './reservesListRequests'

export interface ReserveListItem {
  id: number
  programId?: number
  name?: string
  channelId?: number
  channelName?: string
  channelType?: BroadcastWave
  startAt?: number
  endAt?: number
  description?: string
  extended?: string
  ruleId?: number
  genre1?: number
  subGenre1?: number
  genre2?: number
  subGenre2?: number
  genre3?: number
  subGenre3?: number
  isConflict?: boolean
  isSkip?: boolean
  isOverlap?: boolean
  isTimeSpecified?: boolean
  allowEndLack?: boolean
  parentDirectoryName?: string
  directory?: string
  recordedFormat?: string
  encodeMode1?: string
  encodeParentDirectoryName1?: string
  encodeDirectory1?: string
  encodeMode2?: string
  encodeParentDirectoryName2?: string
  encodeDirectory2?: string
  encodeMode3?: string
  encodeParentDirectoryName3?: string
  encodeDirectory3?: string
  isDeleteOriginalAfterEncode?: boolean
  genres?: readonly string[]
}

export interface ReservesListResponse {
  reserves: ReserveListItem[]
  total: number
}

export interface ManualProgramDetail {
  id: number
  name: string
  channelId: number
  channelName?: string
  startAt: number
  endAt: number
  description?: string
  extended?: string
  genres?: readonly string[]
  genre1?: number
  subGenre1?: number
  genre2?: number
  subGenre2?: number
  genre3?: number
  subGenre3?: number
  isFree?: boolean
  videoComponentType?: number
  audioComponentType?: number
  audioSamplingRate?: number
}

export interface ReservesApiRepository {
  primeChannelIndex?(channels: unknown): void
  fetchReserves(
    request: ReservesListRequest,
  ): Promise<FeatureResult<ReservesListResponse, 'reserves-fetch-failed'>>
  fetchManualReserve(request: {
    reserveId: number
    isHalfWidth: boolean
  }): Promise<FeatureResult<ReserveListItem, 'manual-reserve-fetch-failed'>>
  fetchManualProgram(request: {
    programId: number
    isHalfWidth: boolean
  }): Promise<FeatureResult<ManualProgramDetail, 'manual-program-fetch-failed'>>
  addManualReserve(
    payload: ManualReservePayload,
  ): Promise<FeatureResult<{ reserveId: number }, 'manual-reserve-add-failed'>>
  updateManualReserve(
    reserveId: number,
    payload: ManualReservePayload,
  ): Promise<FeatureResult<void, 'manual-reserve-update-failed'>>
  deleteReserve(reserveId: number): Promise<FeatureResult<void, 'reserve-delete-failed'>>
  unlockSkipReserve(reserveId: number): Promise<FeatureResult<void, 'unlock-skip-failed'>>
  unlockOverlapReserve(reserveId: number): Promise<FeatureResult<void, 'unlock-overlap-failed'>>
  updateReserves(): Promise<FeatureResult<void, 'reserves-update-failed'>>
}

export interface CreateFetchReservesApiRepositoryOptions {
  fetcher?: ServerApiFetch
  basePath?: string
}
