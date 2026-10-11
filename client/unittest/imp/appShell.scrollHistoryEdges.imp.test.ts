import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createScrollHistory, createSessionScrollHistory } from '@/app/scrollHistory'

async function settlesWithin(promise: Promise<void>): Promise<boolean> {
  let settled = false
  void promise.then(() => {
    settled = true
  })
  await Promise.resolve()
  await Promise.resolve()
  return settled
}

describe('App Shell in-memory scroll history updates', () => {
  it('returns saved scroll data and restores only while requested', () => {
    const history = createScrollHistory({ shouldRestoreHistory: true })

    expect(history.isNeedRestoreHistory()).toBe(true)
    history.saveScrollData({ page: 3 })
    expect(history.getScrollData()).toStrictEqual({ page: 3 })
    history.clearRestoreHistory()
    expect(history.isNeedRestoreHistory()).toBe(false)
  })

  it('replaces the history position when one is given and keeps it when omitted', () => {
    const history = createScrollHistory({
      shouldRestoreHistory: false,
      initialScrollPosition: { x: 1, y: 2 },
    })

    expect(history.getHistoryPosition()).toStrictEqual({ x: 1, y: 2 })
    history.updateHistoryPosition({ x: 5, y: 6 })
    expect(history.getHistoryPosition()).toStrictEqual({ x: 5, y: 6 })
    history.updateHistoryPosition()
    expect(history.getHistoryPosition()).toStrictEqual({ x: 5, y: 6 })
  })

  it('wakes a pending onDoneGetData waiter when the position is updated', async () => {
    vi.useFakeTimers()
    try {
      const history = createScrollHistory({ shouldRestoreHistory: false })
      const pending = history.onDoneGetData(60000)

      history.updateHistoryPosition({ x: 0, y: 0 })

      expect(await settlesWithin(pending)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('forgets an earlier emit once the position is updated', async () => {
    vi.useFakeTimers()
    try {
      const history = createScrollHistory({ shouldRestoreHistory: false })

      history.emitDoneGetData()
      history.updateHistoryPosition({ x: 0, y: 0 })

      expect(await settlesWithin(history.onDoneGetData(60000))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('App Shell session scroll history stored entry validation', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('drops every entry with a malformed shape or position and keeps the valid one', () => {
    const valid = { key: '/ok', url: 'http://localhost/#/ok', data: null, position: { x: 9, y: 8 } }
    const entryWith = (position?: unknown) => ({
      key: '/bad',
      url: 'http://localhost/#/bad',
      data: null,
      ...(position === undefined ? {} : { position }),
    })
    window.sessionStorage.setItem(
      'historyInfo',
      JSON.stringify({
        history: [
          entryWith(),
          entryWith('nope'),
          entryWith({ x: 1 }),
          entryWith({ y: 1 }),
          entryWith({ x: '1', y: 2 }),
          entryWith({ x: 1, y: '2' }),
          null,
          'junk',
          42,
          valid,
        ],
        currentPosition: 0,
      }),
    )
    const history = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => 'http://localhost/#/ok',
    })

    expect(history.getHistoryPosition()).toStrictEqual({ x: 9, y: 8 })
  })
})
