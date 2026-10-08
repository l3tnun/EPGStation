import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { PlaybackPlayerContainer } from '@/features/video/playback'
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

  it('[AC frontend-video-playback 4.16] auto-hides controls while playing on desktop after idle mouse movement', async () => {
    const recordedRepository = createRecordedRepository()

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
    vi.useFakeTimers()
    const video = document.querySelector('video')
    if (video !== null) {
      Object.defineProperty(video, 'paused', { configurable: true, value: false })
      fireEvent.play(video)
    }
    fireEvent.mouseMove(player)
    expect(player).toHaveAttribute('data-controls-visible', 'true')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(player).toHaveAttribute('data-controls-visible', 'false')
    expect(player).toHaveAttribute('data-cursor-hidden', 'true')
  })

  it('[AC frontend-video-playback 4.16a] toggles controls by tapping the Android playback background without affecting controls', async () => {
    const recordedRepository = createRecordedRepository()
    const restoreNavigator = defineNavigatorPlatformForTest({
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.15 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    })
    const restorePointer = defineCoarsePointerForTest(true)

    try {
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
          viewportWidth={420}
          initialDrawerState="none"
        />,
      )

      const player = await screen.findByTestId('video-player-container')
      const video = document.querySelector('video')
      if (video !== null) {
        Object.defineProperty(video, 'paused', { configurable: true, value: false })
        fireEvent.play(video)
        fireEvent.loadedData(video)
      }
      await waitFor(() => {
        expect(player).toHaveAttribute('data-controls-visible', 'true')
      })

      fireEvent.pointerDown(player)
      expect(player).toHaveAttribute('data-controls-visible', 'false')
      fireEvent.mouseMove(player)
      expect(player).toHaveAttribute('data-controls-visible', 'false')
      fireEvent.pointerMove(player)
      expect(player).toHaveAttribute('data-controls-visible', 'false')
      fireEvent.pointerDown(player)
      expect(player).toHaveAttribute('data-controls-visible', 'true')
      fireEvent.mouseLeave(player)
      expect(player).toHaveAttribute('data-controls-visible', 'true')
      fireEvent.pointerDown(screen.getByRole('button', { name: '一時停止' }))
      expect(player).toHaveAttribute('data-controls-visible', 'true')
    } finally {
      restorePointer()
      restoreNavigator()
    }
  })

  it('[AC frontend-video-playback 4.16] clears pending auto-hide when playback pauses', async () => {
    const recordedRepository = createRecordedRepository()

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
    vi.useFakeTimers()
    const video = document.querySelector('video')
    if (video !== null) {
      Object.defineProperty(video, 'paused', { configurable: true, value: false })
      fireEvent.play(video)
      fireEvent.mouseMove(player)
      Object.defineProperty(video, 'paused', { configurable: true, value: true })
      fireEvent.pause(video)
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(player).toHaveAttribute('data-controls-visible', 'true')
    expect(player).toHaveAttribute('data-cursor-hidden', 'false')
  })

  it('[AC frontend-video-playback 4.18] renders playback when localStorage access throws during player setting restore', async () => {
    const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    try {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('blocked', 'SecurityError')
        },
      })

      render(<PlaybackPlayerContainer kind="recorded-direct" sourceKind="direct-video" />)

      expect(await screen.findByTestId('video-player-container')).toBeVisible()
    } finally {
      if (localStorageDescriptor !== undefined) {
        Object.defineProperty(window, 'localStorage', localStorageDescriptor)
      }
    }
  })

  it('[AC frontend-video-playback 4.8a] keeps the legacy HLS loading spinner textless for Vue parity', () => {
    render(
      <PlaybackPlayerContainer
        kind="live"
        sourceKind="hls-stream"
        streamingType="hls"
        streamStartUrl="./api/streams/live/301/hls?mode=0"
        readinessUrl="./api/streams?isHalfWidth=false"
      />,
    )

    expect(screen.getByTestId('playback-loading-indicator')).toBeEmptyDOMElement()
    expect(screen.getByTestId('playback-legacy-loading-spinner')).toBeVisible()
  })

  it('[AC frontend-video-playback 3.13] emits synthetic timeupdate ticks and grows duration while recorded streaming info is still recording', async () => {
    const recordedRepository = createRecordedRepository()
    // isInProgressRecording (and the synthetic-timeupdate setInterval it arms) is derived from
    // this fetch's resolved value, not from the loadedData event fired below. Resolving it
    // through an ordinary async mock races the fake timers enabled further down: React Query
    // settles it via a real Promise turn that is not tied to the fake clock, so whether the
    // interval is armed before or after `vi.useFakeTimers()` runs depends on how many real
    // microtask/task turns the host needs -- not on this test's own logic. Holding the resolve
    // callback lets the test resolve it only once fake timers are already active, so the
    // interval is deterministically armed inside the fake-timer world before it is advanced.
    type RecordedDetailResult = Awaited<ReturnType<typeof recordedRepository.fetchRecordedDetail>>
    let resolveRecordedDetail: ((value: RecordedDetailResult) => void) | undefined
    recordedRepository.fetchRecordedDetail = vi.fn(
      () =>
        new Promise<RecordedDetailResult>((resolve) => {
          resolveRecordedDetail = resolve
        }),
    )

    window.history.replaceState(
      null,
      '',
      '/#/recorded/streaming/701?streamingType=mp4&mode=0&fileType=encoded&recordedId=301',
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
    vi.useFakeTimers()
    // Resolve the recording-info fetch now that fake timers are active, and flush the resulting
    // state update (isInProgressRecording -> true, arming the synthetic-timeupdate interval)
    // with a zero-length fake-timer advance before starting the timed part of the test. This
    // makes the ordering deterministic instead of racing a real Promise turn against the fake
    // clock.
    resolveRecordedDetail?.({
      ok: true,
      value: {
        id: 301,
        name: 'Synthetic recording target',
        isRecording: true,
      },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('recorded-watch-info-card')).toBeVisible()
    if (video !== null) {
      fireEvent.loadedData(video)
    }
    // usePlaybackMediaElement dispatches a synthetic timeupdate every 1000ms while an
    // in-progress recording streams, via a plain setInterval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(player).toHaveAttribute('data-playback-synthetic-timeupdates', '1')
    expect(screen.getByTestId('playback-time-display')).toHaveAccessibleName('00:00/10:01')
    vi.useRealTimers()
  })
})
