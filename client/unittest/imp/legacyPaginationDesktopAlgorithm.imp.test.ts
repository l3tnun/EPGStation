import { describe, expect, it } from 'vitest'
import {
  computeDesktopPaginationItems,
  computeDesktopPaginationMaxButtons,
} from '@/shared/legacyPaginationDesktop'

// Ported from v2's Vuetify `VPagination` `items` computed property
// (vuetify, a v2 dependency: src/components/VPagination/VPagination.ts:91-134),
// with `totalVisible` fixed at 12 to match v2 `components/pagination/Pagination.vue:3`
// (`:total-visible="12"`). `maxButtons` there comes from
// `Math.floor((this.$el.parentElement.clientWidth - 96) / 42)` (VPagination.ts:156-161); this port
// takes the already-computed `maxButtons` so the pure branching logic can be tested without a DOM.
describe('[A-3] computeDesktopPaginationItems ports v2 VPagination.items exactly', () => {
  it('shows every page without an ellipsis once pageCount fits within maxLength', () => {
    expect(computeDesktopPaginationItems(5, 1, 0)).toStrictEqual([1, 2, 3, 4, 5])
    expect(computeDesktopPaginationItems(12, 7, 12)).toStrictEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])
  })

  it('uses the unconstrained six-first/five-last split when maxButtons is at least 12 and the current page sits at the very start', () => {
    expect(computeDesktopPaginationItems(20, 1, 12)).toStrictEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      'ellipsis',
      16,
      17,
      18,
      19,
      20,
    ])
  })

  it('renders a single leading run with no leading ellipsis when the current page equals the v2 "left" boundary', () => {
    // value === left: v2 takes the `this.value === left` branch, which has no counterpart cluster
    // before the ellipsis (only the final page trails it).
    expect(computeDesktopPaginationItems(20, 6, 12)).toStrictEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      'ellipsis',
      20,
    ])
  })

  it('renders a single trailing run with no trailing ellipsis when the current page equals the v2 "right" boundary', () => {
    expect(computeDesktopPaginationItems(20, 16, 12)).toStrictEqual([
      1,
      'ellipsis',
      11,
      12,
      13,
      14,
      15,
      16,
      17,
      18,
      19,
      20,
    ])
  })

  it('shows both ellipsis clusters around the current page in the middle of the range', () => {
    expect(computeDesktopPaginationItems(20, 10, 12)).toStrictEqual([
      1,
      'ellipsis',
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      'ellipsis',
      20,
    ])
  })

  it('replaces the leading ellipsis with the literal page 2 when the v2 formula collapses to an adjacent page', () => {
    // v2: `secondItem = start - 1 === firstItem + 1 ? 2 : '...'`
    expect(computeDesktopPaginationItems(20, 7, 12)).toStrictEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      'ellipsis',
      20,
    ])
  })

  it('replaces the trailing ellipsis with the literal adjacent page when the v2 formula collapses next to the last page', () => {
    // v2: `beforeLastItem = end + 1 === lastItem - 1 ? end + 1 : '...'`
    expect(computeDesktopPaginationItems(20, 15, 12)).toStrictEqual([
      1,
      'ellipsis',
      11,
      12,
      13,
      14,
      15,
      16,
      17,
      18,
      19,
      20,
    ])
  })

  it('shrinks the visible window when a narrow measured container yields fewer maxButtons than totalVisible', () => {
    expect(computeDesktopPaginationItems(10, 1, 3)).toStrictEqual([1, 'ellipsis', 10])
  })

  it('falls back to totalVisible=12 (not an unbounded window) when maxButtons is zero, matching v2 before its first resize measurement', () => {
    expect(computeDesktopPaginationItems(20, 1, 0)).toStrictEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      'ellipsis',
      16,
      17,
      18,
      19,
      20,
    ])
  })
})

describe('[A-3] computeDesktopPaginationMaxButtons ports v2 VPagination.onResize', () => {
  it('floors (containerWidth - 96) / 42, matching v2 VPagination.ts:161', () => {
    expect(computeDesktopPaginationMaxButtons(600)).toBe(12)
    expect(computeDesktopPaginationMaxButtons(baseWidthFor(11))).toBe(11)
  })

  it('returns 0 before a container width has been measured, matching v2 data(): { maxButtons: 0 }', () => {
    expect(computeDesktopPaginationMaxButtons(undefined)).toBe(0)
  })

  it('is allowed to go negative for a very narrow measured container, matching v2 (clamping happens in items, not onResize)', () => {
    expect(computeDesktopPaginationMaxButtons(0)).toBe(-3)
  })
})

function baseWidthFor(maxButtons: number): number {
  return maxButtons * 42 + 96
}
