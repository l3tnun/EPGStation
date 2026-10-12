import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createBrowserScrollPosition } from '@/app/lib/routeScroll'
import { installDashboardFetchMock } from './support/appShellSpecSupport'

// This suite pins the retryForMs = 1200 constant in
// client/src/app/hooks/useRouteScrollRestoration.ts (applyRouteScrollPosition). The pre-existing
// [AC 6.16] test in appShell.scrollHistory.spec.test.tsx only checks that requestAnimationFrame
// is called more than once, which passes unchanged whether retryForMs is 1200, 12, or 120000 --
// it verifies that a retry loop exists, not that its budget is any particular size.
//
// Real-device measurement (http://localhost:8888, search results list with 300 hits,
// maxScroll 47944px, keyword=の): after a browser back navigation, the restored scroll position
// converged to within a few px of the saved target within 2-3 animation frames (~31-47ms,
// measured across 10 runs), and the full result list (48744px tall) was already present in the
// very first sampled frame (<15ms). That leaves roughly 1150-1170ms (~25-38x) of headroom under
// the 1200ms budget for this real, non-trivial list -- retryForMs = 1200 is not a tight fit for
// real content.
//
// The tests below prove the budget is nonetheless load-bearing: they simulate a scroll target
// that only becomes reachable after a controlled delay (independent of the real
// scrollActiveRouteTo/createBrowserScrollPosition timing) and show that content reachable well
// inside the budget restores successfully, while content that would only become reachable after
// the budget elapses is never restored -- the hook gives up silently at ~1200ms and does not
// retry further. This also means the test fails if retryForMs drifts outside roughly the
// (900ms, 1500ms) window in either direction: shrink it and the first case starts failing to
// settle; grow it and the second case starts settling instead of giving up.
//
// The delay is measured against `performance.now()` and the retry loop is driven by
// `window.requestAnimationFrame`, both faked together (see the [AC 6.16] test in
// appShell.scrollHistory.spec.test.tsx for the same rationale) so the elapsed time this suite
// asserts on is the simulated clock the retry loop itself advances on, not wall-clock time. That
// removes the host-speed dependency the real-timer version of this suite had: under coverage
// instrumentation or CPU contention, a delayed frame could no longer push the observed
// `elapsedMs` past the boundary this suite checks. Fake timers are enabled only around the click
// that starts the retry loop and `vi.runAllTimersAsync()` drains it -- `waitFor`/`findBy*` are not
// used once fake timers are active (steering testing.md).
vi.mock('@/app/lib/routeScroll', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/routeScroll')>()
  return {
    ...actual,
    createBrowserScrollPosition: vi.fn(actual.createBrowserScrollPosition),
  }
})

const TARGET_POSITION = { x: 0, y: 500 }

interface TimedCall {
  elapsedMs: number
  matched: boolean
}

/**
 * Makes the mocked createBrowserScrollPosition() report a mismatched position until `readyAtMs`
 * has elapsed on the (faked) clock, measured from the moment this function is called, then report
 * a position that exactly matches TARGET_POSITION from then on. Every call is recorded in `calls`
 * with its elapsed time and whether it matched, so the test can inspect the retry loop's last
 * decision. Must be called while `vi.useFakeTimers({ toFake: [..., 'performance'] })` is active so
 * `performance.now()` here reads the same simulated clock the retry loop's own budget check does.
 */
function armDelayedScrollTarget(
  readyAtMs: number,
  target: { x: number; y: number } = TARGET_POSITION,
  mismatch: { x: number; y: number } = { x: 0, y: 0 },
): { calls: TimedCall[] } {
  const calls: TimedCall[] = []
  const start = performance.now()

  vi.mocked(createBrowserScrollPosition).mockImplementation(() => {
    const elapsedMs = performance.now() - start
    const matched = elapsedMs >= readyAtMs
    calls.push({ elapsedMs, matched })

    return matched ? { ...target } : { ...mismatch }
  })

  return { calls }
}

