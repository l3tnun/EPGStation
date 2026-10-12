import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANDROID_USER_AGENT,
  defineNavigatorForTest,
  findPlayer,
  getVideo,
  readyVideo,
  renderPlayback,
  setVideoCurrentTime,
  setVideoDuration,
  stubMediaPlayback,
} from './support/videoPlaybackSpecSupport'

const RECORDED_DIRECT = '/#/recorded/watch?videoId=702'
const LIVE_DIRECT = '/#/onair/watch?type=mp4&channel=10&mode=0'

async function renderReadyDirectPlayer(viewportWidth = 1440) {
  renderPlayback({ hash: RECORDED_DIRECT, viewportWidth })
  const player = await findPlayer()
  const video = getVideo()
  readyVideo(video)
  act(() => {
    fireEvent.mouseMove(player)
  })
  await waitFor(() => {
    expect(player).toHaveAttribute('data-controls-visible', 'true')
  })

  return { player, video }
}

async function renderReadyLivePlayer(viewportWidth = 1440) {
  renderPlayback({ hash: LIVE_DIRECT, viewportWidth })
  const player = await findPlayer()
  const video = getVideo()
  readyVideo(video)
  act(() => {
    fireEvent.mouseMove(player)
  })
  await waitFor(() => {
    expect(player).toHaveAttribute('data-controls-visible', 'true')
  })

  return { player, video }
}

