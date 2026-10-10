import {
  expectDarkSelectControlsUseTheme,
  expectOpenSelectMenuUsesDarkTheme,
} from './support/darkUiExpectations'
import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { installGuideOnAirApiMocks } from './support/guideOnAirMocks'
import { SYNTHETIC_RECORDED_DETAIL_ID, installRecordedApiMocks } from './support/recordedMocks'
import { installReservesApiMocks } from './support/reservesMocks'
import { installStoragesUploadApiMocks } from './support/storagesUploadMocks'
import { installSearchRuleWorkflowApiMocks } from './support/searchRuleMocks'
import { collectVisibleUiAuditRows, expectNoUiAuditFailures } from './support/uiAudit'
import {
  openDarkManualReserveTimeSpecifiedForm,
  openDarkNavigationDrawer,
} from './support/uiAuditStates'

test('audits dark navigation drawer visible text and icon contrast', async ({ page }, testInfo) => {
  await openDarkNavigationDrawer(page)

  const rows = await collectVisibleUiAuditRows(page, {
    page: 'app-shell',
    route: '/',
    dataState: 'normal',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'drawer open',
    component: 'navigation drawer',
    rootSelector: '[data-testid="shell-drawer"]',
  })

  testInfo.attach('dark-navigation-drawer-audit.json', {
    body: JSON.stringify(rows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(rows)
})

test('audits dark Manual Reserve time-specified controls', async ({ page }, testInfo) => {
  await openDarkManualReserveTimeSpecifiedForm(page)

  const rows = await collectVisibleUiAuditRows(page, {
    page: 'manual-reserve',
    route: '/reserves/manual?programId=<programId>',
    dataState: 'program add / time-specified',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'time switch on',
    component: 'manual reserve form',
    rootSelector: '[data-testid="manual-reserve-page"]',
  })

  testInfo.attach('dark-manual-reserve-audit.json', {
    body: JSON.stringify(rows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(rows)
})

test('audits dark Search form controls and clear action contrast', async ({ page }, testInfo) => {
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installSearchRuleWorkflowApiMocks(page)
  await page.goto('/#/search')
  await page.getByLabel('keyword', { exact: true }).fill('Synthetic')

  const rows = await collectVisibleUiAuditRows(page, {
    page: 'search',
    route: '/search',
    dataState: 'form with clear button',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'default',
    component: 'search form',
    rootSelector: '[data-testid="search-rule-page"]',
  })

  testInfo.attach('dark-search-form-audit.json', {
    body: JSON.stringify(rows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(rows)
})

test('[AC frontend-app-shell 7.6] audits dark select and combobox controls across pages', async ({
  page,
}) => {
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installGuideOnAirApiMocks(page)
  await installSearchRuleWorkflowApiMocks(page)
  await installRecordedApiMocks(page)
  await installReservesApiMocks(page)
  await installStoragesUploadApiMocks(page)

  const routeChecks = [
    {
      route: '/#/settings',
      rootSelector: '[data-testid="settings-screen"]',
      openCombobox: () => page.getByRole('combobox').first(),
    },
    {
      route: '/#/search',
      rootSelector: '[data-testid="search-rule-page"]',
      openCombobox: () => page.getByRole('combobox').first(),
    },
    {
      route: '/#/guide/setting',
      rootSelector: '[data-testid="guide-setting-page"]',
      openCombobox: () => page.getByRole('combobox').first(),
    },
    {
      route: '/#/recorded/upload',
      rootSelector: '[data-testid="recorded-upload-page"]',
      openCombobox: () => page.getByRole('combobox', { name: '放送局※' }),
    },
    {
      route: '/#/reserves/manual',
      rootSelector: '[data-testid="manual-reserve-page"]',
      openCombobox: () => page.getByRole('combobox').first(),
    },
  ]

  for (const check of routeChecks) {
    await page.goto(check.route)
    await expect(page.locator(check.rootSelector)).toBeVisible()
    await expectDarkSelectControlsUseTheme(page, check.rootSelector)
    await expectOpenSelectMenuUsesDarkTheme(page, check.openCombobox())
  }

  await page.goto('/#/guide?type=GR&time=23111507')
  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  await page.getByRole('button', { name: '時刻選択' }).click()
  await expectDarkSelectControlsUseTheme(page, '[role="menu"]')

  await page.goto(`/#/recorded/detail/${SYNTHETIC_RECORDED_DETAIL_ID}`)
  await expect(page.getByTestId('recorded-detail-page')).toBeVisible()
  await page.getByRole('button', { name: 'streaming' }).click()
  await page.getByRole('button', { name: 'Synthetic Encoded MP4' }).click()
  await expectDarkSelectControlsUseTheme(page, '[data-recorded-stream-select-dialog="legacy"]')
  await page.getByRole('button', { name: 'キャンセル' }).click()

  await page.getByRole('button', { name: 'encode', exact: true }).click()
  await expectDarkSelectControlsUseTheme(page, '[data-recorded-add-encode-dialog="legacy"]')
})
