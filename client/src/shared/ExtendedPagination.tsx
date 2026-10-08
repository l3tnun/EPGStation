import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import type { CSSProperties, FocusEvent, KeyboardEvent } from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ClearableTextField } from './ClearableTextField'
import styles from './ExtendedPagination.module.css'
import {
  EXTENDED_PAGINATION_DEFAULT_BUTTON_MARGIN,
  EXTENDED_PAGINATION_DEFAULT_BUTTON_WIDTH,
  computeDialogViewportMetrics,
  computeExtendedPaginationPageCount,
  computeExtendedPaginationPages,
  isValidExtendedPaginationInput,
  selectExtendedPaginationElementCount,
  type DialogViewportMetrics,
} from './extendedPagination'

const MDI_CHEVRON_DOUBLE_LEFT = '\\F013D'
const MDI_CHEVRON_DOUBLE_RIGHT = '\\F013E'
// How long the software keyboard takes to settle before the input is checked against the visible area.
const KEYBOARD_SETTLE_DELAY_MS = 300
const DIALOG_TRANSITION_MS = 150

interface RowMetrics {
  availableWidth: number
  itemPitch: number
}

// Nothing is measured yet: a zero width selects the 7-element minimum.
const UNMEASURED_ROW: RowMetrics = {
  availableWidth: 0,
  itemPitch: EXTENDED_PAGINATION_DEFAULT_BUTTON_WIDTH + EXTENDED_PAGINATION_DEFAULT_BUTTON_MARGIN,
}

/**
 * Reads the row as laid out: the width available to the buttons, and the distance from one button
 * to the next (button width plus its margins). `offsetWidth` and `offsetLeft` ignore `transform`,
 * so the enlarged current page does not disturb the measurement.
 */
function measureRow(nav: HTMLElement): RowMetrics {
  const first = nav.children[0] as HTMLElement
  const second = nav.children[1] as HTMLElement
  const buttonWidth =
    first.offsetWidth > 0 ? first.offsetWidth : EXTENDED_PAGINATION_DEFAULT_BUTTON_WIDTH
  const pitch = second.offsetLeft - first.offsetLeft

  return {
    availableWidth: nav.clientWidth,
    itemPitch:
      pitch > buttonWidth ? pitch : buttonWidth + EXTENDED_PAGINATION_DEFAULT_BUTTON_MARGIN,
  }
}

function readVisualViewport(): VisualViewport | null {
  return window.visualViewport ?? null
}

function readDialogViewportMetrics(viewport: VisualViewport): DialogViewportMetrics {
  return computeDialogViewportMetrics({
    innerHeight: window.innerHeight,
    viewportHeight: viewport.height,
    viewportOffsetTop: viewport.offsetTop,
  })
}

function chevronStyle(glyph: string): CSSProperties {
  return { '--extended-pagination-icon': `"${glyph}"` } as CSSProperties
}

function dialogPaperProps(metrics: DialogViewportMetrics | null) {
  if (metrics === null) {
    return { className: styles.dialogPaper }
  }

  return {
    className: styles.dialogPaper,
    'data-visual-viewport': 'true',
    style: {
      '--extended-pagination-keyboard-height': `${metrics.keyboardHeight}px`,
      '--extended-pagination-available-height': `${metrics.availableHeight}px`,
      '--extended-pagination-offset-top': `${metrics.offsetTop}px`,
    } as CSSProperties,
  }
}

