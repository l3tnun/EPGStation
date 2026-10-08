// The AddEncodeDialog "sub directory" field must not keep showing the static text "sub directory"
// on top of whatever the user typed. Its label is a plain `<span>` positioned with
// `position: absolute` over the `<input>`, so it needs a rule to hide or move it once the field has
// a value or focus (client/src/features/recorded/RecordedPage.module.css,
// `.addEncodeDirectoryField span`). Other tests do not assert on the label's rendered position:
// - unittest/spec/recorded/component-encode-kodi-stream.spec.test.tsx only checks
//   `input.value` via jsdom + Testing Library, which never computes real CSS layout
//   (jsdom's getBoundingClientRect() is not backed by an actual layout engine), so it could not
//   catch an overlap even if it tried.
// - e2e/recorded-detail-workflow.spec.ts drives this same dialog in a real Chromium browser
//   (`subDirectoryInput.fill(...)`) but only asserts the input's value, never the label's
//   geometry.
// - unittest/spec/uiProblem2Static.inputs.spec.test.ts ([AC 8.29]) already special-cases this
//   exact raw `<input>` (it allow-lists `addEncodeClearButton` in its regex) but only requires an
//   adjacent clear button; it never checks whether the label gets out of the way.
// This file closes that gap with real-browser geometry assertions, covering every hand-rolled
// "label sits inside/over the field" implementation in client/src/**:
// AddEncodeDialog's own field, the two SearchKeywordRows
// fields that already use the correct `.legacyFloatingField` `:not(:placeholder-shown)` technique,
// and RecordedSearchDialog's channel/genre selects that use the `data-has-value` technique. Real
// MUI TextField/ClearableTextField instances (~20 other fields) are not
// re-verified here: they all go through MUI's own InputLabel shrink logic, which is exercised
// directly by `MuiInputLabel-shrink` class assertions already elsewhere in this suite (e.g.
// e2e/search-rule-form-controls.spec.ts) and is not code this project owns.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { SYNTHETIC_RECORDED_DETAIL_ID, installRecordedApiMocks } from './support/recordedMocks'
import { installStoragesUploadApiMocks } from './support/storagesUploadMocks'
import { setRecordedBrowserSettings } from './support/recordedWorkflow'
import { installSearchRuleWorkflowApiMocks } from './support/searchRuleMocks'

/**
 * Asserts that, once `input` holds a value, `label` (the visible caption/placeholder-like text
 * for that field) does not visually sit on top of the value the user typed. A regression that
 * lets a label overlap its value anywhere in this list makes this fail: the label's box would
 * still fully overlap the input's box, as an always-visible "sub directory" span would.
 */
async function expectLabelClearsValueOnceFilled(
  input: Locator,
  label: Locator,
  typedValue: string,
) {
  await input.click()
  await input.fill('')
  await input.type(typedValue)
  await expect(input).toHaveValue(typedValue)

  // The shrink is a 150ms transform. Measuring on the next task can land mid-transition
  // (rehearsal saw 12.47px). Poll until the transition has settled; a label that never
  // moves still fails this bound.
  await expect
    .poll(
      async () => {
        const [inputBox, labelBox] = await Promise.all([input.boundingBox(), label.boundingBox()])
        if (inputBox === null || labelBox === null) {
          return Number.POSITIVE_INFINITY
        }
        const overlapTop = Math.max(inputBox.y, labelBox.y)
        const overlapBottom = Math.min(inputBox.y + inputBox.height, labelBox.y + labelBox.height)
        return Math.max(0, overlapBottom - overlapTop)
      },
      {
        timeout: 1_000,
        message: 'label must move out of the way once the field has a value',
      },
    )
    .toBeLessThan(12)
}

