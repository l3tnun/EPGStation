import { expect, test, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  installPagedRuleListApiMocks,
  installSearchRuleWorkflowApiMocks,
  seedExtendedPagination,
} from './support/searchRuleMocks'

// How narrow can the rule list get before its pagination breaks? Measured for the current
// pagination and for the extended one, on the first, a middle and the last page of 47. The
// extended pagination must not break at any width where the current one does not.
const WIDEST = 400
const NARROWEST = 296
const PAGES = [1, 24, 47]

// Measured: 7 elements of 40px (280px) plus the page's own side padding.
const EXTENDED_MINIMUM_WIDTH = 298
// Measured: 7 buttons of 36px, 6 gaps of 8px and 8px of padding on both sides, plus the page's padding.
const LEGACY_MINIMUM_WIDTH = 328

interface Reading {
  width: number
  count: number
  isBroken: boolean
}

async function read(page: Page, width: number): Promise<Reading> {
  return page.evaluate((viewportWidth) => {
    const nav = document.querySelector<HTMLElement>('nav[aria-label="ページ"]')
    if (nav === null) {
      throw new Error('no pagination')
    }
    const buttons = Array.from(nav.querySelectorAll<HTMLElement>('button'))
    const rects = buttons.map((button) => button.getBoundingClientRect())
    const clientWidth = document.documentElement.clientWidth
    const oneRow = new Set(buttons.map((button) => button.offsetTop)).size === 1
    // The current page is drawn larger with a transform; compare the layout boxes instead.
    const boxes = buttons.map((button) => ({
      left: button.offsetLeft + nav.getBoundingClientRect().left,
      width: button.offsetWidth,
    }))
    const overlaps = boxes.some(
      (box, index) => index > 0 && box.left < boxes[index - 1].left + boxes[index - 1].width - 0.5,
    )
    const outside = rects.some((rect) => rect.left < -2 || rect.right > clientWidth + 2)
    const overflows =
      nav.scrollWidth > nav.clientWidth ||
      document.documentElement.scrollWidth > clientWidth ||
      nav.getBoundingClientRect().right > clientWidth + 0.5

    return {
      width: viewportWidth,
      count: buttons.length,
      isBroken: !oneRow || overlaps || outside || overflows,
    }
  }, width)
}

async function sweep(page: Page, ruleListPage: number): Promise<Reading[]> {
  await page.setViewportSize({ width: WIDEST, height: 800 })
  await page.goto(`/#/rule?page=${ruleListPage}`)
  await expect(page.getByRole('navigation', { name: 'ページ' })).toBeVisible()
  const readings: Reading[] = []
  // From wide to narrow without reloading: the row has to follow the viewport as it shrinks.
  for (let width = WIDEST; width >= NARROWEST; width -= 1) {
    await page.setViewportSize({ width, height: 800 })
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    await page.waitForTimeout(60)
    readings.push(await read(page, width))
  }

  return readings
}

// The narrowest width such that this width and every wider one is unbroken.
function minimumUnbrokenWidth(readings: Reading[]): number {
  const firstBroken = readings.findIndex((reading) => reading.isBroken)

  return firstBroken === -1 ? NARROWEST : readings[firstBroken - 1].width
}

test.describe('narrowest viewport of the rule list pagination', () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      browserName !== 'chromium' || testInfo.project.name !== 'Desktop Chromium',
      'the width sweep runs once, on desktop Chromium',
    )
    test.setTimeout(300_000)
  })

  test.describe.configure({ mode: 'serial' })

  const minimums: Record<string, number> = {}

  for (const mode of ['legacy', 'extended'] as const) {
    test(`${mode} pagination: narrowest unbroken width on pages 1, 24 and 47`, async ({ page }) => {
      await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
      await installSearchRuleWorkflowApiMocks(page)
      await installPagedRuleListApiMocks(page)
      await seedExtendedPagination(page, mode === 'extended')

      for (const ruleListPage of PAGES) {
        const readings = await sweep(page, ruleListPage)
        const minimum = minimumUnbrokenWidth(readings)

        minimums[`${mode}-${ruleListPage}`] = minimum
        expect(minimum, `${mode} page ${ruleListPage} narrowest unbroken width`).toBe(
          mode === 'legacy' ? LEGACY_MINIMUM_WIDTH : EXTENDED_MINIMUM_WIDTH,
        )
        if (mode === 'extended') {
          // Never fewer than the 7-element minimum, and 7 at the narrowest width.
          expect(readings.find((reading) => reading.width === minimum)?.count).toBe(7)
        }
      }
    })
  }

  test('extended pagination is never narrower-limited than the current one', () => {
    for (const ruleListPage of PAGES) {
      expect(minimums[`extended-${ruleListPage}`]).toBeLessThanOrEqual(
        minimums[`legacy-${ruleListPage}`],
      )
    }
  })
})
