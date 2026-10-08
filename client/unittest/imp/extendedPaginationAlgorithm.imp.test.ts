import { describe, expect, it } from 'vitest'
import {
  EXTENDED_PAGINATION_ELEMENT_COUNTS,
  computeDialogViewportMetrics,
  computeExtendedPaginationPageCount,
  computeExtendedPaginationPages,
  isValidExtendedPaginationInput,
  selectExtendedPaginationElementCount,
} from '@/shared/extendedPagination'

describe('computeExtendedPaginationPageCount', () => {
  it('[AC 8.33] uses ceil(total / pageSize) and treats an empty list as one page', () => {
    expect(computeExtendedPaginationPageCount(0, 24)).toBe(1)
    expect(computeExtendedPaginationPageCount(1, 24)).toBe(1)
    expect(computeExtendedPaginationPageCount(24, 24)).toBe(1)
    expect(computeExtendedPaginationPageCount(25, 24)).toBe(2)
    expect(computeExtendedPaginationPageCount(1125, 24)).toBe(47)
  })
})

describe('selectExtendedPaginationElementCount', () => {
  it('[AC 8.35] offers exactly the six odd steps from 7 to 17', () => {
    expect(EXTENDED_PAGINATION_ELEMENT_COUNTS).toStrictEqual([7, 9, 11, 13, 15, 17])
  })

  it.each([
    // [available width, expected element count] for a 34px button with 6px of margins (pitch 40)
    [0, 7],
    [279, 7],
    [280, 7],
    [319, 7],
    [359, 7],
    [360, 9],
    [439, 9],
    [440, 11],
    [519, 11],
    [520, 13],
    [599, 13],
    [600, 15],
    [679, 15],
    [680, 17],
    [1920, 17],
  ])('[AC 8.35] picks the largest step that fits %ipx -> %i', (availableWidth, expected) => {
    expect(
      selectExtendedPaginationElementCount({ availableWidth, itemPitch: 40, pageCount: 47 }),
    ).toBe(expected)
  })

  it('[AC 8.35] follows the measured pitch rather than a fixed button size', () => {
    expect(
      selectExtendedPaginationElementCount({ availableWidth: 400, itemPitch: 44, pageCount: 47 }),
    ).toBe(9)
    expect(
      selectExtendedPaginationElementCount({ availableWidth: 400, itemPitch: 30, pageCount: 47 }),
    ).toBe(13)
  })

  it('[AC 8.35] never grows by a single element: every result is one of the odd steps', () => {
    for (let width = 0; width <= 800; width += 1) {
      const count = selectExtendedPaginationElementCount({
        availableWidth: width,
        itemPitch: 40,
        pageCount: 99,
      })

      expect(EXTENDED_PAGINATION_ELEMENT_COUNTS).toContain(count)
    }
  })

  it('[AC 8.36] shows only the pages that exist when there are fewer than the width allows', () => {
    expect(
      selectExtendedPaginationElementCount({ availableWidth: 1920, itemPitch: 40, pageCount: 2 }),
    ).toBe(4)
    expect(
      selectExtendedPaginationElementCount({ availableWidth: 1920, itemPitch: 40, pageCount: 3 }),
    ).toBe(5)
    expect(
      selectExtendedPaginationElementCount({ availableWidth: 1920, itemPitch: 40, pageCount: 5 }),
    ).toBe(7)
    expect(
      selectExtendedPaginationElementCount({ availableWidth: 1920, itemPitch: 40, pageCount: 6 }),
    ).toBe(8)
    expect(
      selectExtendedPaginationElementCount({ availableWidth: 1920, itemPitch: 40, pageCount: 15 }),
    ).toBe(17)
    expect(
      selectExtendedPaginationElementCount({ availableWidth: 300, itemPitch: 40, pageCount: 3 }),
    ).toBe(5)
  })
})

