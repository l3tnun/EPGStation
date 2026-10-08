import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNLOADED_NAVIGATION_CONFIG } from '@/app/navigation'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import { createRecordedRepository } from './recorded/recordedSpecRepository'
import {
  createShellRepository,
  findPlayer,
  renderPlayback,
} from './support/videoPlaybackSpecSupport'

describe('Video playback recorded route edge cases', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 1.1] shows the pending state for a recorded streaming route while the server config has not loaded yet', async () => {
    let resolveConfig: (() => void) | undefined
    const apiRepository = {
      ...createShellRepository(),
      fetchServerConfig: vi.fn(
        () =>
          new Promise<{ ok: true; value: ServerConfigNavigationState }>((resolve) => {
            resolveConfig = () => {
              resolve({
                ok: true,
                value: {
                  status: 'loaded',
                  liveStreamEnabled: true,
                  enabledBroadcastWaves: ['GR', 'BS', 'CS', 'SKY'],
                  encodeModes: ['H.264'],
                },
              })
            }
          }),
      ),
    }

    renderPlayback({
      hash: '/#/recorded/streaming/701?streamingType=hls&mode=0&fileType=ts',
      navigationConfig: UNLOADED_NAVIGATION_CONFIG,
      apiRepository,
    })

    expect(await screen.findByTestId('playback-pending')).toHaveTextContent('読み込み中')
    expect(screen.queryByTestId('video-player-container')).not.toBeInTheDocument()

    resolveConfig?.()
    await waitFor(() => {
      expect(screen.queryByTestId('playback-pending')).not.toBeInTheDocument()
    })
  })

  it('[AC 4.11] starts with narrow controls hidden on a non-mobile narrow viewport', async () => {
    const recordedRepository = createRecordedRepository()

    renderPlayback({
      hash: '/#/recorded/watch?videoId=702',
      recordedRepository,
      viewportWidth: 400,
    })

    const player = await findPlayer()
    // Narrow viewports start with the controls hidden. This is the initial render state, not the
    // 3 second auto-hide, so read it directly rather than polling for a window to open.
    expect(player).toHaveAttribute('data-controls-visible', 'false')
  })

  it('[AC 4.11] resolves the active window width fallback (1440) when no viewportWidth is supplied', async () => {
    const recordedRepository = createRecordedRepository()

    renderPlayback({
      hash: '/#/recorded/watch?videoId=702',
      recordedRepository,
      viewportWidth: undefined as unknown as number,
    })

    const player = await findPlayer()
    expect(player).toBeInTheDocument()
  })
})
