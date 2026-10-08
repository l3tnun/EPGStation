import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import { useScrollHistoryPageReady } from '@/app/scrollHistory'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { EncodeApiRepository } from '../encodeApi'
import { createEncodeQueryKey, type EncodeListResponse } from '../encodeRequests'

const EMPTY_ENCODE_RESPONSE: EncodeListResponse = {
  runningItems: [],
  waitItems: [],
}

export type VisibleEncodeState =
  | { status: 'loading'; value: EncodeListResponse }
  | { status: 'error'; value: EncodeListResponse }
  | { status: 'loaded'; value: EncodeListResponse }

export function useVisibleEncode({
  settings,
  apiRepository,
  onFetchFailure,
}: {
  settings: SettingsConsumerValue
  apiRepository: EncodeApiRepository
  onFetchFailure: (snackbar: ShellSnackbarState) => void
}) {
  const handledRouteKey = useRef<string | undefined>(undefined)
  const routeKey = '/encode'
  const [visibleState, setVisibleState] = useState<VisibleEncodeState>({
    status: 'loading',
    value: EMPTY_ENCODE_RESPONSE,
  })
  const queryKey = useMemo(() => createEncodeQueryKey({ settings }), [settings])
  const request = useMemo(() => ({ isHalfWidth: settings.isHalfWidthDisplayed }), [settings])
  const query = useQuery({
    queryKey,
    queryFn: () => apiRepository.fetchEncode(request),
  })
  useScrollHistoryPageReady(visibleState.status !== 'loading', routeKey)

  useEffect(() => {
    handledRouteKey.current = undefined
    // Route changes intentionally clear rows before the next request completes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleState({ status: 'loading', value: EMPTY_ENCODE_RESPONSE })
  }, [routeKey])

  useEffect(() => {
    if (query.data === undefined || query.isFetching) {
      return
    }

    const isRouteFetchCompletion = handledRouteKey.current !== routeKey

    if (isRouteFetchCompletion) {
      handledRouteKey.current = routeKey
    }

    if (!query.data.ok) {
      if (isRouteFetchCompletion) {
        setVisibleState({ status: 'error', value: EMPTY_ENCODE_RESPONSE })
      }
      onFetchFailure({
        text: query.data.message,
        severity: 'error',
      })
      return
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleState({
      status: 'loaded',
      value: query.data.value,
    })
  }, [onFetchFailure, query.data, query.isFetching, routeKey])

  return { visibleState }
}
