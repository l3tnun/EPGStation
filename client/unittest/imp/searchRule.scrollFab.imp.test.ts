import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('Search route scroll FAB implementation edges', () => {
  it('positions the Search top FAB after the active app main offset and scrolls the active shell owner', () => {
    const css = readFileSync(
      `${process.cwd()}/src/features/search/rule/SearchRulePage.module.css`,
      'utf8',
    )
    const source = readFileSync(
      `${process.cwd()}/src/features/search/rule/lib/pageScroll.ts`,
      'utf8',
    )

    expect(css).toMatch(
      /\.scrollFab\s*\{[\s\S]*?left: calc\(var\(--app-main-offset, 0px\) \+ 12px\);/,
    )
    expect(source).toContain('function scrollActivePageToTop')
    expect(source).toContain('const fixedShellScrollContainer = getActivePageScrollContainer()')
    expect(source).toContain('fixedShellScrollContainer.scrollTo({ top: 0, behavior })')
    expect(source).toContain('window.scrollTo({ top: 0, behavior })')
  })

  it('keeps Search result title and description typography independent from button defaults', () => {
    const css = readFileSync(
      `${process.cwd()}/src/features/search/rule/SearchRulePage.module.css`,
      'utf8',
    )
    const source = readFileSync(
      `${process.cwd()}/src/features/search/rule/components/SearchResultSection.tsx`,
      'utf8',
    )

    expect(css).toMatch(/\.resultItem\s*\{[\s\S]*?font-family: inherit;/)
    expect(css).toMatch(/\.programName\s*\{[\s\S]*?font-size: 1rem;/)
    expect(css).toMatch(/\.programName\s*\{[\s\S]*?line-height: 28px;/)
    expect(css).toMatch(/\.programName\s*\{[\s\S]*?font-weight: 900;/)
    expect(css).toMatch(/\.programDescription\s*\{[\s\S]*?font-size: 0\.875rem;/)
    expect(css).toMatch(/\.programDescription\s*\{[\s\S]*?line-height: 20px;/)
    expect(source).toContain('data-search-result-text="title"')
    expect(source).toContain('data-search-result-text="meta"')
    expect(source).toContain('data-search-result-text="description"')
  })
})
