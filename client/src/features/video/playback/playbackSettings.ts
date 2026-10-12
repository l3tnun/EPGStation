import type { PlaybackMediaSource } from './playbackMedia'
import type { PlaybackStreamingType } from './playbackRoutes'

export interface VideoPlayerSetting {
  isShowSubtitle: boolean
}

export interface SubtitleRendererContract {
  rendererMounted: boolean
  rendererKind: 'aribb24' | 'none'
  strokeEnabled: boolean
  isShowSubtitle: boolean
  hasSubtitleTrack: boolean
}

const VIDEO_PLAYER_SETTING_KEY = 'VideoPlayerSetting'
const DEFAULT_VIDEO_PLAYER_SETTING: VideoPlayerSetting = {
  isShowSubtitle: false,
}

export function readVideoPlayerSetting(storage: Storage | undefined): VideoPlayerSetting {
  if (storage === undefined) {
    return DEFAULT_VIDEO_PLAYER_SETTING
  }

  try {
    const raw = storage.getItem(VIDEO_PLAYER_SETTING_KEY)
    if (raw === null) {
      return DEFAULT_VIDEO_PLAYER_SETTING
    }
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Object.hasOwn(parsed, 'isShowSubtitle') &&
      typeof (parsed as { isShowSubtitle?: unknown }).isShowSubtitle === 'boolean'
    ) {
      const setting = parsed as { isShowSubtitle: boolean }

      return {
        isShowSubtitle: setting.isShowSubtitle,
      }
    }
  } catch {
    return DEFAULT_VIDEO_PLAYER_SETTING
  }

  return DEFAULT_VIDEO_PLAYER_SETTING
}

export function saveVideoPlayerSetting(
  storage: Storage | undefined,
  setting: VideoPlayerSetting,
): boolean {
  if (storage === undefined) {
    return false
  }

  try {
    storage.setItem(VIDEO_PLAYER_SETTING_KEY, JSON.stringify(setting))
    return true
  } catch {
    return false
  }
}

export function resolveSubtitleRendererContract({
  sourceKind,
  streamingType,
  isForceEnableSubtitleStroke,
  isShowSubtitle,
  hasSubtitleTrack = false,
}: {
  sourceKind: PlaybackMediaSource['sourceKind'] | undefined
  streamingType?: PlaybackStreamingType
  isForceEnableSubtitleStroke: boolean
  isShowSubtitle: boolean
  hasSubtitleTrack?: boolean
}): SubtitleRendererContract {
  const rendererMounted =
    sourceKind === 'hls-stream' || streamingType === 'hls' || streamingType === 'm2tsll'

  if (!rendererMounted) {
    return {
      rendererMounted: false,
      rendererKind: 'none',
      strokeEnabled: false,
      isShowSubtitle: false,
      hasSubtitleTrack,
    }
  }

  return {
    rendererMounted: true,
    rendererKind: 'aribb24',
    strokeEnabled: isForceEnableSubtitleStroke,
    isShowSubtitle,
    hasSubtitleTrack,
  }
}
