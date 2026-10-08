import { expect, test, type Page } from '@playwright/test'
import { installAppShellApiMocks } from '../e2e/support/appShellMocks'
import { installSearchRuleWorkflowApiMocks } from '../e2e/support/searchRuleMocks'

// `/search` の Rule option form（日数・directory・sub directory・file format・directory1-3・
// sub directory1-3）は、テキストを入力した後の文字サイズが v2 と同じ 16px である。
//
// 基準: v2（`5cf2ea383`、`SearchRuleOption.vue`）はこれらの field を 16px で表示する
// （1272x900 での実測）。v3 では `RuleOptionField.tsx` の label `<span>` にだけ
// `ruleOptionLabel` class を付け、`SearchRulePage.module.css` の
// `.ruleOptionLabel { font-size: 0.75rem; ... }` をそれへ絞っている。label 用セレクタが
// `.ruleOptionField span` のように広いと、同じ `.ruleOptionField` の直接の子である
// `ClearableInput` の wrapper `<span class="clearableInputWrap">`（ClearableInput.tsx）にも
// 一致する。実 `<input class="textInput">` は `font: inherit`（171-184行）を持つため、
// 日数・sub directory・file format・sub directory1-3 に入力した実際の文字が label と同じ
// 0.75rem(12px) を継承してしまう（入力前の placeholder も同じ 12px だが、値が入って初めて
// 目立つ）。
//
// directory/directory1-3（`AppSelect` ベース）は表示値が `<span>` ではなく MUI の
// `MuiSelect-select` div に直接描画されるため、このセレクタの影響を受けず 16px のまま
// である。回帰を防ぐため両方とも検証する。
//
// 他の検査との分担: `client/visual/search-rule-geometry.spec.ts` は `/search` の検索結果・
// ルール一覧の幾何（重なり、はみ出し）だけを対象にし、
// `.kiro/specs/frontend-search-rule/{requirements,visual-cases}.md` に Rule option form の
// 各 field の font-size の規定はない。値が反映されたかどうかだけを見る機能の検査は
// 入力後の `getComputedStyle` を読まないので、入力後の font-size はこの spec が担当する。

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
  await installSearchRuleWorkflowApiMocks(page)
})

async function submitSearchAndRevealRuleOptionForm(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1272, height: 900 })
  await page.goto('/#/search')
  const searchRulePage = page.getByTestId('search-rule-page')
  await searchRulePage.waitFor()
  await searchRulePage.getByRole('button', { name: '検索', exact: true }).click()
  await page.locator('input[aria-label="日数"]').waitFor()

  // エンコード2/3 panel は mode 未選択のとき初期 closed（RuleOptionForm.tsx:31）。
  for (const title of ['エンコード2', 'エンコード3']) {
    const summary = page.locator(`summary[data-title="${title}"]`)
    const isOpen = await summary.evaluate(
      (element) => (element.closest('details') as HTMLDetailsElement).open,
    )
    if (!isOpen) await summary.click()
  }
}

const TEXT_FIELDS = [
  '日数',
  'sub directory',
  'file format',
  'sub directory1',
  'sub directory2',
  'sub directory3',
]

const SELECT_FIELDS = ['directory', 'directory1', 'directory2', 'directory3']

test('rule option text fields render typed values at the same 16px size as the rest of the search form', async ({
  page,
}) => {
  await submitSearchAndRevealRuleOptionForm(page)

  for (const label of TEXT_FIELDS) {
    const input = page.locator(`input[aria-label="${label}"]`)
    const fontSizeBefore = await input.evaluate((element) => getComputedStyle(element).fontSize)
    await input.fill(`value-${label}`)
    const fontSizeAfter = await input.evaluate((element) => getComputedStyle(element).fontSize)

    expect(fontSizeBefore, `${label} font-size before typing`).toBe('16px')
    expect(fontSizeAfter, `${label} font-size after typing`).toBe('16px')
  }
})

test('rule option select fields keep the 16px value font size (regression guard)', async ({
  page,
}) => {
  await submitSearchAndRevealRuleOptionForm(page)

  for (const label of SELECT_FIELDS) {
    const display = page.locator(`[aria-label="${label}"]`).first()
    const fontSize = await display.evaluate((element) => getComputedStyle(element).fontSize)

    expect(fontSize, `${label} font-size`).toBe('16px')
  }
})
