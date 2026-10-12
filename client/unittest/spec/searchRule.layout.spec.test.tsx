import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Search route lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.documentElement.classList.remove('fix-address-bar2')
  })

  it('[AC 2.35] keeps the search condition, result, and rule option surfaces on one width contract', () => {
    const css = readFileSync('src/features/search/rule/SearchRulePage.module.css', 'utf8')

    expect(css).toMatch(/\.form\s*\{[^}]*max-width:\s*800px;/s)
    expect(css).toMatch(/\.result\s*\{[^}]*max-width:\s*800px;/s)
    expect(css).toMatch(/\.ruleOptionCard\s*\{[^}]*max-width:\s*800px;/s)
  })

  it('[AC 2.39] keeps original vertical spacing between select rows, checkbox rows, and rule option labels', () => {
    const css = readFileSync('src/features/search/rule/SearchRulePage.module.css', 'utf8')

    expect(css).toMatch(/\.selectCheckboxGap\s*\{[^}]*margin-top:\s*12px;/s)
    expect(css).toMatch(/\.ruleOptionField\s*\{[^}]*padding-top:\s*6px;/s)
  })

  it('[AC 2.39] keeps search-form checkboxes aligned to the search card padding without affecting rule options', () => {
    const css = readFileSync('src/features/search/rule/SearchRulePage.module.css', 'utf8')

    expect(css).toMatch(/\.searchCard \.checkboxLabel\s*\{[^}]*margin:\s*0;/s)
    expect(css).toMatch(
      /\.searchCard \.checkboxLabel :global\(\.MuiFormControlLabel-label\)\s*\{[^}]*font-size:\s*1rem;[^}]*line-height:\s*20px;/s,
    )
    expect(css).not.toMatch(/\.ruleOptionCard \.checkboxLabel\s*\{[^}]*margin:\s*0;/s)
  })

  it('[AC 2.39] keeps keyword target checkboxes content-sized so 288px mobile width uses the legacy two-row layout', () => {
    const css = readFileSync('src/features/search/rule/SearchRulePage.module.css', 'utf8')

    expect(css).toMatch(/\.keywordCheckboxLine\s*\{[^}]*column-gap:\s*8px;/s)
    expect(css).toMatch(/\.keywordCheckboxLine\s*\{[^}]*row-gap:\s*0;/s)
    expect(css).toMatch(/\.keywordCheckboxLine \.checkboxLabel\s*\{[^}]*flex:\s*0 0 auto;/s)
    expect(css).toMatch(
      /\.keywordCheckboxLine \.checkboxLabel:nth-child\(-n \+ 2\)\s*\{[^}]*flex-basis:\s*96px;/s,
    )
    expect(css).toMatch(
      /\.keywordCheckboxLine \.checkboxLabel:nth-child\(n \+ 3\)\s*\{[^}]*flex-basis:\s*64px;/s,
    )
    expect(css).not.toContain('flex-basis: calc((100% - 16px) / 3);')
  })

  it('[AC 2.40] uses legacy floating label behavior for empty keyword, ignore keyword, and channel fields', () => {
    const source = readFileSync('src/features/search/rule/components/SearchKeywordRows.tsx', 'utf8')
    const channelSelectSource = readFileSync(
      'src/features/search/rule/components/ChannelMultiSelect.tsx',
      'utf8',
    )
    const css = readFileSync('src/features/search/rule/SearchRulePage.module.css', 'utf8')

    expect(channelSelectSource).toContain('data-has-value={hasValue ?')
    expect(source).toMatch(
      /className=\{`\$\{styles\.searchField\} \$\{styles\.legacyFloatingField\}`\}[\s\S]*?<span>keyword<\/span>/,
    )
    expect(source).toMatch(
      /className=\{`\$\{styles\.searchField\} \$\{styles\.legacyFloatingField\}`\}[\s\S]*?<span>ignore keyword<\/span>/,
    )
    expect(source).toMatch(
      /className=\{`\$\{styles\.searchField\} \$\{styles\.legacyFloatingField\}`\}[\s\S]*?<span>channel<\/span>/,
    )
    expect(css).toMatch(/\.legacyFloatingField \.textInput::placeholder\s*\{[^}]*opacity:\s*0;/s)
    expect(css).toMatch(
      /\.legacyFloatingField > span:first-child\s*\{[^}]*top:\s*24px;[^}]*transform:\s*none;/s,
    )
    expect(css).toMatch(
      /\.legacyFloatingField:focus-within > span:first-child,\s*\.legacyFloatingField:has\(\.textInput:not\(:placeholder-shown\)\) > span:first-child,\s*\.legacyFloatingField:has\(\[data-channel-select-wrapper\]\[data-has-value='true'\]\) > span:first-child\s*\{[^}]*transform:\s*translateY\(-22px\) scale\(0\.75\);/s,
    )
    expect(css).toMatch(
      /\.channelSelectPlaceholder\s*\{[^}]*color:\s*rgba\(0,\s*0,\s*0,\s*0\.6\);/s,
    )
    expect(css).toMatch(
      /\.legacyFloatingField:has\(\[data-channel-select-wrapper\]\[data-has-value='false'\]\):not\(:focus-within\)\s*> span:first-child\s*\{[^}]*color:\s*transparent;/s,
    )
  })

  it('[AC 3.32] prevents iOS simulator Safari button font fallback from corrupting rule list text', () => {
    const css = readFileSync('src/features/search/rule/SearchRulePage.module.css', 'utf8')

    expect(css).toMatch(/\.ruleItemMain\s*\{[\s\S]*?font-family:\s*inherit;/)
  })

  it('[AC 3.32] uses the icon font for rule list overflow menu buttons instead of a raw vertical ellipsis glyph', () => {
    const source = readFileSync('src/features/search/rule/components/RuleListRow.tsx', 'utf8')
    const css = readFileSync('src/features/search/rule/SearchRulePage.module.css', 'utf8')

    expect(source).not.toContain('>⋮</span>')
    expect(css).not.toContain("content: '⋮';")
    expect(css).toMatch(
      /\.ruleActionIcon::before\s*\{[\s\S]*?font-family:\s*'Material Design Icons';/,
    )
    expect(css).toMatch(/\.ruleActionIcon::before\s*\{[\s\S]*?content:\s*'\\F01D9';/)
  })

  it('[AC 4.1] does not override checked MUI checkbox color with the dark unchecked color', () => {
    const css = readFileSync('src/features/search/rule/SearchRulePage.module.css', 'utf8')

    expect(css).toMatch(
      /:global\(\[data-theme-mode='dark'\]\) \.checkboxLabel :global\(\.MuiCheckbox-root\.Mui-checked\)\s*\{[^}]*var\(--mui-palette-primary-main/s,
    )
  })

  it('[AC 3.31][AC 4.4] keeps the rule add FAB icon white in light and dark themes', () => {
    const css = readFileSync('src/features/search/rule/SearchRulePage.module.css', 'utf8')

    expect(css).toMatch(/\.ruleFab:global\(\.MuiFab-root\)\s*\{[^}]*color:\s*#fff;/s)
    expect(css).toMatch(
      /:global\(\[data-theme-mode='dark'\]\) \.ruleFab:global\(\.MuiFab-root\)\s*\{[^}]*color:\s*#fff;/s,
    )
  })
})
