import { expect, test, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { muiSelectInput, selectMuiOption } from './support/muiSelect'
import { installStoragesUploadApiMocks } from './support/storagesUploadMocks'
import { collectVisibleUiAuditRows, expectNoUiAuditFailures } from './support/uiAudit'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: true,
  })
  await installStoragesUploadApiMocks(page)
})

async function fillUploadForm(page: Page): Promise<void> {
  await expect(page.getByTestId('recorded-upload-page')).toBeVisible()
  await expect(muiSelectInput(page, 'directory')).toHaveValue('archive-root')
  await selectMuiOption({ page, name: '放送局※', value: '34' })
  await page.getByLabel('日付※').fill('2026-05-05T12:30')
  await page.getByLabel('長さ※').fill('30')
  await page.getByLabel('番組名※').fill('Synthetic Browser Upload')
  await page.getByLabel('name', { exact: true }).fill('Synthetic Video File')
  await selectMuiOption({ page, name: 'file type', value: 'ts', exact: true })
  await page.getByLabel('video file', { exact: true }).setInputFiles({
    name: 'synthetic-upload.ts',
    mimeType: 'video/mp2t',
    buffer: Buffer.from('synthetic upload payload'),
  })
}

test('keeps the required row titles of the upload form red in dark theme', async ({ page }) => {
  await page.goto('/#/recorded/upload')
  await expect(page.getByTestId('recorded-upload-page')).toBeVisible()

  for (const title of ['放送局※', '日付※', '長さ※', '番組名※']) {
    await expect(page.getByText(title)).toHaveCSS('color', 'rgb(255, 0, 0)')
  }
})

test('draws the storage usage bars readably in dark theme', async ({ page }, testInfo) => {
  await page.goto('/#/storages')
  await expect(page.getByTestId('storages-page')).toBeVisible()

  const usageBar = page.getByRole('progressbar').first()
  await expect(usageBar).toBeVisible()
  await expect(usageBar.locator('.MuiLinearProgress-bar')).toHaveCSS(
    'background-color',
    'rgb(25, 118, 210)',
  )
  await expect(usageBar).toHaveCSS('background-image', /rgba\(25, 118, 210, 0\.3\)/)

  const rows = await collectVisibleUiAuditRows(page, {
    page: 'storages',
    route: '/storages',
    dataState: 'storage usage',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'default',
    component: 'storage usage bars',
    rootSelector: '[data-testid="storages-page"]',
  })
  expect(rows.length).toBeGreaterThan(0)
  await testInfo.attach('dark-storages-usage-audit.json', {
    body: JSON.stringify(rows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(rows)
})

test('draws the upload progress dialog readably in dark theme', async ({ page }, testInfo) => {
  let releaseUpload: () => void = () => undefined
  const uploadHeld = new Promise<void>((resolve) => {
    releaseUpload = resolve
  })
  await page.route('**/api/videos/upload', async (route) => {
    await uploadHeld
    await route.fallback()
  })
  await page.goto('/#/recorded/upload')
  await fillUploadForm(page)
  await page.getByRole('button', { name: 'アップロード' }).click()

  const dialog = page.getByRole('dialog', { name: 'アップロード中' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('progressbar', { name: 'アップロード進捗' })).toBeVisible()
  const rows = await collectVisibleUiAuditRows(page, {
    page: 'recorded upload',
    route: '/recorded/upload',
    dataState: 'upload progress dialog',
    theme: 'dark',
    viewportDevice: testInfo.project.name,
    openedState: 'upload progress dialog open',
    component: 'upload progress dialog',
    rootSelector: '[role="dialog"]',
  })
  expect(rows.length).toBeGreaterThan(0)
  await testInfo.attach('dark-upload-progress-dialog-audit.json', {
    body: JSON.stringify(rows, null, 2),
    contentType: 'application/json',
  })
  await expectNoUiAuditFailures(rows)

  releaseUpload()
})
