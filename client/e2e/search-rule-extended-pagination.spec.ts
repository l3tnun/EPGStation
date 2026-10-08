import { expect, test, type Locator, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  installPagedRuleListApiMocks,
  installSearchRuleWorkflowApiMocks,
  seedExtendedPagination,
} from './support/searchRuleMocks'

// 1,125 synthetic rules at 24 per page: 47 pages, far more than the widest row can show.
const LAST_PAGE = 47
const ELEMENT_COUNTS = [7, 9, 11, 13, 15, 17]
const WIDTHS = [320, 375, 390, 412, 768, 1024, 1280, 1920] as const
const TOUCH_WIDTHS = [320, 375, 390, 412, 768, 1024] as const
const VIEWPORT_HEIGHT = 800

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
  if (enabled !== undefined) {
    await seedExtendedPagination(page, enabled)
  }
}

function paginationNav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'ページ' })
}

async function openRuleList(page: Page, ruleListPage: number): Promise<void> {
  await page.goto(`/#/rule?page=${ruleListPage}`)
  await expect(page.getByTestId(`rule-item-${10000 + (ruleListPage - 1) * 24}`)).toBeVisible()
  await expect(paginationNav(page)).toBeVisible()
}

interface RowReading {
  documentClientWidth: number
  documentScrollWidth: number
  innerWidth: number
  navClientWidth: number
  navLeft: number
  navRight: number
  navScrollWidth: number
  labels: string[]
  numbers: number[]
  offsetLefts: number[]
  offsetWidths: number[]
  buttonLefts: number[]
  buttonRights: number[]
  currentLabel: string | null
}

async function readRow(page: Page): Promise<RowReading> {
  return paginationNav(page).evaluate((nav) => {
    const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>('button'))
    const navRect = nav.getBoundingClientRect()

    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
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
      offsetWidths: buttons.map((button) => button.offsetWidth),
      buttonLefts: buttons.map((button) => button.getBoundingClientRect().left),
      buttonRights: buttons.map((button) => button.getBoundingClientRect().right),
      currentLabel:
        nav.querySelector('button[aria-current="page"]')?.getAttribute('aria-label') ?? null,
    }
  })
}

// Re-derives the element count from the rule in the spec, using only what the browser lays out:
// the largest of 7 / 9 / ... / 17 whose `count * (button width + margins)` fits the row (7 when
// none fits). Capped by the page count, which never applies with 47 pages.
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

async function activate(target: Locator, isTouch: boolean): Promise<void> {
  if (isTouch) {
    await target.tap()
  } else {
    await target.click()
  }
}

function currentRoutePage(page: Page): number {
  const match = /[?&]page=(\d+)/.exec(page.url())

  return match === null ? 1 : Number(match[1])
}

// What the row looks like for each viewport width. The numbers come from the running app: the
// content column is the viewport minus the page padding (and, from 1280px, the permanent drawer),
// then divided into 40px slots. They are checked against the rule above, so a change here that
// disagrees with the rule fails.
const EXPECTED_ELEMENT_COUNT: Record<number, number> = {
  320: 7,
  375: 7,
  390: 9,
  412: 9,
  768: 17,
  1024: 17,
  1280: 17,
  1920: 17,
}

