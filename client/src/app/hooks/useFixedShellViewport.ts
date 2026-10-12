import { useEffect, useLayoutEffect, type ReactNode } from 'react'

const FIXED_TITLE_BAR_SELECTOR = "[data-testid='title-bar'], [data-testid='edit-title-bar']"
const FIXED_VIEWPORT_CONTROL_SELECTOR = 'button, [role="button"], a'
// The navigation drawer's content is its own scroll container. Its items sit in a position: fixed
// paper, but a drag that starts on one must stay a native scroll of that container: cancelling it
// leaves a menu taller than the visible area unreachable.
const DRAWER_SCROLL_CONTAINER_SELECTOR = "[data-testid='shell-drawer-content']"

function isFixedIOSShell(): boolean {
  return document.documentElement.classList.contains('fix-address-bar2')
}

function clampFixedShellOuterScroll(): void {
  if (!isFixedIOSShell()) {
    return
  }

  const hasOuterScroll =
    window.scrollX !== 0 ||
    window.scrollY !== 0 ||
    document.documentElement.scrollTop !== 0 ||
    document.documentElement.scrollLeft !== 0 ||
    document.body.scrollTop !== 0 ||
    document.body.scrollLeft !== 0

  document.documentElement.scrollTop = 0
  document.documentElement.scrollLeft = 0
  document.body.scrollTop = 0
  document.body.scrollLeft = 0

  if (hasOuterScroll && typeof window.scrollTo === 'function') {
    window.scrollTo({ left: 0, top: 0, behavior: 'auto' })
  }
}

// Exported so features whose own geometry-affecting transitions do not themselves produce a
// `resize` / `orientationchange` / `visualViewport` `resize`/`scroll` event (the CSS-only video
// fullscreen fallback in src/features/video/playback/hooks/usePlaybackFullscreen.ts is the first
// caller) can force an immediate resync instead of waiting for one of those events. This matters
// on iPadOS standalone (home-screen) PWAs: WebKit can leave `window.visualViewport.height` /
// `window.innerHeight` holding a stale cold-launch value until the viewport has been "exercised"
// by a real geometry change such as a device rotation -- see
// .kiro/specs/frontend-video-playback/requirements.md 6d.
export function syncViewportHeightVariable(): void {
  /* v8 ignore next 3 -- jsdom/SSR: guards a call before `window`/`document` exist */
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  clampFixedShellOuterScroll()

  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    document.documentElement.style.removeProperty('--app-viewport-height')
    return
  }

  document.documentElement.style.setProperty('--app-viewport-height', `${viewportHeight}px`)
}

export function useViewportHeightVariable(): void {
  useLayoutEffect(() => {
    /* v8 ignore next 3 -- jsdom: this effect only runs once React has mounted, which needs `window`/`document` */
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return () => undefined
    }

    let animationFrameId = 0

    const scheduleViewportHeightUpdate = () => {
      clampFixedShellOuterScroll()
      window.cancelAnimationFrame(animationFrameId)
      animationFrameId = window.requestAnimationFrame(syncViewportHeightVariable)
    }

    syncViewportHeightVariable()
    window.addEventListener('resize', scheduleViewportHeightUpdate)
    window.addEventListener('orientationchange', scheduleViewportHeightUpdate)
    window.visualViewport?.addEventListener('resize', scheduleViewportHeightUpdate)
    window.visualViewport?.addEventListener('scroll', scheduleViewportHeightUpdate)

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', scheduleViewportHeightUpdate)
      window.removeEventListener('orientationchange', scheduleViewportHeightUpdate)
      window.visualViewport?.removeEventListener('resize', scheduleViewportHeightUpdate)
      window.visualViewport?.removeEventListener('scroll', scheduleViewportHeightUpdate)
      document.documentElement.style.removeProperty('--app-viewport-height')
    }
  }, [])
}

