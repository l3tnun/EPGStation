import { expect, test, type Page } from '@playwright/test'
import { installAppShellApiMocks } from '../e2e/support/appShellMocks'
import { installSearchRuleCrowdedRowApiMocks } from '../e2e/support/searchRuleMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
})

// `.kiro/specs/frontend-search-rule/requirements.md` 要求3 AC27: "Rule list card/table は
// long keyword、複数 channel/genre、edit mode selection、action menu が同時に存在しても text overlap と
// horizontal overflow を発生させない。" `installSearchRuleCrowdedRowApiMocks`
// (client/e2e/support/searchRuleMocks.ts) fixes a single rule that carries all of: a long,
// space-free keyword (forces the ellipsis/word-break CSS this AC names, rather than a natural
// wrap point), 3 channelIds / 2 genres (so `ruleChannel`/`ruleGenre`,
// client/src/features/search/rule/lib/ruleListText.ts, both append " 他<n>"), and a 3-digit
// `reservesCnt`. RuleListRow.tsx:31-38,52-61 render the per-row action-menu button
// (`.ruleActions`) only outside edit mode and the edit-mode placeholder/selected styling only
// inside it, so no single row render can show a literal 4th, fifth axis at once; the four tests
// below instead cross [long keyword + multi channel/genre] with each of [open per-row action menu]
// and [edit-mode selection, backed by `EditTitleBar`'s own select-all/delete "action menu" icons
// per AC25] -- the two combinations this component can actually render for a user -- across both
// the table and list layouts.
const CROWDED_KEYWORD =
  'SyntheticCrowdedRuleKeywordThatIsVeryLongAndUnbreakableForOverlapTesting1234567890'

interface Rect {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

interface CrowdedRowGeometry {
  row: Rect
  rowSelected: string | null
  rowMinHeightCss: number
  keyword: Rect
  keywordStyle: {
    overflow: string
    textOverflow: string
    whiteSpace: string
    wordBreak: string
  }
  keywordScrollWidth: number
  keywordClientWidth: number
  // Rendered glyph-run boxes (`Range.getClientRects()`), independent of whatever `overflow`/
  // `white-space` happen to compute to -- this is what actually painted, not a declaration.
  keywordLineRects: Rect[]
  ignoreKeyword: Rect | null
  channel: Rect | null
  genre: Rect | null
  reservesCnt: Rect
  switchOrPlaceholder: Rect
  actions: { rect: Rect; flexWrap: string; buttonCount: number } | null
}

// A `getBoundingClientRect()`-only check cannot detect removing the CSS this AC names: the CSS
// Grid `minmax(0, 1fr)` columns already keep every span's own box at its declared width regardless of
// the span's `overflow`/`white-space`/`flex-wrap`, so stripping those declarations changes what
// paints inside the fixed box (or how tall the row grows once the keyword wraps) without moving
// that box's edges or the document's `scrollWidth`. This helper therefore reads the relevant
// computed styles AND the rendered glyph-run rects (`keywordLineRects`) alongside the geometry,
// so both the declaration and its actual on-screen effect are checked.
async function readCrowdedRowGeometry(page: Page): Promise<CrowdedRowGeometry> {
  return page.evaluate(() => {
    const domRectToRect = (rect: DOMRect): Rect => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    })
    const toRect = (element: Element): Rect => domRectToRect(element.getBoundingClientRect())
    const row = document.querySelector('[data-testid^="rule-item-"]')
    if (row === null) throw new Error('crowded rule row not found')
    const main = row.querySelector('button[class*="ruleItemMain"]')
    if (main === null) throw new Error('ruleItemMain not found')
    const spans = Array.from(main.children) as HTMLElement[]
    const keywordEl = spans[0]
    const keywordComputed = getComputedStyle(keywordEl)
    const isHidden = (element: HTMLElement) => getComputedStyle(element).display === 'none'
    const actionsEl = row.querySelector('div[class*="ruleActions"]')
    const switchEl = row.querySelector('[class*="ruleSwitchButton"]')
    if (switchEl === null) throw new Error('ruleSwitchButton not found')
    const keywordRange = document.createRange()
    keywordRange.selectNodeContents(keywordEl)
    const keywordLineRects = Array.from(keywordRange.getClientRects()).map(domRectToRect)

    return {
      row: toRect(row),
      rowSelected: row.getAttribute('data-selected'),
      rowMinHeightCss: parseFloat(getComputedStyle(row).minHeight),
      keyword: toRect(keywordEl),
      keywordStyle: {
        overflow: keywordComputed.overflow,
        textOverflow: keywordComputed.textOverflow,
        whiteSpace: keywordComputed.whiteSpace,
        wordBreak: keywordComputed.wordBreak,
      },
      keywordScrollWidth: keywordEl.scrollWidth,
      keywordClientWidth: keywordEl.clientWidth,
      keywordLineRects,
      ignoreKeyword: isHidden(spans[1]) ? null : toRect(spans[1]),
      channel: isHidden(spans[2]) ? null : toRect(spans[2]),
      genre: isHidden(spans[3]) ? null : toRect(spans[3]),
      reservesCnt: toRect(spans[4]),
      switchOrPlaceholder: toRect(switchEl),
      actions: (() => {
        if (actionsEl === null) return null
        // List layout sets `.ruleActions{display:contents}` (SearchRulePage.module.css:1166-1169),
        // which removes the wrapping div's own box (its `getBoundingClientRect()` degenerates to
        // 0,0,0,0) and promotes its child <button> to the real grid-positioned box instead. Table
        // layout keeps the div itself as the positioned (`display:flex`) box. Reading the button's
        // own rect covers both.
        const button = actionsEl.querySelector('button')
        if (button === null) return null
        return {
          rect: toRect(button),
          flexWrap: getComputedStyle(actionsEl).flexWrap,
          buttonCount: actionsEl.querySelectorAll('button').length,
        }
      })(),
    }
  })
}

