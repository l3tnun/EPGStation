import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlaybackPlayerContainer } from '@/features/video/playback/PlaybackShell'
import { stubMediaPlayback } from './support/videoPlaybackSpecSupport'

describe('PlaybackPlayerContainer standalone contract', () => {
  beforeEach(() => {
    stubMediaPlayback()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('[AC 4.2] renders without a mounted subtitle renderer when no sourceKind is supplied', () => {
    render(<PlaybackPlayerContainer kind="live" mediaUrl="./api/videos/1" />)

    const player = screen.getByTestId('video-player-container')
    expect(player).toHaveAttribute('data-subtitle-renderer-mounted', 'false')
  })
})
