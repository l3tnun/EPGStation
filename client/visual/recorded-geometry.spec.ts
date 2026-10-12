import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { installAppShellApiMocks } from '../e2e/support/appShellMocks'
import { SYNTHETIC_RECORDED_DETAIL_ID, installRecordedApiMocks } from '../e2e/support/recordedMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
  await installRecordedApiMocks(page)
})

async function expectChromiumScreenshot(
  locator: Locator,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  if (testInfo.project.name !== 'Desktop Chromium') {
    return
  }

  await expect(locator).toHaveScreenshot(name)
}

async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )

  // Source D: no v2 equivalent (v2 shipped no e2e/visual tests). v3-introduced contract: the
  // document must never grow wider than the viewport, i.e. no horizontal scrollbar.
  expect(overflow).toBeLessThanOrEqual(0)
}

async function expectLocatorInsideViewport(locator: Locator, page: Page): Promise<void> {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()

  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  // Source D: no v2 equivalent (v2 shipped no e2e/visual tests). v3-introduced contract: the
  // element must stay fully inside the viewport, i.e. never be positioned off-screen to the left.
  expect(box?.x).toBeGreaterThanOrEqual(0)
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0)
}

test('keeps Recorded list table and mobile card geometry stable', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'settings',
      JSON.stringify({ recordedLength: 24, isShowTableMode: true }),
    )
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/recorded')

  const list = page.getByTestId('recorded-page')
  await expect(list).toHaveAttribute('data-recorded-layout', 'table')
  await expect(list).toHaveAttribute('data-recorded-total', '6')
  await expectNoDocumentHorizontalOverflow(page)
  const tableGeometry = await list.evaluate((element) => {
    const rows = Array.from(
      element.querySelectorAll<HTMLElement>('[data-testid="recorded-list-item"]'),
    ).map((row) => row.getBoundingClientRect())

    return {
      rowCount: rows.length,
      rowsHaveArea: rows.every((row) => row.width > 0 && row.height > 0),
      equalWidths: rows.length > 1 && rows.every((row) => Math.abs(row.width - rows[0].width) < 1),
    }
  })

  expect(tableGeometry).toMatchObject({
    rowCount: 6,
    rowsHaveArea: true,
    equalWidths: true,
  })
  await expectChromiumScreenshot(list, testInfo, 'recorded-list-table.png')

  if (testInfo.project.name !== 'Android Chrome') {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/#/recorded?timestamp=mobile')
    await expect(page.getByTestId('recorded-page')).toHaveAttribute(
      'data-recorded-layout',
      'small-card',
    )
    await expectLocatorInsideViewport(page.getByTestId('recorded-page'), page)
  }
})

test('keeps Recorded mobile card content in the text column', async ({ page }, testInfo) => {
  if (testInfo.project.name !== 'Desktop Chromium') {
    return
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/recorded?timestamp=mobile-card-text-column')
  await expect(page.getByTestId('recorded-page')).toHaveAttribute(
    'data-recorded-layout',
    'small-card',
  )
  const fallbackImage = page
    .getByTestId('recorded-list-item')
    .first()
    .getByTestId('recorded-no-image')
  await expect(fallbackImage).toHaveAttribute('src', './img/noimg.png')
  await expect(fallbackImage).toHaveCSS('height', '100px')
  await expect(fallbackImage).toHaveCSS('max-width', '200px')

  const mobileCardGeometry = await page
    .getByTestId('recorded-list-item')
    .nth(1)
    .evaluate((card) => {
      const rectOf = (selector: string) => {
        const element = card.querySelector<HTMLElement>(selector)
        if (element === null) {
          return null
        }

        const rect = element.getBoundingClientRect()

        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        }
      }

      const cardRect = card.getBoundingClientRect()

      return {
        card: {
          x: cardRect.x,
          y: cardRect.y,
          width: cardRect.width,
          height: cardRect.height,
        },
        thumbnail: rectOf('img, [data-testid="recorded-no-image"]'),
        title: rectOf('h2'),
        description: rectOf('[class*="itemDescription"]'),
        action: rectOf(':scope > :first-child'),
      }
    })

  expect(mobileCardGeometry.thumbnail?.width).toBeGreaterThanOrEqual(100)
  expect(mobileCardGeometry.title?.width).toBeGreaterThanOrEqual(
    (mobileCardGeometry.card?.width ?? 0) * 0.45,
  )
  expect(mobileCardGeometry.description?.width).toBeGreaterThanOrEqual(
    (mobileCardGeometry.card?.width ?? 0) * 0.45,
  )
  // Source A: v2 5cf2ea383 client/src/components/recorded/RecordedSmallCard.vue —
  // `.content{flex-basis:100%}` holds both the title (`.text.subtitle-2`) and the description
  // (last `.text`), so they share one left edge, while `.menu-wrap{position:absolute;right:0}`
  // pins the action menu to the card's right edge. Matched by v3's
  // src/features/recorded/RecordedPage.module.css `.smallCards .card` — `.itemTitle`
  // (grid-column: 2; margin: 12px 8px 0) and `.itemDescription` (grid-column: 2; margin: 0 8px)
  // share the same grid column and left margin (±1px tolerates sub-pixel grid rounding), and
  // `.card > button:first-child` (the action menu, the card's first DOM child) is
  // `position: absolute; right: 4px`, so it renders to the right of the title despite preceding
  // it in DOM order.
  expect(
    Math.abs((mobileCardGeometry.title?.x ?? 0) - (mobileCardGeometry.description?.x ?? 0)),
  ).toBeLessThanOrEqual(1)
  expect(mobileCardGeometry.action?.x).toBeGreaterThan(mobileCardGeometry.title?.x ?? 0)
})

