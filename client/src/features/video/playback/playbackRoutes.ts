import type { LiveStreamConfig, RecordedStreamFileConfig } from '@/app/serverApi'

export type PlaybackRouteResult<T> =
  | {
      ok: true
      value: T
    }
  | {
      ok: false
      message: string
    }
  | {
      ok: false
      reason: 'pending-config'
      message: null
    }

/**
 * The subset of PlaybackRouteResult<T> returned by routes that never have a
 * pending-config state (e.g. resolveRecordedWatchRoute() below, which has no
 * `isConfigLoaded` input to wait on).
 */
export type PlaybackRouteResultWithoutPendingConfig<T> =
  | {
      ok: true
      value: T
    }
  | {
      ok: false
      message: string
    }

export type PlaybackStreamingType = 'hls' | 'm2ts' | 'm2tsll' | 'webm' | 'mp4'
export type RecordedStreamingType = Exclude<PlaybackStreamingType, 'm2ts' | 'm2tsll'>
export type RecordedStreamingFileType = 'ts' | 'encoded'

export interface LiveWatchRoute {
  kind: 'live'
  channelId: number
  mode: number
  streamingType: PlaybackStreamingType
}

export interface RecordedDirectWatchRoute {
  kind: 'recorded-direct'
  // Always a finite integer here: resolveRecordedWatchRoute() below returns ok:false
  // (never a null videoFileId in an ok:true value) whenever the videoId query
  // parameter is missing or invalid.
  videoFileId: number
  recordedId: number | null
  shouldRenderInfoCard: boolean
}

export interface RecordedStreamingWatchRoute {
  kind: 'recorded-streaming'
  videoFileId: number
  fileType: RecordedStreamingFileType
  mode: number
  streamingType: RecordedStreamingType
  recordedId: number | null
  shouldRenderInfoCard: boolean
}

const LIVE_WATCH_ERROR = '再生条件が不正です'
const RECORDED_WATCH_ERROR = '再生対象が不正です'
const RECORDED_STREAMING_ERROR = 'ストリーム再生条件が不正です'

function parseFiniteInteger(value: string | null | undefined): number | null {
  if (value === null || value === undefined || !/^(?:0|[1-9]\d*)$/.test(value)) {
    return null
  }

  const parsed = Number(value)

  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseOptionalFiniteInteger(value: string | null): number | null {
  return value === null ? null : parseFiniteInteger(value)
}

function resolveLiveModeCount(
  streamConfig: LiveStreamConfig | undefined,
  streamingType: PlaybackStreamingType,
): number {
  const tsConfig = streamConfig?.live?.ts

  if (streamingType === 'm2ts') {
    return tsConfig?.m2ts?.length ?? 0
  }
  if (streamingType === 'm2tsll') {
    return tsConfig?.m2tsll?.length ?? 0
  }
  if (streamingType === 'webm') {
    return tsConfig?.webm?.length ?? 0
  }
  if (streamingType === 'mp4') {
    return tsConfig?.mp4?.length ?? 0
  }

  return tsConfig?.hls?.length ?? 0
}

function isLiveWatchStreamingType(value: string | null): value is PlaybackStreamingType {
  return (
    value === 'hls' || value === 'm2ts' || value === 'm2tsll' || value === 'webm' || value === 'mp4'
  )
}

function isRecordedStreamingType(value: string | null): value is RecordedStreamingType {
  return value === 'hls' || value === 'webm' || value === 'mp4'
}

function isRecordedStreamingFileType(value: string | null): value is RecordedStreamingFileType {
  return value === 'ts' || value === 'encoded'
}

function countRecordedModes(
  config: RecordedStreamFileConfig | undefined,
  streamingType: RecordedStreamingType,
): number {
  if (streamingType === 'hls') {
    return config?.hls?.length ?? 0
  }
  if (streamingType === 'webm') {
    return config?.webm?.length ?? 0
  }

  return config?.mp4?.length ?? 0
}

function resolveRecordedModeCount(
  streamConfig: LiveStreamConfig | undefined,
  streamingType: RecordedStreamingType,
  fileType: RecordedStreamingFileType,
): number {
  return countRecordedModes(streamConfig?.recorded?.[fileType], streamingType)
}

export function resolveLiveWatchRoute({
  search,
  streamConfig,
  isConfigLoaded = true,
}: {
  search: string
  streamConfig?: LiveStreamConfig
  isConfigLoaded?: boolean
}): PlaybackRouteResult<LiveWatchRoute> {
  const parameters = new URLSearchParams(search)
  const streamingType = parameters.get('type')
  const channelParam = parameters.get('channel')
  const modeParam = parameters.get('mode')

  if (streamingType === null && channelParam === null && modeParam === null) {
    return {
      ok: false,
      reason: 'pending-config',
      message: null,
    }
  }

  const channelId = parseFiniteInteger(channelParam)
  const mode = parseFiniteInteger(modeParam)

  if (!isLiveWatchStreamingType(streamingType) || channelId === null || mode === null) {
    return {
      ok: false,
      message: LIVE_WATCH_ERROR,
    }
  }
  if (isConfigLoaded && mode >= resolveLiveModeCount(streamConfig, streamingType)) {
    return {
      ok: false,
      message: LIVE_WATCH_ERROR,
    }
  }

  return {
    ok: true,
    value: {
      kind: 'live',
      channelId,
      mode,
      streamingType,
    },
  }
}

export function resolveRecordedWatchRoute(
  search: string,
): PlaybackRouteResultWithoutPendingConfig<RecordedDirectWatchRoute> {
  const parameters = new URLSearchParams(search)
  const videoFileId = parseFiniteInteger(parameters.get('videoId'))
  const recordedId = parseOptionalFiniteInteger(parameters.get('recordedId'))

  if (videoFileId === null) {
    return {
      ok: false,
      message: RECORDED_WATCH_ERROR,
    }
  }

  return {
    ok: true,
    value: {
      kind: 'recorded-direct',
      videoFileId,
      recordedId,
      shouldRenderInfoCard: recordedId !== null,
    },
  }
}

export function resolveRecordedStreamingWatchRoute({
  videoFileId,
  search,
  streamConfig,
  isConfigLoaded = true,
}: {
  videoFileId: string | undefined
  search: string
  streamConfig?: LiveStreamConfig
  isConfigLoaded?: boolean
}): PlaybackRouteResult<RecordedStreamingWatchRoute> {
  const parameters = new URLSearchParams(search)
  const parsedVideoFileId = parseFiniteInteger(videoFileId)
  const streamingType = parameters.get('streamingType')
  const fileType = parameters.get('fileType')
  const mode = parseFiniteInteger(parameters.get('mode'))

  if (
    parsedVideoFileId === null ||
    !isRecordedStreamingType(streamingType) ||
    !isRecordedStreamingFileType(fileType) ||
    mode === null
  ) {
    return {
      ok: false,
      message: RECORDED_STREAMING_ERROR,
    }
  }
  if (!isConfigLoaded) {
    return {
      ok: false,
      reason: 'pending-config',
      message: null,
    }
  }
  if (mode >= resolveRecordedModeCount(streamConfig, streamingType, fileType)) {
    return {
      ok: false,
      message: RECORDED_STREAMING_ERROR,
    }
  }

  const recordedId = parseOptionalFiniteInteger(parameters.get('recordedId'))

  return {
    ok: true,
    value: {
      kind: 'recorded-streaming',
      videoFileId: parsedVideoFileId,
      fileType,
      mode,
      streamingType,
      recordedId,
      shouldRenderInfoCard: recordedId !== null,
    },
  }
}
