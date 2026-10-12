import type { KeyboardEvent } from 'react'
import { isInteractiveShortcutTarget } from '../lib/playbackShellSupport'
import type { usePlaybackControlsVisibility } from './usePlaybackControlsVisibility'
import type { usePlaybackFullscreen } from './usePlaybackFullscreen'
import type { usePlaybackMediaElement } from './usePlaybackMediaElement'
import type { usePlaybackSeek } from './usePlaybackSeek'
import type { usePlaybackSubtitles } from './usePlaybackSubtitles'

export interface PlaybackVideoEventsInput {
  media: ReturnType<typeof usePlaybackMediaElement>
  controls: ReturnType<typeof usePlaybackControlsVisibility>
  subtitles: ReturnType<typeof usePlaybackSubtitles>
  seek: ReturnType<typeof usePlaybackSeek>
  fullscreen: ReturnType<typeof usePlaybackFullscreen>
  areControlsBlocked: boolean
  areControlsSuppressed: boolean
  suppressCanPlayControlsVisible: boolean
  shouldClearLoadingOnPlaybackEvent: boolean
}

export function usePlaybackVideoEvents({
  media,
  controls,
  subtitles,
  seek,
  fullscreen,
  areControlsBlocked,
  areControlsSuppressed,
  suppressCanPlayControlsVisible,
  shouldClearLoadingOnPlaybackEvent,
}: PlaybackVideoEventsInput) {
  const clearLoadingOnPlaybackEvent = () => {
    if (shouldClearLoadingOnPlaybackEvent) {
      media.setIsMediaElementLoading(false)
    }
  }

  const videoEvents = {
    onCanPlay: () => {
      media.setIsMediaElementLoading(false)
      media.setHasMediaReachedCanPlay(true)
      if (media.isPausedRef.current && !areControlsSuppressed && !suppressCanPlayControlsVisible) {
        controls.setControlsVisible(true)
        controls.setIsCursorHidden(false)
      }
    },
    onDurationChange: () => {
      clearLoadingOnPlaybackEvent()
      media.handleDurationChange()
    },
    onError: () => {
      media.setIsMediaElementLoading(media.areControlsWaitingForCanPlay)
    },
    onEmptied: () => fullscreen.refreshPictureInPictureSupport(),
    onLoadedData: () => media.setIsMediaElementLoading(false),
    onLoadedMetadata: () => {
      clearLoadingOnPlaybackEvent()
      subtitles.updateSubtitleTrackAvailability()
      // WebKit's webkitSupportsPresentationMode('picture-in-picture') only answers correctly
      // once metadata has loaded -- see requirements.md 13a and playbackShellSupport.ts.
      fullscreen.refreshPictureInPictureSupport()
    },
    onLoadStart: () => fullscreen.refreshPictureInPictureSupport(),
    onPause: () => {
      controls.clearControlsHideTimer()
      media.setIsPaused(true)
      controls.setControlsVisible(!areControlsBlocked)
      controls.setIsCursorHidden(false)
    },
    onPlay: () => {
      media.markPlaying()
      clearLoadingOnPlaybackEvent()
      controls.scheduleControlsHide({ force: true })
    },
    onPlaying: clearLoadingOnPlaybackEvent,
    onSeeking: seek.handleSeeking,
    onTimeUpdate: seek.handleTimeUpdate,
    onVolumeChange: media.handleVolumeChange,
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget && isInteractiveShortcutTarget(event.target)) {
      return
    }
    const key = event.key.toLowerCase()
    if (event.key === ' ' || key === 'k') {
      event.preventDefault()
      media.togglePlay()
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      seek.seekBy(event.key === 'ArrowLeft' ? -10 : 10)
      return
    }
    if (key === 'm') {
      event.preventDefault()
      media.toggleMute()
      return
    }
    if (key === 'f') {
      event.preventDefault()
      fullscreen.toggleFullscreen()
    }
  }

  return { videoEvents, handleKeyDown }
}
