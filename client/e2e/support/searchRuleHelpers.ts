import { expect, type Page } from '@playwright/test'
import { selectMuiOption } from './muiSelect'
import { clickWithoutPointerStabilityWait } from './pointerInteractions'

export async function expectHiddenPlaceholderOption(
  page: Page,
  comboboxName: string,
  optionName: string,
) {
  const combobox = page.getByRole('combobox', { name: comboboxName })
  await combobox.click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await expect(page.getByRole('option', { name: optionName, exact: true })).toHaveCount(0)
  await page.getByRole('listbox').press('Escape')
  await expect(combobox).toHaveAttribute('aria-expanded', 'false')
}

export async function toggleChannelOption(page: Page, value: string) {
  const combobox = page.locator('[data-channel-select-wrapper] [role="combobox"]')
  if ((await combobox.getAttribute('aria-expanded')) !== 'true') {
    await combobox.click()
    await expect(page.getByRole('listbox')).toBeVisible()
  }
  await page.locator(`[role="option"][data-value="${value}"]`).click()
}

export async function expectShellMainOffset(page: Page, expectedOffset: number) {
  await expect(page.getByTestId('shell-main')).toHaveAttribute(
    'data-main-offset',
    String(expectedOffset),
  )
  await expect
    .poll(async () =>
      page
        .getByTestId('shell-content')
        .evaluate((node) => Math.round(node.getBoundingClientRect().left)),
    )
    .toBe(expectedOffset)
}

export async function expectRuleOptionFieldGaps(page: Page, labels: readonly string[]) {
  const gaps = await page
    .locator('form[class*="ruleOptionCard"]')
    .evaluate((form, targetLabels) => {
      const fields = Array.from(
        form.querySelectorAll<HTMLElement>('label[class*="ruleOptionField"]'),
      )
      const byLabel = new Map(
        fields.flatMap((field) => {
          const label = field.querySelector(':scope > span')?.textContent?.trim()

          return label === undefined ? [] : [[label, field] as const]
        }),
      )

      return (targetLabels as readonly string[]).map((label) => {
        const field = byLabel.get(label)
        if (field === undefined) {
          return { label, gap: null, missing: true }
        }

        const previous = field.previousElementSibling
        if (!(previous instanceof HTMLElement)) {
          return { label, gap: null, missing: false }
        }

        const fieldRect = field.getBoundingClientRect()
        const previousRect = previous.getBoundingClientRect()

        return {
          label,
          gap: Math.round(fieldRect.top - previousRect.bottom),
          missing: false,
        }
      })
    }, labels)

  for (const { label, gap, missing } of gaps) {
    expect(missing, `${label} field exists in Rule option form`).toBe(false)
    if (gap !== null) {
      // Provenance (D + C): the sibling gap is set by
      // `.rulePanelContent { gap: 12px }` (src/features/search/rule/SearchRulePage.module.css:843,
      // also applied via `.rulePanelOptionContent`); `.ruleOptionField { padding-top: 6px }` (same
      // file:860) sits inside the label box and does not affect the sibling gap. Measured
      // via a temporary console.log in this function
      // (`npx playwright test e2e/search-rule-select-parity.spec.ts -g exhaustive`): every checked
      // pair (sub directory / directory1 / sub directory1 / directory2 / sub directory2 /
      // directory3 / sub directory3) reported exactly 12px, matching the CSS gap.
      expect(gap, `${label} label field has visible gap from the previous element`).toBe(12)
    }
  }
}

export async function expectTextClear(page: Page, name: string, value: string) {
  const input = page.getByLabel(name, { exact: true })
  await fillTextInput(input, value)
  const clearButton = page.getByRole('button', { name: `${name}をクリア`, exact: true })
  await expectClearButtonInsideField(page, name, clearButton)
  await clickWithoutPointerStabilityWait(clearButton)
  await expect(input).toHaveValue('')
}

export async function expectSelectClear(page: Page, name: string, value: string) {
  await selectMuiOption({ page, name, value, exact: true })
  const clearButton = page.getByRole('button', { name: `${name}をクリア`, exact: true })
  await expectClearButtonInsideField(page, name, clearButton)
  await clickWithoutPointerStabilityWait(clearButton)
  await expect(clearButton).toHaveCount(0)
}

