import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test'
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

// 実際に page が使える大きさ（iPhone SE は Safari の toolbar・アドレスバーの分だけ画面より小さい）を含む。
const usableSizes: Array<[number, number]> = [
  [320, 460],
  [320, 568],
  [375, 548],
  [375, 627],
  [375, 667],
  [390, 664],
  [390, 844],
  [414, 715],
  [414, 896],
  [667, 320],
  [768, 1024],
  [1280, 800],
  [1920, 1080],
]

interface PickerScreen {
  name: string
  dialogName: string
  suffix: RegExp
  open: (page: Page) => Promise<Locator>
}

const pickerScreens: PickerScreen[] = [
  {
    name: 'Recorded Upload',
    dialogName: '日付選択',
    suffix: /T23:59$/,
    open: async (page) => {
      await installStoragesUploadApiMocks(page)
      await page.goto('/#/recorded/upload')
      await expect(page.getByTestId('recorded-upload-page')).toBeVisible()
      return page.getByLabel('日付※')
    },
  },
  {
    name: 'Search period',
    dialogName: '期間 開始',
    suffix: /T23:59$/,
    open: async (page) => {
      await installSearchRuleWorkflowApiMocks(page)
      await page.goto('/#/search')
      await expect(page.getByRole('heading', { name: '検索' })).toBeVisible()
      return page.getByTestId('search-rule-page').getByRole('textbox', {
        name: '開始',
        exact: true,
      })
    },
  },
  {
    name: 'Manual Reserve',
    dialogName: '時刻 開始',
    suffix: / 23:59$/,
    open: async (page) => {
      await installReservesApiMocks(page)
      await page.goto(`/#/reserves/manual?programId=${manualProgramDetail.id}`)
      await page.getByRole('switch', { name: '時刻指定' }).click()
      await expect(page.getByRole('region', { name: '時刻指定予約' })).toBeVisible()
      return page.getByRole('textbox', { name: '開始' })
    },
  },
]

// dialog 自体（paper・DialogContent・picker の root）は縦に scroll しない。
async function expectDialogDoesNotScroll(dialog: Locator): Promise<void> {
  const scrolls = await dialog.evaluate((paper) => {
    const targets = [
      paper,
      paper.querySelector('.MuiDialogContent-root'),
      paper.querySelector('.MuiPickersLayout-root'),
    ]
    return targets.map((element) =>
      element === null ? 'missing' : `${element.scrollHeight - element.clientHeight}`,
    )
  })
  for (const overflow of scrolls) {
    expect(
      Number(overflow),
      `scrollHeight - clientHeight: ${scrolls.join(',')}`,
    ).toBeLessThanOrEqual(0)
  }
}

async function expectVisibleInViewport(page: Page, target: Locator, label: string): Promise<void> {
  const box = await target.boundingBox()
  const viewport = page.viewportSize()!
  expect(box, label).not.toBeNull()
  expect(box!.x, `${label} left`).toBeGreaterThanOrEqual(0)
  expect(box!.y, `${label} top`).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width, `${label} right`).toBeLessThanOrEqual(viewport.width)
  expect(box!.y + box!.height, `${label} bottom`).toBeLessThanOrEqual(viewport.height)
  // 他の要素や overflow で隠れていないこと（中心が自分自身の点であること）。
  const hit = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return top !== null && element.contains(top)
  })
  expect(hit, `${label} is not covered or clipped`).toBe(true)
}

async function expectDialogChromeVisible(page: Page, dialog: Locator): Promise<void> {
  await expectVisibleInViewport(page, dialog, 'dialog')
  await expectVisibleInViewport(page, dialog.getByRole('button', { name: 'クリア' }), 'クリア')
  await expectVisibleInViewport(page, dialog.getByRole('button', { name: '設定' }), '設定')
}

