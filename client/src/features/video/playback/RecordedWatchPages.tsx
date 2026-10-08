import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { useScrollHistoryPageReady } from '@/app/scrollHistory'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { LiveStreamConfig } from '@/app/serverApi'
import type { RecordedApiRepository } from '@/features/recorded/recordedApi'
import {
  PlaybackControlledError,
  PlaybackPendingState,
  PlaybackPlayerContainer,
  PlaybackRouteShell,
} from './PlaybackShell'
import { buildPlaybackMediaSource } from './playbackMedia'
import { resolveRecordedStreamingWatchRoute, resolveRecordedWatchRoute } from './playbackRoutes'
import { detectMobilePlatform } from './platformDetection'
import { RecordedWatchInfoCard } from './components/RecordedWatchInfoCard'
import { resolveRecordedPlaybackFileType, useRecordedWatchInfo } from './hooks/useRecordedWatchInfo'

export interface RecordedWatchPageProps {
  isNavigationOpen: boolean
  onNavigationClick: () => void
  title: string
  isHalfWidthDisplayed: boolean
  isForceEnableSubtitleStroke: boolean
  viewportWidth?: number
  apiRepository: RecordedApiRepository
  onSnackbar: (snackbar: ShellSnackbarState) => void
}

export interface RecordedStreamingWatchPageProps extends RecordedWatchPageProps {
  streamConfig?: LiveStreamConfig
  isConfigLoaded: boolean
}

export function RecordedWatchPage({
  isNavigationOpen,
  onNavigationClick,
  title,
  isHalfWidthDisplayed,
  isForceEnableSubtitleStroke,
  viewportWidth,
  apiRepository,
  onSnackbar,
}: RecordedWatchPageProps) {
  const location = useLocation()
  const routeKey = `${location.pathname}${location.search}`
  const route = useMemo(() => resolveRecordedWatchRoute(location.search), [location.search])
  // route.value.videoFileId is always a finite integer once route.ok is true (see
  // RecordedDirectWatchRoute).
  const mediaSource = route.ok
    ? buildPlaybackMediaSource({
        route: route.value,
        isHalfWidth: isHalfWidthDisplayed,
      })
    : null
  const infoQuery = useRecordedWatchInfo({
    route,
    isHalfWidthDisplayed,
    apiRepository,
    onSnackbar,
  })
  const recordedFileType = route.ok
    ? resolveRecordedPlaybackFileType({
        item: infoQuery.data,
        videoFileId: route.value.videoFileId,
      })
    : 'unknown'
  const hasLegacyInvalidRecordedId =
    route.ok && route.value.recordedId !== null && !Number.isFinite(route.value.recordedId)
  const shouldHoldDirectMediaUntilFileTypeResolves =
    route.ok &&
    route.value.shouldRenderInfoCard &&
    !hasLegacyInvalidRecordedId &&
    infoQuery.isPending &&
    recordedFileType === 'unknown'
  const isMobilePlatform = useMemo(() => detectMobilePlatform(), [])
  const shouldStartWithNarrowControlsHidden = (viewportWidth ?? 1440) <= 420 && !isMobilePlatform
  const didWatchInfoFetchFail =
    route.ok &&
    route.value.shouldRenderInfoCard &&
    !hasLegacyInvalidRecordedId &&
    infoQuery.data === null
  const isWatchInfoReady =
    !route.ok ||
    !route.value.shouldRenderInfoCard ||
    hasLegacyInvalidRecordedId ||
    !infoQuery.isPending
  useScrollHistoryPageReady(isWatchInfoReady, routeKey)

  return (
    <PlaybackRouteShell
      isNavigationOpen={isNavigationOpen}
      onNavigationClick={onNavigationClick}
      title={title}
    >
      {!route.ok ? (
        // resolveRecordedWatchRoute() never returns the pending-config variant of
        // PlaybackRouteResult (unlike the streaming route below), so route.message is
        // always a string here.
        <PlaybackControlledError message={route.message} />
      ) : (
        <>
          <PlaybackPlayerContainer
            areControlsSuppressed={didWatchInfoFetchFail && !shouldStartWithNarrowControlsHidden}
            hideControlsUntilCanPlay={recordedFileType === 'ts'}
            initialControlsVisible={
              recordedFileType !== 'ts' && !shouldStartWithNarrowControlsHidden
            }
            isInProgressRecording={infoQuery.data?.isRecording === true}
            isForceEnableSubtitleStroke={isForceEnableSubtitleStroke}
            kind={route.value.kind}
            mediaUrl={
              shouldHoldDirectMediaUntilFileTypeResolves ? undefined : mediaSource?.mediaUrl
            }
            onSnackbar={onSnackbar}
            readinessUrl={mediaSource?.readinessUrl}
            recordedFileType={recordedFileType}
            sourceKind={mediaSource?.sourceKind}
            streamStartUrl={mediaSource?.streamStartUrl}
            suppressCanPlayControlsVisible={
              shouldStartWithNarrowControlsHidden &&
              !hasLegacyInvalidRecordedId &&
              !didWatchInfoFetchFail
            }
            viewportWidth={viewportWidth}
          />
          {infoQuery.data === null || infoQuery.data === undefined ? undefined : (
            <RecordedWatchInfoCard item={infoQuery.data} />
          )}
        </>
      )}
    </PlaybackRouteShell>
  )
}

