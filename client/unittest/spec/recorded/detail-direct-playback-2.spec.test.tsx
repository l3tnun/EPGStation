import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createPlaybackNavigationConfig,
  createShellRepository,
  defineCoarsePointerForTest,
  defineNavigatorPlatformForTest,
} from './recordedSpecHelpers'
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

  it('[AC frontend-video-playback 4.16] keeps recorded direct narrow controls hidden after media data loads', async () => {
    const recordedRepository = createRecordedRepository()

    window.history.replaceState(null, '', '/#/recorded/watch?videoId=702&recordedId=301')
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={createPlaybackNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={390}
        initialDrawerState="none"
      />,
    )

    const player = await screen.findByTestId('video-player-container')
    await waitFor(() => {
      expect(player).toHaveAttribute('data-playback-media-url', './api/videos/702')
    })
    const video = document.querySelector('video')
    vi.useFakeTimers()
    if (video !== null) {
      Object.defineProperty(video, 'duration', { configurable: true, value: 120 })
      fireEvent.loadedData(video)
      fireEvent.durationChange(video)
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(player).toHaveAttribute('data-controls-visible', 'false')
    expect(screen.queryByTestId('playback-bottom-controls')).not.toBeInTheDocument()
    expect(screen.queryByText('00:00/02:00')).not.toBeInTheDocument()
  })

  it('[AC frontend-video-playback 4.16a] shows recorded direct narrow controls on mobile platforms after media data loads', async () => {
    const recordedRepository = createRecordedRepository()
    const restoreNavigator = defineNavigatorPlatformForTest({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/147.0.7727.15 Safari/537.36',
      platform: 'Linux x86_64',
      maxTouchPoints: 1,
    })
    const restorePointer = defineCoarsePointerForTest(true)

    try {
      window.history.replaceState(null, '', '/#/recorded/watch?videoId=702&recordedId=301')
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

      const player = await screen.findByTestId('video-player-container')
      await waitFor(() => {
        expect(player).toHaveAttribute('data-playback-media-url', './api/videos/702')
      })
      const video = document.querySelector('video')
      vi.useFakeTimers()
      if (video !== null) {
        Object.defineProperty(video, 'duration', { configurable: true, value: 120 })
        fireEvent.loadedData(video)
        fireEvent.durationChange(video)
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(player).toHaveAttribute('data-controls-visible', 'true')
      expect(screen.getByTestId('playback-bottom-controls')).toBeVisible()
      expect(screen.getByTestId('playback-time-display')).toHaveTextContent('00:00/02:00')
    } finally {
      restorePointer()
      restoreNavigator()
    }
  })

  it('[AC frontend-video-playback 4.8] shows recorded direct narrow loading overlay until encoded media data loads', async () => {
    const recordedRepository = createRecordedRepository()

    window.history.replaceState(null, '', '/#/recorded/watch?videoId=702&recordedId=301')
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

    const player = await screen.findByTestId('video-player-container')
    await waitFor(() => {
      expect(player).toHaveAttribute('data-playback-media-url', './api/videos/702')
    })

    expect(screen.getByTestId('playback-loading-indicator')).toBeVisible()
    expect(screen.queryByTestId('playback-bottom-controls')).not.toBeInTheDocument()
  })
})
