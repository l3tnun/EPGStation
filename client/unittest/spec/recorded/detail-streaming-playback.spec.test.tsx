import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createPlaybackNavigationConfig,
  createShellRepository,
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

  it('[AC frontend-video-playback 1.10] keeps recorded streaming player when optional recordedId is invalid and suppresses info card', async () => {
    const recordedRepository = createRecordedRepository()

    window.history.replaceState(
      null,
      '',
      '/#/recorded/streaming/701?streamingType=hls&mode=0&fileType=ts&recordedId=bad',
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

    expect(await screen.findByTestId('video-player-container')).toHaveAttribute(
      'data-playback-kind',
      'recorded-streaming',
    )
    expect(screen.getByTestId('video-player-container')).toHaveAttribute(
      'data-playback-source-kind',
      'hls-stream',
    )
    expect(screen.getByTestId('video-player-container')).toHaveAttribute(
      'data-playback-stream-start-url',
      './api/streams/recorded/701/hls?mode=0&ss=0',
    )
    expect(screen.getByTestId('video-player-container')).toHaveAttribute(
      'data-playback-readiness-url',
      './api/streams?isHalfWidth=true',
    )
    expect(screen.queryByTestId('recorded-watch-info-card')).not.toBeInTheDocument()
    expect(recordedRepository.fetchRecordedDetail).not.toHaveBeenCalled()
  })

  it('[AC frontend-video-playback 3.9] uses recorded MP4 direct stream without frontend stream lifecycle API calls', async () => {
    const recordedRepository = createRecordedRepository()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))

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

    expect(await screen.findByTestId('video-player-container')).toHaveAttribute(
      'data-playback-source-kind',
      'direct-stream',
    )
    expect(screen.getByTestId('video-player-container')).toHaveAttribute(
      'data-playback-lifecycle-mode',
      'direct-response',
    )
    expect(screen.getByTestId('video-player-container')).toHaveAttribute(
      'data-playback-media-url',
      './api/streams/recorded/701/mp4?mode=0&ss=0',
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('[AC frontend-video-playback 3.7] shows recoverable error state and snackbar when recorded HLS start fails', async () => {
    const recordedRepository = createRecordedRepository()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }))

    window.history.replaceState(
      null,
      '',
      '/#/recorded/streaming/701?streamingType=hls&mode=0&fileType=ts&recordedId=bad',
    )
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
    // HLS start retries once after a 500ms retryDelayMs (usePlaybackLifecycle's
    // HlsLifecycleController startRetryCount: 1) before the lifecycle settles into 'error'.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('ストリーム開始に失敗')
    expect(screen.getByTestId('video-player-container')).toHaveAttribute(
      'data-playback-lifecycle-state',
      'error',
    )
    expect(screen.getByTestId('playback-lifecycle-error')).toHaveTextContent('ストリーム開始に失敗')
  })

  it('[AC frontend-video-playback 2.9] connects ready recorded HLS playlist to the media element', async () => {
    const recordedRepository = createRecordedRepository()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = fetchInputUrl(input)
      if (url.includes('/streams/recorded/701/hls')) {
        return new Response(JSON.stringify({ streamId: 81 }))
      }
      if (url.includes('/streams?')) {
        return new Response(JSON.stringify({ items: [{ streamId: 81, isEnable: true }] }))
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
        settings={new DefaultSettingsFactory().create()}
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
    expect(player).toHaveAttribute('data-playback-media-url', './streamfiles/stream81.m3u8')
    expect(document.querySelector('video')).toHaveAttribute('src', './streamfiles/stream81.m3u8')
    vi.useRealTimers()
  })

  it('[AC frontend-video-playback 5.4] defers recorded HLS stream recreation until the seek bar drag is committed', async () => {
    const recordedRepository = createRecordedRepository()
    const startedUrls: string[] = []
    const enabledStreamIds: number[] = []
    let nextStreamId = 90
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = fetchInputUrl(input)
      if (url.includes('/streams/recorded/701/hls')) {
        startedUrls.push(url)
        const streamId = nextStreamId++
        enabledStreamIds.push(streamId)
        return new Response(JSON.stringify({ streamId }))
      }
      if (url.includes('/streams?')) {
        return new Response(
          JSON.stringify({
            items: enabledStreamIds.map((streamId) => ({ streamId, isEnable: true })),
          }),
        )
      }

      return new Response('{}')
    })

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
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const player = screen.getByTestId('video-player-container')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
    vi.useRealTimers()
    const video = document.querySelector('video')
    expect(video).not.toBeNull()
    if (video !== null) {
      Object.defineProperty(video, 'duration', { configurable: true, value: 30 })
      fireEvent.loadedData(video)
      fireEvent.durationChange(video)
    }
    await waitFor(() => {
      expect(screen.getByLabelText('シーク')).toHaveAttribute('max', '600')
    })

    const seekBar = screen.getByLabelText('シーク')
    fireEvent.focus(seekBar)
    fireEvent.pointerDown(seekBar)
    fireEvent.input(seekBar, { target: { value: '120' } })
    fireEvent.change(seekBar, { target: { value: '120' } })

    expect(startedUrls).toEqual(['./api/streams/recorded/701/hls?mode=0&ss=0'])
    expect(player).toHaveAttribute(
      'data-playback-stream-start-url',
      './api/streams/recorded/701/hls?mode=0&ss=0',
    )

    const changedSeekBar = screen.getByLabelText('シーク')
    fireEvent.mouseUp(changedSeekBar)
    fireEvent.pointerUp(changedSeekBar)

    await waitFor(() => {
      expect(player).toHaveAttribute(
        'data-playback-stream-start-url',
        './api/streams/recorded/701/hls?mode=0&ss=120',
      )
    })
    expect(startedUrls).toContain('./api/streams/recorded/701/hls?mode=0&ss=120')
  })
})
