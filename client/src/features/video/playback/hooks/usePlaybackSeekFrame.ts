import type { MutableRefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HlsLifecycleState } from '../playbackLifecycle'

export function usePlaybackSeekFrame(
  videoRef: MutableRefObject<HTMLVideoElement | null>,
  lifecycleState: HlsLifecycleState,
  sourceKey: string,
  isPausedRef: MutableRefObject<boolean>,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const visibleRef = useRef(false)
  const pendingFrameRef = useRef<symbol | null>(null)
  const [visible, setVisible] = useState(false)

  const invalidateFrame = useCallback(() => {
    pendingFrameRef.current = null
  }, [])

  const clear = useCallback(() => {
    invalidateFrame()
    visibleRef.current = false
    setVisible(false)
  }, [invalidateFrame])

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an overlay belongs to the previous source
    clear()
    return invalidateFrame
  }, [clear, invalidateFrame, sourceKey])

  const capture = useCallback(() => {
    invalidateFrame()
    if (visibleRef.current) {
      return
    }
    const video = videoRef.current
    const canvas = canvasRef.current
    if (
      video === null ||
      canvas === null ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      return
    }

    try {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      if (context === null) {
        return
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      visibleRef.current = true
      setVisible(true)
    } catch {
      // A browser may refuse to copy a protected or cross-origin video frame.
    }
  }, [invalidateFrame, videoRef])

  const onSeeked = useCallback(() => {
    if (!visibleRef.current) return
    const video = videoRef.current
    if (video === null) return
    if (isPausedRef.current || typeof video.requestVideoFrameCallback !== 'function') {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        clear()
      }
      return
    }
    if (pendingFrameRef.current !== null) return

    const frame = Symbol()
    pendingFrameRef.current = frame
    video.requestVideoFrameCallback(() => {
      if (pendingFrameRef.current === frame) clear()
    })
  }, [clear, isPausedRef, videoRef])

  const onCanPlay = useCallback(() => {
    if (isPausedRef.current) onSeeked()
  }, [isPausedRef, onSeeked])

  useEffect(() => {
    if (lifecycleState === 'error') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- an error ends the seek overlay
      clear()
    }
  }, [clear, lifecycleState])

  return { canvasRef, visible, capture, onSeeked, onCanPlay, onPlaying: onSeeked, onError: clear }
}
