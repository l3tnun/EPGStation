import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  findPlayer,
  getVideo,
  readyVideo,
  renderPlayback,
  setVideoCurrentTime,
  setVideoDuration,
  stubMediaPlayback,
} from './support/videoPlaybackSpecSupport'

const RECORDED_DIRECT = '/#/recorded/watch?videoId=702'

async function renderReadyDirectPlayer(viewportWidth = 1440) {
  renderPlayback({ hash: RECORDED_DIRECT, viewportWidth })
  const player = await findPlayer()
  const video = getVideo()
  readyVideo(video)
  // Controls hide themselves 3 seconds after the last pointer move, so reveal them under a clock
  // this test advances instead of racing that window in real time.
  vi.useFakeTimers()
  act(() => {
    fireEvent.mouseMove(player)
  })
  for (
    let step = 0;
    step < 200 && player.getAttribute('data-controls-visible') !== 'true';
    step += 1
  ) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }
  vi.useRealTimers()

  return { player, video }
}

describe('Video playback requirement 4: shared player controls', () => {
  beforeEach(() => {
    localStorage.clear()
    stubMediaPlayback()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 4.8] [AC 4.8a] shows a textless loading indicator until the media element reports readiness', async () => {
    renderPlayback({ hash: RECORDED_DIRECT })
    await findPlayer()

    expect(screen.getByTestId('playback-loading-indicator')).toBeEmptyDOMElement()
    expect(screen.getByTestId('playback-legacy-loading-spinner')).toBeInTheDocument()
    expect(screen.queryByTestId('playback-bottom-controls')).not.toBeInTheDocument()

    act(() => {
      fireEvent.loadedData(getVideo())
    })

    expect(screen.queryByTestId('playback-loading-indicator')).not.toBeInTheDocument()
    expect(screen.queryByTestId('playback-legacy-loading-spinner')).not.toBeInTheDocument()
  })

  it('[AC 4.8a] clears the direct-stream loading indicator on play / playing as well', async () => {
    renderPlayback({ hash: '/#/recorded/streaming/701?streamingType=webm&mode=0&fileType=ts' })
    await findPlayer()
    expect(screen.getByTestId('playback-loading-indicator')).toBeInTheDocument()

    act(() => {
      fireEvent.play(getVideo())
    })

    expect(screen.queryByTestId('playback-loading-indicator')).not.toBeInTheDocument()
  })

  it('[AC 4.9] [AC 4.10] renders the bottom overlay with a disabled seek bar and --:-- while duration is unknown', async () => {
    await renderReadyDirectPlayer()

    const bottom = screen.getByTestId('playback-bottom-controls')
    expect(bottom).toBeInTheDocument()
    expect(screen.getByLabelText('シーク')).toBeDisabled()
    expect(screen.getByTestId('playback-time-display')).toHaveTextContent('--:--/--:--')
    expect(screen.getByRole('button', { name: 'フルスクリーン' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'VOL+' })).toBeInTheDocument()
    expect(screen.queryByTestId('playback-speed-controls')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '30秒戻る' })).not.toBeInTheDocument()
  })

  it('[AC 4.5] [AC 4.14] [AC 4.15] enables seek, fast seek and speed controls once duration is known', async () => {
    const { video } = await renderReadyDirectPlayer()
    setVideoDuration(video, 600)

    expect(screen.getByLabelText('シーク')).toBeEnabled()
    expect(screen.getByLabelText('シーク')).toHaveAttribute('max', '600')
    expect(screen.getByTestId('playback-time-display')).toHaveTextContent('00:00/10:00')
    for (const name of ['30秒戻る', '10秒戻る', '10秒進む', '30秒進む']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByTestId('playback-speed-controls')).toHaveTextContent('X1.0')
  })

  it('[AC 4.14] clamps fast seek actions to the 0..duration range', async () => {
    const { video } = await renderReadyDirectPlayer()
    setVideoDuration(video, 100)
    setVideoCurrentTime(video, 10)

    fireEvent.click(screen.getByRole('button', { name: '30秒戻る' }))
    expect(video.currentTime).toBe(0)
    expect(screen.getByTestId('playback-time-display')).toHaveTextContent('00:00/01:40')

    setVideoCurrentTime(video, 90)
    fireEvent.click(screen.getByRole('button', { name: '30秒進む' }))
    expect(video.currentTime).toBe(100)
    expect(screen.getByTestId('playback-time-display')).toHaveTextContent('01:40/01:40')
  })

  it('[AC 4.14] steps the current time by +/-10 seconds via the near fast-seek buttons', async () => {
    const { video } = await renderReadyDirectPlayer()
    setVideoDuration(video, 100)
    setVideoCurrentTime(video, 50)

    fireEvent.click(screen.getByRole('button', { name: '10秒戻る' }))
    expect(video.currentTime).toBe(40)

    fireEvent.click(screen.getByRole('button', { name: '10秒進む' }))
    expect(video.currentTime).toBe(50)
  })

  it('[AC 5.4] commits a seek bar preview on blur, key release, and touch end', async () => {
    const { video } = await renderReadyDirectPlayer()
    setVideoDuration(video, 100)

    const seekBar = screen.getByLabelText('シーク')

    fireEvent.input(seekBar, { target: { value: '20' } })
    fireEvent.blur(seekBar)
    expect(video.currentTime).toBe(20)

    fireEvent.input(seekBar, { target: { value: '30' } })
    fireEvent.keyUp(seekBar)
    expect(video.currentTime).toBe(30)

    fireEvent.input(seekBar, { target: { value: '40' } })
    fireEvent.touchEnd(seekBar)
    expect(video.currentTime).toBe(40)

    fireEvent.input(seekBar, { target: { value: '55' } })
    fireEvent.pointerUp(seekBar)
    expect(video.currentTime).toBe(55)
  })

  it('[AC 4.15] steps the playback rate by 0.1 and resets it to 1.0', async () => {
    const { video } = await renderReadyDirectPlayer()
    setVideoDuration(video, 600)

    fireEvent.click(screen.getByRole('button', { name: '再生速度を上げる' }))
    fireEvent.click(screen.getByRole('button', { name: '再生速度を上げる' }))
    expect(screen.getByTestId('playback-speed-controls')).toHaveTextContent('X1.2')
    expect(video.playbackRate).toBeCloseTo(1.2)

    fireEvent.click(screen.getByRole('button', { name: '再生速度を下げる' }))
    expect(screen.getByTestId('playback-speed-controls')).toHaveTextContent('X1.1')

    fireEvent.click(screen.getByRole('button', { name: '再生速度を標準に戻す' }))
    expect(screen.getByTestId('playback-speed-controls')).toHaveTextContent('X1.0')
    expect(video.playbackRate).toBe(1)
  })

  it('[AC 4.11] [AC 4.15] hides the volume slider and speed controls on a narrow viewport but keeps the volume button', async () => {
    const { video } = await renderReadyDirectPlayer(390)
    setVideoDuration(video, 600)

    expect(screen.queryByLabelText('音量')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'VOL+' })).toBeInTheDocument()
    expect(screen.queryByTestId('playback-speed-controls')).not.toBeInTheDocument()
  })

  it('[AC 4.11] switches the volume icon at 0, 0.4 and above 0.4', async () => {
    const { player, video } = await renderReadyDirectPlayer()
    const iconOf = (name: string) =>
      screen
        .getByRole('button', { name })
        .querySelector('[data-playback-icon]')
        ?.getAttribute('data-playback-icon')

    expect(iconOf('VOL+')).toBe('volume-high')

    fireEvent.change(screen.getByLabelText('音量'), { target: { value: '0.4' } })
    expect(iconOf('VOL~')).toBe('volume-medium')

    fireEvent.change(screen.getByLabelText('音量'), { target: { value: '0' } })
    expect(iconOf('MUTE')).toBe('volume-off')

    Object.defineProperty(video, 'volume', { configurable: true, value: 0.8, writable: true })
    Object.defineProperty(video, 'muted', { configurable: true, value: false, writable: true })
    act(() => {
      fireEvent.volumeChange(video)
    })
    expect(iconOf('VOL+')).toBe('volume-high')
    expect(player).toHaveAttribute('data-controls-visible', 'true')
  })

  it('[AC 4.9] switches the play / pause icon with the media element state', async () => {
    const { video } = await renderReadyDirectPlayer()

    expect(screen.getAllByRole('button', { name: '再生' })).toHaveLength(2)

    act(() => {
      fireEvent.play(video)
    })
    expect(screen.getAllByRole('button', { name: '一時停止' })).toHaveLength(2)

    act(() => {
      fireEvent.pause(video)
    })
    expect(screen.getAllByRole('button', { name: '再生' })).toHaveLength(2)
  })

  it('[AC 4.2] [AC 4.12] shows no subtitle button for direct playback even when the saved setting is on', async () => {
    localStorage.setItem('VideoPlayerSetting', JSON.stringify({ isShowSubtitle: true }))

    const { player } = await renderReadyDirectPlayer()

    expect(player).toHaveAttribute('data-subtitle-renderer-mounted', 'false')
    expect(player).toHaveAttribute('data-subtitle-visible', 'false')
    expect(screen.queryByRole('button', { name: '字幕' })).not.toBeInTheDocument()
  })

  it('[AC 4.2] [AC 4.12] shows the subtitle button for direct playback once a native text track becomes available', async () => {
    // The subtitle-availability effect subscribes to video.textTracks as soon as the media
    // element mounts, so the fake TextTrackList must already be in place via the prototype
    // getter before render -- assigning it to the video instance afterwards would leave the
    // effect subscribed to jsdom's own (unrelated) TextTrackList instance instead.
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'textTracks',
    )
    const trackListTarget = new EventTarget()
    const trackList = Object.assign(trackListTarget, {
      length: 0,
      addEventListener: trackListTarget.addEventListener.bind(trackListTarget),
      removeEventListener: trackListTarget.removeEventListener.bind(trackListTarget),
      dispatchEvent: trackListTarget.dispatchEvent.bind(trackListTarget),
    }) as unknown as TextTrackList
    Object.defineProperty(HTMLMediaElement.prototype, 'textTracks', {
      configurable: true,
      get: () => trackList,
    })

    try {
      const { player } = await renderReadyDirectPlayer()

      expect(player).toHaveAttribute('data-subtitle-renderer-mounted', 'false')
      expect(screen.queryByRole('button', { name: '字幕' })).not.toBeInTheDocument()

      // Simulate a subtitle track becoming available after the media element mounts,
      // e.g. once the browser has parsed an embedded WebVTT track from the container.
      const track = { mode: 'disabled' as TextTrackMode } as TextTrack
      Object.assign(trackList, { 0: track, length: 1 })

      act(() => {
        trackList.dispatchEvent(new Event('addtrack'))
      })

      expect(player).toHaveAttribute('data-subtitle-adapter-kind', 'native-text-track')
      expect(screen.getByRole('button', { name: '字幕' })).toBeInTheDocument()
    } finally {
      if (originalDescriptor !== undefined) {
        Object.defineProperty(HTMLMediaElement.prototype, 'textTracks', originalDescriptor)
      }
    }
  })

  it('[AC 4.3] [AC 4.13] shows the Picture-in-Picture button only when the browser API is enabled', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(document, 'pictureInPictureEnabled')
    Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: true })

    const { video } = await renderReadyDirectPlayer()

    const button = screen.getByRole('button', { name: 'ピクチャーインピクチャー' })
    const request = vi.fn(async () => undefined)
    Object.defineProperty(video, 'requestPictureInPicture', { configurable: true, value: request })
    fireEvent.click(button)
    expect(request).toHaveBeenCalledTimes(1)

    if (descriptor !== undefined) {
      Object.defineProperty(document, 'pictureInPictureEnabled', descriptor)
    } else {
      Reflect.deleteProperty(document, 'pictureInPictureEnabled')
    }
  })

  it('[AC 4.13] hides the Picture-in-Picture button when the browser API is unavailable', async () => {
    Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: false })

    await renderReadyDirectPlayer()

    expect(
      screen.queryByRole('button', { name: 'ピクチャーインピクチャー' }),
    ).not.toBeInTheDocument()
    Reflect.deleteProperty(document, 'pictureInPictureEnabled')
  })

  it('[AC 4.13a] shows the Picture-in-Picture button only after loadedmetadata confirms webkitSupportsPresentationMode, not once at mount (Safari tab; regression guard)', async () => {
    // Reproduces the confirmed iPad Simulator / iPadOS 26.5 Safari-tab behavior:
    // webkitSupportsPresentationMode('picture-in-picture') reports false before the video has
    // loaded metadata and only becomes true once loadedmetadata fires. Evaluating this once at
    // mount time would freeze the button hidden even in a plain Safari tab, and a
    // document.pictureInPictureEnabled-only check would never consult
    // webkitSupportsPresentationMode at all. This test requires both: the button stays
    // hidden pre-loadedmetadata, and appears once webkitSupportsPresentationMode flips true after
    // loadedmetadata.
    const supportsPresentationMode = vi.fn(() => false)
    Object.defineProperty(HTMLVideoElement.prototype, 'webkitSupportsPresentationMode', {
      configurable: true,
      value: supportsPresentationMode,
    })

    try {
      const { video } = await renderReadyDirectPlayer()

      expect(
        screen.queryByRole('button', { name: 'ピクチャーインピクチャー' }),
      ).not.toBeInTheDocument()

      supportsPresentationMode.mockReturnValue(true)
      act(() => {
        fireEvent.loadedMetadata(video)
      })

      expect(supportsPresentationMode).toHaveBeenCalledWith('picture-in-picture')
      expect(screen.getByRole('button', { name: 'ピクチャーインピクチャー' })).toBeInTheDocument()
    } finally {
      Reflect.deleteProperty(HTMLVideoElement.prototype, 'webkitSupportsPresentationMode')
    }
  })

  it('[AC 4.13a] keeps the Picture-in-Picture button hidden when webkitSupportsPresentationMode stays false after loadedmetadata (standalone PWA; WebKit Bugzilla #303885)', async () => {
    const supportsPresentationMode = vi.fn(() => false)
    Object.defineProperty(HTMLVideoElement.prototype, 'webkitSupportsPresentationMode', {
      configurable: true,
      value: supportsPresentationMode,
    })
    // document.pictureInPictureEnabled incorrectly reports true in the WebKit bug this guards
    // against; the button must stay hidden anyway because webkitSupportsPresentationMode takes
    // priority when it exists.
    Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: true })

    try {
      const { video } = await renderReadyDirectPlayer()

      act(() => {
        fireEvent.loadedMetadata(video)
      })

      expect(
        screen.queryByRole('button', { name: 'ピクチャーインピクチャー' }),
      ).not.toBeInTheDocument()
    } finally {
      Reflect.deleteProperty(HTMLVideoElement.prototype, 'webkitSupportsPresentationMode')
      Reflect.deleteProperty(document, 'pictureInPictureEnabled')
    }
  })

  it('[AC 4.13a] re-evaluates Picture-in-Picture support when the media source is replaced (emptied/loadstart)', async () => {
    const supportsPresentationMode = vi.fn(() => true)
    Object.defineProperty(HTMLVideoElement.prototype, 'webkitSupportsPresentationMode', {
      configurable: true,
      value: supportsPresentationMode,
    })

    try {
      const { video } = await renderReadyDirectPlayer()

      act(() => {
        fireEvent.loadedMetadata(video)
      })
      expect(screen.getByRole('button', { name: 'ピクチャーインピクチャー' })).toBeInTheDocument()

      // A new media source is loading; the previous loadedmetadata answer must not linger.
      supportsPresentationMode.mockReturnValue(false)
      act(() => {
        fireEvent.emptied(video)
      })
      expect(
        screen.queryByRole('button', { name: 'ピクチャーインピクチャー' }),
      ).not.toBeInTheDocument()

      act(() => {
        fireEvent.loadStart(video)
      })
      expect(
        screen.queryByRole('button', { name: 'ピクチャーインピクチャー' }),
      ).not.toBeInTheDocument()

      supportsPresentationMode.mockReturnValue(true)
      act(() => {
        fireEvent.loadedMetadata(video)
      })
      expect(screen.getByRole('button', { name: 'ピクチャーインピクチャー' })).toBeInTheDocument()
    } finally {
      Reflect.deleteProperty(HTMLVideoElement.prototype, 'webkitSupportsPresentationMode')
    }
  })
})
