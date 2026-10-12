import { expect, type Locator, type Page } from '@playwright/test'

export interface DarkCardCheck {
  label: string
  selector: string
}

export async function expectDarkCardsUseTheme(
  page: Page,
  checks: readonly DarkCardCheck[],
): Promise<void> {
  const failures = await page.evaluate((targets) => {
    function isVisible(element: Element): boolean {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0
      )
    }

    function isTransparent(value: string): boolean {
      return value === 'transparent' || value === 'rgba(0, 0, 0, 0)' || value === 'rgb(0 0 0 / 0)'
    }

    function effectiveBackground(element: Element): string {
      let current: Element | null = element
      while (current !== null) {
        const background = getComputedStyle(current).backgroundColor
        if (!isTransparent(background)) {
          return background
        }
        current = current.parentElement
      }

      return getComputedStyle(document.body).backgroundColor
    }

    function parseRgb(value: string): [number, number, number] | undefined {
      const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      if (match === null) {
        return undefined
      }

      return [Number(match[1]), Number(match[2]), Number(match[3])]
    }

    function relativeLuminance(value: string): number | undefined {
      const rgb = parseRgb(value)
      if (rgb === undefined) {
        return undefined
      }

      const [r, g, b] = rgb.map((channel) => {
        const normalized = channel / 255
        return normalized <= 0.03928
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4)
      })

      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    function isDarkSurface(value: string): boolean {
      const luminance = relativeLuminance(value)
      return luminance !== undefined && luminance < 0.35
    }

    function labelText(element: Element): string {
      return (
        element.getAttribute('data-testid') ??
        element.getAttribute('aria-label') ??
        element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) ??
        element.tagName.toLowerCase()
      )
    }

    function debugElement(element: Element): string {
      const className = element.getAttribute('class') ?? ''
      const inlineStyle = element.getAttribute('style') ?? ''
      const html = element.outerHTML.trim().replace(/\s+/g, ' ').slice(0, 240)

      return `tag=${element.tagName.toLowerCase()} class="${className}" style="${inlineStyle}" html="${html}"`
    }

    const errors: string[] = []
    for (const target of targets) {
      const elements = [...document.querySelectorAll(target.selector)].filter(isVisible)
      if (elements.length === 0) {
        errors.push(`${target.label}: missing visible card selector ${target.selector}`)
        continue
      }

      for (const element of elements) {
        const background = effectiveBackground(element)
        const foregroundTargets = [
          element,
          ...element.querySelectorAll(
            'h1,h2,h3,h4,h5,h6,p,span,div,button,a,td,th,label,input,select,textarea',
          ),
        ].filter(isVisible)

        if (background === 'rgb(255, 255, 255)') {
          errors.push(`${target.label}: white card surface on ${labelText(element)}`)
        }

        for (const foregroundTarget of foregroundTargets) {
          const color = getComputedStyle(foregroundTarget).color
          const foregroundBackground = effectiveBackground(foregroundTarget)
          if (
            (color === 'rgb(0, 0, 0)' || color === 'rgba(0, 0, 0, 0.87)') &&
            isDarkSurface(foregroundBackground)
          ) {
            errors.push(
              `${target.label}: black foreground ${color} on dark surface ${foregroundBackground} for ${labelText(foregroundTarget)}; ${debugElement(foregroundTarget)}`,
            )
          }
        }
      }
    }

    return errors
  }, checks)

  expect(failures).toEqual([])
}

