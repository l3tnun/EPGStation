// v2's equivalent (client/src/views/Search.vue `getTitleHeight()`) reads
// `(this.$refs.title as Vue).$el.clientHeight` directly and unconditionally - the title bar is
// always rendered in v2's template, so that lookup structurally cannot fail. It has no "height is
// unknown" case at all. Mirror that here: default to 0 instead of treating a momentary DOM lookup
// miss as a scroll failure - a wrong offset (falls back to 0) is a much smaller regression than
// aborting the scroll and reporting an error the user cannot act on.
function getTitleBarHeight(): number {
  const titleBar = document.querySelector<HTMLElement>('[data-testid="title-bar"]')

  return titleBar === null ? 0 : titleBar.clientHeight
}

function getActivePageScrollContainer(): HTMLElement | null {
  if (!document.documentElement.classList.contains('fix-address-bar2')) {
    return null
  }

  return document.querySelector<HTMLElement>('[data-testid="shell-main"]')
}

export function scrollToElementHead(
  element: HTMLElement | null,
  options: { offset?: number; behavior?: ScrollBehavior } = {},
): boolean {
  // This is the one condition v2's `scrollToElementHead` (Search.vue) actually reports to the
  // user (`typeof vue === 'undefined'`): the scroll target's component is not mounted at all.
  if (element === null) {
    return false
  }

  const titleBarHeight = getTitleBarHeight()
  const { offset = 0, behavior = 'smooth' } = options

  try {
    const fixedShellScrollContainer = getActivePageScrollContainer()
    if (fixedShellScrollContainer !== null) {
      const containerRect = fixedShellScrollContainer.getBoundingClientRect()
      fixedShellScrollContainer.scrollTo({
        top: Math.max(
          0,
          fixedShellScrollContainer.scrollTop +
            element.getBoundingClientRect().top -
            containerRect.top -
            titleBarHeight -
            offset,
        ),
        behavior,
      })
      return true
    }

    window.scrollTo({
      top: Math.max(
        0,
        element.getBoundingClientRect().top + window.pageYOffset - titleBarHeight - offset,
      ),
      behavior,
    })
  } catch {
    // v2's `scrollToElementHead` has no try/catch anywhere: a thrown `window.scrollTo` is not a
    // condition it ever reports to the user. Swallow it defensively (so a scroll problem can
    // never break the caller) without surfacing a "スクロールに失敗" snackbar for it - the target
    // component was found, which is the only thing v2 actually checks.
  }

  return true
}

export function scrollActivePageToTop(behavior: ScrollBehavior = 'smooth'): boolean {
  try {
    const fixedShellScrollContainer = getActivePageScrollContainer()
    if (fixedShellScrollContainer !== null) {
      fixedShellScrollContainer.scrollTo({ top: 0, behavior })
      return true
    }

    window.scrollTo({ top: 0, behavior })
  } catch {
    return false
  }

  return true
}
