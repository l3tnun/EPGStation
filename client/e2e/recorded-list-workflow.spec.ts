import { expect, test } from '@playwright/test'
import { installAppShellApiMocks, isDesktopViewport } from './support/appShellMocks'
import {
  SYNTHETIC_RECORDED_DETAIL_ID,
  SYNTHETIC_RECORDED_ENCODED_VIDEO_ID,
  createRecordedRequestLog,
  installRecordedApiMocks,
  recordedFixtureSecrecyText,
} from './support/recordedMocks'
import { installStoragesUploadApiMocks } from './support/storagesUploadMocks'
import { setRecordedBrowserSettings } from './support/recordedWorkflow'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
  await installStoragesUploadApiMocks(page)
})

test('uses only synthetic Recorded fixture values', () => {
  const forbiddenFixturePatterns = [
    /kodi:\/\/|https?:\/\/(?!example\.invalid)/i,
    /user(name)?|password|token|secret|authorization/i,
    /\/Users\/|\/home\/[^/]+\/|[A-Z]:\\/,
  ]

  for (const pattern of forbiddenFixturePatterns) {
    expect(recordedFixtureSecrecyText).not.toMatch(pattern)
  }
  expect(recordedFixtureSecrecyText).toContain(String(SYNTHETIC_RECORDED_DETAIL_ID))
  expect(recordedFixtureSecrecyText).toContain(String(SYNTHETIC_RECORDED_ENCODED_VIDEO_ID))
})

test('renders list table/card states and drives menu/dialog handoffs', async ({
  page,
}, testInfo) => {
  await setRecordedBrowserSettings(page)
  const requestLog = createRecordedRequestLog()
  await installRecordedApiMocks(page, 'success', requestLog)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/recorded?keyword=Synthetic&ruleId=0&hasOriginalFile=true')

  await expect(
    page.getByTestId('title-bar').getByRole('heading', { name: '録画済み' }),
  ).toBeVisible()
  await expect(page.getByTestId('recorded-page')).toHaveAttribute('data-recorded-layout', 'table')
  await expect(page.getByRole('region', { name: '録画済み一覧' })).toBeVisible()
  await expect(page.getByText('Synthetic Recorded Matrix A')).toBeVisible()
  expect(requestLog.apiPaths).toContain(
    '/api/recorded?isHalfWidth=true&limit=24&offset=0&keyword=Synthetic&ruleId=0&hasOriginalFile=true',
  )

  await page.getByRole('button', { name: '録画検索' }).click()
  await expect(page.getByRole('menu', { name: '録画検索' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '録画済みメニュー' }).click()
  await expect(page.getByRole('menuitem', { name: '編集' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'クリーンアップ' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'アップロード' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'クリーンアップ' }).click()
  await expect(page.getByRole('dialog', { name: '録画クリーンアップ' })).toBeVisible()
  await page.getByRole('button', { name: 'キャンセル' }).click()

  await page.getByRole('button', { name: '録画メニュー: Synthetic Recorded Matrix A' }).click()
  await expect(page.getByRole('menuitem', { name: 'rule' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'search' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'protect' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'encode' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'delete' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    window.location.hash = '#/recorded/detail/8201?timestamp=recorded-detail-from-scroll-restore'
  })
  await expect(page).toHaveURL(
    /#\/recorded\/detail\/8201\?timestamp=recorded-detail-from-scroll-restore$/,
  )

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/recorded?timestamp=mobile')
  if (testInfo.project.name.startsWith('Desktop ') || testInfo.project.name === 'iOS Safari') {
    await expect(page.getByTestId('recorded-page')).toHaveAttribute(
      'data-recorded-layout',
      'small-card',
    )
  }
  await expect(page.getByTestId('recorded-list-item').first()).toBeVisible()
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute(
    'data-drawer-open',
    isDesktopViewport(page) ? 'true' : 'false',
  )
})

test('lets the Recorded large-card grid expand beyond three columns on wide screens', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'settings',
      JSON.stringify({
        recordedLength: 24,
        isShowTableMode: false,
        isPreferredPlayingOnWeb: true,
      }),
    )
  })
  await installRecordedApiMocks(page, 'success')

  await page.setViewportSize({ width: 1900, height: 900 })
  await page.goto('/#/recorded?timestamp=wide-card-grid')

  await expect(page.getByTestId('recorded-page')).toHaveAttribute(
    'data-recorded-layout',
    'large-card',
  )
  await expect(page.getByTestId('recorded-list-item')).toHaveCount(6)

  const firstRowCount = await page.getByTestId('recorded-list-item').evaluateAll((nodes) => {
    const tops = nodes.map((node) => Math.round(node.getBoundingClientRect().top))
    const firstTop = tops[0]

    return tops.filter((top) => Math.abs(top - firstTop) <= 2).length
  })

  // Provenance (C), confirmed by measurement: src/features/recorded/RecordedPage.module.css
  // `.cards { grid-template-columns: repeat(auto-fill, 300px); gap: 8px }` (line 151) at this
  // 1900px viewport (minus the drawer/padding) fits exactly 5 of the fixture's 6 items
  // (e2e/support/recordedMocks.ts 'success' fixture) in the first row, with the 6th wrapping to a
  // second row — reproduced directly against the running app, not just derived from the CSS.
  expect(firstRowCount).toBeGreaterThanOrEqual(5)
})