export async function fillTextInput(input: ReturnType<Page['getByLabel']>, value: string) {
  await input.fill(value)
  if ((await input.inputValue()) === value) {
    return
  }

  await input.evaluate((node, nextValue) => {
    const element = node as HTMLInputElement
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(element, nextValue)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

export async function expectClearButtonInsideField(
  page: Page,
  name: string,
  clearButton: ReturnType<Page['getByRole']>,
) {
  const geometry = await page.evaluate((labelText) => {
    const control =
      document.querySelector<HTMLElement>(
        `[role="combobox"][aria-label="${CSS.escape(labelText)}"]`,
      ) ?? document.querySelector<HTMLElement>(`input[aria-label="${CSS.escape(labelText)}"]`)
    const field =
      control?.closest<HTMLElement>('label[class*="ruleOptionField"]') ??
      control?.closest<HTMLElement>('label[class*="searchField"]') ??
      control?.closest<HTMLElement>('[class*="searchField"]') ??
      control?.closest<HTMLElement>('label') ??
      control?.parentElement
    const clear = document.querySelector<HTMLElement>(
      `button[aria-label="${CSS.escape(`${labelText}をクリア`)}"]`,
    )

    if (field === null || field === undefined || clear === null || control === null) {
      return null
    }

    const fieldRect = field.getBoundingClientRect()
    const clearRect = clear.getBoundingClientRect()
    const controlRect = control.getBoundingClientRect()

    return {
      clearCenterY: Math.round(clearRect.top + clearRect.height / 2),
      clearColor: getComputedStyle(clear).color,
      clearIconColor: getComputedStyle(clear.querySelector('span') ?? clear).color,
      clearFontSize: getComputedStyle(clear.querySelector('span') ?? clear).fontSize,
      clearHeight: Math.round(clearRect.height),
      clearRight: Math.round(clearRect.right),
      clearWidth: Math.round(clearRect.width),
      controlCenterY: Math.round(controlRect.top + controlRect.height / 2),
      controlRight: Math.round(controlRect.right),
      fieldLeft: Math.round(fieldRect.left),
      fieldRight: Math.round(fieldRect.right),
    }
  }, name)

  await expect(clearButton).toBeVisible()
  expect(geometry, `${name} clear button geometry is measurable`).not.toBeNull()
  if (geometry !== null) {
    // D, tied to v3 src (no v2 equivalent - v2's Vuetify clearable fields have no such geometry
    // contract): the clear button is `position: absolute; right: 0` inside its field wrapper in
    // both implementations - SearchRulePage.module.css `.clearInputButton` (right:0/width:32px/
    // height:32px/top:50%+translateY(-50%)) for text inputs, and shared/AppSelect.tsx's IconButton
    // sx (right:0/width:32/height:32/top:controlHeight/2+translateY(-50%)) for selects. Also spec'd
    // at .kiro/specs/frontend-search-rule/visual-cases.md:50 ("Clear button は field/card 右端では
    // なく対象 input/select の右端に重なり... 隣の input や card 端へ逃げてはならない").
    // +1 on fieldRight tolerates box-model rounding for the right:0 alignment.
    expect(
      geometry.clearRight,
      `${name} clear button stays inside field right edge`,
    ).toBeLessThanOrEqual(geometry.fieldRight + 1)
    // 40 is the reserved right-padding AppSelect.tsx sets on its select input
    // (`paddingRight: '40px !important'`) so the clear button never overlaps the value text; it is
    // also looser than SearchRulePage.module.css's `.clearableInput { padding-right: 32px }` used
    // by ClearableInput's text fields, so one threshold covers both control types.
    expect(
      geometry.clearRight,
      `${name} clear button sits near input right edge`,
    ).toBeGreaterThanOrEqual(geometry.controlRight - 40)
    // Both implementations vertically center the button on the control (`top: 50%` /
    // `top: controlHeight / 2`, each with `translateY(-50%)`); 4px tolerates sub-pixel rounding.
    expect(
      Math.abs(geometry.clearCenterY - geometry.controlCenterY),
      `${name} clear button is vertically aligned with its input/select`,
    ).toBeLessThanOrEqual(4)
    expect(geometry.clearWidth, `${name} clear button width matches Settings`).toBe(32)
    expect(geometry.clearHeight, `${name} clear button height matches Settings`).toBe(32)
    expect(geometry.clearFontSize, `${name} clear icon size matches Settings`).toBe('28px')
    expect(geometry.clearColor, `${name} clear button color matches Settings`).toBe(
      'rgb(25, 118, 210)',
    )
    expect(geometry.clearIconColor, `${name} clear icon color matches Settings`).toBe(
      'rgb(25, 118, 210)',
    )
  }
}
