import { expect, type Locator, type Page } from '@playwright/test'

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function dispatchMouseSequence(locator: Locator): Promise<void> {
  await locator.evaluate((node) => {
    const element = node as HTMLElement
    const eventInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
    }
    element.dispatchEvent(new MouseEvent('mousedown', eventInit))
    element.dispatchEvent(new MouseEvent('mouseup', eventInit))
    element.dispatchEvent(new MouseEvent('click', eventInit))
  })
}

export function muiSelectName(name: string | RegExp, exact?: boolean): string | RegExp {
  if (!(typeof name === 'string' && exact === true)) {
    return name
  }

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return new RegExp(`^${escaped}(?:\\s+${escaped})?$`)
}

export async function selectMuiOption({
  page,
  root = page,
  name,
  value,
  exact,
}: {
  page: Page
  root?: Page | Locator
  name: string | RegExp
  value: string
  exact?: boolean
}): Promise<string> {
  const combobox = root.getByRole('combobox', { name: muiSelectName(name, exact) })
  const comboboxHandle = await combobox.elementHandle()
  if (comboboxHandle === null) {
    throw new Error(`MUI select combobox not found: ${String(name)}`)
  }

  let selectedValue = ''
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dispatchMouseSequence(combobox)
    const listbox = page.getByRole('listbox').last()
    await expect(listbox).toBeVisible()
    const option = listbox
      .locator(`[role="option"][data-value="${cssAttributeValue(value)}"]`)
      .last()
    await expect(option).toBeAttached()
    await dispatchMouseSequence(option)
    try {
      await expect
        .poll(() => comboboxHandle.evaluate((element) => element.getAttribute('aria-expanded')), {
          timeout: 1_000,
        })
        .toBe('false')
    } catch {
      await page.keyboard.press('Escape')
      await expect
        .poll(() => comboboxHandle.evaluate((element) => element.getAttribute('aria-expanded')))
        .toBe('false')
    }
    await expect(listbox).toBeHidden()
    selectedValue = await comboboxHandle.evaluate((element) => {
      const input = element.closest('.MuiInputBase-root')?.querySelector('input')
      return input instanceof HTMLInputElement ? input.value : ''
    })
    if (selectedValue === value) {
      return selectedValue
    }
  }

  throw new Error(
    `MUI select did not apply value: ${String(name)} expected ${value}, received ${selectedValue}`,
  )
}

/**
 * MUI の Select は、利用者が操作する combobox と、form 送信用の隠し input の 2 つを描画する。
 * 隠し input も同じ label に結び付くため、`getByLabel` は 2 つに一致して strict mode 違反になる。
 * 見えている方だけを指す。
 */
export function muiSelectCombobox(
  root: Page | Locator,
  name: string | RegExp,
  exact?: boolean,
): Locator {
  return root.getByRole('combobox', { name: muiSelectName(name, exact) })
}

export function muiSelectInput(
  root: Page | Locator,
  name: string | RegExp,
  exact?: boolean,
): Locator {
  return root
    .getByRole('combobox', { name: muiSelectName(name, exact) })
    .locator('xpath=ancestor::*[contains(@class, "MuiInputBase-root")][1]//input')
}
