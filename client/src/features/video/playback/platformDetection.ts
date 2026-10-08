export function detectMobilePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  const userAgent = navigator.userAgent
  const isTouchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  const isCoarseTouch =
    navigator.maxTouchPoints > 0 &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches

  return /Android|iPhone|iPad|iPod/i.test(userAgent) || isTouchMac || isCoarseTouch
}

// iPhone only (excludes iPad, including iPadOS's desktop-spoofed "Macintosh" + touch UA).
// Confirmed on an iOS 26.5 simulator: Element.requestFullscreen() on an arbitrary container
// resolves and sets document.fullscreenElement on iPhone Safari, but the composited visual
// result never actually expands past the element's pre-fullscreen box (still true even after
// forcing the container to 100vw/100vh with `!important`, so it is not a CSS sizing gap this
// app can fix) -- so a feature/promise-outcome check alone cannot detect the failure. iPad
// Safari's container fullscreen does not have this problem, so this checks the device instead.
export function detectIPhonePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  return /iPhone|iPod/i.test(navigator.userAgent)
}

// iPad only: a real "iPad" user agent, or iPadOS's desktop-spoofed "Macintosh" + touch UA
// (the same signal detectMobilePlatform's isTouchMac check uses). Used to keep iPad off the
// webkitEnterFullscreen() fallback in usePlaybackFullscreen when the container's
// Element.requestFullscreen is missing entirely -- see requirements.md 6c.
export function detectIPadPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  const isIPadUserAgent = /iPad/i.test(navigator.userAgent)
  const isTouchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1

  return isIPadUserAgent || isTouchMac
}
