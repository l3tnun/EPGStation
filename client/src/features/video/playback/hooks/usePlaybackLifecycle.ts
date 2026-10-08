import { useCallback, useEffect, useMemo, useState } from 'react'
import Hls from 'hls.js'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { PlaybackStreamingType, RecordedStreamingFileType } from '../playbackRoutes'
import {
  HLS_STOP_FAILURE_SNACKBAR,
  HlsLifecycleController,
  createFetchHlsLifecycleRepository,
  detectM2tsLlSupport,
  resolveM2tsLlPlaybackReadiness,
  resolvePlaybackLifecycleMode,
  type HlsLifecycleSnapshot,
  type PlaybackLifecycleMode,
} from '../playbackLifecycle'
import { readSeekSeconds } from '../lib/playbackShellSupport'

export interface PlaybackLifecycleInput {
  /**
   * Not read by this hook: resolveRecordedDirectPlaybackReadiness() was the
   * only reader of `kind === 'recorded-direct'` and it always resolves ready
   * now (design.md:362-365, requirements.md 要求3 AC 3.4), so the branch was
   * removed. Kept in the input shape because PlaybackPlayerContainerProps
   * already threads it here (and separately into usePlaybackMediaElement);
   * drop it from this shape only if it stays unneeded.
   */
  kind: string
  sourceKind?: string
  streamingType?: PlaybackStreamingType
  /**
   * Not read by this hook: resolveRecordedDirectPlaybackReadiness() does not
   * vary by file type (design.md:362-365, requirements.md 要求3 AC 3.4).
   * Kept in the input shape because PlaybackPlayerContainerProps already
   * threads it here from RecordedWatchPages.tsx; drop it from both places
   * together if it stays unneeded.
   */
  recordedFileType: RecordedStreamingFileType | 'unknown'
  mediaUrl?: string
  streamStartUrl?: string
  readinessUrl?: string
  hasMountedVideoElement: boolean | null
  onSnackbar?: (snackbar: ShellSnackbarState) => void
}

export interface PlaybackLifecycleState {
  lifecycleMode: PlaybackLifecycleMode
  lifecycleSnapshot: HlsLifecycleSnapshot
  effectiveMediaUrl: string | undefined
  directMediaUrl: string | undefined
  activeHlsStartUrl: string | undefined
  activePlaybackStartUrl: string | undefined
  activeBaseSeekSeconds: number
  usesHlsJsMediaSource: boolean
  usesMpegtsMediaSource: boolean
  videoElementSrc: string | undefined
  /** Restart playback from a rebuilt start URL (seek outside the current segment). */
  restartPlaybackAt: (nextUrl: string) => void
}

const IDLE_SNAPSHOT: HlsLifecycleSnapshot = {
  state: 'idle',
  streamId: null,
  errorMessage: null,
  snackbarText: null,
}

function errorSnapshot(message: string | null): HlsLifecycleSnapshot {
  return { state: 'error', streamId: null, errorMessage: message, snackbarText: message }
}