// 上部の月日と時刻は同じ大きさの文字で、縦の中心が 1px 以内で揃う。
async function expectToolbarAligned(dialog: Locator): Promise<void> {
  const measured = await dialog.evaluate((paper) => {
    const date = paper.querySelectorAll(
      '.MuiDateTimePickerToolbar-dateContainer .MuiPickersToolbarText-root',
    )
    const time = paper.querySelector(
      '.MuiDateTimePickerToolbar-timeDigitsContainer .MuiPickersToolbarText-root',
    )
    const monthDay = date[date.length - 1]
    if (monthDay === undefined || time === null) {
      return null
    }
    const center = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return rect.y + rect.height / 2
    }
    return {
      dateSize: getComputedStyle(monthDay).fontSize,
      timeSize: getComputedStyle(time).fontSize,
      diff: Math.abs(center(monthDay) - center(time)),
    }
  })
  expect(measured).not.toBeNull()
  expect(measured!.dateSize).toBe(measured!.timeSize)
  expect(measured!.diff).toBeLessThanOrEqual(1)
}

// 列の上で wheel を回して、option を列の見える範囲に入れる（実際の操作で届くことを確かめる）。
async function revealByWheel(page: Page, option: Locator): Promise<void> {
  const column = option.locator('xpath=ancestor::*[@role="listbox"][1]')
  for (let step = 0; step < 80; step += 1) {
    const columnBox = await column.boundingBox()
    const optionBox = await option.boundingBox()
    expect(columnBox).not.toBeNull()
    expect(optionBox).not.toBeNull()
    if (
      optionBox!.y >= columnBox!.y &&
      optionBox!.y + optionBox!.height <= columnBox!.y + columnBox!.height
    ) {
      return
    }
    await page.mouse.move(columnBox!.x + columnBox!.width / 2, columnBox!.y + columnBox!.height / 2)
    await page.mouse.wheel(0, optionBox!.y < columnBox!.y ? -150 : 150)
    await page.waitForTimeout(30)
  }
  throw new Error('option を列の scroll で見える範囲に入れられません')
}

test.describe('picker fits the usable page size without scrolling the dialog', () => {
  for (const screen of pickerScreens) {
    for (const [width, height] of usableSizes) {
      test(`${screen.name} ${width}x${height}`, async ({ page }) => {
        await page.setViewportSize({ width, height })
        const field = await screen.open(page)
        await field.click()
        const dialog = page.getByRole('dialog', { name: screen.dialogName })
        await expect(dialog).toBeVisible()
        await page.waitForTimeout(400)

        // calendar の view: 全ての週が scroll なしで見える。
        await dialog.getByRole('tab', { name: '日付を選択' }).click()
        await expectDialogDoesNotScroll(dialog)
        await expectDialogChromeVisible(page, dialog)
        await expectToolbarAligned(dialog)
        const weeks = dialog.locator('[role="row"][aria-rowindex]').filter({
          has: page.locator('[role="gridcell"]'),
        })
        const lastWeek = weeks.last()
        await expectVisibleInViewport(page, lastWeek, 'last week')
        const contentBox = await dialog.locator('.MuiDialogContent-root').boundingBox()
        const lastBox = await lastWeek.boundingBox()
        expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(contentBox!.y + contentBox!.height)

        // 時刻の view: 時と分の列は列の scroll だけで最初から最後まで選べる。
        await dialog.getByRole('tab', { name: '時間を選択' }).click()
        await expectDialogDoesNotScroll(dialog)
        await expectDialogChromeVisible(page, dialog)
        await expectToolbarAligned(dialog)
        await expect(dialog.getByRole('listbox')).toHaveCount(2)
        for (const [hour, minute] of [
          [0, 0],
          [23, 59],
        ]) {
          const hourOption = dialog.getByRole('option', { name: `${hour} 時間`, exact: true })
          await revealByWheel(page, hourOption)
          await hourOption.click()
          await expectVisibleInViewport(page, hourOption, `${hour} 時間`)
          const minuteOption = dialog.getByRole('option', { name: `${minute} 分`, exact: true })
          await revealByWheel(page, minuteOption)
          await minuteOption.click()
          await expectVisibleInViewport(page, minuteOption, `${minute} 分`)
          await expectDialogDoesNotScroll(dialog)
          await expectDialogChromeVisible(page, dialog)
        }
        await dialog.getByRole('button', { name: '設定' }).click()
        await expect(dialog).toHaveCount(0)
        await expect(field).toHaveValue(screen.suffix)
      })
    }
  }
})

