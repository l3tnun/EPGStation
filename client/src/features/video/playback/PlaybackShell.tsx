import { useCallback, useMemo, useRef, useState } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { PlaybackStreamingType, RecordedStreamingFileType } from './playbackRoutes'
import {
  resolvePlaybackControlVisibility,
  resolveVolumeControlIcon,
  resolveVolumeControlLabel,
} from './playbackControls'
import { resolveSubtitleRendererContract } from './playbackSettings'
import type { PlaybackSubtitleAdapter } from './playbackSubtitle'
import { detectMobilePlatform } from './platformDetection'
import { PlaybackControlsOverlay } from './components/PlaybackControlsOverlay'
import { PlaybackVideoElement } from './components/PlaybackVideoElement'
import { usePlaybackControlsVisibility } from './hooks/usePlaybackControlsVisibility'
import { usePlaybackFullscreen } from './hooks/usePlaybackFullscreen'
import { usePlaybackLifecycle } from './hooks/usePlaybackLifecycle'
import { usePlaybackMediaElement } from './hooks/usePlaybackMediaElement'
import { usePlaybackMediaSources } from './hooks/usePlaybackMediaSources'
import { usePlaybackSeek } from './hooks/usePlaybackSeek'
import { usePlaybackSubtitles } from './hooks/usePlaybackSubtitles'
import { usePlaybackVideoEvents } from './hooks/usePlaybackVideoEvents'
import { usePlaybackWaitingStatus } from './hooks/usePlaybackWaitingStatus'
import styles from './PlaybackPage.module.css'

export {
  PlaybackControlledError,
  PlaybackPendingState,
  PlaybackRouteShell,
  type PlaybackRouteShellProps,
} from './PlaybackRouteShell'

export interface PlaybackPlayerContainerProps {
  kind: string
  sourceKind?: string
  streamingType?: PlaybackStreamingType
  recordedFileType?: RecordedStreamingFileType | 'unknown'
  isInProgressRecording?: boolean
  mediaUrl?: string
  streamStartUrl?: string
  readinessUrl?: string
  recordedStreamDuration?: number
  onSnackbar?: (snackbar: ShellSnackbarState) => void
  isForceEnableSubtitleStroke?: boolean
  initialControlsVisible?: boolean
  areControlsSuppressed?: boolean
  hideControlsUntilCanPlay?: boolean
  suppressCanPlayControlsVisible?: boolean
  showLifecycleError?: boolean
  viewportWidth?: number
}

