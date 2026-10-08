import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecordedRepository } from './recorded/recordedSpecRepository'
import {
  createPlaybackSettings,
  findPlayer,
  getVideo,
  mockHlsFetch,
  readyVideo,
  renderPlayback,
  setVideoCurrentTime,
  setVideoDuration,
  stubMediaPlayback,
} from './support/videoPlaybackSpecSupport'

// playbackLifecycleControllerBase polls readiness on this interval.
const READINESS_POLL_MS = 1000

const RECORDED_WEBM = '/#/recorded/streaming/701?streamingType=webm&mode=0&fileType=ts'
const RECORDED_HLS = '/#/recorded/streaming/701?streamingType=hls&mode=0&fileType=ts'

// The readiness poll (playbackLifecycleControllerBase readinessPollMs) and the controls auto-hide
// both run on timers, so mount under a clock this helper advances. Enabling fake timers after the
// render would leave the interval on the real clock, where advancing does not reach it. Callers get
// real timers back so their own waits behave normally.
async function renderReadyStreamingPlayer(hash = RECORDED_WEBM) {
  const recordedRepository = createRecordedRepository()
  vi.useFakeTimers()
  renderPlayback({ hash, recordedRepository })

  const settle = async (isReady: () => boolean): Promise<void> => {
    for (let step = 0; step < 200 && !isReady(); step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(READINESS_POLL_MS)
      })
    }
  }

  await settle(() => screen.queryByTestId('video-player-container') !== null)
  const player = screen.getByTestId('video-player-container')
  await settle(() => player.getAttribute('data-recorded-stream-duration') === '600')
  const video = getVideo()
  readyVideo(video)
  await settle(() => player.getAttribute('data-controls-visible') === 'true')
  vi.useRealTimers()

  return { player, video, recordedRepository }
}

// controls は再生中 3 秒で自動的に隠れる。直前の real-time な待機で host が遅いとすでに
// 隠れていることがあるため、fake timers 下で pointer を動かして出し直し、実時間の
// polling を挟まずに同期 query で読む。
async function findSeekControl(player: HTMLElement): Promise<HTMLElement> {
  vi.useFakeTimers()
  fireEvent.pointerMove(player)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  const seek = screen.getByLabelText('シーク')
  vi.useRealTimers()

  return seek
}

async function findControlButton(player: HTMLElement, name: string): Promise<HTMLElement> {
  vi.useFakeTimers()
  fireEvent.pointerMove(player)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  const button = screen.getByRole('button', { name })
  vi.useRealTimers()

  return button
}

