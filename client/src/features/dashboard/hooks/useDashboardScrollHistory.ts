import { useCallback, useLayoutEffect, useRef } from 'react'
import { restoreScrollHistoryBeforeVisible, type useScrollHistory } from '@/app/scrollHistory'

export interface DashboardScrollData {
  recordingScroll: number
  recordedScroll: number
  reservesScroll: number
}

export function useDashboardScrollHistory({
  scrollHistory,
  pathname,
  search,
}: {
  scrollHistory: ReturnType<typeof useScrollHistory>
  pathname: string
  search: string
}) {
  const recordingList = useRef<HTMLUListElement | null>(null)
  const recordedList = useRef<HTMLUListElement | null>(null)
  const reservesList = useRef<HTMLUListElement | null>(null)
  const routeHref = useRef(window.location.href)
  const suppressScrollSaveUntil = useRef(0)
  const latestScrollData = useRef<DashboardScrollData>({
    recordingScroll: 0,
    recordedScroll: 0,
    reservesScroll: 0,
  })
  const saveLatestScrollData = useCallback(() => {
    const scrollData = {
      recordingScroll: recordingList.current?.scrollTop ?? latestScrollData.current.recordingScroll,
      recordedScroll: recordedList.current?.scrollTop ?? latestScrollData.current.recordedScroll,
      reservesScroll: reservesList.current?.scrollTop ?? latestScrollData.current.reservesScroll,
    }
    latestScrollData.current = scrollData
    return scrollData
  }, [])
  const shouldSkipZeroScrollOverwrite = useCallback(
    (scrollData: DashboardScrollData) => {
      const storedScrollData = scrollHistory.getScrollData<DashboardScrollData>()
      const storedScrollTotal =
        (storedScrollData?.recordingScroll ?? 0) +
        (storedScrollData?.recordedScroll ?? 0) +
        (storedScrollData?.reservesScroll ?? 0)
      const nextScrollTotal =
        scrollData.recordingScroll + scrollData.recordedScroll + scrollData.reservesScroll

      return storedScrollTotal > 0 && nextScrollTotal === 0
    },
    [scrollHistory],
  )
  const saveScrollDataForCurrentRoute = () => {
    const scrollData = saveLatestScrollData()

    if (scrollHistory.isNeedRestoreHistory()) {
      return
    }
    if (Date.now() < suppressScrollSaveUntil.current) {
      return
    }
    if (shouldSkipZeroScrollOverwrite(scrollData)) {
      return
    }
    scrollHistory.saveScrollData<DashboardScrollData>(scrollData, routeHref.current)
  }
  const restoreSectionScrollFromHistory = useCallback(() => {
    void restoreScrollHistoryBeforeVisible<DashboardScrollData>(scrollHistory, (data) => {
      suppressScrollSaveUntil.current = Date.now() + 1000
      const restoreSectionScroll = () => {
        if (recordingList.current !== null) {
          recordingList.current.scrollTop = data.recordingScroll
        }
        if (recordedList.current !== null) {
          recordedList.current.scrollTop = data.recordedScroll
        }
        if (reservesList.current !== null) {
          reservesList.current.scrollTop = data.reservesScroll
        }
      }
      restoreSectionScroll()
      requestAnimationFrame(restoreSectionScroll)
      latestScrollData.current = data
    })
  }, [scrollHistory])

  useLayoutEffect(() => {
    routeHref.current = window.location.href

    return () => {
      const scrollData = saveLatestScrollData()
      if (shouldSkipZeroScrollOverwrite(scrollData)) {
        return
      }
      scrollHistory.saveScrollData<DashboardScrollData>(scrollData, routeHref.current)
    }
  }, [pathname, search, saveLatestScrollData, scrollHistory, shouldSkipZeroScrollOverwrite])

  return {
    recordingList,
    recordedList,
    reservesList,
    saveScrollDataForCurrentRoute,
    restoreSectionScrollFromHistory,
  }
}
