import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// v2 reference evidence (client/dist/css/chunk-vendors.*.css in the v2 build):
//   .title{font-size:1.25rem!important;font-weight:500;letter-spacing:.0125em!important}
//   .title{line-height:2rem;font-family:Roboto,sans-serif!important}
//   .caption{font-size:.75rem!important;letter-spacing:.0333333333em!important;line-height:1.25rem}
//   .subtitle-2{font-size:.875rem!important;font-weight:500;...}
// v2 markup evidence (client/src/views/Encode.vue, client/src/components/encode/EncodeSmallCard.vue in v2):
//   section labels use the bare Vuetify `.title` utility class (エンコード中 / 待機中).
//   item title uses `subtitle-2 font-weight-bold` (14px / 700).
//   channel / time / mode / progress text use the bare Vuetify `.caption` utility class (12px).
describe('[AC 3.3] Encode running/waiting section and item typography matches v2 Vuetify utility classes', () => {
  const css = readFileSync('src/features/encode/EncodePage.module.css', 'utf8')

  function rule(selector: string): string {
    const escaped = selector.replace(/[.[\]]/gu, (character) => `\\${character}`)
    const body = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, 'u'))?.groups?.body

    if (body === undefined) {
      throw new Error(`selector not found: ${selector}`)
    }

    return body
  }

  it('renders the running/waiting section label with the v2 Vuetify `.title` metrics (20px / 32px / 500)', () => {
    const sectionTitleRule = rule('.sectionTitle')

    expect(sectionTitleRule).toContain('font-size: 1.25rem')
    expect(sectionTitleRule).toContain('font-weight: 500')
    expect(sectionTitleRule).toContain('line-height: 2rem')
  })

  it('renders the item title with the v2 `subtitle-2` metrics (14px), kept bold to match font-weight-bold', () => {
    const titleRule = rule('.title')

    expect(titleRule).toContain('font-size: 0.875rem')
    expect(titleRule).toContain('font-weight: 700')
  })

  it('renders channel/time/mode/progress text with the v2 Vuetify `.caption` font size (12px)', () => {
    // Two rules share the `.meta, .mode, .progressText` selector fragment: a combined
    // `.title, .meta, .mode, .progressText { ... }` truncation rule, and the standalone
    // `.meta, .mode, .progressText { font-size: ... }` rule this test targets. Only the
    // latter carries a `font-size` declaration, so pick the matching block by content.
    const candidates = [
      ...css.matchAll(/\.meta\s*,\s*\.mode\s*,\s*\.progressText\s*\{(?<body>[^}]*)\}/gu),
    ]
    const captionRule = candidates
      .map((match) => match.groups?.body)
      .find((body): body is string => body !== undefined && body.includes('font-size'))

    if (captionRule === undefined) {
      throw new Error('font-size rule not found for .meta, .mode, .progressText')
    }

    expect(captionRule).toContain('font-size: 0.75rem')
  })
})
