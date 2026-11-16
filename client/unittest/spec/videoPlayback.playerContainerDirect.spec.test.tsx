import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackPlayerContainer } from '@/features/video/playback/PlaybackShell'
import { stubMediaPlayback } from './support/videoPlaybackSpecSupport'

describe('PlaybackPlayerContainer standalone contract', () => {
  beforeEach(() => {
    stubMediaPlayback()
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('[AC 4.2] renders without a mounted subtitle renderer when no sourceKind is supplied', () => {
    render(<PlaybackPlayerContainer kind="live" mediaUrl="./api/videos/1" />)

    const player = screen.getByTestId('video-player-container')
    expect(player).toHaveAttribute('data-subtitle-renderer-mounted', 'false')
  })

  function renderSeekableRecording() {
    const view = render(
      <PlaybackPlayerContainer
        kind="recorded-direct"
        sourceKind="direct-video"
        mediaUrl="./api/videos/1"
      />,
    )
    const player = screen.getByTestId('video-player-container')
    const video = player.querySelector('video')!
    Object.defineProperties(video, {
      readyState: { value: HTMLMediaElement.HAVE_CURRENT_DATA },
      videoWidth: { value: 1920 },
      videoHeight: { value: 1080 },
      duration: { value: 120 },
    })
    fireEvent.loadedData(video)
    fireEvent.durationChange(video)
    return { ...view, player, video, canvas: screen.getByTestId('playback-seek-frame') }
  }

  it('[AC 5.7] discards the seek image when a different recording reuses the player', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never)
    const { player, canvas, rerender } = renderSeekableRecording()
    fireEvent.keyDown(player, { key: 'ArrowRight' })
    expect(canvas).toHaveAttribute('data-visible', 'true')

    rerender(
      <PlaybackPlayerContainer
        kind="recorded-direct"
        sourceKind="direct-video"
        mediaUrl="./api/videos/2"
      />,
    )

    expect(canvas).toHaveAttribute('data-visible', 'false')
  })

  it('[AC 5.7] continues a direct seek when frame drawing throws', () => {
    const drawImage = vi.fn(() => {
      throw new Error('Synthetic draw failure')
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never)
    const { player, video, canvas } = renderSeekableRecording()

    fireEvent.keyDown(player, { key: 'ArrowRight' })

    expect(drawImage).toHaveBeenCalledOnce()
    expect(video.currentTime).toBe(10)
    expect(canvas).toHaveAttribute('data-visible', 'false')
  })
})