export function RecordedStreamingWatchPage({
  isNavigationOpen,
  onNavigationClick,
  title,
  isHalfWidthDisplayed,
  isForceEnableSubtitleStroke,
  viewportWidth,
  apiRepository,
  onSnackbar,
  streamConfig,
  isConfigLoaded,
}: RecordedStreamingWatchPageProps) {
  const location = useLocation()
  const params = useParams()
  const routeKey = `${location.pathname}${location.search}`
  const route = useMemo(
    () =>
      resolveRecordedStreamingWatchRoute({
        videoFileId: params.videoFileId,
        search: location.search,
        streamConfig,
        isConfigLoaded,
      }),
    [isConfigLoaded, location.search, params.videoFileId, streamConfig],
  )
  const mediaSource = route.ok
    ? buildPlaybackMediaSource({
        route: route.value,
        isHalfWidth: isHalfWidthDisplayed,
      })
    : null
  const infoQuery = useRecordedWatchInfo({
    route,
    isHalfWidthDisplayed,
    apiRepository,
    onSnackbar,
  })
  const durationQuery = useQuery({
    queryKey: [
      'video-playback',
      'recorded-streaming-duration',
      route.ok ? route.value.videoFileId : null,
    ],
    enabled: route.ok && apiRepository.fetchVideoDuration !== undefined,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!route.ok || apiRepository.fetchVideoDuration === undefined) {
        return null
      }

      const result = await apiRepository.fetchVideoDuration(route.value.videoFileId)
      if (!result.ok) {
        onSnackbar({ text: '動画長の取得に失敗', severity: 'error' })
        return null
      }

      return result.value
    },
  })
  const didWatchInfoFetchFail =
    route.ok && route.value.shouldRenderInfoCard && infoQuery.data === null
  const isWatchInfoReady = !route.ok || !route.value.shouldRenderInfoCard || !infoQuery.isPending
  useScrollHistoryPageReady(!route.ok || (isWatchInfoReady && !durationQuery.isFetching), routeKey)

  return (
    <PlaybackRouteShell
      isNavigationOpen={isNavigationOpen}
      onNavigationClick={onNavigationClick}
      title={title}
    >
      {!route.ok && route.message === null ? (
        <PlaybackPendingState />
      ) : !route.ok ? (
        <PlaybackControlledError message={route.message} />
      ) : (
        <>
          <PlaybackPlayerContainer
            areControlsSuppressed={didWatchInfoFetchFail}
            isInProgressRecording={infoQuery.data?.isRecording === true}
            isForceEnableSubtitleStroke={isForceEnableSubtitleStroke}
            kind={route.value.kind}
            mediaUrl={mediaSource?.mediaUrl}
            onSnackbar={onSnackbar}
            readinessUrl={mediaSource?.readinessUrl}
            recordedStreamDuration={durationQuery.data ?? undefined}
            sourceKind={mediaSource?.sourceKind}
            streamingType={route.value.streamingType}
            streamStartUrl={mediaSource?.streamStartUrl}
            viewportWidth={viewportWidth}
          />
          {infoQuery.data === null || infoQuery.data === undefined ? undefined : (
            <RecordedWatchInfoCard item={infoQuery.data} />
          )}
        </>
      )}
    </PlaybackRouteShell>
  )
}
