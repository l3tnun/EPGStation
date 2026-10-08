import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { ScrollHistoryProvider, createScrollHistory } from '@/app/scrollHistory'
import { RecordedStreamingWatchPage } from '@/features/video/playback/RecordedWatchPages'
import type { LiveStreamConfig } from '@/app/serverApi'
import { createRecordedRepository } from './recorded/recordedSpecRepository'
import { stubMediaPlayback } from './support/videoPlaybackSpecSupport'

const streamConfig: LiveStreamConfig = {
  live: { ts: { m2ts: [], m2tsll: [], webm: [], mp4: [], hls: [] } },
  recorded: {
    ts: { webm: ['ts-webm'], hls: ['ts-hls'] },
    encoded: { webm: ['encoded-webm'], mp4: ['encoded-mp4'], hls: ['encoded-hls'] },
  },
}

function Harness({
  isConfigLoaded,
  apiRepository,
}: {
  isConfigLoaded: boolean
  apiRepository: ReturnType<typeof createRecordedRepository>
}) {
  return (
    <MemoryRouter initialEntries={['/recorded/streaming/701?streamingType=hls&mode=0&fileType=ts']}>
      <Routes>
        <Route
          path="/recorded/streaming/:videoFileId"
          element={
            <RecordedStreamingWatchPage
              isNavigationOpen={false}
              onNavigationClick={() => undefined}
              title="test"
              isHalfWidthDisplayed={false}
              isForceEnableSubtitleStroke={false}
              apiRepository={apiRepository}
              onSnackbar={vi.fn()}
              streamConfig={streamConfig}
              isConfigLoaded={isConfigLoaded}
            />
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

describe('RecordedStreamingWatchPage duration query race', () => {
  it('[AC 1.5] discards a stale duration-query fetch triggered for a route that has since become not-ok', async () => {
    stubMediaPlayback()
    const client = new QueryClient()
    const apiRepository = createRecordedRepository()
    const fetchVideoDuration = apiRepository.fetchVideoDuration as Mock

    const { rerender } = render(
      <QueryClientProvider client={client}>
        <ScrollHistoryProvider scrollHistory={createScrollHistory({ shouldRestoreHistory: false })}>
          <Harness isConfigLoaded apiRepository={apiRepository} />
        </ScrollHistoryProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(fetchVideoDuration).toHaveBeenCalledWith(701)
    })

    // The server config becomes unavailable again (e.g. a config refetch briefly
    // clears it): the route resolves to the pending-config state, and the duration
    // query observed at THIS render now has a null videoFileId key with `enabled`
    // false -- its own queryFn closure captures `route.ok === false`.
    rerender(
      <QueryClientProvider client={client}>
        <ScrollHistoryProvider scrollHistory={createScrollHistory({ shouldRestoreHistory: false })}>
          <Harness isConfigLoaded={false} apiRepository={apiRepository} />
        </ScrollHistoryProvider>
      </QueryClientProvider>,
    )

    fetchVideoDuration.mockClear()

    // Force that now-disabled query to run its queryFn anyway (bypassing `enabled`,
    // the same way an explicit refetch or a query invalidation from elsewhere would)
    // -- it must return null without calling fetchVideoDuration again.
    const nullKeyQuery = client
      .getQueryCache()
      .find({ queryKey: ['video-playback', 'recorded-streaming-duration', null] })
    expect(nullKeyQuery).toBeDefined()

    await act(async () => {
      await nullKeyQuery?.fetch()
    })

    expect(fetchVideoDuration).not.toHaveBeenCalled()
  })
})
