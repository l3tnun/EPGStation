import type { MutableRefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlaybackLifecycleMode, HlsLifecycleState } from '../playbackLifecycle'
import { readVideoPlayerSetting, saveVideoPlayerSetting } from '../playbackSettings'
import { createPlaybackSubtitleAdapter, type PlaybackSubtitleAdapter } from '../playbackSubtitle'
import { getVideoPlayerStorage } from '../lib/playbackShellSupport'

export interface SubtitleAdapterState {
  available: boolean
  kind: PlaybackSubtitleAdapter['kind'] | 'none'
}

export interface PlaybackSubtitlesInput {
  videoRef: MutableRefObject<HTMLVideoElement | null>
  subtitleAdapterRef: MutableRefObject<PlaybackSubtitleAdapter | null>
  effectiveMediaUrl: string | undefined
  isForceEnableSubtitleStroke: boolean
  isSubtitleRendererMounted: boolean
  lifecycleMode: PlaybackLifecycleMode
  lifecycleState: HlsLifecycleState
}

export function usePlaybackSubtitles({
  videoRef,
  subtitleAdapterRef,
  effectiveMediaUrl,
  isForceEnableSubtitleStroke,
  isSubtitleRendererMounted,
  lifecycleMode,
  lifecycleState,
}: PlaybackSubtitlesInput) {
  const [subtitleSetting, setSubtitleSetting] = useState(() =>
    readVideoPlayerSetting(getVideoPlayerStorage()),
  )
  const subtitleSettingRef = useRef(subtitleSetting)
  const [subtitleAdapterState, setSubtitleAdapterState] = useState<SubtitleAdapterState>({
    available: false,
    kind: 'none',
  })

  const toggleSubtitle = useCallback(() => {
    setSubtitleSetting((current) => {
      const next = { isShowSubtitle: !current.isShowSubtitle }
      saveVideoPlayerSetting(getVideoPlayerStorage(), next)
      subtitleAdapterRef.current?.setVisible(next.isShowSubtitle)
      return next
    })
  }, [subtitleAdapterRef])

  useEffect(() => {
    subtitleSettingRef.current = subtitleSetting
    subtitleAdapterRef.current?.setVisible(subtitleSetting.isShowSubtitle)
  }, [subtitleAdapterRef, subtitleSetting])

  const updateSubtitleTrackAvailability = useCallback(() => {
    const video = videoRef.current
    if (video === null) {
      setSubtitleAdapterState({ available: false, kind: 'none' })
      return
    }
    if (subtitleAdapterRef.current?.kind === 'native-text-track') {
      setSubtitleAdapterState({
        available: video.textTracks.length > 0,
        kind: video.textTracks.length > 0 ? 'native-text-track' : 'none',
      })
    }
  }, [subtitleAdapterRef, videoRef])

  useEffect(() => {
    updateSubtitleTrackAvailability()
  }, [updateSubtitleTrackAvailability])

  useEffect(() => {
    const video = videoRef.current
    const canMountSubtitleAdapter = video !== null && lifecycleState !== 'error'

    const disposeCurrentAdapter = () => {
      subtitleAdapterRef.current?.dispose()
      subtitleAdapterRef.current = null
      setSubtitleAdapterState({ available: false, kind: 'none' })
    }

    // createPlaybackSubtitleAdapter() is a plain synchronous call, so this whole
    // function always runs to completion before the effect's own cleanup below (which
    // is the only thing that could invalidate its result) can ever execute -- there is
    // no async gap for a "this install is now stale" state to observably matter.
    const installSubtitleAdapter = () => {
      if (!canMountSubtitleAdapter || video === null) {
        disposeCurrentAdapter()
        return
      }

      const currentAdapter = subtitleAdapterRef.current
      subtitleAdapterRef.current = null
      currentAdapter?.dispose()

      const adapter = createPlaybackSubtitleAdapter({
        video,
        rendererKind: isSubtitleRendererMounted ? 'aribb24' : 'none',
        strokeEnabled: isForceEnableSubtitleStroke,
        preferRenderer: isSubtitleRendererMounted,
      })

      subtitleAdapterRef.current = adapter
      setSubtitleAdapterState(
        adapter === null
          ? { available: false, kind: 'none' }
          : { available: true, kind: adapter.kind },
      )
      adapter?.setVisible(subtitleSettingRef.current.isShowSubtitle)
    }

    installSubtitleAdapter()

    const textTracks = video?.textTracks
    const handleTextTrackChange = () => {
      installSubtitleAdapter()
    }
    if (!isSubtitleRendererMounted && typeof textTracks?.addEventListener === 'function') {
      textTracks.addEventListener('addtrack', handleTextTrackChange)
      textTracks.addEventListener('change', handleTextTrackChange)
    }

    return () => {
      if (!isSubtitleRendererMounted && typeof textTracks?.removeEventListener === 'function') {
        textTracks.removeEventListener('addtrack', handleTextTrackChange)
        textTracks.removeEventListener('change', handleTextTrackChange)
      }
      disposeCurrentAdapter()
    }
  }, [
    effectiveMediaUrl,
    isForceEnableSubtitleStroke,
    isSubtitleRendererMounted,
    lifecycleMode,
    lifecycleState,
    subtitleAdapterRef,
    videoRef,
  ])

  return {
    subtitleSetting,
    subtitleAdapterState,
    toggleSubtitle,
    updateSubtitleTrackAvailability,
  }
}
