import { expect, test, type Locator, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  PAGED_LIST_LAST_PAGE,
  firstPositionOf,
  installPagedListApiMocks,
  pagedItemName,
  type PagedListScreen,
} from './support/pagedListMocks'
import {
  installPagedRuleListApiMocks,
  installSearchRuleWorkflowApiMocks,
  seedExtendedPagination,
} from './support/searchRuleMocks'

// The recorded, recording and reserves lists switch to the extended pagination together with the
// rule list, from the one setting. The rule list keeps its own, wider suite
// (search-rule-extended-pagination.spec.ts); this one checks the other screens.
const SCREENS: readonly { screen: PagedListScreen; hash: string }[] = [
  { screen: 'recorded', hash: '/#/recorded' },
  { screen: 'recording', hash: '/#/recording' },
  { screen: 'reserves', hash: '/#/reserves' },
]
const ELEMENT_COUNTS = [7, 9, 11, 13, 15, 17]
const VIEWPORT_HEIGHT = 800
const WIDTHS = [320, 375, 412, 768, 1280] as const

async function prepare(
  page: Page,
  { enabled, dark = false }: { enabled?: boolean | null; dark?: boolean } = {},
): Promise<void> {
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: dark,
  })
  await installSearchRuleWorkflowApiMocks(page)
  await installPagedRuleListApiMocks(page)
  await installPagedListApiMocks(page)
  if (enabled !== undefined) {
    await seedExtendedPagination(page, enabled)
  }
}

function paginationNav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'ページ' })
}

async function openList(page: Page, hash: string, listPage: number): Promise<void> {
  await page.goto(`${hash}?page=${listPage}`)
  await expect(page.getByText(pagedItemName(firstPositionOf(listPage))).first()).toBeVisible()
  await expect(paginationNav(page)).toBeVisible()
}

function currentRoutePage(page: Page): number {
  const match = /[?&]page=(\d+)/.exec(page.url())

  return match === null ? 1 : Number(match[1])
}

interface RowReading {
  documentClientWidth: number
  documentScrollWidth: number
  navClientWidth: number
  navLeft: number
  navRight: number
  navScrollWidth: number
  labels: string[]
  numbers: number[]
  offsetLefts: number[]
  buttonLefts: number[]
  buttonRights: number[]
}

async function readRow(page: Page): Promise<RowReading> {
  return paginationNav(page).evaluate((nav) => {
    const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>('button'))
    const navRect = nav.getBoundingClientRect()

    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      navClientWidth: nav.clientWidth,
      navLeft: navRect.left,
      navRight: navRect.right,
      navScrollWidth: nav.scrollWidth,
      labels: buttons.map((button) => button.getAttribute('aria-label') ?? ''),
      numbers: buttons
        .map((button) => button.textContent?.trim() ?? '')
        .filter((text) => /^[0-9]+$/.test(text))
        .map(Number),
      offsetLefts: buttons.map((button) => button.offsetLeft),
      buttonLefts: buttons.map((button) => button.getBoundingClientRect().left),
      buttonRights: buttons.map((button) => button.getBoundingClientRect().right),
    }
  })
}

// The largest of 7 / 9 / ... / 17 whose `count * (button width + margins)` fits the row.
function expectedElementCount(reading: RowReading): number {
  const pitch = reading.offsetLefts[1] - reading.offsetLefts[0]
  const fitting = ELEMENT_COUNTS.filter((count) => count * pitch <= reading.navClientWidth)

  return fitting.length === 0 ? ELEMENT_COUNTS[0] : fitting[fitting.length - 1]
}

async function readSettledRow(page: Page): Promise<RowReading> {
  let reading = await readRow(page)
  await expect
    .poll(async () => {
      reading = await readRow(page)

      return reading.labels.length === expectedElementCount(reading)
    })
    .toBe(true)

  return reading
}

