/** Element counts the extended pagination row can take, `≪` and `≫` included. */
export const EXTENDED_PAGINATION_ELEMENT_COUNTS = [7, 9, 11, 13, 15, 17] as const

/** Button width and the sum of its left and right margins, used when the row cannot be measured. */
export const EXTENDED_PAGINATION_DEFAULT_BUTTON_WIDTH = 34
export const EXTENDED_PAGINATION_DEFAULT_BUTTON_MARGIN = 6

/** Space kept above and below the page number dialog inside the visible area. */
const DIALOG_VERTICAL_MARGIN = 12

export interface DialogViewportMetrics {
  keyboardHeight: number
  availableHeight: number
  offsetTop: number
}

/** Same page count as `LegacyPagination`: `ceil(total / pageSize)`, at least one page. */
export function computeExtendedPaginationPageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

/**
 * The largest step of {@link EXTENDED_PAGINATION_ELEMENT_COUNTS} whose elements fit the row
 * (`count * itemPitch <= availableWidth`), 7 when none fits, and never more than the pages that
 * exist plus the two end buttons.
 */
export function selectExtendedPaginationElementCount({
  availableWidth,
  itemPitch,
  pageCount,
}: {
  availableWidth: number
  itemPitch: number
  pageCount: number
}): number {
  const fitting = EXTENDED_PAGINATION_ELEMENT_COUNTS.filter(
    (count) => count * itemPitch <= availableWidth,
  )
  const byWidth =
    fitting.length === 0 ? EXTENDED_PAGINATION_ELEMENT_COUNTS[0] : fitting[fitting.length - 1]

  return Math.min(byWidth, pageCount + 2)
}

/**
 * The page numbers of a row with `elementCount` elements: the current page in the middle, and the
 * whole window shifted to the other side near the first or last page so that the count holds.
 */
export function computeExtendedPaginationPages(
  pageCount: number,
  currentPage: number,
  elementCount: number,
): number[] {
  const numberCount = elementCount - 2
  const current = Math.min(Math.max(currentPage, 1), pageCount)
  const start = Math.max(
    1,
    Math.min(current - Math.floor((numberCount - 1) / 2), pageCount - numberCount + 1),
  )

  return Array.from({ length: numberCount }, (_, index) => start + index)
}

/** An integer from 1 to the last page, written with ASCII digits only. */
export function isValidExtendedPaginationInput(value: string, pageCount: number): boolean {
  if (!/^[0-9]+$/.test(value)) {
    return false
  }

  const page = Number(value)

  return page >= 1 && page <= pageCount
}

/**
 * Where the page number dialog goes while a software keyboard is up, from the visual viewport
 * (what the user can see) and the layout viewport (`window.innerHeight`).
 */
export function computeDialogViewportMetrics({
  innerHeight,
  viewportHeight,
  viewportOffsetTop,
}: {
  innerHeight: number
  viewportHeight: number
  viewportOffsetTop: number
}): DialogViewportMetrics {
  return {
    keyboardHeight: Math.max(0, Math.round(innerHeight - viewportHeight)),
    availableHeight: Math.max(1, Math.floor(viewportHeight - DIALOG_VERTICAL_MARGIN * 2)),
    offsetTop: Math.max(0, Math.floor(viewportOffsetTop)),
  }
}
