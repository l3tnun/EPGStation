import { expectDarkCardsUseTheme } from './support/darkUiExpectations'
import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { installDashboardWorkflowApiMocks } from './support/dashboardMocks'
import { installGuideOnAirApiMocks } from './support/guideOnAirMocks'
import { installRecordedApiMocks } from './support/recordedMocks'
import { installRecordingEncodeApiMocks } from './support/recordingEncodeMocks'
import { installReservesApiMocks } from './support/reservesMocks'
import { installStoragesUploadApiMocks } from './support/storagesUploadMocks'
import { installSearchRuleWorkflowApiMocks } from './support/searchRuleMocks'
import { collectVisibleUiAuditRows, expectNoUiAuditFailures } from './support/uiAudit'
import { openDarkManualReserveTimeSpecifiedForm } from './support/uiAuditStates'
import {
  SYNTHETIC_RECORDED_ID,
  SYNTHETIC_STREAMING_VIDEO_FILE_ID,
  installVideoPlaybackApiMocks,
} from './support/videoPlaybackMocks'

test('audits dark Rule mobile card count and menu affordance contrast', async ({
  page,
}, testInfo) => {
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installSearchRuleWorkflowApiMocks(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/rule')

  const firstRule = page.getByTestId('rule-item-6201')
  await expect(firstRule).toBeVisible()

  const darkCardIssues = await firstRule.evaluate((node) => {
    function isBlackToken(value: string): boolean {
      return /^rgba?\(0,\s*0,\s*0(?:,|\))/.test(value)
    }

    const count = node.querySelector('button > span:nth-child(5)')
    const menuGlyph = node.querySelector('button[aria-label^="ルールメニュー:"] span[aria-hidden]')
    const issues: string[] = []

    if (count === null) {
      issues.push('missing reserve count span')
    } else {
      const color = getComputedStyle(count).color
      if (isBlackToken(color)) {
        issues.push(`reserve count uses black token ${color}`)
      }
    }

    if (menuGlyph === null) {
      issues.push('missing mobile rule menu glyph')
    } else {
      const color = getComputedStyle(menuGlyph, '::after').color
      if (isBlackToken(color)) {
        issues.push(`menu affordance uses black token ${color}`)
      }
    }

    return issues
  })

  expect(darkCardIssues).toEqual([])

  await firstRule.getByRole('button', { name: /ルールメニュー:/ }).click()
  const rows = await collectVisibleUiAuditRows(page, {
    page: 'rule',
    route: '/rule',
    dataState: 'rule mobile card',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'action menu open',
    component: 'rule action menu',
    rootSelector: '[role="menu"]',
  })

  testInfo.attach('dark-rule-mobile-menu-audit.json', {
    body: JSON.stringify(rows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(rows)
})

test('[AC frontend-app-shell 7.7] [AC frontend-app-shell 7.8] audits dark card surfaces across routed owners', async ({
  page,
}) => {
  await page.unrouteAll()
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installDashboardWorkflowApiMocks(page)
  await page.goto('/#/')
  await expect(page.getByTestId('dashboard-page')).toBeVisible()
  await expectDarkCardsUseTheme(page, [
    { label: 'dashboard sections', selector: '[data-testid^="dashboard-section-"]' },
  ])

  await page.unrouteAll()
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await page.goto('/#/settings')
  await expect(page.getByTestId('settings-card')).toBeVisible()
  await expectDarkCardsUseTheme(page, [
    { label: 'settings card', selector: '[data-testid="settings-card"]' },
  ])

  await page.unrouteAll()
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installSearchRuleWorkflowApiMocks(page)
  await page.goto('/#/search')
  await expect(page.locator('[class*="searchCard"]').first()).toBeVisible()
  await expectDarkCardsUseTheme(page, [{ label: 'search card', selector: '[class*="searchCard"]' }])
  await page.getByLabel('keyword', { exact: true }).fill('Synthetic')
  await page.getByTestId('search-rule-page').getByRole('button', { name: '検索' }).click()
  await expect(page.locator('[class*="resultItem"]').first()).toBeVisible()
  await expect(page.locator('[class*="ruleOptionCard"]').first()).toBeVisible()
  await expectDarkCardsUseTheme(page, [
    { label: 'search result items', selector: '[class*="resultItem"]' },
    { label: 'search rule option card', selector: '[class*="ruleOptionCard"]' },
  ])
  await page.goto('/#/rule')
  await expect(page.locator('[data-testid^="rule-item-"]').first()).toBeVisible()
  await expectDarkCardsUseTheme(page, [
    { label: 'rule list items', selector: '[data-testid^="rule-item-"]' },
  ])

  await page.unrouteAll()
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installReservesApiMocks(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/reserves')
  await expect(page.getByTestId('reserves-list-item').first()).toBeVisible()
  await expectDarkCardsUseTheme(page, [
    { label: 'reserve cards', selector: '[data-testid="reserves-list-item"]' },
  ])
  await page.goto('/#/reserves/manual')
  await expect(page.locator('[class*="manualOptionsCard"]').first()).toBeVisible()
  await expectDarkCardsUseTheme(page, [
    { label: 'manual reserve options card', selector: '[class*="manualOptionsCard"]' },
  ])
  await openDarkManualReserveTimeSpecifiedForm(page)
  await expect(page.locator('[class*="manualTimeReserveCard"]').first()).toBeVisible()
  await expectDarkCardsUseTheme(page, [
    { label: 'manual reserve time card', selector: '[class*="manualTimeReserveCard"]' },
  ])

  const recordedPage = await page.context().newPage()
  try {
    await installAppShellApiMocks(recordedPage, {
      enableBroadcastWaveNavigation: true,
      forceDarkTheme: true,
    })
    await installRecordedApiMocks(recordedPage)
    await recordedPage.setViewportSize({ width: 390, height: 844 })
    await recordedPage.goto('/?ui2=recorded-table#/recorded')
    await expect(recordedPage.getByTestId('recorded-list-item').first()).toBeVisible()
    await expectDarkCardsUseTheme(recordedPage, [
      { label: 'recorded list items', selector: '[data-testid="recorded-list-item"]' },
    ])
  } finally {
    await recordedPage.close()
  }

  await page.unrouteAll()
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installRecordingEncodeApiMocks(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/recording')
  await expect(page.getByTestId('recording-list-item').first()).toBeVisible()
  await expectDarkCardsUseTheme(page, [
    { label: 'recording cards', selector: '[data-testid="recording-list-item"]' },
  ])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/encode')
  await expect(page.getByTestId('encode-list-item').first()).toBeVisible()
  await expectDarkCardsUseTheme(page, [
    { label: 'encode cards', selector: '[data-testid="encode-list-item"]' },
  ])

  await page.unrouteAll()
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installGuideOnAirApiMocks(page)
  await page.goto('/#/onair')
  await expect(page.getByTestId('onair-card-5101')).toBeVisible()
  await expectDarkCardsUseTheme(page, [
    { label: 'onair cards', selector: '[data-testid^="onair-card-"]' },
  ])
  await page.goto('/#/onair/watch?type=hls&channel=301&mode=0')
  await expect(page.getByTestId('onair-watch-info-card')).toBeVisible()
  await expectDarkCardsUseTheme(page, [
    { label: 'onair watch info card', selector: '[data-testid="onair-watch-info-card"]' },
  ])

  await page.unrouteAll()
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installVideoPlaybackApiMocks(page)
  await page.goto(
    `/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=hls&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`,
  )
  await expect(page.getByTestId('recorded-watch-info-card')).toBeVisible()
  await expectDarkCardsUseTheme(page, [
    { label: 'recorded watch info card', selector: '[data-testid="recorded-watch-info-card"]' },
  ])

  await page.unrouteAll()
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installStoragesUploadApiMocks(page)
  await page.goto('/#/storages')
  await expect(page.locator('[class*="storageItem"]').first()).toBeVisible()
  await expectDarkCardsUseTheme(page, [
    { label: 'storage items', selector: '[class*="storageItem"]' },
  ])
})
