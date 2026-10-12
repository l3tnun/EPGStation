import { describe, expect, it } from 'vitest'
import {
  computeDesktopPaginationItems,
  computeDesktopPaginationMaxButtons,
} from '@/shared/legacyPaginationDesktop'

// Pins .kiro/specs/frontend-recorded/requirements.md AC 1.15 and design.md's `LegacyPagination`
// responsive contract: above the 500px mobile/desktop switch, the number of visible page-number
// buttons is a fluid function of the pagination element's *measured* width, computed by the same
// two real functions this test calls: `maxButtons = computeDesktopPaginationMaxButtons(measuredWidth)`
// == `Math.floor((measuredWidth - 96) / 42)`, then
// `computeDesktopPaginationItems(pageCount, currentPage, maxButtons)` turns that into the
// head/tail page-number counts around the ellipsis. A change to either magic number (96, 42)
// shifts every width boundary asserted below.
describe('[AC 1.15] LegacyPagination desktop page-number count follows the measured-width maxButtons formula', () => {
  const PAGE_COUNT = 100
  const FIRST_PAGE = 1

  it.each([
    // [measured width, expected maxButtons, expected head+tail split]
    [600, 12, [1, 2, 3, 4, 5, 6, 'ellipsis', 96, 97, 98, 99, 100]], // 先頭6 + 末尾5
    [599, 11, [1, 2, 3, 4, 5, 'ellipsis', 96, 97, 98, 99, 100]], // 先頭5 + 末尾5
    [558, 11, [1, 2, 3, 4, 5, 'ellipsis', 96, 97, 98, 99, 100]], // 先頭5 + 末尾5 (lower bound)
    [557, 10, [1, 2, 3, 4, 5, 'ellipsis', 97, 98, 99, 100]], // 先頭5 + 末尾4
    [516, 10, [1, 2, 3, 4, 5, 'ellipsis', 97, 98, 99, 100]], // 先頭5 + 末尾4 (lower bound)
    [515, 9, [1, 2, 3, 4, 'ellipsis', 97, 98, 99, 100]], // 先頭4 + 末尾4
    [474, 9, [1, 2, 3, 4, 'ellipsis', 97, 98, 99, 100]], // 先頭4 + 末尾4 (lower bound)
    [473, 8, [1, 2, 3, 4, 'ellipsis', 98, 99, 100]], // 先頭4 + 末尾3
    [432, 8, [1, 2, 3, 4, 'ellipsis', 98, 99, 100]], // 先頭4 + 末尾3 (lower bound)
  ] as const)(
    'measured width %ipx -> maxButtons %i -> %j',
    (measuredWidth, expectedMaxButtons, expectedItems) => {
      const maxButtons = computeDesktopPaginationMaxButtons(measuredWidth)

      expect(maxButtons).toBe(expectedMaxButtons)
      expect(computeDesktopPaginationItems(PAGE_COUNT, FIRST_PAGE, maxButtons)).toStrictEqual([
        ...expectedItems,
      ])
    },
  )

  it.each([
    // Width -> maxButtons boundaries between the 432px table above and the 431px/390px/179px/138px
    // table below, filling in the maxButtons 2/3/4/6 crossings.
    [180, 2],
    [221, 2],
    [222, 3],
    [263, 3],
    [264, 4],
    [389, 6],
  ] as const)('measured width %ipx -> maxButtons %i', (measuredWidth, expectedMaxButtons) => {
    expect(computeDesktopPaginationMaxButtons(measuredWidth)).toBe(expectedMaxButtons)
  })

  it.each([
    // `maxButtons <= 0` (measured width <= 137px, including undefined/never-measured and negative
    // `maxButtons` from an even narrower width) all fall back to the unconstrained totalVisible=12
    // six-first/five-last split -- `computeDesktopPaginationItems` never renders zero buttons.
    [undefined, 0],
    [137, 0],
    [96, 0],
    [0, -3],
    [-100, -5],
  ] as const)(
    'falls back to the unconstrained totalVisible=12 six-first/five-last split when the measured width (%s) yields maxButtons <= 0 (%i)',
    (measuredWidth, expectedMaxButtons) => {
      const maxButtons = computeDesktopPaginationMaxButtons(measuredWidth)

      expect(maxButtons).toBe(expectedMaxButtons)
      expect(computeDesktopPaginationItems(PAGE_COUNT, FIRST_PAGE, maxButtons)).toStrictEqual([
        1,
        2,
        3,
        4,
        5,
        6,
        'ellipsis',
        96,
        97,
        98,
        99,
        100,
      ])
    },
  )

  it.each([
    // Below the 432px lower bound of the table above, the same formula keeps shrinking the cluster
    // instead of stopping at a floor -- there is no separate "minimum" breakpoint.
    [431, 7, [1, 2, 3, 'ellipsis', 98, 99, 100]], // maxButtons 7 (left 3): 先頭3 + 末尾3
    [390, 7, [1, 2, 3, 'ellipsis', 98, 99, 100]], // maxButtons 7 (lower bound)
    [179, 1, [1, 2, 'ellipsis', 100]], // maxButtons 1 (left 0): degenerate sliding-window branch,
    // not the fixed head+tail branch -- `secondItem` collapses onto the literal page 2.
    [138, 1, [1, 2, 'ellipsis', 100]], // maxButtons 1 (lower bound)
  ] as const)(
    'keeps shrinking below 432px: measured width %ipx -> maxButtons %i -> %j',
    (measuredWidth, expectedMaxButtons, expectedItems) => {
      const maxButtons = computeDesktopPaginationMaxButtons(measuredWidth)

      expect(maxButtons).toBe(expectedMaxButtons)
      expect(computeDesktopPaginationItems(PAGE_COUNT, FIRST_PAGE, maxButtons)).toStrictEqual([
        ...expectedItems,
      ])
    },
  )

  it('shows every page with no ellipsis once the page count fits within maxLength', () => {
    // `maxLength = min(12, maxButtons, pageCount)`: once `pageCount <= maxLength` the whole range is
    // shown verbatim, regardless of current page.
    expect(computeDesktopPaginationItems(8, 1, 12)).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(computeDesktopPaginationItems(12, 6, 12)).toStrictEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])
    expect(computeDesktopPaginationItems(12, 7, 12)).toStrictEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])
  })

  it.each([
    // `computeDesktopPaginationItems` only slides the `start..end` window when current page is
    // STRICTLY between `left` (floor(maxLength / 2) = 6) and `right` (pageCount - left + 1 + isEven
    // = 96) -- `currentPage === left` and `currentPage === right` are separate branches (below) that
    // do not use the `start`/`end` formula at all, even though 7's and 95's collapsed output happens
    // to look the same as 6's and 96's.
    [7, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 'ellipsis', 100]], // one step past left: `secondItem`
    // collapses onto the literal adjacent page 2, visually matching current page 6 (== left) below.
    [8, [1, 'ellipsis', 4, 5, 6, 7, 8, 9, 10, 11, 'ellipsis', 100]], // interior, no collapse on
    // either side.
    [50, [1, 'ellipsis', 46, 47, 48, 49, 50, 51, 52, 53, 'ellipsis', 100]], // far from both ends:
    // both ellipses stay, window centered on page 50.
    [94, [1, 'ellipsis', 90, 91, 92, 93, 94, 95, 96, 97, 'ellipsis', 100]], // interior, no collapse
    // on either side.
    [95, [1, 'ellipsis', 91, 92, 93, 94, 95, 96, 97, 98, 99, 100]], // one step before right:
    // `beforeLastItem` collapses onto the literal adjacent page 99, visually matching current page
    // 96 (== right) below.
  ] as const)(
    'slides the window around current page %i in the interior (left < current < right, maxButtons 12, 100 pages)',
    (currentPage, expected) => {
      expect(computeDesktopPaginationItems(PAGE_COUNT, currentPage, 12)).toStrictEqual([
        ...expected,
      ])
    },
  )

  it.each([
    // `currentPage === left` and `currentPage === right` are their own branches in
    // `computeDesktopPaginationItems`, distinct from both the fixed outside-cluster branch and the
    // interior sliding-window branch above. `currentPage === left` always shows exactly 1 trailing
    // page (never a real tail cluster); `currentPage === right` always shows exactly 1 leading page.
    [6, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 'ellipsis', 100]], // current page == left (6): head extends
    // to `current + left - 1 - isEven` = 10, tail is the single last page.
    [96, [1, 'ellipsis', 91, 92, 93, 94, 95, 96, 97, 98, 99, 100]], // current page == right (96):
    // head is the single first page, tail starts at `current - left + 1` = 91.
  ] as const)(
    'uses the current === left / current === right branch, not the interior formula (maxButtons 12, 100 pages, current page %i)',
    (currentPage, expected) => {
      expect(computeDesktopPaginationItems(PAGE_COUNT, currentPage, 12)).toStrictEqual([
        ...expected,
      ])
    },
  )

  it.each([
    // A second, smaller (pageCount, maxButtons) pair that reaches every branch, including a
    // currentPage === right case (right = 9) that the maxButtons=12/pageCount=100 fixture above
    // cannot exercise as cleanly. maxLength=11 (odd, isEven=0), left=5, right=13-5+1+0=9.
    [1, [1, 2, 3, 4, 5, 'ellipsis', 9, 10, 11, 12, 13]], // current < left: fixed outside cluster.
    [4, [1, 2, 3, 4, 5, 'ellipsis', 9, 10, 11, 12, 13]], // current < left: same fixed cluster.
    [5, [1, 2, 3, 4, 5, 6, 7, 8, 9, 'ellipsis', 13]], // current === left: tail is the single last
    // page, not the 5-page cluster the outside branch would show.
    [6, [1, 2, 3, 4, 5, 6, 7, 8, 9, 'ellipsis', 13]], // interior, but `secondItem` collapses so it
    // looks the same as current === left (5).
    [7, [1, 'ellipsis', 4, 5, 6, 7, 8, 9, 10, 'ellipsis', 13]], // interior, no collapse.
    [8, [1, 'ellipsis', 5, 6, 7, 8, 9, 10, 11, 12, 13]], // interior, but `beforeLastItem` collapses
    // so it looks the same as current === right (9).
    [9, [1, 'ellipsis', 5, 6, 7, 8, 9, 10, 11, 12, 13]], // current === right: head is the single
    // first page, not a real head cluster.
    [10, [1, 2, 3, 4, 5, 'ellipsis', 9, 10, 11, 12, 13]], // current > right: same fixed cluster as
    // current < left.
    [13, [1, 2, 3, 4, 5, 'ellipsis', 9, 10, 11, 12, 13]], // current > right: same fixed cluster.
  ] as const)(
    'covers every branch on a 13-page, maxButtons=11 pagination (current page %i)',
    (currentPage, expected) => {
      expect(computeDesktopPaginationItems(13, currentPage, 11)).toStrictEqual([...expected])
    },
  )

  it.each([
    // maxButtons 3 (maxLength=3, isEven=0, left=1, right=100-1+1+0=100=pageCount, so current===right
    // is reachable at the last page) and maxButtons 2 (maxLength=2, isEven=1, left=1,
    // right=100-1+1+1=101 > pageCount, so current===right is never reachable) both collapse the
    // interior window's `start..end` range to empty for most current pages, since `left` is only 1.
    // `computeDesktopPaginationItems` corrects two shapes this collapse would otherwise produce (see the
    // function's doc comment): page 1 is always included, and a run of adjacent 'ellipsis' entries
    // is always collapsed to one -- both pinned below, with no effect for maxButtons >= 5.
    [3, 1, [1, 'ellipsis', 100]], // current === left (1): page 1 itself IS shown here (isEven=0).
    [3, 50, [1, 'ellipsis', 100]], // interior, empty window: the two adjacent 'ellipsis' entries the
    // raw formula produces collapse to one.
    [3, 100, [1, 'ellipsis', 100]], // current === right (100): head is the single first page.
    [2, 1, [1, 'ellipsis', 100]], // current === left (1): the raw head range (1..(current+left-1-
    // isEven) = 1..0) is empty because isEven=1 here, so page 1 would otherwise be dropped entirely
    // ("... 100" with no page-1 button at all) -- it is clamped back in.
    [2, 50, [1, 'ellipsis', 100]], // interior, empty window: collapses like maxButtons 3 above.
    [2, 100, [1, 'ellipsis', 99, 100]], // interior (right=101 is never reached), but
    // `beforeLastItem` collapses onto the literal adjacent page 99 -- only one 'ellipsis' here, so
    // there is nothing to collapse.
  ] as const)(
    'maxButtons %i, 100 pages, current page %i -> %j',
    (maxButtons, currentPage, expected) => {
      expect(computeDesktopPaginationItems(PAGE_COUNT, currentPage, maxButtons)).toStrictEqual([
        ...expected,
      ])
    },
  )

  it.each([
    // The degenerate collapse only ever happens for maxButtons 1 through 4 (`left <= 2`); this
    // table exercises the boundary on both sides (maxButtons 4 degenerates, maxButtons 5 does not)
    // and every current-page position (first/middle/last) for each, on the same 100-page fixture as
    // the table above.
    [1, 1, [1, 2, 'ellipsis', 100]], // first page (maxLength=1, isEven=0, left=0): the interior
    // branch's `secondItem` collapses onto the literal page 2, so no fix-up is needed here.
    [1, 50, [1, 'ellipsis', 100]], // middle: raw formula produces two adjacent 'ellipsis' entries
    // (`1 ... ... 100`), collapsed to one.
    [1, 100, [1, 'ellipsis', 99, 100]], // last page: `beforeLastItem` already collapses onto the
    // literal page 99, so there is only one 'ellipsis' -- nothing to fix up.
    [4, 1, [1, 2, 'ellipsis', 100]], // first page (maxLength=4, isEven=1, left=2): outside-cluster
    // branch, unaffected.
    [4, 50, [1, 'ellipsis', 100]], // middle: same double-'ellipsis' collapse as maxButtons 1-3.
    [4, 100, [1, 'ellipsis', 99, 100]], // last page: current === right branch, unaffected.
    [5, 1, [1, 2, 'ellipsis', 99, 100]], // first page (maxLength=5, isEven=0, left=2): maxButtons
    // >= 5 never degenerates, so the output is unchanged from the original v2-ported formula.
    [5, 50, [1, 'ellipsis', 50, 'ellipsis', 100]], // middle: current page itself is visible between
    // two distinct ellipsis entries -- nothing to collapse.
    [5, 100, [1, 2, 'ellipsis', 99, 100]], // last page: outside-cluster branch, unaffected.
  ] as const)(
    'degenerate-shape fix boundary: maxButtons %i, 100 pages, current page %i -> %j',
    (maxButtons, currentPage, expected) => {
      expect(computeDesktopPaginationItems(PAGE_COUNT, currentPage, maxButtons)).toStrictEqual([
        ...expected,
      ])
    },
  )

  it('never drops page 1 and never renders two adjacent ellipsis entries, for any maxButtons/currentPage on a 100-page fixture', () => {
    // General regression guard for the two invariants the degenerate-shape fix establishes, beyond
    // the specific cases pinned above.
    for (let maxButtons = 1; maxButtons <= 12; maxButtons += 1) {
      for (let currentPage = 1; currentPage <= PAGE_COUNT; currentPage += 1) {
        const items = computeDesktopPaginationItems(PAGE_COUNT, currentPage, maxButtons)

        expect(items[0], `maxButtons=${maxButtons} currentPage=${currentPage}`).not.toBe('ellipsis')
        for (let index = 1; index < items.length; index += 1) {
          expect(
            items[index] === 'ellipsis' && items[index - 1] === 'ellipsis',
            `maxButtons=${maxButtons} currentPage=${currentPage} -> ${JSON.stringify(items)}`,
          ).toBe(false)
        }
      }
    }
  })
})