/**
 * The "sub directory" label's *bounding box* still overlaps the input's bounding box by 4px after
 * typing/focus; a box-level check cannot tell whether that is visibly overlapping text or
 * harmless box padding.
 *
 * This measures the label's *rendered glyph ink* directly, via `Range.getClientRects()` on the
 * label's text node (the same technique DevTools uses to highlight text runs), instead of the
 * `<span>` element's box (which includes CSS line-height leading above/below the glyphs). That
 * distinguishes "the label's line-box padding pokes into the input's box" (harmless) from "the
 * actual letterforms of the label are drawn over the input's rows" (the original bug).
 *
 * Measured with this exact function once the shrink transition has settled (built dist,
 * chromium, 1272x900):
 *   - v3 AddEncodeDialog "sub directory" (this field): glyph/input overlap 1px (bounding-box
 *     overlap 4px, so 3px of that 4px is line-height leading, not ink).
 *   - v2 (`git show 5cf2ea383:client/src/components/encode/AddEncodeDialog.vue`, Vuetify
 *     `v-text-field label="sub directory"`, measured the same way against the v2 dist served by
 *     a local mock server): glyph/input overlap 2.25px (bounding-box
 *     overlap 3px). v2's own shrink animation leaves a comparable (in fact slightly larger) glyph
 *     overlap, and its screenshots at 4x zoom show no readable overlap either.
 * So v3's residual is not a v3-only regression: it matches (and is marginally tighter than) what
 * Vuetify itself produces for the same label/field shape. 6px keeps a wide margin above both
 * measurements while still failing hard on a real regression back toward the original bug (which
 * measured 19px of glyph overlap, since the label was never moved at all).
 *
 * Callers must wait for the 150ms font-size/transform transition (RecordedPage.module.css) to
 * settle before calling this: measuring mid-transition, this function's numbers are unstable
 * (observed 1-6px here depending on how far the transition had progressed at measurement time),
 * because both the label's font-size and its translateY are still animating.
 */
async function measureLabelGlyphOverlapPx(
  page: Page,
  input: Locator,
  label: Locator,
): Promise<number> {
  const [inputHandle, labelHandle] = await Promise.all([
    input.elementHandle(),
    label.elementHandle(),
  ])
  if (inputHandle === null || labelHandle === null) {
    throw new Error('expected both the input and its label to be attached to measure glyph overlap')
  }
  // Belt-and-braces: also make sure the self-hosted Roboto webfont has finished loading, since a
  // fallback-font glyph (different descender depth on the "y" in "directory") would shift this
  // measurement too.
  await page.evaluate(() => document.fonts.ready)
  return page.evaluate(
    ([inputEl, labelEl]) => {
      function firstNonEmptyTextNode(el: Element): Text | null {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode()
        while (node !== null) {
          if (node.textContent !== null && node.textContent.trim().length > 0) return node as Text
          node = walker.nextNode()
        }
        return null
      }
      const textNode = firstNonEmptyTextNode(labelEl as Element)
      if (textNode === null)
        throw new Error('label has no visible text node to measure glyph range from')
      const range = document.createRange()
      range.selectNodeContents(textNode)
      const glyphRects = Array.from(range.getClientRects())
      if (glyphRects.length === 0) throw new Error('label text node produced no client rects')
      const glyphTop = Math.min(...glyphRects.map((rect) => rect.top))
      const glyphBottom = Math.max(...glyphRects.map((rect) => rect.bottom))
      const inputRect = (inputEl as HTMLInputElement).getBoundingClientRect()
      const overlapTop = Math.max(inputRect.top, glyphTop)
      const overlapBottom = Math.min(inputRect.bottom, glyphBottom)
      return Math.max(0, overlapBottom - overlapTop)
    },
    [inputHandle, labelHandle] as const,
  )
}

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
})

