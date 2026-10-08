import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { OnAirApiRepository } from '../onairApi'
import { createOnAirQueryKey, resolveOnAirUpdateDelay, type OnAirRequest } from '../onairRequests'

const DIGESTIBILITY_INTERVAL_MS = 10 * 1000

/**
 * Fetches the on-air schedules, re-fetches when the earliest program ends, ticks `now` every ten
 * seconds for the progress bars, and invalidates the query on route changes and reserve actions.
 */
export function useOnAirSchedules({
  isHalfWidth,
  routeKey,
  apiRepository,
  onFetchFailure,
}: {
  isHalfWidth: boolean
  routeKey: string
  apiRepository: OnAirApiRepository
  onFetchFailure: (snackbar: ShellSnackbarState) => void
}) {
  const queryClient = useQueryClient()
  const updateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const digestibilityTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())
  const request = useMemo<OnAirRequest>(() => ({ isHalfWidth }), [isHalfWidth])
  const queryKey = useMemo(() => createOnAirQueryKey(request), [request])
  const clearUpdateTimer = useCallback(() => {
    if (updateTimer.current !== undefined) {
      clearTimeout(updateTimer.current)
      updateTimer.current = undefined
    }
  }, [])
  const clearDigestibilityTimer = useCallback(() => {
    if (digestibilityTimer.current !== undefined) {
      clearInterval(digestibilityTimer.current)
      digestibilityTimer.current = undefined
    }
  }, [])
  const query = useQuery({
    queryKey,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      clearUpdateTimer()
      const result = await apiRepository.fetchOnAir(request)

      if (!result.ok) {
        onFetchFailure({
          text: result.message,
          severity: 'error',
        })
      }

      return result
    },
  })
  const invalidateAfterAction = async (ok: boolean) => {
    if (ok) {
      await queryClient.invalidateQueries({
        queryKey,
      })
    }

    return ok
  }

  useEffect(() => {
    void queryClient.invalidateQueries({
      queryKey,
    })
  }, [routeKey, queryClient, queryKey])

  useEffect(() => {
    if (query.data?.ok !== true) {
      return
    }

    clearUpdateTimer()
    updateTimer.current = setTimeout(
      () => {
        updateTimer.current = undefined
        void queryClient.invalidateQueries({
          queryKey,
        })
      },
      resolveOnAirUpdateDelay(query.data.value.schedules, Date.now()),
    )

    clearDigestibilityTimer()
    digestibilityTimer.current = setInterval(() => {
      setNow(Date.now())
    }, DIGESTIBILITY_INTERVAL_MS)

    return () => {
      clearUpdateTimer()
      clearDigestibilityTimer()
    }
  }, [clearDigestibilityTimer, clearUpdateTimer, query.data, queryClient, queryKey])

  useEffect(
    () => () => {
      clearUpdateTimer()
      clearDigestibilityTimer()
    },
    [clearDigestibilityTimer, clearUpdateTimer],
  )

  return {
    now,
    query,
    schedules: query.data?.ok === true ? query.data.value.schedules : [],
    reserveIndex: query.data?.ok === true ? query.data.value.reserveIndex : {},
    invalidateAfterAction,
  }
}
