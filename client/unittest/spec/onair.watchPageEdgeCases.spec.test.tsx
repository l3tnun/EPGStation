import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, createSchedule, createOnAirRepository, renderOnAir } from './support/onairSpecHarness'

describe('WatchOnAirPage route resolution edge cases', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.15] [AC 3.11] renders a blank body with no player and no error while the route is pending (no query at all)', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)])

    renderOnAir({ repository, initialHash: '/#/onair/watch' })

    expect(await screen.findByTestId('title-bar')).toHaveTextContent('視聴')
    expect(screen.queryByTestId('video-player-container')).not.toBeInTheDocument()
    expect(screen.queryByTestId('playback-controlled-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('onair-watch-info-card')).not.toBeInTheDocument()
    expect(repository.fetchLiveStreams).not.toHaveBeenCalled()
  })

  it('[AC frontend-video-playback 1.1] shows a controlled error and no player when the route query is invalid', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 10, 30)])

    renderOnAir({
      repository,
      initialHash: '/#/onair/watch?type=not-a-real-type&channel=10&mode=0',
    })

    expect(await screen.findByTestId('playback-controlled-error')).toHaveTextContent(
      '再生条件が不正です',
    )
    expect(screen.queryByTestId('video-player-container')).not.toBeInTheDocument()
  })
})
