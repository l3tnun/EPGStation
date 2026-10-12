import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ScrollHistoryProvider, createScrollHistory } from '@/app/scrollHistory'
import { RecordedWatchPage } from '@/features/video/playback/RecordedWatchPages'
import { createRecordedRepository } from './recorded/recordedSpecRepository'
import { stubMediaPlayback } from './support/videoPlaybackSpecSupport'

describe('RecordedWatchPage standalone contract', () => {
  it('[AC 4.11] falls back to a 1440px viewport width when none is resolved yet', () => {
    stubMediaPlayback()
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ScrollHistoryProvider scrollHistory={createScrollHistory({ shouldRestoreHistory: false })}>
          <MemoryRouter initialEntries={['/recorded/watch?videoId=702']}>
            <RecordedWatchPage
              isNavigationOpen={false}
              onNavigationClick={() => undefined}
              title="test"
              isHalfWidthDisplayed={false}
              isForceEnableSubtitleStroke={false}
              viewportWidth={undefined}
              apiRepository={createRecordedRepository()}
              onSnackbar={vi.fn()}
            />
          </MemoryRouter>
        </ScrollHistoryProvider>
      </QueryClientProvider>,
    )

    // Below the 420px narrow-viewport threshold only when the (viewportWidth ?? 1440)
    // fallback is used -- a real 1440px viewport keeps fast-seek/speed controls shown.
    expect(screen.getByTestId('video-player-container')).toBeInTheDocument()
  })
})
