import type {
  LiveWatchRoute,
  RecordedDirectWatchRoute,
  RecordedStreamingWatchRoute,
} from './playbackRoutes'

export type PlaybackRoute = LiveWatchRoute | RecordedDirectWatchRoute | RecordedStreamingWatchRoute

export interface PlaybackMediaSource {
  sourceKind: 'direct-video' | 'direct-stream' | 'hls-stream'
  mediaUrl?: string
  streamStartUrl?: string
  readinessUrl?: string
}

function joinBasePath(basePath: string, path: string): string {
  return `${basePath.replace(/\/$/, '')}${path}`
}

function appendQuery(url: string, query: Record<string, string>): string {
  const parameters = new URLSearchParams(query)

  return `${url}?${parameters.toString()}`
}

function toAbsoluteUrl(url: string, baseUrl: string): string {
  return new URL(url, baseUrl).toString()
}

function buildRecordedStreamingUrl({
  videoFileId,
  streamingType,
  mode,
  seekSeconds,
  basePath,
}: {
  videoFileId: number
  streamingType: 'webm' | 'mp4'
  mode: number
  seekSeconds: number
  basePath: string
}): string {
  return appendQuery(joinBasePath(basePath, `/streams/recorded/${videoFileId}/${streamingType}`), {
    mode: String(mode),
    ss: String(seekSeconds),
  })
}

export function buildPlaybackMediaSource({
  route,
  isHalfWidth,
  seekSeconds = 0,
  basePath = './api',
  baseUrl,
}: {
  route: PlaybackRoute
  isHalfWidth: boolean
  seekSeconds?: number
  basePath?: string
  baseUrl?: string
}): PlaybackMediaSource {
  if (route.kind === 'recorded-direct') {
    return {
      sourceKind: 'direct-video',
      mediaUrl: joinBasePath(basePath, `/videos/${String(route.videoFileId)}`),
    }
  }

  if (route.kind === 'live') {
    if (route.streamingType === 'hls') {
      return {
        sourceKind: 'hls-stream',
        streamStartUrl: appendQuery(
          joinBasePath(basePath, `/streams/live/${route.channelId}/hls`),
          {
            mode: String(route.mode),
          },
        ),
        readinessUrl: appendQuery(joinBasePath(basePath, '/streams'), {
          isHalfWidth: String(isHalfWidth),
        }),
      }
    }

    const liveStreamUrl = appendQuery(
      joinBasePath(basePath, `/streams/live/${route.channelId}/${route.streamingType}`),
      {
        mode: String(route.mode),
      },
    )

    return {
      sourceKind: 'direct-stream',
      mediaUrl:
        route.streamingType === 'm2tsll' && baseUrl !== undefined
          ? toAbsoluteUrl(liveStreamUrl, baseUrl)
          : liveStreamUrl,
    }
  }

  if (route.streamingType === 'hls') {
    return {
      sourceKind: 'hls-stream',
      streamStartUrl: appendQuery(
        joinBasePath(basePath, `/streams/recorded/${route.videoFileId}/hls`),
        {
          mode: String(route.mode),
          ss: String(seekSeconds),
        },
      ),
      readinessUrl: appendQuery(joinBasePath(basePath, '/streams'), {
        isHalfWidth: String(isHalfWidth),
      }),
    }
  }

  return {
    sourceKind: 'direct-stream',
    mediaUrl: buildRecordedStreamingUrl({
      videoFileId: route.videoFileId,
      streamingType: route.streamingType,
      mode: route.mode,
      seekSeconds,
      basePath,
    }),
  }
}
