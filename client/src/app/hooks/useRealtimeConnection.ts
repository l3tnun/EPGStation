import type { QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { Location, NavigateFunction } from 'react-router-dom'
import type { ShellSnackbarState } from '../AppShell'
import { createFullRoutePath, createFullRoutePathFromBrowserHash } from '../lib/routePath'
import { hasSocketIOPort, type ActiveServerConfig } from '../lib/serverConfigSelectors'
import {
  DISCONNECT_MESSAGE,
  RECONNECT_MESSAGE,
  SOCKET_INITIALIZATION_FAILURE_MESSAGE,
  type RealtimeConnection,
  type RealtimeConnectionConfig,
  type RealtimeConnectionConnector,
  type RealtimeConnectionFactory,
} from '../realtime'
import {
  REALTIME_RECONNECT_QUERY_KEYS,
  REALTIME_UPDATE_ENCODE_QUERY_KEYS,
  REALTIME_UPDATE_STATUS_QUERY_KEYS,
  invalidateRealtimeQueries,
} from '../realtimeInvalidation'

export interface RealtimeConnectionInput {
  realtimeConnectionFactory: RealtimeConnectionFactory | undefined
  realtimeConnectionConnector: RealtimeConnectionConnector | undefined
  activeServerConfig: ActiveServerConfig
  location: Location
  queryClient: QueryClient
  navigate: NavigateFunction
  showSnackbar: (snackbar: ShellSnackbarState) => void
  refreshVersion: (options: { notifyOnFailure: boolean }) => Promise<void>
  latestFullRouteRef: MutableRefObject<string>
  suppressedRouteSnackbarClosesRef: MutableRefObject<number>
}

export function useRealtimeConnection({
  realtimeConnectionFactory,
  realtimeConnectionConnector,
  activeServerConfig,
  location,
  queryClient,
  navigate,
  showSnackbar,
  refreshVersion,
  latestFullRouteRef,
  suppressedRouteSnackbarClosesRef,
}: RealtimeConnectionInput): boolean {
  const wasDisconnected = useRef(false)
  const previousDisconnectedFullRoute = useRef(createFullRoutePath(location))
  const reconnectDashboardTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const reconnectSnackbarTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [isDisconnected, setIsDisconnected] = useState(false)
  const clearReconnectTimers = useCallback(() => {
    if (reconnectDashboardTimer.current !== undefined) {
      clearTimeout(reconnectDashboardTimer.current)
      reconnectDashboardTimer.current = undefined
    }
    if (reconnectSnackbarTimer.current !== undefined) {
      clearTimeout(reconnectSnackbarTimer.current)
      reconnectSnackbarTimer.current = undefined
    }
  }, [])

  useEffect(() => {
    return clearReconnectTimers
  }, [clearReconnectTimers])

  useEffect(() => {
    const resolveRealtimeConnectionFactory = (): RealtimeConnectionFactory | undefined => {
      if (realtimeConnectionFactory !== undefined) {
        return realtimeConnectionFactory
      }

      if (realtimeConnectionConnector === undefined || !hasSocketIOPort(activeServerConfig)) {
        return undefined
      }

      const connectionConfig: RealtimeConnectionConfig = {
        socketIOPort: activeServerConfig.socketIOPort,
      }

      return () => realtimeConnectionConnector(connectionConfig)
    }
    const createRealtimeConnection = resolveRealtimeConnectionFactory()

    if (createRealtimeConnection === undefined) {
      return () => undefined
    }

    let connection: RealtimeConnection | null = null

    // Both cleanups below call clearTimeout on this exact timer before the effect can be torn
    // down again, so by the time either callback could run, it is guaranteed still mounted with
    // this effect active: there is no cancelled-but-still-firing case to guard against here.
    try {
      connection = createRealtimeConnection()
    } catch {
      const snackbarTimer = setTimeout(() => {
        showSnackbar({
          text: SOCKET_INITIALIZATION_FAILURE_MESSAGE,
          severity: 'error',
        })
      }, 0)

      return () => {
        clearTimeout(snackbarTimer)
      }
    }

    if (connection === null) {
      const snackbarTimer = setTimeout(() => {
        showSnackbar({
          text: SOCKET_INITIALIZATION_FAILURE_MESSAGE,
          severity: 'error',
        })
      }, 0)

      return () => {
        clearTimeout(snackbarTimer)
      }
    }

    const handleDisconnect = () => {
      wasDisconnected.current = true
      /* v8 ignore next -- jsdom: createFullRoutePathFromBrowserHash() only returns null without a `window`, which this mounted effect always has in jsdom */
      previousDisconnectedFullRoute.current =
        createFullRoutePathFromBrowserHash() ?? latestFullRouteRef.current
      setIsDisconnected(true)
      showSnackbar({
        text: DISCONNECT_MESSAGE,
        severity: 'error',
      })
    }
    const handleConnect = () => {
      if (!wasDisconnected.current) {
        return
      }

      wasDisconnected.current = false
      setIsDisconnected(false)
      const restoreRoute = previousDisconnectedFullRoute.current
      invalidateRealtimeQueries({
        queryClient,
        queryKeys: REALTIME_RECONNECT_QUERY_KEYS,
      })

      clearReconnectTimers()
      suppressedRouteSnackbarClosesRef.current = 2
      navigate('/', {
        replace: true,
      })
      // Unmounting clears both of these timers via clearReconnectTimers (see the effect above),
      // so by the time either callback below can run, the component is guaranteed to still be
      // mounted; there is no unmounted-but-still-firing case to guard against here.
      reconnectDashboardTimer.current = setTimeout(() => {
        reconnectDashboardTimer.current = undefined

        navigate(restoreRoute, {
          replace: true,
        })
        reconnectSnackbarTimer.current = setTimeout(() => {
          reconnectSnackbarTimer.current = undefined

          showSnackbar({
            text: RECONNECT_MESSAGE,
          })
        }, 0)
      }, 0)
    }
    const handleUpdateStatus = () => {
      // version の取得完了を待ってから invalidate すると、応答が返らない要求が 1 つあるだけで
      // 以後の updateStatus がすべてその地点で止まり、画面の更新が無言で行われなくなる。
      // 両方を行う点は変わらないが、待ち合わせはしない。
      invalidateRealtimeQueries({
        queryClient,
        queryKeys: REALTIME_UPDATE_STATUS_QUERY_KEYS,
      })
      void refreshVersion({
        notifyOnFailure: false,
      })
    }
    const handleUpdateEncode = () => {
      invalidateRealtimeQueries({
        queryClient,
        queryKeys: REALTIME_UPDATE_ENCODE_QUERY_KEYS,
      })
    }

    connection.on('disconnect', handleDisconnect)
    connection.on('connect', handleConnect)
    connection.on('updateStatus', handleUpdateStatus)
    connection.on('updateEncode', handleUpdateEncode)

    return () => {
      connection?.off('disconnect', handleDisconnect)
      connection?.off('connect', handleConnect)
      connection?.off('updateStatus', handleUpdateStatus)
      connection?.off('updateEncode', handleUpdateEncode)
      connection?.disconnect?.()
    }
  }, [
    activeServerConfig,
    clearReconnectTimers,
    latestFullRouteRef,
    navigate,
    queryClient,
    realtimeConnectionConnector,
    realtimeConnectionFactory,
    refreshVersion,
    showSnackbar,
    suppressedRouteSnackbarClosesRef,
  ])

  return isDisconnected
}
