import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createScrollHistory } from '@/app/scrollHistory'
import type { ReservesApiRepository } from '@/features/reserves/reservesApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createShellRepository,
  createReservesRepository,
  createDeferred,
  findReserveRow,
} from './reservesTestKit'

describe('Reserves list route lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/reserves?type=conflict&page=3&timestamp=999')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.4] paints selected table rows across every cell in edit mode', () => {
    const css = readFileSync('src/features/reserves/ReservesPage.module.css', 'utf8')

    expect(css).toContain(".reservesPage[data-reserves-layout='table'] .item[data-selected='true']")
    expect(css).toContain(
      ".reservesPage[data-reserves-layout='table'] .item[data-selected='true'] td",
    )
    expect(css).toContain('background: #4285f4;')
    expect(css).toContain('color: #fff;')
  })

  it('[AC 1.1] [AC 1.4] [AC 2.2] [AC 2.22] renders the reserves title and fetches with type, page, and settings', async () => {
    const reservesRepository = createReservesRepository()
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: false,
      reservesLength: 25,
    }

    render(
      <App
        settings={settings}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(screen.getByTestId('title-bar')).toHaveTextContent('競合')

    const page = await screen.findByTestId('reserves-page')
    expect(page).toHaveAttribute('data-reserves-total', '50')
    expect(within(page).getByRole('table')).toBeVisible()
    expect(screen.queryByText('timestamp')).not.toBeInTheDocument()
    expect(reservesRepository.fetchReserves).toHaveBeenCalledWith({
      type: 'conflict',
      isHalfWidth: false,
      limit: 25,
      offset: 50,
      page: 3,
      routeType: 'conflict',
    })
    expect(screen.getAllByTestId('reserves-list-item')).toHaveLength(2)
    expect(await findReserveRow('Synthetic reserve one')).toBeVisible()
  })

  it('[AC 1.2] [AC 1.3] [AC 2.1] uses no-query all type and unknown type as normal title/request', async () => {
    window.history.replaceState(null, '', '/#/reserves')
    const allRepository = createReservesRepository()
    const allView = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={allRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('reserves-page')
    expect(screen.getByTestId('title-bar')).toHaveTextContent('予約')
    expect(allRepository.fetchReserves).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'all' }),
    )
    allView.unmount()

    window.history.replaceState(null, '', '/#/reserves?type=unexpected')
    const normalRepository = createReservesRepository()
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={normalRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('reserves-page')
    expect(screen.getByTestId('title-bar')).toHaveTextContent('予約')
    expect(normalRepository.fetchReserves).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'normal', routeType: 'normal' }),
    )
  })

  it.each([
    ['/reserves?type=normal', '予約'],
    ['/reserves?type=conflict', '競合'],
    ['/reserves?type=overlap', '重複'],
    ['/reserves?type=skip', '除外'],
  ])(
    '[AC 2.1] [AC 2.2] [AC 2.3] [AC 2.4] keeps the reserves title for %s',
    async (hashRoute, expectedTitle) => {
      window.history.replaceState(null, '', `/#${hashRoute}`)

      render(
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          reservesApiRepository={createReservesRepository()}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />,
      )

      await screen.findByTestId('reserves-page')
      expect(screen.getByTestId('title-bar')).toHaveTextContent(expectedTitle)
    },
  )

  it('[AC 1.5] [AC 1.6] updates only the page query while preserving type and clearing the visible list during route fetch', async () => {
    const reservesRepository = createReservesRepository()
    vi.mocked(reservesRepository.fetchReserves).mockResolvedValueOnce({
      ok: true,
      value: {
        reserves: [{ id: 101, name: 'Synthetic reserve one' }],
        total: 100,
      },
    })
    const nextPage = createDeferred<Awaited<ReturnType<ReservesApiRepository['fetchReserves']>>>()
    vi.mocked(reservesRepository.fetchReserves).mockReturnValueOnce(nextPage.promise)

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

    await screen.findByTestId('reserves-page')
    fireEvent.click(screen.getByRole('button', { name: '次のページ' }))

    await waitFor(() => {
      expect(window.location.hash).toContain('type=conflict')
      expect(window.location.hash).toContain('page=4')
      expect(window.location.hash).not.toContain('timestamp=999')
    })
    expect(screen.queryByText('Synthetic reserve one')).not.toBeInTheDocument()
    // The next-page fetch is deliberately left pending (see `nextPage` below),
    // so this is the genuinely-slow case: useDeferredLoading must still show
    // the indicator once it has been pending longer than DEFAULT_DELAY_MS.
    await waitFor(
      () => {
        expect(screen.getByTestId('reserves-loading')).toBeVisible()
      },
      // 3s budget covers DEFAULT_DELAY_MS (200ms) plus generous CI/CPU-contention slack.
      { timeout: 3000 },
    )

    nextPage.resolve({
      ok: true,
      value: {
        reserves: [{ id: 103, name: 'Synthetic reserve three' }],
        total: 100,
      },
    })

    expect(await findReserveRow('Synthetic reserve three')).toBeVisible()
    expect(reservesRepository.fetchReserves).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 4, offset: 72 }),
    )
  })

  it('[AC 1.9] renders no list content or empty copy for zero items and emits scroll restoration done', async () => {
    const reservesRepository = createReservesRepository()
    vi.mocked(reservesRepository.fetchReserves).mockResolvedValue({
      ok: true,
      value: {
        reserves: [],
        total: 0,
      },
    })
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

    expect(await screen.findByTestId('reserves-page')).toBeVisible()
    expect(screen.queryAllByTestId('reserves-list-item')).toHaveLength(0)
    expect(screen.queryByText(/empty/i)).not.toBeInTheDocument()
    // The done signal is sent from a passive effect of the commit that shows the page. When that
    // commit was not synchronous, React runs the effect in a later task than the one that put the
    // page in the DOM, so the signal has to be awaited rather than read at the moment the page appears.
    await waitFor(() => {
      expect(emitDoneGetData).toHaveBeenCalled()
    })
  })

  it('[AC 1.8] shows snackbar for route-driven fetch failure', async () => {
    const reservesRepository = createReservesRepository()
    vi.mocked(reservesRepository.fetchReserves).mockResolvedValueOnce({
      ok: false,
      error: 'reserves-fetch-failed',
      message: '予約データ取得に失敗',
    })

    vi.useFakeTimers()
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('予約データ取得に失敗')
    expect(screen.getByTestId('reserves-error')).toBeVisible()
  })
})
