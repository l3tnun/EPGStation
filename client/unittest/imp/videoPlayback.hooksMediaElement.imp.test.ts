import type { MutableRefObject } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlaybackMediaElement } from '@/features/video/playback/hooks/usePlaybackMediaElement'

function ref<T>(value: T): MutableRefObject<T> {
  return { current: value }
}

function makeVideo({ duration = NaN }: { duration?: number } = {}): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'duration', { configurable: true, value: duration })
  Object.defineProperty(video, 'playbackRate', { configurable: true, value: 1, writable: true })
  Object.defineProperty(video, 'muted', { configurable: true, value: false, writable: true })
  Object.defineProperty(video, 'volume', { configurable: true, value: 1, writable: true })

  return video
}

function setup(
  overrides: {
    videoRef?: MutableRefObject<HTMLVideoElement | null>
    kind?: string
    isInProgressRecording?: boolean
    hideControlsUntilCanPlay?: boolean
    effectiveMediaUrl?: string
    lifecycleState?: string
    recordedStreamDuration?: number
  } = {},
) {
  const videoRef = overrides.videoRef ?? ref<HTMLVideoElement | null>(null)
  const { result, rerender } = renderHook(
    (props: { effectiveMediaUrl?: string }) =>
      usePlaybackMediaElement({
        kind: overrides.kind ?? 'live',
        videoRef,
        isInProgressRecording: overrides.isInProgressRecording ?? false,
        hideControlsUntilCanPlay: overrides.hideControlsUntilCanPlay ?? false,
        effectiveMediaUrl: props.effectiveMediaUrl,
        lifecycleState: (overrides.lifecycleState as never) ?? 'idle',
        recordedStreamDuration: overrides.recordedStreamDuration,
      }),
    { initialProps: { effectiveMediaUrl: overrides.effectiveMediaUrl } },
  )

  return { result, rerender, videoRef }
}

