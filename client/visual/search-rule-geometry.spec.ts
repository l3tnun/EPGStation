import { expect, test, type Page } from '@playwright/test'
import { installAppShellApiMocks } from '../e2e/support/appShellMocks'
import { installSearchRuleWorkflowApiMocks } from '../e2e/support/searchRuleMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
  await installSearchRuleWorkflowApiMocks(page)
})

async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  // Provenance (C): measured via a temporary console.log inside this poll
  // (`npx playwright test visual/search-rule-geometry.spec.ts`, 5 runs). All 4 call sites settle
  // to 0px; the mobile-viewport call site transiently reads ~1050px on the poll's first tick right
  // after `page.goto` (stale desktop-width layout before the SPA reflows to the new viewport) but
  // always converges to 0 on the next tick, well within the 1500ms budget. `.poll` is kept (rather
  // than the single-evaluate style used elsewhere in this repo) specifically to absorb that
  // navigation-timing transient without loosening the threshold; every other visual suite's
  // horizontal-overflow check is 0.
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      { timeout: 1500 },
    )
    .toBeLessThanOrEqual(0)
}

async function readListGeometry(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const items = Array.from(element.querySelectorAll<HTMLElement>('[role="listitem"]')).map(
      (item) => item.getBoundingClientRect(),
    )

    return {
      hasArea: rect.width > 0 && rect.height > 0,
      itemCount: items.length,
      itemsHaveArea: items.every((item) => item.width > 0 && item.height > 0),
      listWidth: rect.width,
      minimumItemWidth: Math.min(...items.map((item) => item.width)),
    }
  })
}

test('keeps Search result and Rule list geometry stable across desktop and mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/search?keyword=Synthetic')
  await expect(page.getByText('1 件ヒット')).toBeVisible()
  await expectNoDocumentHorizontalOverflow(page)
  await expect(readListGeometry(page, '[aria-label="検索結果一覧"]')).resolves.toMatchObject({
    hasArea: true,
    itemCount: 1,
    itemsHaveArea: true,
  })

  await page.goto('/#/rule?keyword=Synthetic')
  await expect(page.getByRole('heading', { name: 'ルール' })).toBeVisible()
  await expectNoDocumentHorizontalOverflow(page)
  await expect(
    readListGeometry(page, '[role="list"][aria-label="ルール一覧"]'),
  ).resolves.toMatchObject({
    hasArea: true,
    itemCount: 2,
    itemsHaveArea: true,
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/rule?keyword=Synthetic&viewport=mobile')
  await expect(page.getByText('Synthetic Rule Alpha')).toBeVisible()
  await expectNoDocumentHorizontalOverflow(page)
  await expect(
    readListGeometry(page, '[role="list"][aria-label="ルール一覧"]'),
  ).resolves.toMatchObject({
    hasArea: true,
    itemCount: 2,
    itemsHaveArea: true,
  })

  await page.goto('/#/search?keyword=Synthetic&viewport=mobile-results')
  await expect(page.getByText('1 件ヒット')).toBeVisible()
  await expectNoDocumentHorizontalOverflow(page)
  const resultGeometry = await readListGeometry(page, '[aria-label="検索結果一覧"]')
  expect(resultGeometry).toMatchObject({
    hasArea: true,
    itemCount: 1,
    itemsHaveArea: true,
  })
  expect(resultGeometry.listWidth).toBeGreaterThan(0)
  expect(resultGeometry.minimumItemWidth).toBeGreaterThan(0)
})

async function installMixedMocks(page: Page): Promise<void> {
  await page.unrouteAll()
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
  await installSearchRuleWorkflowApiMocks(page, { mixed: true })
}

/** Rects of the direct children of a list, with the list rect, for overlap checks. */
async function readRowRects(page: Page, selector: string) {
  return page.locator(selector).evaluate((list) => {
    const listRect = list.getBoundingClientRect()
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[role="listitem"]')).map((row) => {
      const rect = row.getBoundingClientRect()

      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
    })

    return { list: { left: listRect.left, right: listRect.right }, rows }
  })
}

function expectRowsStackedInside(
  geometry: Awaited<ReturnType<typeof readRowRects>>,
  rowCount: number,
): void {
  expect(geometry.rows).toHaveLength(rowCount)
  geometry.rows.forEach((row, index) => {
    expect(row.right - row.left, `row ${index} width`).toBeGreaterThan(0)
    expect(row.bottom - row.top, `row ${index} height`).toBeGreaterThan(0)
    // Rows stay inside the list horizontally and never overlap the previous row.
    expect(row.left, `row ${index} left`).toBeGreaterThanOrEqual(geometry.list.left - 0.5)
    expect(row.right, `row ${index} right`).toBeLessThanOrEqual(geometry.list.right + 0.5)
    if (index > 0) {
      expect(row.top, `row ${index} top`).toBeGreaterThanOrEqual(
        geometry.rows[index - 1].bottom - 0.5,
      )
    }
  })
}

test('keeps 20 mixed search results inside the card without overlap', async ({ page }) => {
  await installMixedMocks(page)

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto(`/#/search?keyword=Synthetic&viewport=${viewport.width}`)
    await expect(page.getByText('20 件ヒット')).toBeVisible()
    await expectNoDocumentHorizontalOverflow(page)
    expectRowsStackedInside(await readRowRects(page, '[aria-label="検索結果一覧"]'), 20)
  }
})

test('keeps 12 mixed rules aligned in table and list layouts with the pagination below', async ({
  page,
}) => {
  await installMixedMocks(page)

  for (const [width, layout] of [
    [1440, 'table'],
    [780, 'table'],
    [779, 'list'],
    [390, 'list'],
  ] as const) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`/#/rule?viewport=${width}`)
    await expect(page.getByTestId('rule-page')).toHaveAttribute('data-rule-layout', layout)
    await expect(page.getByText('Synthetic Mixed Rule 3')).toBeVisible()
    await expectNoDocumentHorizontalOverflow(page)

    const geometry = await readRowRects(page, '[role="list"][aria-label="ルール一覧"]')
    expectRowsStackedInside(geometry, 12)

    const paginationTop = await page
      .getByRole('navigation', { name: 'ページ' })
      .evaluate((nav) => nav.getBoundingClientRect().top)
    expect(paginationTop).toBeGreaterThanOrEqual(
      geometry.rows[geometry.rows.length - 1].bottom - 0.5,
    )
  }
})
