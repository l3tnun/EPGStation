import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  installReservesApiMocks,
  manualProgramDetail,
  manualReserveEdit,
  manualReserveOptions,
  reserveDeleteTarget,
  reserveDialogFull,
  reservesMixedList,
  reservesStateFilters,
} from './support/reservesMocks'
import {
  createSearchRuleRequestLog,
  installSearchRuleWorkflowApiMocks,
} from './support/searchRuleMocks'
import { isExpectedBrowserConsoleNoise } from './support/reservesWorkflowHelpers'
import { clickWithoutPointerStabilityWait, openReservesMenu } from './support/pointerInteractions'
import { getActiveRouteScrollY } from './support/routeScroll'
import { expectAnnounced } from './support/notificationObservation'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
})

test('exports the Reserves mock-data contract fields', () => {
  const requiredReserveFields = [
    'id',
    'reserveId',
    'ruleId',
    'programId',
    'isManual',
    'isConflict',
    'isSkip',
    'isOverlap',
    'canDelete',
    'canUnlockSkip',
    'canUnlockOverlap',
    'durationMinutes',
  ] as const

  // D: .kiro/specs/frontend-reserves/mock-data.md:11 requires "reserve item 12 件以上" verbatim.
  // e2e/support/reservesFixtures.ts:141-172 (5 named reserves + `Array.from({ length: 8 }, ...)`)
  // currently provides 13, satisfying the spec's "12 or more" with 1 row of headroom.
  expect(reservesMixedList.length).toBeGreaterThanOrEqual(12)
  for (const reserve of reservesMixedList) {
    for (const field of requiredReserveFields) {
      expect(reserve).toHaveProperty(field)
    }
    expect(reserve.reserveId).toBe(reserve.id)
    expect(typeof reserve.isManual).toBe('boolean')
    expect(typeof reserve.isConflict).toBe('boolean')
    expect(typeof reserve.isSkip).toBe('boolean')
    expect(typeof reserve.isOverlap).toBe('boolean')
    expect(typeof reserve.canDelete).toBe('boolean')
    expect(typeof reserve.canUnlockSkip).toBe('boolean')
    expect(typeof reserve.canUnlockOverlap).toBe('boolean')
    // D: every reservesFixtures.ts entry sets durationMinutes to a positive value (30/45/50) - this
    // checks the fixture stays well-formed, not a computed production value.
    expect(reserve.durationMinutes).toBeGreaterThan(0)
  }
  expect(reserveDialogFull.ruleId).toBeNull()
  expect(reserveDeleteTarget.ruleId).toBe(502)
  expect(reservesStateFilters.map((filter) => filter.expectedFilterType)).toEqual([
    'normal',
    'conflict',
    'skip',
    'overlap',
  ])
  expect(manualReserveOptions.timeSpecifiedOptions.valid).toMatchObject({
    name: 'Synthetic Time Specified Reserve',
    channelId: 410,
  })
  expect(manualReserveOptions.saveOptions).toHaveProperty('omitted')
  expect(manualReserveOptions.encodeOptions.multipleSelected).toMatchObject({
    mode1: 'synthetic-encode-main',
    mode2: 'synthetic-encode-sub',
    isDeleteOriginalAfterEncode: false,
  })
  expect(manualReserveOptions.encodeOptions.deleteOriginalSelected).toMatchObject({
    isDeleteOriginalAfterEncode: true,
  })
  expect(manualReserveEdit).toMatchObject({
    reserveIdFixture: manualReserveEdit.id,
    programIdFixture: manualProgramDetail.id,
    savedPageInfo: {
      isTimeSpecification: true,
    },
    editModeNoRestorePageInfo: {
      isTimeSpecification: false,
    },
  })
})

