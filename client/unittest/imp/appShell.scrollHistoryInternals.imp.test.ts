import { render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createScrollHistory,
  createSessionScrollHistory,
  readCurrentRouteScrollPosition,
  useScrollHistory,
} from '@/app/scrollHistory'

describe('App Shell scroll history missing-provider fallback', () => {
  function captureScrollHistory(): ReturnType<typeof useScrollHistory> {
    let captured: ReturnType<typeof useScrollHistory> | undefined
    function Capture() {
      captured = useScrollHistory()
      return null
    }
    render(createElement(Capture))

    if (captured === undefined) {
      throw new Error('useScrollHistory did not run')
    }

    return captured
  }

  it('exposes safe read-only defaults without a ScrollHistoryProvider ancestor', () => {
    const scrollHistory = captureScrollHistory()

    expect(scrollHistory.isNeedRestoreHistory()).toBe(false)
    expect(scrollHistory.getScrollData()).toBeNull()
    expect(scrollHistory.getHistoryPosition()).toBeNull()
  })

  it('throws from saveScrollData, updateHistoryPosition, and emitDoneGetData without a provider', () => {
    const scrollHistory = captureScrollHistory()

    expect(() => scrollHistory.saveScrollData({ page: 1 })).toThrow('ScrollHistoryProviderMissing')
    expect(() => scrollHistory.updateHistoryPosition()).toThrow('ScrollHistoryProviderMissing')
    expect(() => scrollHistory.emitDoneGetData()).toThrow('ScrollHistoryProviderMissing')
    expect(scrollHistory.clearRestoreHistory()).toBeUndefined()
  })

  it('resolves onDoneGetData to undefined without a ScrollHistoryProvider ancestor', async () => {
    const scrollHistory = captureScrollHistory()

    await expect(scrollHistory.onDoneGetData()).resolves.toBeUndefined()
  })
})

describe('App Shell readCurrentRouteScrollPosition fixed shell branch', () => {
  afterEach(() => {
    document.documentElement.classList.remove('fix-address-bar2')
    document.body.innerHTML = ''
  })

  it('reads the shell-main scroll offsets when the fixed iOS shell is active', () => {
    document.documentElement.classList.add('fix-address-bar2')
    document.body.innerHTML = '<main data-testid="shell-main"></main>'
    const shellMain = document.querySelector<HTMLElement>("[data-testid='shell-main']")!
    Object.defineProperty(shellMain, 'scrollLeft', { configurable: true, value: 3 })
    Object.defineProperty(shellMain, 'scrollTop', { configurable: true, value: 9 })

    expect(readCurrentRouteScrollPosition()).toStrictEqual({ x: 3, y: 9 })
  })

  it('falls back to the window scroll position when the fixed shell has no shell-main element', () => {
    document.documentElement.classList.add('fix-address-bar2')

    expect(readCurrentRouteScrollPosition()).toStrictEqual({
      x: window.scrollX,
      y: window.scrollY,
    })
  })

  it('reads the window scroll position when the fixed iOS shell is not active', () => {
    expect(readCurrentRouteScrollPosition()).toStrictEqual({
      x: window.scrollX,
      y: window.scrollY,
    })
  })
})

describe('App Shell in-memory scroll history implementation edges', () => {
  it('returns null scroll data and history position before anything is saved', () => {
    const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })

    expect(scrollHistory.getScrollData()).toBeNull()
    expect(scrollHistory.getHistoryPosition()).toBeNull()
  })
})

