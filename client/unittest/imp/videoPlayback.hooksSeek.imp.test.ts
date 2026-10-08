import type { MutableRefObject } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  usePlaybackSeek,
  type ResumeAfterRestart,
} from '@/features/video/playback/hooks/usePlaybackSeek'

function ref<T>(value: T): MutableRefObject<T> {
  return { current: value }
}

function makeVideo({
  currentTime = 0,
  duration = NaN,
  playbackRate = 1,
}: { currentTime?: number; duration?: number; playbackRate?: number } = {}): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    value: currentTime,
    writable: true,
  })
  Object.defineProperty(video, 'duration', { configurable: true, value: duration })
  Object.defineProperty(video, 'playbackRate', {
    configurable: true,
    value: playbackRate,
    writable: true,
  })

  return video
}

function setup(
  overrides: {
    videoRef?: MutableRefObject<HTMLVideoElement | null>
    isPausedRef?: MutableRefObject<boolean>
    kind?: string
    canSeek?: boolean
    activeBaseSeekSeconds?: number
    activePlaybackStartUrl?: string
    duration?: number
    effectiveDuration?: number
    currentTime?: number
  } = {},
) {
  const videoRef = overrides.videoRef ?? ref<HTMLVideoElement | null>(null)
  const isPausedRef = overrides.isPausedRef ?? ref(false)
  const resumeAfterRestartRef = ref<ResumeAfterRestart | null>(null)
  const setCurrentTime = vi.fn()
  const restartPlaybackAt = vi.fn()

  const { result, rerender } = renderHook(
    (props: { currentTime: number; duration: number; effectiveDuration: number }) =>
      usePlaybackSeek({
        kind: overrides.kind ?? 'live',
        videoRef,
        isPausedRef,
        resumeAfterRestartRef,
        currentTime: props.currentTime,
        setCurrentTime,
        duration: props.duration,
        effectiveDuration: props.effectiveDuration,
        canSeek: overrides.canSeek ?? true,
        activeBaseSeekSeconds: overrides.activeBaseSeekSeconds ?? 0,
        activePlaybackStartUrl: overrides.activePlaybackStartUrl,
        restartPlaybackAt,
      }),
    {
      initialProps: {
        currentTime: overrides.currentTime ?? 0,
        duration: overrides.duration ?? 100,
        effectiveDuration: overrides.effectiveDuration ?? 100,
      },
    },
  )

  return {
    result,
    rerender,
    videoRef,
    isPausedRef,
    resumeAfterRestartRef,
    setCurrentTime,
    restartPlaybackAt,
  }
}

describe('usePlaybackSeek seekBy contract', () => {
  it('seekBy does nothing without a mounted video element', () => {
    const { result, setCurrentTime } = setup()

    act(() => {
      result.current.seekBy(10)
    })

    // No video and canSeek defaults true, but seekBy short-circuits without a video.
    expect(setCurrentTime).not.toHaveBeenCalled()
  })

  it('does nothing when seeking is not allowed', () => {
    const video = makeVideo()
    const { result, setCurrentTime } = setup({ videoRef: ref(video), canSeek: false })

    act(() => {
      result.current.seekBy(10)
    })

    expect(setCurrentTime).not.toHaveBeenCalled()
  })

  it('[AC 4.14] seeks a direct (non recorded-streaming) video by setting currentTime absolutely', () => {
    const video = makeVideo({ currentTime: 5 })
    const { result, setCurrentTime } = setup({ videoRef: ref(video), kind: 'live' })

    act(() => {
      result.current.seekBy(10)
    })

    expect(video.currentTime).toBe(10)
    expect(setCurrentTime).toHaveBeenCalledWith(10)
  })

  it('[AC 5.3] seeks within the current recorded-streaming segment relative to the segment start', () => {
    const video = makeVideo({ currentTime: 5, duration: 60 })
    const { result } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 100,
      activePlaybackStartUrl: './api/streams/recorded/1/webm?mode=0&ss=100',
      currentTime: 105,
      effectiveDuration: 500,
    })

    act(() => {
      result.current.seekBy(10)
    })

    // absolute target 115, minus the 100s base = 15s relative to the loaded segment
    expect(video.currentTime).toBe(15)
  })

  it('[AC 5.3] keeps the absolute time without restarting when there is no active playback start URL', () => {
    const video = makeVideo({ currentTime: 5, duration: 60 })
    const { result, restartPlaybackAt, setCurrentTime } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 100,
      activePlaybackStartUrl: undefined,
      currentTime: 5,
      duration: 60,
      effectiveDuration: 500,
    })

    act(() => {
      result.current.seekBy(400)
    })

    expect(restartPlaybackAt).not.toHaveBeenCalled()
    expect(setCurrentTime).toHaveBeenCalledWith(405)
  })

  it('[AC 5.3] restarts playback with a rebuilt URL and preserves rate/paused state for an out-of-segment seek', () => {
    const video = makeVideo({ currentTime: 5, duration: 60, playbackRate: 1.5 })
    const isPausedRef = ref(true)
    const { result, restartPlaybackAt, resumeAfterRestartRef } = setup({
      videoRef: ref(video),
      isPausedRef,
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 100,
      activePlaybackStartUrl: './api/streams/recorded/1/webm?mode=0&ss=100',
      currentTime: 5,
      duration: 60,
      effectiveDuration: 500,
    })

    act(() => {
      result.current.seekBy(400)
    })

    expect(restartPlaybackAt).toHaveBeenCalledWith('./api/streams/recorded/1/webm?mode=0&ss=405')
    expect(resumeAfterRestartRef.current).toStrictEqual({ playbackRate: 1.5, wasPaused: true })
  })

  it('clamps a negative/non-finite seek target to zero', () => {
    const video = makeVideo({ currentTime: 5 })
    const { result } = setup({ videoRef: ref(video), kind: 'live', canSeek: true })

    act(() => {
      // deltaSeconds pushes currentTime below zero; clampPlaybackSeek clamps it to 0.
      result.current.seekBy(-1000)
    })

    expect(video.currentTime).toBe(0)
  })

  it('falls back to the effective duration when the loaded segment duration is unavailable', () => {
    const video = makeVideo({ currentTime: 5, duration: NaN })
    const { result } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 0,
      activePlaybackStartUrl: './api/streams/recorded/1/webm?mode=0&ss=0',
      currentTime: 5,
      duration: 60,
      effectiveDuration: 60,
    })

    act(() => {
      result.current.seekBy(10)
    })

    expect(video.currentTime).toBe(15)
  })
})
