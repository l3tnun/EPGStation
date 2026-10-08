import LinearProgress from '@mui/material/LinearProgress'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { SHELL_NAVIGATION_DRAWER_ID, type ShellSnackbarState } from '@/app/AppShell'
import { useScrollHistoryPageReady } from '@/app/scrollHistory'
import { TitleBar } from '@/app/titleBar'
import type { StoragesApiRepository } from './storagesApi'
import { STORAGES_QUERY_KEY, toStorageUsageView, type StorageUsageView } from './storagesRequests'
import styles from './StoragesPage.module.css'

export interface StoragesPageProps {
  isNavigationOpen: boolean
  onNavigationClick: () => void
  apiRepository: StoragesApiRepository
  onFetchFailure: (snackbar: ShellSnackbarState) => void
}

type VisibleStoragesState =
  | {
      status: 'loading'
    }
  | {
      status: 'error'
    }
  | {
      status: 'loaded'
      value: readonly StorageUsageView[]
    }

export function StoragesPage({
  isNavigationOpen,
  onNavigationClick,
  apiRepository,
  onFetchFailure,
}: StoragesPageProps) {
  const location = useLocation()
  const handledRouteKey = useRef<string | undefined>(undefined)
  const routeKey = `${location.pathname}${location.search}`
  const queryKey = useMemo(() => [...STORAGES_QUERY_KEY, routeKey] as const, [routeKey])
  const [visibleState, setVisibleState] = useState<VisibleStoragesState>({ status: 'loading' })
  const query = useQuery({
    queryKey,
    queryFn: () => apiRepository.fetchStorages(),
  })

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
        // Route fetch failure keeps the cleared list and reports through App Shell snackbar.
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
        value: query.data.value.items.map(toStorageUsageView),
      })
      return
    }

    if (query.data.ok) {
      setVisibleState({
        status: 'loaded',
        value: query.data.value.items.map(toStorageUsageView),
      })
    }
  }, [onFetchFailure, query.data, query.isFetching, routeKey])

  const storages = visibleState.status === 'loaded' ? visibleState.value : []
  useScrollHistoryPageReady(visibleState.status !== 'loading', routeKey)

  return (
    <>
      <TitleBar
        title="ストレージ"
        isNavigationOpen={isNavigationOpen}
        navigationControlsId={SHELL_NAVIGATION_DRAWER_ID}
        onNavigationClick={onNavigationClick}
      />
      {visibleState.status === 'loaded' && storages.length > 0 ? (
        <div
          className={styles.storagesPage}
          data-storages-count={storages.length}
          data-testid="storages-page"
        >
          <div className={styles.list}>
            {storages.map((storage) => (
              <div className={styles.storageItem} key={storage.name} role="listitem">
                <h3 className={styles.storageTitle}>
                  {storage.name} - {storage.total}
                </h3>
                <LinearProgress
                  aria-label={`${storage.name} 使用率`}
                  aria-valuenow={storage.useRate}
                  sx={{
                    height: 25,
                    backgroundColor: 'transparent',
                    backgroundImage: `linear-gradient(to right, transparent 0%, transparent ${storage.useRate}%, rgba(25, 118, 210, 0.3) ${storage.useRate}%, rgba(25, 118, 210, 0.3) 100%)`,
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: '#1976d2',
                    },
                  }}
                  value={storage.useRate}
                  variant="determinate"
                />
                <div className={styles.footer}>
                  <span>{storage.used} 使用済み</span>
                  <span>{storage.available} 空き</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : undefined}
    </>
  )
}