export function useFixedTitleBarHeightVariable(children: ReactNode): void {
  useLayoutEffect(() => {
    /* v8 ignore next 3 -- jsdom: this effect only runs once React has mounted, which needs `document` */
    if (typeof document === 'undefined') {
      return () => undefined
    }

    let observer: ResizeObserver | undefined

    const setTitleBarHeight = () => {
      const titleBar = document.querySelector<HTMLElement>(FIXED_TITLE_BAR_SELECTOR)

      if (titleBar === null) {
        document.documentElement.style.removeProperty('--app-title-bar-height')
        return
      }

      document.documentElement.style.setProperty(
        '--app-title-bar-height',
        `${titleBar.getBoundingClientRect().height}px`,
      )
    }

    const observeTitleBar = () => {
      observer?.disconnect()
      observer = undefined
      setTitleBarHeight()

      const titleBar = document.querySelector<HTMLElement>(FIXED_TITLE_BAR_SELECTOR)
      if (titleBar !== null && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(setTitleBarHeight)
        observer.observe(titleBar)
      }
    }

    // Publish the measured height in the same layout pass so the first paint never falls back
    // to the CSS default; the observer attaches on the next frame.
    setTitleBarHeight()
    const animationFrameId = window.requestAnimationFrame(observeTitleBar)

    return () => {
      window.cancelAnimationFrame(animationFrameId)

      observer?.disconnect()
      document.documentElement.style.removeProperty('--app-title-bar-height')
    }
  }, [children])
}

export function useFixedTitleBarTouchScrollBridge(): void {
  useEffect(() => {
    /* v8 ignore next 3 -- jsdom: this effect only runs once React has mounted, which needs `document` */
    if (typeof document === 'undefined') {
      return () => undefined
    }

    let activeTouchMode: 'title-bar' | 'fixed-control' | null = null
    let lastTouchY = 0

    const getShellMain = () => document.querySelector<HTMLElement>("[data-testid='shell-main']")
    const isFixedViewportControl = (target: Element) => {
      const control = target.closest(FIXED_VIEWPORT_CONTROL_SELECTOR)
      if (control === null) {
        return false
      }

      const shellMain = getShellMain()
      for (
        let element: Element | null = control;
        element !== null;
        element = element.parentElement
      ) {
        if (element.matches(DRAWER_SCROLL_CONTAINER_SELECTOR)) {
          return false
        }

        if (window.getComputedStyle(element).position === 'fixed') {
          return true
        }

        if (shellMain !== null && element === shellMain) {
          return false
        }
      }

      return false
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (!isFixedIOSShell() || !(event.target instanceof Element)) {
        activeTouchMode = null
        return
      }

      if (event.target.closest(FIXED_TITLE_BAR_SELECTOR) !== null) {
        activeTouchMode = 'title-bar'
        lastTouchY = event.touches[0]?.clientY ?? 0
        return
      }

      activeTouchMode = isFixedViewportControl(event.target) ? 'fixed-control' : null
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (activeTouchMode === null || !isFixedIOSShell()) {
        return
      }

      if (activeTouchMode === 'fixed-control') {
        event.preventDefault()
        clampFixedShellOuterScroll()
        return
      }

      const currentTouchY = event.touches[0]?.clientY
      const shellMain = getShellMain()
      if (currentTouchY === undefined || shellMain === null) {
        return
      }

      const deltaY = lastTouchY - currentTouchY
      lastTouchY = currentTouchY
      shellMain.scrollTop += deltaY
      event.preventDefault()
    }

    const handleTouchEnd = () => {
      activeTouchMode = null
    }

    document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true })
    document.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false })
    document.addEventListener('touchend', handleTouchEnd, { capture: true })
    document.addEventListener('touchcancel', handleTouchEnd, { capture: true })

    return () => {
      document.removeEventListener('touchstart', handleTouchStart, { capture: true })
      document.removeEventListener('touchmove', handleTouchMove, { capture: true })
      document.removeEventListener('touchend', handleTouchEnd, { capture: true })
      document.removeEventListener('touchcancel', handleTouchEnd, { capture: true })
    }
  }, [])
}