function expectNoOverlap(a: Rect | null, b: Rect | null, label: string): void {
  if (a === null || b === null) return
  const separated = a.right <= b.left + 1 || b.right <= a.left + 1
  expect(separated, label).toBe(true)
}

// `Range.getClientRects()` can return more than one `DOMRect` for what is visually a single line:
// an intact, ellipsis-clipped `nowrap` keyword span returns 2 rects sharing the same `top` (one
// spanning the full unclipped text, one narrower) rather than 1 -- so "how many visual lines" is
// counted by distinct `top`, not raw rect count, which stays accurate once genuine wrapping
// (AC27's regression case) produces rects with actually different `top` values.
function countDistinctLineTops(rects: readonly Rect[]): number {
  return new Set(rects.map((rect) => Math.round(rect.top))).size
}

function expectContained(child: Rect, parent: Rect, label: string): void {
  expect(child.left, `${label}: left edge stays inside the row`).toBeGreaterThanOrEqual(
    parent.left - 1,
  )
  expect(child.right, `${label}: right edge stays inside the row`).toBeLessThanOrEqual(
    parent.right + 1,
  )
}

function expectCrowdedRowColumnsDoNotOverlapOrOverflow(geometry: CrowdedRowGeometry): void {
  // AC27 names 4 conditions: long keyword, multi channel/genre, edit-mode selection, and the
  // action menu -- so the pairwise no-overlap sweep below covers only the columns those conditions
  // actually put content into (keyword/ignoreKeyword/channel/genre/reservesCnt/actions), plus
  // `switchOrPlaceholder` (the enable/disable switch, or its edit-mode placeholder), which 要求3
  // AC33 separately requires not to overlap the keyword column's box. Before AC33's fix, in list
  // layout the enable/disable `Button`'s hit box was x=22..86 while the keyword column's box started
  // at x=74 (glyphs at x=82, box left 74 + `padding-left:8px`): the switch's click area overlapped
  // the keyword column even though nothing actually painted there overlapped (the switch's rendered
  // track/thumb and the keyword's glyphs never touched). This reproduced identically with the
  // existing short-keyword fixture in `search-rule-geometry.spec.ts` ("Synthetic Rule Alpha"), so it
  // was a pre-existing, keyword-length-independent characteristic of `.ruleSwitchButton`'s own
  // sizing against the list layout's 52px first grid column -- MUI `Button`'s runtime `min-width:
  // 64px`/`padding: 6px 8px` was silently winning over this module's `min-width: 48px`/`padding: 0`
  // override (SearchRulePage.module.css:679-696, 1130-1132; see the comment there for the cascade
  // mechanism). AC33 fixes the override (raising its selector specificity) so the switch's hit box
  // now stays inside its own 52px/82px column, which the pairwise sweep below now verifies alongside
  // the text-overlap conditions AC27 names.
  const columns = [
    geometry.switchOrPlaceholder,
    geometry.keyword,
    geometry.ignoreKeyword,
    geometry.channel,
    geometry.genre,
    geometry.reservesCnt,
    geometry.actions?.rect ?? null,
  ]

  columns.forEach((column, index) => {
    if (column === null) return
    expectContained(column, geometry.row, `column ${index}`)
    for (let other = index + 1; other < columns.length; other += 1) {
      expectNoOverlap(column, columns[other], `column ${index} vs column ${other}`)
    }
  })
}

