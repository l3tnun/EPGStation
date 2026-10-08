export interface PlaybackControlVisibilityInput {
  duration: number
  currentTime?: number
  /**
   * True while the stream being played is live (any live stream type). Live playback never
   * exposes fast seek / speed controls or an enabled seek bar, even if the media element reports
   * a finite, positive `duration` (browsers are not guaranteed to keep a live stream's reported
   * duration at `0`/`Infinity`).
   */
  isLive?: boolean
  viewportWidth: number
  isMobilePlatform: boolean
  canLockOrientation: boolean
  isPictureInPictureEnabled: boolean
  hasSubtitleTrack: boolean
}

export interface PlaybackControlVisibility {
  canSeek: boolean
  showSeekBar: boolean
  showFastSeekControls: boolean
  showSpeedControls: boolean
  showBottomPlayButton: boolean
  showVolumeSlider: boolean
  showSubtitleButton: boolean
  showPictureInPictureButton: boolean
  showRotationButton: boolean
  timeDisplay: string
}

export function formatPlaybackTime(seconds: number): string {
  const normalized = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const hours = Math.floor(normalized / 3600)
  const minutes = Math.floor((normalized % 3600) / 60)
  const remainingSeconds = normalized % 60

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
      remainingSeconds,
    ).padStart(2, '0')}`
  }

  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

export function resolvePlaybackControlVisibility({
  duration,
  currentTime = 0,
  isLive = false,
  viewportWidth,
  isMobilePlatform,
  canLockOrientation,
  isPictureInPictureEnabled,
  hasSubtitleTrack,
}: PlaybackControlVisibilityInput): PlaybackControlVisibility {
  const hasKnownDuration = !isLive && Number.isFinite(duration) && duration > 0
  const isNarrowViewport = viewportWidth <= 420

  return {
    canSeek: hasKnownDuration,
    showSeekBar: true,
    showFastSeekControls: hasKnownDuration,
    showSpeedControls: hasKnownDuration && !isNarrowViewport,
    showBottomPlayButton: !isNarrowViewport,
    showVolumeSlider: !isMobilePlatform && !isNarrowViewport,
    showSubtitleButton: hasSubtitleTrack,
    showPictureInPictureButton: isPictureInPictureEnabled,
    showRotationButton: isMobilePlatform && canLockOrientation,
    timeDisplay: hasKnownDuration
      ? `${formatPlaybackTime(currentTime)}/${formatPlaybackTime(duration)}`
      : '--:--/--:--',
  }
}

export function resolveVolumeControlLabel({
  volume,
  muted,
}: {
  volume: number
  muted: boolean
}): 'VOL+' | 'VOL~' | 'MUTE' {
  if (muted || volume <= 0) {
    return 'MUTE'
  }

  return volume <= 0.4 ? 'VOL~' : 'VOL+'
}

export function resolveVolumeControlIcon({
  volume,
  muted,
}: {
  volume: number
  muted: boolean
}): 'volume-off' | 'volume-medium' | 'volume-high' {
  const label = resolveVolumeControlLabel({ volume, muted })

  if (label === 'MUTE') {
    return 'volume-off'
  }

  return label === 'VOL~' ? 'volume-medium' : 'volume-high'
}

export function clampPlaybackSeek({
  currentTime,
  deltaSeconds,
  duration,
}: {
  currentTime: number
  deltaSeconds: number
  duration: number
}): number {
  if (!Number.isFinite(duration) || duration <= 0) {
    return 0
  }

  return Math.min(duration, Math.max(0, currentTime + deltaSeconds))
}
