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

  it('[AC frontend-video-playback 5.3] rebuilds recorded direct stream URL on out-of-range seek without lifecycle API calls', async () => {
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

    const player = await screen.findByTestId('video-player-container')
    const video = document.querySelector('video')
    expect(video).not.toBeNull()
    Object.defineProperty(video, 'duration', { configurable: true, value: 30 })
    if (video !== null) {
      video.currentTime = 45
      fireEvent.seeking(video)
    }

    expect(player).toHaveAttribute(
      'data-playback-media-url',
      './api/streams/recorded/701/mp4?mode=0&ss=45',
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
