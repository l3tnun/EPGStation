import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createScrollHistory } from '@/app/scrollHistory'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  SyntheticRealtimeConnection,
  createDashboardRepository,
  createRecordingRepository,
  createReservesRepository,
  createShellRepository,
} from './dashboardTestKit'

const startAt = Date.parse('2026-05-05T10:15:00+09:00')
const endAt = Date.parse('2026-05-05T10:45:00+09:00')

describe('Dashboard item, thumbnail, guide and scroll edges', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 2.2] [AC 2.3] [AC 2.15] opens recorded detail from a recording row, ignores rows without an id, and routes MORE for recorded', async () => {
    const dashboardRepository = createDashboardRepository()
    vi.mocked(dashboardRepository.fetchRecording).mockResolvedValue({
      ok: true,
      value: {
        records: [{ id: 21, name: 'Recording with id' }, { name: 'Recording without id' }],
        total: 2,
      },
    })
    vi.mocked(dashboardRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: { records: [{ id: 31, name: 'Recorded with thumbnail', thumbnails: [7] }], total: 5 },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        dashboardApiRepository={dashboardRepository}
        recordingApiRepository={createRecordingRepository()}
        reservesApiRepository={createReservesRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('dashboard-page')
    const thumbnail = screen.getByTestId('dashboard-recorded-thumbnail')
    fireEvent.error(thumbnail)
    expect(screen.getByTestId('dashboard-recorded-no-image')).toHaveAttribute(
      'src',
      './img/noimg.png',
    )

    fireEvent.click(screen.getByText('Recording without id'))
    expect(window.location.hash).toBe('#/')
    fireEvent.click(
      within(screen.getByTestId('dashboard-section-recorded')).getByRole('button', {
        name: 'MORE',
      }),
    )
    await waitFor(() => {
      expect(window.location.hash).toMatch(/^#\/recorded\?page=2&timestamp=\d+$/)
    })
  })

  it('[AC 2.3] navigates from a recording row to recorded detail', async () => {
    const dashboardRepository = createDashboardRepository()
    vi.mocked(dashboardRepository.fetchRecording).mockResolvedValue({
      ok: true,
      value: { records: [{ id: 21, name: 'Recording with id' }], total: 1 },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        dashboardApiRepository={dashboardRepository}
        recordingApiRepository={createRecordingRepository()}
        reservesApiRepository={createReservesRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('dashboard-page')
    fireEvent.click(screen.getByText('Recording with id'))
    await waitFor(() => {
      expect(window.location.hash).toMatch(/^#\/recorded\/detail\/21(\?timestamp=\d+)?$/)
    })
  })

  it('[AC 2.4] [AC 2.5] resolves the broadcast wave for the reserve dialog from the loaded summary, and drops it after the summary changes', async () => {
    const dashboardRepository = createDashboardRepository()
    const connection = new SyntheticRealtimeConnection()
    vi.mocked(dashboardRepository.fetchReserves).mockResolvedValue({
      ok: true,
      value: {
        reserves: [
          { id: 41, name: 'Timer reserve', channelId: 5, channelType: 'BS', startAt, endAt },
        ],
        total: 1,
      },
    })

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isEnableDisplayForEachBroadcastWave: true,
        }}
        apiRepository={createShellRepository()}
        dashboardApiRepository={dashboardRepository}
        recordingApiRepository={createRecordingRepository()}
        reservesApiRepository={createReservesRepository()}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('dashboard-page')
    const reserveButton = screen.getByRole('button', { name: 'Timer reserve' })
    expect(reserveButton.querySelector('[class*="reserveIconTimer"]')).not.toBeNull()
    fireEvent.click(reserveButton)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(dialog.querySelector('[class*="reserveDialogTimeButton"]') as HTMLElement)
    await waitFor(() => {
      expect(window.location.hash).toMatch(/^#\/guide\?time=\d+&type=BS(&timestamp=\d+)?$/)
    })

    act(() => {
      window.location.hash = '#/'
    })
    await screen.findByTestId('dashboard-page')
    fireEvent.click(screen.getByRole('button', { name: 'Timer reserve' }))
    await screen.findByRole('dialog')
    vi.mocked(dashboardRepository.fetchReserves).mockResolvedValue({
      ok: true,
      value: {
        reserves: [{ id: 42, name: 'Rule reserve', ruleId: 3, channelId: 6, channelType: 'GR' }],
        total: 1,
      },
    })
    act(() => {
      connection.emit('updateStatus')
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Rule reserve', hidden: true })).toBeInTheDocument()
    })
    fireEvent.click(
      screen.getByRole('dialog').querySelector('[class*="reserveDialogTimeButton"]') as HTMLElement,
    )
    await waitFor(() => {
      expect(window.location.hash).toMatch(/^#\/guide\?time=\d+(&timestamp=\d+)?$/)
    })
  })

  it('[AC 1.9] does not overwrite a saved non-zero section scroll with zeros, and skips saves while a restore is pending', async () => {
    const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })
    scrollHistory.saveScrollData({ recordingScroll: 10, recordedScroll: 0, reservesScroll: 0 })

    const { unmount } = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        dashboardApiRepository={createDashboardRepository()}
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('dashboard-page')
    const recordingList = screen.getByTestId('dashboard-section-recording-list')
    expect(recordingList).toHaveProperty('scrollTop', 0)
    fireEvent.scroll(recordingList)
    expect(scrollHistory.getScrollData()).toStrictEqual({
      recordingScroll: 10,
      recordedScroll: 0,
      reservesScroll: 0,
    })
    unmount()
    expect(scrollHistory.getScrollData()).toStrictEqual({
      recordingScroll: 10,
      recordedScroll: 0,
      reservesScroll: 0,
    })
  })

  it('[AC 1.9] skips saving section scroll while the history restore has not run yet', async () => {
    const scrollHistory = createScrollHistory({ shouldRestoreHistory: true })
    scrollHistory.saveScrollData({ recordingScroll: 3, recordedScroll: 0, reservesScroll: 0 })
    vi.spyOn(scrollHistory, 'emitDoneGetData').mockImplementation(() => undefined)
    const saveScrollData = vi.spyOn(scrollHistory, 'saveScrollData')

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        dashboardApiRepository={createDashboardRepository()}
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('dashboard-page')
    expect(scrollHistory.isNeedRestoreHistory()).toBe(true)
    const recordingList = screen.getByTestId('dashboard-section-recording-list')
    recordingList.scrollTop = 9
    fireEvent.scroll(recordingList)
    expect(saveScrollData).not.toHaveBeenCalled()
  })
})
