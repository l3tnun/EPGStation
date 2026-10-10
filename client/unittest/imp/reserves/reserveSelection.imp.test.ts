import { describe, expect, it } from 'vitest'
import { toggleVisibleReserveSelection } from '@/features/reserves/lib/reserveSelection'

describe('toggleVisibleReserveSelection', () => {
  it('keeps the selected reserves that are not visible when every visible reserve gets deselected', () => {
    expect(
      toggleVisibleReserveSelection({
        currentSelectedIds: new Set([1, 2, 3]),
        visibleReserveIds: [1, 2],
        action: 'select-all',
      }),
    ).toStrictEqual(new Set([3]))
  })

  it('adds the visible reserves to the selection when some of them are not selected yet', () => {
    expect(
      toggleVisibleReserveSelection({
        currentSelectedIds: new Set([1, 9]),
        visibleReserveIds: [1, 2],
        action: 'select-all',
      }),
    ).toStrictEqual(new Set([1, 2, 9]))
  })

  it('keeps the selection unchanged when nothing is visible', () => {
    expect(
      toggleVisibleReserveSelection({
        currentSelectedIds: new Set([4]),
        visibleReserveIds: [],
        action: 'select-all',
      }),
    ).toStrictEqual(new Set([4]))
  })

  it('drops the selected reserves that are no longer visible when preserving the visible ones', () => {
    expect(
      toggleVisibleReserveSelection({
        currentSelectedIds: new Set([1, 2, 3]),
        visibleReserveIds: [2, 3, 4],
        action: 'preserve-visible',
      }),
    ).toStrictEqual(new Set([2, 3]))
  })
})
