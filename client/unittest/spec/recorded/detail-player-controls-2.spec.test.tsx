import { fireEvent, render, screen } from '@testing-library/react'
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

  it('[AC frontend-video-playback 4.6] handles keyboard seek/play shortcuts and fullscreen fallback without snackbar', async () => {
    const recordedRepository = createRecordedRepository()
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const orientationLock = vi.fn(async () => undefined)
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: { lock: orientationLock, type: 'portrait-primary' },
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

    const player = await screen.findByTestId('video-player-container')
    const video = document.querySelector('video')
    expect(video).not.toBeNull()
    if (video !== null) {
      Object.defineProperty(video, 'duration', { configurable: true, value: 100 })
      video.currentTime = 50
      fireEvent.durationChange(video)
      fireEvent.timeUpdate(video)
    }

    fireEvent.keyDown(player, { key: 'ArrowRight' })
    expect(video?.currentTime).toBe(60)

    fireEvent.keyDown(player, { key: 'ArrowLeft' })
    expect(video?.currentTime).toBe(50)

    const seekSlider = screen.getByLabelText('シーク')
    fireEvent.focus(seekSlider)
    fireEvent.keyDown(seekSlider, { key: 'ArrowRight' })
    expect(video?.currentTime).toBe(50)

    fireEvent.keyDown(player, { key: ' ' })
    expect(playSpy).toHaveBeenCalled()

    fireEvent.keyDown(player, { key: 'f' })
    expect(player).toHaveAttribute('data-fullscreen-fallback', 'true')
    expect(player).toHaveAttribute('data-fullscreen-state', 'fullscreen')
    expect(orientationLock).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
