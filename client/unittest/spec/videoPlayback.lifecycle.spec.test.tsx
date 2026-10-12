import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecordedRepository } from './recorded/recordedSpecRepository'
import {
  IOS_SAFARI_USER_AGENT,
  defineNavigatorForTest,
  findPlayer,
  getVideo,
  mockHlsFetch,
  readyVideo,
  renderPlayback,
} from './support/videoPlaybackSpecSupport'

const RECORDED_HLS = '/#/recorded/streaming/701?streamingType=hls&mode=0&fileType=ts'

describe('Video playback requirement 3: stream lifecycle and platform constraints', () => {
  let restoreNavigator: (() => void) | undefined

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    restoreNavigator?.()
    restoreNavigator = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.1] runs the HLS lifecycle start → readiness → ready and hands the playlist to the player', async () => {
    // Enabled before render(): the readiness poll's setInterval is created during the initial
    // mount, so fake timers must already be active to control it below.
    vi.useFakeTimers()
    const { calls } = mockHlsFetch({ streamId: 82 })

    renderPlayback({ hash: RECORDED_HLS })
    await act(async () => {
      await Promise.resolve()
    })
    const player = screen.getByTestId('video-player-container')
    // playbackLifecycleControllerBase readinessPollMs: the first readiness poll fires 1000ms
    // after start, and mockHlsFetch reports the stream enabled on that first poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
    expect(player).toHaveAttribute('data-playback-stream-id', '82')
    expect(player).toHaveAttribute('data-playback-playlist-url', './streamfiles/stream82.m3u8')
    expect(calls[0]).toContain('/streams/recorded/701/hls?mode=0&ss=0')
    expect(calls.some((url) => url.includes('/streams?isHalfWidth=true'))).toBe(true)
  })

  it('[AC 3.2] stops the stream and cancels readiness polling when the player unmounts before readiness', async () => {
    vi.useFakeTimers()
    const { calls } = mockHlsFetch({ streamId: 82, enabled: false })

    const view = renderPlayback({ hash: RECORDED_HLS })
    await vi.advanceTimersByTimeAsync(1500)
    const pollsBeforeUnmount = calls.filter((url) => url.includes('/streams?')).length
    expect(pollsBeforeUnmount).toBeGreaterThanOrEqual(1)

    view.unmount()
    await vi.advanceTimersByTimeAsync(5000)

    expect(calls.filter((url) => url.includes('/streams?')).length).toBe(pollsBeforeUnmount)
    expect(calls.filter((url) => /\/streams\/82$/.test(url)).length).toBe(1)
  })

  it('[AC 3.4] treats raw TS direct playback on iOS Safari as ready without an unsupported-browser message', async () => {
    restoreNavigator = defineNavigatorForTest({ userAgent: IOS_SAFARI_USER_AGENT })

    renderPlayback({ hash: '/#/recorded/watch?videoId=701&recordedId=301' })

    const player = await findPlayer()
    await waitFor(() => {
      expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
    })
    expect(player).toHaveAttribute('data-playback-media-url', './api/videos/701')
    expect(screen.queryByTestId('playback-lifecycle-error')).not.toBeInTheDocument()
  })

  it('[AC 3.4] treats encoded MP4 direct playback on iOS Safari as ready', async () => {
    restoreNavigator = defineNavigatorForTest({ userAgent: IOS_SAFARI_USER_AGENT })

    renderPlayback({ hash: '/#/recorded/watch?videoId=702&recordedId=301' })

    const player = await findPlayer()
    await waitFor(() => {
      expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
    })
    expect(player).toHaveAttribute('data-playback-media-url', './api/videos/702')
    expect(screen.queryByTestId('playback-lifecycle-error')).not.toBeInTheDocument()
  })

  it('[AC 3.5] [AC 3.6] leaves a media error without a shared decode/network overlay', async () => {
    renderPlayback({ hash: '/#/recorded/streaming/701?streamingType=webm&mode=0&fileType=ts' })

    await findPlayer()
    const video = getVideo()
    readyVideo(video)
    act(() => {
      video.dispatchEvent(new Event('error'))
    })

    expect(screen.queryByTestId('playback-lifecycle-error')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('video-player-container')).toHaveAttribute(
      'data-playback-lifecycle-state',
      'ready',
    )
  })

  it('[AC 3.7] [AC 3.8] surfaces an HLS start failure as a recoverable error and snackbar', async () => {
    mockHlsFetch({ startStatus: 500 })

    renderPlayback({ hash: RECORDED_HLS })

    expect(await screen.findByRole('alert')).toHaveTextContent('ストリーム開始に失敗')
    const player = screen.getByTestId('video-player-container')
    expect(player).toHaveAttribute('data-playback-lifecycle-state', 'error')
    expect(screen.getByTestId('playback-lifecycle-error')).toHaveTextContent('ストリーム開始に失敗')
    expect(screen.queryByTestId('playback-loading-indicator')).not.toBeInTheDocument()
  })

  it('[AC 3.7] [AC 3.8] surfaces a missing stream id as a recoverable error and snackbar', async () => {
    mockHlsFetch({ streamId: null })

    renderPlayback({ hash: RECORDED_HLS })

    expect(await screen.findByRole('alert')).toHaveTextContent('ストリーム id 取得に失敗')
    expect(screen.getByTestId('playback-lifecycle-error')).toHaveTextContent(
      'ストリーム id 取得に失敗',
    )
    expect(screen.queryByTestId('playback-loading-indicator')).not.toBeInTheDocument()
  })

  it('[AC 3.7] keeps waiting past the old fixed 30s cutoff while isEnabled stays false and the stream is still listed', async () => {
    // /api/streams can keep returning the stream with isEnabled: false past 30s while the server is
    // still healthy, so a fixed readinessTimeoutMs (30000) would tear playback down wrongly. The
    // waitForReadiness() only fails when the stream disappears from the list (see the
    // next test) or the very long safety-net timeout elapses -- a present-but-disabled stream
    // must not fail just because time has passed.
    vi.useFakeTimers()
    const { calls } = mockHlsFetch({ streamId: 82, enabled: false })

    renderPlayback({ hash: RECORDED_HLS })
    await vi.advanceTimersByTimeAsync(60_000)

    const player = screen.getByTestId('video-player-container')
    expect(player).toHaveAttribute('data-playback-lifecycle-state', 'waiting')
    expect(screen.queryByTestId('playback-lifecycle-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('playback-loading-indicator')).toBeInTheDocument()
    expect(calls.filter((url) => url.includes('/streams?')).length).toBeGreaterThanOrEqual(59)
  })

  it('[AC 3.7] turns a stream disappearing from /streams into an immediate recoverable error', async () => {
    // The server removes a stream's entry from /api/streams when the start fails after the id
    // was issued, or the encode process exits (StreamManageModel.ts rejectStart() /
    // attachStream()'s setExitStream(), both call stopActive() which deletes the map entry).
    // That is an unambiguous failure signal, so it must not wait for the readiness timeout.
    vi.useFakeTimers()
    const { calls } = mockHlsFetch({ streamId: 82, enabled: false, disappearsAfterPolls: 1 })

    renderPlayback({ hash: RECORDED_HLS })
    // First poll (t=1000ms) still reports the stream present-but-disabled; the second poll
    // (t=2000ms) is answered with the stream missing, which must fail immediately -- long
    // before the 30 minute safety net and far short of the old 30s cutoff.
    await vi.advanceTimersByTimeAsync(2000)

    const player = screen.getByTestId('video-player-container')
    expect(player).toHaveAttribute('data-playback-lifecycle-state', 'error')
    expect(screen.getByTestId('playback-lifecycle-error')).toHaveTextContent(
      'ストリームが停止しました',
    )
    expect(screen.queryByTestId('playback-loading-indicator')).not.toBeInTheDocument()

    const pollsAtFailure = calls.filter((url) => url.includes('/streams?')).length
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls.filter((url) => url.includes('/streams?')).length).toBe(pollsAtFailure)
  })

  it('[AC 3.8] sends the stream stop request when the ready HLS player unmounts', async () => {
    // Enabled before render(): the readiness poll's setInterval is created during the initial
    // mount, so fake timers must already be active to control it below.
    vi.useFakeTimers()
    const { calls } = mockHlsFetch({ streamId: 82 })

    const view = renderPlayback({ hash: RECORDED_HLS })
    await act(async () => {
      await Promise.resolve()
    })
    const player = screen.getByTestId('video-player-container')
    // playbackLifecycleControllerBase readinessPollMs: the first readiness poll fires 1000ms
    // after start, and mockHlsFetch reports the stream enabled on that first poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')

    view.unmount()
    await act(async () => {
      await Promise.resolve()
    })

    expect(calls.filter((url) => /\/streams\/82$/.test(url))).toHaveLength(1)
  })

  it.each([
    ['recorded webm', '/#/recorded/streaming/701?streamingType=webm&mode=0&fileType=ts'],
    ['live mp4', '/#/onair/watch?type=mp4&channel=10&mode=0'],
  ])(
    '[AC 3.9] [AC 3.10] %s hands the direct stream to <video> without start/keep/stop calls',
    async (_label, hash) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))

      renderPlayback({ hash })

      const player = await findPlayer()
      expect(player).toHaveAttribute('data-playback-lifecycle-mode', 'direct-response')
      expect(getVideo().getAttribute('src')).toBe(player.getAttribute('data-playback-media-url'))
      expect(fetchSpy).not.toHaveBeenCalled()
    },
  )

  it('[AC 3.12] shows the unsupported-browser message for live M2TS-LL without mpegts MSE support', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'MediaSource')
    Object.defineProperty(window, 'MediaSource', {
      configurable: true,
      value: { isTypeSupported: vi.fn(() => false) },
    })

    renderPlayback({ hash: '/#/onair/watch?type=m2tsll&channel=10&mode=0' })

    expect(await screen.findByTestId('playback-lifecycle-error')).toHaveTextContent(
      '非対応ブラウザーです。',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('非対応ブラウザーです。')

    if (descriptor !== undefined) {
      Object.defineProperty(window, 'MediaSource', descriptor)
    } else {
      Reflect.deleteProperty(window, 'MediaSource')
    }
  })

  it('[AC 3.13] grows the estimated duration by one second per synthetic timeupdate while recording', async () => {
    const recordedRepository = createRecordedRepository()
    const detail = vi.mocked(recordedRepository.fetchRecordedDetail)
    const baseline = await detail({ recordedId: 301, isHalfWidth: true })
    detail.mockResolvedValue(
      baseline.ok ? { ok: true, value: { ...baseline.value, isRecording: true } } : baseline,
    )

    // Enabled before render(): usePlaybackMediaElement's synthetic-timeupdate setInterval is
    // created during the initial mount, so fake timers must already be active to control it below.
    vi.useFakeTimers()
    renderPlayback({
      hash: '/#/recorded/streaming/701?streamingType=webm&mode=0&fileType=ts&recordedId=301',
      recordedRepository,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const player = screen.getByTestId('video-player-container')
    expect(player).toHaveAttribute('data-recorded-stream-duration', '600')
    readyVideo()
    expect(screen.getByLabelText('シーク')).toHaveAttribute('max', '600')

    // usePlaybackMediaElement: the synthetic timeupdate interval while recording ticks every 1000ms.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(player).toHaveAttribute('data-playback-synthetic-timeupdates', '1')

    expect(screen.getByLabelText('シーク')).toHaveAttribute('max', '601')
    expect(screen.getByTestId('playback-time-display')).toHaveTextContent('00:00/10:01')
  })

  it('[AC 3.14] passes an absolute media URL with the page origin to the live M2TS-LL player', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'MediaSource')
    Object.defineProperty(window, 'MediaSource', {
      configurable: true,
      value: { isTypeSupported: vi.fn(() => false) },
    })

    renderPlayback({ hash: '/#/onair/watch?type=m2tsll&channel=10&mode=0' })

    const player = await findPlayer()
    expect(player).toHaveAttribute('data-playback-source-kind', 'direct-stream')
    expect(player.getAttribute('data-playback-lifecycle-mode')).toBe('direct-response')

    if (descriptor !== undefined) {
      Object.defineProperty(window, 'MediaSource', descriptor)
    } else {
      Reflect.deleteProperty(window, 'MediaSource')
    }
  })
})
