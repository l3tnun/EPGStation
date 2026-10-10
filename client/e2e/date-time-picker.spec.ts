import { expect, test, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { expectMondayFirstCalendar, pickDateTime } from './support/dateTimePicker'
import { installReservesApiMocks, manualProgramDetail } from './support/reservesMocks'
import { installSearchRuleWorkflowApiMocks } from './support/searchRuleMocks'
import { installStoragesUploadApiMocks } from './support/storagesUploadMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
})

const picked = { year: 2026, month: 5, day: 5, hour: 9, minute: 30 }

async function expectDialogFitsViewport(page: Page, dialogName: string): Promise<void> {
  const box = await page.getByRole('dialog', { name: dialogName }).boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width)
}

test('Recorded Upload picks the start date in a Monday-first calendar and clears it', async ({
  page,
}) => {
  await installStoragesUploadApiMocks(page)
  await page.goto('/#/recorded/upload')
  await expect(page.getByTestId('recorded-upload-page')).toBeVisible()

  const field = page.getByLabel('日付※')
  await field.click()
  const dialog = page.getByRole('dialog', { name: '日付選択' })
  await expect(dialog).toBeVisible()
  await expectMondayFirstCalendar(dialog)
  await expectDialogFitsViewport(page, '日付選択')
  await pickDateTime(dialog, picked)
  await dialog.getByRole('button', { name: '設定' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(field).toHaveValue('2026-05-05T09:30')

  await field.click()
  await page
    .getByRole('dialog', { name: '日付選択' })
    .getByRole('button', { name: 'クリア' })
    .click()
  await expect(page.getByRole('dialog', { name: '日付選択' })).toHaveCount(0)
  await expect(field).toHaveValue('')
})

test('Search period picks the start in a Monday-first calendar and clears it', async ({ page }) => {
  await installSearchRuleWorkflowApiMocks(page)
  await page.goto('/#/search')
  await expect(page.getByRole('heading', { name: '検索' })).toBeVisible()

  const field = page.getByTestId('search-rule-page').getByRole('textbox', {
    name: '開始',
    exact: true,
  })
  await field.click()
  const dialog = page.getByRole('dialog', { name: '期間 開始' })
  await expect(dialog).toBeVisible()
  await expectMondayFirstCalendar(dialog)
  await expectDialogFitsViewport(page, '期間 開始')
  await pickDateTime(dialog, picked)
  await dialog.getByRole('button', { name: '設定' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(field).toHaveValue('2026-05-05T09:30')

  await field.click()
  await page
    .getByRole('dialog', { name: '期間 開始' })
    .getByRole('button', { name: 'クリア' })
    .click()
  await expect(page.getByRole('dialog', { name: '期間 開始' })).toHaveCount(0)
  await expect(field).toHaveValue('')
})

test('Manual Reserve time specification picks the end in a Monday-first calendar and clears it', async ({
  page,
}) => {
  await installReservesApiMocks(page)
  await page.goto(`/#/reserves/manual?programId=${manualProgramDetail.id}`)
  await page.getByRole('switch', { name: '時刻指定' }).click()
  await expect(page.getByRole('region', { name: '時刻指定予約' })).toBeVisible()

  const field = page.getByRole('textbox', { name: '終了' })
  await field.click()
  const dialog = page.getByRole('dialog', { name: '時刻 終了' })
  await expect(dialog).toBeVisible()
  await expectMondayFirstCalendar(dialog)
  await expectDialogFitsViewport(page, '時刻 終了')
  await pickDateTime(dialog, picked)
  await dialog.getByRole('button', { name: '設定' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(field).toHaveValue('2026-05-05 09:30')

  await field.click()
  await page
    .getByRole('dialog', { name: '時刻 終了' })
    .getByRole('button', { name: 'クリア' })
    .click()
  await expect(page.getByRole('dialog', { name: '時刻 終了' })).toHaveCount(0)
  await expect(field).toHaveValue('')
})