test.describe('picker follows the visible area while it stays open', () => {
  for (const screen of pickerScreens) {
    test(`${screen.name} keeps fitting while the viewport changes`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 627 })
      const field = await screen.open(page)
      await field.click()
      const dialog = page.getByRole('dialog', { name: screen.dialogName })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('tab', { name: '時間を選択' }).click()

      // Safari の toolbar が出る → 横向きにする → 広い画面に戻す、の順に表示領域を変える。
      for (const [width, height] of [
        [375, 548],
        [667, 320],
        [375, 627],
        [1280, 800],
        [320, 460],
      ]) {
        await page.setViewportSize({ width, height })
        await page.waitForTimeout(300)
        await expectDialogDoesNotScroll(dialog)
        await expectDialogChromeVisible(page, dialog)
        await expectToolbarAligned(dialog)
        for (const label of ['0 時間', '23 時間', '0 分', '59 分']) {
          const option = dialog.getByRole('option', { name: label, exact: true })
          await revealByWheel(page, option)
          await expectVisibleInViewport(page, option, `${width}x${height} ${label}`)
        }
        await dialog.getByRole('tab', { name: '日付を選択' }).click()
        await expectDialogDoesNotScroll(dialog)
        await expectVisibleInViewport(
          page,
          dialog
            .locator('[role="row"][aria-rowindex]')
            .filter({ has: page.locator('[role="gridcell"]') })
            .last(),
          `${width}x${height} last week`,
        )
        await dialog.getByRole('tab', { name: '時間を選択' }).click()
      }
    })
  }
})

test.describe('picker selects every minute', () => {
  for (const screen of pickerScreens) {
    test(`${screen.name} lists 0 to 59 minutes and picks 58`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 548 })
      const field = await screen.open(page)
      await field.click()
      const dialog = page.getByRole('dialog', { name: screen.dialogName })
      await dialog.getByRole('tab', { name: '時間を選択' }).click()
      const minutes = dialog.getByRole('listbox').nth(1).getByRole('option')
      await expect(minutes).toHaveCount(60)
      const last = dialog.getByRole('option', { name: '59 分', exact: true })
      await revealByWheel(page, last)
      await expectVisibleInViewport(page, last, '59 分')
      await expectDialogDoesNotScroll(dialog)
      await dialog.getByRole('option', { name: '9 時間', exact: true }).click()
      await dialog.getByRole('option', { name: '58 分', exact: true }).click()
      await dialog.getByRole('button', { name: '設定' }).click()
      await expect(dialog).toHaveCount(0)
      await expect(field).toHaveValue(/09:58$/)
    })
  }
})

