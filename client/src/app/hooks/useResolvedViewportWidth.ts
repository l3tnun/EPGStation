import { useSyncExternalStore } from 'react'
import { getBrowserViewportWidth } from '../browserAdapters'

function subscribeToViewportWidthChange(onStoreChange: () => void): () => void {
  /* v8 ignore next 3 -- jsdom: subscribe only runs after React has mounted, which needs `window` */
  if (typeof window === 'undefined') {
    return () => undefined
  }

  let resizeObserver: ResizeObserver | undefined

  window.addEventListener('resize', onStoreChange)
  window.addEventListener('orientationchange', onStoreChange)
  window.visualViewport?.addEventListener('resize', onStoreChange)

  if (typeof ResizeObserver !== 'undefined' && typeof document !== 'undefined') {
    resizeObserver = new ResizeObserver(onStoreChange)
    resizeObserver.observe(document.documentElement)
  }

  return () => {
    window.removeEventListener('resize', onStoreChange)
    window.removeEventListener('orientationchange', onStoreChange)
    window.visualViewport?.removeEventListener('resize', onStoreChange)
    resizeObserver?.disconnect()
  }
}

function subscribeToStaticViewportWidth(): () => void {
  return () => undefined
}

// This app only ever mounts through createRoot (see src/main.tsx), never hydrateRoot, so
// useSyncExternalStore's getServerSnapshot argument is never invoked on the client and is
// intentionally omitted here.
export function useResolvedViewportWidth(explicitViewportWidth: number | undefined): number {
  return useSyncExternalStore(
    explicitViewportWidth === undefined
      ? subscribeToViewportWidthChange
      : subscribeToStaticViewportWidth,
    explicitViewportWidth === undefined ? getBrowserViewportWidth : () => explicitViewportWidth,
  )
}
