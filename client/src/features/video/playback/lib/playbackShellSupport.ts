export type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: OrientationLockType) => Promise<void>
}

export function getLockableOrientation(): LockableScreenOrientation | undefined {
  return screen.orientation as LockableScreenOrientation | undefined
}

export function detectOrientationLockSupport(): boolean {
  return getLockableOrientation()?.lock !== undefined
}

export function readSeekSeconds(url: string): number {
  const parsed = new URL(url, 'http://epgstation.invalid')
  const value = Number(parsed.searchParams.get('ss') ?? 0)

  return Number.isFinite(value) && value > 0 ? value : 0
}

// WebKit-only, not part of lib.dom.d.ts. Reported by WebKit Bugzilla #303885 ("[iOS/iPadOS]
// requestPictureInPicture() (PiP / PinP) does not work in Home Screen Web Apps (PWA) on
// iOS/iPadOS", still open) as the one signal that correctly reports `false` for
// Picture-in-Picture in an iOS/iPadOS standalone PWA even though document.pictureInPictureEnabled
// incorrectly reports `true` there. Confirmed on an iPad Simulator (iPadOS 26.5, Safari tab, a
// real HLS recorded stream): before the <video> element has loaded metadata (no
// src, or src not yet resolved), webkitSupportsPresentationMode('picture-in-picture') itself
// reports `false` even in a Safari tab where PiP genuinely works once the video is ready; it only
// becomes `true` after `loadedmetadata` fires (once videoWidth is known). This function is a pure
// point-in-time check -- callers MUST re-run it after `loadedmetadata` (and again whenever the
// media source is replaced, e.g. `emptied`/`loadstart`), not just once when the <video> element
// mounts: evaluating it once at mount time froze this at its pre-load `false` and hid the PiP
// button even in a plain Safari tab (requirements.md 13a; the event-driven evaluation lives in
// usePlaybackFullscreen).
interface WebkitPresentationModeVideoElement extends HTMLVideoElement {
  webkitSupportsPresentationMode?: (mode: string) => boolean
}

export function detectPictureInPictureEnabled(video?: HTMLVideoElement | null): boolean {
  const webkitVideo = video as WebkitPresentationModeVideoElement | null | undefined
  const webkitSupportsPresentationMode = webkitVideo?.webkitSupportsPresentationMode
  if (typeof webkitSupportsPresentationMode === 'function') {
    return webkitSupportsPresentationMode.call(webkitVideo, 'picture-in-picture')
  }

  if (typeof document === 'undefined') {
    return false
  }

  return document.pictureInPictureEnabled === true
}

export function getVideoPlayerStorage(): Storage | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function isInteractiveShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return target.closest('button,input,select,textarea,a,[role="button"],[role="slider"]') !== null
}
