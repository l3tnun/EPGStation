import { useEffect, useState } from 'react'
import type { HlsLifecycleState } from '../playbackLifecycle'

const TICK_MS = 1000

/**
 * Elapsed time (in whole seconds) since the lifecycle most recently entered the "waiting"
 * state (streamId issued, HLS artifact not enabled yet). Resets to 0 whenever the state
 * transitions into or out of 'waiting'.
 *
 * This is display-only and intentionally kept out of HlsLifecycleSnapshot: it exists to give
 * the user a sense of progress while the readiness wait can legitimately run far longer than 30s.
 * It shows that the stream is being prepared, and the elapsed time.
 *
 * Counts in whole ticks (like usePlaybackMediaElement's synthetic timeupdate counter) rather
 * than diffing Date.now() against a stored start time, so the effect never calls setState with
 * anything but a functional update -- react-hooks/set-state-in-effect and react-hooks/purity
 * both reject synchronously computed values in an effect body.
 */
export function usePlaybackWaitingStatus(lifecycleState: HlsLifecycleState): number {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    if (lifecycleState !== 'waiting') {
      return
    }

    const timerId = setInterval(() => {
      setElapsedSeconds((current) => current + 1)
    }, TICK_MS)

    return () => {
      clearInterval(timerId)
      setElapsedSeconds(0)
    }
  }, [lifecycleState])

  return lifecycleState === 'waiting' ? elapsedSeconds : 0
}
