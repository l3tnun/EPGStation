import type { MutableRefObject, PointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isInteractiveShortcutTarget } from '../lib/playbackShellSupport'

export interface PlaybackControlsVisibilityInput {
  initialControlsVisible: boolean
  areControlsBlocked: boolean
  isPaused: boolean
  isPausedRef: MutableRefObject<boolean>
  isMobilePlatform: boolean
}

export function usePlaybackControlsVisibility({
  initialControlsVisible,
  areControlsBlocked,
  isPaused,
  isPausedRef,
  isMobilePlatform,
}: PlaybackControlsVisibilityInput) {
  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [controlsVisible, setControlsVisible] = useState(initialControlsVisible)
  const [isCursorHidden, setIsCursorHidden] = useState(false)

  const clearControlsHideTimer = useCallback(() => {
    if (controlsHideTimerRef.current !== undefined) {
      clearTimeout(controlsHideTimerRef.current)
      controlsHideTimerRef.current = undefined
    }
  }, [])

  const scheduleControlsHide = useCallback(
    (options?: { force?: boolean }) => {
      clearControlsHideTimer()
      if (areControlsBlocked) {
        return
      }
      if (options?.force !== true && isPaused) {
        return
      }
      controlsHideTimerRef.current = setTimeout(() => {
        if (isPausedRef.current) {
          return
        }
        setControlsVisible(false)
        setIsCursorHidden(true)
      }, 3000)
    },
    [areControlsBlocked, clearControlsHideTimer, isPaused, isPausedRef],
  )

  useEffect(() => clearControlsHideTimer, [clearControlsHideTimer])

  useEffect(() => {
    if (!areControlsBlocked) {
      return
    }
    clearControlsHideTimer()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize derived control visibility after block state changes
    setControlsVisible(false)
    setIsCursorHidden(false)
  }, [areControlsBlocked, clearControlsHideTimer])

  const revealControls = () => {
    if (areControlsBlocked) {
      return
    }
    if (isMobilePlatform) {
      return
    }
    setControlsVisible(true)
    setIsCursorHidden(false)
    scheduleControlsHide()
  }

  const handleMouseMove = () => {
    revealControls()
  }

  const handlePointerMove = () => {
    revealControls()
  }

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (areControlsBlocked) {
      return
    }

    if (event.target !== event.currentTarget && isInteractiveShortcutTarget(event.target)) {
      return
    }

    if (isMobilePlatform) {
      const nextVisible = !controlsVisible
      setControlsVisible(nextVisible)
      setIsCursorHidden(!nextVisible && !isPaused)
      return
    }

    handlePointerMove()
  }

  const handleMouseLeave = () => {
    if (isMobilePlatform) {
      return
    }
    if (!isPaused) {
      setControlsVisible(false)
      setIsCursorHidden(true)
    }
  }

  return {
    controlsVisible,
    isCursorHidden,
    setControlsVisible,
    setIsCursorHidden,
    clearControlsHideTimer,
    scheduleControlsHide,
    handleMouseMove,
    handlePointerMove,
    handlePointerDown,
    handleMouseLeave,
  }
}
