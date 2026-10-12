import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from '../e2e/support/appShellMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
})

test('[AC 1.16] keeps the settings card centered and capped on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/settings')

  const card = page.getByTestId('settings-card')
  const cardBox = await card.boundingBox()
  const viewport = page.viewportSize()

  expect(viewport).not.toBeNull()
  expect(cardBox).not.toBeNull()
  expect(cardBox?.width).toBeLessThanOrEqual(800)
  // Source B: vuetify (a v2 dependency) lib/components/
  // VNavigationDrawer/VNavigationDrawer.js:76 — Vuetify 2's v-navigation-drawer `width` prop
  // `default: 256`, the drawer width v2 rendered with. v3 keeps the same 256px reserved for the
  // drawer (src/app/drawerLayout.ts APP_SHELL_DRAWER_WIDTH) and centers the settings card in the
  // remaining viewport width; toBeCloseTo(..., 0) allows ±0.5px sub-pixel rounding.
  expect(cardBox?.x).toBeGreaterThan(256)
  expect(cardBox?.x).toBeCloseTo(
    256 + ((viewport?.width ?? 0) - 256 - (cardBox?.width ?? 0)) / 2,
    0,
  )
})

test('[AC 1.15] does not horizontally overflow with long URL scheme placeholders on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/settings')

  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement

    return documentElement.scrollWidth - documentElement.clientWidth
  })

  await expect(page.getByTestId('settings-card')).toBeVisible()
  await expect(page.getByTestId('settings-url-scheme-placeholder')).toBeVisible()
  // Source D: no v2 equivalent (v2 shipped no e2e/visual tests). v3-introduced contract: the
  // document must never grow wider than the viewport, i.e. no horizontal scrollbar.
  expect(overflow).toBeLessThanOrEqual(0)
})

async function inspectSettingsGeometry(page: import('@playwright/test').Page) {
  return page.getByTestId('settings-card').evaluate((card) => {
    const cardRect = card.getBoundingClientRect()
    const rows = Array.from(card.querySelectorAll('label'))
    const actionContainers = Array.from(card.querySelectorAll('button'))
      .map((button) => button.parentElement)
      .filter((element, index, elements): element is HTMLElement => {
        return element !== null && elements.indexOf(element) === index
      })
    const verticalElements = [
      ...Array.from(card.querySelectorAll('h2, label')),
      ...actionContainers,
    ].sort(
      (first, second) => first.getBoundingClientRect().top - second.getBoundingClientRect().top,
    )
    const verticalItems = verticalElements.map((element) => {
      const rect = element.getBoundingClientRect()

      return {
        top: rect.top,
        bottom: rect.bottom,
      }
    })

    return {
      rowCount: rows.length,
      verticalOverlapCount: verticalItems.reduce((count, item, index) => {
        const previous = verticalItems[index - 1]

        return previous !== undefined && item.top < previous.bottom ? count + 1 : count
      }, 0),
      rows: rows.map((row) => {
        const rowRect = row.getBoundingClientRect()
        const childRects = Array.from(row.children).map((child) => {
          const rect = child.getBoundingClientRect()

          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          }
        })

        return {
          withinCard: rowRect.left >= cardRect.left && rowRect.right <= cardRect.right,
          childCount: childRects.length,
          overlaps:
            childRects.length >= 2 &&
            childRects[0].right > childRects[1].left &&
            childRects[0].bottom > childRects[1].top &&
            childRects[0].top < childRects[1].bottom,
        }
      }),
    }
  })
}

const settingsGeometryCases = [
  { name: 'desktop light', viewport: { width: 1440, height: 900 }, theme: 'light' },
  { name: 'desktop dark', viewport: { width: 1440, height: 900 }, theme: 'dark' },
  { name: 'mobile light', viewport: { width: 390, height: 844 }, theme: 'light' },
  { name: 'mobile dark', viewport: { width: 390, height: 844 }, theme: 'dark' },
] as const

for (const geometryCase of settingsGeometryCases) {
  test(`[AC 1.15] keeps settings controls non-overlapping on ${geometryCase.name} theme`, async ({
    page,
  }) => {
    await page.setViewportSize(geometryCase.viewport)
    await installAppShellApiMocks(page, { forceDarkTheme: geometryCase.theme === 'dark' })
    await page.goto('/#/settings')

    const geometry = await inspectSettingsGeometry(page)

    await expect(page.getByTestId('app-shell')).toHaveAttribute(
      'data-theme-mode',
      geometryCase.theme,
    )
    // Provenance (C): the settings form's field/label set is fixed regardless of viewport or
    // theme (mocked API data does not add or remove settings rows). Measured via a
    // temporary console.log (`npx playwright test visual/settings-screen-geometry.spec.ts -g
    // non-overlapping`, 3 runs x 4 cases): rowCount was 32 in every desktop/mobile x light/dark
    // combination. Pinned exactly so a row silently disappearing (or a stray extra `<label>`) is
    // caught, instead of only guarding against the list being fully empty.
    expect(geometry.rowCount).toBe(32)
    expect(geometry.verticalOverlapCount).toBe(0)
    expect(geometry.rows.every((row) => row.withinCard)).toBe(true)
    if (geometryCase.viewport.width >= 600) {
      expect(geometry.rows.every((row) => row.childCount >= 2)).toBe(true)
      expect(geometry.rows.some((row) => row.overlaps)).toBe(false)
    }
  })
}
