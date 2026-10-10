import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { installAppShellApiMocks } from '../e2e/support/appShellMocks'
import { installRecordingEncodeApiMocks } from '../e2e/support/recordingEncodeMocks'
import { expectAnnounced } from '../e2e/support/notificationObservation'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
  await installRecordingEncodeApiMocks(page)
})

async function expectChromiumScreenshot(
  locator: Locator,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  if (testInfo.project.name !== 'Desktop Chromium') {
    return
  }

  await expect(locator).toHaveScreenshot(name)
}

async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  // Provenance (C): measured via a temporary console.log in this poll
  // (`npx playwright test visual/recording-encode-geometry.spec.ts`, 5 runs on Desktop Chromium
  // plus one run each on Desktop Firefox, Android Chrome, and iOS Safari, covering all 6 call
  // sites across both tests). Every reading was 0px; no source records a need for a 1px allowance,
  // so the threshold now matches the 0px used by every other visual suite.
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

async function expectLocatorInsideViewport(locator: Locator, page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox()
        const viewport = page.viewportSize()

        if (box === null || viewport === null) {
          return false
        }

        return (
          box.x >= 0 &&
          box.x + box.width <= viewport.width &&
          box.y >= 0 &&
          box.y + box.height <= viewport.height
        )
      },
      { timeout: 1500 },
    )
    .toBe(true)
}

async function expectListItemGeometryStable(list: Locator, expectedCount: number): Promise<void> {
  await expect
    .poll(() =>
      list.evaluate((element) => {
        const rows = Array.from(
          element.querySelectorAll<HTMLElement>(
            '[data-testid="recording-list-item"], [data-testid="encode-list-item"]',
          ),
        ).map((row) => {
          const rowRect = row.getBoundingClientRect()
          if (rowRect.width > 0 && rowRect.height > 0) {
            return rowRect
          }

          const cellRects = Array.from(row.children).map((child) => child.getBoundingClientRect())
          const visibleCells = cellRects.filter((cell) => cell.width > 0 && cell.height > 0)
          if (visibleCells.length === 0) {
            return rowRect
          }

          const left = Math.min(...visibleCells.map((cell) => cell.left))
          const right = Math.max(...visibleCells.map((cell) => cell.right))
          const top = Math.min(...visibleCells.map((cell) => cell.top))
          const bottom = Math.max(...visibleCells.map((cell) => cell.bottom))

          return {
            width: right - left,
            height: bottom - top,
          }
        })

        return {
          rowCount: rows.length,
          rowsHaveArea: rows.every((row) => row.width > 0 && row.height > 0),
          equalWidths:
            rows.length <= 1 || rows.every((row) => Math.abs(row.width - rows[0].width) < 1),
          stableHeights:
            rows.length <= 1 || rows.every((row) => Math.abs(row.height - rows[0].height) <= 80),
        }
      }),
    )
    .toMatchObject({
      rowCount: expectedCount,
      rowsHaveArea: true,
      equalWidths: true,
      stableHeights: true,
    })
}

test('[AC 1.27] keeps Recording list geometry stable on desktop and mobile', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/recording')

  const pageRegion = page.getByTestId('recording-page')
  await expect(pageRegion).toHaveAttribute('data-recording-total', '2')
  await expectNoDocumentHorizontalOverflow(page)
  await expectListItemGeometryStable(pageRegion, 2)
  await expectChromiumScreenshot(pageRegion, testInfo, 'recording-list.png')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/recording?timestamp=mobile')
  const mobileRecordingPage = page.getByTestId('recording-page')
  await expectLocatorInsideViewport(mobileRecordingPage, page)
  await expectNoDocumentHorizontalOverflow(page)
  await expectListItemGeometryStable(mobileRecordingPage, 2)
  await expectChromiumScreenshot(mobileRecordingPage, testInfo, 'recording-list-mobile.png')

  await page.getByRole('button', { name: '録画中を編集' }).click()
  await page.getByTestId('recording-list-item').first().click()
  await page.getByRole('button', { name: '選択項目を削除' }).click()
  const dialog = page.getByRole('dialog', { name: '録画一括削除' })
  await expect(dialog).toBeVisible()
  await expectLocatorInsideViewport(dialog, page)
  await expectChromiumScreenshot(dialog, testInfo, 'recording-bulk-delete-dialog-mobile.png')
})

