import { expectDarkCardsUseTheme } from './support/darkUiExpectations'
import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { installDashboardWorkflowApiMocks } from './support/dashboardMocks'
import { SYNTHETIC_RECORDED_DETAIL_ID, installRecordedApiMocks } from './support/recordedMocks'
import { installRecordingEncodeApiMocks } from './support/recordingEncodeMocks'
import { installReservesApiMocks } from './support/reservesMocks'
import { installStoragesUploadApiMocks } from './support/storagesUploadMocks'
import { collectVisibleUiAuditRows, expectNoUiAuditFailures } from './support/uiAudit'

test('audits dark Dashboard recorded item menu text and icon contrast', async ({
  page,
}, testInfo) => {
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installDashboardWorkflowApiMocks(page)
  await page.goto('/')
  await page
    .getByRole('button', { name: '録画メニュー: Synthetic Dashboard Recorded Alpha' })
    .click()

  const rows = await collectVisibleUiAuditRows(page, {
    page: 'dashboard',
    route: '/',
    dataState: 'recorded item menu open',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'recorded item menu open',
    component: 'recorded item menu',
    rootSelector: '.MuiPopover-root',
  })

  testInfo.attach('dark-dashboard-recorded-menu-audit.json', {
    body: JSON.stringify(rows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(rows)
})

test('[AC frontend-recorded 5.4] audits dark Recorded detail menu text and icon contrast', async ({
  page,
}, testInfo) => {
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installStoragesUploadApiMocks(page)
  await installRecordedApiMocks(page)
  await page.goto(`/#/recorded/detail/${SYNTHETIC_RECORDED_DETAIL_ID}`)
  await page.getByRole('button', { name: '録画詳細メニュー: Synthetic Detail Target' }).click()

  const rows = await collectVisibleUiAuditRows(page, {
    page: 'recorded-detail',
    route: '/recorded/detail/:id',
    dataState: 'detail menu open',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'detail menu open',
    component: 'recorded detail menu',
    rootSelector: '.MuiPopover-root',
  })

  testInfo.attach('dark-recorded-detail-menu-audit.json', {
    body: JSON.stringify(rows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(rows)
})

test('[AC frontend-app-shell 7.11] [AC frontend-recorded 5.5] audits dark table surfaces across routed owners', async ({
  page,
}) => {
  await page.unrouteAll()
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installReservesApiMocks(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/reserves')
  await expect(page.getByTestId('reserves-page')).toHaveAttribute('data-reserves-layout', 'table')
  await expect(page.getByRole('table')).toBeVisible()
  await expectDarkCardsUseTheme(page, [
    { label: 'reserves table surface', selector: '[class*="tableCard"]' },
    { label: 'reserves table rows', selector: '[data-testid="reserves-list-item"]' },
  ])

  const recordedTablePage = await page.context().newPage()
  try {
    await installAppShellApiMocks(recordedTablePage, {
      enableBroadcastWaveNavigation: true,
      forceDarkTheme: true,
    })
    await recordedTablePage.addInitScript(() => {
      const savedSettings = JSON.parse(window.localStorage.getItem('settings') ?? '{}') as Record<
        string,
        unknown
      >
      window.localStorage.setItem(
        'settings',
        JSON.stringify({
          ...savedSettings,
          recordedLength: 24,
          isShowTableMode: true,
        }),
      )
    })
    await installRecordedApiMocks(recordedTablePage)
    await recordedTablePage.setViewportSize({ width: 1440, height: 900 })
    await recordedTablePage.goto('/?ui2=recorded-table#/recorded')
    await expect(recordedTablePage.getByTestId('recorded-page')).toHaveAttribute(
      'data-recorded-layout',
      'table',
    )
    await expect(recordedTablePage.getByRole('table')).toBeVisible()
    await expectDarkCardsUseTheme(recordedTablePage, [
      { label: 'recorded table surface', selector: '[class*="tableWrap"]' },
      { label: 'recorded table rows', selector: '[data-testid="recorded-list-item"]' },
    ])
  } finally {
    await recordedTablePage.close()
  }

  await page.unrouteAll()
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installRecordingEncodeApiMocks(page)
  await page.goto('/#/recording')
  await expect(page.getByRole('table', { name: '録画中一覧' })).toBeVisible()
  await expectDarkCardsUseTheme(page, [
    { label: 'recording table surface', selector: '[class*="recordingTableCard"]' },
    { label: 'recording table rows', selector: '[data-testid="recording-list-item"]' },
  ])
})

test('[AC frontend-recorded 5.4] audits dark Recorded detail streaming, encode, and download dialogs', async ({
  page,
}, testInfo) => {
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installStoragesUploadApiMocks(page)
  await installRecordedApiMocks(page)
  await page.goto(`/#/recorded/detail/${SYNTHETIC_RECORDED_DETAIL_ID}`)

  const dialogStates = [
    {
      name: 'recorded stream select dialog',
      open: async () => {
        await page.getByRole('button', { name: 'streaming' }).click()
        await page.getByRole('button', { name: 'Synthetic Encoded MP4' }).click()
      },
      close: async () => page.getByRole('button', { name: 'キャンセル' }).click(),
      rootSelector: '[data-recorded-stream-select-dialog="legacy"]',
    },
    {
      name: 'recorded add encode dialog',
      open: async () => page.getByRole('button', { name: 'encode', exact: true }).click(),
      close: async () => page.getByRole('button', { name: 'キャンセル' }).click(),
      rootSelector: '[data-recorded-add-encode-dialog="legacy"]',
    },
    {
      name: 'recorded download dialog',
      open: async () => {
        await page
          .getByRole('button', { name: '録画詳細メニュー: Synthetic Detail Target' })
          .click()
        await page.getByRole('menuitem', { name: 'download' }).click()
      },
      close: async () => page.getByRole('button', { name: '閉じる' }).click(),
      rootSelector: '[data-recorded-download-dialog="legacy"]',
    },
  ]

  for (const state of dialogStates) {
    await state.open()
    const rows = await collectVisibleUiAuditRows(page, {
      page: 'recorded-detail',
      route: '/recorded/detail/:id',
      dataState: state.name,
      theme: 'dark',
      viewportDevice: testInfo.project.name,
      openedState: state.name,
      component: state.name,
      rootSelector: state.rootSelector,
    })

    testInfo.attach(`${state.name.replaceAll(' ', '-')}-audit.json`, {
      body: JSON.stringify(rows, null, 2),
      contentType: 'application/json',
    })
    await expectNoUiAuditFailures(rows)
    await state.close()
  }
})
