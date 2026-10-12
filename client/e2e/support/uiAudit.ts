import { expect, type Page } from '@playwright/test'
import { contrastRatio, isBlackOnDark } from './uiAuditColor'

export { contrastRatio } from './uiAuditColor'

export type AuditTheme = 'light' | 'dark'
export type AuditStatus = 'pass' | 'fail' | 'unverified' | 'excluded'

export interface UiAuditTarget {
  page: string
  route: string
  dataState: string
  theme: AuditTheme
  viewportDevice: string
  openedState: string
  component: string
  rootSelector: string
}

export interface UiAuditRow extends Omit<UiAuditTarget, 'rootSelector'> {
  element: string
  role: string
  visualProperty: string
  expected: string
  actual: string
  evidence: string
  status: AuditStatus
}

const CONTRAST_THRESHOLD_TEXT = 4.5
const CONTRAST_THRESHOLD_NON_TEXT = 3

function finalizeRow(row: UiAuditRow, foreground: string, background: string): UiAuditRow {
  const ratio = contrastRatio(foreground, background)
  const threshold = row.role === 'text' ? CONTRAST_THRESHOLD_TEXT : CONTRAST_THRESHOLD_NON_TEXT
  const actual =
    ratio === undefined
      ? `${foreground} on ${background}; contrast=unverified`
      : `${foreground} on ${background}; contrast=${ratio.toFixed(2)}`
  const status =
    ratio === undefined || row.theme === 'dark'
      ? ratio === undefined || ratio < threshold || isBlackOnDark(foreground, background)
        ? 'fail'
        : 'pass'
      : 'pass'

  return {
    ...row,
    expected: `contrast >= ${threshold}`,
    actual,
    status,
  }
}

export async function collectVisibleUiAuditRows(
  page: Page,
  target: UiAuditTarget,
): Promise<UiAuditRow[]> {
  const rawRows = await page.evaluate(({ rootSelector }) => {
    const root = document.querySelector(rootSelector)
    if (root === null) return []

    const selector = [
      'button',
      'a[href]',
      'input',
      'select',
      'textarea',
      '[role]',
      'svg',
      '[class*="icon"]',
      '[class*="Icon"]',
      '[class*="navigationIcon"]',
      '.MuiSvgIcon-root',
      '.MuiSwitch-root',
      '.MuiCheckbox-root',
      '.MuiSelect-icon',
    ].join(',')

    interface BrowserRgbColor {
      r: number
      g: number
      b: number
      a: number
    }

    function parseBrowserRgb(value: string): BrowserRgbColor | undefined {
      const match = /^rgba?\(([^)]+)\)$/.exec(value.trim())
      if (match === null) return undefined
      const normalized = match[1].replace(/\s*\/\s*/g, ', ')
      const parts = normalized.includes(',')
        ? normalized.split(',').map((part) => part.trim())
        : normalized.split(/\s+/)
      const r = Number(parts[0])
      const g = Number(parts[1])
      const b = Number(parts[2])
      const a = parts[3] === undefined ? 1 : Number(parts[3])
      if (![r, g, b, a].every(Number.isFinite)) return undefined

      return { r, g, b, a }
    }

    function formatBrowserRgb(color: BrowserRgbColor): string {
      return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`
    }

    function blendBrowserColor(
      foreground: BrowserRgbColor,
      background: BrowserRgbColor,
    ): BrowserRgbColor {
      if (foreground.a >= 1) return foreground

      return {
        r: foreground.r * foreground.a + background.r * (1 - foreground.a),
        g: foreground.g * foreground.a + background.g * (1 - foreground.a),
        b: foreground.b * foreground.a + background.b * (1 - foreground.a),
        a: 1,
      }
    }

    function isTransparent(value: string): boolean {
      const color = parseBrowserRgb(value)

      return (
        value === 'transparent' ||
        value === 'rgba(0, 0, 0, 0)' ||
        value === 'rgb(0 0 0 / 0)' ||
        color?.a === 0
      )
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

    function findBackground(element: Element): string {
      let current: Element | null = element
      const layers: BrowserRgbColor[] = []
      while (current !== null) {
        const background = getComputedStyle(current).backgroundColor
        if (!isTransparent(background)) {
          const parsed = parseBrowserRgb(background)
          if (parsed !== undefined) {
            layers.push(parsed)
            if (parsed.a >= 1) {
              const baseLayer = layers[layers.length - 1]
              const overlayLayers = layers.slice(0, -1)

              return formatBrowserRgb(
                overlayLayers.reduceRight(
                  (backgroundLayer, foregroundLayer) =>
                    blendBrowserColor(foregroundLayer, backgroundLayer),
                  baseLayer,
                ),
              )
            }
          }
        }
        current = current.parentElement
      }

      return getComputedStyle(document.body).backgroundColor
    }

    function labelFor(element: Element): string {
      const ariaLabel = element.getAttribute('aria-label')
      if (ariaLabel !== null && ariaLabel !== '') return ariaLabel
      const testId = element.getAttribute('data-testid')
      if (testId !== null && testId !== '') return testId
      const title = element.getAttribute('title')
      if (title !== null && title !== '') return title
      const text = element.textContent?.trim().replace(/\s+/g, ' ')
      if (text !== undefined && text !== '') return text.slice(0, 80)

      return element.tagName.toLowerCase()
    }

    function roleFor(element: Element): string {
      const explicitRole = element.getAttribute('role')
      if (explicitRole !== null && explicitRole !== '') return explicitRole
      const tagName = element.tagName.toLowerCase()
      if (tagName === 'svg' || tagName === 'span') return 'icon'
      if (tagName === 'button' || tagName === 'a') return tagName

      return element.textContent?.trim() === '' ? tagName : 'text'
    }

    const candidates = new Set<Element>()
    root.querySelectorAll(selector).forEach((element) => candidates.add(element))
    root.querySelectorAll('*').forEach((element) => {
      const text = element.textContent?.trim()
      if (text !== undefined && text !== '' && element.children.length === 0) {
        candidates.add(element)
      }
    })

    return [...candidates].filter(isVisible).flatMap((element) => {
      const style = getComputedStyle(element)
      const background = findBackground(element)
      const label = labelFor(element)
      const role = roleFor(element)
      const rows = [
        {
          element: label,
          role,
          visualProperty: 'color',
          foreground: style.color,
          background,
        },
      ]

      for (const pseudo of ['::before', '::after'] as const) {
        const pseudoStyle = getComputedStyle(element, pseudo)
        const content = pseudoStyle.content
        if (content !== 'none' && content !== 'normal' && content !== '') {
          rows.push({
            element: `${label}${pseudo}`,
            role,
            visualProperty: `${pseudo}.color`,
            foreground: pseudoStyle.color,
            background,
          })
        }
      }

      return rows
    })
  }, target)

  return rawRows.map((row) =>
    finalizeRow(
      {
        page: target.page,
        route: target.route,
        dataState: target.dataState,
        theme: target.theme,
        viewportDevice: target.viewportDevice,
        openedState: target.openedState,
        component: target.component,
        element: row.element,
        role: row.role,
        visualProperty: row.visualProperty,
        expected: '',
        actual: '',
        evidence: target.rootSelector,
        status: 'unverified',
      },
      row.foreground,
      row.background,
    ),
  )
}

export async function expectNoUiAuditFailures(rows: readonly UiAuditRow[]): Promise<void> {
  const failures = rows.filter((row) => row.status === 'fail' || row.status === 'unverified')

  expect(failures, JSON.stringify(failures.slice(0, 20), null, 2)).toEqual([])
}
