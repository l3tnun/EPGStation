import type { ScrollPosition } from '../scrollHistory'

function getActiveRouteScrollContainer(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  if (!document.documentElement.classList.contains('fix-address-bar2')) {
    return null
  }

  return document.querySelector<HTMLElement>("[data-testid='shell-main']")
}

export function createBrowserScrollPosition(): ScrollPosition {
  const fixedShellScrollContainer = getActiveRouteScrollContainer()

  if (fixedShellScrollContainer !== null) {
    return {
      x: fixedShellScrollContainer.scrollLeft,
      y: fixedShellScrollContainer.scrollTop,
    }
  }

  return {
    x: typeof window === 'undefined' ? 0 : window.scrollX,
    y: typeof window === 'undefined' ? 0 : window.scrollY,
  }
}

export function scrollActiveRouteTo(position: ScrollPosition): void {
  const fixedShellScrollContainer = getActiveRouteScrollContainer()

  if (fixedShellScrollContainer !== null) {
    if (typeof fixedShellScrollContainer.scrollTo === 'function') {
      fixedShellScrollContainer.scrollTo({
        left: position.x,
        top: position.y,
        behavior: 'auto',
      })
    } else {
      fixedShellScrollContainer.scrollLeft = position.x
      fixedShellScrollContainer.scrollTop = position.y
    }
    return
  }

  if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') {
    return
  }

  window.scrollTo({
    left: position.x,
    top: position.y,
    behavior: 'auto',
  })
}
