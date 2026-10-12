import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { useScrollHistory } from '@/app/scrollHistory'
import { installDashboardFetchMock } from './support/appShellSpecSupport'

describe('Requirement 6.1-6.16 version, connection, and scroll history contracts', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/')
    installDashboardFetchMock()
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/#/')
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  it('[AC 6.14] provides one shared scroll history contract to routed screens', () => {
    const scrollHistory = {
      isNeedRestoreHistory: vi.fn(() => false),
      saveScrollData: vi.fn(),
      getScrollData: vi.fn(() => null),
      getHistoryPosition: vi.fn(() => null),
      updateHistoryPosition: vi.fn(),
      emitDoneGetData: vi.fn(),
      onDoneGetData: vi.fn(async () => undefined),
      clearRestoreHistory: vi.fn(),
    }

    function ScrollHistoryConsumer() {
      const consumedScrollHistory = useScrollHistory()
      consumedScrollHistory.saveScrollData({ screen: 'synthetic' })

      return <p>scroll history consumer</p>
    }

    render(
      <App
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      >
        <ScrollHistoryConsumer />
      </App>,
    )

    expect(screen.getByText('scroll history consumer')).toBeVisible()
    expect(scrollHistory.saveScrollData).toHaveBeenCalledWith({ screen: 'synthetic' })
  })

  it('[AC 6.14] initializes the default scroll history entry before a routed screen saves data', async () => {
    window.history.replaceState(null, '', '/#/guide?timestamp=initial')

    function ScrollHistoryConsumer() {
      const consumedScrollHistory = useScrollHistory()
      useEffect(() => {
        consumedScrollHistory.saveScrollData({ screen: 'initial-route' })
      }, [consumedScrollHistory])

      return <p>initial scroll consumer</p>
    }

    render(
      <App osPrefersDark={false} viewportWidth={1440} initialDrawerState="none">
        <ScrollHistoryConsumer />
      </App>,
    )

    await waitFor(() => {
      expect(window.sessionStorage.getItem('historyInfo')).toContain('initial-route')
    })
  })

  it('[AC 6.7] resets the active page scroll position on normal route navigation', async () => {
    window.history.replaceState(null, '', '/#/recorded?timestamp=from')
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    render(
      <App
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        navigationTimestampProvider={() => 'to'}
      />,
    )

    await screen.findByRole('heading', { name: '録画済み' })
    scrollToSpy.mockClear()

    fireEvent.click(screen.getByTestId('navigation-item-settings'))

    await waitFor(() => {
      expect(window.location.hash).toBe('#/settings?timestamp=to')
    })
    expect(scrollToSpy).toHaveBeenCalledWith({ left: 0, top: 0, behavior: 'auto' })
  })

  it('[AC 6.18] lets the app shell own browser history scroll restoration', async () => {
    window.history.scrollRestoration = 'auto'

    const { unmount } = render(
      <App osPrefersDark={false} viewportWidth={1440} initialDrawerState="none" />,
    )

    await screen.findByTestId('app-shell')
    expect(window.history.scrollRestoration).toBe('manual')

    unmount()

    expect(window.history.scrollRestoration).toBe('auto')
  })

  it('[AC 5.16] normalizes every non-root route to include timestamp for scroll history keys', async () => {
    window.history.replaceState(null, '', '/#/recorded?keyword=synthetic')

    render(<App osPrefersDark={false} viewportWidth={1440} initialDrawerState="none" />)

    await waitFor(() => {
      expect(window.location.hash).toMatch(/^#\/recorded\?keyword=synthetic&timestamp=\d+$/)
    })
  })

  it('[AC 6.16] retries applying a restored scroll position until it settles, then clears the restore flag', async () => {
    window.history.replaceState(null, '', '/#/recorded?timestamp=restore-from')
    let needsRestore = true
    const scrollHistory = {
      isNeedRestoreHistory: vi.fn(() => needsRestore),
      saveScrollData: vi.fn(),
      getScrollData: vi.fn(() => null),
      getHistoryPosition: vi.fn(() => ({ x: 0, y: 500 })),
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

    await screen.findByRole('heading', { name: '録画済み' })

    // window.scrollTo is a jsdom no-op, so the restored (0, 500) target never actually settles on
    // the first attempt: `applyRouteScrollPosition` (useRouteScrollRestoration.ts) recurses through
    // `requestAnimationFrame` until either it settles or a real 1200ms budget measured with
    // `performance.now()` elapses. Left on real timers, each frame's actual firing time -- and so
    // how many retries fit inside that 1200ms budget -- depends on how fast the host schedules
    // frame callbacks: under CPU contention a single delayed frame can push the elapsed time past
    // 1200ms before a second retry is even scheduled, which would leave `rafSpy.mock.calls.length`
    // at 1 instead of the ">1" this test requires. Faking `requestAnimationFrame` and `performance`
    // together ties the retry budget to the same simulated clock the frames advance on, so the
    // number of retries this test observes does not depend on real frame timing. `setTimeout`
    // stays real so the `waitFor` below keeps polling normally.
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    try {
      fireEvent.click(screen.getByTestId('navigation-item-settings'))
      // `runAllTimersAsync` drains the retry chain (and the microtask it starts from) until no
      // more fake timers are pending, so both mocks below are already settled synchronously here
      // -- `waitFor`'s real-time polling would only be needed if something were still pending.
      await vi.runAllTimersAsync()

      expect(scrollHistory.clearRestoreHistory).toHaveBeenCalled()
      expect(rafSpy.mock.calls.length).toBeGreaterThan(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('[AC 6.14] saves the current scroll position on pointerdown, Enter/Space keydown, and window scroll', async () => {
    window.history.replaceState(null, '', '/#/recorded?timestamp=save-triggers')
    const updateHistoryPosition = vi.fn()
    const scrollHistory = {
      isNeedRestoreHistory: vi.fn(() => false),
      saveScrollData: vi.fn(),
      getScrollData: vi.fn(() => null),
      getHistoryPosition: vi.fn(() => null),
      updateHistoryPosition,
      emitDoneGetData: vi.fn(),
      onDoneGetData: vi.fn(async () => undefined),
      clearRestoreHistory: vi.fn(),
    }

    render(
      <App
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByRole('heading', { name: '録画済み' })
    updateHistoryPosition.mockClear()

    fireEvent.pointerDown(document.body)
    expect(updateHistoryPosition).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document.body, { key: 'a' })
    expect(updateHistoryPosition).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(updateHistoryPosition).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(document.body, { key: ' ' })
    expect(updateHistoryPosition).toHaveBeenCalledTimes(3)

    fireEvent.scroll(window)
    expect(updateHistoryPosition).toHaveBeenCalledTimes(4)
  })

  it('[AC 6.7] [AC 6.14] restores the exact pre-navigation scroll position captured just before the route change', async () => {
    window.history.replaceState(null, '', '/#/recorded?timestamp=from-key')
    const updateHistoryPosition = vi.fn()
    const scrollHistory = {
      isNeedRestoreHistory: vi.fn(() => false),
      saveScrollData: vi.fn(),
      getScrollData: vi.fn(() => null),
      getHistoryPosition: vi.fn(() => null),
      updateHistoryPosition,
      emitDoneGetData: vi.fn(),
      onDoneGetData: vi.fn(async () => undefined),
      clearRestoreHistory: vi.fn(),
    }

    render(
      <App
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        navigationTimestampProvider={() => 'to-key'}
      />,
    )

    await screen.findByRole('heading', { name: '録画済み' })

    // Capture a pending scroll position for the current route (href still matches the previous
    // route's href at the time the route-change effect consumes it), then navigate away.
    fireEvent.pointerDown(document.body)
    fireEvent.click(screen.getByTestId('navigation-item-settings'))

    await waitFor(() => {
      expect(window.location.hash).toBe('#/settings?timestamp=to-key')
    })

    const previousRouteCalls = updateHistoryPosition.mock.calls.filter(
      ([position, url]) =>
        position !== undefined && typeof url === 'string' && url.includes('/recorded'),
    )
    expect(previousRouteCalls.at(-1)?.[0]).toStrictEqual({ x: window.scrollX, y: window.scrollY })
  })

  it('[AC 6.7] [AC 6.14] matches the pending previous position by routeKey when the raw href drifted since the last route commit', async () => {
    window.history.replaceState(null, '', '/#/recorded?timestamp=route-key-match')
    const updateHistoryPosition = vi.fn()
    const scrollHistory = {
      isNeedRestoreHistory: vi.fn(() => false),
      saveScrollData: vi.fn(),
      getScrollData: vi.fn(() => null),
      getHistoryPosition: vi.fn(() => null),
      updateHistoryPosition,
      emitDoneGetData: vi.fn(),
      onDoneGetData: vi.fn(async () => undefined),
      clearRestoreHistory: vi.fn(),
    }

    render(
      <App
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        navigationTimestampProvider={() => 'route-key-match-to'}
      />,
    )

    await screen.findByRole('heading', { name: '録画済み' })

    // Change the raw browser href (bypassing React Router) so createBrowserLocationHref() returns
    // something different from what the last route-change effect recorded, then capture a pending
    // scroll position against that drifted href. The href comparison then misses and the match
    // must fall through to comparing the captured routeKey instead.
    window.history.replaceState(null, '', '/#/recorded?timestamp=route-key-match&drifted=1')
    fireEvent.pointerDown(document.body)

    fireEvent.click(screen.getByTestId('navigation-item-settings'))

    await waitFor(() => {
      expect(window.location.hash).toBe('#/settings?timestamp=route-key-match-to')
    })

    const previousRouteCalls = updateHistoryPosition.mock.calls.filter(
      ([position, url]) =>
        position !== undefined && typeof url === 'string' && url.includes('/recorded'),
    )
    expect(previousRouteCalls.at(-1)?.[0]).toStrictEqual({ x: window.scrollX, y: window.scrollY })
  })

  it('[AC 6.14] keeps the leaving scroll when the next page offset is already larger', async () => {
    window.history.replaceState(null, '', '/#/recorded?timestamp=post-navigation-offset')
    const updateHistoryPosition = vi.fn()
    const scrollHistory = {
      isNeedRestoreHistory: vi.fn(() => false),
      saveScrollData: vi.fn(),
      getScrollData: vi.fn(() => null),
      getHistoryPosition: vi.fn(() => null),
      updateHistoryPosition,
      emitDoneGetData: vi.fn(),
      onDoneGetData: vi.fn(async () => undefined),
      clearRestoreHistory: vi.fn(),
    }
    let shellMain: HTMLElement | null = null
    const moveToNextPageOffset = () => {
      if (shellMain !== null) {
        shellMain.scrollTop = 1992
      }
    }

    try {
      render(
        <App
          scrollHistory={scrollHistory}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
          navigationTimestampProvider={() => 'post-navigation-offset-to'}
        />,
      )

      await screen.findByRole('heading', { name: '録画済み' })
      document.documentElement.classList.add('fix-address-bar2')
      shellMain = document.querySelector<HTMLElement>('[data-testid="shell-main"]')
      expect(shellMain).not.toBeNull()
      if (shellMain === null) {
        return
      }
      Object.defineProperty(shellMain, 'scrollHeight', { configurable: true, value: 4000 })
      Object.defineProperty(shellMain, 'clientHeight', { configurable: true, value: 664 })
      shellMain.scrollTop = 640
      fireEvent.scroll(shellMain)
      // Runs after the hook's capture listener and before React's bubble popstate handler,
      // so the layout effect observes the next page's offset.
      window.addEventListener('popstate', moveToNextPageOffset, true)

      act(() => {
        window.location.hash = '#/settings?timestamp=post-navigation-offset-to'
        window.dispatchEvent(new PopStateEvent('popstate'))
      })

      await waitFor(() => {
        expect(
          updateHistoryPosition.mock.calls.some(
            ([, url]) => typeof url === 'string' && url.includes('/settings'),
          ),
        ).toBe(true)
      })

      const previousRouteCalls = updateHistoryPosition.mock.calls.filter(
        ([position, url]) =>
          position !== undefined && typeof url === 'string' && url.includes('/recorded'),
      )
      expect(previousRouteCalls.at(-1)?.[0]).toStrictEqual({ x: 0, y: 640 })
    } finally {
      window.removeEventListener('popstate', moveToNextPageOffset, true)
      document.documentElement.classList.remove('fix-address-bar2')
    }
  })

  it('[AC 6.14] records a shell offset that moved after the scroll event and before hash navigation', async () => {
    window.history.replaceState(null, '', '/#/recorded?timestamp=anchored-scroll')
    const updateHistoryPosition = vi.fn()
    const scrollHistory = {
      isNeedRestoreHistory: vi.fn(() => false),
      saveScrollData: vi.fn(),
      getScrollData: vi.fn(() => null),
      getHistoryPosition: vi.fn(() => null),
      updateHistoryPosition,
      emitDoneGetData: vi.fn(),
      onDoneGetData: vi.fn(async () => undefined),
      clearRestoreHistory: vi.fn(),
    }

    try {
      render(
        <App
          scrollHistory={scrollHistory}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
          navigationTimestampProvider={() => 'anchored-scroll-to'}
        />,
      )

      await screen.findByRole('heading', { name: '録画済み' })
      document.documentElement.classList.add('fix-address-bar2')
      const shellMain = document.querySelector<HTMLElement>('[data-testid="shell-main"]')
      expect(shellMain).not.toBeNull()
      if (shellMain === null) {
        return
      }
      Object.defineProperty(shellMain, 'scrollHeight', { configurable: true, value: 4000 })
      Object.defineProperty(shellMain, 'clientHeight', { configurable: true, value: 664 })
      shellMain.scrollTop = 640
      fireEvent.scroll(shellMain)
      shellMain.scrollTop = 806

      act(() => {
        window.location.hash = '#/settings?timestamp=anchored-scroll-to'
        window.dispatchEvent(new PopStateEvent('popstate'))
      })

      await waitFor(() => {
        expect(
          updateHistoryPosition.mock.calls.some(
            ([, url]) => typeof url === 'string' && url.includes('/settings'),
          ),
        ).toBe(true)
      })

      const previousRouteCalls = updateHistoryPosition.mock.calls.filter(
        ([position, url]) =>
          position !== undefined && typeof url === 'string' && url.includes('/recorded'),
      )
      expect(previousRouteCalls.at(-1)?.[0]).toStrictEqual({ x: 0, y: 806 })
    } finally {
      document.documentElement.classList.remove('fix-address-bar2')
    }
  })

  it('[AC 6.14] ignores a popstate that arrives while a restore scroll is applying', async () => {
    window.history.replaceState(null, '', '/#/recorded?timestamp=apply-popstate')
    const updateHistoryPosition = vi.fn()
    const scrollHistory = {
      isNeedRestoreHistory: vi.fn(() => true),
      saveScrollData: vi.fn(),
      getScrollData: vi.fn(() => null),
      getHistoryPosition: vi.fn(() => ({ x: 0, y: 500 })),
      updateHistoryPosition,
      emitDoneGetData: vi.fn(),
      onDoneGetData: vi.fn(async () => undefined),
      clearRestoreHistory: vi.fn(),
    }
    let armed = false
    let nested = false
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {
      if (!armed || nested) {
        return
      }
      nested = true
      window.location.hash = '#/encode?timestamp=during-apply'
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    try {
      render(
        <App
          scrollHistory={scrollHistory}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
          navigationTimestampProvider={() => 'apply-popstate-to'}
        />,
      )

      await screen.findByRole('heading', { name: '録画済み' })
      armed = true
      const callsBeforeRestore = updateHistoryPosition.mock.calls.length

      fireEvent.click(screen.getByTestId('navigation-item-settings'))

      await waitFor(() => {
        expect(scrollTo).toHaveBeenCalled()
      })

      const duringApply = updateHistoryPosition.mock.calls.slice(callsBeforeRestore)
      expect(
        duringApply.some(
          ([position, url]) =>
            position !== undefined &&
            typeof url === 'string' &&
            url.includes('/encode?timestamp=during-apply'),
        ),
      ).toBe(false)
    } finally {
      scrollTo.mockRestore()
    }
  })

  it('[AC 6.16] falls back to (0, 0) when history restore is needed but no position was ever saved', async () => {
    window.history.replaceState(null, '', '/#/recorded?timestamp=no-saved-position')
    const scrollHistory = {
      isNeedRestoreHistory: vi.fn(() => true),
      saveScrollData: vi.fn(),
      getScrollData: vi.fn(() => null),
      getHistoryPosition: vi.fn(() => null),
      updateHistoryPosition: vi.fn(),
      emitDoneGetData: vi.fn(),
      onDoneGetData: vi.fn(async () => undefined),
      clearRestoreHistory: vi.fn(),
    }

    render(
      <App
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        navigationTimestampProvider={() => 'to-no-saved-position'}
      />,
    )

    await screen.findByRole('heading', { name: '録画済み' })

    fireEvent.click(screen.getByTestId('navigation-item-settings'))

    await waitFor(() => {
      expect(scrollHistory.clearRestoreHistory).toHaveBeenCalled()
    })
  })

  it('[AC 5.16] keeps the root route without timestamp when accessed directly', async () => {
    window.history.replaceState(null, '', '/#/')

    render(<App osPrefersDark={false} viewportWidth={1440} initialDrawerState="none" />)

    await screen.findByTestId('app-shell')
    expect(window.location.hash).toBe('#/')
  })
  it('[AC 6.7] applies a route scroll reset without crashing when the performance API is unavailable', async () => {
    window.history.replaceState(null, '', '/#/recorded?timestamp=from')

    render(
      <App
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        navigationTimestampProvider={() => 'to'}
      />,
    )

    await screen.findByRole('heading', { name: '録画済み' })

    // Stub only across the synchronous click handling (which runs the route-change layout effect
    // that reads performance.now()) and restore immediately after, so jsdom's own internal
    // requestAnimationFrame plumbing (used by other App Shell effects) keeps a real performance
    // object for any callback it fires later.
    vi.stubGlobal('performance', undefined)
    try {
      fireEvent.click(screen.getByTestId('navigation-item-settings'))
    } finally {
      vi.unstubAllGlobals()
    }

    await waitFor(() => {
      expect(window.location.hash).toBe('#/settings?timestamp=to')
    })
  })

  it('[AC 6.16] settles an already-matching restored scroll position on the first attempt without the performance API', async () => {
    window.history.replaceState(null, '', '/#/recorded?timestamp=from-settled')
    const scrollHistory = {
      isNeedRestoreHistory: vi.fn(() => true),
      saveScrollData: vi.fn(),
      getScrollData: vi.fn(() => null),
      getHistoryPosition: vi.fn(() => ({ x: window.scrollX, y: window.scrollY })),
      updateHistoryPosition: vi.fn(),
      emitDoneGetData: vi.fn(),
      onDoneGetData: vi.fn(async () => undefined),
      clearRestoreHistory: vi.fn(),
    }

    render(
      <App
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        navigationTimestampProvider={() => 'to-settled'}
      />,
    )

    await screen.findByRole('heading', { name: '録画済み' })

    const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance')
    // Stub only across the synchronous click handling: the target position already matches the
    // current (untouched) scroll position, so the route-change layout effect settles on its first
    // synchronous check without ever scheduling a requestAnimationFrame retry, which lets us
    // remove `performance` without disturbing jsdom's own (performance-dependent) rAF plumbing
    // used by other App Shell effects.
    Object.defineProperty(globalThis, 'performance', { configurable: true, value: undefined })
    try {
      fireEvent.click(screen.getByTestId('navigation-item-settings'))
    } finally {
      if (performanceDescriptor !== undefined) {
        Object.defineProperty(globalThis, 'performance', performanceDescriptor)
      }
    }

    await waitFor(() => {
      expect(scrollHistory.clearRestoreHistory).toHaveBeenCalled()
    })
  })
})