test('AddEncodeDialog sub directory label gets out of the way once typed', async ({ page }) => {
  await setRecordedBrowserSettings(page)
  await installStoragesUploadApiMocks(page)
  await installRecordedApiMocks(page, 'success')

  await page.goto(`/#/recorded/detail/${SYNTHETIC_RECORDED_DETAIL_ID}`)
  await page.getByRole('button', { name: 'encode', exact: true }).click()
  const encodeDialog = page.getByRole('dialog', { name: 'エンコード追加' })
  await expect(encodeDialog).toBeVisible()

  const subDirectoryInput = encodeDialog.getByLabel('sub directory', { exact: true })
  const subDirectoryLabel = page
    .locator('label:has(input[data-recorded-add-encode-field="directory"]) span')
    .first()

  // Baseline: reproduces the exact defect shape before typing anything (label sits centered on
  // the empty field, same as v2's un-shrunk placeholder-style label).
  await expect(subDirectoryLabel).toHaveText('sub directory')

  await expectLabelClearsValueOnceFilled(subDirectoryInput, subDirectoryLabel, 'owner-finding-6')

  // The 4px bounding-box residual `expectLabelClearsValueOnceFilled`
  // allows here is line-height leading, not visible letters overlapping the value. See
  // `measureLabelGlyphOverlapPx` above for the v2/v3 measurements this threshold is based on.
  // `expectLabelClearsValueOnceFilled` waits out the 150ms shrink. This tighter 6px glyph
  // check still waits once more so a slow paint cannot sample the font-size animation.
  await page.waitForTimeout(250)
  const glyphOverlapPx = await measureLabelGlyphOverlapPx(
    page,
    subDirectoryInput,
    subDirectoryLabel,
  )
  expect(
    glyphOverlapPx,
    `label glyph ink must not visibly overlap the input once the field has a value (measured ${glyphOverlapPx}px)`,
  ).toBeLessThan(6)

  // Clearing the field must bring the field back to its empty, label-as-hint appearance instead
  // of leaving it permanently shrunk (the field is reused for the next dialog open).
  await encodeDialog.getByRole('button', { name: 'sub directoryをクリア' }).click()
  await expect(subDirectoryInput).toHaveValue('')
  await subDirectoryInput.evaluate((node) => (node as HTMLElement).blur())
  // The shrink/unshrink transition is 150ms (RecordedPage.module.css); wait for it to settle so
  // this reads the field's resting state rather than a mid-transition frame.
  await page.waitForTimeout(250)
  const clearedInputBox = await subDirectoryInput.boundingBox()
  const clearedLabelBox = await subDirectoryLabel.boundingBox()
  if (clearedInputBox === null || clearedLabelBox === null) {
    throw new Error('expected both the input and its label to remain visible once cleared')
  }
  const clearedOverlapTop = Math.max(clearedInputBox.y, clearedLabelBox.y)
  const clearedOverlapBottom = Math.min(
    clearedInputBox.y + clearedInputBox.height,
    clearedLabelBox.y + clearedLabelBox.height,
  )
  expect(Math.max(0, clearedOverlapBottom - clearedOverlapTop)).toBeGreaterThan(8)
})

async function legacyFloatingFieldLabel(page: Page, fieldLabel: string): Promise<Locator> {
  const input = page.getByLabel(fieldLabel, { exact: true })
  return page.locator('label').filter({ has: input }).locator('span').first()
}

test('Search page keyword and ignore keyword labels get out of the way once typed', async ({
  page,
}) => {
  await installSearchRuleWorkflowApiMocks(page)
  await page.goto('/#/search')

  const keywordInput = page.getByLabel('keyword', { exact: true })
  const keywordLabel = await legacyFloatingFieldLabel(page, 'keyword')
  await expectLabelClearsValueOnceFilled(keywordInput, keywordLabel, 'owner-finding-6')

  const ignoreKeywordInput = page.getByLabel('ignore keyword', { exact: true })
  const ignoreKeywordLabel = await legacyFloatingFieldLabel(page, 'ignore keyword')
  await expectLabelClearsValueOnceFilled(ignoreKeywordInput, ignoreKeywordLabel, 'owner-finding-6')
})

test('Recorded search dialog channel and genre labels get out of the way once a value is chosen', async ({
  page,
}) => {
  await setRecordedBrowserSettings(page)
  await installStoragesUploadApiMocks(page)
  await installRecordedApiMocks(page, 'success')

  await page.goto('/#/recorded')
  await page.getByRole('button', { name: '録画検索' }).click()
  await expect(page.getByRole('menu', { name: '録画検索' })).toBeVisible()

  for (const fieldLabel of ['放送局', 'ジャンル']) {
    const select = page.locator(`[aria-label="${fieldLabel}"]`)
    const label = page.locator('label').filter({ has: select }).first()
    const captionBefore = label.locator('span').first()

    // Before a value is chosen, the select itself already displays the field name (e.g.
    // "放送局") as its placeholder-like text, so the separate caption span is intentionally
    // hidden here (`[data-has-value='false'] > span { display: none }`) rather than overlapping
    // the select the way AddEncodeDialog's broken label overlapped its input.
    await expect(label).toHaveAttribute('data-has-value', 'false')
    await expect(captionBefore).toBeHidden()

    await select.click()
    const option = page.locator('li[role="option"]').nth(1)
    await option.click()

    await expect(label).toHaveAttribute('data-has-value', 'true')
    const selectBox = await select.boundingBox()
    const captionBox = await captionBefore.boundingBox()
    if (selectBox === null || captionBox === null) {
      throw new Error(`expected both the ${fieldLabel} select and its caption to be visible`)
    }
    const overlapTop = Math.max(selectBox.y, captionBox.y)
    const overlapBottom = Math.min(selectBox.y + selectBox.height, captionBox.y + captionBox.height)
    expect(Math.max(0, overlapBottom - overlapTop)).toBeLessThan(8)
  }
})
