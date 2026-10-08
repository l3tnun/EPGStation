import type { KeyboardEvent } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePlaybackVideoEvents } from '@/features/video/playback/hooks/usePlaybackVideoEvents'

function makeKeyboardEvent(
  key: string,
  target: EventTarget = document.createElement('div'),
  currentTarget: EventTarget = target,
): KeyboardEvent<HTMLElement> {
  return {
    key,
    target,
    currentTarget,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLElement>
}

function setup(
  overrides: {
    areControlsBlocked?: boolean
    areControlsSuppressed?: boolean
    suppressCanPlayControlsVisible?: boolean
    shouldClearLoadingOnPlaybackEvent?: boolean
    isPaused?: boolean
  } = {},
) {
  const media = {
    setIsMediaElementLoading: vi.fn(),
    setHasMediaReachedCanPlay: vi.fn(),
    isPausedRef: { current: overrides.isPaused ?? true },
    areControlsWaitingForCanPlay: false,
    handleDurationChange: vi.fn(),
    handleVolumeChange: vi.fn(),
    setIsPaused: vi.fn(),
    markPlaying: vi.fn(),
    togglePlay: vi.fn(),
    toggleMute: vi.fn(),
  }
  const controls = {
    setControlsVisible: vi.fn(),
    setIsCursorHidden: vi.fn(),
    clearControlsHideTimer: vi.fn(),
    scheduleControlsHide: vi.fn(),
  }
  const subtitles = {
    updateSubtitleTrackAvailability: vi.fn(),
  }
  const seek = {
    handleSeeking: vi.fn(),
    handleTimeUpdate: vi.fn(),
    seekBy: vi.fn(),
  }
  const fullscreen = {
    toggleFullscreen: vi.fn(),
    refreshPictureInPictureSupport: vi.fn(),
  }

  const { result } = renderHook(() =>
    usePlaybackVideoEvents({
      media: media as never,
      controls: controls as never,
      subtitles: subtitles as never,
      seek: seek as never,
      fullscreen: fullscreen as never,
      areControlsBlocked: overrides.areControlsBlocked ?? false,
      areControlsSuppressed: overrides.areControlsSuppressed ?? false,
      suppressCanPlayControlsVisible: overrides.suppressCanPlayControlsVisible ?? false,
      shouldClearLoadingOnPlaybackEvent: overrides.shouldClearLoadingOnPlaybackEvent ?? true,
    }),
  )

  return { result, media, controls, subtitles, seek, fullscreen }
}

describe('usePlaybackVideoEvents contract', () => {
  it('reveals controls on canplay while paused and not suppressed', () => {
    const { result, controls } = setup({ isPaused: true })

    act(() => {
      result.current.videoEvents.onCanPlay()
    })

    expect(controls.setControlsVisible).toHaveBeenCalledWith(true)
    expect(controls.setIsCursorHidden).toHaveBeenCalledWith(false)
  })

  it('does not reveal controls on canplay while playing', () => {
    const { result, controls } = setup({ isPaused: false })

    act(() => {
      result.current.videoEvents.onCanPlay()
    })

    expect(controls.setControlsVisible).not.toHaveBeenCalled()
  })

  it('does not reveal controls on canplay while controls are suppressed', () => {
    const { result, controls } = setup({ isPaused: true, areControlsSuppressed: true })

    act(() => {
      result.current.videoEvents.onCanPlay()
    })

    expect(controls.setControlsVisible).not.toHaveBeenCalled()
  })

  it('does not reveal controls on canplay while narrow-viewport canplay visibility is suppressed', () => {
    const { result, controls } = setup({ isPaused: true, suppressCanPlayControlsVisible: true })

    act(() => {
      result.current.videoEvents.onCanPlay()
    })

    expect(controls.setControlsVisible).not.toHaveBeenCalled()
  })

  it('clears loading and updates duration on durationchange', () => {
    const { result, media } = setup()

    act(() => {
      result.current.videoEvents.onDurationChange()
    })

    expect(media.setIsMediaElementLoading).toHaveBeenCalledWith(false)
    expect(media.handleDurationChange).toHaveBeenCalled()
  })

  it('does not clear loading on durationchange when the m2tsll gate suppresses it', () => {
    const { result, media } = setup({ shouldClearLoadingOnPlaybackEvent: false })

    act(() => {
      result.current.videoEvents.onDurationChange()
    })

    expect(media.setIsMediaElementLoading).not.toHaveBeenCalled()
    expect(media.handleDurationChange).toHaveBeenCalled()
  })

  it('[AC 3.5] keeps the canplay-gate loading state on a media error without adding an overlay', () => {
    const { result, media } = setup()

    act(() => {
      result.current.videoEvents.onError()
    })

    expect(media.setIsMediaElementLoading).toHaveBeenCalledWith(media.areControlsWaitingForCanPlay)
  })

  it('clears loading on loadeddata', () => {
    const { result, media } = setup()

    act(() => {
      result.current.videoEvents.onLoadedData()
    })

    expect(media.setIsMediaElementLoading).toHaveBeenCalledWith(false)
  })

  it('[AC 4.12] [AC 4.13a] clears loading, refreshes subtitle track availability, and re-evaluates Picture-in-Picture support on loadedmetadata', () => {
    const { result, media, subtitles, fullscreen } = setup()

    act(() => {
      result.current.videoEvents.onLoadedMetadata()
    })

    expect(media.setIsMediaElementLoading).toHaveBeenCalledWith(false)
    expect(subtitles.updateSubtitleTrackAvailability).toHaveBeenCalled()
    expect(fullscreen.refreshPictureInPictureSupport).toHaveBeenCalled()
  })

  it('[AC 4.13a] re-evaluates Picture-in-Picture support on emptied and loadstart (media source replaced)', () => {
    const { result, fullscreen } = setup()

    act(() => {
      result.current.videoEvents.onEmptied()
    })
    expect(fullscreen.refreshPictureInPictureSupport).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.videoEvents.onLoadStart()
    })
    expect(fullscreen.refreshPictureInPictureSupport).toHaveBeenCalledTimes(2)
  })

  it('[AC 4.16] hides controls and cursor on pause unless controls are blocked', () => {
    const { result, controls, media } = setup({ areControlsBlocked: false })

    act(() => {
      result.current.videoEvents.onPause()
    })

    expect(controls.clearControlsHideTimer).toHaveBeenCalled()
    expect(media.setIsPaused).toHaveBeenCalledWith(true)
    expect(controls.setControlsVisible).toHaveBeenCalledWith(true)
    expect(controls.setIsCursorHidden).toHaveBeenCalledWith(false)
  })

  it('keeps controls hidden on pause while controls are blocked', () => {
    const { result, controls } = setup({ areControlsBlocked: true })

    act(() => {
      result.current.videoEvents.onPause()
    })

    expect(controls.setControlsVisible).toHaveBeenCalledWith(false)
  })

  it('[AC 4.16] marks playing, clears loading, and force-schedules the controls hide timer on play', () => {
    const { result, media, controls } = setup()

    act(() => {
      result.current.videoEvents.onPlay()
    })

    expect(media.markPlaying).toHaveBeenCalled()
    expect(media.setIsMediaElementLoading).toHaveBeenCalledWith(false)
    expect(controls.scheduleControlsHide).toHaveBeenCalledWith({ force: true })
  })

  it('clears loading on playing', () => {
    const { result, media } = setup()

    act(() => {
      result.current.videoEvents.onPlaying()
    })

    expect(media.setIsMediaElementLoading).toHaveBeenCalledWith(false)
  })

  it('delegates seeking/timeupdate/volumechange to the seek and media hooks', () => {
    const { result, seek, media } = setup()

    act(() => {
      result.current.videoEvents.onSeeking()
      result.current.videoEvents.onTimeUpdate()
      result.current.videoEvents.onVolumeChange()
    })

    expect(seek.handleSeeking).toHaveBeenCalled()
    expect(seek.handleTimeUpdate).toHaveBeenCalled()
    expect(media.handleVolumeChange).toHaveBeenCalled()
  })

  it('[AC 4.16a] does not propagate a keydown from an interactive control target', () => {
    const { result, media } = setup()
    const wrap = document.createElement('div')
    const button = document.createElement('button')
    wrap.appendChild(button)

    act(() => {
      result.current.handleKeyDown(makeKeyboardEvent(' ', button, wrap))
    })

    expect(media.togglePlay).not.toHaveBeenCalled()
  })

  it('[AC 3.6] toggles play on space or k without a snackbar', () => {
    const { result, media } = setup()

    act(() => {
      result.current.handleKeyDown(makeKeyboardEvent(' '))
    })
    act(() => {
      result.current.handleKeyDown(makeKeyboardEvent('k'))
    })

    expect(media.togglePlay).toHaveBeenCalledTimes(2)
  })

  it('[AC 3.6] seeks by +/-10s on the arrow keys', () => {
    const { result, seek } = setup()

    act(() => {
      result.current.handleKeyDown(makeKeyboardEvent('ArrowLeft'))
    })
    act(() => {
      result.current.handleKeyDown(makeKeyboardEvent('ArrowRight'))
    })

    expect(seek.seekBy).toHaveBeenNthCalledWith(1, -10)
    expect(seek.seekBy).toHaveBeenNthCalledWith(2, 10)
  })

  it('[AC 3.6] toggles mute on m', () => {
    const { result, media } = setup()

    act(() => {
      result.current.handleKeyDown(makeKeyboardEvent('m'))
    })

    expect(media.toggleMute).toHaveBeenCalled()
  })

  it('[AC 3.6] toggles fullscreen on f', () => {
    const { result, fullscreen } = setup()

    act(() => {
      result.current.handleKeyDown(makeKeyboardEvent('f'))
    })

    expect(fullscreen.toggleFullscreen).toHaveBeenCalled()
  })

  it('ignores an unrecognized keydown', () => {
    const { result, media, seek, fullscreen } = setup()

    act(() => {
      result.current.handleKeyDown(makeKeyboardEvent('a'))
    })

    expect(media.togglePlay).not.toHaveBeenCalled()
    expect(media.toggleMute).not.toHaveBeenCalled()
    expect(seek.seekBy).not.toHaveBeenCalled()
    expect(fullscreen.toggleFullscreen).not.toHaveBeenCalled()
  })
})
