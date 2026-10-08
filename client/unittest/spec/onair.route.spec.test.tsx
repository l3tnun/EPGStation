import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OnAirApiRepository } from '@/features/onair/onairApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from './hashRouteAssertions'
import {
  SyntheticRealtimeConnection,
  NOW,
  onAirCss,
  createSchedule,
  createOnAirRepository,
  renderOnAir,
} from './support/onairSpecHarness'

describe('On Air route and fetch lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(window, 'scroll').mockImplementation(() => undefined)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.22] keeps the stream dialog URL scheme switch animated', () => {
    expect(onAirCss).toContain('background-color 150ms ease')
    expect(onAirCss).toContain('left 150ms ease')
  })

  it('[AC 1.1] [AC 1.4] [AC 1.6] renders /onair with title and fetches with settings-driven options', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)])
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: false,
      isOnAirTabListView: true,
    }

    renderOnAir({ repository, settings, enabledBroadcastWaves: ['BS', 'GR'] })

    expect(screen.getByTestId('title-bar')).toHaveTextContent('放映中')
    expect(await screen.findByTestId('onair-page')).toBeInTheDocument()
    expect(repository.fetchOnAir).toHaveBeenCalledWith({ isHalfWidth: false })
    expect(screen.getByTestId('onair-page')).toHaveAttribute('data-onair-layout', 'tabs')
    expect(screen.getByTestId('onair-card-10')).toHaveTextContent('Synthetic GR program')
    expect(screen.getByRole('tab', { selected: true })).toHaveStyle({
      borderBottomColor: '#fff',
      color: '#fff',
    })
    expect(screen.getByRole('progressbar')).toHaveStyle({
      backgroundColor: 'rgba(25, 118, 210, 0.3)',
    })
  })

  it('[AC 1.7] [AC 1.8] uses enabled broadcast waves as tabs in fixed order without syncing route query', async () => {
    const scrollSpy = vi.spyOn(window, 'scroll').mockImplementation(() => undefined)
    renderOnAir({
      repository: createOnAirRepository([
        createSchedule('GR', 10, 30),
        createSchedule('BS', 20, 40),
        createSchedule('SKY', 30, 50),
      ]),
      enabledBroadcastWaves: ['SKY', 'BS', 'GR'],
    })

    await screen.findByTestId('onair-page')
    const tabList = screen.getByRole('tablist', { name: '放送波' })
    expect(
      within(tabList)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toStrictEqual(['GR', 'BS', 'SKY'])
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('GR')

    fireEvent.click(screen.getByRole('tab', { name: 'BS' }))

    expectHashRoute('#/onair?type=BS')
    expect(scrollSpy).toHaveBeenCalledWith(0, 0)
    expect(screen.getByTestId('onair-card-20')).toHaveTextContent('Synthetic BS program')
    expect(screen.queryByTestId('onair-card-10')).not.toBeInTheDocument()
  })

  it('[AC 1.8] leaves route-opening scroll resets to the app shell', async () => {
    const scrollSpy = vi.spyOn(window, 'scroll').mockImplementation(() => undefined)

    renderOnAir({ initialHash: '/#/onair?unknown=1&type=GR' })
    await screen.findByTestId('onair-page')

    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('[AC 1.9] [AC 1.13] renders a single centered list when tab list view is disabled', async () => {
    renderOnAir({
      repository: createOnAirRepository([
        createSchedule('GR', 10, 30),
        createSchedule('BS', 20, 40),
      ]),
      settings: {
        ...new DefaultSettingsFactory().create(),
        isOnAirTabListView: false,
      },
    })

    await screen.findByTestId('onair-page')
    expect(screen.getByTestId('onair-page')).toHaveAttribute('data-onair-layout', 'list')
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByTestId('onair-list')).toHaveAttribute('data-centered-column', 'true')
    expect(screen.getByTestId('onair-card-10')).toBeInTheDocument()
    expect(screen.getByTestId('onair-card-20')).toBeInTheDocument()
  })

  it('[AC 1.11] keeps a blank body for zero schedules and retries once after 1 second', async () => {
    const repository = createOnAirRepository([])

    // The empty-schedule retry (EMPTY_SCHEDULE_RETRY_DELAY_MS) waits 1 real second. Drive it
    // under fake timers so the retry assertion never races the host.
    vi.useFakeTimers()
    renderOnAir({ repository })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(repository.fetchOnAir).toHaveBeenCalledTimes(1)

    expect(screen.queryByTestId('onair-page')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('shell-main')).queryByText(/番組/)).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(repository.fetchOnAir).toHaveBeenCalledTimes(2)
  })

  it('[AC 1.10] [AC 1.12] shows a snackbar on fetch failure and does not recreate the next update timer', async () => {
    const repository: OnAirApiRepository = {
      fetchOnAir: vi.fn(async () => ({
        ok: false as const,
        error: 'onair-fetch-failed' as const,
        message: '番組情報取得に失敗',
      })),
      fetchLiveStreams: vi.fn(),
      addProgramReserve: vi.fn(),
      deleteReserve: vi.fn(),
      unlockSkipReserve: vi.fn(),
      unlockOverlapReserve: vi.fn(),
    }

    // The failure snackbar closes on a 5 second wall-clock timer, and this asserts no retry
    // timer gets recreated on failure. Drive both under fake timers instead of a real 1.1s wait.
    vi.useFakeTimers()
    renderOnAir({ repository })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('番組情報取得に失敗')).toBeVisible()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })

    expect(repository.fetchOnAir).toHaveBeenCalledTimes(1)
  })

  it('[AC 1.2] refetches active On Air data when Socket.IO updateStatus invalidates the query', async () => {
    const realtimeConnection = new SyntheticRealtimeConnection()
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)])

    renderOnAir({ repository, realtimeConnection })
    await waitFor(() => expect(repository.fetchOnAir).toHaveBeenCalledTimes(1))

    act(() => {
      realtimeConnection.emit('updateStatus')
    })

    await waitFor(() => expect(repository.fetchOnAir).toHaveBeenCalledTimes(2))
  })

  it('[AC 1.2] does not refetch On Air data on browser focus or reconnect events', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)])
    vi.spyOn(Date, 'now').mockReturnValue(NOW)

    renderOnAir({ repository })
    await waitFor(() => expect(repository.fetchOnAir).toHaveBeenCalledTimes(1))

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('online'))
      await Promise.resolve()
    })

    expect(repository.fetchOnAir).toHaveBeenCalledTimes(1)
  })
})
