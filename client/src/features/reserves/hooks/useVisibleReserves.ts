import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import { useScrollHistoryPageReady } from '@/app/scrollHistory'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { ReservesApiRepository, ReservesListResponse } from '../lib/reservesApiTypes'
import { buildReservesListRequest, createReservesQueryKey } from '../lib/reservesListRequests'

export type VisibleReservesState =
  | {
      status: 'loading'
    }
  | {
      status: 'error'
    }
  | {
      status: 'loaded'
      value: ReservesListResponse
    }

export function useVisibleReserves({
  settings,
  pathname,
  search,
  apiRepository,
  onFetchFailure,
}: {
  settings: SettingsConsumerValue
  pathname: string
  search: string
  apiRepository: ReservesApiRepository
  onFetchFailure: (snackbar: ShellSnackbarState) => void
}) {
  const handledRouteKey = useRef<string | undefined>(undefined)
  const [visibleState, setVisibleState] = useState<VisibleReservesState>({ status: 'loading' })
  const request = useMemo(() => buildReservesListRequest({ settings, search }), [search, settings])
  const queryKey = useMemo(() => createReservesQueryKey({ settings, search }), [search, settings])
  const routeKey = `${pathname}${search}`
  const query = useQuery({
    queryKey,
    queryFn: () => apiRepository.fetchReserves(request),
  })
  useScrollHistoryPageReady(visibleState.status !== 'loading', routeKey)

  useEffect(() => {
    handledRouteKey.current = undefined
    // Route-driven fetches intentionally clear visible list state before the next query resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleState({ status: 'loading' })
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
        value: query.data.value,
      })
      return
    }

    if (query.data.ok) {
      setVisibleState({
        status: 'loaded',
        value: query.data.value,
      })
    }
  }, [onFetchFailure, query.data, query.isFetching, routeKey])

  return { request, visibleState, refetch: () => void query.refetch() }
}
