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

  it('drops entries without a key or url and keeps an entry with a null position', () => {
    const valid = { key: '/ok', url: 'http://localhost/#/ok', data: null, position: { x: 9, y: 8 } }
    window.sessionStorage.setItem(
      'historyInfo',
      JSON.stringify({
        history: [
          { url: 'http://localhost/#/a', data: null, position: { x: 1, y: 1 } },
          { key: '/b', data: null, position: { x: 2, y: 2 } },
          valid,
        ],
        currentPosition: 0,
      }),
    )
    const dropped = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => 'http://localhost/#/ok',
    })
    expect(dropped.getHistoryPosition()).toStrictEqual({ x: 9, y: 8 })

    window.sessionStorage.setItem(
      'historyInfo',
      JSON.stringify({
        history: [{ key: '/n', url: 'http://localhost/#/n', data: null, position: null }, valid],
        currentPosition: 0,
      }),
    )
    const kept = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => 'http://localhost/#/n',
    })
    expect(kept.getHistoryPosition()).toBeNull()
  })

  it.each([
    ['a history that is not an array', { history: 'x', currentPosition: 0 }],
    ['a position that is not a number', { history: [], currentPosition: '0' }],
    ['a position that is missing', { history: [] }],
  ])('starts a new history for %s', (_label, stored) => {
    window.sessionStorage.setItem('historyInfo', JSON.stringify(stored))
    const history = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => 'http://localhost/#/fresh',
    })

    history.updateHistoryPosition({ x: 3, y: 4 })

    expect(history.getHistoryPosition()).toStrictEqual({ x: 3, y: 4 })
  })

  it('starts a new history when the stored text is not JSON', () => {
    window.sessionStorage.setItem('historyInfo', '{broken')
    const history = createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => 'http://localhost/#/fresh',
    })

    history.updateHistoryPosition({ x: 3, y: 4 })

    expect(history.getHistoryPosition()).toStrictEqual({ x: 3, y: 4 })
  })
})

describe('App Shell session scroll history navigation', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  function create(urlRef: { current: string }) {
    return createSessionScrollHistory({
      storage: window.sessionStorage,
      locationProvider: () => urlRef.current,
      scrollPositionProvider: () => ({ x: 0, y: 0 }),
    })
  }
  const stored = () =>
    JSON.parse(window.sessionStorage.getItem('historyInfo') ?? '{}') as {
      history: { key: string; url: string; data: unknown; position: unknown }[]
      currentPosition: number
    }

  it('asks to restore only when it moves back to an earlier entry', () => {
    const url = { current: 'http://localhost/#/a' }
    const history = create(url)

    history.updateHistoryPosition({ x: 1, y: 1 })
    url.current = 'http://localhost/#/b'
    history.updateHistoryPosition({ x: 2, y: 2 })
    expect(history.isNeedRestoreHistory()).toBe(false)

    history.updateHistoryPosition({ x: 3, y: 3 })
    expect(history.isNeedRestoreHistory()).toBe(false)

    url.current = 'http://localhost/#/a'
    history.updateHistoryPosition()
    expect(history.isNeedRestoreHistory()).toBe(true)
    expect(history.getHistoryPosition()).toStrictEqual({ x: 1, y: 1 })
  })

  it('stores the new position and current entry when it returns to an existing entry', () => {
    const url = { current: 'http://localhost/#/a' }
    const history = create(url)

    history.updateHistoryPosition({ x: 1, y: 1 })
    url.current = 'http://localhost/#/b'
    history.updateHistoryPosition({ x: 2, y: 2 })
    url.current = 'http://localhost/#/a'
    history.updateHistoryPosition({ x: 5, y: 6 })

    expect(stored().currentPosition).toBe(0)
    expect(stored().history[0].position).toStrictEqual({ x: 5, y: 6 })
  })

  it('saves scroll data under an explicit URL by moving to that URL first', () => {
    const url = { current: 'http://localhost/#/a' }
    const history = create(url)

    history.updateHistoryPosition({ x: 1, y: 1 })
    history.saveScrollData({ page: 2 }, 'http://localhost/#/b')

    expect(stored().history.map((entry) => entry.key)).toStrictEqual(['/a', '/b'])
    expect(stored().history[0].data).toBeNull()
    expect(stored().history[1].data).toStrictEqual({ page: 2 })
    expect(history.getScrollData()).toStrictEqual({ page: 2 })
  })

  it('saves scroll data into the current entry when the explicit URL is the current one', () => {
    const url = { current: 'http://localhost/#/a' }
    const history = create(url)

    history.updateHistoryPosition({ x: 1, y: 1 })
    history.saveScrollData({ page: 2 }, 'http://localhost/#/a')

    expect(stored().history).toHaveLength(1)
    expect(stored().history[0].data).toStrictEqual({ page: 2 })
  })

  it('discards the entries after the current one when a new URL is visited', () => {
    const url = { current: 'http://localhost/#/a' }
    const history = create(url)

    history.updateHistoryPosition({ x: 1, y: 1 })
    url.current = 'http://localhost/#/b'
    history.updateHistoryPosition({ x: 2, y: 2 })
    url.current = 'http://localhost/#/a'
    history.updateHistoryPosition()
    url.current = 'http://localhost/#/c'
    history.updateHistoryPosition({ x: 3, y: 3 })

    expect(stored().history.map((entry) => entry.key)).toStrictEqual(['/a', '/c'])
    expect(stored().currentPosition).toBe(1)
  })
})
