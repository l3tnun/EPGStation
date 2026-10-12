import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { pickDateTime } from './support/dateTimePicker'
import { getActiveRouteScrollY } from './support/routeScroll'
import {
  createSearchRuleRequestLog,
  installSearchRuleWorkflowApiMocks,
} from './support/searchRuleMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
})

test('keeps Search period dialogs, submit scroll, result-link scroll, and geometry parity', async ({
  page,
}) => {
  const requestLog = createSearchRuleRequestLog()
  await installSearchRuleWorkflowApiMocks(page, { requestLog })
  await page.setViewportSize({ width: 390, height: 600 })

  await page.goto('/#/search')
  await expect(page.getByRole('heading', { name: '検索' })).toBeVisible()

  const durationMin = page.getByLabel('最小(分)')
  const durationMax = page.getByLabel('最大(分)')
  await expect(durationMin).toBeVisible()
  await expect(durationMax).toBeVisible()
  await expect
    .soft(
      durationMin.evaluate((node) => Math.round(node.getBoundingClientRect().width)),
      'duration min field remains source-width and is not stretched to the row width',
    )
    .resolves.toBeLessThanOrEqual(110)
  await expect
    .soft(
      durationMax.evaluate((node) => Math.round(node.getBoundingClientRect().width)),
      'duration max field remains source-width and is not stretched to the row width',
    )
    .resolves.toBeLessThanOrEqual(110)

  const actionRow = page
    .getByTestId('search-rule-page')
    .locator('div')
    .filter({
      has: page.getByRole('button', { name: '検索' }),
    })
    .last()
  await expect
    .soft(
      actionRow.evaluate((node) => getComputedStyle(node).borderTopWidth),
      'Search action row divider is placed above the clear/search buttons',
    )
    .resolves.toBe('1px')
  await expect
    .soft(
      actionRow.evaluate((node) => getComputedStyle(node).borderBottomWidth),
      'Search action row does not add the divider below the buttons',
    )
    .resolves.toBe('0px')

  await page.getByRole('textbox', { name: '開始', exact: true }).click()
  const startDialog = page.getByRole('dialog', { name: '期間 開始' })
  await expect(startDialog).toBeVisible()
  await pickDateTime(startDialog, { year: 2026, month: 5, day: 5, hour: 9, minute: 0 })
  await startDialog.getByRole('button', { name: '設定' }).click()
  await expect(startDialog).toBeHidden()
  await expect(
    page.getByTestId('search-rule-page').getByRole('textbox', { name: '開始', exact: true }),
  ).toHaveValue('2026-05-05T09:00')

  await page
    .getByTestId('search-rule-page')
    .getByRole('textbox', { name: '終了', exact: true })
    .click()
  const endDialog = page.getByRole('dialog', { name: '期間 終了' })
  await expect(endDialog).toBeVisible()
  await pickDateTime(endDialog, { year: 2026, month: 5, day: 5, hour: 12, minute: 0 })
  await endDialog.getByRole('button', { name: '設定' }).click()
  await expect(endDialog).toBeHidden()
  await expect(
    page.getByTestId('search-rule-page').getByRole('textbox', { name: '終了', exact: true }),
  ).toHaveValue('2026-05-05T12:00')

  await page.getByTestId('search-rule-page').getByRole('button', { name: '検索' }).click()
  const resultRegion = page.getByRole('region', { name: '検索結果' })
  await expect(resultRegion).toBeVisible()
  await expect
    .poll(async () => getActiveRouteScrollY(page), {
      message: 'Search submit scrolls to the result section instead of leaving the viewport at top',
    })
    .toBeGreaterThan(0)
  expect(
    requestLog.bodies.find(
      (body) => typeof body === 'object' && body !== null && Object.hasOwn(body, 'option'),
    ),
  ).toMatchObject({
    option: {
      searchPeriods: [
        {
          startAt: Date.parse('2026-05-05T09:00:00+09:00'),
          endAt: Date.parse('2026-05-05T12:00:00+09:00'),
        },
      ],
    },
  })

  await page.getByRole('button', { name: '録画設定へ移動' }).click()
  const ruleOptionAnchor = page.getByTestId('search-rule-option-anchor')
  const titleBarBottom = await page
    .getByTestId('title-bar')
    .evaluate((node) => Math.round(node.getBoundingClientRect().bottom))
  await expect
    .poll(
      async () => ruleOptionAnchor.evaluate((node) => Math.round(node.getBoundingClientRect().top)),
      {
        message:
          'SearchResult header link scrolls to the Rule option card below the fixed title bar, not back to the page top',
      },
    )
    .toBeLessThanOrEqual(titleBarBottom + 24)
})

