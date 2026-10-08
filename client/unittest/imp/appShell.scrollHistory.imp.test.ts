import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createScrollHistory,
  createSessionScrollHistory,
  restoreScrollHistoryBeforeVisible,
} from '@/app/scrollHistory'

describe('App Shell scroll history implementation edges', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('stores scroll data and applies it only for browser history restore', async () => {
    const scrollHistory = createScrollHistory({
      shouldRestoreHistory: true,
    })
    const restore = vi.fn()

    scrollHistory.saveScrollData({ x: 10, y: 240 })
    const restorePromise = restoreScrollHistoryBeforeVisible(scrollHistory, restore)

    expect(restore).not.toHaveBeenCalled()

    scrollHistory.emitDoneGetData()
    await restorePromise

    expect(restore).toHaveBeenCalledWith({ x: 10, y: 240 })
  })

  it('does not apply saved scroll data during normal navigation', async () => {
    const scrollHistory = createScrollHistory({
      shouldRestoreHistory: false,
    })
    const restore = vi.fn()

    scrollHistory.saveScrollData({ x: 0, y: 400 })
    const restorePromise = restoreScrollHistoryBeforeVisible(scrollHistory, restore)
    scrollHistory.emitDoneGetData()
    await restorePromise

    expect(restore).not.toHaveBeenCalled()
  })

  it('keeps sessionStorage history per timestamp route and restores the matching entry once', async () => {
    window.history.replaceState(null, '', '/#/recorded?timestamp=100')
    const firstScrollHistory = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => window.location.href,
    })

    firstScrollHistory.updateHistoryPosition({ x: 0, y: 100 })
    firstScrollHistory.saveScrollData({ page: 1 })

    window.history.replaceState(null, '', '/#/recorded?timestamp=200')
    firstScrollHistory.updateHistoryPosition({ x: 0, y: 200 })
    firstScrollHistory.saveScrollData({ page: 2 })

    window.history.replaceState(null, '', '/#/recorded?timestamp=100')
    const restoredScrollHistory = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => window.location.href,
    })

    restoredScrollHistory.updateHistoryPosition()

    expect(restoredScrollHistory.isNeedRestoreHistory()).toBe(true)
    expect(restoredScrollHistory.getScrollData()).toStrictEqual({ page: 1 })
    expect(restoredScrollHistory.getHistoryPosition()).toStrictEqual({ x: 0, y: 100 })

    const restore = vi.fn()
    const restorePromise = restoreScrollHistoryBeforeVisible(restoredScrollHistory, restore)
    restoredScrollHistory.emitDoneGetData()
    await restorePromise

    expect(restore).toHaveBeenCalledWith({ page: 1 })
    expect(restoredScrollHistory.isNeedRestoreHistory()).toBe(false)
  })

  it('resets data completion for each navigation entry', async () => {
    window.history.replaceState(null, '', '/#/recorded?timestamp=300')
    const scrollHistory = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => window.location.href,
    })

    scrollHistory.updateHistoryPosition()
    scrollHistory.emitDoneGetData()
    await expect(scrollHistory.onDoneGetData(1)).resolves.toBeUndefined()

    window.history.replaceState(null, '', '/#/recorded?timestamp=400')
    scrollHistory.updateHistoryPosition()
    const completion = scrollHistory.onDoneGetData(100)
    let completed = false
    completion.then(() => {
      completed = true
    })

    await Promise.resolve()
    expect(completed).toBe(false)

    scrollHistory.emitDoneGetData()
    await completion
    expect(completed).toBe(true)
  })

  it('does not overwrite screen-owned scroll data when route scroll position is updated', () => {
    window.history.replaceState(null, '', '/#/guide?timestamp=500')
    const scrollHistory = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => window.location.href,
    })

    scrollHistory.updateHistoryPosition()
    scrollHistory.saveScrollData({ topChannel: 'synthetic-channel', page: 3 })
    scrollHistory.updateHistoryPosition({ x: 10, y: 640 })

    expect(scrollHistory.getScrollData()).toStrictEqual({
      topChannel: 'synthetic-channel',
      page: 3,
    })
    expect(scrollHistory.getHistoryPosition()).toStrictEqual({ x: 10, y: 640 })
  })

  it('can update a previous route position without overwriting the current route entry', () => {
    let currentUrl = 'http://localhost/#/recorded?timestamp=100'
    const scrollHistory = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => currentUrl,
    })

    scrollHistory.updateHistoryPosition({ x: 0, y: 100 })
    scrollHistory.saveScrollData({ page: 1 })
    currentUrl = 'http://localhost/#/recorded?timestamp=200'
    scrollHistory.updateHistoryPosition({ x: 0, y: 200 })
    scrollHistory.saveScrollData({ page: 2 })

    scrollHistory.updateHistoryPosition(
      { x: 10, y: 640 },
      'http://localhost/#/recorded?timestamp=100',
    )
    scrollHistory.updateHistoryPosition(undefined, currentUrl)

    expect(scrollHistory.getScrollData()).toStrictEqual({ page: 2 })
    expect(scrollHistory.getHistoryPosition()).toStrictEqual({ x: 0, y: 200 })

    currentUrl = 'http://localhost/#/recorded?timestamp=100'
    scrollHistory.updateHistoryPosition()

    expect(scrollHistory.getScrollData()).toStrictEqual({ page: 1 })
    expect(scrollHistory.getHistoryPosition()).toStrictEqual({ x: 10, y: 640 })
  })

  it('keeps same-timestamp list pages as separate browser history entries', () => {
    let currentUrl = 'http://localhost/#/rule?timestamp=100&page=1'
    const scrollHistory = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => currentUrl,
    })

    scrollHistory.updateHistoryPosition({ x: 0, y: 100 })
    currentUrl = 'http://localhost/#/rule?timestamp=100&page=2'
    scrollHistory.updateHistoryPosition({ x: 0, y: 200 })
    currentUrl = 'http://localhost/#/rule?timestamp=100&page=3'
    scrollHistory.updateHistoryPosition({ x: 0, y: 300 })

    currentUrl = 'http://localhost/#/rule?timestamp=100&page=2'
    scrollHistory.updateHistoryPosition()

    expect(scrollHistory.isNeedRestoreHistory()).toBe(true)
    expect(scrollHistory.getHistoryPosition()).toStrictEqual({ x: 0, y: 200 })

    scrollHistory.clearRestoreHistory()
    currentUrl = 'http://localhost/#/rule?timestamp=100&page=1'
    scrollHistory.updateHistoryPosition()

    expect(scrollHistory.isNeedRestoreHistory()).toBe(true)
    expect(scrollHistory.getHistoryPosition()).toStrictEqual({ x: 0, y: 100 })
  })

  it('settles and clears pending completion timeout when a new navigation resets the signal', async () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    window.history.replaceState(null, '', '/#/recorded?timestamp=600')
    const scrollHistory = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => window.location.href,
    })

    scrollHistory.updateHistoryPosition()
    let isSettled = false
    const waitForCompletion = scrollHistory.onDoneGetData(5000).then(() => {
      isSettled = true
    })

    window.history.replaceState(null, '', '/#/recorded?timestamp=700')
    scrollHistory.updateHistoryPosition()

    await waitForCompletion
    expect(isSettled).toBe(true)
    expect(clearTimeoutSpy).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
