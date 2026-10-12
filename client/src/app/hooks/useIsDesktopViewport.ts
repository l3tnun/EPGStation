import { useSyncExternalStore } from 'react'
import { APP_SHELL_DESKTOP_BREAKPOINT } from '../drawerLayout'
import { isDesktopViewport } from '../browserAdapters'

function subscribeToDesktopViewportChange(onStoreChange: () => void): () => void {
  /* v8 ignore next 3 -- jsdom: subscribe only runs after React has mounted, which needs `window` */
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined
  }

  const mediaQueryList = window.matchMedia(`(min-width: ${APP_SHELL_DESKTOP_BREAKPOINT}px)`)
  mediaQueryList.addEventListener('change', onStoreChange)

  return () => {
    mediaQueryList.removeEventListener('change', onStoreChange)
  }
}

function subscribeToStaticDesktopViewport(): () => void {
  return () => undefined
}

// Mirrors useResolvedViewportWidth.ts: when the caller (AppRoot, ultimately AppProps.viewportWidth)
// supplies an explicit width -- the seam every deterministic App Shell test in
// `client/unittest/spec` renders through -- the desktop/mobile decision is the same static
// threshold comparison it always was, with no subscription. Only when no explicit width is given
// (a real browser) does this read the live `matchMedia` state and subscribe to its `change` event,
// so the App Shell's own desktop breakpoint decision never depends on a JS-measured content width
// and a feedback loop between the measured width and the layout it decides cannot arise.
//
// This app only ever mounts through createRoot (see src/main.tsx), never hydrateRoot, so
// useSyncExternalStore's getServerSnapshot argument is never invoked on the client and is
// intentionally omitted here.
export function useIsDesktopViewport(explicitViewportWidth: number | undefined): boolean {
  return useSyncExternalStore(
    explicitViewportWidth === undefined
      ? subscribeToDesktopViewportChange
      : subscribeToStaticDesktopViewport,
    explicitViewportWidth === undefined
      ? isDesktopViewport
      : () => explicitViewportWidth >= APP_SHELL_DESKTOP_BREAKPOINT,
  )
}
