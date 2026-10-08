import { expect, test, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { expectAnnounced } from './support/notificationObservation'
import {
  createSearchRuleRequestLog,
  installSearchRuleWorkflowApiMocks,
} from './support/searchRuleMocks'

// `.kiro/specs/frontend-search-rule/requirements.md` 要求3 AC33: rule の有効/無効は enable switch
// でだけ切り替わり、switch の click/tap 領域は keyword 列や他の列の text/area と重ならず、keyword
// text やその他の row content を click/tap しても有効/無効状態は変化しない。
//
// `SearchRulePage.module.css` の `.ruleSwitchButton` は MUI `Button` (variant="text") の runtime
// style (`min-width: 64px`、`padding: 6px 8px`) を上書きするつもりで `min-width: 48px`、`padding: 0`
// を宣言していたが、両者は selector specificity が同じ (0,1,0) 単一 class で、MUI の emotion
// runtime style は page 本体の stylesheet より後に `<head>` へ挿入されるため cascade で MUI 側が勝ち、
// override は適用されていなかった。実際の hit box は list layout (390px 幅、container 幅 780px
// 未満) で x=22-86 (64px 幅) となり、keyword 列の box (x=74 起点) や glyph (x=82 起点) と重なる。
// MUI `Button` は `position: relative` を持つため、この重なった領域では非 positioned な keyword
// `<span>` より switch の (positioned) box が常に上に描画/hit-test される。結果、keyword
// text の先頭付近を click すると `PUT /api/rules/:id/disable` (または enable) が送信される。

interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

interface SwitchKeywordGeometry {
  switchRect: Rect
  keywordBoxRect: Rect
  keywordGlyphRects: Rect[]
}

async function readSwitchKeywordGeometry(
  page: Page,
  ruleId: number,
): Promise<SwitchKeywordGeometry> {
  return page.evaluate((id) => {
    const domRectToRect = (rect: DOMRect): Rect => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    })
    const row = document.querySelector(`[data-testid="rule-item-${id}"]`)
    if (row === null) throw new Error('rule row not found')
    const switchButton = row.querySelector('[class*="ruleSwitchButton"]')
    if (switchButton === null) throw new Error('switch button not found')
    const main = row.querySelector('button[class*="ruleItemMain"]')
    if (main === null) throw new Error('ruleItemMain not found')
    const keywordSpan = main.children[0] as HTMLElement
    const range = document.createRange()
    range.selectNodeContents(keywordSpan)
    return {
      switchRect: domRectToRect(switchButton.getBoundingClientRect()),
      keywordBoxRect: domRectToRect(keywordSpan.getBoundingClientRect()),
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

const scenarios = [
  { name: 'list layout at 390px width', viewport: { width: 390, height: 844 } },
  { name: 'table layout at desktop width', viewport: { width: 1440, height: 900 } },
] as const

for (const scenario of scenarios) {
  test(`enable/disable switch hit area does not overlap the keyword column (${scenario.name})`, async ({
    page,
  }) => {
    await installSearchRuleWorkflowApiMocks(page)
    await page.setViewportSize(scenario.viewport)
    await page.goto('/#/rule?keyword=Synthetic')
    await expect(page.getByText('Synthetic Rule Alpha')).toBeVisible()

    const geometry = await readSwitchKeywordGeometry(page, 6201)
    expect(
      intersects(geometry.switchRect, geometry.keywordBoxRect),
      `switch hit area ${JSON.stringify(geometry.switchRect)} overlaps the keyword column box ${JSON.stringify(
        geometry.keywordBoxRect,
      )}`,
    ).toBe(false)
    for (const glyphRect of geometry.keywordGlyphRects) {
      expect(
        intersects(geometry.switchRect, glyphRect),
        `switch hit area ${JSON.stringify(geometry.switchRect)} overlaps a keyword glyph rect ${JSON.stringify(
          glyphRect,
        )}`,
      ).toBe(false)
    }
  })

  test(`clicking the keyword text never toggles the enabled state; only the switch does (${scenario.name})`, async ({
    page,
  }) => {
    const requestLog = createSearchRuleRequestLog()
    await installSearchRuleWorkflowApiMocks(page, { requestLog })
    await page.setViewportSize(scenario.viewport)
    await page.goto('/#/rule?keyword=Synthetic')
    await expect(page.getByText('Synthetic Rule Alpha')).toBeVisible()

    const firstRule = page.getByTestId('rule-item-6201')
    const ruleSwitch = firstRule.locator('span[class*="_ruleSwitch_"]').first()
    await expect(ruleSwitch).toHaveAttribute('data-checked', 'true')

    const geometry = await readSwitchKeywordGeometry(page, 6201)
    const firstGlyphRect = geometry.keywordGlyphRects[0]
    expect(firstGlyphRect, 'keyword renders at least one glyph rect').toBeDefined()

    // Click at the very first rendered glyph position of the keyword text -- the exact pixel a
    // user aiming for the keyword, not the switch, would tap.
    await page.mouse.click(
      firstGlyphRect.left + 1,
      (firstGlyphRect.top + firstGlyphRect.bottom) / 2,
    )
    // Give a wrongly-routed click a chance to reach the mocked API before asserting its absence.
    await page.waitForTimeout(300)
    expect(requestLog.methods, 'clicking keyword text must not call disable').not.toContain(
      'PUT /api/rules/6201/disable',
    )
    expect(requestLog.methods, 'clicking keyword text must not call enable').not.toContain(
      'PUT /api/rules/6201/enable',
    )
    await expect(ruleSwitch).toHaveAttribute('data-checked', 'true')

    // The switch itself must still be the only way to toggle the enabled state.
    await firstRule.getByRole('button', { name: '無効化' }).click()
    await expect.poll(() => requestLog.methods).toContain('PUT /api/rules/6201/disable')
    await expectAnnounced(page, '無効化: Synthetic Rule Alpha')
    await expect(ruleSwitch).toHaveAttribute('data-checked', 'false')
  })
}
