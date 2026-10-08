import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import { useScrollHistoryPageReady } from '@/app/scrollHistory'
import type { RecordedListItem } from '@/features/recorded/recordedApi'
import type { SettingsConsumerValue } from '@/shared/settings'
import { RECORDING_CARD_LAYOUT_MEDIA_QUERY, readIsCardLayout } from '../lib/recordingFormat'
import type { RecordingApiRepository } from '../recordingApi'
import { buildRecordingListRequest, createRecordingQueryKey } from '../recordingRequests'

export type VisibleRecordingState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; records: RecordedListItem[]; total: number }

export function useVisibleRecording({
  settings,
  pathname,
  search,
  apiRepository,
  onFetchFailure,
}: {
  settings: SettingsConsumerValue
  pathname: string
  search: string
  apiRepository: RecordingApiRepository
  onFetchFailure: (snackbar: ShellSnackbarState) => void
}) {
  const handledRouteKey = useRef<string | undefined>(undefined)
  const [isCardLayout, setCardLayout] = useState(readIsCardLayout)
  const [visibleState, setVisibleState] = useState<VisibleRecordingState>({ status: 'loading' })
  const routeKey = `${pathname}${search}`
  const request = useMemo(() => buildRecordingListRequest({ settings, search }), [search, settings])
  const queryKey = useMemo(() => createRecordingQueryKey({ settings, search }), [search, settings])
  const query = useQuery({
    queryKey,
    queryFn: () => apiRepository.fetchRecording(request),
  })
  useScrollHistoryPageReady(visibleState.status !== 'loading', routeKey)

  useEffect(() => {
    const onChange = () => setCardLayout(readIsCardLayout())
    onChange()

    /* v8 ignore next 3 -- jsdom: this effect only runs once React has mounted, which needs `window` */
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return () => undefined
    }

    const mediaQueryList = window.matchMedia(RECORDING_CARD_LAYOUT_MEDIA_QUERY)
    mediaQueryList.addEventListener('change', onChange)

    return () => {
      mediaQueryList.removeEventListener('change', onChange)
    }
  }, [])

  useEffect(() => {
    handledRouteKey.current = undefined
    // Route changes intentionally clear Recording rows before the next request completes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleState({ status: 'loading' })
    setCardLayout(readIsCardLayout())
  }, [routeKey])

  useEffect(() => {
    if (query.data === undefined || query.isFetching) {
      return
    }

    const isRouteFetchCompletion = handledRouteKey.current !== routeKey

    if (isRouteFetchCompletion) {
      handledRouteKey.current = routeKey

      if (!query.data.ok) {
        // Route fetch completion must expose the error state before any user action.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setVisibleState({ status: 'error' })
        onFetchFailure({
          text: query.data.message,
          severity: 'error',
        })
        return
      }

      setVisibleState({
        status: 'loaded',
        records: query.data.value.records,
        total: query.data.value.total,
      })
      return
    }

    if (!query.data.ok) {
      onFetchFailure({
        text: query.data.message,
        severity: 'error',
      })
      return
    }

    setVisibleState({
      status: 'loaded',
      records: query.data.value.records,
      total: query.data.value.total,
    })
  }, [onFetchFailure, query.data, query.isFetching, routeKey])

  return { request, visibleState, isCardLayout, refetch: () => void query.refetch() }
}
