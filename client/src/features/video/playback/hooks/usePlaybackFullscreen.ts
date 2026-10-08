import type { MutableRefObject } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { syncViewportHeightVariable } from '@/app/hooks/useFixedShellViewport'
import {
  detectOrientationLockSupport,
  detectPictureInPictureEnabled,
  getLockableOrientation,
} from '../lib/playbackShellSupport'
import { detectIPadPlatform, detectIPhonePlatform } from '../platformDetection'

export interface PlaybackFullscreenInput {
  playerRef: MutableRefObject<HTMLElement | null>
  videoRef: MutableRefObject<HTMLVideoElement | null>
  /**
   * True once the <video> element has mounted (assigned via ref callback). Used only to trigger
   * the initial Picture-in-Picture support check below -- see isPictureInPictureEnabled.
   */
  hasMountedVideoElement?: boolean | null
}

// Element.requestFullscreen() on an arbitrary container cannot be trusted on iPhone Safari:
// confirmed on an iOS 26.5 simulator that it resolves and sets document.fullscreenElement, and
// the container's computed layout does report full-viewport sizing, but the browser's
// composited visual result never actually expands past the element's pre-fullscreen box (still
// true after forcing 100vw/100vh with `!important`, so this is not a fixable CSS sizing gap).
// A resolved promise gives no signal of this failure, so iPhone must skip the container path
// entirely and go straight to HTMLVideoElement.webkitEnterFullscreen() (native video
// fullscreen), which is the only thing that actually works there. iPad Safari's container
// fullscreen is unaffected, so this is gated on detectIPhonePlatform(), not detectMobilePlatform
// (which also matches iPad). webkitEnterFullscreen is also kept as a fallback for any other
// browser whose container requestFullscreen is missing entirely (typeof check, "truly cannot
// work" via container) -- except on iPad (requirements.md 6c), which never takes this
// webkitEnterFullscreen() fallback even when container.requestFullscreen is missing entirely.
// iOS "Add to Home Screen" PWAs (standalone display-mode) may lack a working container
// Element.requestFullscreen the way the same device's Safari tab does not; that has not been
// confirmed on a device, so this branch is a defensive inference, not a confirmed repro like the
// iPhone case above. Falling through to native video fullscreen here would
// reproduce the same Apple-native-UI/seek-range/PiP loss described below, so iPad goes
// straight to the CSS-only fallback instead.
// It is NOT used when container.requestFullscreen() exists but its
// promise rejects: a rejection does not prove container fullscreen is unusable,
// and treating it as such is what let iPadOS 27 fall through to Apple's native video player UI
// on a transient/environmental rejection, losing the app's own controls, the full HLS seek
// range, and PiP -- see the toggleFullscreen .catch() below. These members are WebKit-only and
// not part of lib.dom.d.ts.
interface WebkitFullscreenVideoElement extends HTMLVideoElement {
  webkitDisplayingFullscreen?: boolean
  webkitEnterFullscreen?: () => void
  webkitExitFullscreen?: () => void
}

function asWebkitFullscreenVideo(
  video: HTMLVideoElement | null,
): WebkitFullscreenVideoElement | null {
  return video as WebkitFullscreenVideoElement | null
}