describe('Video playback requirement 5: recorded streaming parity', () => {
  let media: ReturnType<typeof stubMediaPlayback>

  beforeEach(() => {
    localStorage.clear()
    media = stubMediaPlayback()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 5.1] renders an unmuted autoplay playsinline video element for the playback page', async () => {
    renderPlayback({ hash: RECORDED_WEBM })
    await findPlayer()

    const video = getVideo()
    expect(video).toHaveAttribute('autoplay')
    expect(video).toHaveAttribute('playsinline')
    expect(video.muted).toBe(false)
    expect(video).not.toHaveAttribute('muted')
  })

  it('[AC 5.2] uses the /videos/:id/duration total for the seek bar and time display', async () => {
    const { player, video, recordedRepository } = await renderReadyStreamingPlayer()
    setVideoDuration(video, 60)

    expect(recordedRepository.fetchVideoDuration).toHaveBeenCalledWith(701)
    expect(await findSeekControl(player)).toHaveAttribute('max', '600')
    expect(screen.getByTestId('playback-time-display')).toHaveTextContent('00:00/10:00')
  })

  it('[AC 5.2] notifies through the snackbar when the duration fetch fails and keeps playback', async () => {
    const recordedRepository = createRecordedRepository()
    recordedRepository.fetchVideoDuration = vi.fn(async () => ({
      ok: false as const,
      error: 'video-duration-fetch-failed' as const,
      message: 'synthetic failure',
    })) as typeof recordedRepository.fetchVideoDuration

    renderPlayback({ hash: RECORDED_WEBM, recordedRepository })

    expect(await screen.findByRole('alert')).toHaveTextContent('動画長の取得に失敗')
    expect(screen.getByTestId('video-player-container')).toHaveAttribute(
      'data-playback-media-url',
      './api/streams/recorded/701/webm?mode=0&ss=0',
    )
  })

  it('[AC 5.3] [AC 3.11] rebuilds the direct stream URL with ss for an out-of-segment seek and restores rate and paused state', async () => {
    const { player, video } = await renderReadyStreamingPlayer()
    setVideoDuration(video, 60)
    video.playbackRate = 1.5

    const seek = await findSeekControl(player)
    fireEvent.input(seek, { target: { value: '500' } })
    fireEvent.mouseUp(seek)

    await waitFor(() => {
      expect(player).toHaveAttribute(
        'data-playback-media-url',
        './api/streams/recorded/701/webm?mode=0&ss=500',
      )
    })
    expect(getVideo().playbackRate).toBe(1.5)
    expect(media.play).not.toHaveBeenCalled()
    expect(screen.getByTestId('playback-time-display')).toHaveTextContent('08:20/10:00')
  })

  it('[AC 5.3] restarts playback after an out-of-segment seek when the video was playing', async () => {
    const { player, video } = await renderReadyStreamingPlayer()
    setVideoDuration(video, 60)
    act(() => {
      fireEvent.play(video)
    })
    media.play.mockClear()

    const seek = await findSeekControl(player)
    fireEvent.input(seek, { target: { value: '300' } })
    fireEvent.mouseUp(seek)

    await waitFor(() => {
      expect(player).toHaveAttribute(
        'data-playback-media-url',
        './api/streams/recorded/701/webm?mode=0&ss=300',
      )
    })
    await waitFor(() => {
      expect(media.play).toHaveBeenCalled()
    })
  })

  it('[AC 5.3] seeks inside the current segment by moving video.currentTime relative to the segment start', async () => {
    const { player, video } = await renderReadyStreamingPlayer()
    setVideoDuration(video, 60)

    const seek = await findSeekControl(player)
    fireEvent.input(seek, { target: { value: '30' } })
    fireEvent.mouseUp(seek)

    expect(video.currentTime).toBe(30)
    expect(player).toHaveAttribute(
      'data-playback-media-url',
      './api/streams/recorded/701/webm?mode=0&ss=0',
    )
  })

  it('[AC 5.4] keeps the HLS start URL and lifecycle untouched while the seek bar is being dragged', async () => {
    const { calls } = mockHlsFetch({ streamId: 82 })
    const { player, video } = await renderReadyStreamingPlayer(RECORDED_HLS)
    await waitFor(() => {
      expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
    })
    setVideoDuration(video, 60)
    const startsBefore = calls.filter((url) => url.includes('/streams/recorded/701/hls')).length

    const seek = await findSeekControl(player)
    fireEvent.input(seek, { target: { value: '400' } })

    expect(screen.getByTestId('playback-time-display')).toHaveTextContent('06:40/10:00')
    expect(player).toHaveAttribute(
      'data-playback-stream-start-url',
      './api/streams/recorded/701/hls?mode=0&ss=0',
    )
    expect(calls.filter((url) => url.includes('/streams/recorded/701/hls')).length).toBe(
      startsBefore,
    )
  })

  it('[AC 5.4] restarts the HLS lifecycle with ss when a committed seek leaves the current segment', async () => {
    const { calls } = mockHlsFetch({ streamId: 82 })
    const { player, video } = await renderReadyStreamingPlayer(RECORDED_HLS)
    await waitFor(() => {
      expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
    })
    setVideoDuration(video, 60)

    const seek = await findSeekControl(player)
    fireEvent.input(seek, { target: { value: '400' } })
    fireEvent.mouseUp(seek)

    await waitFor(() => {
      expect(player).toHaveAttribute(
        'data-playback-stream-start-url',
        './api/streams/recorded/701/hls?mode=0&ss=400',
      )
    })
    await waitFor(() => {
      expect(calls.some((url) => url.includes('/streams/recorded/701/hls?mode=0&ss=400'))).toBe(
        true,
      )
    })
  })

  it('[AC 5.5] mounts the ARIB subtitle renderer for recorded HLS with the saved visibility and stroke setting', async () => {
    localStorage.setItem('VideoPlayerSetting', JSON.stringify({ isShowSubtitle: true }))
    // Enabled before render(): the readiness poll's setInterval is created during the initial
    // mount, so fake timers must already be active to control it below.
    vi.useFakeTimers()
    mockHlsFetch({ streamId: 82 })

    renderPlayback({
      hash: RECORDED_HLS,
      settings: createPlaybackSettings({ isForceEnableSubtitleStroke: false }),
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
    expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
    vi.useRealTimers()
    readyVideo()

    await waitFor(() => {
      expect(player).toHaveAttribute('data-subtitle-renderer-mounted', 'true')
    })
    expect(player).toHaveAttribute('data-subtitle-renderer-kind', 'aribb24')
    expect(player).toHaveAttribute('data-subtitle-visible', 'true')
    expect(player).toHaveAttribute('data-subtitle-stroke-enabled', 'false')
  })

  it('[AC 4.4] [AC 5.5] toggles and persists VideoPlayerSetting.isShowSubtitle from the subtitle button', async () => {
    // Enabled before render(): the readiness poll's setInterval is created during the initial
    // mount, so fake timers must already be active to control it below.
    vi.useFakeTimers()
    mockHlsFetch({ streamId: 82 })
    renderPlayback({ hash: RECORDED_HLS })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const player = screen.getByTestId('video-player-container')
    // playbackLifecycleControllerBase readinessPollMs: the first readiness poll fires 1000ms
    // after start, and mockHlsFetch reports the stream enabled on that first poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
    vi.useRealTimers()
    readyVideo()
    await waitFor(() => {
      expect(player).toHaveAttribute('data-subtitle-adapter-kind', 'aribb24')
    })
    await waitFor(() => {
      expect(player).toHaveAttribute('data-controls-visible', 'true')
    })

    const button = await findControlButton(player, '字幕')
    expect(button).toHaveAttribute('data-subtitle-enabled', 'false')
    fireEvent.click(button)

    expect(await findControlButton(player, '字幕')).toHaveAttribute('data-subtitle-enabled', 'true')
    expect(player).toHaveAttribute('data-subtitle-visible', 'true')
    expect(JSON.parse(localStorage.getItem('VideoPlayerSetting') ?? '{}')).toEqual({
      isShowSubtitle: true,
    })
  })

  it('[AC 5.5] treats recorded WebM as a direct stream without a subtitle renderer or button', async () => {
    const { player } = await renderReadyStreamingPlayer()

    expect(player).toHaveAttribute('data-subtitle-renderer-mounted', 'false')
    expect(player).toHaveAttribute('data-subtitle-renderer-kind', 'none')
    expect(screen.queryByRole('button', { name: '字幕' })).not.toBeInTheDocument()
  })

  it('[AC 5.6] reports the absolute position as segment start plus video.currentTime after a restart', async () => {
    const { player, video } = await renderReadyStreamingPlayer()
    setVideoDuration(video, 60)

    const seek = await findSeekControl(player)
    fireEvent.input(seek, { target: { value: '500' } })
    fireEvent.mouseUp(seek)
    await waitFor(() => {
      expect(player).toHaveAttribute(
        'data-playback-media-url',
        './api/streams/recorded/701/webm?mode=0&ss=500',
      )
    })

    setVideoCurrentTime(getVideo(), 10)

    expect(screen.getByTestId('playback-time-display')).toHaveTextContent('08:30/10:00')
    expect(seek).toHaveValue('510')
  })
})
