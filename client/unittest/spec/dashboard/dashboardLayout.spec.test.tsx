import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Dashboard layout static guards', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(
      null,
      '',
      '/#/?page=8&keyword=alpha&ruleId=12&channelId=34&genre=5&hasOriginalFile=true',
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 3.6] keeps desktop Dashboard overflow inside section lists like the legacy layout', () => {
    const css = readFileSync('src/features/dashboard/DashboardPage.module.css', 'utf8')

    expect(css).toContain('height: calc(100vh - 72px);')
    expect(css).toContain('overflow: hidden;')
    expect(css).toContain('height: calc(100dvh - 72px);')
    expect(css).toContain('max-height: 100%;')
  })

  it('[AC 2.15] keeps recording summary rows content-sized and only fixes recorded thumbnail rows', () => {
    const css = readFileSync('src/features/dashboard/DashboardPage.module.css', 'utf8')

    expect(css).toContain('align-items: flex-start;')
    expect(css).toContain(
      ".section[data-testid='dashboard-section-recorded'] .item {\n  height: 100px;",
    )
    expect(css).not.toContain('.section:has(.item) {\n    height: 100%;')
    expect(css).toContain('max-height: calc(100% - 60px);')
    expect(css).not.toContain(
      ".section[data-testid='dashboard-section-recording'] .item {\n  height: 100px;",
    )
    expect(css).not.toContain('.recordingContentButton {\n  height: 100px;')
    expect(css).not.toContain('.recordingText {\n  flex: 1 1 auto;\n  gap: 0;\n  height: 100px;')
  })

  it('[AC 3.4] [AC 3.7] does not trap Android mobile page scrolling inside dashboard summary lists', () => {
    const css = readFileSync('src/features/dashboard/DashboardPage.module.css', 'utf8')
    const source = readFileSync('src/features/dashboard/lib/dashboardFormat.ts', 'utf8')
    const baseItemListRule = css.match(/\.itemList\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body

    expect(baseItemListRule).toBeDefined()
    expect(baseItemListRule).not.toContain('overflow-y: auto;')
    expect(baseItemListRule).not.toContain('overscroll-behavior-y: contain;')
    expect(css).toMatch(
      /@media \(min-width: 1023px\) \{[\s\S]*?\.itemList\s*\{[\s\S]*?overscroll-behavior-y: contain;[\s\S]*?overflow-y: auto;/,
    )
    expect(source).toContain("document.documentElement.classList.contains('fix-address-bar2')")
    expect(source).toContain('element.scrollHeight > element.clientHeight + 1')
  })
})
