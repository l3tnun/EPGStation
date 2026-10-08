import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from '../hashRouteAssertions'
import {
  createDashboardRepository,
  createRecordedRepository,
  createRecordingRepository,
  createReservesRepository,
  createShellRepository,
} from './dashboardTestKit'

describe('Dashboard adjacent owner menus', () => {
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

  it('[AC 2.6] [AC 2.8] uses adjacent owner menus without navigating the card click target', async () => {
    window.history.replaceState(null, '', '/#/')
    const dashboardRepository = createDashboardRepository()
    vi.mocked(dashboardRepository.fetchRecording).mockResolvedValue({
      ok: true,
      value: { records: [{ id: 31, name: 'Recording menu target' }], total: 1 },
    })
    vi.mocked(dashboardRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: { records: [{ id: 32, name: 'Recorded menu target', isProtected: false }], total: 1 },
    })
    vi.mocked(dashboardRepository.fetchReserves).mockResolvedValue({
      ok: true,
      value: { reserves: [{ id: 33, name: 'Reserve menu target', isSkip: true }], total: 1 },
    })
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        dashboardApiRepository={dashboardRepository}
        recordedApiRepository={recordedRepository}
        recordingApiRepository={createRecordingRepository()}
        reservesApiRepository={createReservesRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('dashboard-page')
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Recorded menu target' }))
    expect(screen.getByRole('menuitem', { name: 'protect' })).toBeVisible()
    expect(window.location.hash).toBe('#/')
    fireEvent.click(screen.getByRole('menuitem', { name: 'protect' }))
    expect(await screen.findByText('保護に成功')).toBeVisible()
    expect(recordedRepository.protectRecorded).toHaveBeenCalledWith(32)
    expect(dashboardRepository.fetchRecorded).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Recorded menu target' }))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'protect' })).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '予約メニュー: Reserve menu target' }))
    expect(screen.getByRole('menuitem', { name: 'unlock' })).toBeVisible()
    expect(window.location.hash).toBe('#/')
  })

  it('[AC 2.12] hides stop encode for a Dashboard recording item even when isEncoding is true, reusing the frontend-recording-encode contract', async () => {
    window.history.replaceState(null, '', '/#/')
    const dashboardRepository = createDashboardRepository()
    vi.mocked(dashboardRepository.fetchRecording).mockResolvedValue({
      ok: true,
      value: {
        records: [{ id: 41, name: 'Recording still encoding', isEncoding: true }],
        total: 1,
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        dashboardApiRepository={dashboardRepository}
        recordedApiRepository={createRecordedRepository()}
        recordingApiRepository={createRecordingRepository()}
        reservesApiRepository={createReservesRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('dashboard-page')
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Recording still encoding' }))
    expect(screen.queryByRole('menuitem', { name: 'stop' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'encode' })).not.toBeInTheDocument()
  })

  it('[AC 1.7] [AC 2.11] refetches Dashboard reserves after a reserve delete succeeds from the Dashboard menu', async () => {
    window.history.replaceState(null, '', '/#/')
    const dashboardRepository = createDashboardRepository()
    vi.mocked(dashboardRepository.fetchReserves)
      .mockResolvedValueOnce({
        ok: true,
        value: { reserves: [{ id: 330, name: 'Dashboard reserve delete target' }], total: 1 },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { reserves: [], total: 0 },
      })
    const reservesRepository = createReservesRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        dashboardApiRepository={dashboardRepository}
        recordedApiRepository={createRecordedRepository()}
        recordingApiRepository={createRecordingRepository()}
        reservesApiRepository={reservesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByText('Dashboard reserve delete target')).toBeVisible()

    fireEvent.click(
      screen.getByRole('button', { name: '予約メニュー: Dashboard reserve delete target' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'delete' }))
    fireEvent.click(await screen.findByRole('button', { name: '削除' }))

    await waitFor(() => {
      expect(reservesRepository.deleteReserve).toHaveBeenCalledWith(330)
      expect(dashboardRepository.fetchReserves).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('heading', { name: '予約 0/0' })).toBeVisible()
    })
    expect(screen.queryByText('Dashboard reserve delete target')).not.toBeInTheDocument()
  })

  it('[AC 2.14] routes dashboard recorded and recording menu search actions through recorded-owned search contract', async () => {
    window.history.replaceState(null, '', '/#/')
    const dashboardRepository = createDashboardRepository()
    vi.mocked(dashboardRepository.fetchRecording).mockResolvedValue({
      ok: true,
      value: {
        records: [{ id: 41, name: 'Recording menu rule target', ruleId: 77, isProtected: false }],
        total: 1,
      },
    })
    vi.mocked(dashboardRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [{ id: 42, name: '[Synthetic] Recorded menu target #01', isProtected: false }],
        total: 1,
      },
    })
    vi.mocked(dashboardRepository.fetchReserves).mockResolvedValue({
      ok: true,
      value: { reserves: [], total: 0 },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        dashboardApiRepository={dashboardRepository}
        recordedApiRepository={createRecordedRepository()}
        recordingApiRepository={createRecordingRepository()}
        reservesApiRepository={createReservesRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('dashboard-page')
    fireEvent.click(
      screen.getByRole('button', { name: '録画メニュー: Recording menu rule target' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'search' }))
    await waitFor(() => {
      expectHashRoute('#/recorded?ruleId=77')
    })

    act(() => {
      window.location.hash = '#/'
    })
    await screen.findByTestId('dashboard-page')
    fireEvent.click(
      screen.getByRole('button', { name: '録画メニュー: [Synthetic] Recorded menu target #01' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'search' }))
    await waitFor(() => {
      expectHashRoute('#/recorded?keyword=Recorded+menu+target')
    })
  })
})
