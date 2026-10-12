import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { FeatureResult, ServerConfigNavigationState } from '@/app/serverApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  SyntheticRealtimeConnection,
  NOW,
  playbackCss,
  createSchedule,
  createOnAirRepository,
  renderOnAir,
} from './support/onairSpecHarness'

describe('On Air card and ProgramDialog actions', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC frontend-video-playback 1.7] shows the controlled error for a live watch channel that is not a finite integer', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)])

    renderOnAir({
      repository,
      initialHash: '/#/onair/watch?type=hls&channel=synthetic-invalid&mode=0',
    })

    expect(screen.getByTestId('title-bar')).toHaveTextContent('視聴')
    expect(await screen.findByTestId('playback-controlled-error')).toHaveTextContent(
      '再生条件が不正です',
    )
    expect(screen.queryByTestId('video-player-container')).not.toBeInTheDocument()
  })

  it('[AC 3.18] shows player-level unsupported state for M2TS-LL when mpegts live playback is unavailable', async () => {
    const mediaSourceDescriptor = Object.getOwnPropertyDescriptor(window, 'MediaSource')
    Object.defineProperty(window, 'MediaSource', {
      configurable: true,
      value: {
        isTypeSupported: vi.fn(() => false),
      },
    })
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)])

    renderOnAir({
      repository,
      initialHash: '/#/onair/watch?type=m2tsll&channel=10&mode=0',
    })

    expect(await screen.findByTestId('playback-lifecycle-error')).toHaveTextContent(
      '非対応ブラウザーです。',
    )
    expect(screen.getByTestId('video-player-container')).toHaveAttribute(
      'data-playback-lifecycle-state',
      'error',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('非対応ブラウザーです。')

    if (mediaSourceDescriptor !== undefined) {
      Object.defineProperty(window, 'MediaSource', mediaSourceDescriptor)
    }
  })

  it('[AC 3.18] [AC 4.1] mounts live HLS subtitle renderer contract with restored visibility and stroke setting', async () => {
    localStorage.setItem('VideoPlayerSetting', JSON.stringify({ isShowSubtitle: true }))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/streams/live/10/hls')) {
        return new Response(JSON.stringify({ streamId: 82 }))
      }
      if (url.includes('/streams?')) {
        return new Response(JSON.stringify({ items: [{ streamId: 82, isEnable: true }] }))
      }

      return new Response('{}')
    })
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)])

    renderOnAir({
      repository,
      settings: {
        ...new DefaultSettingsFactory().create(),
        isForceEnableSubtitleStroke: false,
      },
      initialHash: '/#/onair/watch?type=hls&channel=10&mode=0',
    })

    const player = await screen.findByTestId('video-player-container')
    const video = player.querySelector('video')
    expect(video).not.toBeNull()
    act(() => {
      fireEvent.loadedData(video!)
      fireEvent.canPlay(video!)
    })

    await waitFor(() => {
      expect(player).toHaveAttribute('data-subtitle-adapter-kind', 'aribb24')
      expect(player).toHaveAttribute('data-subtitle-renderer-mounted', 'true')
    })
    await waitFor(() => {
      expect(screen.queryByTestId('playback-loading-indicator')).not.toBeInTheDocument()
    })
    fireEvent.mouseMove(player)
    expect(player).toHaveAttribute('data-subtitle-stroke-enabled', 'false')
    expect(player).toHaveAttribute('data-subtitle-visible', 'true')
  })

  it('[AC 3.18] shows live HLS start failure in snackbar and player without leaking endpoint details', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/streams/live/10/hls')) {
        return new Response('{}', { status: 500 })
      }

      return new Response('{}')
    })
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)], {}, [
      {
        channelId: 10,
        channelName: 'Synthetic Live Channel',
        mode: 0,
        name: 'Synthetic Live Stream',
        startAt: NOW - 30 * 60 * 1000,
        endAt: NOW + 30 * 60 * 1000,
      },
    ])

    // The HLS lifecycle controller retries the failed stream start once after its 500ms
    // retryDelayMs (see usePlaybackLifecycle's `startRetryCount: 1`) before giving up, and the
    // resulting failure snackbar then closes on a 5 second wall-clock timer. Enable fake timers
    // before rendering so both are driven deterministically, then read the alert synchronously.
    vi.useFakeTimers()
    renderOnAir({
      repository,
      initialHash: '/#/onair/watch?type=hls&channel=10&mode=0',
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('ストリーム開始に失敗')
    vi.useRealTimers()
    expect(screen.getByTestId('video-player-container')).toHaveAttribute(
      'data-playback-lifecycle-state',
      'error',
    )
    expect(screen.getByTestId('playback-lifecycle-error')).toHaveTextContent('ストリーム開始に失敗')
    expect(screen.getByTestId('video-player-container')).not.toHaveTextContent('/api/streams')
    expect(await screen.findByTestId('onair-watch-info-card')).toHaveTextContent(
      'Synthetic Live Stream',
    )
  })

  it('[AC 4.4] matches the Vue live loading spinner size and primary color tokens', () => {
    const spinnerBlock = playbackCss.match(/\.legacyLoadingSpinner \{(?<block>[\s\S]*?)\n\}/)
      ?.groups?.block

    expect(spinnerBlock).toContain('height: 50px;')
    expect(spinnerBlock).toContain('width: 50px;')
    expect(playbackCss).toContain('.legacyLoadingSpinner::before')
    expect(playbackCss).toContain('border: 4px solid transparent;')
    expect(playbackCss).toContain('border-left-color: var(--mui-palette-primary-main, #1976d2);')
  })

  it('[AC frontend-app-shell 1.7] keeps the app blank while server config is not loaded', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)])
    const pendingServerConfig = new Promise<
      FeatureResult<ServerConfigNavigationState, 'config-fetch-failed'>
    >(() => undefined)
    window.history.replaceState(null, '', '/#/onair/watch?type=webm&channel=10&mode=0')

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={{
          fetchVersion: vi.fn(async () => ({
            ok: true as const,
            value: { version: '9.9.9' },
          })),
          fetchServerConfig: vi.fn(() => pendingServerConfig),
        }}
        onAirApiRepository={repository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
    expect(screen.queryByTestId('title-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('playback-pending')).not.toBeInTheDocument()
    expect(screen.queryByTestId('playback-controlled-error')).not.toBeInTheDocument()
    expect(repository.fetchLiveStreams).not.toHaveBeenCalled()
  })

  it('[AC 3.11] renders live HLS watch player without visible pending text when server config fetch fails', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)], {}, [
      {
        channelId: 10,
        channelName: 'Synthetic Live Channel',
        mode: 0,
        name: 'Synthetic Live Stream',
        startAt: NOW - 30 * 60 * 1000,
        endAt: NOW + 30 * 60 * 1000,
      },
    ])
    window.history.replaceState(null, '', '/#/onair/watch?type=hls&channel=10&mode=0')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/streams/live/10/hls')) {
        return new Response(JSON.stringify({ streamId: 82 }))
      }
      if (url.includes('/streams?')) {
        return new Response(JSON.stringify({ items: [{ streamId: 82, isEnable: false }] }))
      }

      return new Response('{}')
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={{
          fetchVersion: vi.fn(async () => ({
            ok: true as const,
            value: { version: '9.9.9' },
          })),
          fetchServerConfig: vi.fn(async () => ({
            ok: false as const,
            error: 'config-fetch-failed' as const,
            message: '設定ダウンロードに失敗しました',
          })),
        }}
        onAirApiRepository={repository}
        osPrefersDark={false}
        viewportWidth={390}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('video-player-container')).toBeInTheDocument()
    expect(screen.queryByTestId('playback-pending')).not.toBeInTheDocument()
    expect(screen.queryByText('読み込み中')).not.toBeInTheDocument()
    expect(await screen.findByTestId('onair-watch-info-card')).toHaveTextContent(
      'Synthetic Live Stream',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('設定ダウンロードに失敗しました')
  })

  it('[AC 3.12] [AC 3.13] shows watch info fetch failure snackbar and retries after 1 second', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)])
    repository.fetchLiveStreams.mockResolvedValue({
      ok: false as const,
      error: 'onair-stream-info-fetch-failed' as const,
      message: 'ストリーム情報取得に失敗',
    })

    // The failure snackbar closes on a 5 second wall-clock timer, and the retry itself waits
    // 1 real second. Drive both under fake timers so neither races the host.
    vi.useFakeTimers()
    renderOnAir({ repository, initialHash: '/#/onair/watch?type=webm&channel=10&mode=0' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('ストリーム情報取得に失敗')).toBeVisible()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(repository.fetchLiveStreams).toHaveBeenCalledTimes(2)
  })

  it('[AC 3.23] refetches watch info when Socket.IO updateStatus invalidates live stream info', async () => {
    const realtimeConnection = new SyntheticRealtimeConnection()
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)])

    renderOnAir({
      repository,
      realtimeConnection,
      initialHash: '/#/onair/watch?type=webm&channel=10&mode=0',
    })
    await waitFor(() => expect(repository.fetchLiveStreams).toHaveBeenCalledTimes(1))

    act(() => {
      realtimeConnection.emit('updateStatus')
    })

    await waitFor(() => expect(repository.fetchLiveStreams).toHaveBeenCalledTimes(2))
  })
})
