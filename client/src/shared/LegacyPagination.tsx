import colors from './PaginationColors.module.css'
import styles from './LegacyPagination.module.css'
import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import { useMeasuredContainerWidth } from './useMeasuredContainerWidth'
import {
  computeDesktopPaginationItems,
  computeDesktopPaginationMaxButtons,
} from './legacyPaginationDesktop'

const MDI_CHEVRON_LEFT = '\\F0141'
const MDI_CHEVRON_RIGHT = '\\F0142'
const LEGACY_MOBILE_PAGINATION_MAX_WIDTH = 500

// v2 `components/pagination/Pagination.vue:3` renders Vuetify's `v-pagination` with
// `:total-visible="12"`.
// v2 Vuetify `VPagination.onResize()` (vuetify, a v2 dependency: src/components/VPagination/VPagination.ts:156-161):
// `this.maxButtons = Math.floor((width - 96) / 42)`, where `width` is
// `this.$el.parentElement.clientWidth` (falling back to `window.innerWidth`).

function readViewportWidth(): number | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  const widths = [
    window.innerWidth,
    window.visualViewport?.width,
    typeof document === 'undefined' ? undefined : document.documentElement.clientWidth,
  ].filter(
    (width): width is number => typeof width === 'number' && Number.isFinite(width) && width > 0,
  )

  return widths.length === 0 ? undefined : Math.min(...widths)
}

function visibleMobilePages(currentPage: number, pageCount: number): number[] {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1)
  }

  const startPage =
    currentPage <= 2 ? 1 : pageCount - currentPage >= 2 ? currentPage - 2 : pageCount - 4

  return Array.from({ length: 5 }, (_, index) => startPage + index)
}

export function LegacyPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}) {
  const [, setViewportVersion] = useState(0)
  // v2 Vuetify `VPagination.onResize()` measures `this.$el.parentElement.clientWidth`. `.pagination`
  // (below) is an unconstrained `display: flex` block box (`max-width: 100%`, no explicit `width`),
  // so per normal block layout it always fills its parent's content width -- measuring the `<nav>`
  // itself here is equivalent, and lets this reuse the same `ResizeObserver`-backed measurement the
  // other legacy list layouts (Reserves/Rule/Recorded) already use.
  const [containerRef, containerWidth] = useMeasuredContainerWidth<HTMLElement>()

  useEffect(() => {
    const updateViewportWidth = () => setViewportVersion((version) => version + 1)

    window.addEventListener('resize', updateViewportWidth)
    window.addEventListener('orientationchange', updateViewportWidth)
    window.visualViewport?.addEventListener('resize', updateViewportWidth)

    return () => {
      window.removeEventListener('resize', updateViewportWidth)
      window.removeEventListener('orientationchange', updateViewportWidth)
      window.visualViewport?.removeEventListener('resize', updateViewportWidth)
    }
  }, [])

  if (total <= pageSize) {
    return null
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(Math.max(page, 1), pageCount)
  const viewportWidth = readViewportWidth()
  const isMobilePagination =
    viewportWidth !== undefined && viewportWidth <= LEGACY_MOBILE_PAGINATION_MAX_WIDTH
  const pages = isMobilePagination
    ? visibleMobilePages(currentPage, pageCount)
    : computeDesktopPaginationItems(
        pageCount,
        currentPage,
        computeDesktopPaginationMaxButtons(containerWidth),
      )

  return (
    <nav className={styles.pagination} aria-label="ページ" ref={containerRef}>
      <button
        aria-label="前のページ"
        className={`${styles.pageButton} ${colors.pageButton} ${colors.navigationButton}`}
        disabled={currentPage <= 1}
        type="button"
        onClick={() => onPageChange(currentPage - 1)}
      >
        <span
          aria-hidden="true"
          className={styles.pageIcon}
          style={{ '--legacy-pagination-icon': `"${MDI_CHEVRON_LEFT}"` } as CSSProperties}
        />
      </button>
      {pages.map((pageNumber, index) =>
        pageNumber === 'ellipsis' ? (
          <span
            className={`${styles.ellipsis} ${colors.ellipsis}`}
            key={`ellipsis-${index}`}
            aria-hidden="true"
          >
            ...
          </span>
        ) : (
          <button
            aria-current={pageNumber === currentPage ? 'page' : undefined}
            aria-label={`${pageNumber} ページ`}
            className={`${styles.pageButton} ${colors.pageButton} ${styles.numberButton}`}
            key={pageNumber}
            type="button"
            onClick={() => onPageChange(pageNumber)}
          >
            {pageNumber}
          </button>
        ),
      )}
      <button
        aria-label="次のページ"
        className={`${styles.pageButton} ${colors.pageButton} ${colors.navigationButton}`}
        disabled={currentPage >= pageCount}
        type="button"
        onClick={() => onPageChange(currentPage + 1)}
      >
        <span
          aria-hidden="true"
          className={styles.pageIcon}
          style={{ '--legacy-pagination-icon': `"${MDI_CHEVRON_RIGHT}"` } as CSSProperties}
        />
      </button>
    </nav>
  )
}