// MUI の列は pointer: fine のとき hover の間だけ scroll できる。fine と申告される環境で指で触っても、
// 最初の操作から scroll できること。
test.describe('picker columns scroll from the first touch or wheel', () => {
  test.use({ hasTouch: true })

  async function declareFinePointer(page: Page): Promise<CDPSession> {
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'pointer', value: 'fine' },
        { name: 'hover', value: 'hover' },
      ],
    })
    return session
  }

  // 指で上へ払う（touchStart → touchMove → touchEnd）。
  async function swipeUp(session: CDPSession, column: Locator): Promise<void> {
    const box = await column.boundingBox()
    expect(box).not.toBeNull()
    const x = box!.x + box!.width / 2
    const startY = box!.y + box!.height - 10
    const endY = box!.y + 10
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y: startY }],
    })
    for (let step = 1; step <= 8; step += 1) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: startY + ((endY - startY) * step) / 8 }],
      })
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await column.page().waitForTimeout(400)
  }

  const scrollTop = (column: Locator) => column.evaluate((node) => node.scrollTop)

  async function sweepToEnd(session: CDPSession, column: Locator): Promise<void> {
    const before = await scrollTop(column)
    await swipeUp(session, column)
    expect(await scrollTop(column), 'first swipe scrolls the column').toBeGreaterThan(before)
    for (let step = 0; step < 30; step += 1) {
      const atEnd = await column.evaluate(
        (node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 1,
      )
      if (atEnd) {
        return
      }
      await swipeUp(session, column)
    }
    throw new Error('列を最後まで払えません')
  }

  for (const screen of pickerScreens) {
    test(`${screen.name} columns scroll by touch swipes under a fine pointer`, async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== 'chromium', 'CDP の touch は Chromium のみ')
      await page.setViewportSize({ width: 375, height: 548 })
      const session = await declareFinePointer(page)
      const field = await screen.open(page)
      await field.tap()
      const dialog = page.getByRole('dialog', { name: screen.dialogName })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('tab', { name: '時間を選択' }).tap()

      const [hours, minutes] = [
        dialog.getByRole('listbox').nth(0),
        dialog.getByRole('listbox').nth(1),
      ]
      for (const [column, label] of [
        [hours, '23 時間'],
        [minutes, '59 分'],
      ] as const) {
        await sweepToEnd(session, column)
        const option = dialog.getByRole('option', { name: label, exact: true })
        await expectVisibleInViewport(page, option, label)
        await option.tap()
      }
      await expectDialogDoesNotScroll(dialog)
      await dialog.getByRole('button', { name: '設定' }).tap()
      await expect(dialog).toHaveCount(0)
      await expect(field).toHaveValue(screen.suffix)
    })

    test(`${screen.name} columns scroll by the first mouse wheel under a fine pointer`, async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== 'chromium', 'pointer の申告の上書きは Chromium のみ')
      await page.setViewportSize({ width: 375, height: 548 })
      await declareFinePointer(page)
      const field = await screen.open(page)
      await field.click()
      const dialog = page.getByRole('dialog', { name: screen.dialogName })
      await dialog.getByRole('tab', { name: '時間を選択' }).click()
      for (const column of [
        dialog.getByRole('listbox').nth(0),
        dialog.getByRole('listbox').nth(1),
      ]) {
        const box = await column.boundingBox()
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
        await page.mouse.wheel(0, 100)
        await expect.poll(() => scrollTop(column)).toBeGreaterThan(0)
      }
    })
  }
})

test.describe('picker selects year, month and day from the calendar header', () => {
  const sizes: Array<[number, number]> = [
    [375, 548],
    [320, 460],
    [667, 320],
    [1280, 800],
  ]
  for (const screen of pickerScreens) {
    for (const [width, height] of sizes) {
      test(`${screen.name} picks 2027 March 15 ${width}x${height}`, async ({ page }) => {
        await page.setViewportSize({ width, height })
        const field = await screen.open(page)
        await field.click()
        const dialog = page.getByRole('dialog', { name: screen.dialogName })
        await expect(dialog).toBeVisible()
        await dialog.getByRole('tab', { name: '日付を選択' }).click()

        await dialog.getByRole('button', { name: /年選択表示に切り替える/ }).click()
        await expect(dialog.getByRole('radio', { name: '2027', exact: true })).toBeVisible()
        await expectDialogDoesNotScroll(dialog)
        await expectDialogChromeVisible(page, dialog)
        await dialog.getByRole('radio', { name: '2027', exact: true }).click()

        // 年を選ぶと月の一覧（日本語）が開く。
        await expect(dialog.getByRole('radio', { name: '12月', exact: true })).toBeVisible()
        await expect(dialog.getByRole('radio')).toHaveCount(12)
        await expectDialogDoesNotScroll(dialog)
        await expectDialogChromeVisible(page, dialog)
        await expectVisibleInViewport(
          page,
          dialog.getByRole('radio', { name: '12月', exact: true }),
          '12月',
        )
        await dialog.getByRole('radio', { name: '3月', exact: true }).click()

        await expect(dialog.getByText('2027年3月', { exact: true })).toBeVisible()
        await dialog.getByRole('gridcell', { name: '15', exact: true }).click()
        await dialog.getByRole('button', { name: '設定' }).click()
        await expect(dialog).toHaveCount(0)
        await expect(field).toHaveValue(/^2027-03-15[T ]\d\d:\d\d$/)
      })
    }
  }
})