async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  // Same 0px contract and `.poll` shape as visual/search-rule-geometry.spec.ts's own helper
  // (kept local here because this file's beforeEach installs a different fixture).
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      { timeout: 1500 },
    )
    .toBeLessThanOrEqual(0)
}

// Rendering-only detector: the computed-style checks above only prove the declaration is
// *applied*; they cannot prove clipping actually happens on screen
// (SearchRulePage.module.css:738-745's `overflow:hidden` sits on a fixed-width CSS Grid column, so
// removing it moves no box edge and adds no document/row `scrollWidth` -- see the interface
// comment above `readCrowdedRowGeometry`). For every visible AC27 text column (`.ruleItemMain`'s
// children) this screenshots the strip of the row from that column's own right edge to the row's
// right edge, then makes just that column's text `color:transparent` and screenshots the same
// strip again. Any pixel difference means this column's glyphs painted outside its own box: an
// intact build diffs 0 everywhere, while removing `.ruleItemMain > span`'s `overflow:hidden` alone
// produces a diff on table-layout columns 0-3.
async function expectNoInkPaintedOutsideOwnColumn(page: Page): Promise<void> {
  await page.mouse.move(0, 0)
  const columns = await page.evaluate(() => {
    const row = document.querySelector('[data-testid^="rule-item-"]') as HTMLElement
    const main = row.querySelector('button[class*="ruleItemMain"]') as HTMLElement
    const spans = (Array.from(main.children) as HTMLElement[]).filter(
      (span) => getComputedStyle(span).display !== 'none',
    )
    spans.forEach((span, index) => span.setAttribute('data-crowded-ink-col', String(index)))
    const rowRect = row.getBoundingClientRect()
    return spans.map((span, index) => {
      const rect = span.getBoundingClientRect()
      return {
        index,
        right: rect.right,
        rowRight: rowRect.right,
        top: rowRect.top,
        bottom: rowRect.bottom,
      }
    })
  })

  for (const column of columns) {
    const x = Math.ceil(column.right)
    const width = Math.floor(column.rowRight) - x
    if (width <= 0) continue
    const clip = {
      x,
      y: Math.floor(column.top),
      width,
      height: Math.max(1, Math.floor(column.bottom - column.top)),
    }
    const withText = await page.screenshot({ clip, animations: 'disabled' })
    await page.evaluate((index) => {
      const el = document.querySelector(`[data-crowded-ink-col="${index}"]`) as HTMLElement
      el.style.setProperty('color', 'transparent', 'important')
    }, column.index)
    const withoutText = await page.screenshot({ clip, animations: 'disabled' })
    await page.evaluate((index) => {
      const el = document.querySelector(`[data-crowded-ink-col="${index}"]`) as HTMLElement
      el.style.removeProperty('color')
    }, column.index)
    expect(
      withText.equals(withoutText),
      `column ${column.index}: no glyphs painted right of its own box (strip x=${x}..${x + width})`,
    ).toBe(true)
  }
}

