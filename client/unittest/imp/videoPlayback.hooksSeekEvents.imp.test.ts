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
    activeBaseSeekSeconds?: number
    activePlaybackStartUrl?: string
  } = {},
) {
  const videoRef = overrides.videoRef ?? ref<HTMLVideoElement | null>(null)
  const isPausedRef = overrides.isPausedRef ?? ref(false)
  const resumeAfterRestartRef = ref<ResumeAfterRestart | null>(null)
  const setCurrentTime = vi.fn()
  const restartPlaybackAt = vi.fn()

  const { result } = renderHook(() =>
    usePlaybackSeek({
      kind: overrides.kind ?? 'live',
      videoRef,
      isPausedRef,
      resumeAfterRestartRef,
      currentTime: 0,
      setCurrentTime,
      duration: 100,
      effectiveDuration: 100,
      canSeek: true,
      activeBaseSeekSeconds: overrides.activeBaseSeekSeconds ?? 0,
      activePlaybackStartUrl: overrides.activePlaybackStartUrl,
      restartPlaybackAt,
    }),
  )

  return { result, videoRef, setCurrentTime, restartPlaybackAt }
}

describe('usePlaybackSeek handleSeeking/handleTimeUpdate contract', () => {
  it('[AC 5.4] does nothing on a seeking event without a mounted video element', () => {
    const { result } = setup()

    expect(() => {
      act(() => {
        result.current.handleSeeking()
      })
    }).not.toThrow()
  })

  it('[AC 5.4] does nothing on a seeking event when the video has no known duration yet', () => {
    const video = makeVideo({ duration: NaN })
    const { result, restartPlaybackAt } = setup({ videoRef: ref(video) })

    act(() => {
      result.current.handleSeeking()
    })

    expect(restartPlaybackAt).not.toHaveBeenCalled()
  })

  it('[AC 5.4] does nothing on a seeking event with no active playback start URL', () => {
    const video = makeVideo({ duration: 60, currentTime: 500 })
    const { result, restartPlaybackAt } = setup({
      videoRef: ref(video),
      activePlaybackStartUrl: undefined,
    })

    act(() => {
      result.current.handleSeeking()
    })

    expect(restartPlaybackAt).not.toHaveBeenCalled()
  })

  it('[AC 5.4] ignores a seeking event whose target time is still within the loaded segment', () => {
    const video = makeVideo({ duration: 60, currentTime: 30 })
    const { result, restartPlaybackAt } = setup({
      videoRef: ref(video),
      activePlaybackStartUrl: './api/streams/recorded/1/hls?mode=0&ss=0',
    })

    act(() => {
      result.current.handleSeeking()
    })

    expect(restartPlaybackAt).not.toHaveBeenCalled()
  })

  it('[AC 5.4] restarts the HLS lifecycle with an absolute ss when seeking outside the loaded segment', () => {
    const video = makeVideo({ duration: 60, currentTime: -5, playbackRate: 2 })
    const isPausedRef = ref(false)
    const { result, restartPlaybackAt } = setup({
      videoRef: ref(video),
      isPausedRef,
      activePlaybackStartUrl: './api/streams/recorded/1/hls?mode=0&ss=100',
    })

    act(() => {
      result.current.handleSeeking()
    })

    expect(restartPlaybackAt).toHaveBeenCalledWith('./api/streams/recorded/1/hls?mode=0&ss=95')
  })

  it('does nothing on a time update without a mounted video element', () => {
    const { result, setCurrentTime } = setup()

    act(() => {
      result.current.handleTimeUpdate()
    })

    expect(setCurrentTime).not.toHaveBeenCalled()
  })

  it('ignores a time update while a seek bar preview is pending', () => {
    const video = makeVideo({ currentTime: 42 })
    const { result, setCurrentTime } = setup({ videoRef: ref(video) })
    const input = document.createElement('input')
    result.current.rangeSeekElementRef.current = input

    act(() => {
      result.current.previewSeekBarTime(10)
    })
    setCurrentTime.mockClear()

    act(() => {
      result.current.handleTimeUpdate()
    })

    expect(setCurrentTime).not.toHaveBeenCalled()
  })

  it('clamps a negative/non-finite currentTime to zero on a time update', () => {
    const video = makeVideo({ currentTime: -3 })
    const { result, setCurrentTime } = setup({ videoRef: ref(video), kind: 'live' })

    act(() => {
      result.current.handleTimeUpdate()
    })

    expect(setCurrentTime).toHaveBeenCalledWith(0)
  })

  it('[AC 5.6] adds the segment base offset to the relative time for recorded streaming', () => {
    const video = makeVideo({ currentTime: 12 })
    const { result, setCurrentTime } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 300,
    })

    act(() => {
      result.current.handleTimeUpdate()
    })

    expect(setCurrentTime).toHaveBeenCalledWith(312)
  })
})