test('keeps Search top FAB outside the permanent drawer and scrolls the active iOS shell owner', async ({
  page,
}) => {
  await installSearchRuleWorkflowApiMocks(page)
  await page.setViewportSize({ width: 1264, height: 900 })

  await page.goto('/#/search?keyword=Synthetic')
  await expect(page.getByRole('heading', { name: '検索' })).toBeVisible()

  const desktopGeometry = await page.evaluate(() => {
    const drawer = document
      .querySelector<HTMLElement>('[data-testid="shell-drawer"]')
      ?.querySelector<HTMLElement>('[role="presentation"]')
    const button = document.querySelector<HTMLElement>('button[aria-label="トップへ戻る"]')

    if (drawer === null || drawer === undefined || button === null) {
      throw new Error('Search top FAB geometry elements are missing')
    }

    return {
      buttonBottom: Math.round(button.getBoundingClientRect().bottom),
      buttonHeight: Math.round(button.getBoundingClientRect().height),
      buttonLeft: Math.round(button.getBoundingClientRect().left),
      buttonWidth: Math.round(button.getBoundingClientRect().width),
      drawerRight: Math.round(drawer.getBoundingClientRect().right),
      viewportHeight: window.innerHeight,
    }
  })

  // Measured against the v2 build in real Chromium (`views/Search.vue:10` renders
  // `<v-btn dark fixed bottom fab color="pink">`, which specifies neither `left` nor `right`, so the
  // position can only be established by measurement). At 1440x900 with the drawer open, v2's FAB
  // sits at left 268 with the drawer's right edge at 256 -- drawerRight + 12. At 390x844 with the
  // drawer hidden it sits at left 12. Both keep bottom 16 and a 56px square.
  expect(desktopGeometry.buttonLeft).toBe(desktopGeometry.drawerRight + 12)
  expect(desktopGeometry.buttonBottom).toBe(desktopGeometry.viewportHeight - 16)
  expect(desktopGeometry.buttonWidth).toBe(56)
  expect(desktopGeometry.buttonHeight).toBe(56)

  await page.evaluate(() => {
    document.documentElement.classList.add('fix-address-bar2')
    const shellMain = document.querySelector<HTMLElement>('[data-testid="shell-main"]')
    if (shellMain === null) {
      throw new Error('shell-main is missing')
    }
    shellMain.scrollTop = 480
    window.scrollTo(0, 0)
  })
  await expect.poll(async () => getActiveRouteScrollY(page)).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'トップへ戻る' }).click()

  await expect
    .poll(async () =>
      page.evaluate(
        () => document.querySelector<HTMLElement>('[data-testid="shell-main"]')?.scrollTop ?? -1,
      ),
    )
    .toBe(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-variant', 'temporary')
  const mobileGeometry = await page
    .getByRole('button', { name: 'トップへ戻る' })
    .evaluate((button) => {
      const rect = button.getBoundingClientRect()

      return {
        bottom: Math.round(rect.bottom),
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        viewportHeight: window.innerHeight,
        width: Math.round(rect.width),
      }
    })

  expect(mobileGeometry.left).toBe(12)
  expect(mobileGeometry.bottom).toBe(mobileGeometry.viewportHeight - 16)
  expect(mobileGeometry.width).toBe(56)
  expect(mobileGeometry.height).toBe(56)
})