async function renderWithPendingRestore(savedPosition: { x: number; y: number } = TARGET_POSITION) {
  let needsRestore = true
  const scrollHistory = {
    isNeedRestoreHistory: vi.fn(() => needsRestore),
    saveScrollData: vi.fn(),
    getScrollData: vi.fn(() => null),
    getHistoryPosition: vi.fn(() => savedPosition),
    updateHistoryPosition: vi.fn(),
    emitDoneGetData: vi.fn(),
    onDoneGetData: vi.fn(async () => undefined),
    clearRestoreHistory: vi.fn(() => {
      needsRestore = false
    }),
  }

  render(
    <App
      scrollHistory={scrollHistory}
      osPrefersDark={false}
      viewportWidth={1440}
      initialDrawerState="none"
      navigationTimestampProvider={() => 'restore-to'}
    />,
  )

  // Real timers here: the initial App mount (fetch mocks, router settling) is unrelated to the
  // retryForMs budget under test, so it stays on real time. Fake timers are enabled afterwards,
  // only around the navigation click that starts the retry loop.
  await screen.findByRole('heading', { name: '録画済み' })
}

describe('[AC 6.16] readiness-vs-retryForMs boundary for scroll restoration', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded?timestamp=retry-budget')
    installDashboardFetchMock()
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/#/')
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('restores the scroll position when it becomes reachable well inside the 1200ms budget', async () => {
    await renderWithPendingRestore()

    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    try {
      const { calls } = armDelayedScrollTarget(900)

      // The route-change layout effect (useRouteScrollRestoration.ts) calls
      // applyRouteScrollPosition synchronously within this click's act() flush; its first
      // createBrowserScrollPosition() call already lands in `calls` before runAllTimersAsync runs.
      fireEvent.click(screen.getByTestId('navigation-item-settings'))
      // Drains the requestAnimationFrame retry chain deterministically: it keeps firing frames on
      // the simulated clock until the loop itself decides to stop (match or 1200ms budget), so no
      // real waiting or polling is involved.
      await vi.runAllTimersAsync()

      const last = calls.at(-1)
      expect(last).toBeDefined()
      expect(last?.matched).toBe(true)
      // Settled shortly after the target became reachable, comfortably inside the 1200ms budget.
      expect(last?.elapsedMs).toBeGreaterThanOrEqual(900)
      expect(last?.elapsedMs).toBeLessThan(1150)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up silently, never restoring, when the target would only become reachable after the 1200ms budget elapses', async () => {
    await renderWithPendingRestore()

    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    try {
      const { calls } = armDelayedScrollTarget(1500)

      fireEvent.click(screen.getByTestId('navigation-item-settings'))
      await vi.runAllTimersAsync()

      const last = calls.at(-1)
      expect(last).toBeDefined()
      // The loop stopped retrying at ~1200ms -- well before the target would have become
      // reachable at 1500ms -- so its last observation is still a mismatch.
      expect(last?.matched).toBe(false)
      expect(last?.elapsedMs).toBeGreaterThanOrEqual(1150)
      expect(last?.elapsedMs).toBeLessThan(1500)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps retrying while only the horizontal position differs from the saved position', async () => {
    const savedPosition = { x: 200, y: 500 }
    await renderWithPendingRestore(savedPosition)

    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    try {
      // The vertical position matches from the first frame; only x differs until 300ms.
      const { calls } = armDelayedScrollTarget(300, savedPosition, { x: 0, y: savedPosition.y })

      fireEvent.click(screen.getByTestId('navigation-item-settings'))
      await vi.runAllTimersAsync()

      const last = calls.at(-1)
      expect(last).toBeDefined()
      expect(last?.matched).toBe(true)
      expect(last?.elapsedMs).toBeGreaterThanOrEqual(300)
      expect(last?.elapsedMs).toBeLessThan(1150)
    } finally {
      vi.useRealTimers()
    }
  })
})
