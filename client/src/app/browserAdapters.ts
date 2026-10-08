import { APP_SHELL_DESKTOP_BREAKPOINT } from './drawerLayout'

export function getBrowserOSPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function isUsableWidth(width: unknown): width is number {
  return typeof width === 'number' && Number.isFinite(width) && width > 0
}

// This is the *numeric* browser viewport width, used by feature layouts that need an actual pixel
// value (e.g. the Recorded two-card breakpoint, playback narrow-controls threshold, Reserves/Rule
// list column layout -- see the call sites of `useResolvedViewportWidth`). It must NOT be used to
// decide the App Shell's own desktop/mobile drawer breakpoint; that decision is
// `isDesktopViewport()` below, which reads `matchMedia` directly instead of this value, so it can
// never be affected by whatever this function returns.
//
// `window.innerWidth` never changes because of the page's own content: it stays fixed for a given
// browser window size regardless of whether a vertical scrollbar is currently occupying part of
// that width. `document.documentElement.clientWidth`, by contrast, EXCLUDES a classic
// (non-overlay) scrollbar's gutter -- the default scrollbar rendering on Linux/Windows desktop
// Chrome -- so it silently narrows (by the scrollbar width, typically 15-17px) whenever a routed
// page's content grows tall enough to scroll, or whenever a MUI Modal/Drawer/Popover (Dialog,
// Select, the navigation Drawer itself) temporarily locks body scroll and removes that scrollbar.
// `window.innerWidth` is only skipped when it is unavailable or invalid (e.g. some non-browser or
// test environment), in which case the narrowest available fallback is used.
export function getBrowserViewportWidth(): number {
  if (typeof window === 'undefined') {
    return 1440
  }

  if (isUsableWidth(window.innerWidth)) {
    return window.innerWidth
  }

  const fallbackWidths = [
    window.visualViewport?.width,
    typeof document === 'undefined' ? undefined : document.documentElement?.clientWidth,
  ].filter(isUsableWidth)

  return fallbackWidths.length === 0 ? 1440 : Math.min(...fallbackWidths)
}

const DESKTOP_MEDIA_QUERY = `(min-width: ${APP_SHELL_DESKTOP_BREAKPOINT}px)`

// The App Shell's desktop/mobile drawer breakpoint. `matchMedia` evaluates a `min-width` media
// feature against the same viewport CSS itself lays content out against (the "layout viewport",
// which on desktop INCLUDES a classic scrollbar's gutter), so a page whose own content sets a
// pixel width can never feed back into this decision the way it could when the drawer breakpoint
// was derived from a JS-measured content width. See drawerLayout.ts (APP_SHELL_DESKTOP_BREAKPOINT)
// and useIsDesktopViewport.ts (the change-event subscription built on top of this).
export function isDesktopViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches
}
