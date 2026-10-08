import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  SyntheticRealtimeConnection,
  createDashboardRepository,
  createShellRepository,
} from './dashboardTestKit'

describe('Dashboard realtime removal and fetch failure', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(
      null,
      '',
      '/#/?page=8&keyword=alpha&ruleId=12&channelId=34&genre=5&hasOriginalFile=true',
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 1.3] [AC 1.7] removes recording, recorded, and reserve summary rows when updateStatus reports deletion or recording completion', async () => {
    const dashboardRepository = createDashboardRepository()
    const connection = new SyntheticRealtimeConnection()
    vi.mocked(dashboardRepository.fetchRecording)
      .mockResolvedValueOnce({
        ok: true,
        value: {
          records: [{ id: 101, name: 'Deleting recording item' }],
          total: 1,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          records: [],
          total: 0,
        },
      })
    vi.mocked(dashboardRepository.fetchRecorded)
      .mockResolvedValueOnce({
        ok: true,
        value: {
          records: [{ id: 102, name: 'Deleting recorded item' }],
          total: 1,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          records: [],
          total: 0,
        },
      })
    vi.mocked(dashboardRepository.fetchReserves)
      .mockResolvedValueOnce({
        ok: true,
        value: {
          reserves: [{ id: 103, name: 'Deleting reserve item' }],
          total: 1,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          reserves: [],
          total: 0,
        },
      })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        dashboardApiRepository={dashboardRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByText('Deleting recording item')
    expect(screen.getByText('Deleting recorded item')).toBeVisible()
    expect(screen.getByText('Deleting reserve item')).toBeVisible()

    act(() => {
      connection.emit('updateStatus')
    })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '録画中 0/0' })).toBeVisible()
      expect(screen.getByRole('heading', { name: '録画済み 0/0' })).toBeVisible()
      expect(screen.getByRole('heading', { name: '予約 0/0' })).toBeVisible()
    })
    expect(screen.queryByText('Deleting recording item')).not.toBeInTheDocument()
    expect(screen.queryByText('Deleting recorded item')).not.toBeInTheDocument()
    expect(screen.queryByText('Deleting reserve item')).not.toBeInTheDocument()
  })

  it('[AC 1.7] [AC 1.8] shows source-specific snackbar text when reserve counts fetch fails and still displays 0/0 titles', async () => {
    const dashboardRepository = createDashboardRepository()
    vi.mocked(dashboardRepository.fetchReserveCounts).mockResolvedValue({
      ok: false,
      error: 'reserve-counts-fetch-failed',
      message: '予約情報取得に失敗',
    })
    vi.mocked(dashboardRepository.fetchRecording).mockResolvedValue({
      ok: true,
      value: {
        records: [],
        total: 0,
      },
    })
    vi.mocked(dashboardRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [],
        total: 0,
      },
    })
    vi.mocked(dashboardRepository.fetchReserves).mockResolvedValue({
      ok: true,
      value: {
        reserves: [],
        total: 0,
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        dashboardApiRepository={dashboardRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('dashboard-page')).toBeVisible()
    expect(screen.getByRole('heading', { name: '録画中 0/0' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '録画済み 0/0' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '予約 0/0' })).toBeVisible()

    // The failure snackbar closes on a wall-clock timer. Flush the trailing reserve-counts
    // failure under fake timers and read the surface synchronously, so the assertion never races
    // the host.
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('予約情報取得に失敗')).toBeVisible()
    vi.useRealTimers()
  })
})