function defineWidthTests(width: number, isTouch: boolean): void {
  test.describe(`${width}px ${isTouch ? 'touch' : 'pointer'}`, () => {
    test.use({
      viewport: { width, height: VIEWPORT_HEIGHT },
      hasTouch: isTouch,
      isMobile: isTouch,
    })

    test.beforeEach(async ({ page, browserName }, testInfo) => {
      if (isTouch) {
        test.skip(browserName === 'firefox', 'Firefox has no mobile emulation (isMobile)')
      } else {
        test.skip(
          !testInfo.project.name.startsWith('Desktop'),
          'pointer-width matrix runs on the desktop projects',
        )
      }
      await prepare(page, { enabled: true })
    })

    test('fits the row inside the viewport with the element count the rule gives', async ({
      page,
    }, testInfo) => {
      await openRuleList(page, 24)
      const row = await readSettledRow(page)

      testInfo.annotations.push({
        type: 'row',
        description: `nav ${row.navClientWidth}px -> ${row.labels.length} elements`,
      })
      expect(row.documentScrollWidth).toBeLessThanOrEqual(row.documentClientWidth)
      expect(row.navScrollWidth).toBeLessThanOrEqual(row.navClientWidth)
      expect(row.navLeft).toBeGreaterThanOrEqual(0)
      expect(row.navRight).toBeLessThanOrEqual(row.documentClientWidth)
      row.buttonLefts.forEach((left) => expect(left).toBeGreaterThanOrEqual(0))
      row.buttonRights.forEach((right) =>
        expect(right).toBeLessThanOrEqual(row.documentClientWidth),
      )
      expect(row.labels).toHaveLength(expectedElementCount(row))
      expect(row.labels).toHaveLength(EXPECTED_ELEMENT_COUNT[width])
      expect(row.labels[0]).toBe('最初のページへ移動')
      expect(row.labels[row.labels.length - 1]).toBe('最後のページへ移動')
      expect(row.numbers).toHaveLength(row.labels.length - 2)
      expect(row.numbers).toContain(24)
      expect(row.currentLabel).toBe('ページ数を入力して移動')
    })

    test('leaves every button clickable above the fixed add button at the end of the page', async ({
      page,
    }) => {
      await openRuleList(page, 24)
      await readSettledRow(page)

      const covered = await paginationNav(page).evaluate(async (nav) => {
        // Scroll whatever scrolls (the window or an inner container) to its very end.
        for (let element: Element | null = nav; element !== null; element = element.parentElement) {
          element.scrollTop = element.scrollHeight
        }
        window.scrollTo(0, document.documentElement.scrollHeight)
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

        return Array.from(nav.querySelectorAll<HTMLButtonElement>('button'))
          .filter((button) => {
            const rect = button.getBoundingClientRect()
            const hit = document.elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            )

            return hit === null || !button.contains(hit)
          })
          .map((button) => button.getAttribute('aria-label'))
      })

      expect(covered).toStrictEqual([])
    })

    test('keeps the element count and fit at the first and the last page', async ({ page }) => {
      for (const target of [1, LAST_PAGE]) {
        await openRuleList(page, target)
        const row = await readSettledRow(page)

        expect(row.labels).toHaveLength(EXPECTED_ELEMENT_COUNT[width])
        expect(row.documentScrollWidth).toBeLessThanOrEqual(row.documentClientWidth)
        expect(row.navScrollWidth).toBeLessThanOrEqual(row.navClientWidth)
        expect(row.numbers).toContain(target)
        // The window is shifted to the other side instead of shrinking.
        expect(row.numbers[target === 1 ? 0 : row.numbers.length - 1]).toBe(target)
      }
    })

    test('moves with ≪, ≫ and the page numbers', async ({ page }) => {
      await openRuleList(page, 24)
      const nav = paginationNav(page)

      await activate(nav.getByRole('button', { name: '最後のページへ移動' }), isTouch)
      await expect(page.getByTestId(`rule-item-${10000 + (LAST_PAGE - 1) * 24}`)).toBeVisible()
      expect(currentRoutePage(page)).toBe(LAST_PAGE)
      await expect(nav.getByRole('button', { name: '最後のページへ移動' })).toBeDisabled()
      await expect(nav.getByRole('button', { name: '最初のページへ移動' })).toBeEnabled()
      expect((await readSettledRow(page)).labels).toHaveLength(EXPECTED_ELEMENT_COUNT[width])

      await activate(nav.getByRole('button', { name: 'ページ46へ移動' }), isTouch)
      await expect(page.getByTestId(`rule-item-${10000 + 45 * 24}`)).toBeVisible()
      expect(currentRoutePage(page)).toBe(46)

      await activate(nav.getByRole('button', { name: '最初のページへ移動' }), isTouch)
      await expect(page.getByTestId('rule-item-10000')).toBeVisible()
      expect(currentRoutePage(page)).toBe(1)
      await expect(nav.getByRole('button', { name: '最初のページへ移動' })).toBeDisabled()
      await expect(nav.getByRole('button', { name: '最後のページへ移動' })).toBeEnabled()

      await activate(nav.getByRole('button', { name: 'ページ3へ移動' }), isTouch)
      await expect(page.getByTestId(`rule-item-${10000 + 2 * 24}`)).toBeVisible()
      expect(currentRoutePage(page)).toBe(3)
    })

    test('moves through the page number dialog and refuses invalid input', async ({ page }) => {
      await openRuleList(page, 24)
      const nav = paginationNav(page)

      await activate(nav.getByRole('button', { name: 'ページ数を入力して移動' }), isTouch)
      const dialog = page.getByRole('dialog', { name: 'ページ数を入力' })
      await expect(dialog).toBeVisible()
      const input = dialog.getByRole('textbox', { name: 'ページ数' })
      await expect(input).toBeFocused()

      const box = await dialog.boundingBox()
      expect(box).not.toBeNull()
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)
      expect(box?.y ?? -1).toBeGreaterThanOrEqual(0)
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(VIEWPORT_HEIGHT)

      for (const invalid of ['', '0', '-1', '1.5', 'abc', '48', '999']) {
        await input.fill(invalid)
        await activate(dialog.getByRole('button', { name: '移動' }), isTouch)
        await expect(dialog.getByText(`1 〜 ${LAST_PAGE} の整数を入力してください`)).toBeVisible()
        expect(currentRoutePage(page)).toBe(24)
        await expect(dialog).toBeVisible()
      }

      await input.fill('30')
      await input.press('Enter')
      await expect(dialog).toBeHidden()
      await expect(page.getByTestId(`rule-item-${10000 + 29 * 24}`)).toBeVisible()
      expect(currentRoutePage(page)).toBe(30)

      await activate(nav.getByRole('button', { name: 'ページ数を入力して移動' }), isTouch)
      await expect(dialog).toBeVisible()
      await expect(input).toHaveValue('')
      await input.fill('31')
      await activate(dialog.getByRole('button', { name: '移動' }), isTouch)
      await expect(dialog).toBeHidden()
      expect(currentRoutePage(page)).toBe(31)

      await activate(nav.getByRole('button', { name: 'ページ数を入力して移動' }), isTouch)
      await input.fill('5')
      await activate(dialog.getByRole('button', { name: 'キャンセル' }), isTouch)
      await expect(dialog).toBeHidden()
      expect(currentRoutePage(page)).toBe(31)
    })

    test('enlarges the current page without moving its neighbours', async ({ page }) => {
      await openRuleList(page, 24)
      const row = await readSettledRow(page)

      // Every box has the same width and the same distance to the next one.
      expect(new Set(row.offsetWidths).size).toBe(1)
      const pitches = row.offsetLefts.slice(1).map((left, index) => left - row.offsetLefts[index])
      expect(new Set(pitches).size).toBe(1)

      const measure = () =>
        paginationNav(page).evaluate((nav) =>
          Array.from(nav.querySelectorAll<HTMLButtonElement>('button')).map((button) => {
            const rect = button.getBoundingClientRect()

            return {
              current: button.getAttribute('aria-current') === 'page',
              transform: getComputedStyle(button).transform,
              left: rect.left,
              width: rect.width,
            }
          }),
        )
      const enlarged = await measure()
      const current = enlarged.find((button) => button.current)
      expect(current?.transform).toBe('matrix(1.1, 0, 0, 1.1, 0, 0)')
      expect(current?.width).toBeCloseTo(row.offsetWidths[0] * 1.1, 1)
      enlarged
        .filter((button) => !button.current)
        .forEach((button) => {
          expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(button.transform)
          expect(button.width).toBeCloseTo(row.offsetWidths[0], 1)
        })

      await paginationNav(page)
        .locator('button[aria-current="page"]')
        .evaluate((button) => {
          button.style.transition = 'none'
          button.style.transform = 'none'
        })
      const plain = await measure()
      enlarged.forEach((button, index) => {
        if (!button.current) {
          expect(button.left).toBeCloseTo(plain[index].left, 2)
          expect(button.width).toBeCloseTo(plain[index].width, 2)
        }
      })
    })
  })
}

