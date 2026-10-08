import { expect, test, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  installPagedRuleListApiMocks,
  installSearchRuleWorkflowApiMocks,
  seedExtendedPagination,
} from './support/searchRuleMocks'

// Colors of both paginations equal those of the v2 v-pagination (Vuetify 2.7.0, default theme).
const SHADOW =
  'rgba(0, 0, 0, 0.2) 0px 3px 1px -2px, rgba(0, 0, 0, 0.14) 0px 2px 2px 0px, rgba(0, 0, 0, 0.12) 0px 1px 5px 0px'
const ACTIVE_SHADOW =
  'rgba(0, 0, 0, 0.2) 0px 2px 4px -1px, rgba(0, 0, 0, 0.14) 0px 4px 5px 0px, rgba(0, 0, 0, 0.12) 0px 1px 10px 0px'

interface Reading {
  background: string
  color: string
  shadow: string
  opacity: string
}

interface Readings {
  mode: string | null | undefined
  current: Reading
  number: Reading
  arrow: Reading
  disabledArrow: Reading
  ellipsis: string | null
}

async function prepare(page: Page, extended: boolean, dark: boolean): Promise<void> {
  await installAppShellApiMocks(page, {
    enableBroadcastWaveNavigation: true,
    forceDarkTheme: dark,
  })
  await installSearchRuleWorkflowApiMocks(page)
  await installPagedRuleListApiMocks(page)
  await seedExtendedPagination(page, extended)
}

async function open(page: Page, ruleListPage: number): Promise<void> {
  await page.goto(`/#/rule?page=${ruleListPage}`)
  await expect(page.getByTestId(`rule-item-${10000 + (ruleListPage - 1) * 24}`)).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'ページ' })).toBeVisible()
}

function readStyle(button: Element): Reading {
  const style = getComputedStyle(button)

  return {
    background: style.backgroundColor,
    color: style.color,
    shadow: style.boxShadow,
    opacity: style.opacity,
  }
}

async function readAll(page: Page, extended: boolean): Promise<Readings> {
  await open(page, 24)
  const nav = page.getByRole('navigation', { name: 'ページ' })
  const pick = (selector: string): Promise<Reading> =>
    nav.locator(selector).first().evaluate(readStyle)
  const numberLabel = extended ? 'ページ23へ移動' : '23 ページ'
  const numberSelector = `button[aria-label="${numberLabel}"]`
  const arrowLabel = extended ? '最後のページへ移動' : '次のページ'
  const result: Readings = {
    mode: await page.locator('[data-theme-mode]').first().getAttribute('data-theme-mode'),
    current: await pick('button[aria-current="page"]'),
    number: await pick(numberSelector),
    arrow: await pick(`button[aria-label="${arrowLabel}"]`),
    disabledArrow: { background: '', color: '', shadow: '', opacity: '' },
    ellipsis: extended
      ? null
      : await nav
          .getByText('...')
          .first()
          .evaluate((el) => getComputedStyle(el).color),
  }
  await open(page, 1)
  result.disabledArrow = await page
    .getByRole('navigation', { name: 'ページ' })
    .locator(`button[aria-label="${extended ? '最初のページへ移動' : '前のページ'}"]`)
    .evaluate(readStyle)

  return result
}

const expected = (dark: boolean): Omit<Readings, 'ellipsis' | 'mode'> => {
  const background = dark ? 'rgb(30, 30, 30)' : 'rgb(255, 255, 255)'

  return {
    current: {
      background: 'rgb(25, 118, 210)',
      color: 'rgb(255, 255, 255)',
      shadow: ACTIVE_SHADOW,
      opacity: '1',
    },
    number: {
      background,
      color: dark ? 'rgb(255, 255, 255)' : 'rgba(0, 0, 0, 0.87)',
      shadow: SHADOW,
      opacity: '1',
    },
    arrow: {
      background,
      color: dark ? 'rgb(255, 255, 255)' : 'rgba(0, 0, 0, 0.54)',
      shadow: SHADOW,
      opacity: '1',
    },
    disabledArrow: {
      background,
      color: dark ? 'rgb(255, 255, 255)' : 'rgba(0, 0, 0, 0.54)',
      shadow: SHADOW,
      opacity: '0.6',
    },
  }
}

test.describe('pagination colors match the v2 v-pagination', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern here
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('Desktop'), 'checked on the desktop projects')
  })

  for (const extended of [false, true]) {
    for (const dark of [false, true]) {
      test(`${extended ? 'extended' : 'legacy'} pagination in the ${dark ? 'dark' : 'light'} theme`, async ({
        page,
      }) => {
        await prepare(page, extended, dark)
        const readings = await readAll(page, extended)
        const want = expected(dark)

        expect(readings.mode).toBe(dark ? 'dark' : 'light')
        expect(readings.current).toStrictEqual(want.current)
        expect(readings.number).toStrictEqual(want.number)
        expect(readings.arrow).toStrictEqual(want.arrow)
        expect(readings.disabledArrow).toStrictEqual(want.disabledArrow)
        if (!extended) {
          expect(readings.ellipsis).toBe(dark ? 'rgb(255, 255, 255)' : 'rgba(0, 0, 0, 0.87)')
        }
      })
    }
  }
})
