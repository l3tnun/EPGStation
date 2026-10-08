import { expect, test, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { installSearchRuleWorkflowApiMocks } from './support/searchRuleMocks'

// BP-019: v3 のルール一覧 (`/rule`) enable/disable switch は、v2
// (`RuleListItems.vue`) 相当まで当たり判定を広げる。v2 は横長のトラック全体 (目安 38×24px) に反応する。
// 円形ノブ周辺だけ (実測 48×14px、面積は v2 より約26%狭い) の当たり判定では足りない。横幅は
// v3 が既に v2 より広い (48px > 38px) ため、この spec は縦方向の当たり判定が v2 の 24px 相当まで
// 広がったことだけを固定する。
//
// `SearchRulePage.module.css`'s `.ruleSwitchButton:global(.MuiButtonBase-root)` は `padding: 0` の
// ままだと、Button (`display: inline-flex; align-items: center`) の高さは当たり判定を持つ唯一の子
// (`.ruleSwitch`、高さ 14px 固定のトラック) の高さまで縮む。`padding: 5px 0` を足すことで Button の
// flex box が上下 5px ずつ (計10px) 広がり、当たり判定が 48×24px になる。
//
// 拡大した当たり判定は、同じ行の行選択領域 (`.ruleItemMain`、`search-rule-list-row-hit-area.spec.ts`
// が別途固定) や三点メニューボタン (`.ruleActions` 内の `IconButton`) の当たり判定と重ならないことを
// 要求3 AC33 は求めている。switch 列 (`grid-column: 1`) と row main 列 (`grid-column: 2/4` または
// `minmax(0, 1fr)`) は水平方向に重ならない (switch の right 端がその左の main の left 端より小さい)
// ため、縦方向の拡大だけでは水平方向の重なりは生じない -- が、行 (`.ruleItem`, `min-height: 48px`) の
// 高さを超えて広がっていないかどうかは別途確認する必要があるため、行の矩形に完全に収まることも
// 合わせて固定する。

interface Rect {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

interface SwitchVerticalGeometry {
  rowRect: Rect
  switchRect: Rect
  mainRect: Rect
  // `null` when the action-menu button cannot be located (should not happen outside edit mode).
  menuButtonRect: Rect | null
}

async function readSwitchVerticalGeometry(
  page: Page,
  ruleId: number,
): Promise<SwitchVerticalGeometry> {
  return page.evaluate((id) => {
    const domRectToRect = (rect: DOMRect): Rect => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    })
    const row = document.querySelector(`[data-testid="rule-item-${id}"]`)
    if (row === null) throw new Error('rule row not found')
    const switchButton = row.querySelector('[class*="ruleSwitchButton"]')
    if (switchButton === null) throw new Error('switch button not found')
    const main = row.querySelector('button[class*="ruleItemMain"]')
    if (main === null) throw new Error('ruleItemMain not found')
    const actions = row.querySelector('[class*="ruleActions"]')
    const menuButton = actions === null ? null : actions.querySelector('button')
    return {
      rowRect: domRectToRect(row.getBoundingClientRect()),
      switchRect: domRectToRect(switchButton.getBoundingClientRect()),
      mainRect: domRectToRect(main.getBoundingClientRect()),
      menuButtonRect:
        menuButton === null ? null : domRectToRect(menuButton.getBoundingClientRect()),
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
  test(`enable/disable switch hit area is at least v2's 24px tall and stays inside the row without overlapping the keyword or menu columns (${scenario.name})`, async ({
    page,
  }) => {
    await installSearchRuleWorkflowApiMocks(page)
    await page.setViewportSize(scenario.viewport)
    await page.goto('/#/rule?keyword=Synthetic')
    await expect(page.getByText('Synthetic Rule Alpha')).toBeVisible()

    const geometry = await readSwitchVerticalGeometry(page, 6201)

    // v2 parity: at least 24px tall (v2's ~38x24px track). The width stays whatever the layout
    // already renders (v3 already exceeds v2's 38px width; this spec only pins the height).
    expect(
      geometry.switchRect.height,
      `switch hit area ${JSON.stringify(geometry.switchRect)} must be at least 24px tall (v2 parity)`,
    ).toBeGreaterThanOrEqual(24)

    // The taller hit area must still stay inside the row's own box -- it must not bleed into the
    // row above/below.
    expect(
      geometry.switchRect.top,
      `switch hit area ${JSON.stringify(geometry.switchRect)} must not start above the row ${JSON.stringify(geometry.rowRect)}`,
    ).toBeGreaterThanOrEqual(geometry.rowRect.top)
    expect(
      geometry.switchRect.bottom,
      `switch hit area ${JSON.stringify(geometry.switchRect)} must not end below the row ${JSON.stringify(geometry.rowRect)}`,
    ).toBeLessThanOrEqual(geometry.rowRect.bottom)

    // 要求3 AC33 parity: the taller switch hit area must still never overlap the row's main
    // (keyword/selection) hit area or the per-row action-menu button's hit area.
    expect(
      intersects(geometry.switchRect, geometry.mainRect),
      `switch hit area ${JSON.stringify(geometry.switchRect)} overlaps the row main hit area ${JSON.stringify(
        geometry.mainRect,
      )}`,
    ).toBe(false)
    expect(
      geometry.menuButtonRect,
      'action-menu button must be rendered outside edit mode',
    ).not.toBeNull()
    if (geometry.menuButtonRect !== null) {
      expect(
        intersects(geometry.switchRect, geometry.menuButtonRect),
        `switch hit area ${JSON.stringify(geometry.switchRect)} overlaps the action-menu button hit area ${JSON.stringify(
          geometry.menuButtonRect,
        )}`,
      ).toBe(false)
    }
  })
}
