import type { MutableRefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HlsLifecycleState } from '../playbackLifecycle'
import type { ResumeAfterRestart } from './usePlaybackSeek'

export interface PlaybackMediaElementInput {
  kind: string
  videoRef: MutableRefObject<HTMLVideoElement | null>
  isInProgressRecording: boolean
  hideControlsUntilCanPlay: boolean
  effectiveMediaUrl: string | undefined
  lifecycleState: HlsLifecycleState
  recordedStreamDuration?: number
}

export function usePlaybackMediaElement({
  kind,
  videoRef,
  isInProgressRecording,
  hideControlsUntilCanPlay,
  effectiveMediaUrl,
  lifecycleState,
  recordedStreamDuration,
}: PlaybackMediaElementInput) {
  const resumeAfterRestartRef = useRef<ResumeAfterRestart | null>(null)
  const [isPaused, setIsPaused] = useState(true)
  const isPausedRef = useRef(isPaused)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isMediaElementLoading, setIsMediaElementLoading] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [hasMediaReachedCanPlay, setHasMediaReachedCanPlay] = useState(false)
  const [syntheticTimeupdateCount, setSyntheticTimeupdateCount] = useState(0)
  const recordedStreamingDuration =
    recordedStreamDuration !== undefined &&
    Number.isFinite(recordedStreamDuration) &&
    recordedStreamDuration > 0
      ? recordedStreamDuration +
        (kind === 'recorded-streaming' && isInProgressRecording ? syntheticTimeupdateCount : 0)
      : undefined
  const effectiveDuration =
    kind === 'recorded-streaming' && recordedStreamingDuration !== undefined
      ? recordedStreamingDuration
      : duration
  const shouldTrackMediaElementLoading =
    lifecycleState === 'ready' && effectiveMediaUrl !== undefined
  const areControlsWaitingForCanPlay = hideControlsUntilCanPlay && !hasMediaReachedCanPlay

  // Only called from togglePlay() below, always after it has already confirmed
  // videoRef.current is non-null -- there is no await in between, so this can never
  // run with a null video.
  const playVideo = useCallback(() => {
    const video = videoRef.current as HTMLVideoElement

    void video.play().catch((error: unknown) => {
      console.warn('video.play() failed', error)
    })
  }, [videoRef])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (video === null) {
      return
    }
    if (isPaused) {
      playVideo()
      return
    }
    video.pause()
  }, [isPaused, playVideo, videoRef])

  const markPlaying = useCallback(() => {
    isPausedRef.current = false
    setIsPaused(false)
  }, [])

  const setVideoPlaybackRate = useCallback(
    (nextRate: number) => {
      // 0.1x to 10x. v2 `components/video/VideoContainer.vue:684-690` の `changePlaybackRate` は
      // 0.1 未満を clamp せず拒否し、上限を持たない。上限に引き継ぐ v2 の値が無いため 10x とする。
      const normalized = Math.round(Math.min(10, Math.max(0.1, nextRate)) * 10) / 10
      const video = videoRef.current
      if (video !== null) {
        video.playbackRate = normalized
      }
      setPlaybackRate(normalized)
    },
    [videoRef],
  )

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    const nextMuted = !muted
    if (video !== null) {
      video.muted = nextMuted
    }
    setMuted(nextMuted)
  }, [muted, videoRef])

  const setVolumeFromInput = (nextVolume: number) => {
    const video = videoRef.current
    if (video !== null && Number.isFinite(nextVolume)) {
      video.volume = nextVolume
      video.muted = false
    }
    setVolume(Number.isFinite(nextVolume) ? nextVolume : 0)
    setMuted(false)
  }

  const handleDurationChange = () => {
    const video = videoRef.current
    if (video === null) {
      return
    }
    const nextDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
    setDuration(nextDuration)
  }

  const handleVolumeChange = () => {
    const video = videoRef.current
    if (video === null) {
      return
    }
    setVolume(video.volume)
    setMuted(video.muted)
  }

  useEffect(() => {
    const video = videoRef.current
    const resume = resumeAfterRestartRef.current
    if (video === null || resume === null || effectiveMediaUrl === undefined) {
      return
    }

    video.playbackRate = resume.playbackRate
    resumeAfterRestartRef.current = null
    if (!resume.wasPaused) {
      void video.play().catch(() => undefined)
    }
  }, [effectiveMediaUrl, videoRef])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- media loading mirrors the current resolved media URL readiness
    setIsMediaElementLoading(shouldTrackMediaElementLoading)
  }, [shouldTrackMediaElementLoading])

  useEffect(() => {
    if (areControlsWaitingForCanPlay && shouldTrackMediaElementLoading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the legacy canplay gate in loading state
      setIsMediaElementLoading(true)
    }
  }, [areControlsWaitingForCanPlay, shouldTrackMediaElementLoading])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- new media URL must reset canplay gating
    setHasMediaReachedCanPlay(false)
  }, [effectiveMediaUrl])

  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  useEffect(() => {
    if (kind !== 'recorded-streaming' || !isInProgressRecording) {
      return
    }

    const timerId = setInterval(() => {
      videoRef.current?.dispatchEvent(new Event('timeupdate', { bubbles: true }))
      setSyntheticTimeupdateCount((current) => current + 1)
    }, 1000)

    return () => {
      clearInterval(timerId)
    }
  }, [isInProgressRecording, kind, videoRef])

  return {
    resumeAfterRestartRef,
    isPaused,
    setIsPaused,
    isPausedRef,
    currentTime,
    setCurrentTime,
    duration,
    effectiveDuration,
    isMediaElementLoading,
    setIsMediaElementLoading,
    playbackRate,
    volume,
    muted,
    setHasMediaReachedCanPlay,
    areControlsWaitingForCanPlay,
    syntheticTimeupdateCount,
    togglePlay,
    markPlaying,
    setVideoPlaybackRate,
    toggleMute,
    setVolumeFromInput,
    handleDurationChange,
    handleVolumeChange,
  }
}