describe('Video playback requirement 4: control visibility, gestures and shortcuts', () => {
  let restoreNavigator: (() => void) | undefined

  beforeEach(() => {
    localStorage.clear()
    stubMediaPlayback()
  })

  afterEach(() => {
    restoreNavigator?.()
    restoreNavigator = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 4.16] hides controls and the cursor after 3000ms without pointer movement while playing', async () => {
    vi.useFakeTimers()
    renderPlayback({ hash: RECORDED_DIRECT })
    const player = screen.getByTestId('video-player-container')
    const video = getVideo()
    readyVideo(video)
    act(() => {
      fireEvent.play(video)
    })
    act(() => {
      fireEvent.mouseMove(player)
    })
    expect(player).toHaveAttribute('data-controls-visible', 'true')
    expect(player).toHaveAttribute('data-cursor-hidden', 'false')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(player).toHaveAttribute('data-controls-visible', 'false')
    expect(player).toHaveAttribute('data-cursor-hidden', 'true')
  })

  it('[AC 4.16] keeps controls visible while paused and hides them on mouse leave only while playing', async () => {
    vi.useFakeTimers()
    renderPlayback({ hash: RECORDED_DIRECT })
    const player = screen.getByTestId('video-player-container')
    const video = getVideo()
    readyVideo(video)

    act(() => {
      fireEvent.mouseMove(player)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500)
    })
    expect(player).toHaveAttribute('data-controls-visible', 'true')
    expect(player).toHaveAttribute('data-cursor-hidden', 'false')

    act(() => {
      fireEvent.mouseLeave(player)
    })
    expect(player).toHaveAttribute('data-controls-visible', 'true')

    act(() => {
      fireEvent.play(video)
    })
    act(() => {
      fireEvent.mouseLeave(player)
    })
    expect(player).toHaveAttribute('data-controls-visible', 'false')
    expect(player).toHaveAttribute('data-cursor-hidden', 'true')
  })

  it('[AC 4.16a] toggles controls with a tap on the player background on a coarse-pointer platform', async () => {
    restoreNavigator = defineNavigatorForTest({ userAgent: ANDROID_USER_AGENT, maxTouchPoints: 5 })
    renderPlayback({ hash: RECORDED_DIRECT })
    const player = await findPlayer()
    const video = getVideo()
    readyVideo(video)
    await waitFor(() => {
      expect(player).toHaveAttribute('data-controls-visible', 'true')
    })

    fireEvent.pointerDown(player)
    expect(player).toHaveAttribute('data-controls-visible', 'false')

    fireEvent.pointerDown(player)
    expect(player).toHaveAttribute('data-controls-visible', 'true')
  })

  it('[AC 4.16a] does not toggle controls when the tap lands on an interactive control', async () => {
    restoreNavigator = defineNavigatorForTest({ userAgent: ANDROID_USER_AGENT, maxTouchPoints: 5 })
    renderPlayback({ hash: RECORDED_DIRECT })
    const player = await findPlayer()
    readyVideo()
    await waitFor(() => {
      expect(player).toHaveAttribute('data-controls-visible', 'true')
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'フルスクリーン' }))

    expect(player).toHaveAttribute('data-controls-visible', 'true')
  })

  it('[AC 4.16a] shows only the spinner and no controls while loading on a coarse-pointer platform', async () => {
    restoreNavigator = defineNavigatorForTest({ userAgent: ANDROID_USER_AGENT, maxTouchPoints: 5 })
    renderPlayback({ hash: RECORDED_DIRECT })
    const player = await findPlayer()

    fireEvent.pointerDown(player)

    expect(screen.getByTestId('playback-legacy-loading-spinner')).toBeInTheDocument()
    expect(screen.queryByTestId('playback-center-controls')).not.toBeInTheDocument()
    expect(screen.queryByTestId('playback-bottom-controls')).not.toBeInTheDocument()
  })

  it('[AC 4.6] handles keyboard shortcuts without a snackbar and swallows a rejected play()', async () => {
    const play = vi.fn(async () => {
      throw new Error('synthetic autoplay rejection')
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { player, video } = await renderReadyDirectPlayer()
    setVideoDuration(video, 600)

    fireEvent.keyDown(player, { key: ' ' })
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('video.play() failed', expect.any(Error))
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.keyDown(player, { key: 'ArrowRight' })
    expect(video.currentTime).toBe(10)
    fireEvent.keyDown(player, { key: 'm' })
    expect(video.muted).toBe(true)
  })

  it('[AC 4.10] [AC 4.14] hides fast seek and speed controls during live playback even if the media element reports a finite, positive duration', async () => {
    const { video } = await renderReadyLivePlayer()
    setVideoDuration(video, 600)

    expect(screen.getByLabelText('シーク')).toBeDisabled()
    expect(screen.getByTestId('playback-time-display')).toHaveTextContent('--:--/--:--')
    expect(screen.queryByTestId('playback-speed-controls')).not.toBeInTheDocument()
    for (const name of ['30秒戻る', '10秒戻る', '10秒進む', '30秒進む']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('[AC 4.6a] ignores the ArrowLeft/ArrowRight seek shortcut during live playback even if the media element reports a finite, positive duration', async () => {
    const { player, video } = await renderReadyLivePlayer()
    setVideoDuration(video, 600)
    setVideoCurrentTime(video, 50)

    fireEvent.keyDown(player, { key: 'ArrowRight' })
    expect(video.currentTime).toBe(50)
    fireEvent.keyDown(player, { key: 'ArrowLeft' })
    expect(video.currentTime).toBe(50)
  })

  it('[AC 4.16] shows a screen-rotation button once fullscreen on a mobile platform with orientation lock support', async () => {
    restoreNavigator = defineNavigatorForTest({ userAgent: ANDROID_USER_AGENT, maxTouchPoints: 5 })
    const originalOrientation = Object.getOwnPropertyDescriptor(window.screen, 'orientation')
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: { type: 'portrait-primary', lock: vi.fn(async () => undefined) },
    })

    renderPlayback({ hash: RECORDED_DIRECT })
    const player = await findPlayer()
    readyVideo()
    await waitFor(() => {
      expect(player).toHaveAttribute('data-controls-visible', 'true')
    })

    expect(screen.queryByRole('button', { name: '画面回転' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'フルスクリーン' }))
    expect(player).toHaveAttribute('data-fullscreen-state', 'fullscreen')

    const rotateButton = await screen.findByRole('button', { name: '画面回転' })
    fireEvent.click(rotateButton)

    if (originalOrientation !== undefined) {
      Object.defineProperty(window.screen, 'orientation', originalOrientation)
    } else {
      Reflect.deleteProperty(window.screen, 'orientation')
    }
  })

  it('[AC 4.6] falls back to the inline fullscreen state when requestFullscreen is unavailable', async () => {
    const { player } = await renderReadyDirectPlayer()

    fireEvent.click(screen.getByRole('button', { name: 'フルスクリーン' }))

    expect(player).toHaveAttribute('data-fullscreen-state', 'fullscreen')
    expect(player).toHaveAttribute('data-fullscreen-fallback', 'true')
    expect(screen.getByRole('button', { name: 'フルスクリーン終了' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('[AC 4.6d] sizes the CSS fullscreen fallback from --app-viewport-height instead of a raw 100vh that can hold a stale iPadOS-standalone-PWA measurement', () => {
    // requirements.md 6d: raw `100vh` pushed bottomControls off-screen on iPad standalone PWAs.
    // --app-viewport-height is the app shell's own JS-measured, continuously-resynced viewport
    // height (useFixedShellViewport.ts); `100vh` stays only as the fallback for environments
    // where the variable is unset, so this must not regress into a plain `height: 100vh;`.
    const css = readFileSync('src/features/video/playback/PlaybackPage.module.css', 'utf8')
    const fallbackRule = css.match(
      /\.playerContainer\[data-fullscreen-fallback='true'\]\s*\{(?<rule>[^}]*)\}/,
    )

    expect(fallbackRule?.groups?.rule).toContain('height: var(--app-viewport-height, 100vh);')
  })
})