export function PlaybackPlayerContainer({
  kind,
  sourceKind,
  streamingType,
  recordedFileType = 'unknown',
  isInProgressRecording = false,
  mediaUrl,
  streamStartUrl,
  readinessUrl,
  recordedStreamDuration,
  onSnackbar,
  isForceEnableSubtitleStroke = true,
  initialControlsVisible = true,
  areControlsSuppressed = false,
  hideControlsUntilCanPlay = false,
  suppressCanPlayControlsVisible = false,
  showLifecycleError = true,
  viewportWidth = 1440,
}: PlaybackPlayerContainerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<HTMLElement | null>(null)
  const subtitleAdapterRef = useRef<PlaybackSubtitleAdapter | null>(null)
  const [hasMountedVideoElement, setHasMountedVideoElement] = useState<boolean | null>(null)
  const assignVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node
    setHasMountedVideoElement(node !== null)
  }, [])
  const lifecycle = usePlaybackLifecycle({
    kind,
    sourceKind,
    streamingType,
    recordedFileType,
    mediaUrl,
    streamStartUrl,
    readinessUrl,
    hasMountedVideoElement,
    onSnackbar,
  })
  const { lifecycleMode, lifecycleSnapshot, effectiveMediaUrl } = lifecycle
  const media = usePlaybackMediaElement({
    kind,
    videoRef,
    isInProgressRecording,
    hideControlsUntilCanPlay,
    effectiveMediaUrl,
    lifecycleState: lifecycleSnapshot.state,
    recordedStreamDuration,
  })
  const isSubtitleRendererMounted =
    sourceKind === 'hls-stream' || streamingType === 'hls' || streamingType === 'm2tsll'
  const isMobilePlatform = useMemo(() => detectMobilePlatform(), [])
  const fullscreen = usePlaybackFullscreen({ playerRef, videoRef, hasMountedVideoElement })
  const areControlsBlocked = areControlsSuppressed || media.areControlsWaitingForCanPlay
  const controls = usePlaybackControlsVisibility({
    initialControlsVisible,
    areControlsBlocked,
    isPaused: media.isPaused,
    isPausedRef: media.isPausedRef,
    isMobilePlatform,
  })
  usePlaybackMediaSources({
    videoRef,
    subtitleAdapterRef,
    effectiveMediaUrl,
    usesHlsJsMediaSource: lifecycle.usesHlsJsMediaSource,
    usesMpegtsMediaSource: lifecycle.usesMpegtsMediaSource,
  })
  const subtitles = usePlaybackSubtitles({
    videoRef,
    subtitleAdapterRef,
    effectiveMediaUrl,
    isForceEnableSubtitleStroke,
    isSubtitleRendererMounted,
    lifecycleMode,
    lifecycleState: lifecycleSnapshot.state,
  })
  const subtitleContract = useMemo(
    () =>
      resolveSubtitleRendererContract({
        sourceKind:
          sourceKind === 'direct-video' ||
          sourceKind === 'direct-stream' ||
          sourceKind === 'hls-stream'
            ? sourceKind
            : undefined,
        streamingType,
        isForceEnableSubtitleStroke,
        isShowSubtitle: subtitles.subtitleSetting.isShowSubtitle,
        hasSubtitleTrack: subtitles.subtitleAdapterState.available,
      }),
    [
      isForceEnableSubtitleStroke,
      sourceKind,
      subtitles.subtitleAdapterState.available,
      streamingType,
      subtitles.subtitleSetting.isShowSubtitle,
    ],
  )
  const controlVisibility = useMemo(
    () =>
      resolvePlaybackControlVisibility({
        duration: media.effectiveDuration,
        currentTime: media.currentTime,
        isLive: kind === 'live',
        viewportWidth,
        isMobilePlatform,
        canLockOrientation: fullscreen.canLockOrientation,
        isPictureInPictureEnabled: fullscreen.isPictureInPictureEnabled,
        hasSubtitleTrack: subtitleContract.hasSubtitleTrack,
      }),
    [
      fullscreen.canLockOrientation,
      fullscreen.isPictureInPictureEnabled,
      kind,
      media.currentTime,
      media.effectiveDuration,
      isMobilePlatform,
      subtitleContract.hasSubtitleTrack,
      viewportWidth,
    ],
  )
  const seek = usePlaybackSeek({
    kind,
    videoRef,
    isPausedRef: media.isPausedRef,
    resumeAfterRestartRef: media.resumeAfterRestartRef,
    currentTime: media.currentTime,
    setCurrentTime: media.setCurrentTime,
    duration: media.duration,
    effectiveDuration: media.effectiveDuration,
    canSeek: controlVisibility.canSeek,
    activeBaseSeekSeconds: lifecycle.activeBaseSeekSeconds,
    activePlaybackStartUrl: lifecycle.activePlaybackStartUrl,
    restartPlaybackAt: lifecycle.restartPlaybackAt,
  })
  const volumeLabel = resolveVolumeControlLabel({ volume: media.volume, muted: media.muted })
  const volumeIcon = resolveVolumeControlIcon({ volume: media.volume, muted: media.muted })
  const isLoading =
    lifecycleSnapshot.state === 'idle' ||
    lifecycleSnapshot.state === 'starting' ||
    lifecycleSnapshot.state === 'waiting'
  const isPlayerLoading = isLoading || media.isMediaElementLoading
  const waitingElapsedSeconds = usePlaybackWaitingStatus(lifecycleSnapshot.state)
  const { videoEvents, handleKeyDown } = usePlaybackVideoEvents({
    media,
    controls,
    subtitles,
    seek,
    fullscreen,
    areControlsBlocked,
    areControlsSuppressed,
    suppressCanPlayControlsVisible,
    shouldClearLoadingOnPlaybackEvent: streamingType !== 'm2tsll',
  })

  return (
    <section
      aria-label="プレイヤー"
      className={styles.playerContainer}
      data-controls-visible={String(controls.controlsVisible && !areControlsBlocked)}
      data-cursor-hidden={String(controls.isCursorHidden)}
      data-fullscreen-fallback={String(fullscreen.isFullscreenFallback)}
      data-fullscreen-state={fullscreen.isFullscreen ? 'fullscreen' : 'inline'}
      data-playback-kind={kind}
      data-playback-lifecycle-mode={lifecycleMode}
      data-playback-lifecycle-state={lifecycleSnapshot.state}
      data-playback-media-url={effectiveMediaUrl}
      data-playback-playlist-url={lifecycleSnapshot.playlistUrl}
      data-playback-readiness-url={readinessUrl}
      data-recorded-stream-duration={
        recordedStreamDuration === undefined ? undefined : String(recordedStreamDuration)
      }
      data-playback-source-kind={sourceKind}
      data-playback-stream-id={lifecycleSnapshot.streamId}
      data-playback-stream-start-url={lifecycle.activeHlsStartUrl}
      data-playback-synthetic-timeupdates={media.syntheticTimeupdateCount}
      data-subtitle-adapter-kind={subtitles.subtitleAdapterState.kind}
      data-subtitle-renderer-kind={subtitleContract.rendererKind}
      data-subtitle-renderer-mounted={String(subtitleContract.rendererMounted)}
      data-subtitle-stroke-enabled={String(subtitleContract.strokeEnabled)}
      data-subtitle-visible={String(subtitleContract.isShowSubtitle)}
      data-testid="video-player-container"
      onKeyDown={handleKeyDown}
      onMouseLeave={controls.handleMouseLeave}
      onMouseMove={controls.handleMouseMove}
      onPointerDown={controls.handlePointerDown}
      onPointerMove={controls.handlePointerMove}
      ref={playerRef}
      tabIndex={0}
    >
      <PlaybackVideoElement
        assignVideoRef={assignVideoRef}
        src={lifecycle.videoElementSrc}
        {...videoEvents}
      />
      {isPlayerLoading ? (
        <div
          aria-label="読み込み中"
          className={styles.loadingIndicator}
          data-testid="playback-loading-indicator"
        />
      ) : undefined}
      {isPlayerLoading ? (
        <div
          aria-hidden="true"
          className={styles.legacyLoadingSpinner}
          data-testid="playback-legacy-loading-spinner"
        />
      ) : undefined}
      {lifecycleSnapshot.state === 'waiting' ? (
        <div
          aria-live="polite"
          className={styles.waitingStatus}
          data-testid="playback-waiting-status"
        >
          {`配信準備中… (${waitingElapsedSeconds}秒)`}
        </div>
      ) : undefined}
      {!showLifecycleError || lifecycleSnapshot.errorMessage === null ? undefined : (
        <div className={styles.lifecycleError} data-testid="playback-lifecycle-error">
          {lifecycleSnapshot.errorMessage}
        </div>
      )}
      {controls.controlsVisible && !isPlayerLoading && !areControlsBlocked ? (
        <PlaybackControlsOverlay
          controlVisibility={controlVisibility}
          subtitleContract={subtitleContract}
          isFullscreen={fullscreen.isFullscreen}
          isPaused={media.isPaused}
          playbackRate={media.playbackRate}
          volume={media.volume}
          volumeLabel={volumeLabel}
          volumeIcon={volumeIcon}
          effectiveDuration={media.effectiveDuration}
          currentTime={media.currentTime}
          pendingSeekTime={seek.pendingSeekTime}
          rangeSeekElementRef={seek.rangeSeekElementRef}
          onRotateScreen={fullscreen.rotateScreen}
          onSeekBy={seek.seekBy}
          onTogglePlay={media.togglePlay}
          onSetPlaybackRate={media.setVideoPlaybackRate}
          onPreviewSeekBarTime={seek.previewSeekBarTime}
          onCommitSeekBarTime={seek.commitSeekBarTime}
          onCancelSeekBarPreview={seek.clearPendingSeek}
          onToggleMute={media.toggleMute}
          onVolumeInput={media.setVolumeFromInput}
          onToggleSubtitle={subtitles.toggleSubtitle}
          onEnterPictureInPicture={fullscreen.enterPictureInPicture}
          onToggleFullscreen={fullscreen.toggleFullscreen}
        />
      ) : undefined}
    </section>
  )
}