test('keeps detail action and dialog geometry inside the viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/#/recorded/detail/${SYNTHETIC_RECORDED_DETAIL_ID}`)

  const detail = page.getByTestId('recorded-detail-page')
  await expect(detail).toBeVisible()
  await expectNoDocumentHorizontalOverflow(page)
  const fallbackImage = page.getByTestId('recorded-detail-hero').getByTestId('recorded-no-image')
  await expect(fallbackImage).toHaveAttribute('src', './img/noimg.png')
  await expect(fallbackImage).toHaveCSS('max-height', '240px')

  const heroBox = await detail.boundingBox()
  const viewport = page.viewportSize()
  expect(heroBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  // Source D: no v2 equivalent (v2 shipped no e2e/visual tests). v3-introduced contract: the
  // element must stay fully inside the viewport, i.e. never be positioned off-screen to the left.
  expect(heroBox?.x).toBeGreaterThanOrEqual(0)
  expect((heroBox?.x ?? 0) + (heroBox?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0)

  await page.getByRole('button', { name: 'streaming' }).click()
  await page.getByRole('button', { name: 'Synthetic Encoded MP4' }).click()
  const dialog = page.getByRole('dialog', { name: 'ストリーム選択' })
  await expect(dialog).toBeVisible()
  const dialogBox = await dialog.boundingBox()
  expect(dialogBox).not.toBeNull()
  // Source D: no v2 equivalent (v2 shipped no e2e/visual tests). v3-introduced contract: the
  // dialog must stay fully inside the viewport, i.e. never be positioned off-screen to the left.
  expect(dialogBox?.x).toBeGreaterThanOrEqual(0)
  expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0)
  await expectChromiumScreenshot(dialog, testInfo, 'recorded-stream-dialog-mobile.png')
})

test('renders recorded detail action button icons at the Vuetify v-btn__content icon size (18px), not a generic 24px icon size', async ({
  page,
}) => {
  // Source A: v2 5cf2ea383 client/src/components/recorded/detail/RecordedDetailPlayButton.vue
  // renders `<v-icon left dark>` inside a Vuetify v-btn (v-btn__content is the icon's actual context, not a
  // bare top-level v-icon). Source B: v2 build output client/dist/css/chunk-vendors.*.css —
  // `.v-btn__content .v-icon.v-icon--left,.v-icon--right{font-size:18px;height:18px;width:18px}` — fixes that
  // context's icon box at 18x18px, overriding the base `.v-icon{font-size:24px}` rule.
  // Rendered measurement (C) against the pre-fix CSS showed the icon box at ~24x24px here; this asserts the
  // corrected 18x18px box so the icon does not consume more of the fixed-width button than v2 did.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/#/recorded/detail/${SYNTHETIC_RECORDED_DETAIL_ID}`)

  const playButton = page.getByRole('button', { name: 'play' })
  await expect(playButton).toBeVisible()

  const iconBox = await playButton.locator('span[aria-hidden="true"]').boundingBox()
  expect(iconBox).not.toBeNull()
  expect(iconBox?.height ?? 0).toBeCloseTo(18, 0)
  expect(iconBox?.width ?? 0).toBeLessThanOrEqual(20)
})

