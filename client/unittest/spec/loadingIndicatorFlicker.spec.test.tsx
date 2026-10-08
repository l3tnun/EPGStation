import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createScrollHistory } from '@/app/scrollHistory'
import { DEFAULT_DELAY_MS, DEFAULT_MIN_DURATION_MS } from '@/shared/useDeferredLoading'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository } from './recorded/recordedSpecHelpers'
import { createRecordedRepository } from './recorded/recordedSpecRepository'
import { createDeferred, createReservesRepository } from './reserves/reservesTestKit'

// 録画済み/予約(競合・重複含む)/番組詳細予約 pages would paint a "読み込み中"
// indicator for only a handful of milliseconds on every fast, local-network
// fetch -- long enough to flash, too short to read. These tests pin the
// guard (`useDeferredLoading`, applied in
// RecordedPage / ReservesPage / ManualReservePage): a fetch fast enough to
// resolve within DEFAULT_DELAY_MS must never show the indicator at all, and
// a fetch slow enough to matter must still show it. Reverting the
// `useDeferredLoading` calls in those three page components (while keeping
// this file) makes every "does not flash" case in this file fail, because
// the indicator would be present at t=0.
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('loading indicator anti-flicker', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('RecordedPage (/recorded)', () => {
    beforeEach(() => {
      window.history.replaceState(null, '', '/#/recorded')
    })

    it('never shows "recorded-loading" when the fetch resolves faster than DEFAULT_DELAY_MS', async () => {
      vi.useFakeTimers()
      const recordedRepository = createRecordedRepository()

      render(
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          recordedApiRepository={recordedRepository}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />,
      )

      // Let the (already-resolved-promise) mock fetch settle. This is far
      // less than DEFAULT_DELAY_MS of wall-clock time in real usage.
      await advance(0)
      expect(screen.queryByTestId('recorded-loading')).not.toBeInTheDocument()

      // Confirm it never appears even after the delay/hold window would
      // otherwise have elapsed -- there is no stray timer that shows it late.
      await advance(DEFAULT_DELAY_MS + DEFAULT_MIN_DURATION_MS + 100)
      expect(screen.queryByTestId('recorded-loading')).not.toBeInTheDocument()

      vi.useRealTimers()
      expect(await screen.findByText('Synthetic recorded one')).toBeVisible()
    })

    it('shows "recorded-loading" once the fetch has been pending longer than DEFAULT_DELAY_MS', async () => {
      vi.useFakeTimers()
      const recordedRepository = createRecordedRepository()
      const deferred =
        createDeferred<Awaited<ReturnType<typeof recordedRepository.fetchRecorded>>>()
      vi.mocked(recordedRepository.fetchRecorded).mockReturnValueOnce(deferred.promise)

      render(
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          recordedApiRepository={recordedRepository}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />,
      )

      await advance(DEFAULT_DELAY_MS - 10)
      expect(screen.queryByTestId('recorded-loading')).not.toBeInTheDocument()

      await advance(20)
      expect(screen.getByTestId('recorded-loading')).toBeVisible()

      deferred.resolve({
        ok: true,
        value: { records: [{ id: 900, name: 'Synthetic slow recorded' }], total: 1 },
      })
      // The indicator's minimum hold time is counted from when it appeared
      // (t=DEFAULT_DELAY_MS), not from this resolve, so real content must
      // not replace it before that hold elapses.
      await advance(DEFAULT_MIN_DURATION_MS - 40)
      expect(screen.getByTestId('recorded-loading')).toBeVisible()
      expect(screen.queryByText('Synthetic slow recorded')).not.toBeInTheDocument()

      await advance(100)
      expect(screen.queryByTestId('recorded-loading')).not.toBeInTheDocument()

      vi.useRealTimers()
      expect(await screen.findByText('Synthetic slow recorded')).toBeVisible()
    })

    it('signals scroll-restoration ready as soon as the raw fetch settles, not gated on the delayed indicator', async () => {
      // Regression guard for the invariant in design.md: useDeferredLoading governs display only;
      // correctness-affecting reads (here, scroll-restoration readiness) must keep reading the raw
      // fetch state. If RecordedPage were changed to gate `useScrollHistoryPageReady` on
      // `showLoadingIndicator` instead of `data`/`query.isFetching`, `emitDoneGetData` would not
      // fire until the indicator's minimum hold time elapses, and this test would fail.
      vi.useFakeTimers()
      const recordedRepository = createRecordedRepository()
      const deferred =
        createDeferred<Awaited<ReturnType<typeof recordedRepository.fetchRecorded>>>()
      vi.mocked(recordedRepository.fetchRecorded).mockReturnValueOnce(deferred.promise)
      const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })
      const emitDoneGetData = vi.spyOn(scrollHistory, 'emitDoneGetData')

      render(
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          recordedApiRepository={recordedRepository}
          scrollHistory={scrollHistory}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />,
      )

      await advance(DEFAULT_DELAY_MS + 20)
      expect(screen.getByTestId('recorded-loading')).toBeVisible()
      expect(emitDoneGetData).not.toHaveBeenCalled()

      deferred.resolve({
        ok: true,
        value: { records: [{ id: 900, name: 'Synthetic slow recorded' }], total: 1 },
      })
      await advance(0)

      // Only ~20ms of the 200ms minimum hold time has elapsed since the indicator appeared, so
      // the indicator itself is still up -- but readiness must already have fired off the raw
      // fetch state, not the delayed one.
      expect(screen.getByTestId('recorded-loading')).toBeVisible()
      expect(emitDoneGetData).toHaveBeenCalled()
    })
  })

  describe('ReservesPage (/reserves?type=conflict) -- literal repro', () => {
    beforeEach(() => {
      window.history.replaceState(null, '', '/#/reserves?type=conflict')
    })

    it('never shows "reserves-loading" when the fetch resolves faster than DEFAULT_DELAY_MS', async () => {
      vi.useFakeTimers()
      const reservesRepository = createReservesRepository()

      render(
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          reservesApiRepository={reservesRepository}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />,
      )

      await advance(0)
      expect(screen.queryByTestId('reserves-loading')).not.toBeInTheDocument()

      await advance(DEFAULT_DELAY_MS + DEFAULT_MIN_DURATION_MS + 100)
      expect(screen.queryByTestId('reserves-loading')).not.toBeInTheDocument()

      vi.useRealTimers()
      expect(await screen.findByText('Synthetic reserve one')).toBeVisible()
    })

    it('shows "reserves-loading" once the fetch has been pending longer than DEFAULT_DELAY_MS', async () => {
      vi.useFakeTimers()
      const reservesRepository = createReservesRepository()
      const deferred =
        createDeferred<Awaited<ReturnType<typeof reservesRepository.fetchReserves>>>()
      vi.mocked(reservesRepository.fetchReserves).mockReturnValueOnce(deferred.promise)

      render(
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          reservesApiRepository={reservesRepository}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />,
      )

      await advance(DEFAULT_DELAY_MS - 10)
      expect(screen.queryByTestId('reserves-loading')).not.toBeInTheDocument()

      await advance(20)
      expect(screen.getByTestId('reserves-loading')).toBeVisible()

      deferred.resolve({
        ok: true,
        value: { reserves: [{ id: 950, name: 'Synthetic slow reserve' }], total: 1 },
      })
      await advance(DEFAULT_MIN_DURATION_MS - 40)
      expect(screen.getByTestId('reserves-loading')).toBeVisible()
      expect(screen.queryByText('Synthetic slow reserve')).not.toBeInTheDocument()

      await advance(100)
      expect(screen.queryByTestId('reserves-loading')).not.toBeInTheDocument()

      vi.useRealTimers()
      expect(await screen.findByText('Synthetic slow reserve')).toBeVisible()
    })

    it('signals scroll-restoration ready as soon as the raw fetch settles, not gated on the delayed indicator', async () => {
      // Same invariant as the RecordedPage case above, for `useVisibleReserves`'s
      // `useScrollHistoryPageReady(visibleState.status !== 'loading', ...)`.
      vi.useFakeTimers()
      const reservesRepository = createReservesRepository()
      const deferred =
        createDeferred<Awaited<ReturnType<typeof reservesRepository.fetchReserves>>>()
      vi.mocked(reservesRepository.fetchReserves).mockReturnValueOnce(deferred.promise)
      const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })
      const emitDoneGetData = vi.spyOn(scrollHistory, 'emitDoneGetData')

      render(
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          reservesApiRepository={reservesRepository}
          scrollHistory={scrollHistory}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />,
      )

      await advance(DEFAULT_DELAY_MS + 20)
      expect(screen.getByTestId('reserves-loading')).toBeVisible()
      expect(emitDoneGetData).not.toHaveBeenCalled()

      deferred.resolve({
        ok: true,
        value: { reserves: [{ id: 950, name: 'Synthetic slow reserve' }], total: 1 },
      })
      await advance(0)

      expect(screen.getByTestId('reserves-loading')).toBeVisible()
      expect(emitDoneGetData).toHaveBeenCalled()
    })
  })

  describe('ManualReservePage (/reserves/manual, edit mode)', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ recorded: [], encode: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
        ),
      )
      window.history.replaceState(null, '', '/#/reserves/manual?reserveId=701')
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('never shows "manual-reserve-loading" when the reserve fetch resolves faster than DEFAULT_DELAY_MS', async () => {
      vi.useFakeTimers()
      const reservesRepository = createReservesRepository()

      render(
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          reservesApiRepository={reservesRepository}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />,
      )

      await advance(0)
      expect(screen.queryByTestId('manual-reserve-loading')).not.toBeInTheDocument()

      await advance(DEFAULT_DELAY_MS + DEFAULT_MIN_DURATION_MS + 100)
      expect(screen.queryByTestId('manual-reserve-loading')).not.toBeInTheDocument()

      vi.useRealTimers()
      expect(await screen.findByTestId('manual-reserve-page')).toHaveAttribute(
        'data-manual-mode',
        'edit',
      )
    })

    it('shows "manual-reserve-loading" once the reserve fetch has been pending longer than DEFAULT_DELAY_MS', async () => {
      vi.useFakeTimers()
      const reservesRepository = createReservesRepository()
      const deferred =
        createDeferred<Awaited<ReturnType<typeof reservesRepository.fetchManualReserve>>>()
      vi.mocked(reservesRepository.fetchManualReserve).mockReturnValueOnce(deferred.promise)

      render(
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          reservesApiRepository={reservesRepository}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />,
      )

      await advance(DEFAULT_DELAY_MS - 10)
      expect(screen.queryByTestId('manual-reserve-loading')).not.toBeInTheDocument()

      await advance(20)
      expect(screen.getByTestId('manual-reserve-loading')).toBeVisible()

      deferred.resolve({
        ok: true,
        value: {
          id: 701,
          programId: undefined,
          name: 'Synthetic slow editable reserve',
          channelId: 401,
          startAt: Date.parse('2026-05-05T12:00:00+09:00'),
          endAt: Date.parse('2026-05-05T12:30:00+09:00'),
          isTimeSpecified: true,
          allowEndLack: false,
          parentDirectoryName: 'default',
        },
      })
      await advance(DEFAULT_MIN_DURATION_MS - 40)
      expect(screen.getByTestId('manual-reserve-loading')).toBeVisible()

      await advance(100)
      expect(screen.queryByTestId('manual-reserve-loading')).not.toBeInTheDocument()
    })

    it('re-enables 保存 as soon as the raw reserve fetch settles, not gated on the delayed indicator', async () => {
      // Same invariant as the scroll-restoration cases above, for the 保存 button's
      // `isSubmitBlocked = isLoading || submit.isSubmitting`. If ManualReservePage were changed to
      // read `showLoadingIndicator` there instead of the raw `isLoading`, the button would stay
      // disabled until the indicator's minimum hold time elapses, and this test would fail.
      vi.useFakeTimers()
      const reservesRepository = createReservesRepository()
      const deferred =
        createDeferred<Awaited<ReturnType<typeof reservesRepository.fetchManualReserve>>>()
      vi.mocked(reservesRepository.fetchManualReserve).mockReturnValueOnce(deferred.promise)

      render(
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          reservesApiRepository={reservesRepository}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />,
      )

      await advance(DEFAULT_DELAY_MS + 20)
      expect(screen.getByTestId('manual-reserve-loading')).toBeVisible()
      expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

      deferred.resolve({
        ok: true,
        value: {
          id: 701,
          programId: undefined,
          name: 'Synthetic slow editable reserve',
          channelId: 401,
          startAt: Date.parse('2026-05-05T12:00:00+09:00'),
          endAt: Date.parse('2026-05-05T12:30:00+09:00'),
          isTimeSpecified: true,
          allowEndLack: false,
          parentDirectoryName: 'default',
        },
      })
      await advance(0)

      // Only ~20ms of the 200ms minimum hold time has elapsed since the indicator appeared, so
      // the indicator itself is still up -- but the submit-blocking read must already reflect the
      // raw, settled fetch state, not the delayed one.
      expect(screen.getByTestId('manual-reserve-loading')).toBeVisible()
      expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    })
  })
})
