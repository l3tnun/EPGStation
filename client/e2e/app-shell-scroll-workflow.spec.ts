import {
  installRouteScrollRestoreMocks,
  routeScrollRestoreCases,
  withRouteTimestamp,
} from './support/appShellWorkflow'
import {
  addRouteScrollSpacer,
  getActiveRouteScrollY,
  scrollActiveRouteTo,
} from './support/routeScroll'
import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { installSearchRuleWorkflowApiMocks } from './support/searchRuleMocks'

test('[AC 6.15] restores the rule list scroll position immediately after browser back', async ({
  page,
}) => {
  await installAppShellApiMocks(page)
  await installSearchRuleWorkflowApiMocks(page)

  await page.goto('/#/rule?timestamp=rule-scroll-restore')
  await expect(page.getByTestId('rule-page')).toBeVisible()
  // 一覧の描画で scroll 位置より上の高さが変わるので、行が見えてから scroll する。
  await expect(page.getByText('Synthetic Rule Alpha')).toBeVisible()
  await addRouteScrollSpacer(page, {
    styleTestId: 'rule-scroll-restore-spacer-style',
    heightPx: 2200,
  })
  const savedScrollY = 640
  await scrollActiveRouteTo(page, savedScrollY)
  await expect.poll(() => getActiveRouteScrollY(page)).toBe(savedScrollY)

  await page.evaluate(() => {
    window.location.hash = '#/settings?timestamp=rule-scroll-restore-settings'
  })
  await expect(page.getByTestId('settings-screen')).toBeVisible()
  await scrollActiveRouteTo(page, 0)
  await expect.poll(() => getActiveRouteScrollY(page)).toBe(0)

  await page.goBack()
  await expect(page.getByTestId('rule-page')).toBeVisible()
  await expect
    .poll(() => getActiveRouteScrollY(page), {
      message: 'Rule list browser-back restores the saved position instead of settling early',
      timeout: 1500,
    })
    .toBe(savedScrollY)
})

test('[AC 6.15] restores each Rule list page scroll position across multiple browser-back steps', async ({
  page,
}) => {
  await installAppShellApiMocks(page)
  await installSearchRuleWorkflowApiMocks(page)

  const pageScrolls = [
    { page: 1, scrollY: 40 },
    { page: 2, scrollY: 80 },
    { page: 3, scrollY: 120 },
    { page: 4, scrollY: 160 },
  ]

  await page.goto('/#/rule?timestamp=rule-multi-page-scroll-restore')
  await expect(page.getByTestId('rule-page')).toBeVisible()
  await expect(page.getByText('Synthetic Rule Alpha')).toBeVisible()
  await addRouteScrollSpacer(page, {
    styleTestId: 'rule-multi-page-scroll-restore-style',
    heightPx: 2400,
    extraCss:
      'nav[aria-label="ページ"] { position: fixed; right: 16px; bottom: 16px; z-index: 10000; background: white; }',
  })

  for (const { page: pageNumber, scrollY } of pageScrolls) {
    await expect(
      page.getByRole('button', { name: `${pageNumber} ページ`, exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    await expect(page.getByText('Synthetic Rule Alpha')).toBeVisible()
    await scrollActiveRouteTo(page, scrollY)
    await expect.poll(() => getActiveRouteScrollY(page)).toBe(scrollY)

    if (pageNumber < 4) {
      await page.getByRole('button', { name: `${pageNumber + 1} ページ`, exact: true }).click()
      // app が page だけの URL に timestamp を足して replace し終えてから次の scroll を置く。
      await expect(page).toHaveURL(
        (url) => url.hash.includes(`page=${pageNumber + 1}`) && url.hash.includes('timestamp='),
      )
      await expect(page.getByTestId('rule-page')).toBeVisible()
    }
  }

  for (const { page: pageNumber, scrollY } of [...pageScrolls].reverse().slice(1)) {
    await page.goBack()
    await expect(
      page.getByRole('button', { name: `${pageNumber} ページ`, exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    await expect
      .poll(() => getActiveRouteScrollY(page), {
        message: `Rule page ${pageNumber} browser-back restores its own scroll position`,
      })
      .toBe(scrollY)
  }
})

for (const {
  route,
  testId,
  detourNavigationItemId,
  detourTestId,
  renderedLocator,
} of routeScrollRestoreCases) {
  test(`[AC 6.15] restores route scroll position after browser back on ${route}`, async ({
    page,
  }) => {
    await installRouteScrollRestoreMocks(page)

    await page.goto(`/#${withRouteTimestamp(route)}`)
    await expect(page.getByTestId(testId)).toBeVisible()
    if (renderedLocator !== undefined) {
      await expect(renderedLocator(page)).toBeVisible()
    }
    await addRouteScrollSpacer(page, {
      styleTestId: `route-scroll-restore-${testId}-style`,
      heightPx: 2400,
    })
    const savedScrollY = 720
    await scrollActiveRouteTo(page, savedScrollY)
    await expect.poll(() => getActiveRouteScrollY(page)).toBe(savedScrollY)

    await page.getByTestId(detourNavigationItemId).dispatchEvent('pointerdown')
    await page.getByTestId(detourNavigationItemId).dispatchEvent('click')
    await expect(page.getByTestId(detourTestId)).toBeVisible()
    await scrollActiveRouteTo(page, 0)

    await page.goBack()
    await expect(page.getByTestId(testId)).toBeVisible()
    await expect
      .poll(async () => Math.abs((await getActiveRouteScrollY(page)) - savedScrollY), {
        message: `${route} browser-back restores its previous route scroll position`,
        timeout: 1500,
      })
      .toBeLessThanOrEqual(1)
  })
}
