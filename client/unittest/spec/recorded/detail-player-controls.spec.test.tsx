import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createPlaybackNavigationConfig, createShellRepository } from './recordedSpecHelpers'
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

  it('[AC frontend-video-playback 5.1] autoplays playback pages with sound like the legacy video components', async () => {
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

    await screen.findByTestId('video-player-container')
    const video = document.querySelector('video')
    expect(video).not.toBeNull()
    expect(video).toHaveAttribute('autoplay')
    expect(video).not.toHaveAttribute('muted')
  })

  it.each(['mp4', 'webm'] as const)(
    '[AC frontend-video-playback 5.2] seeks recorded %s streams by absolute video time beyond the current encoded segment',
    async (streamingType) => {
      const recordedRepository = createRecordedRepository()
      const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)

      window.history.replaceState(
        null,
        '',
        `/#/recorded/streaming/701?streamingType=${streamingType}&mode=0&fileType=encoded&recordedId=bad`,
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
      expect(video).not.toBeNull()
      if (video !== null) {
        Object.defineProperty(video, 'duration', { configurable: true, value: 30 })
        fireEvent.play(video)
        fireEvent.durationChange(video)
      }

      await waitFor(() => {
        expect(screen.getByLabelText('シーク')).toHaveAttribute('max', '600')
      })
      const seekBar = screen.getByLabelText('シーク')
      fireEvent.pointerDown(seekBar)
      fireEvent.change(seekBar, { target: { value: '120' } })
      fireEvent.pointerUp(seekBar)

      expect(player).toHaveAttribute(
        'data-playback-media-url',
        `./api/streams/recorded/701/${streamingType}?mode=0&ss=120`,
      )
      await waitFor(() => {
        expect(playSpy).toHaveBeenCalled()
      })
      expect(recordedRepository.fetchVideoDuration).toHaveBeenCalledWith(701)
    },
  )

  it('[AC frontend-video-playback 4.14] shows duration-backed controls and clamps center seek actions', async () => {
    const recordedRepository = createRecordedRepository()
    Object.defineProperty(document, 'pictureInPictureEnabled', {
      configurable: true,
      value: false,
    })

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

    const video = document.querySelector('video')
    expect(video).not.toBeNull()
    if (video !== null) {
      Object.defineProperty(video, 'duration', { configurable: true, value: 120 })
      video.currentTime = 115
      fireEvent.loadedData(video)
      fireEvent.durationChange(video)
      fireEvent.timeUpdate(video)
    }

    expect(screen.getByLabelText('シーク')).toBeEnabled()
    expect(screen.getByTestId('playback-time-display')).toHaveTextContent('01:55/02:00')
    expect(screen.getByRole('button', { name: '30秒戻る' })).toBeVisible()
    expect(screen.getByRole('button', { name: '10秒戻る' })).toBeVisible()
    expect(screen.getByRole('button', { name: '10秒進む' })).toBeVisible()
    expect(screen.getByRole('button', { name: '30秒進む' })).toBeVisible()
    expect(screen.getByTestId('playback-speed-controls')).toHaveTextContent('X1.0')
    expect(
      screen.queryByRole('button', { name: 'ピクチャーインピクチャー' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '30秒進む' }))
    expect(video?.currentTime).toBe(120)

    fireEvent.click(screen.getByRole('button', { name: 'VOL+' }))
    const volumeSlider = screen.getByLabelText('音量')
    fireEvent.change(volumeSlider, { target: { value: '0.5' } })
    expect(video?.muted).toBe(false)
  })

  it('[AC frontend-video-playback 4.10] keeps the bottom play button visible for desktop duration-zero playback', async () => {
    const recordedRepository = {
      ...createRecordedRepository(),
      fetchVideoDuration: undefined,
    }

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

    const video = document.querySelector('video')
    if (video !== null) {
      fireEvent.loadedData(video)
    }
    const bottomControls = await screen.findByTestId('playback-bottom-controls')
    expect(screen.getByLabelText('シーク')).toBeDisabled()
    expect(screen.getByTestId('playback-time-display')).toHaveTextContent('--:--/--:--')
    expect(within(bottomControls).getByRole('button', { name: '再生' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '30秒戻る' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('playback-speed-controls')).not.toBeInTheDocument()
  })

  it('[AC frontend-video-playback 4.10] keeps live-style duration zero controls guarded and prunes narrow viewport controls', async () => {
    const recordedRepository = {
      ...createRecordedRepository(),
      fetchVideoDuration: undefined,
    }

    window.history.replaceState(
      null,
      '',
      '/#/recorded/streaming/701?streamingType=mp4&mode=0&fileType=encoded&recordedId=bad',
    )
    vi.useFakeTimers()
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const video = document.querySelector('video')
    if (video !== null) {
      fireEvent.loadedData(video)
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('video-player-container')).toHaveAttribute(
      'data-controls-visible',
      'true',
    )
    // The seek bar is always rendered, on every viewport width, matching the legacy v2
    // player (VideoContainer.vue:49-59), which never hides the seek bar based on screen
    // width and only disables it while the duration is unknown.
    expect(screen.getByLabelText('シーク')).toBeDisabled()
    expect(screen.getByTestId('playback-time-display')).toHaveTextContent('--:--/--:--')
    expect(screen.queryByRole('button', { name: '30秒戻る' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '再生', hidden: false })).toBeInTheDocument()
    expect(screen.queryByTestId('playback-speed-controls')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('音量')).not.toBeInTheDocument()
  })
})
