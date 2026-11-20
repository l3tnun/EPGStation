import type { MutableRefObject } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlaybackSeekFrame } from '@/features/video/playback/hooks/usePlaybackSeekFrame'
import type { HlsLifecycleState } from '@/features/video/playback/playbackLifecycle'

function makeVideo(): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperties(video, {
    readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    videoWidth: { configurable: true, value: 1920 },
    videoHeight: { configurable: true, value: 1080 },
  })
  return video
}

describe('seek frame for playback formats', () => {
  afterEach(() => vi.restoreAllMocks())

  it('[AC 5.7] retains the previous frame until the new stream plays', () => {
    const video = makeVideo()
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never)
    const videoRef = { current: video } as MutableRefObject<HTMLVideoElement | null>
    const isPausedRef = { current: false }
    const { result } = renderHook(() =>
      usePlaybackSeekFrame(videoRef, 'ready', 'initial', isPausedRef),
    )
    result.current.canvasRef.current = document.createElement('canvas')

    act(() => result.current.capture())
    act(() => result.current.capture())
    expect(result.current.visible).toBe(true)
    expect(result.current.canvasRef.current?.width).toBe(1920)
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080)
    expect(drawImage).toHaveBeenCalledOnce()
    act(() => result.current.onCanPlay())
    expect(result.current.visible).toBe(true)
    act(() => result.current.onPlaying())
    expect(result.current.visible).toBe(false)
  })

  it('[AC 5.7] clears a paused seek on canplay and clears failures', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never)
    const videoRef = { current: makeVideo() } as MutableRefObject<HTMLVideoElement | null>
    const isPausedRef = { current: false }
    const { result, rerender } = renderHook(
      ({ state }) => usePlaybackSeekFrame(videoRef, state, 'initial', isPausedRef),
      {
        initialProps: { state: 'ready' as HlsLifecycleState },
      },
    )
    result.current.canvasRef.current = document.createElement('canvas')
    isPausedRef.current = true
    act(() => result.current.capture())
    act(() => result.current.onCanPlay())
    expect(result.current.visible).toBe(false)
    act(() => result.current.capture())
    rerender({ state: 'error' })
    expect(result.current.visible).toBe(false)
  })

  it('clears a paused in-place seek when seeked fires after the new frame was presented', () => {
    const video = makeVideo()
    video.requestVideoFrameCallback = vi.fn(() => 1)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never)
    const videoRef = { current: video } as MutableRefObject<HTMLVideoElement | null>
    const isPausedRef = { current: false }
    const { result } = renderHook(() =>
      usePlaybackSeekFrame(videoRef, 'ready', 'initial', isPausedRef),
    )
    result.current.canvasRef.current = document.createElement('canvas')

    isPausedRef.current = true
    act(() => result.current.capture())
    act(() => result.current.onSeeked())

    expect(result.current.visible).toBe(false)
    expect(video.requestVideoFrameCallback).not.toHaveBeenCalled()
  })

  it('keeps the normal player when a frame cannot be captured', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const videoRef = { current: makeVideo() } as MutableRefObject<HTMLVideoElement | null>
    const isPausedRef = { current: false }
    const { result } = renderHook(() =>
      usePlaybackSeekFrame(videoRef, 'ready', 'initial', isPausedRef),
    )
    result.current.canvasRef.current = document.createElement('canvas')
    act(() => result.current.capture())
    expect(getContext).toHaveBeenCalledOnce()
    expect(result.current.visible).toBe(false)
  })

  it('clears a paused or playing in-place seek after the next presented frame', () => {
    const video = makeVideo()
    const callbacks: Array<VideoFrameRequestCallback> = []
    video.requestVideoFrameCallback = vi.fn((callback) => {
      callbacks.push(callback)
      return callbacks.length
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never)
    const videoRef = { current: video } as MutableRefObject<HTMLVideoElement | null>
    const isPausedRef = { current: false }
    const { result } = renderHook(() =>
      usePlaybackSeekFrame(videoRef, 'ready', 'initial', isPausedRef),
    )
    result.current.canvasRef.current = document.createElement('canvas')

    act(() => result.current.capture())
    act(() => result.current.onSeeked())
    expect(result.current.visible).toBe(true)
    act(() => callbacks[0](0, {} as VideoFrameCallbackMetadata))
    expect(result.current.visible).toBe(false)
  })

  it('clears the overlay when the new source presents its first frame before playing', () => {
    const video = makeVideo()
    const callbacks: VideoFrameRequestCallback[] = []
    video.requestVideoFrameCallback = vi.fn((callback) => callbacks.push(callback))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never)
    const isPausedRef = { current: false }
    const { result } = renderHook(() =>
      usePlaybackSeekFrame({ current: video }, 'ready', 'initial', isPausedRef),
    )
    result.current.canvasRef.current = document.createElement('canvas')

    act(() => result.current.capture())
    act(() => result.current.onLoadStart())
    expect(callbacks).toHaveLength(1)
    act(() => callbacks[0](0, {} as VideoFrameCallbackMetadata))
    expect(result.current.visible).toBe(false)
    act(() => result.current.onPlaying())
    expect(callbacks).toHaveLength(1)
  })

  it('ignores a frame callback from the source replaced at loadstart', () => {
    const video = makeVideo()
    const callbacks: VideoFrameRequestCallback[] = []
    video.requestVideoFrameCallback = vi.fn((callback) => callbacks.push(callback))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never)
    const isPausedRef = { current: false }
    const { result } = renderHook(() =>
      usePlaybackSeekFrame({ current: video }, 'ready', 'initial', isPausedRef),
    )
    result.current.canvasRef.current = document.createElement('canvas')

    act(() => result.current.capture())
    act(() => result.current.onLoadStart())
    act(() => result.current.onLoadStart())
    expect(callbacks).toHaveLength(2)
    act(() => callbacks[0](0, {} as VideoFrameCallbackMetadata))
    expect(result.current.visible).toBe(true)
    act(() => callbacks[1](0, {} as VideoFrameCallbackMetadata))
    expect(result.current.visible).toBe(false)
  })

  it.each(['onSeeked', 'onCanPlay'] as const)(
    'clears on %s when playback was paused during the seek',
    (event) => {
      const video = makeVideo()
      video.requestVideoFrameCallback = vi.fn(() => 1)
      const drawImage = vi.fn()
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never)
      const isPausedRef = { current: false }
      const { result } = renderHook(() =>
        usePlaybackSeekFrame({ current: video }, 'ready', 'initial', isPausedRef),
      )
      result.current.canvasRef.current = document.createElement('canvas')

      act(() => result.current.capture())
      isPausedRef.current = true
      act(() => result.current.capture())
      expect(drawImage).toHaveBeenCalledOnce()
      act(() => result.current[event]())

      expect(result.current.visible).toBe(false)
      expect(video.requestVideoFrameCallback).not.toHaveBeenCalled()
    },
  )

  it('ignores obsolete frame notifications and only schedules one for the current seek', () => {
    const video = makeVideo()
    const callbacks: VideoFrameRequestCallback[] = []
    video.requestVideoFrameCallback = vi.fn((callback) => callbacks.push(callback))
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never)
    const isPausedRef = { current: false }
    const { result } = renderHook(() =>
      usePlaybackSeekFrame({ current: video }, 'ready', 'initial', isPausedRef),
    )
    result.current.canvasRef.current = document.createElement('canvas')

    act(() => result.current.capture())
    act(() => result.current.onSeeked())
    act(() => result.current.onPlaying())
    expect(callbacks).toHaveLength(1)

    act(() => result.current.capture())
    expect(drawImage).toHaveBeenCalledOnce()
    act(() => callbacks[0](0, {} as VideoFrameCallbackMetadata))
    expect(result.current.visible).toBe(true)

    act(() => result.current.onSeeked())
    act(() => result.current.onError())
    act(() => result.current.capture())
    expect(drawImage).toHaveBeenCalledTimes(2)
    act(() => callbacks[1](0, {} as VideoFrameCallbackMetadata))
    expect(result.current.visible).toBe(true)

    act(() => result.current.onPlaying())
    act(() => callbacks[2](0, {} as VideoFrameCallbackMetadata))
    expect(result.current.visible).toBe(false)
  })

  it.each(['video', 'canvas', 'data', 'width', 'height'] as const)(
    'skips frame capture when %s is missing',
    (missing) => {
      const video = makeVideo()
      const videoRef = { current: missing === 'video' ? null : video }
      const isPausedRef = { current: false }
      const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      const { result } = renderHook(() =>
        usePlaybackSeekFrame(videoRef, 'ready', 'initial', isPausedRef),
      )
      if (missing !== 'canvas') result.current.canvasRef.current = document.createElement('canvas')
      if (missing === 'data') {
        Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_METADATA })
      }
      if (missing === 'width') Object.defineProperty(video, 'videoWidth', { value: 0 })
      if (missing === 'height') Object.defineProperty(video, 'videoHeight', { value: 0 })

      act(() => result.current.capture())

      expect(result.current.visible).toBe(false)
      expect(getContext).not.toHaveBeenCalled()
    },
  )

  it('only clears on pause after the completed seek has a usable frame', () => {
    const video = makeVideo()
    const callbacks: VideoFrameRequestCallback[] = []
    video.requestVideoFrameCallback = vi.fn((callback) => callbacks.push(callback))
    const videoRef: MutableRefObject<HTMLVideoElement | null> = { current: video }
    const isPausedRef = { current: false }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never)
    const { result } = renderHook(() =>
      usePlaybackSeekFrame(videoRef, 'ready', 'initial', isPausedRef),
    )
    result.current.canvasRef.current = document.createElement('canvas')

    act(() => result.current.capture())
    act(() => result.current.onPause())
    expect(result.current.visible).toBe(true)
    act(() => result.current.onSeeked())
    expect(callbacks).toHaveLength(1)

    videoRef.current = null
    act(() => result.current.onPause())
    expect(result.current.visible).toBe(true)
    videoRef.current = video

    Object.defineProperty(video, 'seeking', { configurable: true, value: true })
    act(() => result.current.onPause())
    expect(result.current.visible).toBe(true)

    Object.defineProperty(video, 'seeking', { value: false })
    Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_METADATA })
    act(() => result.current.onPause())
    expect(result.current.visible).toBe(true)

    Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_CURRENT_DATA })
    act(() => result.current.onPause())
    expect(result.current.visible).toBe(false)

    act(() => result.current.capture())
    act(() => callbacks[0](0, {} as VideoFrameCallbackMetadata))
    expect(result.current.visible).toBe(true)
  })

  it('ignores seek completion without an overlay or a usable video frame', () => {
    const video = makeVideo()
    const videoRef: MutableRefObject<HTMLVideoElement | null> = { current: video }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never)
    const isPausedRef = { current: false }
    const { result } = renderHook(() =>
      usePlaybackSeekFrame(videoRef, 'ready', 'initial', isPausedRef),
    )
    result.current.canvasRef.current = document.createElement('canvas')

    act(() => result.current.onSeeked())
    expect(result.current.visible).toBe(false)
    act(() => result.current.capture())
    videoRef.current = null
    act(() => result.current.onSeeked())
    expect(result.current.visible).toBe(true)

    videoRef.current = video
    Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_METADATA })
    act(() => result.current.onSeeked())
    expect(result.current.visible).toBe(true)
    isPausedRef.current = true
    act(() => result.current.onSeeked())
    expect(result.current.visible).toBe(true)

    Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_CURRENT_DATA })
    act(() => result.current.onSeeked())
    expect(result.current.visible).toBe(false)
  })
})
