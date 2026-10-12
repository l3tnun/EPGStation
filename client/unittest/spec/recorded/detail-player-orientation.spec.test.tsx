import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
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

  it('[AC frontend-video-playback 4.19] locks landscape after native fullscreen succeeds and keeps rotation outside bottom controls', async () => {
    const recordedRepository = createRecordedRepository()
    const restoreNavigator = defineNavigatorPlatformForTest({
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.15 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    })
    const restorePointer = defineCoarsePointerForTest(true)
    const orientationLock = vi.fn(async () => undefined)
    const requestFullscreen = vi.fn(async () => undefined)
    const fullscreenDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
    const orientationDescriptor = Object.getOwnPropertyDescriptor(window.screen, 'orientation')
    const requestFullscreenDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'requestFullscreen',
    )
    let fullscreenElement: Element | null = null

    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: { lock: orientationLock, type: 'portrait-primary' },
    })
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })

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
      // The bottom controls (including the フルスクリーン button) auto-hide on a 3 second
      // wall-clock timer once playback starts. Drive the play -> click sequence under fake
      // timers so the click never races the host's real clock.
      vi.useFakeTimers()
      const video = document.querySelector('video')
      if (video !== null) {
        Object.defineProperty(video, 'paused', { configurable: true, value: false })
        fireEvent.play(video)
        fireEvent.loadedData(video)
      }

      fireEvent.click(screen.getByRole('button', { name: 'フルスクリーン' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' })
      expect(orientationLock).toHaveBeenCalledWith('landscape')

      fullscreenElement = player
      await act(async () => {
        document.dispatchEvent(new Event('fullscreenchange'))
      })

      expect(player).toHaveAttribute('data-fullscreen-state', 'fullscreen')
      expect(screen.getByRole('button', { name: '画面回転' })).toBeVisible()
      expect(
        within(screen.getByTestId('playback-bottom-controls')).queryByRole('button', {
          name: '画面回転',
        }),
      ).not.toBeInTheDocument()
    } finally {
      if (fullscreenDescriptor !== undefined) {
        Object.defineProperty(document, 'fullscreenElement', fullscreenDescriptor)
      } else {
        Reflect.deleteProperty(document, 'fullscreenElement')
      }
      if (requestFullscreenDescriptor !== undefined) {
        Object.defineProperty(
          HTMLElement.prototype,
          'requestFullscreen',
          requestFullscreenDescriptor,
        )
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen')
      }
      if (orientationDescriptor !== undefined) {
        Object.defineProperty(window.screen, 'orientation', orientationDescriptor)
      } else {
        Reflect.deleteProperty(window.screen, 'orientation')
      }
      restorePointer()
      restoreNavigator()
    }
  })

  it('[AC frontend-video-playback 4.19] does not show mobile rotation button when orientation lock is unavailable', async () => {
    const recordedRepository = createRecordedRepository()
    const restoreNavigator = defineNavigatorPlatformForTest({
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.15 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    })
    const restorePointer = defineCoarsePointerForTest(true)
    const requestFullscreen = vi.fn(async () => undefined)
    const fullscreenDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
    const orientationDescriptor = Object.getOwnPropertyDescriptor(window.screen, 'orientation')
    const requestFullscreenDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'requestFullscreen',
    )
    let fullscreenElement: Element | null = null

    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: { type: 'portrait-primary' },
    })
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })

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
      // The bottom controls (including the フルスクリーン button) auto-hide on a 3 second
      // wall-clock timer once playback starts. Drive the play -> click sequence under fake
      // timers so the click never races the host's real clock.
      vi.useFakeTimers()
      const video = document.querySelector('video')
      if (video !== null) {
        Object.defineProperty(video, 'paused', { configurable: true, value: false })
        fireEvent.play(video)
        fireEvent.loadedData(video)
      }

      fireEvent.click(screen.getByRole('button', { name: 'フルスクリーン' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' })

      fullscreenElement = player
      await act(async () => {
        document.dispatchEvent(new Event('fullscreenchange'))
      })

      expect(player).toHaveAttribute('data-fullscreen-state', 'fullscreen')
      expect(screen.queryByRole('button', { name: '画面回転' })).not.toBeInTheDocument()
    } finally {
      if (fullscreenDescriptor !== undefined) {
        Object.defineProperty(document, 'fullscreenElement', fullscreenDescriptor)
      } else {
        Reflect.deleteProperty(document, 'fullscreenElement')
      }
      if (requestFullscreenDescriptor !== undefined) {
        Object.defineProperty(
          HTMLElement.prototype,
          'requestFullscreen',
          requestFullscreenDescriptor,
        )
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen')
      }
      if (orientationDescriptor !== undefined) {
        Object.defineProperty(window.screen, 'orientation', orientationDescriptor)
      } else {
        Reflect.deleteProperty(window.screen, 'orientation')
      }
      restorePointer()
      restoreNavigator()
    }
  })
})