export async function expectDarkSelectControlsUseTheme(
  page: Page,
  rootSelector: string,
): Promise<void> {
  // Callers frequently invoke this right after a click that opens the root element (a menu or a
  // shared RecordedPlainDialog). `RecordedPlainDialog` only mounts its `Dialog` once an
  // effect-driven `isMounted` state catches up with the `open` prop (see
  // src/features/recorded/components/RecordedPlainDialog.tsx), which lands one render tick after
  // the click that toggled `open` resolves. Waiting here (state-based, auto-retrying; not a fixed
  // sleep) instead of asserting on a single unretried `page.evaluate` snapshot avoids racing that
  // tick and any other opening transition.
  await expect(page.locator(rootSelector).first()).toBeVisible()

  const failures = await page.evaluate((selector) => {
    const root = document.querySelector(selector)
    if (root === null) {
      return [`missing root ${selector}`]
    }

    function isVisible(element: Element): boolean {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0
      )
    }

    function isTransparent(value: string): boolean {
      return value === 'transparent' || value === 'rgba(0, 0, 0, 0)' || value === 'rgb(0 0 0 / 0)'
    }

    function findBackground(element: Element): string {
      let current: Element | null = element
      while (current !== null) {
        const background = getComputedStyle(current).backgroundColor
        if (!isTransparent(background)) {
          return background
        }
        current = current.parentElement
      }

      return getComputedStyle(document.body).backgroundColor
    }

    function labelFor(element: Element): string {
      return (
        element.getAttribute('aria-label') ??
        element.getAttribute('data-testid') ??
        element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) ??
        element.tagName.toLowerCase()
      )
    }

    const candidates = [
      ...root.querySelectorAll('select,[role="combobox"],.MuiSelect-select,.MuiSelect-icon'),
    ].filter(isVisible)

    return candidates.flatMap((element) => {
      const style = getComputedStyle(element)
      const background = findBackground(element)
      const label = labelFor(element)
      const issues: string[] = []

      if (style.color === 'rgb(0, 0, 0)' || style.color === 'rgba(0, 0, 0, 0.87)') {
        issues.push(`${label}: black select foreground ${style.color}`)
      }
      if (background === 'rgb(255, 255, 255)') {
        issues.push(`${label}: white select background ${background}`)
      }
      if (element.tagName.toLowerCase() === 'select' && style.colorScheme !== 'dark') {
        issues.push(`${label}: native select color-scheme ${style.colorScheme}`)
      }

      return issues
    })
  }, rootSelector)

  expect(failures).toEqual([])
}

export async function expectOpenSelectMenuUsesDarkTheme(page: Page, combobox: Locator) {
  await combobox.click()
  const listbox = page.getByRole('listbox')
  await expect(listbox).toBeVisible()

  const failures = await listbox.evaluate((element) => {
    function parseRgb(value: string): [number, number, number] | undefined {
      const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      if (match === null) {
        return undefined
      }

      return [Number(match[1]), Number(match[2]), Number(match[3])]
    }

    function luminance(value: string): number | undefined {
      const rgb = parseRgb(value)
      if (rgb === undefined) {
        return undefined
      }

      const [r, g, b] = rgb.map((channel) => {
        const normalized = channel / 255
        return normalized <= 0.03928
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4)
      })

      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    const paper = element.closest('.MuiPaper-root') ?? element
    const paperStyle = getComputedStyle(paper)
    const paperLuminance = luminance(paperStyle.backgroundColor)
    const maxHeight = Number.parseFloat(paperStyle.maxHeight)
    const errors: string[] = []

    if (paperLuminance === undefined || paperLuminance >= 0.35) {
      errors.push(`open menu paper background is not dark: ${paperStyle.backgroundColor}`)
    }
    if (!Number.isFinite(maxHeight) || maxHeight > 216) {
      errors.push(`open menu max-height is ${paperStyle.maxHeight}`)
    }

    for (const option of [...element.querySelectorAll('[role="option"]')]) {
      const optionStyle = getComputedStyle(option)
      const optionLuminance = luminance(optionStyle.color)
      if (optionLuminance !== undefined && optionLuminance < 0.45) {
        errors.push(
          `open menu option has low-contrast foreground ${optionStyle.color}: ${option.textContent?.trim()}`,
        )
      }
    }

    return errors
  })

  expect(failures).toEqual([])
  await page.keyboard.press('Escape')
  if (await listbox.isVisible()) {
    await listbox.press('Escape')
  }
  await expect(listbox).toBeHidden()
}