for (const width of WIDTHS) {
  defineWidthTests(width, false)
}
for (const width of TOUCH_WIDTHS) {
  defineWidthTests(width, true)
}

test.describe('theme colors', () => {
  test.use({ viewport: { width: 1280, height: VIEWPORT_HEIGHT } })

  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern here
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('Desktop'), 'checked on the desktop projects')
  })

  for (const dark of [false, true]) {
    test(`paints the current page with the primary color in the ${dark ? 'dark' : 'light'} theme`, async ({
      page,
    }) => {
      await prepare(page, { enabled: true, dark })
      await openRuleList(page, 24)
      await readSettledRow(page)

      const colors = await paginationNav(page).evaluate((nav) => {
        const probe = document.createElement('span')
        probe.style.color = 'var(--mui-palette-primary-main)'
        nav.append(probe)
        const primary = getComputedStyle(probe).color
        probe.remove()
        const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>('button'))
        const current = nav.querySelector<HTMLButtonElement>('button[aria-current="page"]')
        const other = buttons.find(
          (button) => button !== current && button.getAttribute('aria-label')?.startsWith('ページ'),
        )

        return {
          primary,
          currentColor: current === null ? '' : getComputedStyle(current).color,
          otherColor: other === undefined ? '' : getComputedStyle(other).color,
          otherBackground: other === undefined ? '' : getComputedStyle(other).backgroundColor,
          dataThemeMode: document
            .querySelector('[data-theme-mode]')
            ?.getAttribute('data-theme-mode'),
        }
      })

      expect(colors.dataThemeMode).toBe(dark ? 'dark' : 'light')
      expect(colors.currentColor).toBe(colors.primary)
      expect(colors.otherColor).not.toBe(colors.primary)
      expect(colors.otherBackground).not.toBe(dark ? 'rgb(255, 255, 255)' : 'rgba(0, 0, 0, 0)')
    })
  }
})

