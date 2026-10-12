import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createScrollHistory } from '@/app/scrollHistory'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createPlaybackNavigationConfig, createShellRepository } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

describe('Recorded detail Task 3 route, data, and actions', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded/detail/301')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 4.10] renders a controlled error when recorded direct watch videoId is omitted', async () => {
    const recordedRepository = createRecordedRepository()

    window.history.replaceState(null, '', '/#/recorded/watch?recordedId=301')
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={createPlaybackNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(screen.getByTestId('title-bar')).toHaveTextContent('視聴')
    expect(await screen.findByTestId('playback-controlled-error')).toHaveTextContent(
      '再生対象が不正です',
    )
    expect(screen.queryByTestId('video-player-container')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recorded-watch-info-card')).not.toBeInTheDocument()
    expect(recordedRepository.fetchRecordedDetail).not.toHaveBeenCalled()
  })

  it('[AC frontend-video-playback 1.13] emits scroll restoration readiness for recorded direct watch route', async () => {
    const recordedRepository = createRecordedRepository()
    const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })
    const emitDoneGetData = vi.spyOn(scrollHistory, 'emitDoneGetData')

    window.history.replaceState(null, '', '/#/recorded/watch?recordedId=301')
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={createPlaybackNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={420}
        initialDrawerState="none"
        scrollHistory={scrollHistory}
      />,
    )

    expect(await screen.findByTestId('playback-controlled-error')).toHaveTextContent(
      '再生対象が不正です',
    )
    expect(emitDoneGetData).toHaveBeenCalledTimes(1)
  })

  it('[AC frontend-video-playback 1.3] keeps recorded direct player and suppresses the info card when optional recordedId is invalid', async () => {
    const recordedRepository = createRecordedRepository()

    window.history.replaceState(null, '', '/#/recorded/watch?videoId=701&recordedId=bad')
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={createPlaybackNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('video-player-container')).toHaveAttribute(
      'data-playback-kind',
      'recorded-direct',
    )
    const player = screen.getByTestId('video-player-container')
    const video = document.querySelector('video')
    vi.useFakeTimers()
    if (video !== null) {
      fireEvent.canPlay(video)
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(player).toHaveAttribute('data-controls-visible', 'true')
    expect(screen.queryByTestId('recorded-watch-info-card')).not.toBeInTheDocument()
    expect(recordedRepository.fetchRecordedDetail).not.toHaveBeenCalled()
  })

  it('[AC frontend-video-playback 2.1] renders recorded watch info card beside the direct player', async () => {
    const recordedRepository = createRecordedRepository()

    window.history.replaceState(null, '', '/#/recorded/watch?videoId=701&recordedId=301')
    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isHalfWidthDisplayed: false,
        }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={createPlaybackNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('video-player-container')).toHaveAttribute(
      'data-playback-source-kind',
      'direct-video',
    )
    expect(await screen.findByTestId('recorded-watch-info-card')).toHaveTextContent(
      'Synthetic detail target',
    )
    await waitFor(() => {
      expect(screen.getByTestId('video-player-container')).toHaveAttribute(
        'data-playback-media-url',
        './api/videos/701',
      )
    })
    expect(recordedRepository.fetchRecordedDetail).toHaveBeenCalledWith({
      recordedId: 301,
      isHalfWidth: false,
    })
  })

  it('[AC frontend-video-playback 2.6] keeps recorded direct playback when watch info fetch fails', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecordedDetail).mockResolvedValueOnce({
      ok: false,
      error: 'recorded-fetch-failed',
      message: '番組情報取得に失敗',
    })
    window.history.replaceState(null, '', '/#/recorded/watch?videoId=701&recordedId=302')
    vi.useFakeTimers()
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={createPlaybackNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('番組情報取得に失敗')
    const player = screen.getByTestId('video-player-container')
    const video = document.querySelector('video')
    if (video !== null) {
      fireEvent.loadedData(video)
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(player).toHaveAttribute('data-controls-visible', 'false')
    expect(screen.queryByTestId('playback-bottom-controls')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recorded-watch-info-card')).not.toBeInTheDocument()
  })

  it('[AC frontend-video-playback 2.6] shows recorded direct narrow controls when watch info fetch fails after media is ready', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecordedDetail).mockResolvedValueOnce({
      ok: false,
      error: 'recorded-fetch-failed',
      message: '番組情報取得に失敗',
    })

    window.history.replaceState(null, '', '/#/recorded/watch?videoId=702&recordedId=301')
    vi.useFakeTimers()
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={createPlaybackNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={420}
        initialDrawerState="none"
      />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('番組情報取得に失敗')
    const player = screen.getByTestId('video-player-container')
    const video = document.querySelector('video')
    if (video !== null) {
      Object.defineProperty(video, 'duration', { configurable: true, value: 120 })
      fireEvent.canPlay(video)
      fireEvent.durationChange(video)
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(player).toHaveAttribute('data-controls-visible', 'true')
    expect(screen.getByTestId('playback-time-display')).toHaveTextContent('00:00/02:00')
    expect(screen.queryByTestId('recorded-watch-info-card')).not.toBeInTheDocument()
  })

  it('[AC frontend-video-playback 4.8a] keeps recorded direct TS controls hidden until the media can play', async () => {
    const recordedRepository = createRecordedRepository()

    window.history.replaceState(null, '', '/#/recorded/watch?videoId=701&recordedId=301')
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={createPlaybackNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const player = await screen.findByTestId('video-player-container')
    await waitFor(() => {
      expect(player).toHaveAttribute('data-playback-media-url', './api/videos/701')
    })
    const video = document.querySelector('video')
    vi.useFakeTimers()
    if (video !== null) {
      fireEvent.error(video)
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(player).toHaveAttribute('data-controls-visible', 'false')
    expect(screen.getByTestId('playback-loading-indicator')).toBeVisible()
    expect(screen.queryByTestId('playback-bottom-controls')).not.toBeInTheDocument()
    expect(screen.queryByText('--:--/--:--')).not.toBeInTheDocument()
  })
})