// Source: aligning the recorded detail action button label metrics with v2 fixes two rendering
// defects the source-only unit test
// (client/unittest/spec/recorded/list-styles.spec.test.tsx) cannot catch because it only greps
// RecordedPage.module.css for the 3 property strings, never rendering the page:
//   1. the leading icon drifted right (no `.detailActionIcon { margin-left: -4px }` to cancel the
//      icon-to-label `gap: 8px` the way v2's `.v-icon--left { margin-left: -4px }` does)
//   2. MUI's default label metrics (0.4px letter-spacing / 24.5px line-height, vs. v2's 1.25px /
//      21px) shrink the label box, which — because the button centers its flex content
//      (icon + gap + label) as one group — also pushes the icon further right.
// A rendered measurement (this file, in the `scripts/ci-rehearsal` container) against the CSS
// without those two fixes confirms both defects move the icon measurably right of
// its post-fix position (`icon.x - button.x`, Desktop Chromium, 1440x900):
//   play:      fixed 12.5px, margin-left reverted 14.5px (+2.0),   label metrics reverted 14.1875px (+1.6875)
//   streaming: fixed 12.875px, margin-left reverted 14.875px (+2.0), label metrics reverted 16.6875px (+3.8125)
//   kodi:      fixed 12.5px, margin-left reverted 14.5px (+2.0),   label metrics reverted 14.1875px (+1.6875)
// encode: all four buttons (play/streaming/encode/kodi) render a Material Design Icons PUA glyph
// in the `.detailActionIcon` span; encode uses `mdi-plus-circle-outline` (U+F0419). The icon box's
// rendered size (18x18, governed by `.detailActionIcon`) does not depend on which glyph it holds.
// encode's offset lands a fraction of a px higher than play/kodi's because encode's button is wider
// (117px vs 92-94px) and "encode" is a longer label, which shifts how the leftover flex space rounds
// between the two sides by that fraction.
// The same 4 measurements repeated on Desktop Firefox, Android Chrome (identical to Desktop
// Chromium), and iOS Safari land within 0.35px of the Desktop Chromium figures above in every
// case (e.g. play fixed: 12.5 / 12.75 / 12.5 / 12.75px) — engine text-metrics rounding, not a
// regression signal — so one tolerance band per button below covers every project without
// per-project branching.
//
// The label's *vertical* center turned out not to be a usable regression signal: because the
// button centers each flex item (icon, and the label's anonymous flex item) independently via
// `align-items: center`, the label's line box is always exactly centered on the button's cross
// axis regardless of `line-height` (21px post-fix vs. 24.5px pre-fix) — verified by temporarily
// wrapping the trailing label text node in a `<span>` (test-only DOM mutation, not present in
// src/) and reading its rendered line-box rect. Only the glyph ink shifts by a font-metrics
// sub-pixel amount (~0.25-0.5px, Desktop Chromium) that does not move consistently with the bug
// (reverting the fix moved the glyph ink *closer* to the icon's center, not further), so it would
// make a flaky, backwards assertion. What the commit actually restores line-box-wise is the exact
// v2 metrics, which computed style below verifies directly and deterministically.
test('keeps the recorded detail action icon at its v2-aligned offset and centers icon/label with the button, for play/streaming/encode/kodi', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/#/recorded/detail/${SYNTHETIC_RECORDED_DETAIL_ID}`)
  await expect(page.getByTestId('recorded-detail-page')).toBeVisible()

  const expectedIconOffset: Record<string, [number, number]> = {
    // [min, max) px from the button's left edge to the icon's left edge, wide enough to hold every
    // project's fixed-CSS measurement (see comment above) while excluding the closest reverted
    // measurement by at least 0.3px of margin.
    play: [11.5, 13.5],
    streaming: [12, 14.5],
    // Same band as play/kodi: post-fix, encode's icon is governed by the identical 18x18
    // `.detailActionIcon` box and `margin-left: -4px`, and measures 12.75-12.883px across the 4
    // projects (see comment above) — comfortably inside this band and more than 3px clear of the
    // pre-fix, unclassed measurement (~17.6-17.7px), well past the 0.3px margin used elsewhere.
    encode: [11.5, 13.5],
    kodi: [11.5, 13.5],
  }

  for (const name of ['play', 'streaming', 'encode', 'kodi']) {
    const button = page.getByRole('button', { name })
    await expect(button).toBeVisible()

    const geometry = await button.evaluate((buttonEl) => {
      const buttonRect = buttonEl.getBoundingClientRect()
      const iconEl = buttonEl.querySelector('span[aria-hidden="true"]')
      const iconRect = iconEl?.getBoundingClientRect() ?? null

      let labelTextNode: Text | null = null
      for (const child of Array.from(buttonEl.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim().length > 0) {
          labelTextNode = child as Text
        }
      }
      // Wrap the trailing label text node in a <span> so its line box (height == line-height,
      // vertically centered by the button's `align-items: center` like the icon) can be measured
      // with getBoundingClientRect — a bare Text node only supports Range measurement, which
      // returns the glyph ink box, not the line box. Restored immediately after; this mutates the
      // live page for measurement only, not RecordedPage.module.css or any src/ file.
      let labelRect: DOMRect | null = null
      if (labelTextNode !== null) {
        const wrapper = document.createElement('span')
        labelTextNode.parentNode?.insertBefore(wrapper, labelTextNode)
        wrapper.appendChild(labelTextNode)
        labelRect = wrapper.getBoundingClientRect()
        wrapper.parentNode?.insertBefore(labelTextNode, wrapper)
        wrapper.remove()
      }

      const style = getComputedStyle(buttonEl)

      return {
        buttonX: buttonRect.x,
        buttonVCenter: buttonRect.y + buttonRect.height / 2,
        iconX: iconRect?.x ?? null,
        iconVCenter: iconRect !== null ? iconRect.y + iconRect.height / 2 : null,
        labelVCenter: labelRect !== null ? labelRect.y + labelRect.height / 2 : null,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight,
      }
    })

    expect(geometry.iconX, `${name} icon x`).not.toBeNull()
    const iconOffset = (geometry.iconX ?? 0) - geometry.buttonX
    const [min, max] = expectedIconOffset[name]
    expect(iconOffset, `${name} icon offset from button left edge`).toBeGreaterThan(min)
    expect(iconOffset, `${name} icon offset from button left edge`).toBeLessThan(max)

    // v2's v-btn label metrics (see the rationale above): asserted on the live computed style, not
    // grepped from CSS source, so this fails if a future change (specificity, cascade order, a
    // different selector) stops the declared values from actually reaching this button.
    expect(geometry.letterSpacing, `${name} letter-spacing`).toBe('1.25px')
    expect(geometry.lineHeight, `${name} line-height`).toBe('21px')

    // Baseline geometry invariant (holds in both the fixed and pre-fix rendering, see comment
    // above): icon and label stay vertically centered on the button. Kept as a real rendering
    // assertion — it protects against a future regression that breaks the button's
    // `align-items: center` row layout entirely, which the offset/computed-style checks above do
    // not cover.
    expect(geometry.iconVCenter, `${name} icon vertical center`).not.toBeNull()
    expect(geometry.labelVCenter, `${name} label vertical center`).not.toBeNull()
    expect(geometry.iconVCenter as number, `${name} icon vs button vertical center`).toBeCloseTo(
      geometry.buttonVCenter,
      0,
    )
    expect(geometry.labelVCenter as number, `${name} label vs button vertical center`).toBeCloseTo(
      geometry.buttonVCenter,
      0,
    )
  }
})

test.describe('Chromium state screenshots', () => {
  test('captures Recorded empty and error states', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'Desktop Chromium') {
      return
    }

    await page.unrouteAll()
    await installAppShellApiMocks(page)
    await installRecordedApiMocks(page, 'empty')
    await page.goto('/#/recorded?timestamp=empty')
    await expect(page.getByTestId('recorded-page')).toHaveAttribute('data-recorded-total', '0')
    await expect(page.locator('main')).toHaveScreenshot('recorded-empty.png')

    await page.unrouteAll()
    await installAppShellApiMocks(page)
    await installRecordedApiMocks(page, 'list-failure')
    await page.goto('/#/recorded?timestamp=error')
    await expect(page.getByTestId('recorded-error')).toBeVisible()
    await expect(page.locator('main')).toHaveScreenshot('recorded-error.png')
  })
})