test('keeps Encode list geometry stable on desktop and mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/encode')

  const pageRegion = page.getByTestId('encode-page')
  await expect(pageRegion).toHaveAttribute('data-running-count', '2')
  await expect(pageRegion).toHaveAttribute('data-waiting-count', '1')
  await expectNoDocumentHorizontalOverflow(page)
  await expectListItemGeometryStable(pageRegion, 3)
  await expectChromiumScreenshot(pageRegion, testInfo, 'encode-list.png')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/encode?timestamp=mobile')
  const mobileEncodePage = page.getByTestId('encode-page')
  await expectLocatorInsideViewport(mobileEncodePage, page)
  await expectNoDocumentHorizontalOverflow(page)
  await expectListItemGeometryStable(mobileEncodePage, 3)
  await expectChromiumScreenshot(mobileEncodePage, testInfo, 'encode-list-mobile.png')

  await page.getByRole('button', { name: 'エンコード停止: Synthetic Encode Running' }).click()
  const singleDialog = page.getByRole('dialog').filter({ hasText: 'Synthetic Encode Running' })
  await expect(singleDialog).toBeVisible()
  await expectLocatorInsideViewport(singleDialog, page)
  await expectChromiumScreenshot(singleDialog, testInfo, 'encode-single-cancel-dialog-mobile.png')

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'エンコードを編集' }).click()
  await page.getByRole('button', { name: 'すべて選択' }).click()
  await page.getByRole('button', { name: '選択項目を削除' }).click()
  const bulkDialog = page.getByRole('dialog').filter({ hasText: '選択した' })
  await expect(bulkDialog).toBeVisible()
  await expectLocatorInsideViewport(bulkDialog, page)
})

test.describe('Chromium blank/error screenshots', () => {
  test('captures Recording and Encode blank/error presentations', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'Desktop Chromium') {
      return
    }

    await page.unrouteAll()
    await installAppShellApiMocks(page)
    await installRecordingEncodeApiMocks(page, { mode: 'recording-empty' })
    await page.goto('/#/recording?timestamp=empty')
    await expect(page.getByTestId('recording-page')).toHaveCount(0)
    await expectNoDocumentHorizontalOverflow(page)
    await expect(page.locator('body')).toHaveScreenshot('recording-empty-body.png')

    await page.unrouteAll()
    await installAppShellApiMocks(page)
    await installRecordingEncodeApiMocks(page, { mode: 'recording-failure' })
    await page.goto('/#/recording?timestamp=error')
    await expectAnnounced(page, '録画データ取得に失敗')
    await expectNoDocumentHorizontalOverflow(page)

    await page.unrouteAll()
    await installAppShellApiMocks(page)
    await installRecordingEncodeApiMocks(page, { mode: 'encode-empty' })
    await page.goto('/#/encode?timestamp=empty')
    await expect(page.getByTestId('encode-page')).toHaveAttribute('data-running-count', '0')
    await expect(page.getByTestId('encode-page')).toHaveScreenshot('encode-empty.png')

    await page.unrouteAll()
    await installAppShellApiMocks(page)
    await installRecordingEncodeApiMocks(page, { mode: 'encode-failure' })
    await page.goto('/#/recording?timestamp=before-encode-error')
    await page.goto('/#/encode?timestamp=error')
    await expectAnnounced(page, 'エンコード情報取得に失敗')
    await expect(page.getByTestId('encode-page')).toHaveScreenshot('encode-error.png')
  })
})
