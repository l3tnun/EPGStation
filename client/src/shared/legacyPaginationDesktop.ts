const DESKTOP_PAGINATION_TOTAL_VISIBLE = 12
const DESKTOP_PAGINATION_MAX_BUTTONS_WIDTH_OFFSET = 96
const DESKTOP_PAGINATION_MAX_BUTTONS_ITEM_WIDTH = 42

/**
 * Ports v2 Vuetify `VPagination.onResize()`'s `maxButtons` formula. Returns 0 (v2's initial
 * `data(): { maxButtons: 0 }`) before a container width has been measured. The result is not
 * clamped to a minimum of 0 here -- v2 only clamps at the point of use, inside `items` -- so a
 * very narrow measured container can legitimately produce a negative value.
 */
export function computeDesktopPaginationMaxButtons(containerWidth: number | undefined): number {
  if (containerWidth === undefined) {
    return 0
  }

  return Math.floor(
    (containerWidth - DESKTOP_PAGINATION_MAX_BUTTONS_WIDTH_OFFSET) /
      DESKTOP_PAGINATION_MAX_BUTTONS_ITEM_WIDTH,
  )
}

/**
 * Ports v2 Vuetify `VPagination.range()`. v2 clamps `from` up to 1 because `range()` there is a
 * generic helper with several callers. Here it has exactly one caller,
 * {@link computeDesktopPaginationItems}, whose non-early-return paths always produce a positive
 * `from`: comparing this function with and without the clamp over every
 * `pageCount` x `currentPage` x `maxButtons` in [-5, 80] x [-5, 80] x [-5, 40] (340216
 * combinations) yields identical output, so the clamp is unreachable and is left out.
 */
function desktopPaginationRange(from: number, to: number): number[] {
  const range: number[] = []

  for (let pageNumber = from; pageNumber <= to; pageNumber += 1) {
    range.push(pageNumber)
  }

  return range
}

/**
 * Ports v2 Vuetify `VPagination`'s `items` computed property
 * (vuetify, a v2 dependency: src/components/VPagination/VPagination.ts:91-134),
 * with `totalVisible` fixed at 12 to match v2 `components/pagination/Pagination.vue:3`. `maxButtons`
 * comes from {@link computeDesktopPaginationMaxButtons} of the real, measured container width so the
 * ellipsis cluster boundary is a fluid function of the rendered width instead of a fixed viewport
 * breakpoint.
 *
 * The ported formula degenerates once `left` (`Math.floor(maxLength / 2)`) is 2 or less -- i.e.
 * `maxButtons` 1 through 4 -- which v2 never actually reaches because its pagination nav never
 * measures that narrow. Two fixups below correct that degenerate shape without touching any
 * `maxButtons` >= 5 output (verified by exhaustive comparison over `pageCount` x `currentPage` x
 * `maxButtons`):
 * - the `currentPage === left` branch's leading range can end below page 1, dropping page 1 from
 *   the output entirely; it is clamped so page 1 always renders.
 * - the interior branch's "second item"/"before last item" placeholders can both resolve to
 *   'ellipsis' with nothing between them, rendering two adjacent ellipsis entries; consecutive
 *   ellipsis entries are collapsed into one afterward.
 */
export function computeDesktopPaginationItems(
  pageCount: number,
  currentPage: number,
  maxButtons: number,
): Array<number | 'ellipsis'> {
  const maxLength = Math.min(
    DESKTOP_PAGINATION_TOTAL_VISIBLE,
    Math.max(0, maxButtons) || pageCount,
    pageCount,
  )

  if (pageCount <= maxLength) {
    return desktopPaginationRange(1, pageCount)
  }

  const isEven = maxLength % 2 === 0 ? 1 : 0
  const left = Math.floor(maxLength / 2)
  const right = pageCount - left + 1 + isEven

  const items = ((): Array<number | 'ellipsis'> => {
    if (currentPage > left && currentPage < right) {
      const start = currentPage - left + 2
      const end = currentPage + left - 2 - isEven
      const secondItem: number | 'ellipsis' = start - 1 === 2 ? 2 : 'ellipsis'
      const beforeLastItem: number | 'ellipsis' = end + 1 === pageCount - 1 ? end + 1 : 'ellipsis'

      return [1, secondItem, ...desktopPaginationRange(start, end), beforeLastItem, pageCount]
    }

    if (currentPage === left) {
      const end = Math.max(1, currentPage + left - 1 - isEven)

      return [...desktopPaginationRange(1, end), 'ellipsis', pageCount]
    }

    if (currentPage === right) {
      const start = currentPage - left + 1

      return [1, 'ellipsis', ...desktopPaginationRange(start, pageCount)]
    }

    return [
      ...desktopPaginationRange(1, left),
      'ellipsis',
      ...desktopPaginationRange(right, pageCount),
    ]
  })()

  return items.filter((item, index) => item !== 'ellipsis' || items[index - 1] !== 'ellipsis')
}