export function ExtendedPagination({
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
  const pageCount = computeExtendedPaginationPageCount(total, pageSize)
  const isShown = total > pageSize
  const currentPage = Math.min(Math.max(page, 1), pageCount)
  const navRef = useRef<HTMLElement | null>(null)
  const [row, setRow] = useState<RowMetrics>(UNMEASURED_ROW)
  const [isDialogOpen, setDialogOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [hasInputError, setInputError] = useState(false)
  const [viewportMetrics, setViewportMetrics] = useState<DialogViewportMetrics | null>(null)
  const settleTimer = useRef<number | undefined>(undefined)
  const titleId = useId()

  useLayoutEffect(() => {
    const nav = navRef.current

    if (nav === null || typeof ResizeObserver === 'undefined') {
      return undefined
    }

    const observer = new ResizeObserver(() => setRow(measureRow(nav)))
    observer.observe(nav)

    return () => observer.disconnect()
  }, [isShown])

  useEffect(() => {
    const viewport = readVisualViewport()

    if (!isDialogOpen || viewport === null) {
      return undefined
    }

    const update = () => setViewportMetrics(readDialogViewportMetrics(viewport))
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)

    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [isDialogOpen])

  useEffect(() => () => window.clearTimeout(settleTimer.current), [])

  if (!isShown) {
    return null
  }

  const elementCount = selectExtendedPaginationElementCount({
    availableWidth: row.availableWidth,
    itemPitch: row.itemPitch,
    pageCount,
  })
  const pages = computeExtendedPaginationPages(pageCount, currentPage, elementCount)

  const openDialog = () => {
    const viewport = readVisualViewport()

    setInputValue('')
    setInputError(false)
    // Computed here, not in an effect, so the dialog opens where it will stay.
    setViewportMetrics(viewport === null ? null : readDialogViewportMetrics(viewport))
    setDialogOpen(true)
  }

  const closeDialog = () => {
    window.clearTimeout(settleTimer.current)
    setDialogOpen(false)
  }

  const submit = () => {
    if (!isValidExtendedPaginationInput(inputValue, pageCount)) {
      setInputError(true)

      return
    }

    closeDialog()
    const target = Number(inputValue)
    if (target !== currentPage) {
      onPageChange(target)
    }
  }

  const handleInputFocus = (event: FocusEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      const viewport = readVisualViewport()
      const visibleTop = viewport === null ? 0 : viewport.offsetTop
      const visibleBottom =
        viewport === null ? window.innerHeight : viewport.offsetTop + viewport.height
      const bounds = input.getBoundingClientRect()

      if (bounds.top < visibleTop || bounds.bottom > visibleBottom) {
        input.scrollIntoView({ block: 'nearest' })
      }
    }, KEYBOARD_SETTLE_DELAY_MS)
  }

  const handleInputKeyDown = (event: KeyboardEvent) => {
    // Enter that confirms an IME composition must not submit.
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      // Without this, the Enter keypress that follows lands on the current page button, which
      // gets the focus back when the dialog closes, and clicks it: the dialog opens again.
      event.preventDefault()
      submit()
    }
  }

  return (
    <>
      <nav aria-label="ページ" className={styles.pagination} ref={navRef}>
        <button
          aria-label="最初のページへ移動"
          className={styles.pageButton}
          disabled={currentPage <= 1}
          type="button"
          onClick={() => onPageChange(1)}
        >
          <span
            aria-hidden="true"
            className={styles.pageIcon}
            style={chevronStyle(MDI_CHEVRON_DOUBLE_LEFT)}
          />
        </button>
        {pages.map((pageNumber) =>
          pageNumber === currentPage ? (
            <button
              aria-current="page"
              aria-label="ページ数を入力して移動"
              className={styles.pageButton}
              key={pageNumber}
              type="button"
              onClick={openDialog}
            >
              {pageNumber}
            </button>
          ) : (
            <button
              aria-label={`ページ${pageNumber}へ移動`}
              className={styles.pageButton}
              key={pageNumber}
              type="button"
              onClick={() => onPageChange(pageNumber)}
            >
              {pageNumber}
            </button>
          ),
        )}
        <button
          aria-label="最後のページへ移動"
          className={styles.pageButton}
          disabled={currentPage >= pageCount}
          type="button"
          onClick={() => onPageChange(pageCount)}
        >
          <span
            aria-hidden="true"
            className={styles.pageIcon}
            style={chevronStyle(MDI_CHEVRON_DOUBLE_RIGHT)}
          />
        </button>
      </nav>
      <Dialog
        open={isDialogOpen}
        aria-labelledby={titleId}
        transitionDuration={DIALOG_TRANSITION_MS}
        onClose={closeDialog}
        slotProps={{ paper: dialogPaperProps(viewportMetrics) }}
      >
        <DialogTitle id={titleId}>ページ数を入力</DialogTitle>
        <DialogContent>
          <ClearableTextField
            autoFocus
            fullWidth
            error={hasInputError}
            helperText={hasInputError ? `1 〜 ${pageCount} の整数を入力してください` : undefined}
            label="ページ数"
            margin="dense"
            placeholder={`1 〜 ${pageCount}`}
            slotProps={{ htmlInput: { inputMode: 'numeric', onFocus: handleInputFocus } }}
            value={inputValue}
            variant="standard"
            onChange={(event) => {
              setInputValue(event.target.value)
              setInputError(false)
            }}
            onClear={() => {
              setInputValue('')
              setInputError(false)
            }}
            onKeyDown={handleInputKeyDown}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={closeDialog}>
            キャンセル
          </Button>
          <Button variant="text" color="primary" onClick={submit}>
            移動
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
