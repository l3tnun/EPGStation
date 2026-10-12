import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react'
import type { Location } from 'react-router-dom'
import { createBrowserLocationHref, createFullRoutePath, parseRoutePath } from '../lib/routePath'
import { createBrowserScrollPosition, scrollActiveRouteTo } from '../lib/routeScroll'
import type { ScrollHistoryState, ScrollPosition } from '../scrollHistory'
import type { ServerApiRepository } from '../serverApi'

export interface RouteScrollRestorationInput {
  location: Location
  timestampNormalizedRoutePath: string | null
  scrollHistory: ScrollHistoryState
  apiRepository: ServerApiRepository | undefined
  isInitialServerConfigResolved: boolean
  refreshVersion: (options: { notifyOnFailure: boolean }) => Promise<void>
  closeSnackbar: () => void
  suppressedRouteSnackbarClosesRef: MutableRefObject<number>
}

export interface RouteScrollRestoration {
  /** Full hash route (pathname + search) of the currently rendered screen. */
  latestFullRouteRef: MutableRefObject<string>
  saveCurrentRouteScrollPosition: (options?: { force?: boolean }) => void
}

function nowMs(): number {
  /* v8 ignore next 3 -- jsdom: exercised by dedicated tests that remove `performance`, but redefining that jsdom global mid-run causes V8 to recompile this function and drop the branch hit it just recorded, so coverage cannot see it here */
  if (typeof performance === 'undefined') {
    return Date.now()
  }

  return performance.now()
}

function useManualBrowserScrollRestoration(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !('scrollRestoration' in window.history)) {
      return
    }

    const previousScrollRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'

    return () => {
      window.history.scrollRestoration = previousScrollRestoration
    }
  }, [])
}

