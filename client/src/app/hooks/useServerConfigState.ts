import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShellSnackbarState } from '../AppShell'
import { UNLOADED_NAVIGATION_CONFIG, type NavigationConfigState } from '../navigation'
import type { ServerApiRepository } from '../serverApi'
import type { DashboardApiRepository } from '../../features/dashboard/dashboardApi'
import type { RecordedApiRepository } from '../../features/recorded/recordedApi'
import type { ReservesApiRepository } from '../../features/reserves/reservesApi'
import type { SearchRuleApiRepository } from '../../features/search/rule'

const APP_SHELL_VERSION_QUERY_KEY = ['app-shell', 'version'] as const
const APP_SHELL_CONFIG_QUERY_KEY = ['app-shell', 'config'] as const

export interface ServerConfigStateInput {
  apiRepository: ServerApiRepository | undefined
  navigationConfig: NavigationConfigState
  dashboardVersion: string | null
  dashboardApiRepository: DashboardApiRepository
  recordedApiRepository: RecordedApiRepository
  reservesApiRepository: ReservesApiRepository
  searchRuleApiRepository: SearchRuleApiRepository
  showSnackbar: (snackbar: ShellSnackbarState) => void
}

export interface ServerConfigState {
  activeDashboardVersion: string | null
  apiNavigationConfig: NavigationConfigState
  isInitialServerConfigResolved: boolean
  refreshVersion: (options: { notifyOnFailure: boolean }) => Promise<void>
}

export function useServerConfigState({
  apiRepository,
  navigationConfig,
  dashboardVersion,
  dashboardApiRepository,
  recordedApiRepository,
  reservesApiRepository,
  searchRuleApiRepository,
  showSnackbar,
}: ServerConfigStateInput): ServerConfigState {
  const queryClient = useQueryClient()
  const isInitialServerConfigRefreshStarted = useRef(false)
  const [activeDashboardVersion, setActiveDashboardVersion] = useState(dashboardVersion)
  const [apiNavigationConfig, setApiNavigationConfig] = useState<NavigationConfigState>(
    UNLOADED_NAVIGATION_CONFIG,
  )
  const [isInitialServerConfigResolved, setIsInitialServerConfigResolved] = useState(
    () => apiRepository === undefined || navigationConfig.status !== 'unloaded',
  )
  const refreshVersion = useCallback(
    async (options: { notifyOnFailure: boolean }) => {
      if (apiRepository === undefined) {
        return
      }

      await queryClient.invalidateQueries({
        queryKey: APP_SHELL_VERSION_QUERY_KEY,
      })
      const result = await queryClient.fetchQuery({
        queryKey: APP_SHELL_VERSION_QUERY_KEY,
        queryFn: () => apiRepository.fetchVersion(),
      })

      if (result.ok) {
        setActiveDashboardVersion(result.value.version)
        return
      }

      if (options.notifyOnFailure) {
        showSnackbar({
          text: result.message,
          severity: 'error',
        })
      }
    },
    [apiRepository, queryClient, showSnackbar],
  )
  const refreshServerConfig = useCallback(async () => {
    if (apiRepository === undefined || navigationConfig.status !== 'unloaded') {
      return
    }
    if (isInitialServerConfigRefreshStarted.current) {
      return
    }
    isInitialServerConfigRefreshStarted.current = true

    await queryClient.invalidateQueries({
      queryKey: APP_SHELL_CONFIG_QUERY_KEY,
    })
    const result = await queryClient.fetchQuery({
      queryKey: APP_SHELL_CONFIG_QUERY_KEY,
      queryFn: () => apiRepository.fetchServerConfig(),
    })

    if (result.ok) {
      setApiNavigationConfig(result.value)
    } else {
      showSnackbar({
        text: result.message,
        severity: 'error',
        timeout: 5000,
      })
    }

    const channelsResult = await apiRepository.fetchBootstrapChannels?.()
    if (channelsResult !== undefined) {
      if (channelsResult.ok) {
        dashboardApiRepository.primeChannelIndex?.(channelsResult.value)
        recordedApiRepository.primeChannelIndex?.(channelsResult.value)
        reservesApiRepository.primeChannelIndex?.(channelsResult.value)
        searchRuleApiRepository.primeChannelIndex?.(channelsResult.value)
      } else {
        console.error(channelsResult.message)
      }
    }

    await refreshVersion({ notifyOnFailure: true })
    setIsInitialServerConfigResolved(true)
  }, [
    apiRepository,
    navigationConfig.status,
    queryClient,
    dashboardApiRepository,
    recordedApiRepository,
    reservesApiRepository,
    refreshVersion,
    searchRuleApiRepository,
    showSnackbar,
  ])

  useEffect(() => {
    const refreshTimer = setTimeout(() => {
      void refreshServerConfig()
    }, 0)

    return () => {
      clearTimeout(refreshTimer)
    }
  }, [refreshServerConfig])

  return {
    activeDashboardVersion,
    apiNavigationConfig,
    isInitialServerConfigResolved,
    refreshVersion,
  }
}
