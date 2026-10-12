export const HLS_START_FAILURE_SNACKBAR = 'ストリーム開始に失敗'
export const HLS_MISSING_ID_SNACKBAR = 'ストリーム id 取得に失敗'
export const HLS_STOP_FAILURE_SNACKBAR = 'ストリーム停止に失敗'
export const HLS_READINESS_FAILURE_MESSAGE = 'ストリーム準備に失敗'
// stream が /api/streams の一覧から消えた場合の terminal message。
// isEnabled(isEnable) が false のまま一覧に残っている「準備中」とは区別する。
export const HLS_STREAM_LOST_MESSAGE = 'ストリームが停止しました'
export const UNSUPPORTED_BROWSER_MESSAGE = '非対応ブラウザーです。'
export const VIDEO_ELEMENT_MISSING_MESSAGE = 'video 要素がありません。'

export type HlsStreamId = number | string

export interface HlsStreamStatus {
  streamId: HlsStreamId
  isEnabled: boolean
}

export interface HlsLifecycleRepository {
  start(signal?: AbortSignal): Promise<{ streamId: HlsStreamId | null }>
  fetchStreams(signal?: AbortSignal): Promise<readonly HlsStreamStatus[]>
  keep(streamId: HlsStreamId): Promise<void>
  stop(streamId: HlsStreamId): Promise<void>
}

export type HlsLifecycleState = 'idle' | 'starting' | 'waiting' | 'ready' | 'error' | 'stopped'

export interface HlsLifecycleSnapshot {
  state: HlsLifecycleState
  streamId: HlsStreamId | null
  playlistUrl?: string
  errorMessage: string | null
  snackbarText: string | null
}

export interface HlsLifecycleControllerOptions {
  repository: HlsLifecycleRepository
  readinessPollMs?: number
  readinessTimeoutMs?: number
  keepIntervalMs?: number
  startRetryCount?: number
  retryDelayMs?: number
  playlistBasePath?: string
  onChange?: (snapshot: HlsLifecycleSnapshot) => void
}

export type PlaybackLifecycleMode = 'direct-response' | 'hls-api' | 'direct-video'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isStreamId(value: unknown): value is HlsStreamId {
  return typeof value === 'number' || typeof value === 'string'
}

export function areSameStreamId(left: HlsStreamId, right: HlsStreamId): boolean {
  return String(left) === String(right)
}

export function clearTimer(timerId: ReturnType<typeof setInterval> | undefined): undefined {
  if (timerId !== undefined) {
    clearInterval(timerId)
  }

  return undefined
}

export function buildHlsPlaylistUrl(
  streamId: HlsStreamId,
  playlistBasePath = './streamfiles',
): string {
  return `${playlistBasePath.replace(/\/$/, '')}/stream${streamId}.m3u8`
}
