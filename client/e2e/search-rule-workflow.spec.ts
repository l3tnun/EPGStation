import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { clickWithoutPointerStabilityWait } from './support/pointerInteractions'
import {
  createSearchRuleRequestLog,
  installSearchRuleWorkflowApiMocks,
  searchRuleFixtureSecrecyText,
} from './support/searchRuleMocks'
import { expectAnnounced } from './support/notificationObservation'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
})

test('uses only synthetic SearchRule fixture values', () => {
  const forbiddenFixturePatterns = [
    /user(name)?|password|token|secret|authorization/i,
    /\/Users\/|\/home\/[^/]+\/|[A-Z]:\\/,
    /ffmpeg|ffprobe|encoder(command|path)|command/i,
  ]

  for (const pattern of forbiddenFixturePatterns) {
    expect(searchRuleFixtureSecrecyText).not.toMatch(pattern)
  }
})

test('drives Search result ProgramDialog and rule creation workflows', async ({ page }) => {
  const requestLog = createSearchRuleRequestLog()
  await installSearchRuleWorkflowApiMocks(page, { requestLog })

  await page.goto('/#/search?keyword=Synthetic')
  await expect(page.getByRole('heading', { name: '検索' })).toBeVisible()
  await expect(page.getByText('1 件ヒット')).toBeVisible()
  expect(requestLog.apiPaths).toContain('/api/schedules/search')

  await page.getByRole('button', { name: 'Synthetic Search Program Alpha', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Synthetic Search Program Alpha' })
  await expect(dialog.getByRole('button', { name: '詳細' })).toBeVisible()
  await dialog.getByRole('button', { name: '予約' }).click()
  await expect.poll(() => requestLog.methods).toContain('POST /api/reserves')
  await expectAnnounced(page, 'Synthetic Search Program Alpha 予約')

  await page.getByLabel('有効').uncheck()
  await page.getByLabel('録画済み番組を排除').check()
  await page.getByRole('textbox', { name: '日数' }).fill('5')
  await clickWithoutPointerStabilityWait(page.getByRole('button', { name: '追加' }))
  await expect.poll(() => requestLog.methods).toContain('POST /api/rules')
  expect(
    requestLog.bodies.find(
      (body) => typeof body === 'object' && body !== null && Object.hasOwn(body, 'reserveOption'),
    ),
  ).toMatchObject({
    reserveOption: {
      enable: false,
      avoidDuplicate: true,
      periodToAvoidDuplicate: 5,
    },
  })
  await expectAnnounced(page, 'ルール追加に成功')
})

test('drives Rule list fetch, item actions, and bulk edit workflow', async ({ page }, testInfo) => {
  const requestLog = createSearchRuleRequestLog()
  await installSearchRuleWorkflowApiMocks(page, { requestLog })

  await page.goto('/#/rule?keyword=Synthetic&page=2')
  await expect(page.getByRole('heading', { name: 'ルール' })).toBeVisible()
  await expect(page.getByText('Synthetic Rule Alpha')).toBeVisible()
  expect(requestLog.apiPaths).toContain(
    '/api/rules?type=normal&offset=24&limit=24&isHalfWidth=true&keyword=Synthetic',
  )

  const firstRule = page.getByTestId('rule-item-6201')
  const ruleSwitch = firstRule.locator('span[class*="_ruleSwitch_"]').first()
  const switchThumbBefore = await ruleSwitch
    .first()
    .evaluate((node) => getComputedStyle(node, '::after').left)
  await expect
    .soft(
      ruleSwitch.evaluate((node) => getComputedStyle(node).transitionDuration),
      'rule switch has a source-like transition instead of snapping instantly',
    )
    .resolves.not.toBe('0s')
  await firstRule.hover()
  await expect
    .soft(
      firstRule.evaluate((node) => getComputedStyle(node).backgroundColor),
      'rule row exposes a visible hover background',
    )
    .resolves.not.toBe('rgba(0, 0, 0, 0)')
  await firstRule.getByRole('button', { name: '無効化' }).click()
  await expect.poll(() => requestLog.methods).toContain('PUT /api/rules/6201/disable')
  await expectAnnounced(page, '無効化: Synthetic Rule Alpha')
  await expect(firstRule.getByRole('button', { name: '有効化' })).toBeVisible()
  await expect(ruleSwitch).toHaveAttribute('data-checked', 'false')
  if (testInfo.project.name === 'Desktop Chromium') {
    await expect
      .poll(() => ruleSwitch.evaluate((node) => getComputedStyle(node, '::after').left), {
        message: 'rule switch thumb position changes through the checked-state styling',
      })
      .not.toBe(switchThumbBefore)
  }

  await page.getByTestId('title-bar').getByRole('button', { name: '検索' }).click()
  const ruleSearchMenu = page.getByRole('menu', { name: 'ルール検索' })
  await expect(ruleSearchMenu).toBeVisible()
  await expect(ruleSearchMenu.getByRole('textbox', { name: 'キーワード' })).toHaveValue('Synthetic')
  await ruleSearchMenu.getByRole('textbox', { name: 'キーワード' }).fill('Narrow Rule')
  await ruleSearchMenu.getByRole('button', { name: '検索' }).click()
  await expect(ruleSearchMenu).toBeHidden()
  await expect(page).toHaveURL(/#\/rule\?keyword=Narrow\+Rule&timestamp=\d+$/)

  await firstRule.getByRole('button', { name: /ルールメニュー:/ }).click()
  await page.getByRole('menuitem', { name: 'recorded' }).click()
  await expect(page).toHaveURL(/#\/recorded\?ruleId=6201&timestamp=\d+$/)

  await page.goto('/#/rule')
  await page
    .getByTestId('rule-item-6201')
    .getByRole('button', { name: /ルールメニュー:/ })
    .click()
  await page.getByRole('menuitem', { name: 'edit' }).click()
  await expect(page).toHaveURL(/#\/search\?rule=6201&timestamp=\d+$/)

  await page.goto('/#/rule')
  await page
    .getByTestId('rule-item-6201')
    .getByRole('button', { name: /ルールメニュー:/ })
    .click()
  await page.getByRole('menuitem', { name: 'delete' }).click()
  await expect(page.getByRole('dialog', { name: 'ルール削除' })).toContainText(
    'Synthetic Rule Alpha を削除しますか?',
  )
  await page.getByRole('button', { name: '削除' }).click()
  await expect.poll(() => requestLog.methods).toContain('DELETE /api/rules/6201')
  await expectAnnounced(page, 'Synthetic Rule Alpha を削除')
  const pagination = page.getByRole('navigation', { name: 'ページ' })
  const viewportSize = page.viewportSize()
  const isNarrowPagination = viewportSize?.width ? viewportSize.width <= 500 : false
  await expect(pagination).toContainText(isNarrowPagination ? '5' : '16')

  await page.getByRole('button', { name: 'ルールを編集' }).click()
  await expect(page.getByTestId('edit-title-bar')).toBeVisible()
  await page.getByRole('button', { name: 'すべて選択' }).click()
  await expect(page.getByRole('heading', { name: '2 件選択' })).toBeVisible()
  await page.getByRole('button', { name: '選択項目を削除' }).click()
  const bulkDeleteDialog = page.getByRole('dialog', { name: 'ルール削除' })
  await expect(bulkDeleteDialog).toBeVisible()
  await expect(bulkDeleteDialog).toContainText('選択した 2 件のルールを削除しますか。')
  // A: v2 client/src/components/rules/RuleMultipleDeletionDialog.vue:2
  // `<v-dialog ... max-width="300" ...>`; also spec'd at
  // .kiro/specs/frontend-search-rule/visual-cases.md:33 ("bulk delete dialog は max-width 300px を超えず").
  await expect
    .soft(
      bulkDeleteDialog.evaluate((node) => Math.round(node.getBoundingClientRect().width)),
      'Rule bulk delete dialog keeps the source max-width 300px contract',
    )
    .resolves.toBeLessThanOrEqual(300)
})
