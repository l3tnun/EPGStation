import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { installAppShellApiMocks } from '../e2e/support/appShellMocks'
import {
  installPagedRuleListApiMocks,
  installSearchRuleWorkflowApiMocks,
  seedExtendedPagination,
} from '../e2e/support/searchRuleMocks'

// Snapshots exist for Desktop Chromium only, like every other visual suite.
function isSnapshotProject(testInfo: TestInfo): boolean {
  return testInfo.project.name === 'Desktop Chromium'
}

async function openRuleList(page: Page, ruleListPage: number, dark: boolean): Promise<void> {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true, forceDarkTheme: dark })
  await installSearchRuleWorkflowApiMocks(page)
  await installPagedRuleListApiMocks(page)
  await seedExtendedPagination(page, true)
  await page.goto(`/#/rule?page=${ruleListPage}`)
  await expect(page.getByTestId(`rule-item-${10000 + (ruleListPage - 1) * 24}`)).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'ページ' })).toBeVisible()
  // Let the measured element count settle before taking the picture.
  await expect
    .poll(() =>
      page
        .getByRole('navigation', { name: 'ページ' })
        .evaluate((nav) => nav.querySelectorAll('button').length),
    )
    .toBeGreaterThan(0)
  await page.waitForTimeout(300)
}

for (const [width, height] of [
  [375, 667],
  [768, 1024],
  [1280, 800],
] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`extended pagination at ${width}px in the ${theme} theme`, async ({ page }, testInfo) => {
      test.skip(!isSnapshotProject(testInfo), 'snapshots are taken on Desktop Chromium')
      await page.setViewportSize({ width, height })
      await openRuleList(page, 24, theme === 'dark')

      await expect(page.getByRole('navigation', { name: 'ページ' })).toHaveScreenshot(
        `rule-extended-pagination-${width}-${theme}.png`,
      )
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
    })
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`extended pagination at the first page at 375px in the ${theme} theme`, async ({
    page,
  }, testInfo) => {
    test.skip(!isSnapshotProject(testInfo), 'snapshots are taken on Desktop Chromium')
    await page.setViewportSize({ width: 375, height: 667 })
    await openRuleList(page, 1, theme === 'dark')

    await expect(page.getByRole('navigation', { name: 'ページ' })).toHaveScreenshot(
      `rule-extended-pagination-first-375-${theme}.png`,
    )
  })
}

for (const [width, height] of [
  [375, 667],
  [1280, 800],
] as const) {
  test(`page number dialog at ${width}px`, async ({ page }, testInfo) => {
    test.skip(!isSnapshotProject(testInfo), 'snapshots are taken on Desktop Chromium')
    await page.setViewportSize({ width, height })
    await openRuleList(page, 24, false)

    await page.getByRole('button', { name: 'ページ数を入力して移動' }).click()
    const dialog = page.getByRole('dialog', { name: 'ページ数を入力' })
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(300)

    await expect(dialog).toHaveScreenshot(`rule-extended-pagination-dialog-${width}.png`)
  })
}
