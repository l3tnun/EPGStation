import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecordedRepository } from './recorded/recordedSpecRepository'
import {
  createOnAirRepository,
  findPlayer,
  navigateHashRoute,
  renderPlayback,
} from './support/videoPlaybackSpecSupport'

describe('Video playback requirement 1: route validation and controlled player state', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 1.1] shows a controlled error and no player when the live watch query is incomplete', async () => {
    const onAirRepository = createOnAirRepository()

    renderPlayback({ hash: '/#/onair/watch?type=hls&channel=10', onAirRepository })

    expect(screen.getByTestId('title-bar')).toHaveTextContent('視聴')
    expect(await screen.findByTestId('playback-controlled-error')).toHaveTextContent(
      '再生条件が不正です',
    )
    expect(screen.queryByTestId('video-player-container')).not.toBeInTheDocument()
    expect(document.querySelector('video')).toBeNull()
  })

  it('[AC 1.1] rejects a live watch type outside hls / m2tsll / webm / mp4 with the controlled state', async () => {
    renderPlayback({ hash: '/#/onair/watch?type=flv&channel=10&mode=0' })

    expect(await screen.findByTestId('playback-controlled-error')).toHaveTextContent(
      '再生条件が不正です',
    )
    expect(screen.queryByTestId('video-player-container')).not.toBeInTheDocument()
  })

  it('[AC 1.2] does not create a raw video player when recorded watch videoId is missing', async () => {
    const recordedRepository = createRecordedRepository()

    renderPlayback({ hash: '/#/recorded/watch?recordedId=301', recordedRepository })

    expect(await screen.findByTestId('playback-controlled-error')).toHaveTextContent(
      '再生対象が不正です',
    )
    expect(screen.queryByTestId('video-player-container')).not.toBeInTheDocument()
    expect(document.querySelector('video')).toBeNull()
    expect(recordedRepository.fetchRecordedDetail).not.toHaveBeenCalled()
  })

  it('[AC 1.2] does not create a raw video player when recorded watch videoId is not a finite integer', async () => {
    renderPlayback({ hash: '/#/recorded/watch?videoId=abc' })

    expect(await screen.findByTestId('playback-controlled-error')).toHaveTextContent(
      '再生対象が不正です',
    )
    expect(document.querySelector('video')).toBeNull()
  })

  it('[AC 1.3] keeps the recorded direct player and suppresses the info card for an invalid recordedId', async () => {
    const recordedRepository = createRecordedRepository()

    renderPlayback({ hash: '/#/recorded/watch?videoId=701&recordedId=bad', recordedRepository })

    expect(await findPlayer()).toHaveAttribute('data-playback-kind', 'recorded-direct')
    expect(screen.queryByTestId('recorded-watch-info-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('playback-controlled-error')).not.toBeInTheDocument()
    expect(recordedRepository.fetchRecordedDetail).not.toHaveBeenCalled()
  })

  it.each([
    ['videoFileId', '/#/recorded/streaming/abc?streamingType=hls&mode=0&fileType=ts'],
    ['mode', '/#/recorded/streaming/701?streamingType=hls&mode=x&fileType=ts'],
    ['streamingType', '/#/recorded/streaming/701?streamingType=m2ts&mode=0&fileType=ts'],
    ['fileType', '/#/recorded/streaming/701?streamingType=hls&mode=0&fileType=other'],
  ])(
    '[AC 1.4] [AC 1.9] does not build an API URL or a player when recorded streaming %s is invalid',
    async (_field, hash) => {
      const recordedRepository = createRecordedRepository()
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))

      renderPlayback({ hash, recordedRepository })

      expect(await screen.findByTestId('playback-controlled-error')).toHaveTextContent(
        'ストリーム再生条件が不正です',
      )
      expect(screen.queryByTestId('video-player-container')).not.toBeInTheDocument()
      expect(screen.queryByTestId('recorded-watch-info-card')).not.toBeInTheDocument()
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(recordedRepository.fetchRecordedDetail).not.toHaveBeenCalled()
      expect(recordedRepository.fetchVideoDuration).not.toHaveBeenCalled()
    },
  )

  it('[AC 1.5] drops the stale player when the route changes from valid to invalid', async () => {
    renderPlayback({ hash: '/#/recorded/watch?videoId=701' })

    expect(await findPlayer()).toHaveAttribute('data-playback-media-url', './api/videos/701')

    await navigateHashRoute('/#/recorded/watch?videoId=nope')

    expect(await screen.findByTestId('playback-controlled-error')).toHaveTextContent(
      '再生対象が不正です',
    )
    expect(screen.queryByTestId('video-player-container')).not.toBeInTheDocument()
    expect(document.querySelector('video')).toBeNull()
  })

  it('[AC 1.5] rebuilds the player for the new target instead of reusing the previous media URL', async () => {
    renderPlayback({ hash: '/#/recorded/watch?videoId=701' })

    expect(await findPlayer()).toHaveAttribute('data-playback-media-url', './api/videos/701')

    await navigateHashRoute('/#/recorded/watch?videoId=702')

    await waitFor(() => {
      expect(screen.getByTestId('video-player-container')).toHaveAttribute(
        'data-playback-media-url',
        './api/videos/702',
      )
    })
  })

  it('[AC 1.6] creates the live player for m2ts when the config lists an m2ts mode', async () => {
    renderPlayback({ hash: '/#/onair/watch?type=m2ts&channel=10&mode=0' })

    expect(await findPlayer()).toHaveAttribute('data-playback-kind', 'live')
    expect(screen.queryByTestId('playback-controlled-error')).not.toBeInTheDocument()
  })

  it('[AC 1.7] rejects a live watch channel that is not a finite integer', async () => {
    renderPlayback({ hash: '/#/onair/watch?type=webm&channel=abc&mode=0' })

    expect(await screen.findByTestId('playback-controlled-error')).toHaveTextContent(
      '再生条件が不正です',
    )
    expect(screen.queryByTestId('video-player-container')).not.toBeInTheDocument()
  })

  it('[AC 1.7] rejects a live watch mode outside the selectable live stream config', async () => {
    renderPlayback({ hash: '/#/onair/watch?type=webm&channel=10&mode=5' })

    expect(await screen.findByTestId('playback-controlled-error')).toHaveTextContent(
      '再生条件が不正です',
    )
    expect(screen.queryByTestId('video-player-container')).not.toBeInTheDocument()
  })

  it('[AC 1.7] creates the live player only for a channel and mode present in the config', async () => {
    renderPlayback({ hash: '/#/onair/watch?type=webm&channel=10&mode=0' })

    expect(await findPlayer()).toHaveAttribute('data-playback-kind', 'live')
    expect(screen.getByTestId('video-player-container')).toHaveAttribute(
      'data-playback-media-url',
      './api/streams/live/10/webm?mode=0',
    )
  })

  it('[AC 1.8] rejects a recorded streaming mode that the server config does not enable for the file type', async () => {
    renderPlayback({ hash: '/#/recorded/streaming/701?streamingType=mp4&mode=0&fileType=ts' })

    expect(await screen.findByTestId('playback-controlled-error')).toHaveTextContent(
      'ストリーム再生条件が不正です',
    )
    expect(screen.queryByTestId('video-player-container')).not.toBeInTheDocument()
  })

  it('[AC 1.10] keeps the streaming player and drops only the info card when recordedId is invalid', async () => {
    const recordedRepository = createRecordedRepository()

    renderPlayback({
      hash: '/#/recorded/streaming/701?streamingType=webm&mode=0&fileType=ts&recordedId=bad',
      recordedRepository,
    })

    expect(await findPlayer()).toHaveAttribute('data-playback-kind', 'recorded-streaming')
    expect(screen.queryByTestId('recorded-watch-info-card')).not.toBeInTheDocument()
    expect(recordedRepository.fetchRecordedDetail).not.toHaveBeenCalled()
  })

  it('[AC 1.10] keeps the streaming player without an info card when recordedId is omitted', async () => {
    const recordedRepository = createRecordedRepository()

    renderPlayback({
      hash: '/#/recorded/streaming/701?streamingType=webm&mode=0&fileType=ts',
      recordedRepository,
    })

    expect(await findPlayer()).toHaveAttribute('data-playback-source-kind', 'direct-stream')
    expect(screen.queryByTestId('recorded-watch-info-card')).not.toBeInTheDocument()
    expect(recordedRepository.fetchRecordedDetail).not.toHaveBeenCalled()
  })

  it('[AC 1.11] renders the controlled state inline without redirecting away from the route', async () => {
    renderPlayback({ hash: '/#/recorded/watch?recordedId=301' })

    await screen.findByTestId('playback-controlled-error')

    expect(window.location.hash.startsWith('#/recorded/watch?recordedId=301')).toBe(true)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('[AC 1.12] keeps URLs, stack traces and media elements out of the controlled state', async () => {
    renderPlayback({ hash: '/#/recorded/streaming/701?streamingType=hls&mode=x&fileType=ts' })

    const error = await screen.findByTestId('playback-controlled-error')

    expect(error.textContent).not.toMatch(/api|http|\/streams|at |Error/)
    expect(error.querySelector('video')).toBeNull()
    expect(document.querySelector('video')).toBeNull()
  })
})
