import { BROADCAST_WAVE_ORDER, type BroadcastWave } from '@/app/navigation'

export type GuideMode = 'normal' | 'singleChannel'
export type ReserveVisualState = 'reserve' | 'conflict' | 'skip' | 'overlap'

export interface GuideQuery {
  mode: GuideMode
  startAt: number
  isTimeQueryValid: boolean
  type?: BroadcastWave
  channelId?: number
}

export interface NormalGuideScheduleRequest {
  mode: 'normal'
  startAt: number
  endAt: number
  isHalfWidth: boolean
  isFree: boolean
  GR: boolean
  BS: boolean
  CS: boolean
  SKY: boolean
  BS4K: boolean
}

export interface SingleChannelGuideScheduleRequest {
  mode: 'singleChannel'
  channelId: number
  startAt: number
  days: number
  isHalfWidth: boolean
  isFree: boolean
}

export type GuideScheduleRequest = NormalGuideScheduleRequest | SingleChannelGuideScheduleRequest

export interface GuideReserveIndexRequest {
  startAt: number
  endAt: number
}

export interface GuideFetchRequestSet {
  guideQuery: GuideQuery
  schedule: GuideScheduleRequest
  reserveIndex: GuideReserveIndexRequest
}

export interface GuideRequestUrls {
  schedule: string
  reserveIndex: string
}

export interface GuideReserveItem {
  id: number
  programId?: number
  ruleId?: number
}

export interface GuideReserveLists {
  normal: readonly GuideReserveItem[]
  conflicts: readonly GuideReserveItem[]
  skips: readonly GuideReserveItem[]
  overlaps: readonly GuideReserveItem[]
}

export type GuideReserveIndex = Record<
  number,
  {
    type: ReserveVisualState
    item: GuideReserveItem
  }
>

export interface GuideProgramDialogSearchSource {
  id?: number
  name?: string
  channelId?: number
  genre1?: number
  subGenre1?: number
  genre2?: number
  subGenre2?: number
  genre3?: number
  subGenre3?: number
}

export interface GuideProgramDetailSetting {
  encode: string
  isDeleteOriginalAfterEncode: boolean
}

export interface GuideProgramAddReservePayload {
  programId: number
  allowEndLack: true
  encodeOption?: {
    mode1: string
    isDeleteOriginalAfterEncode: boolean
  }
}

export type GuideProgramExtendedTextToken =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'link'
      text: string
      href: string
    }

export const GUIDE_SCHEDULE_QUERY_KEY = ['guide', 'schedule'] as const
export const GUIDE_RESERVE_INDEX_QUERY_KEY = ['guide', 'reserveIndex'] as const
export const GUIDE_FETCH_FAILURE_MESSAGE = '番組表情報の取得に失敗しました'
export const SINGLE_CHANNEL_GUIDE_DAYS = 8
export const SINGLE_CHANNEL_GUIDE_DAY_HOURS = 24
export const GUIDE_PROGRAM_DETAIL_STORAGE_KEY = 'GuideProgramDetailSetting'
export const DEFAULT_GUIDE_PROGRAM_DETAIL_SETTING: GuideProgramDetailSetting = {
  encode: 'TS',
  isDeleteOriginalAfterEncode: false,
}

export const BROADCAST_WAVES: readonly BroadcastWave[] = BROADCAST_WAVE_ORDER
export const HOUR_MS = 60 * 60 * 1000
export const JAPAN_TIME_OFFSET_MS = 9 * HOUR_MS