export function useRouteScrollRestoration({
  location,
  timestampNormalizedRoutePath,
  scrollHistory,
  apiRepository,
  isInitialServerConfigResolved,
  refreshVersion,
  closeSnackbar,
  suppressedRouteSnackbarClosesRef,
}: RouteScrollRestorationInput): RouteScrollRestoration {
  const previousRouteKey = useRef<string | undefined>(undefined)
  const previousRouteHref = useRef<string | undefined>(createBrowserLocationHref())
  const latestFullRouteRef = useRef(createFullRoutePath(location))
  const routeScrollApplicationId = useRef(0)
  const isApplyingRouteScroll = useRef(false)
  const pendingPreviousRouteScrollPosition = useRef<
    { href?: string; routeKey: string; position: ScrollPosition } | undefined
  >(undefined)
  const saveCurrentRouteScrollPosition = useCallback(
    (options?: { force?: boolean }) => {
      if (
        isApplyingRouteScroll.current ||
        (options?.force !== true && scrollHistory.isNeedRestoreHistory())
      ) {
        return
      }

      const currentRouteHref = createBrowserLocationHref()
      const currentPosition = createBrowserScrollPosition()
      pendingPreviousRouteScrollPosition.current = {
        href: currentRouteHref,
        routeKey: latestFullRouteRef.current,
        position: currentPosition,
      }
      scrollHistory.updateHistoryPosition(currentPosition, currentRouteHref)
    },
    [scrollHistory],
  )
  const applyRouteScrollPosition = useCallback((position: ScrollPosition, retry = true) => {
    const startedAt = nowMs()
    const retryForMs = 1200

    isApplyingRouteScroll.current = true

    const applyUntilSettled = () => {
      scrollActiveRouteTo(position)

      if (!retry || typeof window === 'undefined') {
        isApplyingRouteScroll.current = false
        return
      }

      const currentPosition = createBrowserScrollPosition()
      const elapsed = nowMs() - startedAt

      if (
        (Math.abs(currentPosition.x - position.x) <= 1 &&
          Math.abs(currentPosition.y - position.y) <= 1) ||
        elapsed >= retryForMs
      ) {
        isApplyingRouteScroll.current = false
        return
      }

      window.requestAnimationFrame(applyUntilSettled)
    }

    applyUntilSettled()
  }, [])
  const clearRestoreHistoryAfterRouteScroll = useCallback(() => {
    /* v8 ignore next 4 -- jsdom: only runs from the mounted-only layout effect below, needs `window` */
    if (typeof window === 'undefined') {
      scrollHistory.clearRestoreHistory()
      return
    }

    window.requestAnimationFrame(() => {
      scrollHistory.clearRestoreHistory()
    })
  }, [scrollHistory])

  useManualBrowserScrollRestoration()

  useEffect(() => {
    /* v8 ignore next 3 -- jsdom: this effect only runs once React has mounted, which needs `document` */
    if (typeof document === 'undefined') {
      return () => undefined
    }

    const saveBeforePotentialRouteChange = () => {
      saveCurrentRouteScrollPosition()
    }
    const saveBeforeKeyboardRouteChange = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return
      }

      saveCurrentRouteScrollPosition()
    }
    // v2's saveScrollPosition() reads page offsets in pushState, while the leaving page is still
    // current. hashchange/popstate are that moment: the layout effect already shows the next page,
    // whose offset on desktop is ~1800 rather than the 640 the user left.
    const captureLeavingScrollPosition = () => {
      if (isApplyingRouteScroll.current) {
        return
      }
      const committedHref = previousRouteHref.current
      if (committedHref === undefined || createBrowserLocationHref() === committedHref) {
        return
      }

      const position = createBrowserScrollPosition()
      pendingPreviousRouteScrollPosition.current = {
        href: committedHref,
        routeKey: latestFullRouteRef.current,
        position,
      }
      scrollHistory.updateHistoryPosition(position, committedHref)
    }

    document.addEventListener('pointerdown', saveBeforePotentialRouteChange, true)
    document.addEventListener('keydown', saveBeforeKeyboardRouteChange, true)
    window.addEventListener('hashchange', captureLeavingScrollPosition, true)
    window.addEventListener('popstate', captureLeavingScrollPosition, true)

    return () => {
      document.removeEventListener('pointerdown', saveBeforePotentialRouteChange, true)
      document.removeEventListener('keydown', saveBeforeKeyboardRouteChange, true)
      window.removeEventListener('hashchange', captureLeavingScrollPosition, true)
      window.removeEventListener('popstate', captureLeavingScrollPosition, true)
    }
  }, [saveCurrentRouteScrollPosition, scrollHistory])

  useEffect(() => {
    /* v8 ignore next 3 -- jsdom: this effect only runs once React has mounted, which needs `window`/`document` */
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return () => undefined
    }

    const saveAfterScroll = () => {
      saveCurrentRouteScrollPosition()
    }
    const shellMain = document.querySelector<HTMLElement>("[data-testid='shell-main']")

    window.addEventListener('scroll', saveAfterScroll, { passive: true })
    shellMain?.addEventListener('scroll', saveAfterScroll, { passive: true })

    return () => {
      window.removeEventListener('scroll', saveAfterScroll)
      shellMain?.removeEventListener('scroll', saveAfterScroll)
    }
  }, [saveCurrentRouteScrollPosition])

  useLayoutEffect(() => {
    const routeLocation =
      timestampNormalizedRoutePath === null
        ? location
        : parseRoutePath(timestampNormalizedRoutePath)
    latestFullRouteRef.current = createFullRoutePath(routeLocation)
    const routeKey = latestFullRouteRef.current
    const currentRouteHref = createBrowserLocationHref()
    const previousRouteKeyValue = previousRouteKey.current
    const isRouteChanged = previousRouteKeyValue !== undefined && previousRouteKeyValue !== routeKey

    if (previousRouteKeyValue === undefined) {
      scrollHistory.updateHistoryPosition(undefined, currentRouteHref)
    } else if (isRouteChanged) {
      if (suppressedRouteSnackbarClosesRef.current > 0) {
        suppressedRouteSnackbarClosesRef.current -= 1
      } else {
        closeSnackbar()
      }
      const pendingPreviousScroll = pendingPreviousRouteScrollPosition.current
      const previousPosition: ScrollPosition | undefined =
        pendingPreviousScroll !== undefined &&
        (pendingPreviousScroll.href === previousRouteHref.current ||
          pendingPreviousScroll.routeKey === previousRouteKeyValue)
          ? pendingPreviousScroll.position
          : undefined
      pendingPreviousRouteScrollPosition.current = undefined
      scrollHistory.updateHistoryPosition(previousPosition, previousRouteHref.current)
      scrollHistory.updateHistoryPosition(undefined, currentRouteHref)
    }

    if (isRouteChanged) {
      if (isInitialServerConfigResolved && apiRepository !== undefined) {
        void Promise.resolve().then(() => refreshVersion({ notifyOnFailure: true }))
      }

      const scrollApplicationId = routeScrollApplicationId.current + 1
      routeScrollApplicationId.current = scrollApplicationId

      if (scrollHistory.isNeedRestoreHistory()) {
        void scrollHistory.onDoneGetData().then(() => {
          if (routeScrollApplicationId.current !== scrollApplicationId) {
            return
          }

          applyRouteScrollPosition(scrollHistory.getHistoryPosition() ?? { x: 0, y: 0 }, true)
          clearRestoreHistoryAfterRouteScroll()
        })
      } else {
        applyRouteScrollPosition({ x: 0, y: 0 }, false)
      }
    }

    previousRouteKey.current = routeKey
    previousRouteHref.current = currentRouteHref
  }, [
    applyRouteScrollPosition,
    clearRestoreHistoryAfterRouteScroll,
    closeSnackbar,
    apiRepository,
    isInitialServerConfigResolved,
    location,
    refreshVersion,
    scrollHistory,
    suppressedRouteSnackbarClosesRef,
    timestampNormalizedRoutePath,
  ])

  return { latestFullRouteRef, saveCurrentRouteScrollPosition }
}
