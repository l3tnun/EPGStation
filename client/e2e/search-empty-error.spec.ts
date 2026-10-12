import { expect, test, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { expectAnnounced } from './support/notificationObservation'
import { clickWithoutPointerStabilityWait } from './support/pointerInteractions'
import { installSearchRuleWorkflowApiMocks } from './support/searchRuleMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
  await installSearchRuleWorkflowApiMocks(page)
  await page.setViewportSize({ width: 1440, height: 900 })
})

// The distance from the top of the document, so that scrolling toward the result does not count
// as the control having moved.
async function documentTopOf(page: Page, name: string): Promise<number> {
  return page.getByRole('textbox', { name, exact: true }).evaluate((node) => {
    return node.getBoundingClientRect().top + window.scrollY
  })
}

async function searchFor(page: Page, keyword: string): Promise<void> {
  await page.getByRole('textbox', { name: 'keyword', exact: true }).fill(keyword)
  await clickWithoutPointerStabilityWait(
    page.getByRole('region', { name: '検索条件' }).getByRole('button', { name: '検索' }),
  )
}

test('shows 0 件ヒット and the Rule option for an empty result without moving the form controls', async ({
  page,
}) => {
  await page.route('**/api/schedules/search', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.goto('/#/search')
  await expect(page.getByRole('heading', { name: '検索' })).toBeVisible()
  const keywordTopBefore = await documentTopOf(page, 'keyword')

  await searchFor(page, 'Synthetic No Hit')

  await expect(page.getByText('0 件ヒット')).toBeVisible()
  await expect(
    page.getByRole('region', { name: '検索結果' }).getByRole('button', { name: '追加' }),
  ).toBeVisible()
  expect(await documentTopOf(page, 'keyword')).toBe(keywordTopBefore)
})

test('announces a failed search without showing a result or moving the form controls', async ({
  page,
}) => {
  await page.route('**/api/schedules/search', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })
  await page.goto('/#/search')
  await expect(page.getByRole('heading', { name: '検索' })).toBeVisible()
  const keywordTopBefore = await documentTopOf(page, 'keyword')

  await searchFor(page, 'Synthetic Error')

  await expectAnnounced(page, '検索に失敗')
  await expect(page.getByRole('region', { name: '検索結果' })).toHaveCount(0)
  expect(await documentTopOf(page, 'keyword')).toBe(keywordTopBefore)
})
