import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  SyntheticRealtimeConnection,
  createDashboardRepository,
  createShellRepository,
} from './dashboardTestKit'

describe('Dashboard summary fetch and realtime refresh', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(
      null,
      '',
      '/#/?page=8&keyword=alpha&ruleId=12&channelId=34&genre=5&hasOriginalFile=true',
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 1.1] [AC 1.3] [AC 1.4] [AC 1.5] [AC 1.6] uses the version title, hides the body until loaded, and fetches summaries with dashboard query rules', async () => {
    const dashboardRepository = createDashboardRepository()
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: false,
      recordingLength: 3,
      recordedLength: 5,
      reservesLength: 7,
    }

    render(
      <App
        settings={settings}
        apiRepository={createShellRepository('9.9.9')}
        dashboardApiRepository={dashboardRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument()

    const dashboardPage = await screen.findByTestId('dashboard-page')
    expect(dashboardPage).toHaveAttribute('data-dashboard-transition', 'entering')
    await waitFor(() => {
      expect(dashboardPage).toHaveAttribute('data-dashboard-transition', 'entered')
    })
    expect(dashboardPage).toHaveAttribute('data-dashboard-transition', 'entered')
    expect(screen.getByTestId('title-bar')).toHaveTextContent('EPGStation v9.9.9')

    const sections = screen.getAllByRole('region')
    expect(sections).toHaveLength(3)
    expect(within(sections[0]).getByRole('heading', { name: '録画中 1/1' })).toBeVisible()
    expect(within(sections[1]).getByRole('heading', { name: '録画済み 1/1' })).toBeVisible()
    expect(within(sections[2]).getByRole('heading', { name: '予約 1/1' })).toBeVisible()
    expect(within(sections[1]).getByText('Synthetic channel')).toBeVisible()
    expect(within(sections[1]).getByText('05/05(火) 10:15 ~ 10:45 (30 m)')).toBeVisible()
    expect(screen.queryByText(/empty/i)).not.toBeInTheDocument()

    expect(dashboardRepository.fetchReserveCounts).toHaveBeenCalledTimes(1)
    expect(dashboardRepository.fetchRecording).toHaveBeenCalledWith({
      isHalfWidth: false,
      offset: 0,
      limit: 3,
    })
    expect(dashboardRepository.fetchRecorded).toHaveBeenCalledWith({
      isHalfWidth: false,
      offset: 0,
      limit: 5,
      keyword: 'alpha',
      ruleId: 12,
      channelId: 34,
      genre: 5,
      hasOriginalFile: true,
    })
    expect(dashboardRepository.fetchReserves).toHaveBeenCalledWith({
      type: 'normal',
      isHalfWidth: false,
      offset: 0,
      limit: 7,
    })
  })

  it('[AC 1.3] refetches dashboard summaries when Socket.IO updateStatus is received', async () => {
    const dashboardRepository = createDashboardRepository()
    const connection = new SyntheticRealtimeConnection()
    vi.mocked(dashboardRepository.fetchRecording)
      .mockResolvedValueOnce({
        ok: true,
        value: {
          records: [{ id: 1, name: 'Synthetic recording' }],
          total: 1,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          records: [{ id: 10, name: 'Updated recording' }],
          total: 1,
        },
      })
    vi.mocked(dashboardRepository.fetchRecorded)
      .mockResolvedValueOnce({
        ok: true,
        value: {
          records: [
            {
              id: 2,
              name: 'Synthetic recorded',
              channelName: 'Synthetic channel',
              startAt: Date.parse('2026-05-05T10:15:00+09:00'),
              endAt: Date.parse('2026-05-05T10:45:00+09:00'),
            },
          ],
          total: 1,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          records: [
            {
              id: 20,
              name: 'Updated recorded',
              channelName: 'Synthetic channel',
              startAt: Date.parse('2026-05-05T10:15:00+09:00'),
              endAt: Date.parse('2026-05-05T10:45:00+09:00'),
            },
          ],
          total: 1,
        },
      })
    vi.mocked(dashboardRepository.fetchReserves)
      .mockResolvedValueOnce({
        ok: true,
        value: {
          reserves: [{ id: 3, name: 'Synthetic reserve' }],
          total: 1,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          reserves: [{ id: 30, name: 'Updated reserve' }],
          total: 1,
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

    await screen.findByTestId('dashboard-page')
    expect(screen.getByText('Synthetic recording')).toBeVisible()
    expect(screen.getByText('Synthetic recorded')).toBeVisible()
    expect(screen.getByText('Synthetic reserve')).toBeVisible()

    act(() => {
      connection.emit('updateStatus')
    })

    await waitFor(() => {
      expect(dashboardRepository.fetchReserveCounts).toHaveBeenCalledTimes(2)
      expect(dashboardRepository.fetchRecording).toHaveBeenCalledTimes(2)
      expect(dashboardRepository.fetchRecorded).toHaveBeenCalledTimes(2)
      expect(dashboardRepository.fetchReserves).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByText('Updated recording')).toBeVisible()
    expect(await screen.findByText('Updated recorded')).toBeVisible()
    expect(await screen.findByText('Updated reserve')).toBeVisible()
    expect(screen.queryByText('Synthetic recording')).not.toBeInTheDocument()
    expect(screen.queryByText('Synthetic recorded')).not.toBeInTheDocument()
    expect(screen.queryByText('Synthetic reserve')).not.toBeInTheDocument()
  })

  describe('[AC 1.10] periodic summary refetch', () => {
    const IOS_USER_AGENT =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

    async function renderDashboardAndSettle(
      dashboardRepository: ReturnType<typeof createDashboardRepository>,
    ) {
      vi.useFakeTimers()
      render(
        <App
          apiRepository={createShellRepository('9.9.9')}
          dashboardApiRepository={dashboardRepository}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />,
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(dashboardRepository.fetchRecording).toHaveBeenCalledTimes(1)
    }

    afterEach(() => {
      vi.useRealTimers()
    })

    it('refetches the summary every 3000 ms on iOS / iPadOS while the Dashboard is shown', async () => {
      vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(IOS_USER_AGENT)
      const dashboardRepository = createDashboardRepository()

      await renderDashboardAndSettle(dashboardRepository)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(dashboardRepository.fetchRecording).toHaveBeenCalledTimes(2)
      expect(dashboardRepository.fetchReserveCounts).toHaveBeenCalledTimes(2)
      expect(dashboardRepository.fetchRecorded).toHaveBeenCalledTimes(2)
      expect(dashboardRepository.fetchReserves).toHaveBeenCalledTimes(2)
    })

    it('does not refetch periodically when the platform is not iOS / iPadOS', async () => {
      const dashboardRepository = createDashboardRepository()

      await renderDashboardAndSettle(dashboardRepository)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000)
      })
      expect(dashboardRepository.fetchRecording).toHaveBeenCalledTimes(1)
    })
  })
})
