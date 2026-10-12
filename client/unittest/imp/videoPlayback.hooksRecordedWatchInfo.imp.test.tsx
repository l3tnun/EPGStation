import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRecordedWatchInfo } from '@/features/video/playback/hooks/useRecordedWatchInfo'
import type {
  PlaybackRouteResult,
  RecordedDirectWatchRoute,
} from '@/features/video/playback/playbackRoutes'

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('useRecordedWatchInfo contract', () => {
  it('[AC 1.x] falls back to recordedId 0 in an explicit refetch that races a route change to a non-info-card route', async () => {
    const client = new QueryClient()
    const onSnackbar = vi.fn()
    const fetchRecordedDetail = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { id: 5, name: 'test recording' } })
    const apiRepository = { fetchRecordedDetail } as never

    const infoCardRoute: PlaybackRouteResult<RecordedDirectWatchRoute> = {
      ok: true,
      value: {
        kind: 'recorded-direct',
        videoFileId: 1,
        recordedId: 5,
        shouldRenderInfoCard: true,
      },
    }
    const noInfoCardRoute: PlaybackRouteResult<RecordedDirectWatchRoute> = {
      ok: true,
      value: {
        kind: 'recorded-direct',
        videoFileId: 1,
        recordedId: null,
        shouldRenderInfoCard: false,
      },
    }

    const { result, rerender } = renderHook(
      (props: { route: PlaybackRouteResult<RecordedDirectWatchRoute> }) =>
        useRecordedWatchInfo({
          route: props.route,
          isHalfWidthDisplayed: false,
          apiRepository,
          onSnackbar,
        }),
      { wrapper: wrapper(client), initialProps: { route: infoCardRoute } },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchRecordedDetail).toHaveBeenCalledWith({ recordedId: 5, isHalfWidth: false })

    // The route no longer wants an info card: recordedId becomes null, disabling the
    // query. An explicit refetch() still runs the queryFn regardless of `enabled`, so
    // this exercises the `recordedId ?? 0` fallback used to satisfy the API's typing.
    rerender({ route: noInfoCardRoute })

    await act(async () => {
      await result.current.refetch()
    })

    expect(fetchRecordedDetail).toHaveBeenCalledWith({ recordedId: 0, isHalfWidth: false })
  })

  it('surfaces a snackbar and yields null when fetchRecordedDetail fails', async () => {
    const client = new QueryClient()
    const onSnackbar = vi.fn()
    const apiRepository = {
      fetchRecordedDetail: vi.fn().mockResolvedValue({ ok: false }),
    } as never

    const route: PlaybackRouteResult<RecordedDirectWatchRoute> = {
      ok: true,
      value: {
        kind: 'recorded-direct',
        videoFileId: 1,
        recordedId: 7,
        shouldRenderInfoCard: true,
      },
    }

    const { result } = renderHook(
      () =>
        useRecordedWatchInfo({
          route,
          isHalfWidthDisplayed: false,
          apiRepository,
          onSnackbar,
        }),
      { wrapper: wrapper(client) },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
    expect(onSnackbar).toHaveBeenCalledWith({ text: '番組情報取得に失敗', severity: 'error' })
  })
})
