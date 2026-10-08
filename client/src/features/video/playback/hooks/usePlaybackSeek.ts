import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { useCallback, useRef, useState } from 'react'
import { rebuildDirectStreamUrlForSeek } from '../playbackLifecycle'
import { clampPlaybackSeek } from '../playbackControls'
import { readSeekSeconds } from '../lib/playbackShellSupport'

export interface ResumeAfterRestart {
  playbackRate: number
  wasPaused: boolean
}

export interface PlaybackSeekInput {
  kind: string
  videoRef: MutableRefObject<HTMLVideoElement | null>
  isPausedRef: MutableRefObject<boolean>
  resumeAfterRestartRef: MutableRefObject<ResumeAfterRestart | null>
  currentTime: number
  setCurrentTime: Dispatch<SetStateAction<number>>
  duration: number
  effectiveDuration: number
  canSeek: boolean
  activeBaseSeekSeconds: number
  activePlaybackStartUrl: string | undefined
  restartPlaybackAt: (nextUrl: string) => void
}

export function usePlaybackSeek({
  kind,
  videoRef,
  isPausedRef,
  resumeAfterRestartRef,
  currentTime,
  setCurrentTime,
  duration,
  effectiveDuration,
  canSeek,
  activeBaseSeekSeconds,
  activePlaybackStartUrl,
  restartPlaybackAt,
}: PlaybackSeekInput) {
  const [pendingSeekTime, setPendingSeekTime] = useState<number | null>(null)
  const pendingSeekTimeRef = useRef<number | null>(null)
  const rangeSeekElementRef = useRef<HTMLInputElement | null>(null)

  const seekToPlaybackTime = useCallback(
    (nextTime: number) => {
      const video = videoRef.current
      const normalizedTime = Number.isFinite(nextTime) && nextTime > 0 ? nextTime : 0
      if (video === null) {
        setCurrentTime(normalizedTime)
        return
      }

      if (kind !== 'recorded-streaming') {
        video.currentTime = normalizedTime
        setCurrentTime(normalizedTime)
        return
      }

      const segmentDuration =
        Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration
      const relativeTime = normalizedTime - activeBaseSeekSeconds
      if (relativeTime >= 0 && relativeTime <= segmentDuration) {
        video.currentTime = relativeTime
        setCurrentTime(normalizedTime)
        return
      }

      if (activePlaybackStartUrl === undefined) {
        setCurrentTime(normalizedTime)
        return
      }

      resumeAfterRestartRef.current = {
        playbackRate: video.playbackRate,
        wasPaused: isPausedRef.current,
      }

      restartPlaybackAt(
        rebuildDirectStreamUrlForSeek(
          activePlaybackStartUrl,
          Math.max(0, Math.floor(normalizedTime)),
        ),
      )
      setCurrentTime(normalizedTime)
    },
    [
      activeBaseSeekSeconds,
      activePlaybackStartUrl,
      duration,
      isPausedRef,
      kind,
      restartPlaybackAt,
      resumeAfterRestartRef,
      setCurrentTime,
      videoRef,
    ],
  )

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const video = videoRef.current
      if (video === null || !canSeek) {
        return
      }
      const nextTime = clampPlaybackSeek({
        currentTime,
        deltaSeconds,
        duration: effectiveDuration,
      })
      seekToPlaybackTime(nextTime)
      setCurrentTime(nextTime)
    },
    [canSeek, currentTime, effectiveDuration, seekToPlaybackTime, setCurrentTime, videoRef],
  )

  const clearPendingSeek = useCallback(() => {
    pendingSeekTimeRef.current = null
    if (rangeSeekElementRef.current !== null) {
      delete rangeSeekElementRef.current.dataset.pendingSeekTime
    }
    setPendingSeekTime(null)
  }, [])

  const commitSeekBarTime = useCallback(
    (nextTime: number | null = pendingSeekTimeRef.current) => {
      if (nextTime === null && rangeSeekElementRef.current !== null) {
        const elementValue = Number(
          rangeSeekElementRef.current.dataset.pendingSeekTime ?? rangeSeekElementRef.current.value,
        )
        nextTime = Number.isFinite(elementValue) ? elementValue : null
      }
      if (nextTime === null) {
        return
      }
      seekToPlaybackTime(nextTime)
      clearPendingSeek()
    },
    [clearPendingSeek, seekToPlaybackTime],
  )

  const previewSeekBarTime = useCallback(
    (nextTime: number) => {
      if (Number.isFinite(nextTime)) {
        pendingSeekTimeRef.current = nextTime
        if (rangeSeekElementRef.current !== null) {
          rangeSeekElementRef.current.dataset.pendingSeekTime = String(nextTime)
        }
        setPendingSeekTime(nextTime)
        setCurrentTime(nextTime)
        return
      }
      clearPendingSeek()
      setCurrentTime(0)
    },
    [clearPendingSeek, setCurrentTime],
  )

  const handleSeeking = () => {
    const video = videoRef.current
    if (video === null || !Number.isFinite(video.duration) || video.duration <= 0) {
      return
    }

    const currentStartUrl = activePlaybackStartUrl
    if (currentStartUrl === undefined) {
      return
    }

    const baseSeekSeconds = readSeekSeconds(currentStartUrl)
    if (video.currentTime >= 0 && video.currentTime <= video.duration) {
      return
    }

    const nextSeekSeconds = Math.max(0, Math.floor(baseSeekSeconds + video.currentTime))
    resumeAfterRestartRef.current = {
      playbackRate: video.playbackRate,
      wasPaused: isPausedRef.current,
    }

    restartPlaybackAt(rebuildDirectStreamUrlForSeek(currentStartUrl, nextSeekSeconds))
  }

  const handleTimeUpdate = () => {
    const video = videoRef.current
    if (video === null) {
      return
    }
    if (pendingSeekTime !== null) {
      return
    }
    const relativeTime =
      Number.isFinite(video.currentTime) && video.currentTime > 0 ? video.currentTime : 0
    setCurrentTime(
      kind === 'recorded-streaming' ? activeBaseSeekSeconds + relativeTime : relativeTime,
    )
  }

  return {
    pendingSeekTime,
    rangeSeekElementRef,
    seekBy,
    commitSeekBarTime,
    previewSeekBarTime,
    clearPendingSeek,
    handleSeeking,
    handleTimeUpdate,
  }
}