for (const { screen, hash } of SCREENS) {
  test.describe(`${screen}: the extended pagination from the setting`, () => {
    test.use({ viewport: { width: 1280, height: VIEWPORT_HEIGHT } })

    test('moves with ≪, ≫ and the page numbers', async ({ page }) => {
      await prepare(page, { enabled: true })
      await openList(page, hash, 24)
      const nav = paginationNav(page)

      await nav.getByRole('button', { name: '最後のページへ移動' }).click()
      await expect(
        page.getByText(pagedItemName(firstPositionOf(PAGED_LIST_LAST_PAGE))).first(),
      ).toBeVisible()
      expect(currentRoutePage(page)).toBe(PAGED_LIST_LAST_PAGE)
      await expect(nav.getByRole('button', { name: '最後のページへ移動' })).toBeDisabled()

      await nav.getByRole('button', { name: 'ページ46へ移動' }).click()
      await expect(page.getByText(pagedItemName(firstPositionOf(46))).first()).toBeVisible()
      expect(currentRoutePage(page)).toBe(46)

      await nav.getByRole('button', { name: '最初のページへ移動' }).click()
      await expect(page.getByText(pagedItemName(0)).first()).toBeVisible()
      expect(currentRoutePage(page)).toBe(1)
      await expect(nav.getByRole('button', { name: '最初のページへ移動' })).toBeDisabled()
      await expect(nav.getByRole('button', { name: '最後のページへ移動' })).toBeEnabled()
    })

    test('moves through the page number dialog and refuses invalid input', async ({ page }) => {
      await prepare(page, { enabled: true })
      await openList(page, hash, 24)
      const nav = paginationNav(page)

      await nav.getByRole('button', { name: 'ページ数を入力して移動' }).click()
      const dialog = page.getByRole('dialog', { name: 'ページ数を入力' })
      await expect(dialog).toBeVisible()
      const input = dialog.getByRole('textbox', { name: 'ページ数' })

      for (const invalid of ['', '0', 'abc', '48']) {
        await input.fill(invalid)
        await dialog.getByRole('button', { name: '移動' }).click()
        await expect(
          dialog.getByText(`1 〜 ${PAGED_LIST_LAST_PAGE} の整数を入力してください`),
        ).toBeVisible()
        expect(currentRoutePage(page)).toBe(24)
      }

      await input.fill('30')
      await input.press('Enter')
      await expect(dialog).toBeHidden()
      await expect(page.getByText(pagedItemName(firstPositionOf(30))).first()).toBeVisible()
      expect(currentRoutePage(page)).toBe(30)
    })

    test('shows the current pagination when the setting is off or absent', async ({ page }) => {
      for (const enabled of [false, null] as const) {
        const target = await page.context().newPage()
        await prepare(target, { enabled })
        await target.setViewportSize({ width: 1280, height: VIEWPORT_HEIGHT })
        await openList(target, hash, 24)

        await expect(target.getByRole('button', { name: '前のページ' })).toBeVisible()
        await expect(target.getByRole('button', { name: '次のページ' })).toBeVisible()
        await expect(target.getByRole('button', { name: '最初のページへ移動' })).toHaveCount(0)
        await expect(target.getByRole('button', { name: '最後のページへ移動' })).toHaveCount(0)
        await target.close()
      }
    })
  })

  test.describe(`${screen}: the extended pagination keeps inside narrow viewports`, () => {
    for (const width of WIDTHS) {
      test(`fits the row inside a ${width}px viewport on the first, a middle and the last page`, async ({
        page,
      }, testInfo) => {
        test.skip(!testInfo.project.name.startsWith('Desktop'), 'checked on the desktop projects')
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHT })
        await prepare(page, { enabled: true })

        for (const target of [1, 24, PAGED_LIST_LAST_PAGE]) {
          await openList(page, hash, target)
          const row = await readSettledRow(page)

          expect(row.documentScrollWidth).toBeLessThanOrEqual(row.documentClientWidth)
          expect(row.navScrollWidth).toBeLessThanOrEqual(row.navClientWidth)
          expect(row.navLeft).toBeGreaterThanOrEqual(0)
          expect(row.navRight).toBeLessThanOrEqual(row.documentClientWidth)
          row.buttonLefts.forEach((left) => expect(left).toBeGreaterThanOrEqual(0))
          row.buttonRights.forEach((right) =>
            expect(right).toBeLessThanOrEqual(row.documentClientWidth),
          )
          expect(row.labels[0]).toBe('最初のページへ移動')
          expect(row.labels[row.labels.length - 1]).toBe('最後のページへ移動')
          expect(row.numbers).toContain(target)
        }
      })
    }
  })
}

test.describe('switching it on from the settings screen', () => {
  test.use({ viewport: { width: 390, height: VIEWPORT_HEIGHT } })

  test('turns every paged screen to the extended pagination once saved', async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('Desktop'), 'checked on the desktop projects')
    await prepare(page)

    for (const { hash } of SCREENS) {
      await openList(page, hash, 24)
      await expect(page.getByRole('button', { name: '次のページ' })).toBeVisible()
    }

    await page.goto('/#/settings')
    const toggle = page.getByRole('switch', {
      name: 'ページネーション 拡張ページネーションの有効化',
    })
    await expect(toggle).not.toBeChecked()
    await toggle.check()
    await page.getByRole('button', { name: '保存' }).click()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(window.localStorage.getItem('settings') ?? '{}').isEnableExtendedPagination,
        ),
      )
      .toBe(true)

    for (const { hash } of SCREENS) {
      await openList(page, hash, 24)
      await expect(page.getByRole('button', { name: '最後のページへ移動' })).toBeVisible()
      await expect(page.getByRole('button', { name: '次のページ' })).toHaveCount(0)
    }
  })
})
