import { expect, type Page } from '@playwright/test'

export async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )

  // Provenance (D): v3-only "no horizontal scrollbar" contract. v2 (5cf2ea383, client/)
  // ships no e2e/visual suite at all, so 0px is not a value carried over from v2.
  expect(overflow).toBeLessThanOrEqual(0)
}

export interface GeometryRect {
  left: number
  right: number
  top: number
  bottom: number
}

export function countIntersectingPairs(rects: readonly GeometryRect[], tolerance = 0.5): number {
  let count = 0

  for (let firstIndex = 0; firstIndex < rects.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < rects.length; secondIndex += 1) {
      const first = rects[firstIndex]
      const second = rects[secondIndex]
      const intersects =
        first.left < second.right - tolerance &&
        first.right > second.left + tolerance &&
        first.top < second.bottom - tolerance &&
        first.bottom > second.top + tolerance

      if (intersects) {
        count += 1
      }
    }
  }

  return count
}

export async function inspectReserveListGeometry(page: Page) {
  return page.getByTestId('reserves-page').evaluate((pageElement) => {
    const pageRect = pageElement.getBoundingClientRect()
    const list = pageElement.querySelector('[role="list"]') ?? pageElement.querySelector('table')
    const listRect = list?.getBoundingClientRect()
    const items = Array.from(pageElement.querySelectorAll('[data-testid="reserves-list-item"]'))
    const toRect = (rect: DOMRect): GeometryRect => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    })

    return {
      pageWidth: pageRect.width,
      listWidth: listRect?.width ?? 0,
      itemCount: items.length,
      pageWithinViewport:
        pageRect.left >= 0 && pageRect.right <= document.documentElement.clientWidth,
      rows: items.map((item) => {
        const itemRect = item.getBoundingClientRect()
        const computedStyle = window.getComputedStyle(item)
        const contentButton =
          item.querySelector('button:not([aria-label^="予約メニュー"])') ??
          item.querySelector('td:first-child')
        const menuButton = item.querySelector('button[aria-label^="予約メニュー"]')
        const contentRect = contentButton?.getBoundingClientRect()
        const menuRect = menuButton?.getBoundingClientRect()

        return {
          withinPage: itemRect.left >= pageRect.left && itemRect.right <= pageRect.right,
          state: item.getAttribute('data-reserve-state'),
          display: computedStyle.display,
          gridTemplateColumns: computedStyle.gridTemplateColumns,
          rects: [contentRect, menuRect]
            .filter((rect): rect is DOMRect => rect !== undefined)
            .map(toRect),
          needsDecoration: item.getAttribute('data-needs-decoration') === 'true',
        }
      }),
    }
  })
}

export async function expectDialogWithinViewport(page: Page, name: string): Promise<void> {
  const dialogBox = await page.getByRole('dialog', { name }).boundingBox()
  const viewport = page.viewportSize()

  expect(dialogBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  // Provenance (D): v3-only "dialog stays on-screen" contract (x/y >= 0); v2 has no equivalent
  // e2e/visual suite to compare against.
  expect(dialogBox?.x).toBeGreaterThanOrEqual(0)
  expect(dialogBox?.y).toBeGreaterThanOrEqual(0)
  expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0)
  expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0)
}

export async function inspectManualReserveGeometry(page: Page) {
  return page.getByTestId('manual-reserve-page').evaluate((form) => {
    const formRect = form.getBoundingClientRect()
    const toRect = (rect: DOMRect): GeometryRect => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    })
    const allMeasuredElements = Array.from(
      form.querySelectorAll(
        'section, label.MuiFormControlLabel-root, button, .MuiFormControl-root',
      ),
    )
    const directBlocks = Array.from(form.children).map((element) => {
      const rect = element.getBoundingClientRect()

      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      }
    })
    const sectionControls = Array.from(form.querySelectorAll('section')).map((section) =>
      Array.from(
        section.querySelectorAll(
          ':scope > label.MuiFormControlLabel-root, :scope > .MuiFormControl-root, :scope > div > .MuiFormControl-root',
        ),
      ).map((element) => toRect(element.getBoundingClientRect())),
    )
    const measuredRects = allMeasuredElements.map((element) =>
      toRect(element.getBoundingClientRect()),
    )

    return {
      panelIndexes: Array.from(form.querySelectorAll('[data-option-panel-index]')).map((panel) =>
        panel.getAttribute('data-option-panel-index'),
      ),
      withinViewport: formRect.left >= 0 && formRect.right <= document.documentElement.clientWidth,
      outsideFormCount: measuredRects.filter(
        (rect) => rect.left < formRect.left || rect.right > formRect.right,
      ).length,
      directBlockRects: directBlocks,
      sectionControlRects: sectionControls,
    }
  })
}
