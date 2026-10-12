import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import { restoreScrollHistoryBeforeVisible, useScrollHistory } from '@/app/scrollHistory'
import type { GuideGridRenderer, GuideScrollData } from '../GuideGridRenderer'
import type { useGuideRouteData } from './useGuideRouteData'

type GuideRouteData = ReturnType<typeof useGuideRouteData>

/**
 * Completes one Guide route: reports fetch failures once, retries a not-found single channel,
 * restores the grid scroll position, and saves it when the route is left.
 */
export function useGuideRouteCompletion({
  renderer,
  routeKey,
  routeHistoryUrl,
  canUseGridScrollHistory,
  isRendererReady,
  routeData,
  onFetchFailure,
  onInvalidChannel,
}: {
  renderer: GuideGridRenderer
  routeKey: string
  routeHistoryUrl: string | undefined
  canUseGridScrollHistory: boolean
  isRendererReady: boolean
  routeData: Pick<
    GuideRouteData,
    'hasCompletedRouteData' | 'scheduleQuery' | 'reserveIndexQuery' | 'requestSet'
  >
  onFetchFailure: (snackbar: ShellSnackbarState) => void
  onInvalidChannel: (routeKey: string, channelId: number) => void
}) {
  const scrollHistory = useScrollHistory()
  const handledRouteKey = useRef<string | undefined>(undefined)
  const latestScrollData = useRef<GuideScrollData>({ scrollLeft: 0, scrollTop: 0 })
  const canSaveGridScroll = useRef(false)
  const [restoredRouteKey, setRestoredRouteKey] = useState<string | undefined>(undefined)
  const { hasCompletedRouteData, scheduleQuery, reserveIndexQuery, requestSet } = routeData
  const channelId = requestSet.guideQuery.channelId

  const saveLatestScrollData = useCallback(() => {
    latestScrollData.current = renderer.getScrollData()
  }, [renderer])

  const restoreGridScroll = useCallback(
    (data: GuideScrollData) => {
      renderer.restoreScroll(data)
      latestScrollData.current = data
    },
    [renderer],
  )

  useEffect(() => {
    canSaveGridScroll.current = false
    handledRouteKey.current = undefined
  }, [routeKey])

  useEffect(() => {
    if (!hasCompletedRouteData || !isRendererReady) {
      return
    }

    const isRouteFetchCompletion = handledRouteKey.current !== routeKey

    if (!isRouteFetchCompletion) {
      return
    }

    if (
      scheduleQuery.data?.ok === false &&
      scheduleQuery.data.error === 'guide-channel-not-found' &&
      channelId !== undefined
    ) {
      onInvalidChannel(routeKey, channelId)
      return
    }

    handledRouteKey.current = routeKey

    if (scheduleQuery.data?.ok === false) {
      onFetchFailure({
        text: scheduleQuery.data.message,
        severity: 'error',
      })
    }
    if (reserveIndexQuery.data?.ok === false) {
      onFetchFailure({
        text: reserveIndexQuery.data.message,
        severity: 'error',
      })
    }

    let cancelled = false
    const completeRestore = async () => {
      if (!scrollHistory.isNeedRestoreHistory() || !canUseGridScrollHistory) {
        restoreGridScroll({
          scrollLeft: 0,
          scrollTop: 0,
        })
        scrollHistory.emitDoneGetData()
        // No `await` occurs before this point, so `cancelled` (only ever set by this effect's
        // own cleanup, after this synchronous call stack returns) cannot yet be true here.
        canSaveGridScroll.current = true
        setRestoredRouteKey(routeKey)
        return
      }

      scrollHistory.emitDoneGetData()
      await restoreScrollHistoryBeforeVisible<GuideScrollData>(scrollHistory, restoreGridScroll)
      if (!cancelled) {
        canSaveGridScroll.current = true
        setRestoredRouteKey(routeKey)
      }
    }

    void completeRestore()

    return () => {
      cancelled = true
    }
  }, [
    hasCompletedRouteData,
    isRendererReady,
    onFetchFailure,
    onInvalidChannel,
    reserveIndexQuery.data,
    channelId,
    routeKey,
    canUseGridScrollHistory,
    restoreGridScroll,
    scheduleQuery.data,
    scrollHistory,
  ])

  useLayoutEffect(
    () => () => {
      if (!canSaveGridScroll.current) {
        return
      }
      if (!canUseGridScrollHistory) {
        return
      }
      saveLatestScrollData()
      scrollHistory.saveScrollData<GuideScrollData>(latestScrollData.current, routeHistoryUrl)
    },
    [canUseGridScrollHistory, routeHistoryUrl, saveLatestScrollData, scrollHistory],
  )

  return {
    isRestored: !scrollHistory.isNeedRestoreHistory() || restoredRouteKey === routeKey,
  }
}
