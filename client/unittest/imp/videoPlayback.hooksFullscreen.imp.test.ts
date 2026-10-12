import type { MutableRefObject } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlaybackFullscreen } from '@/features/video/playback/hooks/usePlaybackFullscreen'
import { setNavigatorPlatform } from './support/videoPlaybackFixtures'

function ref<T>(value: T): MutableRefObject<T> {
  return { current: value }
}

const DESKTOP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
const IPHONE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)'
const IPAD_USER_AGENT = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'

describe('usePlaybackFullscreen toggle/exit contract', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    setNavigatorPlatform({ maxTouchPoints: 0, platform: 'Win32', userAgent: DESKTOP_USER_AGENT })
  })

  it('does nothing when toggling fullscreen without a mounted player element', () => {
    const playerRef = ref<HTMLElement | null>(null)
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    act(() => {
      result.current.toggleFullscreen()
    })

    expect(result.current.isFullscreen).toBe(false)
  })

  it('[AC 4.9] exits fullscreen via document.exitFullscreen when currently fullscreen', async () => {
    const player = document.createElement('div')
    document.body.appendChild(player)
    const exitFullscreen = vi.fn(async () => undefined)
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: player })

    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(result.current.isFullscreen).toBe(true)

    await act(async () => {
      result.current.toggleFullscreen()
    })

    expect(exitFullscreen).toHaveBeenCalled()
    expect(result.current.isFullscreen).toBe(false)
    expect(result.current.isFullscreenFallback).toBe(false)

    Reflect.deleteProperty(document, 'exitFullscreen')
    Reflect.deleteProperty(document, 'fullscreenElement')
    player.remove()
  })

  it('silently ignores an exitFullscreen() rejection', async () => {
    const player = document.createElement('div')
    document.body.appendChild(player)
    const exitFullscreen = vi.fn(async () => {
      throw new Error('synthetic exitFullscreen failure')
    })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: player })

    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'))
    })

    await act(async () => {
      result.current.toggleFullscreen()
    })

    expect(exitFullscreen).toHaveBeenCalled()

    Reflect.deleteProperty(document, 'exitFullscreen')
    Reflect.deleteProperty(document, 'fullscreenElement')
    player.remove()
  })

  it('exits the fallback fullscreen state without calling exitFullscreen when the browser never entered real fullscreen', async () => {
    const player = document.createElement('div')
    document.body.appendChild(player)
    // No requestFullscreen on the element: toggling on enters the fallback state.
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    act(() => {
      result.current.toggleFullscreen()
    })
    expect(result.current.isFullscreen).toBe(true)
    expect(result.current.isFullscreenFallback).toBe(true)

    const exitFullscreen = vi.fn(async () => undefined)
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })

    act(() => {
      result.current.toggleFullscreen()
    })

    // document.fullscreenElement is null, so exitFullscreen() must not be called.
    expect(exitFullscreen).not.toHaveBeenCalled()
    expect(result.current.isFullscreen).toBe(false)
    expect(result.current.isFullscreenFallback).toBe(false)

    Reflect.deleteProperty(document, 'exitFullscreen')
    Reflect.deleteProperty(document, 'fullscreenElement')
    player.remove()
  })

  it('[AC 3.6] falls back to a non-native fullscreen state when requestFullscreen is unavailable', () => {
    const player = document.createElement('div')
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    act(() => {
      result.current.toggleFullscreen()
    })

    expect(result.current.isFullscreen).toBe(true)
    expect(result.current.isFullscreenFallback).toBe(true)
  })

  it('keeps a fallback fullscreen state active across an unrelated fullscreenchange event', () => {
    const player = document.createElement('div')
    // No requestFullscreen on the element: toggling on enters the fallback state.
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    act(() => {
      result.current.toggleFullscreen()
    })
    expect(result.current.isFullscreenFallback).toBe(true)

    // document.fullscreenElement never matches the player in fallback mode, but the
    // fallback flag alone must keep isFullscreen true across this event.
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'))
    })

    expect(result.current.isFullscreen).toBe(true)
  })

  it('[AC 3.6] falls back silently (log only, no snackbar) when requestFullscreen() rejects', async () => {
    const player = document.createElement('div')
    const requestFullscreen = vi.fn(async () => {
      throw new Error('synthetic requestFullscreen failure')
    })
    Object.defineProperty(player, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    await act(async () => {
      result.current.toggleFullscreen()
    })

    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' })
    expect(result.current.isFullscreen).toBe(true)
    expect(result.current.isFullscreenFallback).toBe(true)
  })

  it('[AC 4.6b] uses HTMLVideoElement.webkitEnterFullscreen() instead of the CSS fallback when the container has no requestFullscreen but the video supports native fullscreen (iPhone Safari)', () => {
    const player = document.createElement('div')
    // iPhone Safari: no Element.requestFullscreen on the container.
    const video = document.createElement('video')
    const webkitEnterFullscreen = vi.fn()
    Object.defineProperty(video, 'webkitEnterFullscreen', {
      configurable: true,
      value: webkitEnterFullscreen,
    })
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(video)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    act(() => {
      result.current.toggleFullscreen()
    })

    expect(webkitEnterFullscreen).toHaveBeenCalled()
    // State is driven by webkitbeginfullscreen/webkitendfullscreen, not assumed optimistically.
    expect(result.current.isFullscreen).toBe(false)
    expect(result.current.isFullscreenFallback).toBe(false)

    act(() => {
      video.dispatchEvent(new Event('webkitbeginfullscreen'))
    })

    expect(result.current.isFullscreen).toBe(true)
    expect(result.current.isFullscreenFallback).toBe(false)
  })

  it('[AC 4.6] exits native video fullscreen via webkitExitFullscreen() and syncs state from webkitendfullscreen', () => {
    const player = document.createElement('div')
    const video = document.createElement('video')
    const webkitEnterFullscreen = vi.fn()
    const webkitExitFullscreen = vi.fn()
    Object.defineProperty(video, 'webkitEnterFullscreen', {
      configurable: true,
      value: webkitEnterFullscreen,
    })
    Object.defineProperty(video, 'webkitExitFullscreen', {
      configurable: true,
      value: webkitExitFullscreen,
    })
    Object.defineProperty(video, 'webkitDisplayingFullscreen', {
      configurable: true,
      get: () => webkitEnterFullscreen.mock.calls.length > webkitExitFullscreen.mock.calls.length,
    })
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(video)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    act(() => {
      result.current.toggleFullscreen()
      video.dispatchEvent(new Event('webkitbeginfullscreen'))
    })
    expect(result.current.isFullscreen).toBe(true)

    act(() => {
      result.current.toggleFullscreen()
    })

    expect(webkitExitFullscreen).toHaveBeenCalled()
    expect(result.current.isFullscreen).toBe(true)

    act(() => {
      video.dispatchEvent(new Event('webkitendfullscreen'))
    })

    expect(result.current.isFullscreen).toBe(false)
  })

  it('[AC 4.6] falls back to the CSS-only fullscreen state, not webkitEnterFullscreen(), when requestFullscreen() rejects even though the video supports native fullscreen', async () => {
    // requestFullscreen() existing but rejecting once does not prove container
    // fullscreen is truly unusable. Falling back to webkitEnterFullscreen() here is what let
    // iPadOS 27 land on Apple's native video player UI (losing the app's own controls, the
    // full HLS seek range, and PiP), so a rejection must stay on the CSS-only fallback instead.
    const player = document.createElement('div')
    const requestFullscreen = vi.fn(async () => {
      throw new Error('synthetic requestFullscreen failure')
    })
    Object.defineProperty(player, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    const video = document.createElement('video')
    const webkitEnterFullscreen = vi.fn()
    Object.defineProperty(video, 'webkitEnterFullscreen', {
      configurable: true,
      value: webkitEnterFullscreen,
    })
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(video)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    await act(async () => {
      result.current.toggleFullscreen()
    })

    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' })
    expect(webkitEnterFullscreen).not.toHaveBeenCalled()
    expect(result.current.isFullscreen).toBe(true)
    expect(result.current.isFullscreenFallback).toBe(true)
  })

  it('[AC 4.6c] on iPad, falls back to the CSS-only fullscreen state (not native video fullscreen) when the container requestFullscreen() rejects, keeping the app UI, full seek range, and PiP available', async () => {
    setNavigatorPlatform({ maxTouchPoints: 5, platform: 'iPad', userAgent: IPAD_USER_AGENT })
    const player = document.createElement('div')
    const requestFullscreen = vi.fn(async () => {
      throw new Error('synthetic iPadOS 27 requestFullscreen rejection')
    })
    Object.defineProperty(player, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    const video = document.createElement('video')
    const webkitEnterFullscreen = vi.fn()
    Object.defineProperty(video, 'webkitEnterFullscreen', {
      configurable: true,
      value: webkitEnterFullscreen,
    })
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(video)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    await act(async () => {
      result.current.toggleFullscreen()
    })

    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' })
    expect(webkitEnterFullscreen).not.toHaveBeenCalled()
    expect(result.current.isFullscreen).toBe(true)
    expect(result.current.isFullscreenFallback).toBe(true)
  })

  it('[AC 4.6c] on iPad, falls back to the CSS-only fullscreen state (not webkitEnterFullscreen()) when the container has no requestFullscreen at all, so a standalone PWA on iPad never drops to the Apple native player UI', async () => {
    // requirements.md 6c: unlike any other non-iPhone environment, iPad never takes the
    // native-video-fullscreen fallback here, even for the "container requestFullscreen is
    // missing entirely" case (see the "still uses container requestFullscreen" test below for
    // the case where it exists and resolves, which is unaffected).
    setNavigatorPlatform({ maxTouchPoints: 5, platform: 'iPad', userAgent: IPAD_USER_AGENT })
    const player = document.createElement('div')
    // No requestFullscreen property at all: this is the "truly cannot work" case, distinct
    // from a rejection, and must still avoid native video fullscreen on iPad.
    const video = document.createElement('video')
    const webkitEnterFullscreen = vi.fn()
    Object.defineProperty(video, 'webkitEnterFullscreen', {
      configurable: true,
      value: webkitEnterFullscreen,
    })
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(video)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    act(() => {
      result.current.toggleFullscreen()
    })

    expect(webkitEnterFullscreen).not.toHaveBeenCalled()
    expect(result.current.isFullscreen).toBe(true)
    expect(result.current.isFullscreenFallback).toBe(true)
  })

  it('[AC 4.6] on a non-iPad, non-iPhone environment, still falls back to webkitEnterFullscreen() when the container has no requestFullscreen at all (container fullscreen truly unavailable)', async () => {
    // Unaffected desktop/Android case: only iPad's 6c branch changed.
    setNavigatorPlatform({
      maxTouchPoints: 0,
      platform: 'Linux armv8l',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)',
    })
    const player = document.createElement('div')
    const video = document.createElement('video')
    const webkitEnterFullscreen = vi.fn()
    Object.defineProperty(video, 'webkitEnterFullscreen', {
      configurable: true,
      value: webkitEnterFullscreen,
    })
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(video)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    act(() => {
      result.current.toggleFullscreen()
    })

    expect(webkitEnterFullscreen).toHaveBeenCalled()
    expect(result.current.isFullscreenFallback).toBe(false)
  })

  it('[AC 4.6b] on iPhone, uses video.webkitEnterFullscreen() without ever calling the container requestFullscreen(), even though it exists and would resolve', async () => {
    // Confirmed on an iOS 26.5 simulator: Element.requestFullscreen() on the container resolves
    // and sets document.fullscreenElement on iPhone Safari, but the composited visual result
    // never actually expands past the element's pre-fullscreen box -- a resolved promise gives
    // no signal of this, so iPhone must not attempt the container path at all.
    setNavigatorPlatform({ maxTouchPoints: 5, platform: 'iPhone', userAgent: IPHONE_USER_AGENT })
    const player = document.createElement('div')
    const requestFullscreen = vi.fn(async () => undefined)
    Object.defineProperty(player, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    const video = document.createElement('video')
    const webkitEnterFullscreen = vi.fn()
    Object.defineProperty(video, 'webkitEnterFullscreen', {
      configurable: true,
      value: webkitEnterFullscreen,
    })
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(video)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    await act(async () => {
      result.current.toggleFullscreen()
    })

    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(webkitEnterFullscreen).toHaveBeenCalled()
    expect(result.current.isFullscreenFallback).toBe(false)
  })

  it('[AC 4.6] on iPhone, falls back to the CSS-only fullscreen state when the video has no webkitEnterFullscreen() either, without ever calling the container requestFullscreen()', () => {
    // Both the container path (iPhone Safari's composited fullscreen bug) and the native video
    // path (no webkitEnterFullscreen on this element) are unavailable here, so
    // enterNativeVideoFullscreen() returns false and toggleFullscreen() must land on the
    // CSS-only fallback -- the same fallback used when requestFullscreen() itself is missing.
    setNavigatorPlatform({ maxTouchPoints: 5, platform: 'iPhone', userAgent: IPHONE_USER_AGENT })
    const player = document.createElement('div')
    const requestFullscreen = vi.fn(async () => undefined)
    Object.defineProperty(player, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    // No webkitEnterFullscreen on the video: native video fullscreen is unavailable too.
    const video = document.createElement('video')
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(video)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    act(() => {
      result.current.toggleFullscreen()
    })

    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(result.current.isFullscreen).toBe(true)
    expect(result.current.isFullscreenFallback).toBe(true)
  })

  it('[AC 4.6] on iPad, still uses the container requestFullscreen() (iPad Safari fullscreen is not affected)', async () => {
    setNavigatorPlatform({ maxTouchPoints: 5, platform: 'iPad', userAgent: IPAD_USER_AGENT })
    const player = document.createElement('div')
    const requestFullscreen = vi.fn(async () => undefined)
    Object.defineProperty(player, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    const video = document.createElement('video')
    const webkitEnterFullscreen = vi.fn()
    Object.defineProperty(video, 'webkitEnterFullscreen', {
      configurable: true,
      value: webkitEnterFullscreen,
    })
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(video)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    await act(async () => {
      result.current.toggleFullscreen()
    })

    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' })
    expect(webkitEnterFullscreen).not.toHaveBeenCalled()
  })

  it('[AC 4.6d] resyncs --app-viewport-height from the current window.innerHeight when entering the CSS fallback, instead of leaving a stale measurement in place', () => {
    // requirements.md 6d: on iPadOS standalone PWAs, WebKit can leave the viewport measurement
    // holding a stale value until a real geometry change (e.g. a device rotation) "exercises"
    // it. Simulate that by changing window.innerHeight without firing resize/orientationchange/
    // visualViewport, the events useFixedShellViewport listens for -- entering the CSS fallback
    // must still pick up the current value via the explicit syncViewportHeightVariable() call.
    const innerHeightDescriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })

    const player = document.createElement('div')
    const playerRef = ref<HTMLElement | null>(player)
    const videoRef = ref<HTMLVideoElement | null>(null)
    const { result } = renderHook(() => usePlaybackFullscreen({ playerRef, videoRef }))

    // Mounting the hook already resyncs once, matching window.innerHeight at that time.
    expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('600px')

    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })

    act(() => {
      result.current.toggleFullscreen()
    })

    expect(result.current.isFullscreenFallback).toBe(true)
    // Entering the fallback must not leave the stale 600px measurement in place.
    expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('900px')

    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 })

    act(() => {
      result.current.toggleFullscreen()
    })

    expect(result.current.isFullscreenFallback).toBe(false)
    // Exiting the fallback resyncs too.
    expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('700px')

    document.documentElement.style.removeProperty('--app-viewport-height')
    if (innerHeightDescriptor !== undefined) {
      Object.defineProperty(window, 'innerHeight', innerHeightDescriptor)
    }
  })
})
