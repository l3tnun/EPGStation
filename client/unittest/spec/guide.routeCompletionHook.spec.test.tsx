import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScrollHistoryProvider } from '@/app/scroll/scrollHistoryContext'
import type { ScrollHistoryState } from '@/app/scroll/scrollHistoryTypes'
import type { GuideGridRenderer } from '@/features/guide/GuideGridRenderer'
import { useGuideRouteCompletion } from '@/features/guide/hooks/useGuideRouteCompletion'

function createRenderer(): GuideGridRenderer {
  return {
    getScrollData: vi.fn(() => ({ scrollLeft: 0, scrollTop: 0 })),
    restoreScroll: vi.fn(),
  } as unknown as GuideGridRenderer
}

function createScrollHistory(overrides: Partial<ScrollHistoryState> = {}): ScrollHistoryState {
  return {
    isNeedRestoreHistory: () => false,
    saveScrollData: vi.fn(),
    getScrollData: () => null,
    getHistoryPosition: () => null,
    updateHistoryPosition: vi.fn(),
    emitDoneGetData: vi.fn(),
    onDoneGetData: vi.fn(async () => undefined),
    clearRestoreHistory: vi.fn(),
    ...overrides,
  }
}

function createRequestSet(channelId: number | undefined = undefined) {
  return {
    guideQuery: { mode: 'normal' as const, startAt: 0, isTimeQueryValid: true, channelId },
    schedule: {
      mode: 'normal' as const,
      startAt: 0,
      endAt: 3_600_000,
      isHalfWidth: false,
      isFree: false,
      GR: true,
      BS: false,
      CS: false,
      SKY: false,
      BS4K: false,
    },
    reserveIndex: { startAt: 0, endAt: 3_600_000 },
  }
}

describe('useGuideRouteCompletion edges (direct hook control)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderWithProvider(
    props: Parameters<typeof useGuideRouteCompletion>[0],
    scrollHistory: ScrollHistoryState,
  ) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ScrollHistoryProvider scrollHistory={scrollHistory}>{children}</ScrollHistoryProvider>
    )

    return renderHook(
      (hookProps: Parameters<typeof useGuideRouteCompletion>[0]) =>
        useGuideRouteCompletion(hookProps),
      { wrapper, initialProps: props },
    )
  }

  it('[AC 6.2] [AC 7.2] reports a reserve-index fetch failure even when the schedule succeeded', () => {
    const onFetchFailure = vi.fn()
    const scrollHistory = createScrollHistory()

    renderWithProvider(
      {
        renderer: createRenderer(),
        routeKey: 'route-1',
        routeHistoryUrl: undefined,
        canUseGridScrollHistory: false,
        isRendererReady: true,
        routeData: {
          hasCompletedRouteData: true,
          scheduleQuery: { data: { ok: true, value: [] } } as never,
          reserveIndexQuery: {
            data: { ok: false, message: '番組表情報の取得に失敗しました' },
          } as never,
          requestSet: createRequestSet(),
        },
        onFetchFailure,
        onInvalidChannel: vi.fn(),
      },
      scrollHistory,
    )

    expect(onFetchFailure).toHaveBeenCalledWith({
      text: '番組表情報の取得に失敗しました',
      severity: 'error',
    })
  })

  it('[AC 2.9] does not save scroll history on unmount before the route finished restoring', () => {
    const scrollHistory = createScrollHistory()
    const { unmount } = renderWithProvider(
      {
        renderer: createRenderer(),
        routeKey: 'route-1',
        routeHistoryUrl: 'http://localhost/#/guide?timestamp=1',
        canUseGridScrollHistory: true,
        isRendererReady: false,
        routeData: {
          hasCompletedRouteData: false,
          scheduleQuery: { data: undefined } as never,
          reserveIndexQuery: { data: undefined } as never,
          requestSet: createRequestSet(),
        },
        onFetchFailure: vi.fn(),
        onInvalidChannel: vi.fn(),
      },
      scrollHistory,
    )

    unmount()

    expect(scrollHistory.saveScrollData).not.toHaveBeenCalled()
  })

  it('[AC 2.9] does not save scroll history on unmount when the route has no restorable scroll history key', async () => {
    const scrollHistory = createScrollHistory()
    const { unmount } = renderWithProvider(
      {
        renderer: createRenderer(),
        routeKey: 'route-1',
        routeHistoryUrl: undefined,
        canUseGridScrollHistory: false,
        isRendererReady: true,
        routeData: {
          hasCompletedRouteData: true,
          scheduleQuery: { data: { ok: true, value: [] } } as never,
          reserveIndexQuery: { data: { ok: true, value: {} } } as never,
          requestSet: createRequestSet(),
        },
        onFetchFailure: vi.fn(),
        onInvalidChannel: vi.fn(),
      },
      scrollHistory,
    )

    // Let the pending restore microtasks (completeRestore's synchronous branch) flush so
    // canSaveGridScroll becomes true before we unmount.
    await vi.runAllTimersAsync()

    unmount()

    expect(scrollHistory.saveScrollData).not.toHaveBeenCalled()
  })

  it('[AC 2.10] does not mark a superseded restore as complete once the route changes mid-restore', async () => {
    const resolvers: Array<() => void> = []
    const scrollHistory = createScrollHistory({
      isNeedRestoreHistory: () => true,
      onDoneGetData: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolvers.push(resolve)
          }),
      ),
    })
    const renderer = createRenderer()

    const { rerender, result } = renderWithProvider(
      {
        renderer,
        routeKey: 'route-1',
        routeHistoryUrl: 'http://localhost/#/guide?timestamp=1',
        canUseGridScrollHistory: true,
        isRendererReady: true,
        routeData: {
          hasCompletedRouteData: true,
          scheduleQuery: { data: { ok: true, value: [] } } as never,
          reserveIndexQuery: { data: { ok: true, value: {} } } as never,
          requestSet: createRequestSet(),
        },
        onFetchFailure: vi.fn(),
        onInvalidChannel: vi.fn(),
      },
      scrollHistory,
    )

    // Navigating to a new route while the first route's restore is still awaiting
    // onDoneGetData() cancels the stale completion.
    rerender({
      renderer,
      routeKey: 'route-2',
      routeHistoryUrl: 'http://localhost/#/guide?timestamp=2',
      canUseGridScrollHistory: true,
      isRendererReady: true,
      routeData: {
        hasCompletedRouteData: true,
        scheduleQuery: { data: { ok: true, value: [] } } as never,
        reserveIndexQuery: { data: { ok: true, value: {} } } as never,
        requestSet: createRequestSet(),
      },
      onFetchFailure: vi.fn(),
      onInvalidChannel: vi.fn(),
    })

    expect(resolvers).toHaveLength(2)
    // Resolve the *stale* (route-1) restore only; its `cancelled` flag was already set by the
    // effect cleanup that ran when route-2 superseded it, so it must not mark route-2 restored.
    await act(async () => {
      resolvers[0]?.()
      await vi.runAllTimersAsync()
    })

    expect(result.current.isRestored).toBe(false)
    expect(renderer.restoreScroll).not.toHaveBeenCalled()

    await act(async () => {
      resolvers[1]?.()
      await vi.runAllTimersAsync()
    })

    expect(result.current.isRestored).toBe(true)
  })
})
