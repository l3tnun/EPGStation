import { test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { installReservesApiMocks, reserveDeleteTarget } from './support/reservesMocks'
import { collectVisibleUiAuditRows, expectNoUiAuditFailures } from './support/uiAudit'

test('audits dark Reserves card list, title menu, item menu, and bulk dialog', async ({
  page,
}, testInfo) => {
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installReservesApiMocks(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/reserves')
  await page.getByTestId('title-bar').getByRole('button', { name: '予約メニュー' }).click()

  const titleMenuRows = await collectVisibleUiAuditRows(page, {
    page: 'reserves',
    route: '/reserves',
    dataState: 'title menu open',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'title menu open',
    component: 'reserves title menu',
    rootSelector: '.MuiPopover-root',
  })

  testInfo.attach('dark-reserves-title-menu-audit.json', {
    body: JSON.stringify(titleMenuRows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(titleMenuRows)
  await page.keyboard.press('Escape')

  const listRows = await collectVisibleUiAuditRows(page, {
    page: 'reserves',
    route: '/reserves',
    dataState: 'card list',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'default',
    component: 'reserves card list',
    rootSelector: '[data-testid="reserves-page"]',
  })

  testInfo.attach('dark-reserves-card-list-audit.json', {
    body: JSON.stringify(listRows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(listRows)

  await page.getByRole('button', { name: `予約メニュー: ${reserveDeleteTarget.name}` }).click()
  const itemMenuRows = await collectVisibleUiAuditRows(page, {
    page: 'reserves',
    route: '/reserves',
    dataState: 'item menu open',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'item menu open',
    component: 'reserves item menu',
    rootSelector: '.MuiPopover-root',
  })

  testInfo.attach('dark-reserves-item-menu-audit.json', {
    body: JSON.stringify(itemMenuRows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(itemMenuRows)
  await page.keyboard.press('Escape')

  await page.getByTestId('title-bar').getByRole('button', { name: '予約メニュー' }).click()
  await page.getByRole('menuitem', { name: '編集' }).click()
  await page.getByRole('button', { name: 'すべて選択' }).click()
  await page.getByRole('button', { name: '選択項目を削除' }).click()
  const bulkDialogRows = await collectVisibleUiAuditRows(page, {
    page: 'reserves',
    route: '/reserves',
    dataState: 'bulk delete dialog open',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'bulk delete dialog open',
    component: 'reserves bulk delete dialog',
    rootSelector: '[role="dialog"][aria-labelledby="reserve-bulk-delete-title"]',
  })

  testInfo.attach('dark-reserves-bulk-delete-dialog-audit.json', {
    body: JSON.stringify(bulkDialogRows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(bulkDialogRows)
})
