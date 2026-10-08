import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
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

  it('[AC 2.31] scrolls to search results after submit and moves the result link to rule options', async () => {
    window.history.replaceState(null, '', '/#/search')
    const searchRuleRepository = createSearchRuleRepository()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      function getBoundingClientRect(this: Element) {
        const element = this as HTMLElement
        const top =
          element.getAttribute('aria-label') === '検索結果'
            ? 240
            : element.dataset.testid === 'search-rule-option-anchor'
              ? 640
              : 0

        return {
          x: 0,
          y: top,
          width: 0,
          height: 0,
          top,
          right: 0,
          bottom: top,
          left: 0,
          toJSON: () => ({}),
        } as DOMRect
      },
    )

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

    expect(await screen.findByRole('heading', { name: '検索' })).toBeVisible()
    fireEvent.change(screen.getByLabelText('keyword'), { target: { value: 'Synthetic' } })
    fireEvent.click(
      within(screen.getByRole('region', { name: '検索条件' })).getByRole('button', {
        name: '検索',
      }),
    )
    const result = await screen.findByRole('region', { name: '検索結果' })
    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 240, behavior: 'smooth' })
    })

    fireEvent.click(within(result).getByRole('button', { name: '録画設定へ移動' }))
    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 640, behavior: 'smooth' })
    })
  })

  it('[AC 2.31] scrolls Search submit results inside the fixed iOS shell container', async () => {
    window.history.replaceState(null, '', '/#/search')
    const searchRuleRepository = createSearchRuleRepository()
    const windowScrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function clientHeight(
      this: HTMLElement,
    ) {
      return this.dataset.testid === 'title-bar' ? 56 : 0
    })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      function getBoundingClientRect(this: Element) {
        const element = this as HTMLElement
        const top =
          element.dataset.testid === 'shell-main'
            ? 0
            : element.getAttribute('aria-label') === '検索結果'
              ? 360
              : 0

        return {
          x: 0,
          y: top,
          width: 0,
          height: 0,
          top,
          right: 0,
          bottom: top,
          left: 0,
          toJSON: () => ({}),
        } as DOMRect
      },
    )

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={390}
        initialDrawerState="none"
      />,
    )

    const shellMain = await screen.findByTestId('shell-main')
    document.documentElement.classList.add('fix-address-bar2')
    Object.defineProperty(shellMain, 'scrollTop', {
      configurable: true,
      value: 120,
      writable: true,
    })
    const shellScrollTo = vi.fn()
    Object.defineProperty(shellMain, 'scrollTo', {
      configurable: true,
      value: shellScrollTo,
    })

    fireEvent.change(screen.getByLabelText('keyword'), { target: { value: 'Synthetic' } })
    fireEvent.click(
      within(screen.getByRole('region', { name: '検索条件' })).getByRole('button', {
        name: '検索',
      }),
    )

    expect(await screen.findByRole('region', { name: '検索結果' })).toBeVisible()
    await waitFor(() => {
      expect(shellScrollTo).toHaveBeenCalledWith({ top: 424, behavior: 'smooth' })
    })
    expect(windowScrollTo).not.toHaveBeenCalled()
  })
})
