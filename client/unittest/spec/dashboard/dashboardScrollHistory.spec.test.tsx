import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createScrollHistory } from '@/app/scrollHistory'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  changeSettingsSelect,
  createDashboardRepository,
  createShellRepository,
  createRouteAwareScrollHistorySpy,
} from './dashboardTestKit'

describe('Dashboard section scroll history', () => {
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

  it('[AC 1.9] saves section scroll data and restores it only for history restore', async () => {
    const scrollHistory = createScrollHistory({
      shouldRestoreHistory: true,
    })
    scrollHistory.saveScrollData({
      recordingScroll: 10,
      recordedScroll: 20,
      reservesScroll: 30,
    })

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

    expect(await screen.findByTestId('dashboard-page')).toBeVisible()
    // Section scroll is restored after the done signal, which a passive effect of the commit that
    // shows the page sends. That effect can run in a later task than the DOM write, so wait for it.
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-section-recording-list')).toHaveProperty('scrollTop', 10)
      expect(screen.getByTestId('dashboard-section-recorded-list')).toHaveProperty('scrollTop', 20)
      expect(screen.getByTestId('dashboard-section-reserves-list')).toHaveProperty('scrollTop', 30)
    })

    const recordingList = screen.getByTestId('dashboard-section-recording-list')
    const recordedList = screen.getByTestId('dashboard-section-recorded-list')
    const reservesList = screen.getByTestId('dashboard-section-reserves-list')
    recordingList.scrollTop = 40
    recordedList.scrollTop = 50
    reservesList.scrollTop = 60
    fireEvent.scroll(recordingList)

    unmount()

    expect(scrollHistory.getScrollData()).toStrictEqual({
      recordingScroll: 40,
      recordedScroll: 50,
      reservesScroll: 60,
    })
  })

  it('[AC 1.9] saves dashboard section scroll data against the leaving route during query changes', async () => {
    const scrollHistory = createRouteAwareScrollHistorySpy()
    const dashboardRepository = createDashboardRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        dashboardApiRepository={dashboardRepository}
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('dashboard-page')).toBeVisible()
    const recordingList = screen.getByTestId('dashboard-section-recording-list')
    recordingList.scrollTop = 70
    fireEvent.scroll(recordingList)

    act(() => {
      window.location.hash = '#/?keyword=beta'
    })

    await waitFor(() => {
      expect(dashboardRepository.fetchRecorded).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: 'beta' }),
      )
    })
    expect(scrollHistory.savedDataByUrl.at(-1)).toStrictEqual({
      url: expect.stringContaining('keyword=alpha'),
      data: {
        recordingScroll: 70,
        recordedScroll: 0,
        reservesScroll: 0,
      },
    })
  })

  it('[AC 1.9] saves dashboard section scroll data against the leaving route during route changes', async () => {
    const scrollHistory = createRouteAwareScrollHistorySpy()
    const dashboardRepository = createDashboardRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        dashboardApiRepository={dashboardRepository}
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('dashboard-page')).toBeVisible()
    const recordedList = screen.getByTestId('dashboard-section-recorded-list')
    recordedList.scrollTop = 80
    fireEvent.scroll(recordedList)

    act(() => {
      window.location.hash = '#/onair'
    })

    await waitFor(() => {
      expect(scrollHistory.savedDataByUrl.at(-1)).toStrictEqual({
        url: expect.stringContaining('/#/'),
        data: {
          recordingScroll: 0,
          recordedScroll: 80,
          reservesScroll: 0,
        },
      })
    })
  })

  it('[AC 1.4] uses settings saved in the same app session for Dashboard summary limits', async () => {
    window.history.replaceState(null, '', '/#/settings')
    const dashboardRepository = createDashboardRepository()

    render(
      <App
        apiRepository={createShellRepository()}
        dashboardApiRepository={dashboardRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await changeSettingsSelect('録画中 表示件数', '7件')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    fireEvent.click(screen.getByRole('button', { name: 'ダッシュボード' }))

    await screen.findByTestId('dashboard-page')
    await waitFor(() => {
      expect(dashboardRepository.fetchRecording).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 7 }),
      )
    })
  })
})
