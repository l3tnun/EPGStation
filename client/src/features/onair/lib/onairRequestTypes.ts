import type { BroadcastWave } from '@/app/navigation'

export type OnAirReserveVisualState = 'reserve' | 'conflict' | 'skip' | 'overlap'

export interface OnAirRequest {
  isHalfWidth: boolean
}

export interface OnAirRequestUrls {
  reserveIndex: string
  broadcasting: string
}

export interface OnAirReserveItem {
  reserveId: number
  programId?: number
  ruleId?: number
}

export interface OnAirReserveLists {
  normal: readonly OnAirReserveItem[]
  conflicts: readonly OnAirReserveItem[]
  skips: readonly OnAirReserveItem[]
  overlaps: readonly OnAirReserveItem[]
}

export type OnAirReserveIndex = Record<
  number,
  {
    type: OnAirReserveVisualState
    item: OnAirReserveItem
  }
>

export interface OnAirTimerProgram {
  id?: number
  name?: string
  startAt?: number
  endAt?: number
}

export interface OnAirTimerSchedule {
  channel?: {
    id?: number
    name?: string
    channelType?: BroadcastWave
  }
  programs?: readonly OnAirTimerProgram[]
}

export const ONAIR_QUERY_KEY = ['onair', 'broadcasting'] as const
export const ONAIR_WATCH_INFO_QUERY_KEY = ['onair', 'watch-info'] as const
export const ONAIR_FETCH_FAILURE_MESSAGE = '番組情報取得に失敗'
export const ONAIR_STREAM_INFO_FETCH_FAILURE_MESSAGE = 'ストリーム情報取得に失敗'
export const ONAIR_SELECT_STREAM_STORAGE_KEY = 'OnAirSelectStreamSetting'

export const EMPTY_SCHEDULE_RETRY_DELAY_MS = 1000
export const MAX_UPDATE_DELAY_MS = 6048000000
export const ONAIR_RESERVE_LOOKAHEAD_MS = 60 * 60 * 1000

export type LiveStreamType = 'M2TS' | 'M2TS-LL' | 'WebM' | 'MP4' | 'HLS'

export interface LiveStreamCandidate {
  type: LiveStreamType
  modes: readonly string[]
}

export interface OnAirSelectStreamSetting {
  useURLScheme: boolean
  type: LiveStreamType
  mode: number
}

export interface OnAirLiveStreamInfoItem {
  channelId: number
  channelName?: string
  mode: number
  type?: string
  name?: string
  description?: string
  startAt?: number
  endAt?: number
}

export interface OnAirWatchInfoDisplay {
  channelName: string
  time: string
  name: string
  description: string
  endAt: number
}

export const LIVE_STREAM_TYPE_QUERY: Record<LiveStreamType, string> = {
  M2TS: 'm2ts',
  'M2TS-LL': 'm2tsll',
  WebM: 'webm',
  MP4: 'mp4',
  HLS: 'hls',
}

export const DEFAULT_SELECT_STREAM_SETTING: OnAirSelectStreamSetting = {
  useURLScheme: false,
  type: 'M2TS',
  mode: 0,
}
