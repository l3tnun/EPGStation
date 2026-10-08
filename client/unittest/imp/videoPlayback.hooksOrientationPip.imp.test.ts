import type { MutableRefObject } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlaybackFullscreen } from '@/features/video/playback/hooks/usePlaybackFullscreen'

function ref<T>(value: T): MutableRefObject<T> {
  return { current: value }
}

async function withScreenOrientation<T>(value: unknown, run: () => T | Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(screen, 'orientation')
  Object.defineProperty(screen, 'orientation', { configurable: true, value })
  try {
    return await run()
  } finally {
    if (original !== undefined) {
      Object.defineProperty(screen, 'orientation', original)
    } else {
      Reflect.deleteProperty(screen, 'orientation')
    }
  }
}

describe('usePlaybackFullscreen orientation lock and Picture-in-Picture contract', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('locks landscape orientation after entering fullscreen when the browser supports orientation lock', async () => {
    const player = document.createElement('div')
    const requestFullscreen = vi.fn(async () => undefined)
    Object.defineProperty(player, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(null)

    const lock = vi.fn(async () => undefined)
    await withScreenOrientation({ type: 'portrait-primary', lock }, async () => {
      const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

      await act(async () => {
        result.current.toggleFullscreen()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(lock).toHaveBeenCalledWith('landscape')
    })
  })

  it('silently ignores an orientation lock() rejection after entering fullscreen', async () => {
    const player = document.createElement('div')
    const requestFullscreen = vi.fn(async () => undefined)
    Object.defineProperty(player, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(null)

    const lock = vi.fn(async () => {
      throw new Error('synthetic lock failure')
    })
    await withScreenOrientation({ type: 'portrait-primary', lock }, async () => {
      const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

      await act(async () => {
        result.current.toggleFullscreen()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(lock).toHaveBeenCalledWith('landscape')
    })
  })

  it('does nothing when locking landscape orientation without a lock() implementation', async () => {
    const player = document.createElement('div')
    const requestFullscreen = vi.fn(async () => undefined)
    Object.defineProperty(player, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(null)

    await withScreenOrientation({ type: 'portrait-primary' }, async () => {
      const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

      await expect(
        act(async () => {
          result.current.toggleFullscreen()
        }),
      ).resolves.not.toThrow()
    })
  })

  it('does nothing when rotating the screen without orientation lock support', () => {
    const playerRef = ref<HTMLElement | null>(null)
    const videoRef = ref<HTMLVideoElement | null>(null)

    withScreenOrientation({ type: 'portrait-primary' }, () => {
      const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

      expect(() => {
        act(() => {
          result.current.rotateScreen()
        })
      }).not.toThrow()
    })
  })

  it('rotates from landscape to portrait and from portrait to landscape', () => {
    const playerRef = ref<HTMLElement | null>(null)
    const videoRef = ref<HTMLVideoElement | null>(null)

    const landscapeLock = vi.fn(async () => undefined)
    withScreenOrientation({ type: 'landscape-primary', lock: landscapeLock }, () => {
      const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))
      act(() => {
        result.current.rotateScreen()
      })
      expect(landscapeLock).toHaveBeenCalledWith('portrait')
    })

    const portraitLock = vi.fn(async () => undefined)
    withScreenOrientation({ type: 'landscape-secondary', lock: portraitLock }, () => {
      const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))
      act(() => {
        result.current.rotateScreen()
      })
      expect(portraitLock).toHaveBeenCalledWith('portrait')
    })

    const toLandscapeLock = vi.fn(async () => undefined)
    withScreenOrientation({ type: 'portrait-primary', lock: toLandscapeLock }, () => {
      const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))
      act(() => {
        result.current.rotateScreen()
      })
      expect(toLandscapeLock).toHaveBeenCalledWith('landscape')
    })
  })

  it('silently ignores a rotateScreen() lock() rejection', () => {
    const playerRef = ref<HTMLElement | null>(null)
    const videoRef = ref<HTMLVideoElement | null>(null)
    const lock = vi.fn(async () => {
      throw new Error('synthetic rotate lock failure')
    })

    withScreenOrientation({ type: 'portrait-primary', lock }, () => {
      const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))
      expect(() => {
        act(() => {
          result.current.rotateScreen()
        })
      }).not.toThrow()
    })
  })

  it('[AC 4.3] does nothing entering Picture-in-Picture without a video element or API support', () => {
    const playerRef = ref<HTMLElement | null>(null)
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    expect(() => {
      act(() => {
        result.current.enterPictureInPicture()
      })
    }).not.toThrow()

    const video = document.createElement('video')
    videoRef.current = video
    expect(() => {
      act(() => {
        result.current.enterPictureInPicture()
      })
    }).not.toThrow()
  })

  it('[AC 4.3] logs (does not throw) when requestPictureInPicture() rejects', async () => {
    const video = document.createElement('video')
    const requestPictureInPicture = vi.fn(async () => {
      throw new Error('synthetic requestPictureInPicture failure')
    })
    Object.defineProperty(video, 'requestPictureInPicture', {
      configurable: true,
      value: requestPictureInPicture,
    })
    const playerRef = ref<HTMLElement | null>(null)
    const videoRef = ref<HTMLVideoElement | null>(video)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    await act(async () => {
      result.current.enterPictureInPicture()
    })

    expect(requestPictureInPicture).toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('requestPictureInPicture() failed', expect.any(Error))
  })

  it('enters Picture-in-Picture successfully', async () => {
    const video = document.createElement('video')
    const requestPictureInPicture = vi.fn(async () => undefined)
    Object.defineProperty(video, 'requestPictureInPicture', {
      configurable: true,
      value: requestPictureInPicture,
    })
    const playerRef = ref<HTMLElement | null>(null)
    const videoRef = ref<HTMLVideoElement | null>(video)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    await act(async () => {
      result.current.enterPictureInPicture()
    })

    expect(requestPictureInPicture).toHaveBeenCalled()
  })

  it('[AC 4.13a] re-evaluates Picture-in-Picture support when a new video element mounts', () => {
    const descriptor = Object.getOwnPropertyDescriptor(document, 'pictureInPictureEnabled')
    Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: false })
    try {
      const playerRef = ref<HTMLElement | null>(null)
      const videoRef = ref<HTMLVideoElement | null>(null)
      const { result, rerender } = renderHook(
        (props: { hasMountedVideoElement: boolean }) =>
          usePlaybackFullscreen({ playerRef, videoRef, ...props }),
        { initialProps: { hasMountedVideoElement: false } },
      )

      // No video yet and document.pictureInPictureEnabled is false: unavailable.
      expect(result.current.isPictureInPictureEnabled).toBe(false)

      // A video element mounts with WebKit's presentation-mode API reporting support (already
      // past loadedmetadata by the time it is assigned, in this scenario).
      const video = document.createElement('video')
      const webkitSupportsPresentationMode = vi.fn(() => true)
      Object.defineProperty(video, 'webkitSupportsPresentationMode', {
        configurable: true,
        value: webkitSupportsPresentationMode,
      })
      videoRef.current = video
      rerender({ hasMountedVideoElement: true })

      expect(result.current.isPictureInPictureEnabled).toBe(true)
    } finally {
      if (descriptor !== undefined) {
        Object.defineProperty(document, 'pictureInPictureEnabled', descriptor)
      } else {
        Reflect.deleteProperty(document, 'pictureInPictureEnabled')
      }
    }
  })

  it('[AC 4.13a] refreshPictureInPictureSupport() re-reads the current video element state', () => {
    const video = document.createElement('video')
    const webkitSupportsPresentationMode = vi.fn(() => false)
    Object.defineProperty(video, 'webkitSupportsPresentationMode', {
      configurable: true,
      value: webkitSupportsPresentationMode,
    })
    const playerRef = ref<HTMLElement | null>(null)
    const videoRef = ref<HTMLVideoElement | null>(video)
    const { result } = renderHook(() =>
      usePlaybackFullscreen({ playerRef, videoRef, hasMountedVideoElement: true }),
    )

    expect(result.current.isPictureInPictureEnabled).toBe(false)

    webkitSupportsPresentationMode.mockReturnValue(true)
    act(() => {
      result.current.refreshPictureInPictureSupport()
    })

    expect(result.current.isPictureInPictureEnabled).toBe(true)
  })
})
