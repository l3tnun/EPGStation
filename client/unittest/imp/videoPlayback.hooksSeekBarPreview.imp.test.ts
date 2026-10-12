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
}: { currentTime?: number; duration?: number } = {}): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    value: currentTime,
    writable: true,
  })
  Object.defineProperty(video, 'duration', { configurable: true, value: duration })

  return video
}

function setup(
  overrides: {
    videoRef?: MutableRefObject<HTMLVideoElement | null>
  } = {},
) {
  const videoRef = overrides.videoRef ?? ref<HTMLVideoElement | null>(null)
  const isPausedRef = ref(false)
  const resumeAfterRestartRef = ref<ResumeAfterRestart | null>(null)
  const setCurrentTime = vi.fn()
  const restartPlaybackAt = vi.fn()

  const { result } = renderHook(() =>
    usePlaybackSeek({
      kind: 'live',
      videoRef,
      isPausedRef,
      resumeAfterRestartRef,
      currentTime: 0,
      setCurrentTime,
      duration: 100,
      effectiveDuration: 100,
      canSeek: true,
      activeBaseSeekSeconds: 0,
      activePlaybackStartUrl: undefined,
      restartPlaybackAt,
    }),
  )

  return { result, videoRef, setCurrentTime, restartPlaybackAt }
}

describe('usePlaybackSeek seek bar preview/commit contract', () => {
  it('sets current time directly (without touching a video element) when committing a seek without one mounted', () => {
    const { result, setCurrentTime } = setup()
    const input = document.createElement('input')
    input.dataset.pendingSeekTime = '77'
    result.current.rangeSeekElementRef.current = input

    act(() => {
      result.current.commitSeekBarTime()
    })

    expect(setCurrentTime).toHaveBeenCalledWith(77)
  })

  it('previews a seek bar time without a mounted range input element', () => {
    const { result, setCurrentTime } = setup()

    act(() => {
      result.current.previewSeekBarTime(15)
    })

    expect(result.current.pendingSeekTime).toBe(15)
    expect(setCurrentTime).toHaveBeenCalledWith(15)
  })

  it('clears the pending seek preview and resets the range input dataset', () => {
    const { result } = setup()
    const input = document.createElement('input')
    result.current.rangeSeekElementRef.current = input

    act(() => {
      result.current.previewSeekBarTime(42)
    })
    expect(input.dataset.pendingSeekTime).toBe('42')
    expect(result.current.pendingSeekTime).toBe(42)

    act(() => {
      result.current.clearPendingSeek()
    })
    expect(input.dataset.pendingSeekTime).toBeUndefined()
    expect(result.current.pendingSeekTime).toBeNull()
  })

  it('clears the pending seek preview even without a mounted range input element', () => {
    const { result } = setup()

    act(() => {
      result.current.clearPendingSeek()
    })

    expect(result.current.pendingSeekTime).toBeNull()
  })

  it('resets the preview to zero when given a non-finite preview time', () => {
    const { result, setCurrentTime } = setup()
    const input = document.createElement('input')
    result.current.rangeSeekElementRef.current = input

    act(() => {
      result.current.previewSeekBarTime(Number.NaN)
    })

    expect(result.current.pendingSeekTime).toBeNull()
    expect(setCurrentTime).toHaveBeenCalledWith(0)
  })

  it('does nothing committing a seek bar time with no pending value and no mounted range input', () => {
    const { result, setCurrentTime } = setup()

    act(() => {
      result.current.commitSeekBarTime()
    })

    expect(setCurrentTime).not.toHaveBeenCalled()
  })

  it('reads the pending seek time from the range input dataset when committing without an explicit value', () => {
    const video = makeVideo({ currentTime: 0 })
    const { result } = setup({ videoRef: ref(video) })
    const input = document.createElement('input')
    input.dataset.pendingSeekTime = '33'
    result.current.rangeSeekElementRef.current = input

    act(() => {
      result.current.commitSeekBarTime()
    })

    expect(video.currentTime).toBe(33)
  })

  it('falls back to the range input value when the dataset has no pending seek time', () => {
    const video = makeVideo({ currentTime: 0 })
    const { result } = setup({ videoRef: ref(video) })
    const input = document.createElement('input')
    input.type = 'range'
    input.value = '21'
    result.current.rangeSeekElementRef.current = input

    act(() => {
      result.current.commitSeekBarTime()
    })

    expect(video.currentTime).toBe(21)
  })

  it('does nothing committing a seek bar time when neither the dataset nor the value parse as finite', () => {
    const { result, setCurrentTime } = setup()
    const input = document.createElement('input')
    // A plain text input (not type="range") never sanitizes an assigned value, so the
    // dataset-and-value fallback in commitSeekBarTime() really does see a NaN parse.
    input.value = 'not-a-number'
    result.current.rangeSeekElementRef.current = input

    act(() => {
      result.current.commitSeekBarTime()
    })

    expect(setCurrentTime).not.toHaveBeenCalled()
  })
})
