import {
  detectMpegtsLivePlaybackSupport,
  type MpegtsLivePlaybackCapability,
} from '@/shared/media/mpegtsSupport'
import type { PlaybackMediaSource } from './playbackMedia'
import type { PlaybackStreamingType } from './playbackRoutes'

export * from './playbackLifecycleTypes'
import {
  UNSUPPORTED_BROWSER_MESSAGE,
  VIDEO_ELEMENT_MISSING_MESSAGE,
  type PlaybackLifecycleMode,
} from './playbackLifecycleTypes'

export function resolvePlaybackLifecycleMode({
  sourceKind,
  streamingType,
}: {
  sourceKind: PlaybackMediaSource['sourceKind']
  streamingType?: PlaybackStreamingType
}): PlaybackLifecycleMode {
  if (sourceKind === 'hls-stream' || streamingType === 'hls') {
    return 'hls-api'
  }
  if (sourceKind === 'direct-video') {
    return 'direct-video'
  }

  return 'direct-response'
}

export function rebuildDirectStreamUrlForSeek(mediaUrl: string, seekSeconds: number): string {
  const url = new URL(mediaUrl, 'http://epgstation.invalid')
  url.searchParams.set('ss', String(seekSeconds))

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(mediaUrl)) {
    return `${url.origin}${url.pathname}${url.search}`
  }

  return `${mediaUrl.split('?')[0]}${url.search}`
}

export type M2tsLlCapability = Pick<MpegtsLivePlaybackCapability, 'isSupported'>

export function resolveM2tsLlPlaybackReadiness({
  capability,
  hasVideoElement,
}: {
  capability: M2tsLlCapability
  hasVideoElement: boolean
}): { ready: boolean; message: string | null } {
  if (!capability.isSupported()) {
    return {
      ready: false,
      message: UNSUPPORTED_BROWSER_MESSAGE,
    }
  }
  if (!hasVideoElement) {
    return {
      ready: false,
      message: VIDEO_ELEMENT_MISSING_MESSAGE,
    }
  }

  return {
    ready: true,
    message: null,
  }
}

export function detectM2tsLlSupport(): boolean {
  return detectMpegtsLivePlaybackSupport()
}

export { createFetchHlsLifecycleRepository } from './playbackLifecycleRepository'
export { HlsLifecycleController } from './playbackLifecycleController'
