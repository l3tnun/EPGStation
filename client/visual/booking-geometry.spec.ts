import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from '../e2e/support/appShellMocks'
import {
  installReservesApiMocks,
  manualProgramDetail,
  manualReserveEdit,
  reserveDeleteTarget,
  reserveDialogFull,
  reservesStateFilters,
} from '../e2e/support/reservesMocks'
import {
  expectNoDocumentHorizontalOverflow,
  countIntersectingPairs,
  inspectReserveListGeometry,
  expectDialogWithinViewport,
  inspectManualReserveGeometry,
} from './bookingGeometryHelpers'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
  await installReservesApiMocks(page)
})

const listCases = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, layout: 'table' },
  { name: 'narrow', viewport: { width: 800, height: 900 }, layout: 'card' },
  { name: 'mobile', viewport: { width: 390, height: 844 }, layout: 'card' },
] as const

for (const listCase of listCases) {
  test(`keeps Reserves list geometry stable on ${listCase.name}`, async ({ page }) => {
    await page.setViewportSize(listCase.viewport)
    await page.goto('/#/reserves')

    await expect(page.getByTestId('reserves-page')).toHaveAttribute(
      'data-reserves-layout',
      listCase.layout,
    )
    await expectNoDocumentHorizontalOverflow(page)
    const geometry = await inspectReserveListGeometry(page)

    // Source D: 12 is the spec-mandated floor — .kiro/specs/frontend-reserves/mock-data.md:10
    // ("reserve item 12 件以上。"). e2e/support/reservesFixtures.ts `reservesMixedList` satisfies it
    // with 13 entries (5 named reserves + 8 generated), and `/#/reserves` with no `type` query param
    // falls back to the full list (see reserveListForType in e2e/support/reservesMocks.ts).
    expect(geometry.itemCount).toBeGreaterThanOrEqual(12)
    expect(geometry.pageWithinViewport).toBe(true)
    expect(geometry.rows.every((row) => row.withinPage)).toBe(true)
    if (listCase.layout === 'table') {
      expect(geometry.rows.some((row) => countIntersectingPairs(row.rects) > 0)).toBe(false)
    }
  })
}

test('switches Reserves layout at the 900px geometry boundary', async ({ page }) => {
  await page.setViewportSize({ width: 915, height: 720 })
  await page.goto('/#/reserves')
  await expect(page.getByTestId('reserves-page')).toHaveAttribute('data-reserves-layout', 'card')
  const cardGeometry = await inspectReserveListGeometry(page)
  const cardFirstRow = cardGeometry.rows[0]

  expect(cardGeometry.pageWidth).toBeCloseTo(915, 0)
  expect(cardGeometry.listWidth).toBeLessThan(915)
  expect(cardFirstRow.display).not.toBe('grid')
  expect(cardFirstRow.gridTemplateColumns).toBe('none')

  await page.setViewportSize({ width: 916, height: 720 })
  await expect(page.getByTestId('reserves-page')).toHaveAttribute('data-reserves-layout', 'table')
  const tableGeometry = await inspectReserveListGeometry(page)
  const tableFirstRow = tableGeometry.rows[0]

  expect(tableGeometry.pageWidth).toBeCloseTo(916, 0)
  expect(tableGeometry.listWidth).toBeGreaterThan(cardGeometry.listWidth)
  expect(tableFirstRow.display).toBe('table-row')
})

test('keeps conflict filter geometry tied to conflict rows', async ({ page }) => {
  const conflictDataset = reservesStateFilters.find(
    (filter) => filter.expectedFilterType === 'conflict',
  )

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/reserves?type=conflict')

  await expect(page.getByTestId('title-bar').getByRole('heading', { name: '競合' })).toBeVisible()
  await expect(page.getByText('Synthetic Conflict Reserve')).toBeVisible()
  await expect(page.getByText(reserveDialogFull.name)).toHaveCount(0)
  const geometry = await inspectReserveListGeometry(page)

  expect(conflictDataset?.reserves).toHaveLength(1)
  expect(geometry.itemCount).toBe(conflictDataset?.reserves.length)
  expect(geometry.rows.every((row) => row.state === 'conflict')).toBe(true)
  expect(geometry.rows.some((row) => countIntersectingPairs(row.rects) > 0)).toBe(false)
})

test('normalizes invalid Reserves type to the normal visual state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/reserves?type=unknown')

  await expect(page.getByTestId('title-bar').getByRole('heading', { name: '予約' })).toBeVisible()
  await expect(page.getByText(reserveDialogFull.name)).toBeVisible()
  await expect(page.getByText('Synthetic Conflict Reserve')).toHaveCount(0)
  const geometry = await inspectReserveListGeometry(page)

  expect(geometry.rows.every((row) => row.state !== 'unknown')).toBe(true)
  expect(geometry.rows.every((row) => row.state === 'reserve')).toBe(true)
})

test('keeps ReserveDialog and delete dialog inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/reserves')

  await page.getByText(reserveDialogFull.name).click()
  await expect(page.getByRole('dialog', { name: reserveDialogFull.name })).toContainText(
    'Synthetic Channel A',
  )
  await expectDialogWithinViewport(page, reserveDialogFull.name)
  await page.getByRole('button', { name: '閉じる' }).click()

  await page.getByRole('button', { name: `予約メニュー: ${reserveDeleteTarget.name}` }).click()
  await page.getByRole('menuitem', { name: 'delete' }).click()
  await expect(page.getByRole('dialog', { name: '予約削除' })).toContainText(
    `${reserveDeleteTarget.name} を削除しますか?`,
  )
  await expectDialogWithinViewport(page, '予約削除')
})

const manualCases = [
  {
    name: 'add desktop',
    viewport: { width: 1440, height: 900 },
    route: `/#/reserves/manual?programId=${manualProgramDetail.id}`,
  },
  {
    name: 'add mobile',
    viewport: { width: 390, height: 844 },
    route: `/#/reserves/manual?programId=${manualProgramDetail.id}`,
  },
  {
    name: 'edit desktop',
    viewport: { width: 1440, height: 900 },
    route: `/#/reserves/manual?reserveId=${manualReserveEdit.id}`,
  },
] as const

for (const manualCase of manualCases) {
  test(`keeps Manual Reserve ${manualCase.name} controls non-overlapping`, async ({ page }) => {
    await page.setViewportSize(manualCase.viewport)
    await page.goto(manualCase.route)

    await expect(page.getByTestId('manual-reserve-page')).toHaveAttribute(
      'data-option-panels-open',
      '0,1,2,3,6',
    )
    await page.getByRole('button', { name: 'エンコード2' }).click()
    await page.getByRole('button', { name: 'エンコード3' }).click()
    await expect(page.getByTestId('manual-reserve-page')).toHaveAttribute(
      'data-option-panels-open',
      '0,1,2,3,4,5,6',
    )
    await expectNoDocumentHorizontalOverflow(page)
    const geometry = await inspectManualReserveGeometry(page)

    expect(geometry.panelIndexes).toEqual(['0', '1', '2', '3', '4', '5', '6'])
    expect(geometry.withinViewport).toBe(true)
    expect(geometry.outsideFormCount).toBe(0)
    expect(countIntersectingPairs(geometry.directBlockRects)).toBe(0)
    expect(
      geometry.sectionControlRects.some((sectionRects) => countIntersectingPairs(sectionRects) > 0),
    ).toBe(false)
  })
}
