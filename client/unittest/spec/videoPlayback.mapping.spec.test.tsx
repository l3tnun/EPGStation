import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecordedRepository } from './recorded/recordedSpecRepository'
import {
  createOnAirRepository,
  createPlaybackSettings,
  findPlayer,
  mockHlsFetch,
  renderPlayback,
} from './support/videoPlaybackSpecSupport'

describe('Video playback requirement 2: direct and streaming player mapping', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 2.1] [AC 2.8] uses the raw video API source for recorded direct watch', async () => {
    renderPlayback({ hash: '/#/recorded/watch?videoId=701&recordedId=301' })

    const player = await findPlayer()
    expect(player).toHaveAttribute('data-playback-source-kind', 'direct-video')
    expect(player).toHaveAttribute('data-playback-lifecycle-mode', 'direct-video')
    await waitFor(() => {
      expect(player).toHaveAttribute('data-playback-media-url', './api/videos/701')
    })
  })

  it('[AC 2.2] maps recorded streaming hls to the HLS stream lifecycle with start and readiness URLs', async () => {
    // Enabled before render(): the readiness poll's setInterval is created during the initial
    // mount, so fake timers must already be active to control it below.
    vi.useFakeTimers()
    mockHlsFetch()

    renderPlayback({ hash: '/#/recorded/streaming/701?streamingType=hls&mode=0&fileType=ts' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const player = screen.getByTestId('video-player-container')
    expect(player).toHaveAttribute('data-playback-source-kind', 'hls-stream')
    expect(player).toHaveAttribute('data-playback-lifecycle-mode', 'hls-api')
    expect(player).toHaveAttribute(
      'data-playback-stream-start-url',
      './api/streams/recorded/701/hls?mode=0&ss=0',
    )
    // playbackLifecycleControllerBase readinessPollMs: the first readiness poll fires 1000ms
    // after start, and mockHlsFetch reports the stream enabled on that first poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(player).toHaveAttribute('data-playback-playlist-url', './streamfiles/stream82.m3u8')
    vi.useRealTimers()
  })

  it.each([
    ['webm', './api/streams/recorded/701/webm?mode=0&ss=0'],
    ['mp4', './api/streams/recorded/702/mp4?mode=0&ss=0'],
  ])(
    '[AC 2.3] maps recorded streaming %s to the corresponding direct stream source',
    async (streamingType, mediaUrl) => {
      const videoFileId = streamingType === 'webm' ? 701 : 702
      const fileType = streamingType === 'webm' ? 'ts' : 'encoded'

      renderPlayback({
        hash: `/#/recorded/streaming/${videoFileId}?streamingType=${streamingType}&mode=0&fileType=${fileType}`,
      })

      const player = await findPlayer()
      expect(player).toHaveAttribute('data-playback-source-kind', 'direct-stream')
      expect(player).toHaveAttribute('data-playback-lifecycle-mode', 'direct-response')
      expect(player).toHaveAttribute('data-playback-media-url', mediaUrl)
    },
  )

  it('[AC 2.4] maps a live webm watch to the direct live stream for the selected type and mode', async () => {
    renderPlayback({ hash: '/#/onair/watch?type=webm&channel=10&mode=0' })

    const player = await findPlayer()
    expect(player).toHaveAttribute('data-playback-kind', 'live')
    expect(player).toHaveAttribute('data-playback-source-kind', 'direct-stream')
    expect(player).toHaveAttribute('data-playback-media-url', './api/streams/live/10/webm?mode=0')
  })

  it('[AC 2.4] maps a live hls watch to the HLS lifecycle with the live start URL', async () => {
    mockHlsFetch()

    renderPlayback({ hash: '/#/onair/watch?type=hls&channel=10&mode=0' })

    const player = await findPlayer()
    expect(player).toHaveAttribute('data-playback-source-kind', 'hls-stream')
    expect(player).toHaveAttribute(
      'data-playback-stream-start-url',
      './api/streams/live/10/hls?mode=0',
    )
  })

  it('[AC 2.5] [AC 2.6] keeps playback alive and notifies through the snackbar when the info fetch fails', async () => {
    const recordedRepository = createRecordedRepository()
    recordedRepository.fetchRecordedDetail = vi.fn(async () => ({
      ok: false as const,
      error: 'recorded-fetch-failed' as const,
      message: 'synthetic failure',
    })) as typeof recordedRepository.fetchRecordedDetail

    renderPlayback({ hash: '/#/recorded/watch?videoId=701&recordedId=301', recordedRepository })

    expect(await screen.findByRole('alert')).toHaveTextContent('番組情報取得に失敗')
    const player = screen.getByTestId('video-player-container')
    expect(player).toHaveAttribute('data-playback-kind', 'recorded-direct')
    expect(player).toHaveAttribute('data-playback-media-url', './api/videos/701')
    expect(screen.queryByTestId('playback-controlled-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('playback-lifecycle-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recorded-watch-info-card')).not.toBeInTheDocument()
  })

  it('[AC 2.6] renders the recorded info card next to the player when the fetch succeeds', async () => {
    const recordedRepository = createRecordedRepository()

    renderPlayback({
      hash: '/#/recorded/streaming/701?streamingType=webm&mode=0&fileType=ts&recordedId=301',
      recordedRepository,
    })

    await findPlayer()
    const card = await screen.findByTestId('recorded-watch-info-card')
    expect(card).toHaveTextContent('Synthetic detail target')
    expect(card).toHaveTextContent('Synthetic channel')
    expect(card).toHaveTextContent('Synthetic detail description')
    expect(recordedRepository.fetchRecordedDetail).toHaveBeenCalledWith({
      recordedId: 301,
      isHalfWidth: true,
    })
  })

  it('[AC 2.7] renders no info card when the route carries no recorded display data', async () => {
    const recordedRepository = createRecordedRepository()

    renderPlayback({ hash: '/#/recorded/watch?videoId=701', recordedRepository })

    await findPlayer()
    expect(screen.queryByTestId('recorded-watch-info-card')).not.toBeInTheDocument()
    expect(recordedRepository.fetchRecordedDetail).not.toHaveBeenCalled()
  })

  it('[AC 2.9] polls readiness through GET /streams with the channel display width from settings', async () => {
    // Enabled before render(): the readiness poll's setInterval is created during the initial
    // mount, so fake timers must already be active to control it below.
    vi.useFakeTimers()
    const { calls } = mockHlsFetch()

    renderPlayback({
      hash: '/#/recorded/streaming/701?streamingType=hls&mode=0&fileType=ts',
      settings: createPlaybackSettings({ isHalfWidthDisplayed: false }),
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const player = screen.getByTestId('video-player-container')
    expect(player).toHaveAttribute('data-playback-readiness-url', './api/streams?isHalfWidth=false')
    // playbackLifecycleControllerBase readinessPollMs: the first readiness poll fires 1000ms
    // after start.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(calls.some((url) => url.includes('/streams?isHalfWidth=false'))).toBe(true)
    vi.useRealTimers()
  })

  it('[AC 2.9] keeps polling readiness until the stream reports enabled', async () => {
    vi.useFakeTimers()
    const { calls } = mockHlsFetch({ enabled: false })

    renderPlayback({ hash: '/#/recorded/streaming/701?streamingType=hls&mode=0&fileType=ts' })

    await vi.advanceTimersByTimeAsync(2500)

    const player = screen.getByTestId('video-player-container')
    expect(player).toHaveAttribute('data-playback-lifecycle-state', 'waiting')
    expect(calls.filter((url) => url.includes('/streams?')).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByTestId('playback-loading-indicator')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('[AC 2.10] reads the HLS playlist from /streamfiles/stream<id>.m3u8 rather than the API base', async () => {
    // Enabled before render(): the readiness poll's setInterval is created during the initial
    // mount, so fake timers must already be active to control it below.
    vi.useFakeTimers()
    mockHlsFetch({ streamId: 91 })

    renderPlayback({
      hash: '/#/onair/watch?type=hls&channel=10&mode=0',
      onAirRepository: createOnAirRepository(),
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const player = screen.getByTestId('video-player-container')
    // playbackLifecycleControllerBase readinessPollMs: the first readiness poll fires 1000ms
    // after start, and mockHlsFetch reports the stream enabled on that first poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(player).toHaveAttribute('data-playback-playlist-url', './streamfiles/stream91.m3u8')
    expect(player.getAttribute('data-playback-playlist-url')).not.toContain('/api/')
    vi.useRealTimers()
  })

  it('[AC 2.9] [AC 3.7] live HLS also keeps waiting past the old 30s cutoff and only fails when the stream disappears', async () => {
    // Live (/onair/watch) shares the same HlsLifecycleController/usePlaybackLifecycle as
    // recorded HLS (resolvePlaybackLifecycleMode() does not branch on live vs recorded), so the
    // readiness behavior and its regression coverage apply to both. This mirrors the recorded-route tests in videoPlayback.lifecycle.spec.test.tsx
    // for the live route specifically.
    vi.useFakeTimers()
    const { calls } = mockHlsFetch({ streamId: 91, enabled: false, disappearsAfterPolls: 40 })

    renderPlayback({
      hash: '/#/onair/watch?type=hls&channel=10&mode=0',
      onAirRepository: createOnAirRepository(),
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(35_000)
    })
    let player = screen.getByTestId('video-player-container')
    expect(player).toHaveAttribute('data-playback-lifecycle-state', 'waiting')
    expect(screen.queryByTestId('playback-lifecycle-error')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    player = screen.getByTestId('video-player-container')
    expect(player).toHaveAttribute('data-playback-lifecycle-state', 'error')
    expect(screen.getByTestId('playback-lifecycle-error')).toHaveTextContent(
      'ストリームが停止しました',
    )

    const pollsAtFailure = calls.filter((url) => url.includes('/streams?')).length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(calls.filter((url) => url.includes('/streams?')).length).toBe(pollsAtFailure)
    vi.useRealTimers()
  })
})
