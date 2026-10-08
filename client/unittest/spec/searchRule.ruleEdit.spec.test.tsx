import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { SearchRuleApiRepository } from '@/features/search/rule/api'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository, createSearchRuleRepository } from './searchRuleSupport'

describe('Search route lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.documentElement.classList.remove('fix-address-bar2')
  })

  it('[AC 1.2][AC 1.17][AC 1.20] uses rule edit title when rule query exists and reports search/scroll failures', async () => {
    window.history.replaceState(null, '', '/#/search?rule=55&keyword=Ignored')
    const searchRuleRepository: SearchRuleApiRepository = {
      searchSchedules: vi.fn(async () => ({
        ok: false as const,
        error: 'search-failed' as const,
        message: '検索に失敗',
      })),
      fetchReserveIndex: vi.fn(async () => ({ ok: true as const, value: {} })),
      addProgramReserve: vi.fn(),
      deleteReserve: vi.fn(),
      unlockSkipReserve: vi.fn(),
      unlockOverlapReserve: vi.fn(),
      addRule: vi.fn(),
      updateRule: vi.fn(),
      fetchRule: vi.fn(),
      fetchRuleReserves: vi.fn(),
      fetchRules: vi.fn(),
      enableRule: vi.fn(),
      disableRule: vi.fn(),
      deleteRule: vi.fn(),
    }

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByRole('heading', { name: 'ルール編集' })).toBeVisible()
    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).not.toHaveBeenCalled()
    })

    cleanup()
    window.history.replaceState(null, '', '/#/search?keyword=Broken')
    // The search-failure snackbar closes on a 5 second wall-clock timer. Read it under fake
    // timers instead of polling, so the assertion never races the host.
    vi.useFakeTimers()
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('検索に失敗')).toBeVisible()
    vi.useRealTimers()
    expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(1)
    fireEvent.click(
      within(screen.getByRole('region', { name: '検索条件' })).getByRole('button', {
        name: '検索',
      }),
    )
    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(2)
    })

    const successRepository = createSearchRuleRepository()
    cleanup()
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={successRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )
    // v2's equivalent (client/src/views/Search.vue `scrollToRuleOption()` /
    // `scrollToElementHead()`) only ever reports a failure when the target component's ref is
    // undefined - it has no try/catch around the actual `window.scrollTo` call, so a thrown
    // scrollTo is not a condition v2 surfaces to the user. A prior version of this test asserted
    // a "スクロールに失敗" snackbar for exactly that thrown-scrollTo case, which pinned a v3-only
    // regression (see searchRule.scrollAndRuleFailures.spec.test.tsx's scroll-to-top test, fixed
    // the same way) where a scroll-computation problem could surface a user-facing error v2 never
    // has. The rule-option link's target (the anchor rendered inside the search-result section)
    // is present here, so per v2 parity this must stay silent.
    const header = await screen.findByRole('region', { name: '検索結果' })
    const scrollButton = within(header).getByRole('button', { name: '録画設定へ移動' })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {
      throw new Error('synthetic scroll failure')
    })
    fireEvent.click(scrollButton)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByText('スクロールに失敗')).not.toBeInTheDocument()
  })

  it('[AC 2.22] honors the rule edit auto-scroll setting when loading EPG rule results', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    const enabledRepository = createSearchRuleRepository()
    window.history.replaceState(null, '', '/#/search?rule=55')
    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isEnableAutoScrollWhenEditingRule: true,
        }}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={enabledRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const enabledResult = await screen.findByRole('region', { name: '検索結果' })
    await waitFor(() => {
      expect(enabledRepository.searchSchedules).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    })
    expect(enabledResult).toBeVisible()

    cleanup()
    scrollTo.mockClear()
    const disabledRepository = createSearchRuleRepository()
    window.history.replaceState(null, '', '/#/search?rule=55')
    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isEnableAutoScrollWhenEditingRule: false,
        }}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={disabledRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const disabledResult = await screen.findByRole('region', { name: '検索結果' })
    await waitFor(() => {
      expect(disabledRepository.searchSchedules).toHaveBeenCalled()
    })
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    expect(scrollTo).not.toHaveBeenCalled()
    expect(disabledResult).toBeVisible()
  })

  it('[AC 2.22] auto-scrolls a query-driven /search?keyword= result even when the rule edit auto-scroll setting is off', async () => {
    // v2 `Search.vue` always calls `this.search(true)` for `isQuerySearch` (line ~379), never
    // gating that call on `isEnableAutoScrollWhenEditingRule` - that setting only ever gates the
    // EPG rule edit preload branch (`this.search(this.setting.getSavedValue()...)`, line ~377).
    // Query-driven auto-search must therefore scroll unconditionally.
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
    const searchRuleRepository = createSearchRuleRepository()

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isEnableAutoScrollWhenEditingRule: false,
        }}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const result = await screen.findByRole('region', { name: '検索結果' })
    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    })
    expect(result).toBeVisible()
  })

  it('[AC 2.22] uses the original title-offset scroll position for rule edit auto-scroll', async () => {
    window.history.replaceState(null, '', '/#/search?rule=55')
    const searchRuleRepository = createSearchRuleRepository()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function clientHeight(
      this: HTMLElement,
    ) {
      return (this as HTMLElement).dataset.testid === 'title-bar' ? 56 : 0
    })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      function getBoundingClientRect(this: Element) {
        const element = this as HTMLElement
        if (element.getAttribute('aria-label') === '検索結果') {
          return {
            x: 0,
            y: 320,
            width: 100,
            height: 80,
            top: 320,
            right: 100,
            bottom: 400,
            left: 0,
            toJSON: () => ({}),
          } as DOMRect
        }

        return {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          toJSON: () => ({}),
        } as DOMRect
      },
    )

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isEnableAutoScrollWhenEditingRule: true,
        }}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByRole('region', { name: '検索結果' })).toBeVisible()
    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 264, behavior: 'smooth' })
    })
  })

  it('[AC 2.21][AC 2.22] uses the saved Settings auto-scroll value when opening an EPG rule edit route', async () => {
    window.history.replaceState(null, '', '/#/search?rule=55')
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnableAutoScrollWhenEditingRule: false,
      }),
    )
    const searchRuleRepository = createSearchRuleRepository()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    render(
      <App
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByRole('region', { name: '検索結果' })).toBeVisible()
    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).toHaveBeenCalled()
    })
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('[AC 2.23] keeps initial rule-edit auto-scroll when opened from a reserve menu handoff', async () => {
    window.history.replaceState(null, '', '/#/search?rule=55')
    const searchRuleRepository = createSearchRuleRepository()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isEnableAutoScrollWhenEditingRule: true,
        }}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByRole('region', { name: '検索結果' })).toBeVisible()
    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    })
  })
})