describe('computeExtendedPaginationPages', () => {
  it('[AC 8.37] centers the current page when there is room on both sides', () => {
    expect(computeExtendedPaginationPages(47, 24, 7)).toStrictEqual([22, 23, 24, 25, 26])
    expect(computeExtendedPaginationPages(47, 24, 17)).toStrictEqual([
      17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    ])
  })

  it('[AC 8.37] shifts the window to the other side near the first and last page, keeping the count', () => {
    expect(computeExtendedPaginationPages(47, 1, 7)).toStrictEqual([1, 2, 3, 4, 5])
    expect(computeExtendedPaginationPages(47, 2, 7)).toStrictEqual([1, 2, 3, 4, 5])
    expect(computeExtendedPaginationPages(47, 3, 7)).toStrictEqual([1, 2, 3, 4, 5])
    expect(computeExtendedPaginationPages(47, 4, 7)).toStrictEqual([2, 3, 4, 5, 6])
    expect(computeExtendedPaginationPages(47, 47, 7)).toStrictEqual([43, 44, 45, 46, 47])
    expect(computeExtendedPaginationPages(47, 46, 7)).toStrictEqual([43, 44, 45, 46, 47])
    expect(computeExtendedPaginationPages(47, 1, 17)).toStrictEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ])
  })

  it('[AC 8.36] lists every page when the element count covers them all', () => {
    expect(computeExtendedPaginationPages(2, 1, 4)).toStrictEqual([1, 2])
    expect(computeExtendedPaginationPages(3, 2, 5)).toStrictEqual([1, 2, 3])
    expect(computeExtendedPaginationPages(6, 6, 8)).toStrictEqual([1, 2, 3, 4, 5, 6])
  })

  it('[AC 8.37] for every page count, current page and step: sorted, in range, contains the current page, constant length', () => {
    for (let pageCount = 2; pageCount <= 60; pageCount += 1) {
      for (const stepCount of EXTENDED_PAGINATION_ELEMENT_COUNTS) {
        const elementCount = Math.min(stepCount, pageCount + 2)
        const expectedLength = elementCount - 2
        for (let current = 1; current <= pageCount; current += 1) {
          const pages = computeExtendedPaginationPages(pageCount, current, elementCount)

          expect(pages).toHaveLength(expectedLength)
          expect(pages[0]).toBeGreaterThanOrEqual(1)
          expect(pages[pages.length - 1]).toBeLessThanOrEqual(pageCount)
          expect(pages).toContain(current)
          pages.forEach((page, index) => {
            if (index > 0) {
              expect(page).toBe(pages[index - 1] + 1)
            }
          })
        }
      }
    }
  })

  it('[AC 8.37] clamps a current page outside 1..pageCount instead of listing pages that do not exist', () => {
    expect(computeExtendedPaginationPages(10, 99, 7)).toStrictEqual([6, 7, 8, 9, 10])
    expect(computeExtendedPaginationPages(10, 0, 7)).toStrictEqual([1, 2, 3, 4, 5])
  })
})

describe('isValidExtendedPaginationInput', () => {
  it.each([
    ['1', 47, true],
    ['47', 47, true],
    ['007', 47, true],
    ['24', 47, true],
  ])('[AC 8.41] accepts %s (max %i)', (value, pageCount, expected) => {
    expect(isValidExtendedPaginationInput(value, pageCount)).toBe(expected)
  })

  it.each([
    ['', 'empty'],
    ['0', 'zero'],
    ['00', 'zero with leading zero'],
    ['-1', 'negative'],
    ['+1', 'explicit plus sign'],
    ['1.5', 'decimal'],
    ['1.0', 'decimal that equals an integer'],
    ['abc', 'letters'],
    ['1e1', 'exponent'],
    ['１２', 'full-width digits'],
    [' 5', 'leading space'],
    ['5 ', 'trailing space'],
    ['48', 'one above the last page'],
    ['9999999999999999999999', 'larger than any page'],
  ])('[AC 8.40] rejects %j (%s)', (value) => {
    expect(isValidExtendedPaginationInput(value, 47)).toBe(false)
  })
})

describe('computeDialogViewportMetrics', () => {
  it('[AC 8.42] derives the keyboard height, visible height and offset from the visual viewport', () => {
    expect(
      computeDialogViewportMetrics({ innerHeight: 800, viewportHeight: 500, viewportOffsetTop: 0 }),
    ).toStrictEqual({ keyboardHeight: 300, availableHeight: 476, offsetTop: 0 })
    expect(
      computeDialogViewportMetrics({
        innerHeight: 800,
        viewportHeight: 500.6,
        viewportOffsetTop: 40.9,
      }),
    ).toStrictEqual({ keyboardHeight: 299, availableHeight: 476, offsetTop: 40 })
  })

  it('[AC 8.42] never reports a negative keyboard height or offset and keeps at least 1px of height', () => {
    expect(
      computeDialogViewportMetrics({
        innerHeight: 600,
        viewportHeight: 700,
        viewportOffsetTop: -5,
      }),
    ).toStrictEqual({ keyboardHeight: 0, availableHeight: 676, offsetTop: 0 })
    expect(
      computeDialogViewportMetrics({ innerHeight: 600, viewportHeight: 10, viewportOffsetTop: 0 }),
    ).toStrictEqual({ keyboardHeight: 590, availableHeight: 1, offsetTop: 0 })
  })
})