export function usePlaybackFullscreen({
  playerRef,
  videoRef,
  hasMountedVideoElement,
}: PlaybackFullscreenInput) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isFullscreenFallback, setIsFullscreenFallback] = useState(false)
  const [canLockOrientation, setCanLockOrientation] = useState(detectOrientationLockSupport)
  const [isPictureInPictureEnabled, setIsPictureInPictureEnabled] = useState(false)

  // Refs must not be read during render (react-hooks/refs), so the initial Picture-in-Picture
  // support check runs here instead of inline during render. This alone is not sufficient on
  // WebKit -- see refreshPictureInPictureSupport below and requirements.md 13a for why the
  // check must also be re-run after loadedmetadata / on media source changes.
  useEffect(() => {
    setIsPictureInPictureEnabled(detectPictureInPictureEnabled(videoRef.current))
  }, [hasMountedVideoElement, videoRef])

  // Called from usePlaybackVideoEvents on loadedmetadata / emptied / loadstart. WebKit's
  // webkitSupportsPresentationMode('picture-in-picture') answers `false` until the video has
  // loaded metadata and must be re-read at those points rather than trusted from a single
  // mount-time check (requirements.md 13a).
  const refreshPictureInPictureSupport = useCallback(() => {
    setIsPictureInPictureEnabled(detectPictureInPictureEnabled(videoRef.current))
  }, [videoRef])

  const lockLandscapeOrientation = useCallback(() => {
    const orientation = getLockableOrientation()
    if (orientation?.lock === undefined) {
      return
    }

    void orientation.lock('landscape').catch(() => undefined)
  }, [])

  // iPhone Safari fallback: drive isFullscreen from the video element's own
  // webkitbeginfullscreen/webkitendfullscreen events rather than assuming success, since
  // native video fullscreen has no Promise return value to await.
  const enterNativeVideoFullscreen = useCallback((): boolean => {
    const video = asWebkitFullscreenVideo(videoRef.current)
    const enterFullscreen = video?.webkitEnterFullscreen
    if (video === null || enterFullscreen === undefined) {
      return false
    }

    const handleBegin = () => {
      setIsFullscreen(true)
    }
    const handleEnd = () => {
      video.removeEventListener('webkitbeginfullscreen', handleBegin)
      video.removeEventListener('webkitendfullscreen', handleEnd)
      setIsFullscreen(false)
    }
    video.addEventListener('webkitbeginfullscreen', handleBegin)
    video.addEventListener('webkitendfullscreen', handleEnd)

    enterFullscreen.call(video)
    return true
  }, [videoRef])

  const toggleFullscreen = useCallback(() => {
    const player = playerRef.current
    if (player === null) {
      return
    }
    if (isFullscreen) {
      const video = asWebkitFullscreenVideo(videoRef.current)
      if (video?.webkitDisplayingFullscreen === true) {
        video.webkitExitFullscreen?.()
        return
      }
      const exitFullscreen = document.exitFullscreen
      if (document.fullscreenElement !== null && exitFullscreen !== undefined) {
        void exitFullscreen.call(document).catch(() => undefined)
      }
      setIsFullscreen(false)
      setIsFullscreenFallback(false)
      return
    }

    if (detectIPhonePlatform()) {
      if (!enterNativeVideoFullscreen()) {
        setIsFullscreen(true)
        setIsFullscreenFallback(true)
      }
      return
    }

    const requestFullscreen = player.requestFullscreen
    if (requestFullscreen === undefined) {
      // requirements.md 6c: iPad never takes the native-video-fullscreen fallback here, even
      // though the "container requestFullscreen is missing entirely" case would otherwise try it
      // for any other non-iPhone environment (see the comment above enterNativeVideoFullscreen).
      if (detectIPadPlatform() || !enterNativeVideoFullscreen()) {
        setIsFullscreen(true)
        setIsFullscreenFallback(true)
      }
      return
    }

    void requestFullscreen
      .call(player, { navigationUI: 'hide' })
      .then(lockLandscapeOrientation)
      .catch(() => {
        // container.requestFullscreen() existing but rejecting once does not
        // prove container fullscreen is truly unusable (unlike the branch above, where the
        // method is missing entirely). Falling back to enterNativeVideoFullscreen() here is
        // what let iPadOS 27 land on Apple's native video player UI on a transient/
        // environmental rejection, losing the app's own controls, the full HLS seek range,
        // and PiP. Stay on the CSS-only fallback instead; only the "method is missing"
        // branch above still tries native video fullscreen as a last resort.
        setIsFullscreen(true)
        setIsFullscreenFallback(true)
      })
  }, [enterNativeVideoFullscreen, isFullscreen, lockLandscapeOrientation, playerRef, videoRef])

  const rotateScreen = useCallback(() => {
    const orientation = getLockableOrientation()
    if (orientation?.lock === undefined) {
      return
    }

    const nextOrientation =
      orientation.type === 'landscape-primary' || orientation.type === 'landscape-secondary'
        ? 'portrait'
        : 'landscape'

    void orientation.lock(nextOrientation).catch(() => undefined)
  }, [])

  const enterPictureInPicture = useCallback(() => {
    const video = videoRef.current
    const requestPictureInPicture = video?.requestPictureInPicture
    if (video === null || requestPictureInPicture === undefined) {
      return
    }

    void requestPictureInPicture.call(video).catch((error: unknown) => {
      console.warn('requestPictureInPicture() failed', error)
    })
  }, [videoRef])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setCanLockOrientation(detectOrientationLockSupport())
      setIsFullscreen(document.fullscreenElement === playerRef.current || isFullscreenFallback)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [isFullscreenFallback, playerRef])

  // Entering/exiting the CSS-only fullscreen fallback (`.playerContainer[data-fullscreen-fallback=
  // 'true']`, sized from `--app-viewport-height`) does not itself fire a `resize` /
  // `orientationchange` / `visualViewport` event: it is plain React state, not the real
  // Fullscreen API, so nothing tells useFixedShellViewport's listeners to re-measure. On iPadOS
  // standalone (home-screen) PWAs specifically, WebKit can leave the viewport measurement holding
  // a stale value until a real geometry change (e.g. a device rotation) "exercises" it -- forcing
  // a resync at the exact moment the fallback toggles closes that gap instead of leaving the
  // fallback surface sized from whatever `--app-viewport-height` happened to hold since it was
  // last set by one of those events (requirements.md 6d).
  useEffect(() => {
    syncViewportHeightVariable()
  }, [isFullscreenFallback])

  return {
    isFullscreen,
    isFullscreenFallback,
    canLockOrientation,
    isPictureInPictureEnabled,
    toggleFullscreen,
    rotateScreen,
    enterPictureInPicture,
    refreshPictureInPictureSupport,
  }
}
