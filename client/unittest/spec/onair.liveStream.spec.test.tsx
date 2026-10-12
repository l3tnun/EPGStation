import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectHashRoute } from './hashRouteAssertions'
import {
  NOW,
  createSchedule,
  createOnAirRepository,
  chooseMuiSelectOption,
  renderOnAir,
} from './support/onairSpecHarness'

describe('On Air card and ProgramDialog actions', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.8] blocks unsupported M2TS-LL playback before navigating', async () => {
    const mediaSourceDescriptor = Object.getOwnPropertyDescriptor(window, 'MediaSource')
    Object.defineProperty(window, 'MediaSource', {
      configurable: true,
      value: {
        isTypeSupported: vi.fn(() => false),
      },
    })
    renderOnAir()

    fireEvent.click(await screen.findByTestId('onair-card-body-10'))
    fireEvent.click(await screen.findByRole('button', { name: '視聴' }))

    // The unsupported-playback snackbar closes on a 5 second wall-clock timer. Read it under
    // fake timers instead of polling, so the assertion never races the host.
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('再生に対応していません')
    vi.useRealTimers()
    expectHashRoute('#/onair?type=BS')

    if (mediaSourceDescriptor !== undefined) {
      Object.defineProperty(window, 'MediaSource', mediaSourceDescriptor)
    }
  })

  it('[AC 3.7] [AC 3.11] navigates supported web stream selections to /onair/watch and renders the live info card', async () => {
    Object.defineProperty(window, 'MediaSource', {
      configurable: true,
      value: {
        isTypeSupported: vi.fn(() => true),
      },
    })
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)], {}, [
      {
        channelId: 10,
        channelName: 'Synthetic Live Channel',
        mode: 0,
        type: 'backend-webm',
        name: 'Synthetic Live Stream',
        description: 'Synthetic live description',
        startAt: NOW - 30 * 60 * 1000,
        endAt: NOW + 30 * 60 * 1000,
      },
    ])
    renderOnAir({ repository })

    fireEvent.click(await screen.findByTestId('onair-card-body-10'))
    await chooseMuiSelectOption('配信方式', 'WebM')
    fireEvent.click(screen.getByRole('button', { name: '視聴' }))

    await waitFor(() => {
      expectHashRoute('#/onair/watch?type=webm&channel=10&mode=0')
    })
    expect(screen.getByTestId('title-bar')).toHaveTextContent('視聴')
    expect(await screen.findByTestId('onair-watch-info-card')).toHaveTextContent(
      'Synthetic Live Channel',
    )
    expect(await screen.findByTestId('onair-watch-info-card')).toHaveTextContent(
      'Synthetic Live Stream',
    )
    expect(screen.getByTestId('onair-watch-info-card')).toHaveTextContent(
      'Synthetic live description',
    )
    expect(repository.fetchLiveStreams).toHaveBeenCalledWith({ isHalfWidth: true })
  })

  it('[AC 3.19] [AC 3.11] opens M2TS live watch routes as direct stream playback', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)], {}, [
      {
        channelId: 10,
        channelName: 'Synthetic Live Channel',
        mode: 0,
        name: 'Synthetic Live Stream',
        startAt: NOW - 30 * 60 * 1000,
        endAt: NOW + 30 * 60 * 1000,
      },
    ])

    renderOnAir({
      repository,
      initialHash: '/#/onair/watch?type=m2ts&channel=10&mode=0',
    })

    expect(screen.getByTestId('title-bar')).toHaveTextContent('視聴')
    expect(await screen.findByTestId('video-player-container')).toHaveAttribute(
      'data-playback-media-url',
      './api/streams/live/10/m2ts?mode=0',
    )
    expect(await screen.findByTestId('onair-watch-info-card')).toHaveTextContent(
      'Synthetic Live Channel',
    )
    expect(repository.fetchLiveStreams).toHaveBeenCalledWith({ isHalfWidth: true })
  })

  it('[AC 3.18] clears live direct loading once the media element reports playback', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)], {}, [
      {
        channelId: 10,
        channelName: 'Synthetic Live Channel',
        mode: 0,
        name: 'Synthetic Live Stream',
        startAt: NOW - 30 * 60 * 1000,
        endAt: NOW + 30 * 60 * 1000,
      },
    ])

    renderOnAir({
      repository,
      initialHash: '/#/onair/watch?type=webm&channel=10&mode=0',
    })

    await screen.findByTestId('video-player-container')
    expect(screen.getByTestId('playback-loading-indicator')).toBeVisible()
    const video = document.querySelector('video')
    expect(video).not.toBeNull()
    if (video !== null) {
      fireEvent.play(video)
    }

    await waitFor(() => {
      expect(screen.queryByTestId('playback-loading-indicator')).not.toBeInTheDocument()
    })
  })

  it('[AC 3.18] passes an absolute URL to live M2TS-LL playback like the legacy mpegts player', async () => {
    const mediaSourceDescriptor = Object.getOwnPropertyDescriptor(window, 'MediaSource')
    class SyntheticMediaSource {
      static isTypeSupported = vi.fn(() => true)

      addEventListener = vi.fn()
      removeEventListener = vi.fn()
      addSourceBuffer = vi.fn()
    }
    Object.defineProperty(window, 'MediaSource', {
      configurable: true,
      value: SyntheticMediaSource,
    })
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic')
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)], {}, [
      {
        channelId: 10,
        channelName: 'Synthetic Live Channel',
        mode: 0,
        name: 'Synthetic Live Stream',
        startAt: NOW - 30 * 60 * 1000,
        endAt: NOW + 30 * 60 * 1000,
      },
    ])

    renderOnAir({
      repository,
      initialHash: '/#/onair/watch?type=m2tsll&channel=10&mode=0',
    })

    try {
      const player = await screen.findByTestId('video-player-container')
      await waitFor(() => {
        expect(player).toHaveAttribute(
          'data-playback-media-url',
          `${window.location.origin}/api/streams/live/10/m2tsll?mode=0`,
        )
      })
    } finally {
      createObjectUrlSpy.mockRestore()
      if (mediaSourceDescriptor !== undefined) {
        Object.defineProperty(window, 'MediaSource', mediaSourceDescriptor)
      }
    }
  })

  it('[AC frontend-video-playback 3.14] resolves the live M2TS-LL absolute URL under the document sub directory', async () => {
    const mediaSourceDescriptor = Object.getOwnPropertyDescriptor(window, 'MediaSource')
    class SyntheticMediaSource {
      static isTypeSupported = vi.fn(() => true)

      addEventListener = vi.fn()
      removeEventListener = vi.fn()
      addSourceBuffer = vi.fn()
    }
    Object.defineProperty(window, 'MediaSource', {
      configurable: true,
      value: SyntheticMediaSource,
    })
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic')
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)], {}, [
      {
        channelId: 10,
        channelName: 'Synthetic Live Channel',
        mode: 0,
        name: 'Synthetic Live Stream',
        startAt: NOW - 30 * 60 * 1000,
        endAt: NOW + 30 * 60 * 1000,
      },
    ])

    renderOnAir({
      repository,
      initialHash: '/sub/#/onair/watch?type=m2tsll&channel=10&mode=0',
    })

    try {
      const player = await screen.findByTestId('video-player-container')
      await waitFor(() => {
        expect(player).toHaveAttribute(
          'data-playback-media-url',
          `${window.location.origin}/sub/api/streams/live/10/m2tsll?mode=0`,
        )
      })
    } finally {
      window.history.replaceState(null, '', '/')
      createObjectUrlSpy.mockRestore()
      if (mediaSourceDescriptor !== undefined) {
        Object.defineProperty(window, 'MediaSource', mediaSourceDescriptor)
      }
    }
  })

  it('[AC 3.18] keeps live M2TS-LL loading-only after play until media data is available', async () => {
    const mediaSourceDescriptor = Object.getOwnPropertyDescriptor(window, 'MediaSource')
    class SyntheticMediaSource {
      static isTypeSupported = vi.fn(() => true)

      addEventListener = vi.fn()
      removeEventListener = vi.fn()
      addSourceBuffer = vi.fn()
    }
    Object.defineProperty(window, 'MediaSource', {
      configurable: true,
      value: SyntheticMediaSource,
    })
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic')
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)], {}, [
      {
        channelId: 10,
        channelName: 'Synthetic Live Channel',
        mode: 0,
        name: 'Synthetic Live Stream',
        startAt: NOW - 30 * 60 * 1000,
        endAt: NOW + 30 * 60 * 1000,
      },
    ])

    renderOnAir({
      repository,
      initialHash: '/#/onair/watch?type=m2tsll&channel=10&mode=0',
    })

    try {
      const player = await screen.findByTestId('video-player-container')
      await waitFor(() => {
        expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
      })
      const video = document.querySelector('video')
      expect(video).not.toBeNull()
      if (video !== null) {
        fireEvent.play(video)
      }

      expect(screen.getByTestId('playback-loading-indicator')).toBeVisible()
      expect(screen.queryByTestId('playback-bottom-controls')).not.toBeInTheDocument()
      expect(screen.queryByTestId('playback-center-controls')).not.toBeInTheDocument()

      if (video !== null) {
        fireEvent.loadedData(video)
      }

      await waitFor(() => {
        expect(screen.queryByTestId('playback-loading-indicator')).not.toBeInTheDocument()
      })
    } finally {
      createObjectUrlSpy.mockRestore()
      if (mediaSourceDescriptor !== undefined) {
        Object.defineProperty(window, 'MediaSource', mediaSourceDescriptor)
      }
    }
  })
})