describe('usePlaybackMediaElement contract', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('togglePlay does nothing without a mounted video element', () => {
    const { result } = setup()

    expect(() => {
      act(() => {
        result.current.togglePlay()
      })
    }).not.toThrow()
  })

  it('togglePlay calls video.pause() when currently playing', () => {
    const video = makeVideo()
    const pause = vi.fn()
    Object.defineProperty(video, 'pause', { configurable: true, value: pause })
    const { result } = setup({ videoRef: ref(video) })

    act(() => {
      result.current.markPlaying()
    })
    act(() => {
      result.current.togglePlay()
    })

    expect(pause).toHaveBeenCalled()
  })

  it('logs (does not throw) when video.play() rejects via togglePlay', async () => {
    const video = makeVideo()
    const play = vi.fn(async () => {
      throw new Error('synthetic play failure')
    })
    Object.defineProperty(video, 'play', { configurable: true, value: play })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { result } = setup({ videoRef: ref(video) })

    await act(async () => {
      result.current.togglePlay()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(play).toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('video.play() failed', expect.any(Error))
  })

  it('sets the playback rate on the video element and clamps it to the supported range', () => {
    const video = makeVideo()
    const { result } = setup({ videoRef: ref(video) })

    // The range is 0.1x to 10x. v2 `components/video/VideoContainer.vue:684-690`
    // (`changePlaybackRate`) rejects anything below 0.1 and has no upper bound at all, so there is
    // no v2 value to inherit for the top of the range; 10x is the decided contract.
    act(() => {
      result.current.setVideoPlaybackRate(10)
    })
    expect(video.playbackRate).toBe(10)
    expect(result.current.playbackRate).toBe(10)

    act(() => {
      result.current.setVideoPlaybackRate(10.1)
    })
    expect(video.playbackRate).toBe(10)

    act(() => {
      result.current.setVideoPlaybackRate(25)
    })
    expect(video.playbackRate).toBe(10)

    act(() => {
      result.current.setVideoPlaybackRate(0)
    })
    expect(video.playbackRate).toBe(0.1)

    act(() => {
      result.current.setVideoPlaybackRate(0.09)
    })
    expect(video.playbackRate).toBe(0.1)
  })

  it('updates the playback rate state without a mounted video element', () => {
    const { result } = setup()

    act(() => {
      result.current.setVideoPlaybackRate(2)
    })

    expect(result.current.playbackRate).toBe(2)
  })

  it('toggles mute on the video element', () => {
    const video = makeVideo()
    const { result } = setup({ videoRef: ref(video) })

    act(() => {
      result.current.toggleMute()
    })
    expect(video.muted).toBe(true)
    expect(result.current.muted).toBe(true)
  })

  it('toggles mute state without a mounted video element', () => {
    const { result } = setup()

    act(() => {
      result.current.toggleMute()
    })

    expect(result.current.muted).toBe(true)
  })

  it('sets volume and un-mutes the video element from a finite input', () => {
    const video = makeVideo()
    const { result } = setup({ videoRef: ref(video) })

    act(() => {
      result.current.setVolumeFromInput(0.5)
    })

    expect(video.volume).toBe(0.5)
    expect(video.muted).toBe(false)
    expect(result.current.volume).toBe(0.5)
  })

  it('resets volume to zero for a non-finite input without touching the video element', () => {
    const video = makeVideo()
    Object.defineProperty(video, 'volume', { configurable: true, value: 0.8, writable: true })
    const { result } = setup({ videoRef: ref(video) })

    act(() => {
      result.current.setVolumeFromInput(Number.NaN)
    })

    expect(video.volume).toBe(0.8)
    expect(result.current.volume).toBe(0)
    expect(result.current.muted).toBe(false)
  })

  it('sets volume state from input without a mounted video element', () => {
    const { result } = setup()

    act(() => {
      result.current.setVolumeFromInput(0.3)
    })

    expect(result.current.volume).toBe(0.3)
  })

  it('ignores a durationchange event without a mounted video element', () => {
    const { result } = setup()

    expect(() => {
      act(() => {
        result.current.handleDurationChange()
      })
    }).not.toThrow()
    expect(result.current.duration).toBe(0)
  })

  it('resets duration to zero when the video reports a non-finite or non-positive duration', () => {
    const video = makeVideo({ duration: -1 })
    const { result } = setup({ videoRef: ref(video) })

    act(() => {
      result.current.handleDurationChange()
    })

    expect(result.current.duration).toBe(0)
  })

  it('adopts a finite positive duration from the video element', () => {
    const video = makeVideo({ duration: 42 })
    const { result } = setup({ videoRef: ref(video) })

    act(() => {
      result.current.handleDurationChange()
    })

    expect(result.current.duration).toBe(42)
  })

  it('ignores a volumechange event without a mounted video element', () => {
    const { result } = setup()

    expect(() => {
      act(() => {
        result.current.handleVolumeChange()
      })
    }).not.toThrow()
  })

  it('syncs volume/muted state from a volumechange event', () => {
    const video = makeVideo()
    Object.defineProperty(video, 'volume', { configurable: true, value: 0.25, writable: true })
    Object.defineProperty(video, 'muted', { configurable: true, value: true, writable: true })
    const { result } = setup({ videoRef: ref(video) })

    act(() => {
      result.current.handleVolumeChange()
    })

    expect(result.current.volume).toBe(0.25)
    expect(result.current.muted).toBe(true)
  })

  it('[AC 3.3] resumes autoplay with the preserved playback rate after a seek restart when it was not paused', async () => {
    const video = makeVideo()
    const play = vi.fn(async () => undefined)
    Object.defineProperty(video, 'play', { configurable: true, value: play })
    const { result, rerender } = setup({ videoRef: ref(video), effectiveMediaUrl: undefined })

    act(() => {
      result.current.resumeAfterRestartRef.current = { playbackRate: 1.75, wasPaused: false }
    })

    await act(async () => {
      rerender({ effectiveMediaUrl: './api/streams/recorded/1/webm?mode=0&ss=10' })
      await Promise.resolve()
    })

    expect(video.playbackRate).toBe(1.75)
    expect(play).toHaveBeenCalled()
    expect(result.current.resumeAfterRestartRef.current).toBeNull()
  })

  it('silently ignores a rejected autoplay resume after a seek restart', async () => {
    const video = makeVideo()
    const play = vi.fn(async () => {
      throw new Error('synthetic resume play failure')
    })
    Object.defineProperty(video, 'play', { configurable: true, value: play })
    const { result, rerender } = setup({ videoRef: ref(video), effectiveMediaUrl: undefined })

    act(() => {
      result.current.resumeAfterRestartRef.current = { playbackRate: 1, wasPaused: false }
    })

    await act(async () => {
      rerender({ effectiveMediaUrl: './api/streams/recorded/1/webm?mode=0&ss=10' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(play).toHaveBeenCalled()
  })

  it('[AC 3.3] restores the playback rate without autoplaying after a seek restart when it was paused', () => {
    const video = makeVideo()
    const play = vi.fn(async () => undefined)
    Object.defineProperty(video, 'play', { configurable: true, value: play })
    const { result, rerender } = setup({ videoRef: ref(video), effectiveMediaUrl: undefined })

    act(() => {
      result.current.resumeAfterRestartRef.current = { playbackRate: 1.25, wasPaused: true }
    })

    act(() => {
      rerender({ effectiveMediaUrl: './api/streams/recorded/1/webm?mode=0&ss=10' })
    })

    expect(video.playbackRate).toBe(1.25)
    expect(play).not.toHaveBeenCalled()
  })
})
