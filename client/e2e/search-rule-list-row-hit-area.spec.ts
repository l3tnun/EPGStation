import { expect, test, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  createSearchRuleRequestLog,
  installSearchRuleWorkflowApiMocks,
} from './support/searchRuleMocks'

// `.kiro/specs/frontend-search-rule/requirements.md` 要求3、list layout (`data-rule-layout='list'`,
// container width < 780px) row selection hit-area.
//
// `SearchRulePage.module.css`'s list-layout `.ruleItemMain` must not use `display: contents`, which
// erases the `<button>`'s own box and leaves only its visible child `<span>`s (the keyword span and
// the reservesCnt span) as hit-test targets. Those spans are centered within the 48px row and sized
// to their own content, not the full row, so tapping the row's right-side padding -- or any point
// above/below the text -- would fall through to the non-interactive row `<article>` and not toggle
// selection. v2 (`RuleListItems.vue:6`) wraps toggle/keyword/menu in one real `<div>` with a click
// handler on the whole row, so the entire row (minus the switch and menu columns) is tappable.
// `.ruleItemMain` therefore spans the same two grid tracks its visible children occupy
// individually and is a real `flex` box with `align-self: stretch`, so its hit area now fills
// the row from the end of the switch column to the start of the actions column.

interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

interface RowGeometry {
  mainRect: Rect
  switchRect: Rect
  // `null` in edit mode, where `RuleListRow.tsx` does not render the action menu column at all.
  actionsRect: Rect | null
  keywordGlyphRects: Rect[]
}

async function readRowGeometry(page: Page, ruleId: number): Promise<RowGeometry> {
  return page.evaluate((id) => {
    const domRectToRect = (rect: DOMRect): Rect => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    })
    const row = document.querySelector(`[data-testid="rule-item-${id}"]`)
    if (row === null) throw new Error('rule row not found')
    const main = row.querySelector('button[class*="ruleItemMain"]')
    if (main === null) throw new Error('ruleItemMain not found')
    const switchButton = row.querySelector('[class*="ruleSwitchButton"]')
    if (switchButton === null) throw new Error('switch button not found')
    const actions = row.querySelector('[class*="ruleActions"]')
    const keywordSpan = main.children[0] as HTMLElement
    const range = document.createRange()
    range.selectNodeContents(keywordSpan)
    return {
      mainRect: domRectToRect(main.getBoundingClientRect()),
      switchRect: domRectToRect(switchButton.getBoundingClientRect()),
      actionsRect: actions === null ? null : domRectToRect(actions.getBoundingClientRect()),
      keywordGlyphRects: Array.from(range.getClientRects()).map(domRectToRect),
    }
  }, ruleId)
}

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
})

test('list layout row hit-area fills the row and does not overlap the switch or actions columns', async ({
  page,
}) => {
  await installSearchRuleWorkflowApiMocks(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/rule?keyword=Synthetic')
  await expect(page.getByText('Synthetic Rule Alpha')).toBeVisible()

  const geometry = await readRowGeometry(page, 6201)

  // The row's real button box (post-fix) must not be a `display: contents` degenerate shape: it
  // must be wider than a single glyph run and must extend to the right of every rendered keyword
  // glyph, proving it now covers the row's right-side padding instead of shrinking to the text.
  const lastGlyphRight = Math.max(...geometry.keywordGlyphRects.map((rect) => rect.right))
  expect(
    geometry.mainRect.right,
    `row hit area ${JSON.stringify(geometry.mainRect)} must extend past the last keyword glyph (right=${lastGlyphRight})`,
  ).toBeGreaterThan(lastGlyphRight)

  // AC33 parity: the row's hit-area must never overlap the switch column or the actions column,
  // the same non-overlap guarantee `search-rule-switch-hit-area.spec.ts` pins for the switch itself.
  expect(
    intersects(geometry.mainRect, geometry.switchRect),
    `row hit area ${JSON.stringify(geometry.mainRect)} overlaps the switch box ${JSON.stringify(
      geometry.switchRect,
    )}`,
  ).toBe(false)
  expect(geometry.actionsRect, 'actions column must be rendered outside edit mode').not.toBeNull()
  if (geometry.actionsRect !== null) {
    expect(
      intersects(geometry.mainRect, geometry.actionsRect),
      `row hit area ${JSON.stringify(geometry.mainRect)} overlaps the actions box ${JSON.stringify(
        geometry.actionsRect,
      )}`,
    ).toBe(false)
  }
})

test('tapping the row right-side padding (not the keyword text) toggles selection in edit mode', async ({
  page,
}) => {
  const requestLog = createSearchRuleRequestLog()
  await installSearchRuleWorkflowApiMocks(page, { requestLog })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/rule?keyword=Synthetic')
  await expect(page.getByText('Synthetic Rule Alpha')).toBeVisible()

  await page.getByRole('button', { name: 'ルールを編集' }).click()
  await expect(page.getByTestId('edit-title-bar')).toBeVisible()

  const geometry = await readRowGeometry(page, 6201)
  const lastGlyphRight = Math.max(...geometry.keywordGlyphRects.map((rect) => rect.right))
  // A point inside the row's real box, past the keyword text and before the reservesCnt/actions
  // columns -- the exact "right-side margin" a user tapping to select the row, not the text, would
  // hit.
  const tapX = (lastGlyphRight + geometry.mainRect.right) / 2
  const tapY = (geometry.mainRect.top + geometry.mainRect.bottom) / 2
  expect(tapX, 'tap point must fall strictly inside the row hit area').toBeLessThan(
    geometry.mainRect.right,
  )
  expect(tapX, 'tap point must fall to the right of the keyword text').toBeGreaterThan(
    lastGlyphRight,
  )

  const row = page.getByTestId('rule-item-6201')
  await expect(row).toHaveAttribute('data-selected', 'false')
  await page.mouse.click(tapX, tapY)
  await expect(row).toHaveAttribute('data-selected', 'true')

  // Tapping again toggles it back off, and no enable/disable API call was ever made -- selection
  // toggling in edit mode must not be confused with the enable/disable switch.
  await page.mouse.click(tapX, tapY)
  await expect(row).toHaveAttribute('data-selected', 'false')
  expect(requestLog.methods).not.toContain('PUT /api/rules/6201/enable')
  expect(requestLog.methods).not.toContain('PUT /api/rules/6201/disable')
})