test('table layout: long keyword + multi channel/genre + an open action menu stay separated and inside the row', async ({
  page,
}) => {
  await installSearchRuleCrowdedRowApiMocks(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/rule')
  await expect(page.getByText(CROWDED_KEYWORD)).toBeVisible()
  await expect(page.locator('[data-rule-layout]')).toHaveAttribute('data-rule-layout', 'table')

  // Read geometry and the rendering-only checks before opening the menu: the open MUI `Menu` is a
  // portal anchored to the rightmost (actions) column and can extend into the strip this file
  // screenshots to check the reservesCnt/actions columns' own text, which would make a diff mean
  // "the menu is open" rather than "this column's ink escaped its box". Nothing about the row's own
  // text layout changes once the menu opens (checked again below via `toHaveAttribute`/visibility).
  const geometry = await readCrowdedRowGeometry(page)
  expect(geometry.channel, 'table layout renders the channel column').not.toBeNull()
  expect(geometry.genre, 'table layout renders the genre column').not.toBeNull()
  expectCrowdedRowColumnsDoNotOverlapOrOverflow(geometry)
  // AC27 / SearchRulePage.module.css:738-745: keyword/ignoreKeyword/channel/genre clip via
  // overflow:hidden + text-overflow:ellipsis + white-space:nowrap instead of growing the row.
  expect(geometry.keywordStyle).toMatchObject({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  })
  // Truncation must actually be happening, not merely declared: the keyword's full text is wider
  // than its box (scrollWidth > clientWidth) ...
  expect(
    geometry.keywordScrollWidth,
    'keyword content is wider than its box (there is something to truncate)',
  ).toBeGreaterThan(geometry.keywordClientWidth)
  // ... and per AC27, `white-space:nowrap` keeps it a single rendered visual line (see
  // `countDistinctLineTops` for why raw rect count is not used here). Whether the rendered text
  // actually stays inside its own box (rather than painting past it) is checked below by
  // `expectNoInkPaintedOutsideOwnColumn`, a pixel-level check -- `Range.getClientRects()`'s extra,
  // unclipped-width rect (see `countDistinctLineTops`) makes it unreliable for measuring a
  // rendered right edge directly.
  expect(
    countDistinctLineTops(geometry.keywordLineRects),
    'table layout keyword renders as a single visual line',
  ).toBe(1)
  // AC27 / SearchRulePage.module.css:753-759: the action-menu trigger's own container never wraps.
  expect(geometry.actions?.buttonCount).toBe(1)
  // Rendering can't show this one: `.ruleActions` (SearchRulePage.module.css:753-759) never has
  // more than the single action-menu `<button>` as a child (`buttonCount` above), so a wrapped vs.
  // non-wrapped flex row look pixel-identical -- only the computed `flex-wrap` value differs.
  expect(geometry.actions?.flexWrap).toBe('nowrap')
  // `.ruleItem` (SearchRulePage.module.css:651-662) declares `min-height: 48px` and
  // `border-bottom: 1px solid ...`; 48 + 1 = 49 is that exact, integer layout value, not a
  // box-model rounding artifact. 49px is what this row renders at on every configured project with
  // this CSS intact; once SearchRulePage.module.css:738-745's `overflow`/`text-overflow`/
  // `white-space` are removed (while `overflow-wrap:anywhere` stays, so the keyword still wraps
  // instead of visually bleeding unclipped), the keyword wraps across multiple lines and the row
  // grows to 51px (Desktop Chromium, Android Chrome, iOS Safari) / 54px (Desktop Firefox, whose
  // line-height metrics for this font run slightly taller). A ceiling of 50px -- exactly 1 more
  // than the intact 49 -- sits strictly between the intact single-line height and every observed
  // wrapped-to-2-lines regression, on every project.
  expect(
    geometry.row.height,
    'crowded row stays a single table row instead of wrapping tall',
  ).toBeLessThanOrEqual(50)
  await expectNoInkPaintedOutsideOwnColumn(page)

  await page.getByRole('button', { name: /ルールメニュー:/ }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await expectNoDocumentHorizontalOverflow(page)
})

test('table layout: long keyword + multi channel/genre + edit-mode selection stay separated and inside the row', async ({
  page,
}) => {
  await installSearchRuleCrowdedRowApiMocks(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/rule')
  await expect(page.getByText(CROWDED_KEYWORD)).toBeVisible()
  await expect(page.locator('[data-rule-layout]')).toHaveAttribute('data-rule-layout', 'table')

  await page.getByRole('button', { name: 'ルールを編集' }).click()
  await expect(page.getByTestId('edit-title-bar')).toBeVisible()
  await page.getByRole('button', { name: 'すべて選択' }).click()

  const geometry = await readCrowdedRowGeometry(page)
  expect(geometry.rowSelected, 'select-all selects the crowded row').toBe('true')
  // RuleListRow.tsx:31-38,52-61: edit mode never renders the per-row action-menu button (the
  // `.ruleActions` div is entirely absent) -- this scenario's "action menu" axis is instead
  // EditTitleBar's own select-all/delete icon row (AC25), asserted below.
  expect(geometry.actions, 'edit mode does not render the per-row action-menu button').toBeNull()
  expect(geometry.channel, 'table layout renders the channel column').not.toBeNull()
  expect(geometry.genre, 'table layout renders the genre column').not.toBeNull()
  expectCrowdedRowColumnsDoNotOverlapOrOverflow(geometry)
  expect(geometry.keywordStyle).toMatchObject({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  })
  expect(
    geometry.keywordScrollWidth,
    'keyword content is wider than its box (there is something to truncate)',
  ).toBeGreaterThan(geometry.keywordClientWidth)
  // See the sibling (non-edit-mode) test above for why lines are counted by distinct `top`, and
  // why the rendered right edge is checked via `expectNoInkPaintedOutsideOwnColumn` instead of a
  // `Range.getClientRects()` measurement.
  expect(
    countDistinctLineTops(geometry.keywordLineRects),
    'table layout keyword renders as a single visual line',
  ).toBe(1)
  // See the sibling (non-edit-mode) test above for the 50px ceiling's derivation and measurements.
  expect(
    geometry.row.height,
    'selected crowded row stays a single table row instead of wrapping tall',
  ).toBeLessThanOrEqual(50)
  await expectNoInkPaintedOutsideOwnColumn(page)

  const closeButton = page.getByRole('button', { name: '編集を終了' })
  const selectAllButton = page.getByRole('button', { name: 'すべて選択' })
  const deleteButton = page.getByRole('button', { name: '選択項目を削除' })
  const [closeBox, selectAllBox, deleteBox] = await Promise.all([
    closeButton.boundingBox(),
    selectAllButton.boundingBox(),
    deleteButton.boundingBox(),
  ])
  expect(closeBox).not.toBeNull()
  expect(selectAllBox).not.toBeNull()
  expect(deleteBox).not.toBeNull()
  if (closeBox !== null && selectAllBox !== null && deleteBox !== null) {
    // AC25/AC27: EditTitleBar's operation icons (close/select-all/delete) are the "action menu"
    // visible throughout edit mode; they must stay separated even with the full title showing.
    expect(closeBox.x + closeBox.width, 'close icon stays left of select-all').toBeLessThanOrEqual(
      selectAllBox.x + 1,
    )
    expect(
      selectAllBox.x + selectAllBox.width,
      'select-all icon stays left of delete',
    ).toBeLessThanOrEqual(deleteBox.x + 1)
  }
  await expectNoDocumentHorizontalOverflow(page)
})

test('list layout: long keyword + an open action menu stay separated and inside the row', async ({
  page,
}) => {
  await installSearchRuleCrowdedRowApiMocks(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/rule')
  await expect(page.getByText(CROWDED_KEYWORD)).toBeVisible()
  await expect(page.locator('[data-rule-layout]')).toHaveAttribute('data-rule-layout', 'list')

  // Read geometry and the rendering-only checks before opening the menu -- see the table-layout
  // test above for why.
  const geometry = await readCrowdedRowGeometry(page)
  // AC26 / SearchRulePage.module.css:1153-1157: list layout hides the ignoreKeyword/channel/genre
  // columns entirely (`display:none`), so this fixture's multi-channel/multi-genre content only
  // has a visible no-overlap contract to check in table layout, checked above.
  expect(geometry.ignoreKeyword, 'list layout hides the ignoreKeyword column').toBeNull()
  expect(geometry.channel, 'list layout hides the channel column').toBeNull()
  expect(geometry.genre, 'list layout hides the genre column').toBeNull()
  expectCrowdedRowColumnsDoNotOverlapOrOverflow(geometry)
  // AC27 / SearchRulePage.module.css:1143-1151: list layout wraps the full long keyword across
  // lines instead of the table layout's single-line ellipsis.
  expect(geometry.keywordStyle).toMatchObject({
    whiteSpace: 'normal',
    wordBreak: 'break-all',
  })
  // Unlike table layout, list layout must NOT truncate: the full keyword is wrapped, not clipped,
  // so its content must fit entirely within its own (wrapped, multi-line) box: with this CSS
  // intact, scrollWidth equals clientWidth (216, nothing clipped); removing
  // `white-space:normal`/`word-break:break-all` (SearchRulePage.module.css:1143-1151, keeping that
  // block's own `overflow:hidden` / `padding-left`/`padding-right`/`grid-column`) falls back to the
  // generic table-layout rule's `white-space:nowrap`, and scrollWidth jumps to 683.
  expect(
    geometry.keywordScrollWidth,
    'list layout keyword is not truncated: nothing wider than its own box',
  ).toBeLessThanOrEqual(geometry.keywordClientWidth)
  // AC27 / SearchRulePage.module.css:753-759: the declaration is layout-agnostic (list layout's
  // own `display:contents` override does not redeclare `flex-wrap`), so the computed style still
  // shows it here even though it has no visible effect once `.ruleActions` stops being a flex box
  // in list layout.
  expect(geometry.actions?.buttonCount).toBe(1)
  expect(geometry.actions?.flexWrap).toBe('nowrap')
  await expectNoInkPaintedOutsideOwnColumn(page)

  await page.getByRole('button', { name: /ルールメニュー:/ }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await expectNoDocumentHorizontalOverflow(page)
})

test('list layout: long keyword + edit-mode selection stay separated and inside the row', async ({
  page,
}) => {
  await installSearchRuleCrowdedRowApiMocks(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/rule')
  await expect(page.getByText(CROWDED_KEYWORD)).toBeVisible()
  await expect(page.locator('[data-rule-layout]')).toHaveAttribute('data-rule-layout', 'list')

  await page.getByRole('button', { name: 'ルールを編集' }).click()
  await expect(page.getByTestId('edit-title-bar')).toBeVisible()
  await page.getByRole('button', { name: 'すべて選択' }).click()

  const geometry = await readCrowdedRowGeometry(page)
  expect(geometry.rowSelected, 'select-all selects the crowded row').toBe('true')
  expect(geometry.actions, 'edit mode does not render the per-row action-menu button').toBeNull()
  expectCrowdedRowColumnsDoNotOverlapOrOverflow(geometry)
  expect(geometry.keywordStyle).toMatchObject({
    whiteSpace: 'normal',
    wordBreak: 'break-all',
  })
  // See the sibling (non-edit-mode) list-layout test above for the truncation contract and its
  // measurements.
  expect(
    geometry.keywordScrollWidth,
    'list layout keyword is not truncated: nothing wider than its own box',
  ).toBeLessThanOrEqual(geometry.keywordClientWidth)
  await expectNoInkPaintedOutsideOwnColumn(page)

  const closeButton = page.getByRole('button', { name: '編集を終了' })
  const selectAllButton = page.getByRole('button', { name: 'すべて選択' })
  const deleteButton = page.getByRole('button', { name: '選択項目を削除' })
  const [closeBox, selectAllBox, deleteBox] = await Promise.all([
    closeButton.boundingBox(),
    selectAllButton.boundingBox(),
    deleteButton.boundingBox(),
  ])
  expect(closeBox).not.toBeNull()
  expect(selectAllBox).not.toBeNull()
  expect(deleteBox).not.toBeNull()
  if (closeBox !== null && selectAllBox !== null && deleteBox !== null) {
    expect(closeBox.x + closeBox.width, 'close icon stays left of select-all').toBeLessThanOrEqual(
      selectAllBox.x + 1,
    )
    expect(
      selectAllBox.x + selectAllBox.width,
      'select-all icon stays left of delete',
    ).toBeLessThanOrEqual(deleteBox.x + 1)
  }
  await expectNoDocumentHorizontalOverflow(page)
})