test('renders Reserves list table/card states and drives dialog and menu actions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const reservesMocks = await installReservesApiMocks(page)
  const searchRuleRequestLog = createSearchRuleRequestLog()
  await installSearchRuleWorkflowApiMocks(page, { requestLog: searchRuleRequestLog })
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !isExpectedBrowserConsoleNoise(message.text())) {
      consoleErrors.push(message.text())
    }
  })

  await page.goto('/#/reserves')

  await expect(page.getByTestId('reserves-page')).toHaveAttribute('data-reserves-layout', 'table')
  await expect(page.getByRole('region', { name: '予約一覧' })).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByText(reserveDialogFull.name)).toBeVisible()
  await expect(page.getByTestId('reserves-list-item').first()).toHaveAttribute(
    'data-needs-decoration',
    'false',
  )

  await page.setViewportSize({ width: 800, height: 900 })
  await expect(page.getByTestId('reserves-page')).toHaveAttribute('data-reserves-layout', 'card')

  await page.getByRole('button', { name: new RegExp(`^${reserveDialogFull.name}`) }).click()
  const dialog = page.getByRole('dialog', { name: reserveDialogFull.name })
  await expect(dialog).toContainText('Synthetic Channel A')
  await expect(
    dialog.getByRole('link', { name: 'https://example.invalid/reserve-info' }),
  ).toHaveAttribute('href', 'https://example.invalid/reserve-info')
  await dialog.getByRole('button', { name: '閉じる' }).click()

  await openReservesMenu(page, reserveDeleteTarget.name)
  await page.getByRole('menuitem', { name: 'delete' }).click()
  await expect(page.getByRole('dialog', { name: '予約削除' })).toContainText(
    `${reserveDeleteTarget.name} を削除しますか?`,
  )
  await page.getByRole('button', { name: '削除' }).click()
  await expectAnnounced(page, `${reserveDeleteTarget.name} を削除`)

  await openReservesMenu(page, reserveDeleteTarget.name)
  await page.getByRole('menuitem', { name: 'recorded' }).click()
  await expect(page).toHaveURL(/#\/recorded\?ruleId=502&timestamp=\d+$/)

  await page.goto('/#/reserves')
  await expect(page.getByText(reserveDeleteTarget.name)).toBeVisible()
  await openReservesMenu(page, reserveDeleteTarget.name)
  await clickWithoutPointerStabilityWait(page.getByRole('menuitem', { name: 'edit' }))
  await expect(page).toHaveURL(/#\/search\?rule=502&timestamp=\d+$/)
  await expect(page.getByRole('heading', { name: 'ルール編集' })).toBeVisible()
  await clickWithoutPointerStabilityWait(
    page.getByRole('region', { name: '検索条件' }).getByRole('button', { name: '検索' }),
  )
  await expect(page.getByRole('region', { name: '検索結果' })).toBeVisible()
  // A/D: v2 (client/src/views/Search.vue:126-130 `scrollToElementHead`) and v3
  // (src/features/search/rule/lib/pageScroll.ts `scrollToElementHead`) both compute the scroll
  // target dynamically from the result element's live getBoundingClientRect() - neither has a
  // fixed pixel offset to assert against, so "> 0" (scrolled at all) is the correct check.
  await expect
    .poll(async () => getActiveRouteScrollY(page), {
      message:
        'Reserve rule edit handoff scrolls to search results using the active route scroll owner',
    })
    .toBeGreaterThan(0)
  expect(consoleErrors).toEqual([])
  expect(searchRuleRequestLog.methods).toContain('POST /api/schedules/search')

  expect(reservesMocks.calls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ method: 'GET', pathname: '/api/reserves' }),
      expect.objectContaining({
        method: 'DELETE',
        pathname: `/api/reserves/${reserveDeleteTarget.id}`,
      }),
    ]),
  )
})

test('bulk deletes selected reserves through edit mode without optimistic removal', async ({
  page,
}) => {
  const reservesMocks = await installReservesApiMocks(page)

  await page.goto('/#/reserves')
  await page.getByTestId('title-bar').getByRole('button', { name: '予約メニュー' }).click()
  await page.getByRole('menuitem', { name: '編集' }).click()
  await expect(page.getByTestId('edit-title-bar')).toContainText('0 件選択')

  await page.getByRole('button', { name: 'すべて選択' }).click()
  await expect(page.getByTestId('edit-title-bar')).toContainText(
    `${reservesMixedList.length} 件選択`,
  )
  await expect(page.getByTestId('reserves-list-item')).toHaveCount(reservesMixedList.length)
  await expect(page.getByTestId('reserves-list-item').first()).toHaveAttribute(
    'data-selected',
    'true',
  )
  await page.getByRole('button', { name: 'すべて選択' }).click()
  await expect(page.getByTestId('edit-title-bar')).toContainText('0 件選択')
  await expect(page.getByTestId('reserves-list-item').first()).toHaveAttribute(
    'data-selected',
    'false',
  )

  await page.getByTestId('reserves-list-item').filter({ hasText: reserveDialogFull.name }).click()
  await page.getByTestId('reserves-list-item').filter({ hasText: reserveDeleteTarget.name }).click()
  await expect(page.getByTestId('edit-title-bar')).toContainText('2 件選択')
  await page.getByRole('button', { name: '選択項目を削除' }).click()

  const bulkDeleteDialog = page.getByRole('dialog', { name: '予約一括削除' })
  await expect(bulkDeleteDialog).toContainText('選択した 2 件の番組を削除しますか。')
  await expect(bulkDeleteDialog).toHaveCSS('max-width', '300px')
  await expect(bulkDeleteDialog).toHaveCSS('width', '300px')
  await expect(bulkDeleteDialog.getByRole('button', { name: 'キャンセル' })).toBeVisible()
  await expect(bulkDeleteDialog.getByRole('button', { name: '削除' })).toBeVisible()
  await page.getByRole('button', { name: '削除' }).click()

  await expectAnnounced(page, '選択した番組の予約をキャンセルしました。')
  await expect(page.getByTestId('edit-title-bar')).toHaveCount(0)
  await expect(page.getByText(reserveDialogFull.name)).toBeVisible()
  expect(
    reservesMocks.calls.filter((call) => call.method === 'DELETE').map((call) => call.pathname),
  ).toEqual(['/api/reserves/101', '/api/reserves/102'])
})