describe('App Shell session scroll history storage recovery', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('recovers from malformed JSON in sessionStorage instead of throwing', () => {
    window.sessionStorage.setItem('historyInfo', '{not valid json')
    window.history.replaceState(null, '', '/#/recorded?timestamp=1')
    const scrollHistory = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => window.location.href,
    })

    expect(() => scrollHistory.updateHistoryPosition()).not.toThrow()
    expect(scrollHistory.isNeedRestoreHistory()).toBe(false)
  })

  it('recovers from a stored shape with a non-array history or non-number position', () => {
    window.sessionStorage.setItem(
      'historyInfo',
      JSON.stringify({ history: 'not-an-array', currentPosition: 'not-a-number' }),
    )
    window.history.replaceState(null, '', '/#/recorded?timestamp=2')
    const scrollHistory = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => window.location.href,
    })

    expect(() => scrollHistory.updateHistoryPosition()).not.toThrow()
    expect(scrollHistory.getHistoryPosition()).toStrictEqual({ x: 0, y: 0 })
  })

  it('drops malformed history entries and malformed positions while keeping valid ones', () => {
    window.sessionStorage.setItem(
      'historyInfo',
      JSON.stringify({
        history: [
          { key: '/valid', url: 'http://localhost/#/valid', data: null, position: { x: 1, y: 2 } },
          {
            key: '/badPosition',
            url: 'http://localhost/#/badPosition',
            data: null,
            position: 'nope',
          },
          'not-an-object',
          null,
          42,
          { url: 'missing-key' },
        ],
        currentPosition: 0,
      }),
    )
    window.history.replaceState(null, '', '/#/valid')
    const scrollHistory = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => window.location.href,
    })

    scrollHistory.updateHistoryPosition()

    expect(scrollHistory.getHistoryPosition()).toStrictEqual({ x: 1, y: 2 })
  })

  it('returns null scroll data and history position before any history entry exists', () => {
    window.history.replaceState(null, '', '/#/recorded?timestamp=fresh')
    const scrollHistory = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => window.location.href,
    })

    expect(scrollHistory.getScrollData()).toBeNull()
    expect(scrollHistory.getHistoryPosition()).toBeNull()
  })

  it('creates a fresh entry the first time scroll data is saved without a prior position update', () => {
    window.history.replaceState(null, '', '/#/recorded?timestamp=save-first')
    const scrollHistory = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => window.location.href,
      scrollPositionProvider: () => ({ x: 0, y: 0 }),
    })

    scrollHistory.saveScrollData({ page: 1 })

    expect(scrollHistory.getScrollData()).toStrictEqual({ page: 1 })
  })

  it('treats a stored null position as a real (not missing) history position', () => {
    window.sessionStorage.setItem(
      'historyInfo',
      JSON.stringify({
        history: [
          {
            key: '/nullPosition',
            url: 'http://localhost/#/nullPosition',
            data: null,
            position: null,
          },
        ],
        currentPosition: 0,
      }),
    )
    window.history.replaceState(null, '', '/#/nullPosition')
    const scrollHistory = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => window.location.href,
    })

    expect(scrollHistory.getHistoryPosition()).toBeNull()
  })

  it('resolves the history key from a non-hash absolute URL', () => {
    let currentUrl = 'https://example.invalid/app/recorded?page=1'
    const scrollHistory = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => currentUrl,
      scrollPositionProvider: () => ({ x: 0, y: 0 }),
    })

    scrollHistory.updateHistoryPosition({ x: 1, y: 1 })
    currentUrl = 'https://example.invalid/app/other'
    scrollHistory.updateHistoryPosition({ x: 2, y: 2 })
    currentUrl = 'https://example.invalid/app/recorded?page=1'
    scrollHistory.updateHistoryPosition()

    expect(scrollHistory.getHistoryPosition()).toStrictEqual({ x: 1, y: 1 })
  })

  it('falls back to the raw URL as the history key when it is not a parseable absolute URL', () => {
    let currentUrl = 'not a url at all'
    const scrollHistory = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => currentUrl,
      scrollPositionProvider: () => ({ x: 0, y: 0 }),
    })

    scrollHistory.updateHistoryPosition({ x: 5, y: 5 })
    currentUrl = 'also not a url'
    scrollHistory.updateHistoryPosition()

    expect(scrollHistory.isNeedRestoreHistory()).toBe(false)
    expect(scrollHistory.getHistoryPosition()).toStrictEqual({ x: 0, y: 0 })
  })

  it('settles onDoneGetData after its timeout elapses without an emit or reset', async () => {
    vi.useFakeTimers()
    window.history.replaceState(null, '', '/#/recorded?timestamp=900')
    const scrollHistory = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => window.location.href,
    })

    scrollHistory.updateHistoryPosition()
    let settled = false
    const completion = scrollHistory.onDoneGetData(50).then(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(60)
    await completion

    expect(settled).toBe(true)
    vi.useRealTimers()
  })
})
