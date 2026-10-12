import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createScrollHistory } from '@/app/scrollHistory'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from './hashRouteAssertions'
import {
  SyntheticRealtimeConnection,
  createShellRepository,
  createGuideRepository,
  createRouteAwareScrollHistorySpy,
  waitForGuideVisible,
  createGuideNavigationConfigWithEncodeModes,
} from './support/guideSpecHarness'

describe('Guide route and fetch lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('fix-address-bar', 'guide-shell-scroll-lock')
    window.history.replaceState(null, '', '/#/guide?type=BS&time=26050509')
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-05-05T09:00:00+09:00'))
  })

  afterEach(() => {
    document.documentElement.classList.remove('fix-address-bar', 'guide-shell-scroll-lock')
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 1.5] [AC 1.10] [AC 1.11] [AC 2.14] [AC 3.32] fetches single-channel schedule and only refreshes reserve index without resetting visible grid or Guide chrome on updateStatus', async () => {
    window.history.replaceState(null, '', '/#/guide?channelId=301&time=26050500')
    const guideRepository = createGuideRepository()
    const connection = new SyntheticRealtimeConnection()
    let resolveRefetch: (() => void) | undefined

    vi.mocked(guideRepository.fetchReserveIndex)
      .mockResolvedValueOnce({
        ok: true,
        value: {},
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefetch = () => {
              resolve({
                ok: true,
                value: {},
              })
            }
          }),
      )

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isShowOnlyFreePrograms: true,
        }}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        realtimeConnectionFactory={() => connection}
        navigationConfig={{
          status: 'loaded',
          liveStreamEnabled: false,
          enabledBroadcastWaves: ['GR', 'BS'],
        }}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const guidePage = await waitForGuideVisible()
    const programGrid = screen.getByTestId('guide-program-grid')
    const channelHeader = screen.getByTestId('guide-channel-header')
    const timeScale = screen.getByTestId('guide-time-scale')

    programGrid.scrollLeft = 64
    programGrid.scrollTop = 128
    act(() => {
      programGrid.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    expect(guideRepository.fetchSchedule).toHaveBeenCalledWith({
      mode: 'singleChannel',
      channelId: 301,
      startAt: Date.parse('2026-05-05T00:00:00+09:00'),
      days: 8,
      isHalfWidth: true,
      isFree: true,
    })

    fireEvent.click(screen.getByRole('button', { name: '時刻選択' }))
    await screen.findByLabelText('日付')

    act(() => {
      connection.emit('updateStatus')
    })

    await waitFor(() => {
      expect(guideRepository.fetchReserveIndex).toHaveBeenCalledTimes(2)
    })
    expect(guidePage).toHaveAttribute('data-guide-visible', 'true')
    expect(screen.getByRole('button', { name: '時刻選択' })).toBeInTheDocument()
    expect(screen.getByLabelText('日付')).toBeInTheDocument()

    await act(async () => {
      resolveRefetch?.()
    })

    expect(guideRepository.fetchSchedule).toHaveBeenCalledTimes(1)
    expect(guidePage).toHaveAttribute('data-guide-visible', 'true')
    expect(channelHeader).toBeInTheDocument()
    expect(timeScale).toBeInTheDocument()
  })

  it('[AC 2.10] restores saved grid scroll after route boundary adds the Vue timestamp history key', async () => {
    const guideRepository = createGuideRepository()
    const scrollHistory = createScrollHistory({
      shouldRestoreHistory: true,
    })
    scrollHistory.saveScrollData({
      scrollLeft: 120,
      scrollTop: 240,
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        scrollHistory={scrollHistory}
        navigationConfig={{
          status: 'loaded',
          liveStreamEnabled: false,
          enabledBroadcastWaves: ['GR', 'BS'],
        }}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitForGuideVisible()

    expect(screen.getByTestId('guide-program-grid')).toHaveProperty('scrollLeft', 120)
    expect(screen.getByTestId('guide-program-grid')).toHaveProperty('scrollTop', 240)
    expect(screen.getByTestId('guide-channel-header')).toHaveProperty('scrollLeft', 120)
    expect(screen.getByTestId('guide-time-scale')).toHaveProperty('scrollTop', 240)
  })

  it('[AC 2.9] saves grid scroll data against Guide routes after timestamp normalization', async () => {
    const guideRepository = createGuideRepository()
    const scrollHistory = createRouteAwareScrollHistorySpy()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        scrollHistory={scrollHistory}
        navigationConfig={{
          status: 'loaded',
          liveStreamEnabled: false,
          enabledBroadcastWaves: ['GR', 'BS'],
        }}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitForGuideVisible()
    const programGrid = screen.getByTestId('guide-program-grid')
    programGrid.scrollLeft = 120
    programGrid.scrollTop = 240
    fireEvent.scroll(programGrid)

    act(() => {
      window.location.hash = '#/recording'
    })

    await waitFor(() => {
      expectHashRoute('#/recording')
    })
    expect(scrollHistory.savedDataByUrl).toStrictEqual([
      {
        data: {
          scrollLeft: 120,
          scrollTop: 240,
        },
        url: 'http://localhost:3000/#/guide?type=BS&time=26050509&timestamp=1777939200000',
      },
    ])
  })

  it('[AC 3.19] renders /guide/setting through the Guide shell with the settings title only', () => {
    window.history.replaceState(null, '', '/#/guide/setting')

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={createGuideRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(screen.getByTestId('title-bar')).toHaveTextContent('番組表設定')
    expect(screen.getByTestId('guide-setting-page')).toBeVisible()
    expect(screen.queryByTestId('guide-program-grid')).not.toBeInTheDocument()
  })

  it('[AC 1.9] [AC 6.3] keeps blank presentation without grid body or snackbar when schedule data is empty', async () => {
    const guideRepository = createGuideRepository()
    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: true,
      value: [],
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitForGuideVisible()
    expect(screen.queryByTestId('guide-program-grid')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('[AC 6.2] keeps the guide shell and route title without date when schedule fetch fails', async () => {
    const guideRepository = createGuideRepository()
    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: false,
      error: 'guide-schedule-fetch-failed',
      message: '番組表情報の取得に失敗しました',
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const guidePage = await waitForGuideVisible()

    // The fetch-failure snackbar closes on a 5 second wall-clock timer. Read it under fake
    // timers instead of polling, so the assertion never races the host.
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole('alert')).toBeVisible()
    vi.useRealTimers()

    expect(guidePage).toHaveAttribute('data-guide-visible', 'true')
    expect(screen.getByTestId('title-bar')).toHaveTextContent('番組表')
    expect(screen.getByTestId('title-bar')).not.toHaveTextContent('05/05')
    expect(screen.queryByTestId('guide-program-grid')).not.toBeInTheDocument()
  })
})