export function usePlaybackLifecycle({
  sourceKind,
  streamingType,
  mediaUrl,
  streamStartUrl,
  readinessUrl,
  hasMountedVideoElement,
  onSnackbar,
}: PlaybackLifecycleInput): PlaybackLifecycleState {
  const [directMediaState, setDirectMediaState] = useState(() => ({
    baseUrl: mediaUrl,
    currentUrl: mediaUrl,
  }))
  const [hlsStartState, setHlsStartState] = useState(() => ({
    baseUrl: streamStartUrl,
    currentUrl: streamStartUrl,
  }))
  const directMediaUrl =
    directMediaState.baseUrl === mediaUrl ? directMediaState.currentUrl : mediaUrl
  const activeHlsStartUrl =
    hlsStartState.baseUrl === streamStartUrl ? hlsStartState.currentUrl : streamStartUrl
  const lifecycleMode = resolvePlaybackLifecycleMode({
    sourceKind:
      sourceKind === 'direct-video' || sourceKind === 'direct-stream' ? sourceKind : 'hls-stream',
    streamingType,
  })
  const activePlaybackStartUrl = lifecycleMode === 'hls-api' ? activeHlsStartUrl : directMediaUrl
  const activeBaseSeekSeconds =
    activePlaybackStartUrl === undefined ? 0 : readSeekSeconds(activePlaybackStartUrl)
  const [hlsLifecycleSnapshot, setHlsLifecycleSnapshot] = useState<HlsLifecycleSnapshot>(
    () => IDLE_SNAPSHOT,
  )
  const staticLifecycleSnapshot = useMemo<HlsLifecycleSnapshot>(() => {
    if (lifecycleMode === 'hls-api') {
      if (streamStartUrl !== undefined && readinessUrl !== undefined) {
        return { ...IDLE_SNAPSHOT }
      }

      return errorSnapshot('ストリーム開始に失敗')
    }

    if (streamingType === 'm2tsll') {
      if (hasMountedVideoElement === null) {
        return { ...IDLE_SNAPSHOT }
      }
      const readiness = resolveM2tsLlPlaybackReadiness({
        capability: { isSupported: detectM2tsLlSupport },
        hasVideoElement: hasMountedVideoElement,
      })
      if (!readiness.ready) {
        return errorSnapshot(readiness.message)
      }
    }

    return { state: 'ready', streamId: null, errorMessage: null, snackbarText: null }
  }, [hasMountedVideoElement, lifecycleMode, readinessUrl, streamStartUrl, streamingType])
  const hlsRepository = useMemo(() => {
    if (
      lifecycleMode !== 'hls-api' ||
      activeHlsStartUrl === undefined ||
      readinessUrl === undefined
    ) {
      return null
    }

    return createFetchHlsLifecycleRepository({ streamStartUrl: activeHlsStartUrl, readinessUrl })
  }, [activeHlsStartUrl, lifecycleMode, readinessUrl])

  useEffect(() => {
    if (lifecycleMode !== 'hls-api') {
      return
    }
    if (hlsRepository === null) {
      return
    }

    const controller = new HlsLifecycleController({
      repository: hlsRepository,
      retryDelayMs: 500,
      startRetryCount: 1,
      onChange: setHlsLifecycleSnapshot,
    })

    void controller.start()

    return () => {
      controller.cleanup({
        emit: false,
        onStopFailure: () => {
          onSnackbar?.({ text: HLS_STOP_FAILURE_SNACKBAR, severity: 'error' })
        },
      })
    }
  }, [hlsRepository, lifecycleMode, onSnackbar])

  const lifecycleSnapshot =
    lifecycleMode === 'hls-api' && hlsRepository !== null
      ? hlsLifecycleSnapshot
      : staticLifecycleSnapshot
  const resolvedMediaUrl =
    lifecycleMode === 'hls-api' ? lifecycleSnapshot.playlistUrl : directMediaUrl
  const effectiveMediaUrl = lifecycleSnapshot.state === 'error' ? undefined : resolvedMediaUrl
  const usesHlsJsMediaSource =
    lifecycleMode === 'hls-api' && effectiveMediaUrl !== undefined && Hls.isSupported()
  const usesMpegtsMediaSource =
    lifecycleMode === 'direct-response' &&
    streamingType === 'm2tsll' &&
    effectiveMediaUrl !== undefined &&
    detectM2tsLlSupport()
  const videoElementSrc =
    usesHlsJsMediaSource || usesMpegtsMediaSource ? undefined : effectiveMediaUrl

  useEffect(() => {
    if (lifecycleSnapshot.snackbarText !== null) {
      onSnackbar?.({ text: lifecycleSnapshot.snackbarText, severity: 'error' })
    }
  }, [lifecycleSnapshot.snackbarText, onSnackbar])

  const restartPlaybackAt = useCallback(
    (nextUrl: string) => {
      if (lifecycleMode === 'hls-api') {
        setHlsStartState({ baseUrl: streamStartUrl, currentUrl: nextUrl })
        return
      }
      if (lifecycleMode === 'direct-response') {
        setDirectMediaState({ baseUrl: mediaUrl, currentUrl: nextUrl })
      }
    },
    [lifecycleMode, mediaUrl, streamStartUrl],
  )

  return {
    lifecycleMode,
    lifecycleSnapshot,
    effectiveMediaUrl,
    directMediaUrl,
    activeHlsStartUrl,
    activePlaybackStartUrl,
    activeBaseSeekSeconds,
    usesHlsJsMediaSource,
    usesMpegtsMediaSource,
    videoElementSrc,
    restartPlaybackAt,
  }
}
