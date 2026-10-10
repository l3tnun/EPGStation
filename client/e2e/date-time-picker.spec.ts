import { expect, test, type Locator, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  expectMondayFirstCalendar,
  pickDateTime,
  showCalendarMonth,
} from './support/dateTimePicker'
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

// 幅 320px・高さ 568px（iPhone SE 相当）でも、dialog の中の部品が横にはみ出さず、全ての週の日を選べる。
async function expectNoHorizontalOverflow(page: Page, dialog: Locator): Promise<void> {
  const paperBox = await dialog.boundingBox()
  expect(paperBox).not.toBeNull()
  const right = paperBox!.x + paperBox!.width
  const left = paperBox!.x

  const scrolls = await dialog.evaluate((node) => {
    const targets = [node, ...Array.from(node.querySelectorAll('*'))]
    return targets
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .filter((element) => getComputedStyle(element).display !== 'inline')
      .filter((element) => !element.classList.contains('MuiTouchRipple-root'))
      .map(
        (element) =>
          `${element.tagName}.${element.className}: ${element.scrollWidth}>${element.clientWidth}`,
      )
  })
  expect(scrolls).toEqual([])

  const parts = dialog.locator(
    'button, [role="columnheader"], [role="gridcell"], [role="tab"], [role="listbox"]',
  )
  const count = await parts.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    const box = await parts.nth(index).boundingBox()
    if (box === null || box.width === 0) {
      continue
    }
    expect(box.x, `part ${index} left`).toBeGreaterThanOrEqual(left - 1)
    expect(box.x + box.width, `part ${index} right`).toBeLessThanOrEqual(right + 1)
  }
  expect(page.viewportSize()!.width).toBe(320)
}

async function expectNarrowPickerUsable(page: Page, dialogName: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: dialogName })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: '日付を選択' }).click()
  await showCalendarMonth(dialog, 2026, 5)
  await expect(dialog.getByRole('rowgroup')).toHaveCount(1)
  await expectMondayFirstCalendar(dialog)
  await expectNoHorizontalOverflow(page, dialog)
  await expect(dialog.getByRole('button', { name: '先月' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '来月' })).toBeVisible()
  // 最終週の日曜（5 月 31 日）は、縦に scroll して届き、選べる。
  await dialog.getByRole('grid').getByRole('gridcell', { name: '31', exact: true }).click()
  await dialog.getByRole('tab', { name: '時間を選択' }).click()
  await expectNoHorizontalOverflow(page, dialog)
  await dialog.getByRole('option', { name: '9 時間', exact: true }).click()
  await dialog.getByRole('option', { name: '30 分', exact: true }).click()
  await expectNoHorizontalOverflow(page, dialog)
  await expect(dialog.getByRole('button', { name: 'クリア' })).toBeVisible()
  await dialog.getByRole('button', { name: '設定' }).click()
  await expect(dialog).toHaveCount(0)
}

test.describe('narrow 320x568 viewport', () => {
  test.use({ viewport: { width: 320, height: 568 } })

  test('Recorded Upload picker fits and picks the last week', async ({ page }) => {
    await installStoragesUploadApiMocks(page)
    await page.goto('/#/recorded/upload')
    await expect(page.getByTestId('recorded-upload-page')).toBeVisible()
    const field = page.getByLabel('日付※')
    await field.click()
    await expectNarrowPickerUsable(page, '日付選択')
    await expect(field).toHaveValue('2026-05-31T09:30')
  })

  test('Search period picker fits and picks the last week', async ({ page }) => {
    await installSearchRuleWorkflowApiMocks(page)
    await page.goto('/#/search')
    await expect(page.getByRole('heading', { name: '検索' })).toBeVisible()
    const field = page
      .getByTestId('search-rule-page')
      .getByRole('textbox', { name: '開始', exact: true })
    await field.click()
    await expectNarrowPickerUsable(page, '期間 開始')
    await expect(field).toHaveValue('2026-05-31T09:30')
  })

  test('Manual Reserve picker fits and picks the last week', async ({ page }) => {
    await installReservesApiMocks(page)
    await page.goto(`/#/reserves/manual?programId=${manualProgramDetail.id}`)
    await page.getByRole('switch', { name: '時刻指定' }).click()
    await expect(page.getByRole('region', { name: '時刻指定予約' })).toBeVisible()
    const field = page.getByRole('textbox', { name: '終了' })
    await field.click()
    await expectNarrowPickerUsable(page, '時刻 終了')
    await expect(field).toHaveValue('2026-05-31 09:30')
  })
})
