import CircularProgress from '@mui/material/CircularProgress'
import { type CSSProperties, useLayoutEffect, useRef } from 'react'
import type { GuideGridRenderer, GuideGridRendererInput } from '../GuideGridRenderer'
import { useDeferredLoading } from '@/shared/useDeferredLoading'
import styles from '../GuidePage.module.css'

export function GuideGridHost({
  visible,
  isLoading,
  hasGrid,
  isGuideDarkColorDisabled,
  renderer,
  rendererInput,
  routeKey,
  sizeStyle,
  onReady,
}: {
  visible: boolean
  isLoading: boolean
  hasGrid: boolean
  isGuideDarkColorDisabled: boolean
  renderer: GuideGridRenderer
  rendererInput: GuideGridRendererInput | null
  routeKey: string
  sizeStyle: CSSProperties
  onReady: (routeKey: string) => void
}) {
  const mountTarget = useRef<HTMLDivElement | null>(null)
  const showLoadingIndicator = useDeferredLoading(isLoading)

  useLayoutEffect(() => {
    let cancelled = false

    if (!hasGrid || rendererInput === null || mountTarget.current === null) {
      renderer.destroy()
      onReady(routeKey)
      return () => {
        cancelled = true
      }
    }

    void renderer.mount(mountTarget.current, rendererInput).then(() => {
      if (cancelled) {
        return
      }
      renderer.updateReserveIndex(rendererInput.reserveIndex)
      onReady(routeKey)
    })

    return () => {
      cancelled = true
      renderer.destroy()
    }
    // reserveIndex is updated in its own layout effect so Socket.IO refreshes do not rebuild cells.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasGrid,
    onReady,
    renderer,
    rendererInput?.guideMode,
    rendererInput?.hours,
    rendererInput?.mode,
    rendererInput?.schedules,
    rendererInput?.startAt,
    routeKey,
  ])

  useLayoutEffect(() => {
    if (rendererInput !== null) {
      renderer.updateReserveIndex(rendererInput.reserveIndex)
    }
  }, [renderer, rendererInput])

  useLayoutEffect(() => {
    if (rendererInput !== null) {
      renderer.updateGenreVisibility(rendererInput.genreVisibility)
    }
  }, [renderer, rendererInput])

  return (
    <section
      data-guide-dark-colors={isGuideDarkColorDisabled ? 'disabled' : 'enabled'}
      data-guide-visible={visible || !hasGrid ? 'true' : 'false'}
      data-testid="guide-page"
      className={styles.guidePage}
      style={sizeStyle}
    >
      {!hasGrid ? undefined : <div ref={mountTarget} className={styles.gridMount} />}
      {showLoadingIndicator ? (
        <div className={styles.loadingScrim} data-testid="guide-loading">
          <CircularProgress size={60} thickness={4} />
        </div>
      ) : undefined}
    </section>
  )
}