test.describe('setting off keeps the current pagination', () => {
  for (const width of [390, 1280]) {
    test(`renders the same legacy pagination at ${width}px with the setting off or absent`, async ({
      page,
    }, testInfo) => {
      test.skip(!testInfo.project.name.startsWith('Desktop'), 'checked on the desktop projects')
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT })

      await prepare(page, { enabled: false })
      await openRuleList(page, 24)
      const off = await paginationNav(page).evaluate((nav) => nav.outerHTML)
      const offBox = await paginationNav(page).boundingBox()

      const absent = await page.context().newPage()
      await prepare(absent, { enabled: null })
      await absent.setViewportSize({ width, height: VIEWPORT_HEIGHT })
      await openRuleList(absent, 24)
      const absentHtml = await paginationNav(absent).evaluate((nav) => nav.outerHTML)
      const absentBox = await paginationNav(absent).boundingBox()

      expect(off).toBe(absentHtml)
      expect(offBox).toStrictEqual(absentBox)
      await expect(page.getByRole('button', { name: '前のページ' })).toBeVisible()
      await expect(page.getByRole('button', { name: '次のページ' })).toBeVisible()
      await expect(page.getByRole('button', { name: '最初のページへ移動' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: '最後のページへ移動' })).toHaveCount(0)
    })
  }
})

test.describe('switching it on from the settings screen', () => {
  test.use({ viewport: { width: 390, height: VIEWPORT_HEIGHT } })

  test('enables the extended pagination only after saving, and only on the rule list', async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('Desktop'), 'checked on the desktop projects')
    await prepare(page)

    await openRuleList(page, 24)
    await expect(page.getByRole('button', { name: '次のページ' })).toBeVisible()

    await page.goto('/#/settings')
    const toggle = page.getByRole('switch', { name: 'ルール 拡張ページネーションの有効化' })
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

    await openRuleList(page, 24)
    await expect(page.getByRole('button', { name: '最後のページへ移動' })).toBeVisible()
    await expect(page.getByRole('button', { name: '次のページ' })).toHaveCount(0)
  })
})
