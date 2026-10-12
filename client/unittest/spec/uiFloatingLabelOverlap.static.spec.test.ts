import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listCssFiles } from './support/staticSourceListing'

// AddEncodeDialog's "sub directory" field must not keep the literal text "sub directory" stamped
// on top of whatever the user typed. The label is a hand-rolled `<span>` styled with
// `position: absolute` + `pointer-events: none` to sit inside the field the way a placeholder
// would (client/src/features/recorded/RecordedPage.module.css, `.addEncodeDirectoryField span`),
// so the CSS module must hide or move the span once the field has a value or focus.
//
// Two other places in this codebase already solve the exact same "label drawn inside the field"
// layout correctly, with two different techniques:
// - `.legacyFloatingField` (SearchRulePage.module.css, used by the Search page's keyword/ignore
//   keyword fields) drives the shrink purely from CSS via `:not(:placeholder-shown)`.
// - `.recordedSearchLegacySelect` (RecordedPage.module.css, used by the Recorded search dialog's
//   channel/genre selects) drives it from React state via a `[data-has-value]` attribute.
// AddEncodeDialog uses the `:not(:placeholder-shown)` technique.
//
// This is a source-level (not rendered) guard because the actual "does the label really move out
// of the way" fact is layout-dependent and is covered where it matters by a real-browser test
// (client/e2e/text-field-label-visibility.spec.ts). jsdom (used by every other test in this
// unittest/ directory) does not run a real layout engine, so a jsdom-rendered assertion on
// getBoundingClientRect() cannot observe this defect at all - see that e2e file's header comment
// for the concrete evidence (tests that only check the input's value, never the
// label's position). What a static scan CAN check, exhaustively and for any current or future
// field, is the structural precondition for the bug: an absolutely positioned, pointer-events:none
// label spanning a text field with no companion rule that ever hides or moves it. That is exactly
// the shape of an unfixed AddEncodeDialog field, and exactly what this guard forbids everywhere in
// client/src.
describe('floating label overlap static regression guard', () => {
  it('requires every CSS-only "label drawn over the field" pattern to hide or move once filled', () => {
    const cssFiles = listCssFiles(join(process.cwd(), 'src'))
    const failures: string[] = []

    for (const file of cssFiles) {
      const source = readFileSync(file, 'utf8')
      const relativePath = file.replace(`${process.cwd()}/`, '')

      // Walk top-level `selector { declarations }` blocks. This file's CSS modules do not nest
      // rules, so a simple non-greedy match is sufficient and avoids pulling in a CSS parser.
      const blocks = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]

      const overlappingLabelPrefixes = new Set<string>()
      for (const block of blocks) {
        const selector = block[1]
        const declarations = block[2]

        if (!/\bspan\b/.test(selector)) continue
        if (!/position:\s*absolute/.test(declarations)) continue
        if (!/pointer-events:\s*none/.test(declarations)) continue

        // The class the label span is scoped under, e.g. ".addEncodeDirectoryField" out of
        // ".addEncodeDirectoryField span" or ".addEncodeDirectoryField > span:first-child".
        const prefixMatch = selector.match(/\.([A-Za-z0-9_-]+)/)
        if (prefixMatch) overlappingLabelPrefixes.add(prefixMatch[1])
      }

      for (const prefix of overlappingLabelPrefixes) {
        const hasPlaceholderShownEscape = new RegExp(
          `\\.${prefix}[^{]*:not\\(:placeholder-shown\\)`,
        ).test(source)
        const hasDataHasValueEscape = new RegExp(`\\.${prefix}(?:\\[|:)[^{]*data-has-value`).test(
          source,
        )
        // A field that is always shrunk/visible (no interactive state at all, e.g. a disabled
        // display-only field) would also satisfy the intent; treat an explicit `display: none`
        // baseline the same as the other two techniques since it can never overlap.
        const alwaysHidden = new RegExp(
          `\\.${prefix}\\[data-has-value='false'\\][^{]*\\{[^}]*display:\\s*none`,
        ).test(source)

        if (!hasPlaceholderShownEscape && !hasDataHasValueEscape && !alwaysHidden) {
          failures.push(
            `${relativePath}: ".${prefix} span" is an absolutely positioned, pointer-events:none ` +
              'label (the shape of Owner finding #6) with no ":not(:placeholder-shown)" or ' +
              '"[data-has-value]" rule anywhere in the file to hide or move it once the field has ' +
              'a value or focus',
          )
        }
      }
    }

    expect(failures).toEqual([])
  })
})
