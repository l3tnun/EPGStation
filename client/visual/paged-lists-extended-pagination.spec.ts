import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { installAppShellApiMocks } from '../e2e/support/appShellMocks'
import {
  firstPositionOf,
  installPagedListApiMocks,
  pagedItemName,
} from '../e2e/support/pagedListMocks'
import { seedExtendedPagination } from '../e2e/support/searchRuleMocks'

// The recorded, recording and reserves lists show the same extended pagination as the rule list
// (search-rule-extended-pagination.spec.ts) when the setting is on. Snapshots exist for Desktop
// Chromium only, like every other visual suite.
function isSnapshotProject(testInfo: TestInfo): boolean {
  return testInfo.project.name === 'Desktop Chromium'
}

const SCREENS = [
  { screen: 'recorded', hash: '/#/recorded' },
  { screen: 'recording', hash: '/#/recording' },
  { screen: 'reserves', hash: '/#/reserves' },
] as const

async function openList(page: Page, hash: string, listPage: number, dark: boolean): Promise<void> {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true, forceDarkTheme: dark })
  await installPagedListApiMocks(page)
  await seedExtendedPagination(page, true)
  await page.goto(`${hash}?page=${listPage}`)
  await expect(page.getByText(pagedItemName(firstPositionOf(listPage))).first()).toBeVisible()
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

for (const { screen, hash } of SCREENS) {
  for (const [width, height] of [
    [375, 667],
    [1280, 800],
  ] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${screen} extended pagination at ${width}px in the ${theme} theme`, async ({
        page,
      }, testInfo) => {
        test.skip(!isSnapshotProject(testInfo), 'snapshots are taken on Desktop Chromium')
        await page.setViewportSize({ width, height })
        await openList(page, hash, 24, theme === 'dark')

        await expect(page.getByRole('navigation', { name: 'ページ' })).toHaveScreenshot(
          `${screen}-extended-pagination-${width}-${theme}.png`,
        )
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )
        expect(overflow).toBeLessThanOrEqual(0)
      })
    }
  }
}
