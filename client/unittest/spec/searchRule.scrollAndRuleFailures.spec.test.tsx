import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { SearchRulePage } from '@/features/search/rule'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  SyntheticRealtimeConnection,
  createShellRepository,
  createSearchRuleRepository,
} from './searchRuleSupport'

describe('Search route lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.documentElement.classList.remove('fix-address-bar2')
  })

  it('[AC 2.13] scrolls to the top of the page and stays silent when it cannot scroll', async () => {
    // v2's equivalent (client/src/views/Search.vue `scrollToTop()` in the EPGStation v2 tree)
    // calls `window.scrollTo` directly and never
    // reports a failure for this button: there is no try/catch and no snackbar call in that
    // method, unlike the ref-based `scrollToElementHead()` used for the search-result and
    // rule-option scroll actions. A prior version of this test asserted the opposite (a
    // "スクロールに失敗" snackbar on a thrown scrollTo), which matched a v3-only regression where
    // any scroll failure - including this FAB, which v2 never guards - surfaced a user-facing
    // error. That regression is what let a failed scroll cascade into visibly breaking the page;
    // this test now pins the corrected, v2-matching behavior: best-effort and silent.
    window.history.replaceState(null, '', '/#/search')
    const searchRuleRepository = createSearchRuleRepository()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

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

    const scrollFab = await screen.findByRole('button', { name: 'トップへ戻る' })
    fireEvent.click(scrollFab)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })

    scrollTo.mockImplementation(() => {
      throw new Error('synthetic scroll-to-top failure')
    })
    fireEvent.click(scrollFab)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByText('スクロールに失敗')).not.toBeInTheDocument()
  })

  it('[AC 2.7] reports a snackbar when the rule detail fetch fails during rule edit', async () => {
    window.history.replaceState(null, '', '/#/search?rule=55')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.fetchRule).mockResolvedValueOnce({
      ok: false,
      error: 'rule-fetch-failed',
      message: 'ルール取得に失敗',
    })

    // The rule-fetch failure snackbar closes on a 5 second wall-clock timer. Read it under fake
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
    expect(screen.getByText('ルール取得に失敗')).toBeVisible()
    vi.useRealTimers()
  })

  it('[AC 2.7] reports a snackbar when the time-specified reserves fetch fails', async () => {
    window.history.replaceState(null, '', '/#/search?rule=56')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.fetchRule).mockResolvedValueOnce({
      ok: true,
      value: {
        id: 56,
        isTimeSpecification: true,
        searchOption: { times: [{ week: 0x7f }] },
        reserveOption: {
          enable: true,
          allowEndLack: true,
          avoidDuplicate: false,
          periodToAvoidDuplicate: null,
        },
        saveOption: { parentDirectoryName: null, directory: null, recordedFormat: null },
      },
    })
    vi.mocked(searchRuleRepository.fetchRuleReserves).mockResolvedValueOnce({
      ok: false,
      error: 'rule-reserves-fetch-failed',
      message: '時刻指定予約の取得に失敗',
    })

    // fetchRuleReserves is a react-query dependent query: it only starts once fetchRule's
    // result lets useSearchRuleQueries compute ruleReservesRuleId on a later render, and the
    // resulting failure snackbar then closes on a 5 second wall-clock timer. Advance enough for
    // that dependent-query render chain to settle, then read the alert synchronously.
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
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(screen.getByText('時刻指定予約の取得に失敗')).toBeVisible()
    vi.useRealTimers()
  })

  it('[AC 2.11] reports the fixed refresh-failure text, not the raw message, once the time-specified reserves have already loaded', async () => {
    window.history.replaceState(null, '', '/#/search?rule=56')
    const searchRuleRepository = createSearchRuleRepository()
    const connection = new SyntheticRealtimeConnection()
    vi.mocked(searchRuleRepository.fetchRule).mockResolvedValue({
      ok: true,
      value: {
        id: 56,
        isTimeSpecification: true,
        searchOption: { times: [{ week: 0x7f }] },
        reserveOption: {
          enable: true,
          allowEndLack: true,
          avoidDuplicate: false,
          periodToAvoidDuplicate: null,
        },
        saveOption: { parentDirectoryName: null, directory: null, recordedFormat: null },
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        realtimeConnectionFactory={() => connection}
      />,
    )

    // Wait for the first (successful, empty) reserves fetch to actually commit, not just for the
    // mock to have been called: the fetch promise resolving and react-query/effects committing
    // that data are two different moments, and the next step's failure must land after the first
    // one has been recorded as a success. The empty-reserves header renders nothing visible (see
    // TimeSpecifiedReserveSection, which hides the "予約数" heading entirely at zero reserves), so
    // this waits on the mocked call settling instead of on DOM text.
    await waitFor(() => {
      expect(searchRuleRepository.fetchRuleReserves).toHaveBeenCalledTimes(1)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    vi.mocked(searchRuleRepository.fetchRuleReserves).mockResolvedValueOnce({
      ok: false,
      error: 'rule-reserves-fetch-failed',
      message: '時刻指定予約の取得に失敗',
    })
    vi.useFakeTimers()
    connection.emit('updateStatus')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(screen.getByText('予約情報更新に失敗')).toBeVisible()
    expect(screen.queryByText('時刻指定予約の取得に失敗')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('[AC 2.7] resets time-specification state and the active request when navigating between rule edits', async () => {
    window.history.replaceState(null, '', '/#/search?rule=55')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.fetchRule).mockImplementation(async (ruleId: number) => ({
      ok: true,
      value: {
        id: ruleId,
        isTimeSpecification: false,
        searchOption: { keyword: `Rule ${ruleId}`, times: [{ week: 0x7f }] },
        reserveOption: {
          enable: true,
          allowEndLack: true,
          avoidDuplicate: false,
          periodToAvoidDuplicate: null,
        },
        saveOption: { parentDirectoryName: null, directory: null, recordedFormat: null },
      },
    }))

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
      expect(searchRuleRepository.fetchRule).toHaveBeenCalledWith(55, true)
    })

    window.location.hash = '#/search?rule=56'
    await waitFor(() => {
      expect(searchRuleRepository.fetchRule).toHaveBeenCalledWith(56, true)
    })
    expect(await screen.findByRole('heading', { name: 'ルール編集' })).toBeVisible()
  })

  it('[AC 2.10] reports the fixed refresh-failure text, not the raw search message, when the initial search never succeeds and the Socket.IO refetch also fails', async () => {
    // v2's `updateSocketIoState()` (Search.vue, 211-227 行目) always shows `検索情報更新に失敗` for a
    // Socket.IO `updateStatus` triggered refetch failure - it decides purely by which method is
    // running (the initial `search()` call vs. the socket handler), never by whether a search has
    // ever succeeded. v3's prior approximation instead asked "has a search ever succeeded"
    // (`hasSuccessfulSearchResultRef`), which is indistinguishable from v2's rule in every case
    // except this one: an initial search that fails and is never followed by a success. This test
    // pins that edge case so a regression back to the success-based approximation is caught.
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
    const searchRuleRepository = createSearchRuleRepository()
    const connection = new SyntheticRealtimeConnection()
    // The Socket.IO triggered refetch reuses the same query key as the initial fetch, so
    // react-query's structural sharing would otherwise treat a byte-identical second failure as
    // "no change" and never re-run the effect that picks the message. Returning a distinguishable
    // raw message on the second call keeps the query's data reference changing (matching how a
    // second real HTTP failure would carry its own response object) without changing what this
    // test actually checks: the second failure's *displayed* text must be the fixed refresh
    // message regardless of the raw message the API returned.
    vi.mocked(searchRuleRepository.searchSchedules).mockResolvedValueOnce({
      ok: false,
      error: 'search-failed',
      message: '検索に失敗',
    })
    vi.mocked(searchRuleRepository.searchSchedules).mockResolvedValue({
      ok: false,
      error: 'search-failed',
      message: '検索に失敗(再試行)',
    })

    vi.useFakeTimers()
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        realtimeConnectionFactory={() => connection}
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('検索に失敗')).toBeVisible()
    // Let the failure snackbar's own 5 second timeout elapse so the next assertion reads the
    // Socket.IO-triggered snackbar, not a stale render of the first one.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    connection.emit('updateStatus')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(2)
    expect(screen.getByText('検索情報更新に失敗')).toBeVisible()
    expect(screen.queryByText('検索に失敗')).not.toBeInTheDocument()
    expect(screen.queryByText('検索に失敗(再試行)')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('[AC 2.11] reports the fixed refresh-failure text, not the raw message, when the initial rule-reserves fetch never succeeds and the Socket.IO refetch also fails', async () => {
    // Same divergence as the AC 2.10 test above, for the time-specified rule edit's rule-reserves
    // fetch: v2's `updateSocketIoState()` always shows `予約情報更新に失敗` for a Socket.IO triggered
    // refetch failure regardless of whether the initial fetch ever succeeded, but v3's prior
    // `hasSuccessfulRuleReservesRef` approximation kept showing the raw initial-fetch message
    // (`予約情報取得に失敗`) once the initial fetch had failed and never succeeded.
    window.history.replaceState(null, '', '/#/search?rule=57')
    const searchRuleRepository = createSearchRuleRepository()
    const connection = new SyntheticRealtimeConnection()
    vi.mocked(searchRuleRepository.fetchRule).mockResolvedValue({
      ok: true,
      value: {
        id: 57,
        isTimeSpecification: true,
        searchOption: { times: [{ week: 0x7f }] },
        reserveOption: {
          enable: true,
          allowEndLack: true,
          avoidDuplicate: false,
          periodToAvoidDuplicate: null,
        },
        saveOption: { parentDirectoryName: null, directory: null, recordedFormat: null },
      },
    })
    // See the AC 2.10 test above for why the second failure must be a distinguishable raw
    // message: react-query's structural sharing would otherwise treat a byte-identical repeat
    // failure as unchanged data and never re-run the message-selection effect a second time.
    vi.mocked(searchRuleRepository.fetchRuleReserves).mockResolvedValueOnce({
      ok: false,
      error: 'rule-reserves-fetch-failed',
      message: '時刻指定予約の取得に失敗',
    })
    vi.mocked(searchRuleRepository.fetchRuleReserves).mockResolvedValue({
      ok: false,
      error: 'rule-reserves-fetch-failed',
      message: '時刻指定予約の取得に失敗(再試行)',
    })

    vi.useFakeTimers()
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        realtimeConnectionFactory={() => connection}
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(screen.getByText('時刻指定予約の取得に失敗')).toBeVisible()

    connection.emit('updateStatus')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(searchRuleRepository.fetchRuleReserves).toHaveBeenCalledTimes(2)
    expect(screen.getByText('予約情報更新に失敗')).toBeVisible()
    expect(screen.queryByText('時刻指定予約の取得に失敗')).not.toBeInTheDocument()
    expect(screen.queryByText('時刻指定予約の取得に失敗(再試行)')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('[Fix #40] does not repeat the search failure snackbar when an unrelated re-render replays the same settled failure', async () => {
    // Regression test for the failure branch of `useSearchResultEffects.ts`, which needs a guard
    // against re-entering for the exact same settled `currentSearchResponse`, like
    // the success branch a few lines above it (`initializedRuleOptionSerialRef` guards the
    // option-draft rebuild, `needsResultScrollRef` guards the scroll attempt). `settings`/
    // `encodeModes` are two of that effect's dependencies; an unrelated re-render that hands down a
    // new-but-equal-content object/array for either of them - the same re-render shape the [AC 2.9]
    // tests above pin for the route effects - re-ran the whole effect body for the same failed
    // response and fired a second failure snackbar even though `searchSchedules` was never called
    // again.
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.searchSchedules).mockResolvedValue({
      ok: false,
      error: 'search-failed',
      message: '検索に失敗',
    })
    const onSnackbar = vi.fn()

    function Harness() {
      const [replayTick, setReplayTick] = useState(0)

      return (
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          searchRuleApiRepository={searchRuleRepository}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        >
          <button type="button" onClick={() => setReplayTick((tick) => tick + 1)}>
            replay-unrelated-rerender
          </button>
          <SearchRulePage
            apiRepository={searchRuleRepository}
            encodeModes={replayTick === 0 ? ['Synthetic Encode'] : ['Synthetic Encode']}
            enabledBroadcastWaves={['GR', 'BS', 'CS']}
            isNavigationOpen={false}
            onSnackbar={onSnackbar}
            onNavigationClick={vi.fn()}
            recordedDirectories={['Synthetic Rule']}
            settings={new DefaultSettingsFactory().create()}
          />
        </App>
      )
    }

    render(<Harness />)

    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledTimes(1)
    })
    expect(onSnackbar).toHaveBeenCalledWith(
      expect.objectContaining({ text: '検索に失敗', severity: 'error' }),
    )
    expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('replay-unrelated-rerender'))

    // Nothing about the settled failure changed - this must not re-show the notification.
    expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(1)
    expect(onSnackbar).toHaveBeenCalledTimes(1)
  })

  it('[Fix #40] still shows the search result after a failure once a later Socket.IO refetch succeeds', async () => {
    // Companion regression test: the [Fix #40] duplicate-suppression guard
    // (`handledFailureResponseRef`) must stay independent from `hasAttemptedSearchResultRef` and
    // must not otherwise gate the success branch - a search that fails once and then genuinely
    // succeeds (a Socket.IO triggered refetch, same shape as the [AC 2.10] test above) must still
    // render its result normally, with no failure text left behind.
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
    const searchRuleRepository = createSearchRuleRepository()
    const connection = new SyntheticRealtimeConnection()
    vi.mocked(searchRuleRepository.searchSchedules).mockResolvedValueOnce({
      ok: false,
      error: 'search-failed',
      message: '検索に失敗',
    })

    vi.useFakeTimers()
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        realtimeConnectionFactory={() => connection}
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('検索に失敗')).toBeVisible()
    // Let the failure snackbar's own 5 second timeout elapse so the assertions below read the
    // Socket.IO-triggered success, not a stale render of the first failure (same reasoning as the
    // [AC 2.10] test above).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    // The default `searchSchedules` stub (see searchRuleSupport.tsx) resolves successfully once the
    // single `mockResolvedValueOnce` failure above is consumed.
    connection.emit('updateStatus')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(2)
    expect(screen.getByText('1 件ヒット')).toBeVisible()
    expect(screen.queryByText('検索に失敗')).not.toBeInTheDocument()
    expect(screen.queryByText('検索情報更新に失敗')).not.toBeInTheDocument()
    vi.useRealTimers()
  })
})
