import { readFileSync, readdirSync } from 'node:fs'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordedPlainDialog } from '@/features/recorded/components/RecordedPlainDialog'

describe('Recorded list route lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(
      null,
      '',
      '/#/recorded?page=3&keyword=alpha&ruleId=0&channelId=34&genre=5&hasOriginalFile=true&timestamp=999',
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 32] does not add helper-text row padding to the RecordedStreamSelectDialog AppSelect fields', () => {
    // The helper-text row reservation (AC 32) is scoped to `/reserves/manual` add-mode
    // option-panel fields (`ReservesPage.module.css`), not applied theme-wide, so this dialog's
    // fixed-height select rows (`.streamSelectFields` / `.legacySelectField`) must not gain any
    // MuiFormControl-root padding-bottom rule -- that would grow the dialog by 2px
    // (`visual/recorded-geometry.spec.ts`, `recorded-stream-dialog-mobile.png` 326x164 -> 326x166).
    const recordedCss = readFileSync('src/features/recorded/RecordedPage.module.css', 'utf8')

    expect(recordedCss).not.toMatch(/:global\(\.MuiFormControl-root\)\s*\{[^}]*padding-bottom/)
  })

  it('[AC frontend-app-shell 8.31] does not disable MUI dialog transitions for shared legacy dialogs', () => {
    const dialogSources = [
      ...readdirSync('src/features/recorded/components').map(
        (name) => `src/features/recorded/components/${name}`,
      ),
      'src/features/recorded/RecordedDetailPage.tsx',
      'src/features/recorded/RecordedPage.tsx',
      'src/features/reserves/ReserveListItem.tsx',
      'src/features/reserves/ReservesPage.tsx',
      'src/features/search/rule/RuleListPage.tsx',
    ]

    dialogSources.forEach((sourcePath) => {
      expect(readFileSync(sourcePath, 'utf8')).not.toContain('transitionDuration={0}')
    })
  })

  it('[AC frontend-app-shell 8.31] plays the MUI dialog exit transition instead of unmounting immediately when a shared legacy dialog closes', async () => {
    vi.useFakeTimers()

    const { rerender } = render(
      <RecordedPlainDialog open title="共有 dialog" onClose={vi.fn()}>
        <div>content</div>
      </RecordedPlainDialog>,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()

    rerender(
      <RecordedPlainDialog open={false} title="共有 dialog" onClose={vi.fn()}>
        <div>content</div>
      </RecordedPlainDialog>,
    )

    // MUI keeps the dialog mounted while the exit transition plays: it must still be present
    // immediately after `open` flips to false, before the transition's timeout elapses.
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // onExited always runs through a timer, even for a disabled (`transitionDuration={0}`)
    // transition, so it never fires synchronously within the rerender above. Flushing only a
    // 0ms timer tick is enough to run that zero-duration timer while leaving MUI's real ~195ms
    // exit timer untouched, so the dialog must still be present here only when a real,
    // non-zero-duration transition is still in flight.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Advance past MUI's default exit duration (195ms) so the transition's onExited fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // Source B: v2 build output client/dist/css/chunk-vendors.*.css —
  // `.theme--light.v-data-table>.v-data-table__wrapper>table>tbody>tr:hover:not(...){background:#eee}`
  // `.theme--dark.v-data-table>.v-data-table__wrapper>table>tbody>tr:hover:not(...){background:#616161}`
  it('[AC 2.4] changes recorded table row background on hover like v2, without overriding selected rows', () => {
    const css = readFileSync('src/features/recorded/RecordedPage.module.css', 'utf8')

    expect(css).toMatch(
      /\.table tbody tr:not\(\.selectedTableRow\):hover\s*\{[^}]*background-color: #eee(?:eee)?;/,
    )
    expect(css).toMatch(
      /:global\(\[data-theme-mode='dark'\]\) \.table tbody tr:not\(\.selectedTableRow\):hover\s*\{[^}]*background-color: #616161;/,
    )
  })

  // v2 の Vuetify は v-btn 内の先頭 icon へ `.v-icon--left { margin-left: -4px; margin-right: 8px }`
  // を当てる（v2 build の chunk-vendors CSS）。実測でも v2 の icon は button 左端から 12px、v3 は
  // 16px にあり、負の左 margin の分だけ右へずれていた。label の行高も v2 は normal（実測 16px）で、
  // v3 の 24.5px では icon と文字の視覚的な中心がそろわない。
  it('[AC 3.22] offsets the detail action icon the way Vuetify offsets a leading v-btn icon', () => {
    const css = readFileSync('src/features/recorded/RecordedPage.module.css', 'utf8')

    expect(css).toMatch(/\.detailActionIcon\s*\{[^}]*margin-left:\s*-4px;/)
  })

  // v2 の v-btn は letter-spacing 1.25px・line-height 21px で label を組む（実測）。v3 は MUI 既定の
  // 0.4px / 24.5px のままで、label が 3.4px 縮んで flex の中央寄せが icon を右へ押し、行箱が 3.5px
  // 高いぶん文字が上下中央からずれていた。
  it('[AC 3.22] sets the detail action label metrics v2 uses for a v-btn label', () => {
    const css = readFileSync('src/features/recorded/RecordedPage.module.css', 'utf8')
    const rule = css.match(/\.detailKodiAction\.detailKodiAction\s*\{[^}]*\}/u)?.[0] ?? ''

    expect(rule).toContain('letter-spacing: 1.25px;')
    expect(rule).toContain('line-height: 21px;')
  })

  it('[AC 2.17] keeps protect and unprotect menu icons aligned with legacy mdi-lock states', () => {
    const css = readFileSync('src/features/recorded/RecordedPage.module.css', 'utf8')

    expect(css).toMatch(
      /\.legacyMenuIcon\[data-recorded-menu-icon='protect'\]::before\s*\{\s*content: '\\F033E';\s*\}/,
    )
    expect(css).toMatch(
      /\.legacyMenuIcon\[data-recorded-menu-icon='unprotect'\]::before\s*\{\s*content: '\\F033F';\s*\}/,
    )
    expect(css).not.toMatch(
      /\.legacyMenuIcon\[data-recorded-menu-icon='protect'\]::before,\s*\.legacyMenuIcon\[data-recorded-menu-icon='unprotect'\]::before\s*\{[\s\S]*?border:/,
    )
    expect(css).not.toMatch(
      /\.legacyMenuIcon\[data-recorded-menu-icon='protect'\]::after,\s*\.legacyMenuIcon\[data-recorded-menu-icon='unprotect'\]::after\s*\{/,
    )
  })

  it('[AC 2.37] uses the icon font for recorded detail overflow menu buttons instead of a raw vertical ellipsis glyph', () => {
    const source = [
      'src/features/recorded/components/RecordedDetailMoreMenu.tsx',
      'src/features/recorded/components/RecordedItemMenu.tsx',
    ]
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    const css = readFileSync('src/features/recorded/RecordedPage.module.css', 'utf8')

    expect(source).not.toContain('>⋮</span>')
    expect(source).toContain('className={styles.menuButtonIcon}')
    expect(css).toMatch(/\.menuButtonIcon::before\s*\{\s*content: '\\F01D9';\s*\}/)
  })

  it('[AC 3.22] keeps recorded detail container width and responsive breakpoint parity', () => {
    const css = readFileSync('src/features/recorded/RecordedPage.module.css', 'utf8')

    expect(css).toContain('.recordedDetailPage {')
    expect(css).toContain('max-width: 900px;')
    expect(css).toContain('padding: 12px;')
    expect(css).toContain('grid-template-columns: 400px minmax(0, 1fr);')
    expect(css).toContain('@media (max-width: 799px)')
    expect(css).toContain('grid-template-columns: 1fr;')
  })

  it('[AC 3.22] carries the Vuetify v-container 3-tier max-width past the 960px breakpoint instead of capping at 900px on wide viewports', () => {
    // Source B: v2 build output client/dist/css/chunk-vendors.*.css —
    // @media(min-width:960px){.container{max-width:900px}}
    // @media(min-width:1264px){.container{max-width:1185px}}
    // @media(min-width:1904px){.container{max-width:1785px}}
    const css = readFileSync('src/features/recorded/RecordedPage.module.css', 'utf8')

    expect(css).not.toMatch(/^\.recordedDetailPage\s*\{[^}]*max-width/m)
    expect(css).toMatch(
      /@media \(min-width: 960px\)\s*\{\s*\.recordedDetailPage\s*\{\s*max-width: 900px;\s*\}\s*\}/,
    )
    expect(css).toMatch(
      /@media \(min-width: 1264px\)\s*\{\s*\.recordedDetailPage\s*\{\s*max-width: 1185px;\s*\}\s*\}/,
    )
    expect(css).toMatch(
      /@media \(min-width: 1904px\)\s*\{\s*\.recordedDetailPage\s*\{\s*max-width: 1785px;\s*\}\s*\}/,
    )
  })

  it('[AC 3.9] sizes recorded detail action button icons like Vuetify v-btn__content icons so the fixed-width play/streaming/encode buttons do not overflow and mis-center their label', () => {
    // Source A: v2 5cf2ea383 client/src/components/recorded/detail/RecordedDetailPlayButton.vue
    // `<v-icon left dark>{{ button }}</v-icon> {{ title }}` — icon is a v-btn__content child, not a bare 24px v-icon.
    // Source B: v2 build output client/dist/css/chunk-vendors.*.css —
    // `.v-btn__content .v-icon.v-icon--left,.v-icon--right{font-size:18px;height:18px;width:18px}`
    // A 24px icon inside the fixed 94px/117px/146px button widths this spec defines overflows and wraps the
    // label onto a second line, which reads as the icon being pushed right and the label losing vertical centering.
    const css = readFileSync('src/features/recorded/RecordedPage.module.css', 'utf8')

    expect(css).toMatch(/\.detailActionIcon\s*\{[^}]*font-size: 18px;/)
    expect(css).toMatch(/\.detailActionIcon\s*\{[^}]*height: 18px;/)
    expect(css).toMatch(/\.detailActionIcon\s*\{[^}]*width: 18px;/)
    expect(css).not.toMatch(/\.detailActionIcon\s*\{[^}]*font-size: 24px;/)
  })

  it('[AC 3.28] prevents horizontal overflow in the add encode dialog fields', () => {
    const css = readFileSync('src/features/recorded/RecordedPage.module.css', 'utf8')

    expect(css).toContain('.addEncodeContent.addEncodeContent {')
    expect(css).toContain('overflow-x: hidden;')
    expect(css).toContain('.addEncodeField {')
    expect(css).toContain('min-width: 0;')
    expect(css).toContain('.addEncodeTitle {')
    expect(css).toContain('overflow-wrap: anywhere;')
    expect(css).toContain('.addEncodeField :global(.MuiSelect-select) {')
    expect(css).toContain('text-overflow: ellipsis;')
  })

  // MUI standard components (Menu/MenuItem/Checkbox/Button/Dialog) inherit dark contrast from the
  // App Shell ThemeProvider context automatically, including inside a portal, because a portal only
  // changes DOM placement and not React context. Only the bespoke, non-MUI pieces of each of these
  // four detail surfaces (custom icon glyphs, plain-text titles, underline borders) need an explicit
  // `:global([data-theme-mode='dark'])` override in RecordedPage.module.css.
  it('[AC 3.30] keeps explicit dark-theme overrides for the bespoke pieces of the detail more menu, streaming dialog, add encode dialog, and download dialog', () => {
    const css = readFileSync('src/features/recorded/RecordedPage.module.css', 'utf8')

    // detail more menu: legacy menu item text and icon contrast
    expect(css).toMatch(
      /:global\(\[data-theme-mode='dark'\]\) \.legacyMenuItem\.legacyMenuItem\s*\{[^}]*color:/,
    )
    expect(css).toMatch(/:global\(\[data-theme-mode='dark'\]\) \.legacyMenuIcon[^{]*\{[^}]*color:/)

    // streaming dialog: title text and legacy select underline/label contrast
    expect(css).toMatch(
      /:global\(\[data-theme-mode='dark'\]\) \.streamSelectTitle[^{]*\{[^}]*color:/,
    )
    expect(css).toMatch(
      /:global\(\[data-theme-mode='dark'\]\) \.legacySelectField :global\(\.MuiInput-underline::before\)[^{]*\{[^}]*(border-bottom-color|color):/,
    )

    // add encode dialog: title text, field underline/label/disabled/clear-button contrast
    expect(css).toMatch(/:global\(\[data-theme-mode='dark'\]\) \.addEncodeTitle[^{]*\{[^}]*color:/)
    expect(css).toMatch(
      /:global\(\[data-theme-mode='dark'\]\) \.addEncodeField :global\(\.MuiInput-underline::before\)[^{]*\{[^}]*(border-bottom-color|color):/,
    )
    expect(css).toMatch(
      /:global\(\[data-theme-mode='dark'\]\) \.addEncodeField span[^{]*\{[^}]*color:/,
    )
    expect(css).toMatch(
      /:global\(\[data-theme-mode='dark'\]\) \.addEncodeField input:disabled\s*\{[^}]*color:/,
    )
    expect(css).toMatch(
      /:global\(\[data-theme-mode='dark'\]\) \.addEncodeClearButton\s*\{[^}]*color:/,
    )

    // download dialog: title and section label contrast
    expect(css).toMatch(/:global\(\[data-theme-mode='dark'\]\) \.downloadTitle[^{]*\{[^}]*color:/)
    expect(css).toMatch(
      /:global\(\[data-theme-mode='dark'\]\) \.downloadSectionLabel[^{]*\{[^}]*color:/,
    )
  })
})
