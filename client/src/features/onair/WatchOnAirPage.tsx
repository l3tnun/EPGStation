import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { LiveStreamConfig } from '@/app/serverApi'
import { useScrollHistoryPageReady } from '@/app/scrollHistory'
import {
  PlaybackControlledError,
  PlaybackPlayerContainer,
  PlaybackRouteShell,
} from '@/features/video/playback'
import { resolveLiveWatchRoute } from '@/features/video/playback/playbackRoutes'
import { buildPlaybackMediaSource } from '@/features/video/playback/playbackMedia'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { OnAirApiRepository } from './onairApi'
import {
  ONAIR_WATCH_INFO_QUERY_KEY,
  createOnAirWatchInfoQueryKey,
  resolveWatchInfoDisplay,
  resolveWatchInfoUpdateDelay,
} from './onairRequests'
import styles from './OnAirPage.module.css'

export interface WatchOnAirPageProps {
  isNavigationOpen: boolean
  onNavigationClick: () => void
  title: string
  settings: SettingsConsumerValue
  viewportWidth?: number
  streamConfig?: LiveStreamConfig
  isConfigLoaded: boolean
  apiRepository: OnAirApiRepository
  onFetchFailure: (snackbar: ShellSnackbarState) => void
}

export function WatchOnAirPage({
  isNavigationOpen,
  onNavigationClick,
  title,
  settings,
  viewportWidth,
  streamConfig,
  isConfigLoaded,
  apiRepository,
  onFetchFailure,
}: WatchOnAirPageProps) {
  const location = useLocation()
  const queryClient = useQueryClient()
  const updateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const route = useMemo(
    () => resolveLiveWatchRoute({ search: location.search, streamConfig, isConfigLoaded }),
    [isConfigLoaded, location.search, streamConfig],
  )
  const request = useMemo(
    () => ({ isHalfWidth: settings.isHalfWidthDisplayed }),
    [settings.isHalfWidthDisplayed],
  )
  const queryKey = useMemo(
    () => createOnAirWatchInfoQueryKey({ request, watchParam: route.ok ? route.value : null }),
    [request, route],
  )
  const clearUpdateTimer = useCallback(() => {
    if (updateTimer.current !== undefined) {
      clearTimeout(updateTimer.current)
      updateTimer.current = undefined
    }
  }, [])
  const query = useQuery({
    queryKey,
    enabled: route.ok,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      clearUpdateTimer()
      const result = await apiRepository.fetchLiveStreams(request)

      if (!result.ok) {
        onFetchFailure({
          text: result.message,
          severity: 'error',
        })
      }

      return result
    },
  })
  const display =
    route.ok && query.data?.ok === true
      ? resolveWatchInfoDisplay({
          items: query.data.value.items,
          channelId: route.value.channelId,
          mode: route.value.mode,
        })
      : null
  const mediaSource = route.ok
    ? buildPlaybackMediaSource({
        route: route.value,
        isHalfWidth: settings.isHalfWidthDisplayed,
        baseUrl: window.location.href,
      })
    : null
  useScrollHistoryPageReady(
    !route.ok || (query.data !== undefined && !query.isFetching),
    `${location.pathname}${location.search}`,
  )

  useEffect(() => {
    if (!route.ok || query.data === undefined) {
      return
    }

    clearUpdateTimer()
    const matching =
      query.data.ok === true
        ? query.data.value.items.find(
            (item) => item.channelId === route.value.channelId && item.mode === route.value.mode,
          )
        : undefined
    updateTimer.current = setTimeout(
      () => {
        updateTimer.current = undefined
        void queryClient.invalidateQueries({
          queryKey: ONAIR_WATCH_INFO_QUERY_KEY,
        })
      },
      resolveWatchInfoUpdateDelay({ item: matching, now: Date.now() }),
    )

    return clearUpdateTimer
  }, [clearUpdateTimer, query.data, queryClient, route])

  useEffect(() => clearUpdateTimer, [clearUpdateTimer])

  return (
    <PlaybackRouteShell
      isNavigationOpen={isNavigationOpen}
      onNavigationClick={onNavigationClick}
      title={title}
    >
      {!route.ok && route.message === null ? undefined : !route.ok ? (
        <PlaybackControlledError message={route.message} />
      ) : (
        <PlaybackPlayerContainer
          kind={route.value.kind}
          mediaUrl={mediaSource?.mediaUrl}
          onSnackbar={onFetchFailure}
          isForceEnableSubtitleStroke={settings.isForceEnableSubtitleStroke}
          initialControlsVisible={false}
          showLifecycleError
          readinessUrl={mediaSource?.readinessUrl}
          sourceKind={mediaSource?.sourceKind}
          streamingType={route.value.streamingType}
          streamStartUrl={mediaSource?.streamStartUrl}
          viewportWidth={viewportWidth}
        />
      )}
      <div className={styles.watchPage}>
        {display === null ? undefined : (
          <article className={styles.watchInfoCard} data-testid="onair-watch-info-card">
            <div className={styles.watchInfoChannel}>{display.channelName}</div>
            <div className={styles.watchInfoTime}>{display.time}</div>
            <div className={styles.watchInfoTitle}>{display.name}</div>
            <div className={styles.watchInfoDescription}>{display.description}</div>
          </article>
        )}
      </div>
    </PlaybackRouteShell>
  )
}
