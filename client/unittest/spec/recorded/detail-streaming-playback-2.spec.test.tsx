import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createPlaybackNavigationConfig,
  createShellRepository,
  defineCoarsePointerForTest,
  defineNavigatorPlatformForTest,
  fetchInputUrl,
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

  it('[AC frontend-video-playback 4.16a] keeps Android HLS playback loading-only after stream readiness until media data arrives', async () => {
    const recordedRepository = createRecordedRepository()
    const restoreNavigator = defineNavigatorPlatformForTest({
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.15 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    })
    const restorePointer = defineCoarsePointerForTest(true)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = fetchInputUrl(input)
      if (url.includes('/streams/recorded/701/hls')) {
        return new Response(JSON.stringify({ streamId: 82 }))
      }
      if (url.includes('/streams?')) {
        return new Response(JSON.stringify({ items: [{ streamId: 82, isEnable: true }] }))
      }

      return new Response('{}')
    })

    try {
      window.history.replaceState(
        null,
        '',
        '/#/recorded/streaming/701?streamingType=hls&mode=0&fileType=ts&recordedId=bad',
      )
      // HlsLifecycleController polls readiness every readinessPollMs (1000ms, see
      // playbackLifecycleControllerBase.ts) via setInterval before the lifecycle state settles;
      // fake timers must be active before render so they intercept that interval from creation.
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

      const player = screen.getByTestId('video-player-container')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
      vi.useRealTimers()

      fireEvent.pointerDown(player)

      expect(screen.getByTestId('playback-loading-indicator')).toBeVisible()
      expect(screen.getByTestId('playback-legacy-loading-spinner')).toBeVisible()
      expect(screen.queryByTestId('playback-bottom-controls')).not.toBeInTheDocument()
      expect(screen.queryByTestId('playback-center-controls')).not.toBeInTheDocument()

      const video = document.querySelector('video')
      if (video !== null) {
        fireEvent.loadedData(video)
      }
      fireEvent.pointerDown(player)

      await waitFor(() => {
        expect(screen.queryByTestId('playback-loading-indicator')).not.toBeInTheDocument()
      })
      expect(screen.getByTestId('playback-bottom-controls')).toBeVisible()
    } finally {
      restorePointer()
      restoreNavigator()
    }
  })

  it('[AC frontend-video-playback 5.5] restores HLS subtitle setting, saves toggle state, and keeps play failures log-only', async () => {
    const recordedRepository = createRecordedRepository()
    const playFailure = new Error('synthetic play failure')
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(playFailure)
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    Object.defineProperty(document, 'pictureInPictureEnabled', {
      configurable: true,
      value: true,
    })
    localStorage.setItem('VideoPlayerSetting', JSON.stringify({ isShowSubtitle: true }))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = fetchInputUrl(input)
      if (url.includes('/streams/recorded/701/hls')) {
        return new Response(JSON.stringify({ streamId: 83 }))
      }
      if (url.includes('/streams?')) {
        return new Response(JSON.stringify({ items: [{ streamId: 83, isEnable: true }] }))
      }

      return new Response('{}')
    })

    window.history.replaceState(
      null,
      '',
      '/#/recorded/streaming/701?streamingType=hls&mode=0&fileType=ts&recordedId=bad',
    )
    // HlsLifecycleController polls readiness every readinessPollMs (1000ms, see
    // playbackLifecycleControllerBase.ts) via setInterval before the media URL resolves; fake
    // timers must be active before render so they intercept that interval from creation.
    vi.useFakeTimers()
    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isForceEnableSubtitleStroke: false,
        }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={createPlaybackNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const player = screen.getByTestId('video-player-container')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(player).toHaveAttribute('data-playback-media-url', './streamfiles/stream83.m3u8')
    vi.useRealTimers()
    const video = document.querySelector('video')
    if (video !== null) {
      fireEvent.loadedData(video)
    }
    await waitFor(() => {
      expect(screen.queryByTestId('playback-loading-indicator')).not.toBeInTheDocument()
      expect(player).toHaveAttribute('data-subtitle-adapter-kind', 'aribb24')
      expect(player).toHaveAttribute('data-subtitle-renderer-mounted', 'true')
      expect(screen.getByRole('button', { name: '字幕' })).toHaveAttribute(
        'data-subtitle-enabled',
        'true',
      )
    })
    expect(player).toHaveAttribute('data-subtitle-stroke-enabled', 'false')
    expect(player).toHaveAttribute('data-subtitle-visible', 'true')
    expect(screen.getByRole('button', { name: 'ピクチャーインピクチャー' })).toBeVisible()
    expect(screen.queryByTestId('playback-media-error-overlay')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '字幕' }))
    expect(JSON.parse(localStorage.getItem('VideoPlayerSetting') ?? '{}')).toStrictEqual({
      isShowSubtitle: false,
    })
    expect(player).toHaveAttribute('data-subtitle-visible', 'false')

    fireEvent.click(
      within(screen.getByTestId('playback-center-controls')).getByRole('button', {
        name: '再生',
      }),
    )
    await waitFor(() => {
      expect(playSpy).toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalledWith('video.play() failed', playFailure)
    })
    expect(screen.queryByRole('alert', { name: /synthetic play failure/i })).not.toBeInTheDocument()
  })

  it('[AC frontend-video-playback 5.5] does not mount subtitle renderer for recorded WebM and MP4 streaming playback', async () => {
    const recordedRepository = createRecordedRepository()
    localStorage.setItem('VideoPlayerSetting', JSON.stringify({ isShowSubtitle: true }))

    window.history.replaceState(
      null,
      '',
      '/#/recorded/streaming/701?streamingType=mp4&mode=0&fileType=encoded&recordedId=bad',
    )
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
    const video = document.querySelector('video')
    if (video !== null) {
      fireEvent.loadedData(video)
    }
    await waitFor(() => {
      expect(player).toHaveAttribute('data-subtitle-renderer-mounted', 'false')
      expect(player).toHaveAttribute('data-subtitle-adapter-kind', 'none')
      expect(screen.queryByRole('button', { name: '字幕' })).not.toBeInTheDocument()
    })
  })

  it('[AC frontend-video-playback 4.2] does not mount subtitle renderer for direct normal playback', async () => {
    const recordedRepository = createRecordedRepository()
    localStorage.setItem('VideoPlayerSetting', JSON.stringify({ isShowSubtitle: true }))

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

    const player = await screen.findByTestId('video-player-container')
    expect(player).toHaveAttribute('data-subtitle-renderer-mounted', 'false')
    expect(player).toHaveAttribute('data-subtitle-adapter-kind', 'none')
    expect(player).toHaveAttribute('data-subtitle-visible', 'false')
    expect(screen.queryByRole('button', { name: '字幕' })).not.toBeInTheDocument()
  })
})
